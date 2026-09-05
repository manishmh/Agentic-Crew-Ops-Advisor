/**
 * Hypothetical-state simulation (STEP 3 §§3–4).
 *
 * Builds TimingOverlay objects against read-only graph data. The canonical
 * graph is NEVER mutated: builders return fresh Maps; the legality engine
 * resolves overrides at evaluation time. Callers can rebuild and re-apply
 * overlays arbitrarily — repeated simulation leaves base state untouched.
 *
 * Timing models (calibrated to the dataset conventions):
 *  - rotation delay: a delayed flight shifts itself and downstream same-
 *    aircraft same-date flights equally; report stays fixed (crew on duty),
 *    so release extends and FDP grows.
 *  - pairing shift: whole pairing days shift uniformly (deadhead cover —
 *    crew not yet on duty; internal rest/FDP preserved).
 *  - release extension: report fixed, release pushed by a shift amount
 *    (station closure hold on an operating crew).
 */

import type { DateStr, FlightId, IsoUtc, PairingId } from "../domain/types.js";
import {
  addMinutes,
  calendarDate,
  compareUtc,
  minutesBetween,
} from "../data/time.js";
import { getFlightsForPairing, type OperationalGraph } from "../data/graph.js";
import {
  dayWindowKey,
  type DayWindowOverride,
  type FlightTimeOverride,
  type TimingOverlay,
} from "../rules/overlay.js";

/** Flights of the same aircraft + dep-date at/after the given flight, ordered. */
export function rotationDownstream(g: OperationalGraph, flightId: FlightId): string[] {
  const anchor = g.flightById.get(flightId);
  if (!anchor) throw new Error(`rotationDownstream: unknown flight ${flightId}`);
  const date = calendarDate(anchor.depUtc);
  return g.flightsByAircraft
    .get(anchor.aircraft)
    ?.filter((f) => calendarDate(f.depUtc) === date && compareUtc(f.depUtc, anchor.depUtc) >= 0)
    .sort((a, b) => compareUtc(a.depUtc, b.depUtc))
    .map((f) => f.flightId) ?? [];
}

/** Shift a flight and its rotation-downstream legs by delayMinutes. */
export function rotationDelayOverlay(g: OperationalGraph, flightId: FlightId, delayMinutes: number): TimingOverlay {
  const flightTimes = new Map<FlightId, FlightTimeOverride>();
  for (const fid of rotationDownstream(g, flightId)) {
    const f = g.flightById.get(fid);
    if (!f) continue;
    flightTimes.set(fid, { depUtc: addMinutes(f.depUtc, delayMinutes), arrUtc: addMinutes(f.arrUtc, delayMinutes) });
  }
  return { flightTimes };
}

/**
 * Extend one pairing day's release by extraMinutes, report fixed.
 * Models a crew held on duty by delay/closure (FDP grows).
 */
export function extendReleaseOverlay(
  g: OperationalGraph,
  pairingId: PairingId,
  date: DateStr,
  extraMinutes: number,
): TimingOverlay {
  const pairing = g.pairingById.get(pairingId);
  const day = pairing?.days.find((d) => d.date === date);
  if (!pairing || !day) throw new Error(`extendReleaseOverlay: unknown day ${pairingId}|${date}`);
  return {
    dayWindows: new Map([[dayWindowKey(pairingId, date), {
      reportUtc: day.reportUtc,
      releaseUtc: addMinutes(day.releaseUtc, extraMinutes),
    }]]),
  };
}

/**
 * Shift whole pairing days uniformly (deadhead cover: replacement not yet
 * on duty; all reports/releases move together, preserving FDP and rest).
 */
export function shiftPairingOverlay(
  g: OperationalGraph,
  pairingId: PairingId,
  delayMinutes: number,
  fromDate?: DateStr,
): TimingOverlay {
  const pairing = g.pairingById.get(pairingId);
  if (!pairing) throw new Error(`shiftPairingOverlay: unknown pairing ${pairingId}`);
  const dayWindows = new Map<string, DayWindowOverride>();
  const flightTimes = new Map<FlightId, FlightTimeOverride>();
  for (const day of pairing.days) {
    if (fromDate !== undefined && day.date < fromDate) continue;
    dayWindows.set(dayWindowKey(pairingId, day.date), {
      reportUtc: addMinutes(day.reportUtc, delayMinutes),
      releaseUtc: addMinutes(day.releaseUtc, delayMinutes),
    });
    for (const fid of day.flights) {
      const f = g.flightById.get(fid);
      if (!f) continue;
      flightTimes.set(fid, { depUtc: addMinutes(f.depUtc, delayMinutes), arrUtc: addMinutes(f.arrUtc, delayMinutes) });
    }
  }
  return { dayWindows, flightTimes };
}

