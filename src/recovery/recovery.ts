/**
 * Recovery solver (STEP 3 §§10, 12).
 *
 * sick-call cover pipeline: impact → candidates → hypothetical legality
 * (deadhead-shifted timing where needed) → cost → rank → plan, plus a
 * cancellation fallback. Also hosts station-closure assessment and the
 * partial-day recovery primitive (S4). Everything derives from the
 * dataset through the Step-2 engine — no scenario answers live here.
 */

import type { CrewId, DateStr, FlightId, IsoUtc, PairingId, StationCode } from "../domain/types.js";
import type { OperationalGraph } from "../data/graph.js";
import { addMinutes, minutesBetween, round2 } from "../data/time.js";
import {
  checkCrewAssignmentLegality,
  type AssignmentCheckEntry,
  type AssignmentLegality,
} from "../rules/assignment.js";
import { checkFdp, fdpViolation, FDP_RULE_ID } from "../rules/fdp.js";
import { checkDutyWindows, dutyViolation, DUTY_RULE_ID, type DateHours } from "../rules/duty.js";
import { checkFlightHours, flightHoursViolation, FLIGHT_RULE_ID } from "../rules/flightHours.js";
import { checkRest, REST_RULE_ID } from "../rules/rest.js";
import { checkQualification, QUAL_RULE_ID } from "../rules/qualification.js";
import { checkCertificationsOnDate, CERT_RULE_ID } from "../rules/certification.js";
import { checkReserveCallout, isTimeInWindow, BASE_RULE_ID } from "../rules/reserve.js";
import { getPairingsForCrew } from "../data/graph.js";
import type { RuleViolation } from "../rules/evidence.js";
import type { TimingOverlay } from "../rules/overlay.js";
import { propagateCrewImpact, stationClosureImpact } from "./impact.js";
import { findCandidates, type CoverRequirement } from "./candidates.js";
import { breakdown, cancellationComponent, priceCover } from "./cost.js";
import { rankOptions } from "./ranking.js";
import { mergeOverlays, shiftPairingOverlay, splitPairingDay } from "./simulation.js";
import type { Disruption, RecoveryOption, RecoveryPlan, StationImpact } from "./types.js";

export interface CoverSolution extends RecoveryPlan {
  pairingBase: string;
}

/**
 * Full-pairing sick cover: every candidate evaluated through the Step-2
 * engine under deadhead-shifted hypothetical timing when positioning
 * applies (uniform shift of all pairing days, per the dataset deadhead
 * convention), priced from costs.json, ranked, cheapest selected.
 */
export interface SickCoverRequest {
  pairingId: PairingId;
  role: CoverRequirement["role"];
  /** Unavailable crew member whose seat is covered (also the impact subject). */
  sickCrewId: CrewId;
  /** Additional exclusions beyond the sick crew (e.g. forced no-candidate tests). */
  extraExcludeCrewIds?: CrewId[];
  reportedUtc?: IsoUtc;
}

