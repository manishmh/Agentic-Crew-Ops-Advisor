/**
 * Impact propagation (STEP 3 §2).
 *
 * Reads only — every traversal goes through the existing graph indexes.
 * No relationship logic is duplicated here.
 */

import type { CrewId, DateStr, IsoUtc, PairingId, StationCode } from "../domain/types.js";
import {
  getCrewRoleInPairing,
  getFlightsForPairing,
  type OperationalGraph,
} from "../data/graph.js";
import { compareUtc, minutesBetween } from "../data/time.js";
import { fdpLimitHours } from "../rules/fdp.js";
import type { CertImpact, CrewImpact, StationImpact } from "./types.js";

/** Crew → pairing(s) → flights for one unavailable crew member. */
export function propagateCrewImpact(
  g: OperationalGraph,
  crewId: CrewId,
  pairingId: PairingId,
): CrewImpact {
  const pairing = g.pairingById.get(pairingId);
  if (!pairing) throw new Error(`propagateCrewImpact: unknown pairing ${pairingId}`);
  const role = getCrewRoleInPairing(g, pairingId, crewId);
  if (!role) throw new Error(`propagateCrewImpact: ${crewId} not assigned to ${pairingId}`);
  const flights = [...getFlightsForPairing(g, pairingId)];
  return {
    kind: "crew",
    crewId,
    pairingId,
    role,
    pairing,
    flights,
    dates: pairing.days.map((d) => d.date),
  };
}

/**
 * Station-closure impact (S3 model, mirroring validate/generate semantics):
 * a flight is affected when its BLR/closure-station departure OR arrival
 * falls in [startUtc, endUtc). The triggering op is delayed to end + 30min;
 * the rotation-level applied shift is the max over the aircraft-day.
 */
export function stationClosureImpact(
  g: OperationalGraph,
  station: StationCode,
  startUtc: IsoUtc,
  endUtc: IsoUtc,
  turnMinutes = 30,
): StationImpact {
  const affected = g.flights.filter(
    (f) =>
      (f.depStation === station && compareUtc(f.depUtc, startUtc) >= 0 && compareUtc(f.depUtc, endUtc) < 0) ||
      (f.arrStation === station && compareUtc(f.arrUtc, startUtc) >= 0 && compareUtc(f.arrUtc, endUtc) < 0),
  );

  // Per-flight shift to clear the closure, then rotation-level max.
  const shiftByFlight = new Map<string, number>();
  for (const f of affected) {
    const depHit = f.depStation === station && compareUtc(f.depUtc, startUtc) >= 0 && compareUtc(f.depUtc, endUtc) < 0;
    const anchor = depHit ? f.depUtc : f.arrUtc;
    shiftByFlight.set(f.flightId, Math.max(0, minutesBetween(anchor, endUtc) + turnMinutes));
  }
  const rotationShift = new Map<string, number>();
  for (const f of affected) {
    const key = `${f.aircraft}|${f.date}`;
    rotationShift.set(key, Math.max(rotationShift.get(key) ?? 0, shiftByFlight.get(f.flightId) ?? 0));
  }

  const assessments = affected.map((f) => {
    const pairing = g.pairingsByFlight.get(f.flightId)?.[0];
    const day = pairing?.days.find((d) => d.flights.includes(f.flightId));
    const applied = rotationShift.get(`${f.aircraft}|${f.date}`) ?? 0;
    const dutyAfter = day ? minutesBetween(day.reportUtc, day.releaseUtc) / 60 + applied / 60 : 0;
    const limit = day ? fdpLimitHours(day.flights.length) : 0;
    return {
      flightId: f.flightId,
      pairingId: pairing?.pairingId ?? "",
      shiftMinutes: Math.round((shiftByFlight.get(f.flightId) ?? 0) * 100) / 100,
      appliedShiftMinutes: Math.round(applied * 100) / 100,
      dutyHoursAfter: Math.round(dutyAfter * 100) / 100,
      fdpLimitHours: limit,
      fdpLegal: dutyAfter <= limit + 1e-6,
    };
  });

  return { kind: "station", station, startUtc, endUtc, affectedFlights: affected, assessments };
}

/** Pairing duties of a crew member falling on/after a certification expiry. */
export function certImpact(g: OperationalGraph, crewId: CrewId, dutyDate: DateStr): CertImpact {
  const certs = g.certificationsByCrew.get(crewId) ?? [];
  const affected: CertImpact["affected"] = [];
  for (const p of g.pairingsByCrew.get(crewId) ?? []) {
    for (const day of p.days) {
      if (day.date < dutyDate) continue;
      const expired = certs.filter((c) => c.validTo < day.date).map((c) => c.certType);
      if (expired.length > 0) {
        affected.push({ pairingId: p.pairingId, dutyDate: day.date, expired });
      }
    }
  }
  return { kind: "cert", crewId, affected };
}
