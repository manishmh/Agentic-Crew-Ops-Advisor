/**
 * Narrow HTTP-facing adapter for the deterministic CrewOps tools.
 * It interprets only the supported deterministic query wording and carries values from
 * the orchestration/recovery layers forward without recalculating them.
 */
import type { OperationalGraph } from "../data/graph.js";
import { analyzeSickCrew } from "../orchestration/sickCrew.js";
import { analyzeDelay } from "../orchestration/delay.js";
import { analyzeDisruption, type CertificationExpiryData, type MultiSickData, type StationClosureData } from "../orchestration/disruptions.js";
import type { RecoveryOption } from "../recovery/types.js";
import type { EvidenceItem } from "../orchestration/types.js";

export interface CrewOpsQueryRequest {
  question: string;
}

export interface CrewOpsQueryFailure {
  success: false;
  error: { code: "INVALID_REQUEST" | "CLARIFICATION_REQUIRED" | "UNSUPPORTED_INTENT" | "ANALYSIS_FAILED"; message: string };
}

export interface CrewOpsQuerySuccess {
  success: true;
  intent: { type: "SICK_CREW" | "DELAY" | "STATION_CLOSURE" | "CERT_EXPIRY" | "MULTI_SICK"; interpreted: string };
  entities: Record<string, unknown>;
  summary: string;
  consequences: {
    recoveryRequired: boolean;
    affectedPairings: Array<{
      pairingId: string;
      role?: string;
      dutyDates: string[];
      flightIds: string[];
      aircraftTypes?: string[];
      recoveryAvailable?: boolean;
      noRecoveryReason?: string;
    }>;
    [key: string]: unknown;
  };
  recovery: {
    recommended?: ApiRecoveryOption;
    alternatives: ApiRecoveryOption[];
    rejected: ApiRejectedCandidate[];
    cancellationFallbacks: ApiRecoveryOption[];
    recommendedPlan?: { strategy: "partial" | "full" | "cancel"; totalCost: number };
  };
  evidence: EvidenceItem[];
  warnings: string[];
  assumptions: string[];
}

export type CrewOpsQueryResponse = CrewOpsQuerySuccess | CrewOpsQueryFailure;

export interface ApiRecoveryOption {
  crewId?: string;
  crewName?: string;
  role?: string;
  base?: string;
  kind: "cover" | "cancel";
  method: "reserve" | "dayoff" | "positioning" | "cancellation";
  pairingId: string;
  rank?: number;
  legal?: boolean;
  legalityEvaluated: boolean;
  cost: { currency: string; total: number; components: Array<{ type: string; amount: number; detail?: string }> };
  delayMinutes: number;
  affectedFlightIds: string[];
}

export interface ApiRejectedCandidate {
  crewId: string;
  crewName?: string;
  role?: string;
  legalityEvaluated: boolean;
  reasons: string[];
  violations: Array<{ ruleId: string; message: string; actual?: number; limit?: number; details?: Record<string, unknown> }>;
}

function methodFor(option: RecoveryOption): ApiRecoveryOption["method"] {
  if (option.kind === "cancel") return "cancellation";
  if (option.cost.components.some((component) => component.type === "deadhead")) return "positioning";
  if (option.cost.components.some((component) => component.type === "dayoff_callout")) return "dayoff";
  return "reserve";
}

function adaptOption(graph: OperationalGraph, option: RecoveryOption): ApiRecoveryOption {
  const crew = option.crewId ? graph.crewById.get(option.crewId) : undefined;
  return {
    crewId: option.crewId,
    crewName: crew?.name,
    role: option.role,
    base: crew?.base,
    kind: option.kind,
    method: methodFor(option),
    pairingId: option.pairingId,
    rank: option.rank,
    legal: option.legality?.legal,
    legalityEvaluated: option.legality !== undefined,
    cost: option.cost,
    delayMinutes: Math.round(option.delayHours * 60),
    affectedFlightIds: option.affectedFlights,
  };
}

