/**
 * analyzeDisruption — typed event in, structured impact assessment out.
 * Delegates entirely to Step-3 impact/simulation primitives plus the
 * Step-2 legality engine; the tool adds routing, summaries, and evidence
 * shaping only. No legality or cost figure is produced here by hand.
 */

import type { CertificationType, CrewRank } from "../domain/types.js";
import type { OperationalGraph } from "../data/graph.js";
import { compareUtc, isWithin, parseDate } from "../data/time.js";
import { breakdown, cancellationComponent, type CostBreakdown } from "../recovery/cost.js";
import { assessStationClosure, planPartialDayRecovery, solveCrewCover, type CoverSolution, type PartialDayPlan } from "../recovery/recovery.js";
import { allocateJoint, type JointPlan } from "../recovery/allocation.js";
import { rotationDownstream } from "../recovery/simulation.js";
import { certImpact, propagateCrewImpact } from "../recovery/impact.js";
import { checkCrewAssignmentLegality } from "../rules/assignment.js";
import { checkCertificationsOnDate } from "../rules/certification.js";
import { analyzeDelay, type DelayData } from "./delay.js";
import { collectLegalityEvidence } from "./evidence.js";
import { fail, ok, type EvidenceItem, type ToolEvent, type ToolResult } from "./types.js";

export type DisruptionAnalysisData =
  | { kind: "crew"; pairingId: string; role: CrewRank; flights: string[]; dates: string[] }
  | DelayData
  | StationClosureData
  | CertificationExpiryData
  | MultiSickData;

export interface StationAffectedFlight {
  flightId: string;
  date: string;
  origin: string;
  destination: string;
  scheduledDepartureUtc: string;
  scheduledArrivalUtc: string;
  reasons: Array<"DEPARTURE_IN_CLOSURE" | "ARRIVAL_IN_CLOSURE">;
  minimumDelayMinutes: number;
  rotationAppliedDelayMinutes: number;
}

export interface StationClosureData {
  kind: "station";
  station: string;
  closureWindow: { startUtc: string; endUtc: string; boundarySemantics: "[startUtc, endUtc)" };
  /** Preserved for callers of the pre-Tier-2C contract. */
  affectedFlights: string[];
  affectedFlightDetails: StationAffectedFlight[];
  affectedPairings: Array<{
    pairingId: string;
    affectedFlightCount: number;
    days: Array<{ date: string; affectedFlightIds: string[]; multipleFlightsInDuty: boolean }>;
    recoveryRequired: boolean;
  }>;
  affectedCrew: Array<{ crewId: string; roles: string[]; pairingIds: string[] }>;
  operationalConsequences: Array<{
    flightId: string;
    pairingIds: string[];
    crewIds: string[];
    canOperateAsPlanned: false;
    canOperateWithModeledDelay: boolean;
    modeledAction: "DELAY_TO_REOPENING";
    minimumDelayMinutes: number;
    rotationAppliedDelayMinutes: number;
    subsequentFlightsImpacted: string[];
  }>;
  /** Preserved for callers of the pre-Tier-2C contract. */
  illegalDays: Array<{ pairingId: string; date: string }>;
  recoveryRequired: boolean;
  recoveryRequirements: Array<{
    pairingId: string;
    date: string;
    delayMinutes: number;
    partial?: PartialDayPlan;
    fullRecrew: Array<{ role: string; solution: CoverSolution }>;
    recoveryAvailable: boolean;
    reason: string;
    cancellationFallback: { flightIds: string[]; cost: CostBreakdown };
    recommended?: { strategy: "partial" | "full" | "cancel"; totalCost: number };
  }>;
  cancellationFallback: { flightIds: string[]; cost: CostBreakdown };
}

