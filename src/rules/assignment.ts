/**
 * Combined crew-assignment legality (2J).
 *
 * One reusable entry point evaluating every relevant constraint for a
 * hypothetical crew → pairing assignment and returning machine-readable
 * evidence per rule. Consumed later by candidate generation, simulation,
 * ranking, and LLM explanation — none of which may recompute these.
 *
 * Included per proposed pairing:
 *  - RULE-FDP-01  per pairing day (sectors + duty length that day)
 *  - RULE-DUTY-02 7-day calendar windows (history + roster + proposed)
 *  - RULE-FLT-03  28-day calendar windows (history + roster + proposed)
 *  - RULE-REST-04 gaps in the merged existing + proposed timeline
 *  - RULE-QUAL-05 crew ratings vs pairing aircraft type(s)
 *  - RULE-CERT-06 every cert valid on every proposed duty date
 *  - RULE-BASE-07 reserve callout validity, only when asReserve is set
 *    (full reserve eligibility = BASE-07 here + the six core checks above)
 *
 * The crew's existing roster (excluding the proposed pairing itself, so a
 * re-check never double-counts) feeds the window and rest calculations.
 */

import type { CrewId, DateStr, IsoUtc, PairingId, RuleId } from "../domain/types.js";
import { minutesBetween } from "../data/time.js";
import {
  getAircraftTypesForPairing,
  getPairingsForCrew,
  type OperationalGraph,
} from "../data/graph.js";
import type { RuleViolation } from "./evidence.js";
import { checkFdp, fdpViolation, FDP_RULE_ID } from "./fdp.js";
import { checkDutyWindows, dutyViolation, DUTY_RULE_ID, type DateHours } from "./duty.js";
import { checkFlightHours, flightHoursViolation, FLIGHT_RULE_ID } from "./flightHours.js";
import { checkRest, REST_RULE_ID } from "./rest.js";
import { checkQualification, QUAL_RULE_ID } from "./qualification.js";
import { checkCertificationsOnDate, CERT_RULE_ID } from "./certification.js";
import { checkReserveCallout, BASE_RULE_ID } from "./reserve.js";
import { dayWindowKey, type TimingOverlay } from "./overlay.js";

export interface AssignmentCheckEntry {
  ruleId: RuleId;
  passed: boolean;
  evidence: unknown;
}

export interface AssignmentLegality {
  legal: boolean;
  crewId: CrewId;
  pairingId: PairingId;
  asReserve: boolean;
  violations: RuleViolation[];
  checks: AssignmentCheckEntry[];
}

export interface CheckAssignmentOptions {
  /** Evaluate the BASE-07 reserve-callout check (default: line assignment). */
  asReserve?: boolean;
  /** Required report for the reserve window check (default: day-1 report). */
  requiredReportUtc?: IsoUtc;
  /**
   * Hypothetical timing overlay (Step 3 simulation). Overrides are consulted
   * at resolution time; anything absent falls back to rostered values.
   */
  timing?: TimingOverlay;
}