function extractSickCrew(question: string): string | undefined {
  if (!/\b(?:reports?\s+sick|sick|unavailable)\b/i.test(question)) return undefined;
  return question.match(/\bC-\d{4}\b/i)?.[0].toUpperCase();
}

function extractDelay(question: string): { flightNo: string; delayMinutes: number } | undefined {
  const match = question.match(/\b(?:delay|delayed)\s+(DX\d+)\s+(?:by\s+)?(\d+)\s*(?:minutes?|mins?|m)\b/i);
  if (!match) return undefined;
  const delayMinutes = Number(match[2]);
  return Number.isFinite(delayMinutes) ? { flightNo: match[1].toUpperCase(), delayMinutes } : undefined;
}

function extractStationClosure(question: string, operationalDate: string):
  | { station: string; startUtc: string; endUtc: string; operationalDate: string }
  | undefined {
  const normalized = question.replace(/[–—]/g, "-");
  const match = normalized.match(/\b(?:close|closes|closed|closure)\s+(?:station\s+)?([A-Z]{3})\b[\s\S]*?\b(?:from|between)\s+(\d{1,2}:\d{2})\s*(?:UTC)?\s*(?:to|and|-)\s*(\d{1,2}:\d{2})\s*(?:UTC)?\b/i)
    ?? normalized.match(/\bstation\s+([A-Z]{3})\s+closed\s+(\d{1,2}:\d{2})\s*(?:UTC)?\s*(?:to|and|-)\s*(\d{1,2}:\d{2})\s*(?:UTC)?\b/i)
    ?? normalized.match(/\b([A-Z]{3})\s+(?:closes?|closed)\b[\s\S]*?\b(?:from|between)\s+(\d{1,2}:\d{2})\s*(?:UTC)?\s*(?:to|and|-)\s*(\d{1,2}:\d{2})\s*(?:UTC)?\b/i);
  if (!match) return undefined;
  const dateMatch = normalized.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  const date = dateMatch?.[1] ?? operationalDate;
  const toUtc = (time: string) => {
    const [hour, minute] = time.split(":").map(Number);
    if (hour > 23 || minute > 59) return undefined;
    return `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`;
  };
  const startUtc = toUtc(match[2]);
  const endUtc = toUtc(match[3]);
  return startUtc && endUtc ? { station: match[1].toUpperCase(), startUtc, endUtc, operationalDate: date } : undefined;
}

function extractCertificationExpiry(question: string, operationalDate: string, certificationTypes: string[]):
  | { crewId: string; certificationType?: string; dutyDate: string }
  | undefined {
  const crewId = question.match(/\bC-\d{4}\b/i)?.[0].toUpperCase();
  if (!crewId || !/\b(?:certification|cert|expire[sd]?|expiry|training|legal\s+for\s+duty)\b/i.test(question)) return undefined;
  const normalized = question.toLowerCase().replace(/[\s-]+/g, "_");
  const certificationType = certificationTypes.find((type) => normalized.includes(type.toLowerCase()))
    ?? question.match(/\bcertification\s+type\s+([a-z][a-z_-]*)/i)?.[1]?.trim().replace(/[\s-]+/g, "_")
    ?? question.match(/\b(?:expired?\s+)?([a-z][a-z _-]*?)\s+expir(?:e[sd]?|y)\b/i)?.[1]?.trim().replace(/[\s-]+/g, "_");
  const date = question.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] ?? operationalDate;
  return { crewId, certificationType: certificationType === "certification" ? undefined : certificationType, dutyDate: date };
}

function multiSickRequested(question: string): boolean {
  return /\b(?:simultaneous|two|three|multiple|multi(?:ple)?[- ]crew|recover)\b/i.test(question) && /\b(?:sick|unavailable)\b/i.test(question)
    || (/\bC-\d{4}\b/gi.test(question) && /\b(?:and|,)\b/i.test(question) && /\b(?:sick|unavailable)\b/i.test(question));
}