export interface CertificationExpiryData {
  kind: "cert";
  crewId: string;
  crewRole: CrewRank;
  effectiveDate: string;
  certificationType?: CertificationType;
  /** Every rostered duty inspected from the requested operational date onward. */
  inspectedAssignments: Array<{
    pairingId: string;
    dutyDate: string;
    flightIds: string[];
    aircraftTypes: string[];
    certificationLegal: boolean;
    expired: CertificationType[];
  }>;
  affected: Array<{
    pairingId: string;
    dutyDate: string;
    flightIds: string[];
    aircraftTypes: string[];
    role: CrewRank;
    expired: CertificationType[];
    certifications: Array<{ certType: CertificationType; validTo: string; valid: boolean }>;
    legality: ReturnType<typeof checkCrewAssignmentLegality>;
    recoveryRequired: true;
    recoveryAvailable: boolean;
    reason: string;
    recovery: CoverSolution;
    cancellationFallback: { flightIds: string[]; cost: CostBreakdown };
  }>;
  recoveryRequired: boolean;
  recoveryAvailable: boolean;
}

export interface MultiSickData {
  kind: "multi";
  /** Compatibility summary; the joint plan below is the authoritative result. */
  analyses: Array<{ kind: "crew"; pairingId: string; role: CrewRank; flights: string[]; dates: string[] }>;
  disruptions: Array<{
    crewId: string;
    pairingId: string;
    role: CrewRank;
    dutyDates: string[];
    flightIds: string[];
    aircraftTypes: string[];
    recovery: CoverSolution;
    selected: JointPlan["assignments"][number];
  }>;
  affectedPairings: Array<{ pairingId: string; affectedCrewIds: string[]; affectedFlightIds: string[]; dutyDates: string[] }>;
  affectedFlights: string[];
  /** Legal cover candidates that competed for more than one recovery need. */
  sharedCandidateConflicts: Array<{ crewId: string; pairingIds: string[] }>;
  jointPlan: JointPlan;
  complete: boolean;
}

function stationExists(g: OperationalGraph, station: string): boolean {
  return g.flightsByOrigin.has(station) || g.flightsByDestination.has(station);
}

function sortFlightIds(g: OperationalGraph, ids: Iterable<string>): string[] {
  return [...new Set(ids)].sort((a, b) => {
    const left = g.flightById.get(a);
    const right = g.flightById.get(b);
    if (left && right) return compareUtc(left.depUtc, right.depUtc) || a.localeCompare(b);
    return a.localeCompare(b);
  });
}

/**
 * Tier 2C composition only: closure matching/timing comes from the locked
 * impact primitive; legality, recovery, and all cost values come from their
 * existing engines. This function only creates the tool-facing consequence
 * graph and never mutates the operational graph.
 */