export function solveCrewCover(g: OperationalGraph, req: SickCoverRequest): CoverSolution {
  const disruption: Disruption = {
    type: "CREW_UNAVAILABLE",
    crewId: req.sickCrewId,
    pairingId: req.pairingId,
    reportedUtc: req.reportedUtc ?? "",
  };
  const impact = propagateCrewImpact(g, disruption.crewId, req.pairingId);
  const { candidates, eliminated, pairingBase } = findCandidates(g, {
    pairingId: req.pairingId,
    role: req.role,
    excludeCrewIds: [req.sickCrewId, ...(req.extraExcludeCrewIds ?? [])],
  });

  const options: RecoveryOption[] = [];
  const rejected: Array<{ crewId: CrewId; reasons: string[] }> = eliminated.map((e) => ({
    crewId: e.crewId,
    reasons: [e.reason],
  }));

  for (const c of candidates) {
    const delayMin = Math.round(c.deadhead.delayHours * 60);
    const timing: TimingOverlay | undefined =
      delayMin > 0 ? shiftPairingOverlay(g, req.pairingId, delayMin) : undefined;
    // Reserve window is checked against the shifted (post-deadhead) report.
    const shiftedReport =
      delayMin > 0
        ? addMinutes(g.pairingById.get(req.pairingId)?.days[0]?.reportUtc ?? "", delayMin)
        : undefined;
    const legality = checkCrewAssignmentLegality(g, c.crewId, req.pairingId, {
      asReserve: c.kind === "reserve",
      requiredReportUtc: shiftedReport,
      timing,
    });
    const cost = priceCover(c.crew, c.kind, g.costs, {
      deadhead: c.deadhead.positioningFlightId !== undefined,
      delayHours: c.deadhead.delayHours,
    });
    const delayHours = c.deadhead.delayHours;
    if (legality.legal) {
      options.push({
        crewId: c.crewId,
        kind: "cover",
        pairingId: req.pairingId,
        role: req.role,
        legality,
        cost,
        delayHours,
        affectedFlights: impact.flights.map((f) => f.flightId),
        adjustedReportUtc: shiftedReport,
      });
    } else {
      rejected.push({
        crewId: c.crewId,
        reasons: legality.violations.map((v) => v.message),
      });
    }
  }

  // Cancellation fallback: all uncovered flights at per-leg rate.
  const cancelFlights = impact.flights.map((f) => f.flightId);
  options.push({
    crewId: undefined,
    kind: "cancel",
    pairingId: req.pairingId,
    role: undefined,
    legality: undefined,
    cost: breakdown(g.costs, [cancellationComponent(cancelFlights.length, g.costs)]),
    delayHours: 0,
    affectedFlights: cancelFlights,
    adjustedReportUtc: undefined,
  });

  rejected.sort((a, b) => (a.crewId < b.crewId ? -1 : 1));
  const { ranked, rejected: rejectedIllegal } = rankOptions(options);
  for (const o of rejectedIllegal) {
    rejected.push({
      crewId: o.crewId ?? "",
      reasons: (o.legality?.violations ?? []).map((v) => v.message),
    });
  }
  rejected.sort((a, b) => (a.crewId < b.crewId ? -1 : 1));

  const selected = ranked[0];
  return {
    disruption,
    impact,
    ranked,
    rejected,
    selected,
    totalCost: selected?.cost.total ?? 0,
    pairingBase,
  };
}

// ------------------------------------------------- closure assessment ----

export interface ClosureAssessment {
  impact: StationImpact;
  /** Per pairing-day: original crew legality under the extended release. */
  dayAssessments: Array<{
    pairingId: PairingId;
    date: DateStr;
    shiftMinutes: number;
    fdpLegal: boolean;
    dutyHoursAfter: number;
    fdpLimitHours: number;
  }>;
}

/** S3: apply rotation-max shifts, assess each affected pairing day's crew FDP. */
export function assessStationClosure(
  g: OperationalGraph,
  station: StationCode,
  startUtc: IsoUtc,
  endUtc: IsoUtc,
): ClosureAssessment {
  const impact = stationClosureImpact(g, station, startUtc, endUtc);
  const shiftByRotation = new Map<string, number>();
  for (const a of impact.assessments) {
    const f = g.flightById.get(a.flightId);
    if (!f) continue;
    const key = `${f.aircraft}|${f.date}`;
    shiftByRotation.set(key, Math.max(shiftByRotation.get(key) ?? 0, a.shiftMinutes));
  }
  const seen = new Set<string>();
  const dayAssessments: ClosureAssessment["dayAssessments"] = [];
  for (const a of impact.assessments) {
    const key = `${a.pairingId}|${g.flightById.get(a.flightId)?.date}`;
    if (seen.has(key) || !a.pairingId) continue;
    seen.add(key);
    const f = g.flightById.get(a.flightId);
    const pairing = g.pairingById.get(a.pairingId);
    const day = pairing?.days.find((d) => d.date === f?.date);
    if (!pairing || !day || !f) continue;
    const shift = shiftByRotation.get(`${f.aircraft}|${f.date}`) ?? 0;
    const dutyAfter = round2(minutesBetween(day.reportUtc, day.releaseUtc) / 60 + shift / 60);
    dayAssessments.push({
      pairingId: a.pairingId,
      date: day.date,
      shiftMinutes: shift,
      fdpLegal: dutyAfter <= a.fdpLimitHours + 1e-6,
      dutyHoursAfter: dutyAfter,
      fdpLimitHours: a.fdpLimitHours,
    });
  }
  dayAssessments.sort((a, b) => (a.pairingId < b.pairingId ? -1 : 1));
  return { impact, dayAssessments };
}