function extractMultiSick(graph: OperationalGraph, question: string, operationalDate: string):
  | { events: Array<{ crewId: string; pairingId: string; reportedUtc: string }> }
  | { error: string }
  | undefined {
  if (!multiSickRequested(question)) return undefined;
  const crewIds = [...question.matchAll(/\bC-\d{4}\b/gi)].map((match) => match[0].toUpperCase());
  if (crewIds.length < 2) return { error: "MULTI_SICK requires at least two crew IDs." };
  if (new Set(crewIds).size !== crewIds.length) return { error: "MULTI_SICK requires unique crew IDs." };
  if (crewIds.length > 3) return { error: "MULTI_SICK supports two or three crew IDs." };
  const unknownCrew = crewIds.find((crewId) => !graph.crewById.has(crewId));
  if (unknownCrew) return { error: `unknown crew ${unknownCrew}` };
  const explicitDate = question.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  const datesFor = (crewId: string) => new Set((graph.pairingsByCrew.get(crewId) ?? []).flatMap((pairing) => pairing.days.map((day) => day.date)));
  const commonDates = crewIds.map(datesFor).reduce((shared, dates) => new Set([...shared].filter((date) => dates.has(date))), datesFor(crewIds[0]));
  const dutyDate = explicitDate ?? [...commonDates].filter((date) => date >= operationalDate).sort()[0];
  if (!dutyDate) return { error: "No common rostered operational date was found for the requested crew." };
  const events = crewIds.map((crewId) => {
    const pairing = (graph.pairingsByCrew.get(crewId) ?? []).filter((candidate) => candidate.days.some((day) => day.date === dutyDate)).sort((a, b) => a.pairingId.localeCompare(b.pairingId))[0];
    const day = pairing?.days.find((candidate) => candidate.date === dutyDate);
    return pairing && day ? { crewId, pairingId: pairing.pairingId, reportedUtc: day.reportUtc } : undefined;
  });
  return events.every((event): event is NonNullable<typeof event> => event !== undefined) ? { events } : { error: `No rostered pairing was found on ${dutyDate} for every requested crew.` };
}

function delayOption(
  graph: OperationalGraph,
  option: { crewId: string; kind: "reserve" | "dayoff"; costTotal: number; delayHours: number },
  pairingId: string,
  flightIds: string[],
): ApiRecoveryOption {
  const crew = graph.crewById.get(option.crewId);
  return {
    crewId: option.crewId,
    crewName: crew?.name,
    role: crew?.rank,
    base: crew?.base,
    kind: "cover",
    method: option.kind,
    pairingId,
    legal: true,
    legalityEvaluated: true,
    // Partial-day candidates expose a deterministic total but no component
    // breakdown. The adapter deliberately carries that exact primitive value.
    cost: { currency: graph.costs.currency, total: option.costTotal, components: [] },
    delayMinutes: Math.round(option.delayHours * 60),
    affectedFlightIds: flightIds,
  };
}