function analyzeStationClosure(
  g: OperationalGraph,
  event: Extract<ToolEvent, { type: "STATION_CLOSURE" }>,
): { data: StationClosureData; evidence: EvidenceItem[]; summary: string; warnings: string[] } {
  if (!stationExists(g, event.station)) throw new Error(`unknown station ${event.station}`);
  if (compareUtc(event.startUtc, event.endUtc) >= 0) {
    throw new Error("closure startUtc must be before endUtc");
  }

  const assessment = assessStationClosure(g, event.station, event.startUtc, event.endUtc);
  const assessmentsByFlight = new Map(assessment.impact.assessments.map((item) => [item.flightId, item]));
  const affectedFlightDetails = [...assessment.impact.affectedFlights]
    .sort((a, b) => compareUtc(a.depUtc, b.depUtc) || a.flightId.localeCompare(b.flightId))
    .map((flight) => {
      const reasons: StationAffectedFlight["reasons"] = [];
      if (flight.depStation === event.station && isWithin(flight.depUtc, event.startUtc, event.endUtc)) {
        reasons.push("DEPARTURE_IN_CLOSURE");
      }
      if (flight.arrStation === event.station && isWithin(flight.arrUtc, event.startUtc, event.endUtc)) {
        reasons.push("ARRIVAL_IN_CLOSURE");
      }
      const item = assessmentsByFlight.get(flight.flightId);
      return {
        flightId: flight.flightId,
        date: flight.date,
        origin: flight.depStation,
        destination: flight.arrStation,
        scheduledDepartureUtc: flight.depUtc,
        scheduledArrivalUtc: flight.arrUtc,
        reasons,
        minimumDelayMinutes: item?.shiftMinutes ?? 0,
        rotationAppliedDelayMinutes: item?.appliedShiftMinutes ?? 0,
      };
    });

  const illegalDayKeys = new Set(
    assessment.dayAssessments.filter((day) => !day.fdpLegal).map((day) => `${day.pairingId}|${day.date}`),
  );
  const pairingState = new Map<string, { flightIds: Set<string>; days: Map<string, Set<string>> }>();
  const crewState = new Map<string, { roles: Set<string>; pairingIds: Set<string> }>();
  const warnings: string[] = [
    "Closure modeling is limited to the existing delay-to-reopening, crew-legality, and recovery primitives; rerouting, airport capacity, and aircraft swaps are not modeled.",
  ];

  for (const detail of affectedFlightDetails) {
    const pairings = g.pairingsByFlight.get(detail.flightId) ?? [];
    if (pairings.length === 0) {
      warnings.push(`${detail.flightId} has no rostered pairing; crew consequence unavailable.`);
      continue;
    }
    for (const pairing of pairings) {
      const day = pairing.days.find((candidate) => candidate.flights.includes(detail.flightId));
      if (!day) {
        warnings.push(`${detail.flightId} has no rostered duty day in ${pairing.pairingId}.`);
        continue;
      }
      const state = pairingState.get(pairing.pairingId) ?? { flightIds: new Set<string>(), days: new Map<string, Set<string>>() };
      state.flightIds.add(detail.flightId);
      const dayFlights = state.days.get(day.date) ?? new Set<string>();
      dayFlights.add(detail.flightId);
      state.days.set(day.date, dayFlights);
      pairingState.set(pairing.pairingId, state);
      for (const assignment of pairing.crew) {
        const crew = crewState.get(assignment.crewId) ?? { roles: new Set<string>(), pairingIds: new Set<string>() };
        crew.roles.add(assignment.role);
        crew.pairingIds.add(pairing.pairingId);
        crewState.set(assignment.crewId, crew);
      }
    }
  }

  const affectedPairings = [...pairingState.entries()]
    .map(([pairingId, state]) => ({
      pairingId,
      affectedFlightCount: state.flightIds.size,
      days: [...state.days.entries()]
        .map(([date, ids]) => {
          const affectedFlightIds = sortFlightIds(g, ids);
          return { date, affectedFlightIds, multipleFlightsInDuty: affectedFlightIds.length > 1 };
        })
        .sort((a, b) => a.date.localeCompare(b.date)),
      recoveryRequired: [...state.days.keys()].some((date) => illegalDayKeys.has(`${pairingId}|${date}`)),
    }))
    .sort((a, b) => a.pairingId.localeCompare(b.pairingId));
  const affectedCrew = [...crewState.entries()]
    .map(([crewId, state]) => ({
      crewId,
      roles: [...state.roles].sort(),
      pairingIds: [...state.pairingIds].sort(),
    }))
    .sort((a, b) => a.crewId.localeCompare(b.crewId));

  const operationalConsequences = affectedFlightDetails.map((detail) => {
    const pairingIds = [...(g.pairingsByFlight.get(detail.flightId) ?? [])].map((pairing) => pairing.pairingId).sort();
    const crews = new Set<string>();
    for (const pairingId of pairingIds) {
      for (const assignment of g.pairingById.get(pairingId)?.crew ?? []) crews.add(assignment.crewId);
    }
    const item = assessmentsByFlight.get(detail.flightId);
    const subsequent = new Set<string>();
    for (const flightId of rotationDownstream(g, detail.flightId)) if (flightId !== detail.flightId) subsequent.add(flightId);
    return {
      flightId: detail.flightId,
      pairingIds,
      crewIds: [...crews].sort(),
      canOperateAsPlanned: false as const,
      canOperateWithModeledDelay: item?.fdpLegal ?? false,
      modeledAction: "DELAY_TO_REOPENING" as const,
      minimumDelayMinutes: detail.minimumDelayMinutes,
      rotationAppliedDelayMinutes: detail.rotationAppliedDelayMinutes,
      subsequentFlightsImpacted: sortFlightIds(g, subsequent),
    };
  });

  const recoveryRequirements: StationClosureData["recoveryRequirements"] = [];
  for (const dayAssessment of assessment.dayAssessments.filter((day) => !day.fdpLegal)) {
    const pairing = g.pairingById.get(dayAssessment.pairingId);
    const day = pairing?.days.find((candidate) => candidate.date === dayAssessment.date);
    if (!pairing || !day) {
      warnings.push(`${dayAssessment.pairingId}|${dayAssessment.date}: cannot form recovery request from missing roster data.`);
      continue;
    }
    const partial = day.flights.length >= 2
      ? planPartialDayRecovery(g, pairing.pairingId, day.date, dayAssessment.shiftMinutes)
      : undefined;
    const fullRecrew = [...new Set(pairing.crew.map((member) => member.role))].map((role) => {
      const holder = pairing.crew.find((member) => member.role === role)?.crewId ?? "";
      return {
        role,
        solution: solveCrewCover(g, {
          pairingId: pairing.pairingId,
          role,
          sickCrewId: holder,
          delayMinutes: dayAssessment.shiftMinutes,
        }),
      };
    });
    const partialAvailable = partial !== undefined && partial.suffixCovers.every((cover) => cover.options.length > 0);
    const fullOptions = fullRecrew
      .map((entry) => entry.solution.ranked.find((option) => option.kind === "cover"))
      .filter((option): option is NonNullable<typeof option> => option !== undefined);
    const fullAvailable = fullOptions.length === fullRecrew.length;
    const fullCost = fullAvailable ? breakdown(g.costs, fullOptions.flatMap((option) => option.cost.components)) : undefined;
    const cancelFlightIds = sortFlightIds(g, partial?.suffixFlights ?? day.flights);
    const cancellationFallback = {
      flightIds: cancelFlightIds,
      cost: breakdown(g.costs, [cancellationComponent(cancelFlightIds.length, g.costs)]),
    };
    const recommended = partialAvailable && (fullCost === undefined || (partial?.suffixTotalCost ?? 0) <= fullCost.total)
      ? { strategy: "partial" as const, totalCost: partial?.suffixTotalCost ?? 0 }
      : fullCost !== undefined
        ? { strategy: "full" as const, totalCost: fullCost.total }
        : { strategy: "cancel" as const, totalCost: cancellationFallback.cost.total };
    const recoveryAvailable = partialAvailable || fullAvailable;
    if (!recoveryAvailable) warnings.push(`${pairing.pairingId}|${day.date}: no legal crew recovery; cancellation fallback priced.`);
    recoveryRequirements.push({
      pairingId: pairing.pairingId,
      date: day.date,
      delayMinutes: dayAssessment.shiftMinutes,
      partial,
      fullRecrew,
      recoveryAvailable,
      reason: recoveryAvailable
        ? "Closure delay makes the rostered duty FDP-illegal; existing recovery options evaluated."
        : "Closure delay makes the rostered duty FDP-illegal and no legal crew recovery was found.",
      cancellationFallback,
      recommended,
    });
  }
  recoveryRequirements.sort((a, b) => a.pairingId.localeCompare(b.pairingId) || a.date.localeCompare(b.date));
  const cancellationFlightIds = sortFlightIds(g, recoveryRequirements.flatMap((requirement) => requirement.cancellationFallback.flightIds));
  const cancellationFallback = {
    flightIds: cancellationFlightIds,
    cost: breakdown(g.costs, [cancellationComponent(cancellationFlightIds.length, g.costs)]),
  };

  const evidence: EvidenceItem[] = affectedFlightDetails.map((detail) => ({
    flightId: detail.flightId,
    timestamps: { scheduledDepartureUtc: detail.scheduledDepartureUtc, scheduledArrivalUtc: detail.scheduledArrivalUtc },
    reason: `${detail.reasons.join(" + ")}; minimum delay ${detail.minimumDelayMinutes}min`,
  }));
  for (const day of assessment.dayAssessments) {
    evidence.push({
      ruleId: "RULE-FDP-01",
      passed: day.fdpLegal,
      actual: day.dutyHoursAfter,
      limit: day.fdpLimitHours,
      pairingId: day.pairingId,
      reason: `closure shift +${day.shiftMinutes}min: duty ${day.dutyHoursAfter}h vs ${day.fdpLimitHours}h`,
    });
  }
  for (const requirement of recoveryRequirements) {
    for (const recovery of requirement.fullRecrew) {
      const selected = recovery.solution.ranked.find((option) => option.kind === "cover");
      if (selected?.legality) evidence.push(...collectLegalityEvidence(selected.legality));
    }
  }
  if (cancellationFallback.flightIds.length > 0) {
    evidence.push({ cost: cancellationFallback.cost, reason: `cancellation fallback for ${cancellationFallback.flightIds.length} flight(s)` });
  }

  const illegalDays = assessment.dayAssessments
    .filter((day) => !day.fdpLegal)
    .map((day) => ({ pairingId: day.pairingId, date: day.date }));
  return {
    summary: `${event.station} closed ${event.startUtc}–${event.endUtc}: ${affectedFlightDetails.length} flight(s) affected, ${illegalDays.length} crew-day(s) require recovery`,
    data: {
      kind: "station",
      station: event.station,
      closureWindow: { startUtc: event.startUtc, endUtc: event.endUtc, boundarySemantics: "[startUtc, endUtc)" },
      affectedFlights: affectedFlightDetails.map((detail) => detail.flightId),
      affectedFlightDetails,
      affectedPairings,
      affectedCrew,
      operationalConsequences,
      illegalDays,
      recoveryRequired: recoveryRequirements.length > 0,
      recoveryRequirements,
      cancellationFallback,
    },
    evidence,
    warnings,
  };
}