// ----------------------------------------------- partial-day recovery ----

export interface SuffixCandidate {
  crewId: CrewId;
  kind: "reserve" | "dayoff";
  legality: AssignmentLegality;
  costTotal: number;
  delayHours: number;
}

export interface PartialDayPlan {
  pairingId: PairingId;
  date: DateStr;
  delayMinutes: number;
  /** Latest prefix (leg count) the original crew can legally keep. */
  feasiblePrefixLegs: number;
  prefixFdpHours: number;
  prefixFdpLimit: number;
  fullDayIllegal: boolean;
  suffixFlights: FlightId[];
  suffixReportUtc: IsoUtc;
  suffixReleaseUtc: IsoUtc;
  /** Cheapest legal cover per vacated role on the suffix. */
  suffixCovers: Array<{ role: string; options: SuffixCandidate[] }>;
  suffixTotalCost: number;
}

function existingMapsFor(
  g: OperationalGraph,
  crewId: CrewId,
  excludePairingId: PairingId,
  timing?: TimingOverlay,
): { duty: DateHours; block: DateHours; duties: Array<{ report: IsoUtc; release: IsoUtc }> } {
  const duty: DateHours = new Map();
  const block: DateHours = new Map();
  const duties: Array<{ report: IsoUtc; release: IsoUtc }> = [];
  for (const p of getPairingsForCrew(g, crewId)) {
    if (p.pairingId === excludePairingId) continue;
    for (const day of p.days) {
      const w = timing?.dayWindows?.get(`${p.pairingId}|${day.date}`) ?? {
        reportUtc: day.reportUtc,
        releaseUtc: day.releaseUtc,
      };
      duty.set(day.date, (duty.get(day.date) ?? 0) + minutesBetween(w.reportUtc, w.releaseUtc) / 60);
      let b = 0;
      for (const fid of day.flights) {
        const f = g.flightById.get(fid);
        if (!f) continue;
        const t = timing?.flightTimes?.get(fid);
        b += minutesBetween(t?.depUtc ?? f.depUtc, t?.arrUtc ?? f.arrUtc) / 60;
      }
      block.set(day.date, (block.get(day.date) ?? 0) + b);
      duties.push({ report: w.reportUtc, release: w.releaseUtc });
    }
  }
  return { duty, block, duties };
}

/**
 * S4-style partial recovery: with a rotation delay applied (report fixed,
 * release extends), find the latest prefix the ORIGINAL crew keeps and
 * price standalone suffix covers per vacated role using Step-2 primitives
 * (FDP + windows + rest + qual + certs; BASE-07 for reserves).
 */