function adaptStationClosure(
  graph: OperationalGraph,
  data: StationClosureData,
  summary: string,
  evidence: EvidenceItem[],
  warnings: string[],
  operationalDate: string,
): CrewOpsQuerySuccess {
  const requirements = data.recoveryRequirements;
  const coverOptions = requirements.flatMap((requirement) => requirement.fullRecrew
    .flatMap((entry) => entry.solution.ranked.map((option) => adaptOption(graph, option))));
  const rejected = requirements.flatMap((requirement) => requirement.fullRecrew.flatMap((entry) => entry.solution.rejected.map((candidate) => {
    const crew = graph.crewById.get(candidate.crewId);
    return { ...candidate, crewName: crew?.name, role: crew?.rank };
  })));
  const cancellationFallbacks = requirements.map((requirement) => ({
    kind: "cancel" as const,
    method: "cancellation" as const,
    pairingId: requirement.pairingId,
    legalityEvaluated: false,
    cost: requirement.cancellationFallback.cost,
    delayMinutes: 0,
    affectedFlightIds: requirement.cancellationFallback.flightIds,
  }));
  if (cancellationFallbacks.length === 0 && data.cancellationFallback.flightIds.length > 0) {
    cancellationFallbacks.push({ kind: "cancel", method: "cancellation", pairingId: "STATION_CLOSURE", legalityEvaluated: false, cost: data.cancellationFallback.cost, delayMinutes: 0, affectedFlightIds: data.cancellationFallback.flightIds });
  }
  return {
    success: true,
    intent: { type: "STATION_CLOSURE", interpreted: `${data.station} closed ${data.closureWindow.startUtc}–${data.closureWindow.endUtc}` },
    entities: {
      station: data.station,
      operationalDate,
      closureStartUtc: data.closureWindow.startUtc,
      closureEndUtc: data.closureWindow.endUtc,
      boundarySemantics: data.closureWindow.boundarySemantics,
      affectedFlightCount: data.affectedFlightDetails.length,
      affectedPairingCount: data.affectedPairings.length,
      affectedCrewCount: data.affectedCrew.length,
    },
    summary,
    consequences: {
      recoveryRequired: data.recoveryRequired,
      recoveryAvailable: requirements.length === 0 ? undefined : requirements.every((item) => item.recoveryAvailable),
      affectedFlights: data.affectedFlightDetails,
      affectedPairings: data.affectedPairings.map((pairing) => {
        const pairingRequirements = requirements.filter((item) => item.pairingId === pairing.pairingId);
        return {
          pairingId: pairing.pairingId,
          dutyDates: pairing.days.map((day) => day.date),
          flightIds: pairing.days.flatMap((day) => day.affectedFlightIds),
          recoveryAvailable: pairingRequirements.length === 0 ? undefined : pairingRequirements.every((item) => item.recoveryAvailable),
        };
      }),
      affectedCrew: data.affectedCrew,
      operationalConsequences: data.operationalConsequences,
      recoveryRequirements: requirements.map((item) => ({ pairingId: item.pairingId, date: item.date, delayMinutes: item.delayMinutes, recoveryAvailable: item.recoveryAvailable, reason: item.reason, recommended: item.recommended, cancellationFallback: item.cancellationFallback })),
      cancellationFallback: data.cancellationFallback,
    },
    recovery: {
      alternatives: coverOptions.filter((option) => option.kind === "cover"),
      rejected,
      cancellationFallbacks,
      recommendedPlan: requirements.length === 1 ? requirements[0].recommended : undefined,
    },
    evidence,
    warnings,
    assumptions: ["Closure times are UTC. Unqualified closure dates use the application dataset operational date; an ISO date in the question overrides it."],
  };
}

function adaptCertificationExpiry(
  graph: OperationalGraph,
  data: CertificationExpiryData,
  summary: string,
  evidence: EvidenceItem[],
  warnings: string[],
): CrewOpsQuerySuccess {
  const crew = graph.crewById.get(data.crewId);
  const certifications = (graph.certificationsByCrew.get(data.crewId) ?? [])
    .filter((cert) => !data.certificationType || cert.certType === data.certificationType)
    .map((cert) => ({ certType: cert.certType, validTo: cert.validTo }));
  const options = data.affected.flatMap((assignment) => assignment.recovery.ranked.map((option) => adaptOption(graph, option)));
  const rejected = data.affected.flatMap((assignment) => assignment.recovery.rejected.map((candidate) => {
    const candidateCrew = graph.crewById.get(candidate.crewId);
    return { ...candidate, crewName: candidateCrew?.name, role: candidateCrew?.rank };
  }));
  const recommended = options.find((option) => option.kind === "cover" && option.legal === true);
  return {
    success: true,
    intent: { type: "CERT_EXPIRY", interpreted: `${data.crewId} certification expiry assessed from ${data.effectiveDate}` },
    entities: { crewId: data.crewId, crewName: crew?.name, role: data.crewRole, certificationType: data.certificationType, certifications, effectiveDate: data.effectiveDate },
    summary,
    consequences: {
      recoveryRequired: data.recoveryRequired,
      recoveryAvailable: data.recoveryAvailable,
      inspectedDuties: data.inspectedAssignments,
      affectedDuties: data.affected.map((assignment) => ({
        pairingId: assignment.pairingId, dutyDate: assignment.dutyDate, flightIds: assignment.flightIds,
        aircraftTypes: assignment.aircraftTypes, expired: assignment.expired, certifications: assignment.certifications,
        recoveryRequired: assignment.recoveryRequired, recoveryAvailable: assignment.recoveryAvailable, reason: assignment.reason,
      })),
      affectedPairings: data.affected.map((assignment) => ({ pairingId: assignment.pairingId, role: assignment.role, dutyDates: [assignment.dutyDate], flightIds: assignment.flightIds, aircraftTypes: assignment.aircraftTypes, recoveryAvailable: assignment.recoveryAvailable })),
    },
    recovery: {
      recommended,
      alternatives: options.filter((option) => option.kind === "cover" && option !== recommended),
      rejected,
      cancellationFallbacks: data.affected.map((assignment) => ({ kind: "cancel", method: "cancellation", pairingId: assignment.pairingId, legalityEvaluated: false, cost: assignment.cancellationFallback.cost, delayMinutes: 0, affectedFlightIds: assignment.cancellationFallback.flightIds })),
    },
    evidence,
    warnings,
    assumptions: ["Certification records supplied to the deterministic dataset are validated. The model does not infer entirely absent required certification records from a role, aircraft, or operation."],
  };
}