/**
 * Tier 2D composition over the locked certification, assignment, candidate,
 * and cost engines.  It deliberately does not decide validity or price a
 * recovery itself: it preserves those engine outputs for callers.
 */
function analyzeCertificationExpiry(
  g: OperationalGraph,
  event: Extract<ToolEvent, { type: "CERT_EXPIRY" }>,
): { data: CertificationExpiryData; evidence: EvidenceItem[]; summary: string; warnings: string[] } {
  const crew = g.crewById.get(event.crewId);
  if (!crew) throw new Error(`unknown crew ${event.crewId}`);
  parseDate(event.dutyDate);
  const certs = g.certificationsByCrew.get(event.crewId) ?? [];
  const requestedType = event.certificationType as CertificationType | undefined;
  if (requestedType && !certs.some((cert) => cert.certType === requestedType)) {
    throw new Error(`unknown certification ${event.certificationType} for crew ${event.crewId}`);
  }

  const inspectedAssignments = (g.pairingsByCrew.get(event.crewId) ?? [])
    .flatMap((pairing) => pairing.days
      .filter((day) => day.date >= event.dutyDate)
      .map((day) => {
        const check = checkCertificationsOnDate(certs, day.date);
        const selected = requestedType
          ? check.evidence.certs.filter((cert) => cert.certType === requestedType)
          : check.evidence.certs;
        return {
          pairingId: pairing.pairingId,
          dutyDate: day.date,
          flightIds: sortFlightIds(g, day.flights),
          aircraftTypes: [...new Set(day.flights.map((id) => g.flightById.get(id)?.aircraftType).filter((type): type is Exclude<typeof type, undefined> => type !== undefined))].sort(),
          certificationLegal: selected.every((cert) => cert.valid),
          expired: selected.filter((cert) => !cert.valid).map((cert) => cert.certType),
        };
      }))
    .sort((a, b) => a.dutyDate.localeCompare(b.dutyDate) || a.pairingId.localeCompare(b.pairingId));

  // Keep the existing impact primitive as the source of expiry fan-out, then
  // apply the optional event filter only to the already-derived expired types.
  const impact = certImpact(g, event.crewId, event.dutyDate);
  const affected = impact.affected
    .filter((assignment) => !requestedType || assignment.expired.includes(requestedType))
    .sort((a, b) => a.dutyDate.localeCompare(b.dutyDate) || a.pairingId.localeCompare(b.pairingId))
    .flatMap((assignment) => {
      const pairing = g.pairingById.get(assignment.pairingId);
      const day = pairing?.days.find((candidate) => candidate.date === assignment.dutyDate);
      const role = pairing?.crew.find((member) => member.crewId === event.crewId)?.role;
      if (!pairing || !day || !role) return [];
      const certification = checkCertificationsOnDate(certs, day.date);
      const selectedCerts = (requestedType
        ? certification.evidence.certs.filter((cert) => cert.certType === requestedType)
        : certification.evidence.certs)
        .map((cert) => ({ certType: cert.certType, validTo: cert.validTo, valid: cert.valid }));
      const legality = checkCrewAssignmentLegality(g, event.crewId, pairing.pairingId);
      const recovery = solveCrewCover(g, { pairingId: pairing.pairingId, role, sickCrewId: event.crewId });
      const cancellation = recovery.ranked.find((option) => option.kind === "cancel");
      if (!cancellation) throw new Error(`missing cancellation fallback for ${pairing.pairingId}`);
      const recoveryAvailable = recovery.ranked.some((option) => option.kind === "cover");
      return [{
        pairingId: pairing.pairingId,
        dutyDate: day.date,
        flightIds: sortFlightIds(g, day.flights),
        aircraftTypes: [...new Set(day.flights.map((id) => g.flightById.get(id)?.aircraftType).filter((type): type is Exclude<typeof type, undefined> => type !== undefined))].sort(),
        role,
        expired: selectedCerts.filter((cert) => !cert.valid).map((cert) => cert.certType),
        certifications: selectedCerts,
        legality,
        recoveryRequired: true as const,
        recoveryAvailable,
        reason: recoveryAvailable
          ? "Certification-invalid assignment requires a legal replacement."
          : "No legal replacement crew found; cancellation fallback is available.",
        recovery,
        cancellationFallback: { flightIds: cancellation.affectedFlights, cost: cancellation.cost },
      }];
    });

  const warnings = affected
    .filter((assignment) => !assignment.recoveryAvailable)
    .map((assignment) => `${assignment.pairingId}|${assignment.dutyDate}: no legal replacement crew found; cancellation fallback priced.`);
  const evidence: EvidenceItem[] = [];
  for (const assignment of affected) {
    for (const cert of assignment.certifications.filter((item) => !item.valid)) {
      evidence.push({
        ruleId: "RULE-CERT-06",
        passed: false,
        crewId: event.crewId,
        pairingId: assignment.pairingId,
        reason: `${cert.certType} valid through ${cert.validTo}; invalid on duty date ${assignment.dutyDate}`,
        details: { certificationType: cert.certType, validTo: cert.validTo, dutyDate: assignment.dutyDate, flightIds: assignment.flightIds },
      });
    }
    evidence.push(...collectLegalityEvidence(assignment.legality));
    const selected = assignment.recovery.ranked.find((option) => option.kind === "cover");
    if (selected?.legality) evidence.push(...collectLegalityEvidence(selected.legality));
    evidence.push({ pairingId: assignment.pairingId, cost: assignment.cancellationFallback.cost, reason: `cancellation fallback for ${assignment.flightIds.length} flight(s)` });
  }
  return {
    summary: `${event.crewId}: ${affected.length} certification-invalid assignment(s) on/after ${event.dutyDate}`,
    data: {
      kind: "cert",
      crewId: event.crewId,
      crewRole: crew.rank,
      effectiveDate: event.dutyDate,
      certificationType: requestedType,
      inspectedAssignments,
      affected,
      recoveryRequired: affected.length > 0,
      recoveryAvailable: affected.length > 0 && affected.every((assignment) => assignment.recoveryAvailable),
    },
    evidence,
    warnings,
  };
}