/** Merge overlays (later wins on key conflicts); inputs untouched. */
export function mergeOverlays(...overlays: TimingOverlay[]): TimingOverlay {
  const dayWindows = new Map<string, DayWindowOverride>();
  const flightTimes = new Map<FlightId, FlightTimeOverride>();
  for (const o of overlays) {
    for (const [k, v] of o.dayWindows ?? []) dayWindows.set(k, v);
    for (const [k, v] of o.flightTimes ?? []) flightTimes.set(k, v);
  }
  return { dayWindows, flightTimes };
}

/** Shift minutes between rostered and hypothetical report (0 when on time). */
export function reportShiftMinutes(rosteredReportUtc: IsoUtc, adjustedReportUtc: IsoUtc): number {
  return Math.round(minutesBetween(rosteredReportUtc, adjustedReportUtc) * 100) / 100;
}

/** Split one pairing day after leg index `splitAfter` (0-based) for partial recovery. */
export interface DaySplit {
  pairingId: PairingId;
  date: DateStr;
  /** Prefix legs the original crew keeps (flight ids in order). */
  prefixFlights: FlightId[];
  /** Suffix legs needing cover, with shifted times. */
  suffixFlights: Array<{ flightId: FlightId; depUtc: IsoUtc; arrUtc: IsoUtc }>;
  /** Original crew's prefix window: rostered report → shifted prefix release. */
  prefixReleaseUtc: IsoUtc;
  /** Replacement window derived from shifted suffix times. */
  suffixReportUtc: IsoUtc;
  suffixReleaseUtc: IsoUtc;
}

export function splitPairingDay(
  g: OperationalGraph,
  pairingId: PairingId,
  date: DateStr,
  splitAfter: number,
  flightTimes?: ReadonlyMap<FlightId, FlightTimeOverride>,
): DaySplit {
  const pairing = g.pairingById.get(pairingId);
  const day = pairing?.days.find((d) => d.date === date);
  if (!pairing || !day) throw new Error(`splitPairingDay: unknown day ${pairingId}|${date}`);
  if (splitAfter < 0 || splitAfter >= day.flights.length - 1) {
    throw new Error(`splitPairingDay: splitAfter ${splitAfter} out of range for ${day.flights.length} legs`);
  }
  const times = (fid: FlightId): { depUtc: IsoUtc; arrUtc: IsoUtc } => {
    const f = g.flightById.get(fid);
    if (!f) throw new Error(`splitPairingDay: unknown flight ${fid}`);
    return flightTimes?.get(fid) ?? { depUtc: f.depUtc, arrUtc: f.arrUtc };
  };
  const prefixFlights = day.flights.slice(0, splitAfter + 1);
  const suffixFlights = day.flights.slice(splitAfter + 1).map((fid) => ({ flightId: fid, ...times(fid) }));
  const prefixReleaseUtc = addMinutes(times(prefixFlights[prefixFlights.length - 1]).arrUtc, 30);
  return {
    pairingId,
    date,
    prefixFlights,
    suffixFlights,
    prefixReleaseUtc,
    suffixReportUtc: addMinutes(suffixFlights[0].depUtc, -60),
    suffixReleaseUtc: addMinutes(suffixFlights[suffixFlights.length - 1].arrUtc, 30),
  };
}

/** Shifted times of one pairing's flights under an overlay (rostered fallback). */
export function shiftedPairingFlights(
  g: OperationalGraph,
  pairingId: PairingId,
  overlay?: TimingOverlay,
): Array<{ flightId: FlightId; depUtc: IsoUtc; arrUtc: IsoUtc }> {
  return getFlightsForPairing(g, pairingId).map((f) => ({
    flightId: f.flightId,
    depUtc: overlay?.flightTimes?.get(f.flightId)?.depUtc ?? f.depUtc,
    arrUtc: overlay?.flightTimes?.get(f.flightId)?.arrUtc ?? f.arrUtc,
  }));
}