export function checkCrewAssignmentLegality(
  g: OperationalGraph,
  crewId: CrewId,
  pairingId: PairingId,
  opts: CheckAssignmentOptions = {},
): AssignmentLegality {
  const asReserve = opts.asReserve ?? false;
  const crew = g.crewById.get(crewId);
  if (!crew) throw new Error(`checkCrewAssignmentLegality: unknown crew ${crewId}`);
  const pairing = g.pairingById.get(pairingId);
  if (!pairing) throw new Error(`checkCrewAssignmentLegality: unknown pairing ${pairingId}`);

  const violations: RuleViolation[] = [];
  const checks: AssignmentCheckEntry[] = [];
  const fail = (ruleId: RuleId, passed: boolean, evidence: unknown, violation?: RuleViolation): void => {
    checks.push({ ruleId, passed, evidence });
    if (!passed && violation) violations.push(violation);
  };

  // ---- per-day FDP + proposed per-date contributions ----
  // Timing overrides (if any) are resolved here; rostered values otherwise.
  const resolveWindow = (
    pid: PairingId,
    date: DateStr,
    reportUtc: IsoUtc,
    releaseUtc: IsoUtc,
  ): { reportUtc: IsoUtc; releaseUtc: IsoUtc } =>
    opts.timing?.dayWindows?.get(dayWindowKey(pid, date)) ?? { reportUtc, releaseUtc };
  const resolveBlockMinutes = (fid: string, depUtc: IsoUtc, arrUtc: IsoUtc): number => {
    const t = opts.timing?.flightTimes?.get(fid);
    return minutesBetween(t?.depUtc ?? depUtc, t?.arrUtc ?? arrUtc) / 60;
  };

  const proposedDuty: DateHours = new Map();
  const proposedBlock: DateHours = new Map();
  const proposedWindows: Array<{ report: IsoUtc; release: IsoUtc }> = [];
  for (const day of pairing.days) {
    const flights = day.flights.map((fid) => {
      const f = g.flightById.get(fid);
      if (!f) throw new Error(`checkCrewAssignmentLegality: unknown flight ${fid} in ${pairingId}`);
      return f;
    });
    const w = resolveWindow(pairingId, day.date, day.reportUtc, day.releaseUtc);
    proposedWindows.push({ report: w.reportUtc, release: w.releaseUtc });
    const fdp = checkFdp(w.reportUtc, w.releaseUtc, flights.length);
    fail(FDP_RULE_ID, fdp.passed, fdp.evidence, fdp.passed ? undefined : fdpViolation(day.date, fdp.evidence));
    proposedDuty.set(day.date, (proposedDuty.get(day.date) ?? 0) + minutesBetween(w.reportUtc, w.releaseUtc) / 60);
    proposedBlock.set(
      day.date,
      (proposedBlock.get(day.date) ?? 0) +
        flights.reduce((n, f) => n + resolveBlockMinutes(f.flightId, f.depUtc, f.arrUtc), 0),
    );
  }

  // ---- existing roster contributions (excluding the proposed pairing) ----
  const existingDuty: DateHours = new Map<DateStr, number>();
  const existingBlock: DateHours = new Map<DateStr, number>();
  const existingDuties: Array<{ report: IsoUtc; release: IsoUtc }> = [];
  for (const p of getPairingsForCrew(g, crewId)) {
    if (p.pairingId === pairingId) continue;
    for (const day of p.days) {
      const w = resolveWindow(p.pairingId, day.date, day.reportUtc, day.releaseUtc);
      existingDuty.set(day.date, (existingDuty.get(day.date) ?? 0) + minutesBetween(w.reportUtc, w.releaseUtc) / 60);
      let block = 0;
      for (const fid of day.flights) {
        const f = g.flightById.get(fid);
        if (!f) throw new Error(`checkCrewAssignmentLegality: unknown flight ${fid} in ${p.pairingId}`);
        block += resolveBlockMinutes(f.flightId, f.depUtc, f.arrUtc);
      }
      existingBlock.set(day.date, (existingBlock.get(day.date) ?? 0) + block);
      existingDuties.push({ report: w.reportUtc, release: w.releaseUtc });
    }
  }

  const history = g.dutyClockByCrew.get(crewId)?.dailyHistory ?? [];

  // ---- 7-day duty + 28-day flight windows ----
  const duty = checkDutyWindows({ history, existing: existingDuty, proposed: proposedDuty });
  fail(DUTY_RULE_ID, duty.passed, duty.evidence, duty.passed ? undefined : dutyViolation(duty.evidence));
  const flight = checkFlightHours({ history, existing: existingBlock, proposed: proposedBlock });
  fail(
    FLIGHT_RULE_ID,
    flight.passed,
    flight.evidence,
    flight.passed ? undefined : flightHoursViolation(flight.evidence),
  );

  // ---- rest gaps across the merged existing + proposed timeline ----
  const timeline = [...existingDuties, ...proposedWindows].sort((a, b) =>
    a.report < b.report ? -1 : a.report > b.report ? 1 : 0,
  );
  if (timeline.length < 2) {
    fail(REST_RULE_ID, true, {
      ruleId: REST_RULE_ID,
      applicable: timeline.length === 0 ? false : true,
      gapsEvaluated: 0,
      reason:
        timeline.length === 0
          ? "no duties on record; nothing to rest between"
          : "single duty on record; no rest gap to evaluate",
    });
  } else {
    let allPassed = true;
    const gaps: unknown[] = [];
    for (let i = 0; i + 1 < timeline.length; i++) {
      const gap = checkRest(timeline[i].release, timeline[i + 1].report);
      gaps.push(gap.evidence);
      if (!gap.passed) {
        allPassed = false;
        violations.push({
          ruleId: REST_RULE_ID,
          message: gap.evidence.violation ?? `${REST_RULE_ID} breached`,
          actual: gap.evidence.restHours,
          limit: gap.evidence.minimumRestHours,
          details: { previousRelease: gap.evidence.previousRelease, nextReport: gap.evidence.nextReport },
        });
      }
    }
    checks.push({ ruleId: REST_RULE_ID, passed: allPassed, evidence: { ruleId: REST_RULE_ID, gaps } });
  }

  // ---- qualification ----
  const observedTypes = getAircraftTypesForPairing(g, pairingId);
  const qual = checkQualification(crew.ratings, observedTypes);
  fail(
    QUAL_RULE_ID,
    qual.passed,
    qual.evidence,
    qual.passed
      ? undefined
      : {
          ruleId: QUAL_RULE_ID,
          message: qual.evidence.violation ?? `${QUAL_RULE_ID} breached`,
          details: {
            crewRatings: qual.evidence.crewRatings,
            observedAircraftTypes: qual.evidence.observedAircraftTypes,
          },
        },
  );

  // ---- certifications on every proposed duty date ----
  const certs = g.certificationsByCrew.get(crewId) ?? [];
  const dutyDates = [...new Set(pairing.days.map((d) => d.date))].sort();
  if (dutyDates.length === 0) {
    fail(CERT_RULE_ID, true, { ruleId: CERT_RULE_ID, applicable: false, reason: "pairing has no duty dates" });
  } else {
    let allPassed = true;
    const perDate: unknown[] = [];
    for (const date of dutyDates) {
      const c = checkCertificationsOnDate(certs, date);
      perDate.push(c.evidence);
      if (!c.passed) {
        allPassed = false;
        violations.push({
          ruleId: CERT_RULE_ID,
          message: c.evidence.violation ?? `${CERT_RULE_ID} breached`,
          details: { dutyDate: date, expired: c.evidence.expired },
        });
      }
    }
    checks.push({ ruleId: CERT_RULE_ID, passed: allPassed, evidence: { ruleId: CERT_RULE_ID, perDate } });
  }

  // ---- reserve callout (only for reserve assignments) ----
  if (asReserve) {
    const base = checkReserveCallout(g, crewId, pairingId, { requiredReportUtc: opts.requiredReportUtc });
    fail(
      BASE_RULE_ID,
      base.passed,
      base.evidence,
      base.passed
        ? undefined
        : {
            ruleId: BASE_RULE_ID,
            message: `${BASE_RULE_ID} breached: ${base.evidence.reasons.join("; ") || "reserve callout invalid"}`,
            details: {
              requiresDeadhead: base.evidence.requiresDeadhead,
              missingDates: base.evidence.missingDates,
            },
          },
    );
  } else {
    fail(BASE_RULE_ID, true, {
      ruleId: BASE_RULE_ID,
      applicable: false,
      reason: "line assignment, not a reserve callout",
    });
  }

  return { legal: violations.length === 0, crewId, pairingId, asReserve, violations, checks };
}