function adaptMultiSick(graph: OperationalGraph, data: MultiSickData, summary: string, evidence: EvidenceItem[], warnings: string[]): CrewOpsQuerySuccess {
  const selectedByPairing = new Map(data.jointPlan.assignments.map((assignment) => [assignment.pairingId, assignment]));
  return {
    success: true,
    intent: { type: "MULTI_SICK", interpreted: `${data.disruptions.length} simultaneous sick calls assessed jointly` },
    entities: { unavailableCrew: data.disruptions.map((disruption) => ({ crewId: disruption.crewId, crewName: graph.crewById.get(disruption.crewId)?.name, role: disruption.role })), unavailableCrewCount: data.disruptions.length },
    summary,
    consequences: {
      recoveryRequired: true,
      complete: data.complete,
      affectedPairings: data.affectedPairings.map((pairing) => ({ pairingId: pairing.pairingId, dutyDates: pairing.dutyDates, flightIds: pairing.affectedFlightIds })),
      affectedFlights: data.affectedFlights,
      disruptions: data.disruptions.map((disruption) => {
        const selected = selectedByPairing.get(disruption.pairingId);
        const selectedOption = selected && disruption.recovery.ranked.find((option) => option.crewId === selected.crewId && option.kind === selected.kind);
        const replacement = selected?.crewId ? graph.crewById.get(selected.crewId) : undefined;
        return { crewId: disruption.crewId, crewName: graph.crewById.get(disruption.crewId)?.name, role: disruption.role, pairingId: disruption.pairingId, dutyDates: disruption.dutyDates, flightIds: disruption.flightIds, aircraftTypes: disruption.aircraftTypes, selected: selected && { ...selected, delayMinutes: Math.round(selected.delayHours * 60), crewName: replacement?.name, role: replacement?.rank, legalityEvaluated: selectedOption?.legality !== undefined, legal: selectedOption?.legality?.legal } };
      }),
      sharedCandidateConflicts: data.sharedCandidateConflicts,
    },
    recovery: { recommended: undefined, alternatives: [], rejected: data.disruptions.flatMap((disruption) => disruption.recovery.rejected.map((candidate) => ({ ...candidate, crewName: graph.crewById.get(candidate.crewId)?.name, role: graph.crewById.get(candidate.crewId)?.rank }))), cancellationFallbacks: data.jointPlan.assignments.filter((assignment) => assignment.kind === "cancel").map((assignment) => ({ kind: "cancel", method: "cancellation", pairingId: assignment.pairingId, legalityEvaluated: false, cost: { currency: graph.costs.currency, total: assignment.costTotal, components: [] }, delayMinutes: Math.round(assignment.delayHours * 60), affectedFlightIds: data.disruptions.find((disruption) => disruption.pairingId === assignment.pairingId)?.flightIds ?? [] })) },
    evidence,
    warnings,
    assumptions: ["Recovery assignments are evaluated jointly by the deterministic allocator to avoid conflicting crew assignments."],
  };
}