/** Tier 2E composition over the locked exhaustive joint allocator. */
function analyzeMultiSick(
  g: OperationalGraph,
  event: Extract<ToolEvent, { type: "MULTI_SICK" }>,
): { data: MultiSickData; evidence: EvidenceItem[]; summary: string; warnings: string[] } {
  if (event.events.length < 2) throw new Error("MULTI_SICK requires at least two unavailable crew events");
  const seenCrew = new Set<string>();
  for (const disruption of event.events) {
    if (!g.crewById.has(disruption.crewId)) throw new Error(`unknown crew ${disruption.crewId}`);
    if (seenCrew.has(disruption.crewId)) throw new Error(`duplicate unavailable crew ${disruption.crewId}`);
    seenCrew.add(disruption.crewId);
    if (!g.pairingById.has(disruption.pairingId)) throw new Error(`unknown pairing ${disruption.pairingId}`);
  }

  const impacts = event.events.map((disruption) => ({ disruption, impact: propagateCrewImpact(g, disruption.crewId, disruption.pairingId) }));
  const jointPlan = allocateJoint(g, impacts.map(({ disruption, impact }) => ({
    pairingId: disruption.pairingId,
    role: impact.role,
    sickCrewId: disruption.crewId,
    reportedUtc: disruption.reportedUtc,
  })));
  const pairingState = new Map<string, { crewIds: Set<string>; flightIds: Set<string>; dates: Set<string> }>();
  const candidatePairings = new Map<string, Set<string>>();
  const disruptions = impacts.map(({ disruption, impact }, index) => {
    const state = pairingState.get(impact.pairingId) ?? { crewIds: new Set<string>(), flightIds: new Set<string>(), dates: new Set<string>() };
    state.crewIds.add(disruption.crewId);
    for (const flight of impact.flights) state.flightIds.add(flight.flightId);
    for (const date of impact.dates) state.dates.add(date);
    pairingState.set(impact.pairingId, state);
    const recovery = jointPlan.perDisruption[index];
    for (const option of recovery.ranked) {
      if (option.kind !== "cover" || !option.crewId) continue;
      const pairings = candidatePairings.get(option.crewId) ?? new Set<string>();
      pairings.add(impact.pairingId);
      candidatePairings.set(option.crewId, pairings);
    }
    return {
      crewId: disruption.crewId,
      pairingId: impact.pairingId,
      role: impact.role,
      dutyDates: [...impact.dates].sort(),
      flightIds: sortFlightIds(g, impact.flights.map((flight) => flight.flightId)),
      aircraftTypes: [...new Set(impact.flights.map((flight) => flight.aircraftType))].sort(),
      recovery,
      selected: jointPlan.assignments[index],
    };
  });
  const affectedPairings = [...pairingState.entries()]
    .map(([pairingId, state]) => ({
      pairingId,
      affectedCrewIds: [...state.crewIds].sort(),
      affectedFlightIds: sortFlightIds(g, state.flightIds),
      dutyDates: [...state.dates].sort(),
    }))
    .sort((a, b) => a.pairingId.localeCompare(b.pairingId));
  const affectedFlights = sortFlightIds(g, affectedPairings.flatMap((pairing) => pairing.affectedFlightIds));
  const sharedCandidateConflicts = [...candidatePairings.entries()]
    .filter(([, pairings]) => pairings.size > 1)
    .map(([crewId, pairings]) => ({ crewId, pairingIds: [...pairings].sort() }))
    .sort((a, b) => a.crewId.localeCompare(b.crewId));
  const complete = jointPlan.assignments.length === event.events.length;
  const warnings = disruptions
    .filter((disruption) => disruption.selected.kind === "cancel")
    .map((disruption) => `${disruption.pairingId}: no jointly selected crew cover; cancellation fallback selected.`);
  const evidence: EvidenceItem[] = [];
  for (const disruption of disruptions) {
    for (const option of disruption.recovery.ranked) if (option.legality) evidence.push(...collectLegalityEvidence(option.legality));
    for (const rejected of disruption.recovery.rejected) {
      for (const violation of rejected.violations) evidence.push({
        ruleId: violation.ruleId,
        passed: false,
        crewId: rejected.crewId,
        pairingId: disruption.pairingId,
        reason: violation.message,
        details: violation.details,
      });
    }
    const selectedOption = disruption.recovery.ranked.find((option) => option.crewId === disruption.selected.crewId && option.kind === disruption.selected.kind);
    if (selectedOption) evidence.push({ crewId: selectedOption.crewId, pairingId: disruption.pairingId, cost: selectedOption.cost, reason: `jointly selected ${selectedOption.kind}` });
  }
  evidence.push({ cost: { currency: g.costs.currency, total: jointPlan.totalCost, components: [] }, reason: `joint total across ${jointPlan.assignments.length} disruption(s)` });
  return {
    summary: `${event.events.length} simultaneous sick calls: ${complete ? "complete joint recovery" : "incomplete joint recovery"} at ${jointPlan.totalCost} ${g.costs.currency}`,
    data: {
      kind: "multi",
      analyses: disruptions.map((disruption) => ({ kind: "crew", pairingId: disruption.pairingId, role: disruption.role, flights: disruption.flightIds, dates: disruption.dutyDates })),
      disruptions,
      affectedPairings,
      affectedFlights,
      sharedCandidateConflicts,
      jointPlan,
      complete,
    },
    evidence,
    warnings,
  };
}