export function planPartialDayRecovery(
  g: OperationalGraph,
  pairingId: PairingId,
  date: DateStr,
  delayMinutes: number,
): PartialDayPlan {
  const pairing = g.pairingById.get(pairingId);
  const day = pairing?.days.find((d) => d.date === date);
  if (!pairing || !day) throw new Error(`planPartialDayRecovery: unknown day ${pairingId}|${date}`);
  const n = day.flights.length;

  const shifted = (fid: FlightId): { depUtc: IsoUtc; arrUtc: IsoUtc } => {
    const f = g.flightById.get(fid);
    if (!f) throw new Error(`planPartialDayRecovery: unknown flight ${fid}`);
    return { depUtc: addMinutes(f.depUtc, delayMinutes), arrUtc: addMinutes(f.arrUtc, delayMinutes) };
  };

  const fullRelease = addMinutes(day.releaseUtc, delayMinutes);
  const fullFdp = checkFdp(day.reportUtc, fullRelease, n);
  let feasiblePrefixLegs = 0;
  let prefixFdpHours = 0;
  for (let m = n - 1; m >= 1; m--) {
    const prefixRelease = addMinutes(shifted(day.flights[m - 1]).arrUtc, 30);
    const prefix = checkFdp(day.reportUtc, prefixRelease, m);
    if (prefix.passed) {
      feasiblePrefixLegs = m;
      prefixFdpHours = prefix.evidence.actualFdpHours;
      break;
    }
  }

  const split = splitPairingDay(
    g,
    pairingId,
    date,
    Math.max(0, feasiblePrefixLegs - 1),
    new Map(day.flights.map((fid) => [fid, shifted(fid)])),
  );
  const suffixSectors = split.suffixFlights.length;
  const suffixBlockPerDate = new Map<DateStr, number>([
    [
      date,
      split.suffixFlights.reduce((t, s) => t + minutesBetween(s.depUtc, s.arrUtc) / 60, 0),
    ],
  ]);
  const suffixDutyPerDate = new Map<DateStr, number>([
    [date, minutesBetween(split.suffixReportUtc, split.suffixReleaseUtc) / 60],
  ]);

  const suffixCovers: PartialDayPlan["suffixCovers"] = [];
  let suffixTotalCost = 0;
  const roles = [...new Set(pairing.crew.map((m) => m.role))];
  const observedTypes = [...new Set(split.suffixFlights.map((s) => g.flightById.get(s.flightId)?.aircraftType).filter((t) => t !== undefined))];
  for (const role of roles) {
    const options: SuffixCandidate[] = [];
    for (const crew of g.crews) {
      if (crew.rank !== role || crew.status !== "active") continue;
      // Standalone suffix duty evaluated with Step-2 primitives (not the
      // pairing-level check: the cover operates the suffix only).
      // Suffix positioning is assumed pre-arranged (callout cost only, no
      // deadhead leg) — consistent with the reference recovery costing.
      const isReserve = g.reserveByCrew.has(crew.crewId);
      const checks: AssignmentCheckEntry[] = [];
      const violations: RuleViolation[] = [];
      const suffixFdp = checkFdp(split.suffixReportUtc, split.suffixReleaseUtc, suffixSectors);
      checks.push({ ruleId: FDP_RULE_ID, passed: suffixFdp.passed, evidence: suffixFdp.evidence });
      if (!suffixFdp.passed) violations.push(fdpViolation(date, suffixFdp.evidence));
      const history = g.dutyClockByCrew.get(crew.crewId)?.dailyHistory ?? [];
      const { duty, block, duties } = existingMapsFor(g, crew.crewId, pairingId);
      const dutyCheck = checkDutyWindows({ history, existing: duty, proposed: suffixDutyPerDate });
      checks.push({ ruleId: DUTY_RULE_ID, passed: dutyCheck.passed, evidence: dutyCheck.evidence });
      if (!dutyCheck.passed) violations.push(dutyViolation(dutyCheck.evidence));
      const flightCheck = checkFlightHours({ history, existing: block, proposed: suffixBlockPerDate });
      checks.push({ ruleId: FLIGHT_RULE_ID, passed: flightCheck.passed, evidence: flightCheck.evidence });
      if (!flightCheck.passed) violations.push(flightHoursViolation(flightCheck.evidence));
      const timeline = [...duties, { report: split.suffixReportUtc, release: split.suffixReleaseUtc }].sort((a, b) =>
        a.report < b.report ? -1 : 1,
      );
      let restPassed = true;
      const gaps: unknown[] = [];
      for (let i = 0; i + 1 < timeline.length; i++) {
        const gap = checkRest(timeline[i].release, timeline[i + 1].report);
        gaps.push(gap.evidence);
        if (!gap.passed) {
          restPassed = false;
          violations.push({
            ruleId: REST_RULE_ID,
            message: gap.evidence.violation ?? `${REST_RULE_ID} breached`,
            actual: gap.evidence.restHours,
            limit: gap.evidence.minimumRestHours,
          });
        }
      }
      checks.push({ ruleId: REST_RULE_ID, passed: restPassed, evidence: { ruleId: REST_RULE_ID, gaps } });
      const qual = checkQualification(crew.ratings, observedTypes);
      checks.push({ ruleId: QUAL_RULE_ID, passed: qual.passed, evidence: qual.evidence });
      if (!qual.passed) {
        violations.push({ ruleId: QUAL_RULE_ID, message: qual.evidence.violation ?? `${QUAL_RULE_ID} breached` });
      }
      const cert = checkCertificationsOnDate(g.certificationsByCrew.get(crew.crewId) ?? [], date);
      checks.push({ ruleId: CERT_RULE_ID, passed: cert.passed, evidence: cert.evidence });
      if (!cert.passed) {
        violations.push({
          ruleId: CERT_RULE_ID,
          message: cert.evidence.violation ?? `${CERT_RULE_ID} breached`,
          details: { dutyDate: date, expired: cert.evidence.expired },
        });
      }
      if (isReserve) {
        const reserve = g.reserveByCrew.get(crew.crewId);
        const windowOk =
          reserve !== undefined &&
          reserve.dates.includes(date) &&
          isTimeInWindow(
            split.suffixReportUtc.slice(11, 16),
            reserve.oncallWindowUtc.start,
            reserve.oncallWindowUtc.end,
          );
        checks.push({
          ruleId: BASE_RULE_ID,
          passed: windowOk,
          evidence: { ruleId: BASE_RULE_ID, suffixReportUtc: split.suffixReportUtc, windowOk },
        });
        if (!windowOk) {
          violations.push({ ruleId: BASE_RULE_ID, message: `${BASE_RULE_ID} breached: suffix report outside reserve window` });
        }
      } else {
        checks.push({
          ruleId: BASE_RULE_ID,
          passed: true,
          evidence: { ruleId: BASE_RULE_ID, applicable: false, reason: "line assignment, not a reserve callout" },
        });
      }
      if (violations.length > 0) continue;
      const kind = isReserve ? "reserve" : "dayoff";
      const cost = priceCover(crew, kind, g.costs, {});
      options.push({
        crewId: crew.crewId,
        kind,
        legality: { legal: true, crewId: crew.crewId, pairingId, asReserve: isReserve, violations, checks },
        costTotal: cost.total,
        delayHours: 0,
      });
    }
    options.sort((a, b) => a.costTotal - b.costTotal || (a.crewId < b.crewId ? -1 : 1));
    if (options.length > 0) suffixTotalCost += options[0].costTotal;
    suffixCovers.push({ role, options });
  }

  return {
    pairingId,
    date,
    delayMinutes,
    feasiblePrefixLegs,
    prefixFdpHours,
    prefixFdpLimit: fullFdp.evidence.limitHours,
    fullDayIllegal: !fullFdp.passed,
    suffixFlights: split.suffixFlights.map((s) => s.flightId),
    suffixReportUtc: split.suffixReportUtc,
    suffixReleaseUtc: split.suffixReleaseUtc,
    suffixCovers,
    suffixTotalCost,
  };
}