export function createCrewOpsQueryService(graph: OperationalGraph) {
  // The API has no date field by design. Match the application snapshot by
  // resolving an unqualified closure to the first operational date in the
  // loaded deterministic dataset; callers can provide an ISO date explicitly.
  const operationalDate = graph.flights.map((flight) => flight.date).sort()[0];
  return {
    query(request: CrewOpsQueryRequest): CrewOpsQueryResponse {
      if (!request || typeof request.question !== "string" || request.question.trim().length === 0) {
        return { success: false, error: { code: "INVALID_REQUEST", message: "question must be a non-empty string" } };
      }
      const multi = extractMultiSick(graph, request.question, operationalDate);
      if (multi) {
        if ("error" in multi) return { success: false, error: { code: "INVALID_REQUEST", message: multi.error } };
        const result = analyzeDisruption(graph, { type: "MULTI_SICK", events: multi.events });
        if (!result.success || result.data.kind !== "multi") return { success: false, error: { code: "ANALYSIS_FAILED", message: result.success ? "multi-sick analysis returned an unexpected result" : (result.error ?? result.summary) } };
        return adaptMultiSick(graph, result.data, result.summary, result.evidence, result.warnings);
      }
      const crewId = extractSickCrew(request.question);
      if (crewId) {
        const result = analyzeSickCrew(graph, { crewId });
        if (!result.success) {
          return { success: false, error: { code: "ANALYSIS_FAILED", message: result.summary } };
        }

        const affectedPairings = result.data.pairings.map((pairing) => ({
          pairingId: pairing.pairingId,
          role: pairing.role,
          dutyDates: pairing.dates,
          flightIds: pairing.flights,
          aircraftTypes: pairing.aircraftTypes,
          recoveryAvailable: pairing.recoveryAvailable,
          noRecoveryReason: pairing.noRecoveryReason,
        }));
        const options = result.data.pairings.flatMap((pairing) => pairing.ranked.map((option) => adaptOption(graph, option)));
        const rejected = result.data.pairings.flatMap((pairing) =>
          pairing.rejected.map((candidate) => {
            const crew = graph.crewById.get(candidate.crewId);
            return { ...candidate, crewName: crew?.name, role: crew?.rank };
          }),
        );
        const recommended = options.find((option) => option.kind === "cover" && option.legal === true);
        return {
          success: true,
          intent: { type: "SICK_CREW", interpreted: `${crewId} reported unavailable` },
          entities: { crewId, pairingIds: affectedPairings.map((pairing) => pairing.pairingId) },
          summary: result.summary,
          consequences: { recoveryRequired: affectedPairings.length > 0, affectedPairings },
          recovery: {
            recommended,
            alternatives: options.filter((option) => option.kind === "cover" && option !== recommended),
            rejected,
            cancellationFallbacks: options.filter((option) => option.kind === "cancel"),
          },
          evidence: result.evidence,
          warnings: result.warnings,
          assumptions: ["No report time was supplied; rostered duty timing was used by the deterministic engine."],
        };
      }

      const delay = extractDelay(request.question);
      const closure = extractStationClosure(request.question, operationalDate);
      if (closure) {
        const result = analyzeDisruption(graph, { type: "STATION_CLOSURE", station: closure.station, startUtc: closure.startUtc, endUtc: closure.endUtc });
        if (!result.success || result.data.kind !== "station") {
          return { success: false, error: { code: "ANALYSIS_FAILED", message: result.success ? "station closure analysis returned an unexpected result" : (result.error ?? result.summary) } };
        }
        return adaptStationClosure(graph, result.data, result.summary, result.evidence, result.warnings, closure.operationalDate);
      }
      const certification = extractCertificationExpiry(request.question, operationalDate, [...new Set(graph.certifications.flatMap((cert) => [cert.certType]))]);
      if (certification) {
        const result = analyzeDisruption(graph, { type: "CERT_EXPIRY", ...certification });
        if (!result.success || result.data.kind !== "cert") {
          return { success: false, error: { code: "ANALYSIS_FAILED", message: result.success ? "certification expiry analysis returned an unexpected result" : (result.error ?? result.summary) } };
        }
        return adaptCertificationExpiry(graph, result.data, result.summary, result.evidence, result.warnings);
      }
      if (!delay) {
        if (/\b(?:close|closes|closed|closure)\b/i.test(request.question) && /\b\d{1,2}:\d{2}\b/.test(request.question)) {
          return { success: false, error: { code: "INVALID_REQUEST", message: "Station closure times must be valid UTC HH:MM values in a complete interval." } };
        }
        return {
          success: false, error: { code: "UNSUPPORTED_INTENT", message: "Supported questions are SICK_CREW, DELAY, STATION_CLOSURE, and targeted CERT_EXPIRY with a crew ID." },
        };
      }
      const flight = graph.flights.find((candidate) => candidate.flightNo === delay.flightNo);
      if (!flight) return { success: false, error: { code: "ANALYSIS_FAILED", message: `unknown flight ${delay.flightNo}` } };
      const result = analyzeDelay(graph, { flightId: flight.flightId, delayMinutes: delay.delayMinutes });
      if (!result.success) {
        return { success: false, error: { code: "ANALYSIS_FAILED", message: result.summary } };
      }
      const partialOptions = result.data.partial?.suffixCovers.flatMap((cover) =>
        cover.options.map((option) => delayOption(graph, option, result.data.pairingId, result.data.partial?.suffixFlights ?? [])),
      ) ?? [];
      const fullSolutions = result.data.fullRecrew ?? [];
      const fullOptions = fullSolutions.flatMap((entry) => entry.solution.ranked.map((option) => adaptOption(graph, option)));
      const preferred = result.data.recommended?.strategy === "partial" ? partialOptions : fullOptions;
      const recommended = preferred.find((option) => option.kind === "cover" && option.legal === true);
      const alternatives = preferred.filter((option) => option.kind === "cover" && option !== recommended);
      const rejected = fullSolutions.flatMap((entry) => entry.solution.rejected.map((candidate) => {
        const crew = graph.crewById.get(candidate.crewId);
        return { ...candidate, crewName: crew?.name, role: crew?.rank };
      }));
      const cancellationFallbacks = fullOptions.filter((option) => option.kind === "cancel");
      if (result.data.cancelFlights.length > 0) {
        cancellationFallbacks.push({
          kind: "cancel", method: "cancellation", pairingId: result.data.pairingId, legalityEvaluated: false,
          cost: { currency: graph.costs.currency, total: result.data.cancelCostTotal, components: [] }, delayMinutes: 0,
          affectedFlightIds: result.data.cancelFlights,
        });
      }
      return {
        success: true,
        intent: { type: "DELAY", interpreted: `${delay.flightNo} delayed by ${delay.delayMinutes} minutes` },
        entities: { flightId: result.data.flightId, flightNo: delay.flightNo, origin: flight.depStation, destination: flight.arrStation, delayMinutes: delay.delayMinutes, pairingId: result.data.pairingId, crewIds: result.data.affectedCrew },
        summary: result.summary,
        consequences: {
          recoveryRequired: result.data.recoveryRequired,
          affectedPairings: [{ pairingId: result.data.pairingId, dutyDates: [result.data.date], flightIds: result.data.shiftedFlights.map((item) => item.flightId) }],
          timingChanges: result.data.timingChanges,
          crew: result.data.crew,
          boundary: result.data.boundary,
        } as CrewOpsQuerySuccess["consequences"],
        recovery: {
          recommended,
          alternatives,
          rejected,
          cancellationFallbacks,
          recommendedPlan: result.data.recommended,
        },
        evidence: result.evidence,
        warnings: result.warnings,
        assumptions: ["Timing is resolved through the deterministic delay overlay; report time remains fixed and release extends."],
      };
    },
  };
}