function analyzeOne(
  g: OperationalGraph,
  event: Exclude<ToolEvent, { type: "DELAY" }>,
): { data: DisruptionAnalysisData; evidence: EvidenceItem[]; summary: string; warnings?: string[] } {
  switch (event.type) {
    case "SICK_CREW": {
      const impact = propagateCrewImpact(g, event.crewId, event.pairingId);
      return {
        summary: `${event.crewId} (${impact.role}) unavailable: ${impact.pairingId} uncovered, ${impact.flights.length} flight(s)`,
        data: {
          kind: "crew",
          pairingId: impact.pairingId,
          role: impact.role,
          flights: impact.flights.map((f) => f.flightId),
          dates: impact.dates,
        },
        evidence: [{ crewId: event.crewId, pairingId: event.pairingId, reason: `vacated role ${impact.role}` }],
      };
    }
    case "STATION_CLOSURE": {
      return analyzeStationClosure(g, event);
    }
    case "CERT_EXPIRY": {
      return analyzeCertificationExpiry(g, event);
    }
    case "MULTI_SICK": {
      return analyzeMultiSick(g, event);
    }
  }
}

export function analyzeDisruption(g: OperationalGraph, event: ToolEvent): ToolResult<DisruptionAnalysisData> {
  try {
    if (event.type === "DELAY") {
      return analyzeDelay(g, event) as ToolResult<DisruptionAnalysisData>;
    }
    const { summary, data, evidence, warnings } = analyzeOne(g, event);
    return ok("DISRUPTION_ANALYSIS", summary, data, evidence, warnings);
  } catch (e) {
    return fail("DISRUPTION_ANALYSIS", "analysis failed", e instanceof Error ? e.message : String(e));
  }
}
