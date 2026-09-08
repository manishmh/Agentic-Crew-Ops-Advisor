import type { RecoveryOption, RuleCheck, Scenario } from "../types/operations.js";

type UnknownRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is UnknownRecord => typeof value === "object" && value !== null;
const frontendEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
const apiBaseUrl = (frontendEnv?.VITE_CREWOPS_API_BASE_URL ?? "").trim().replace(/\/+$/, "");

/** Empty for the local proxy and same-origin Vercel API; an external API URL is optional. */
export function crewOpsApiUrl(path: string): string {
  return `${apiBaseUrl}${path}`;
}

function agentDisplay(payload: UnknownRecord): Pick<Scenario, "naturalLanguageAnswer" | "agent"> {
  const answer = typeof payload.naturalLanguageAnswer === "string" ? payload.naturalLanguageAnswer : undefined;
  if (payload.agent === undefined) return { naturalLanguageAnswer: answer };
  if (!isRecord(payload.agent)) throw new CrewOpsApiError("malformed", "Malformed CrewOps agent metadata.");
  const agent = payload.agent;
  for (const key of ["plannerUsed", "plannerFallback", "explainerUsed", "fallbackUsed"] as const) if (typeof agent[key] !== "boolean") throw new CrewOpsApiError("malformed", `Malformed CrewOps agent metadata: ${key}.`);
  return { naturalLanguageAnswer: answer, agent: { plannerMs: typeof agent.plannerMs === "number" ? agent.plannerMs : undefined, toolMs: typeof agent.toolMs === "number" ? agent.toolMs : undefined, explainerMs: typeof agent.explainerMs === "number" ? agent.explainerMs : undefined, plannerUsed: agent.plannerUsed as boolean, plannerFallback: agent.plannerFallback as boolean, explainerUsed: agent.explainerUsed as boolean, fallbackUsed: agent.fallbackUsed as boolean } };
}

export class CrewOpsApiError extends Error {
  readonly kind: "network" | "backend" | "malformed" | "empty" | "clarification" | "unsupported";
  constructor(
    kind: "network" | "backend" | "malformed" | "empty" | "clarification" | "unsupported",
    message: string,
  ) {
    super(message);
    this.name = "CrewOpsApiError";
    this.kind = kind;
  }
}

const rupees = (value: number) => `₹${new Intl.NumberFormat("en-IN").format(value)}`;
const ruleLabel = (id: string) =>
  ({
    "RULE-FDP-01": "FDP compliant",
    "RULE-DUTY-02": "7-day duty compliant",
    "RULE-REST-04": "Rest compliant",
    "RULE-QUAL-05": "Aircraft qualified",
    "RULE-CERT-06": "Certifications valid",
  })[id] ?? id;

function asArray(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new CrewOpsApiError("malformed", `Malformed CrewOps response: ${name} is missing.`);
  return value;
}

function asString(value: unknown, name: string): string {
  if (typeof value !== "string") throw new CrewOpsApiError("malformed", `Malformed CrewOps response: ${name} is missing.`);
  return value;
}

function asNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new CrewOpsApiError("malformed", `Malformed CrewOps response: ${name} is invalid.`);
  }
  return value;
}

function statusFrom(value: unknown): RecoveryOption["status"] {
  return value === true ? "legal" : value === false ? "rejected" : "not-evaluated";
}

function componentLabel(type: string): string {
  return {
    reserve_callout: "Reserve activation",
    dayoff_callout: "Day-off activation",
    deadhead: "Deadhead",
    delay: "Delay",
    cancellation: "Cancellation",
    hotel: "Hotel",
  }[type] ?? type;
}

function toChecks(evidence: unknown[], status: RecoveryOption["status"]): RuleCheck[] {
  return evidence
    .filter(isRecord)
    .filter((item) => typeof item.ruleId === "string")
    .map((item) => ({
      id: item.ruleId as string,
      label: ruleLabel(item.ruleId as string),
      status: item.passed === false ? "rejected" : status,
      actual: typeof item.actual === "number" ? String(item.actual) : undefined,
      limit: typeof item.limit === "number" ? String(item.limit) : undefined,
    }));
}

function mapOption(value: unknown, evidence: unknown[], rejected = false): RecoveryOption {
  if (!isRecord(value) || !isRecord(value.cost)) throw new CrewOpsApiError("malformed", "Malformed CrewOps recovery option.");
  const cost = value.cost;
  const components = asArray(cost.components, "cost components").map((component) => {
    if (!isRecord(component)) throw new CrewOpsApiError("malformed", "Malformed cost component.");
    return { label: componentLabel(asString(component.type, "component type")), value: rupees(asNumber(component.amount, "component amount")) };
  });
  const status = rejected ? "rejected" : statusFrom(value.legal);
  const matchingEvidence = typeof value.crewId === "string"
    ? evidence.filter((item) => isRecord(item) && item.crewId === value.crewId)
    : evidence;
  // Delay partial-cover primitives retain legality on the candidate but their
  // tool evidence is operation-level. Show that deterministic operation
  // evidence when candidate-scoped evidence is not available.
  const optionEvidence = matchingEvidence.length > 0 ? matchingEvidence : evidence;
  const delay = asNumber(value.delayMinutes, "delayMinutes");
  const method = asString(value.method, "recovery method");
  return {
    id: typeof value.crewId === "string" ? value.crewId : "CANCELLATION",
    name: typeof value.crewName === "string" ? value.crewName : "Cancellation fallback",
    role: [value.base, value.role].filter((part): part is string => typeof part === "string").join(" · ") || "Affected operation",
    method: method === "positioning" ? "Deadhead positioning" : method === "dayoff" ? "Day-off activation" : method === "reserve" ? "Reserve activation" : "Cancellation fallback",
    status,
    cost: rupees(asNumber(cost.total, "total cost")),
    delay: `${delay} min`,
    positioning: method === "positioning" ? "Yes" : "No",
    reason: rejected ? "Candidate rejected by deterministic recovery screening." : "Deterministic recovery option ranked by the backend.",
    checks: toChecks(optionEvidence, status),
    components,
  };
}

function mapRejected(value: unknown): RecoveryOption {
  if (!isRecord(value)) throw new CrewOpsApiError("malformed", "Malformed rejected candidate.");
  const violations = asArray(value.violations, "candidate violations");
  const reasons = asArray(value.reasons, "candidate reasons").filter((reason): reason is string => typeof reason === "string");
  const evaluated = value.legalityEvaluated === true;
  const checks = violations.filter(isRecord).map((violation) => ({
    id: asString(violation.ruleId, "violation rule"),
    label: typeof violation.message === "string" ? violation.message : ruleLabel(asString(violation.ruleId, "violation rule")),
    status: "rejected" as const,
    actual: typeof violation.actual === "number" ? String(violation.actual) : undefined,
    limit: typeof violation.limit === "number" ? String(violation.limit) : undefined,
  }));
  return {
    id: asString(value.crewId, "rejected crew"),
    name: typeof value.crewName === "string" ? value.crewName : "Candidate crew",
    role: typeof value.role === "string" ? value.role : "Candidate",
    method: evaluated ? "Legality evaluated" : "Filtered before legality evaluation",
    status: evaluated ? "rejected" : "not-evaluated",
    cost: "—",
    delay: "—",
    positioning: "—",
    reason: reasons.join(" · ") || "No legal recovery assignment available.",
    checks,
    components: [],
  };
}

/** Maps a backend SICK_CREW result into the established display-only Scenario contract. */
export function mapSickCrewResponse(payload: unknown, query: string): Scenario {
  if (!isRecord(payload)) throw new CrewOpsApiError("malformed", "CrewOps returned an invalid response.");
  if (payload.success !== true) {
    const error = isRecord(payload.error) ? errorMessage(payload.error.message) : "CrewOps could not analyze this request.";
    throw new CrewOpsApiError("backend", error);
  }
  if (!isRecord(payload.intent) || payload.intent.type !== "SICK_CREW" || !isRecord(payload.entities) || !isRecord(payload.consequences) || !isRecord(payload.recovery)) {
    throw new CrewOpsApiError("malformed", "CrewOps returned an unsupported response shape.");
  }
  const pairings = asArray(payload.consequences.affectedPairings, "affected pairings");
  if (pairings.length === 0) throw new CrewOpsApiError("empty", "No affected duties were returned for this sick-crew analysis.");
  const first = pairings[0];
  if (!isRecord(first)) throw new CrewOpsApiError("malformed", "Malformed affected pairing.");
  const flights = asArray(first.flightIds, "affected flights").map((flight) => asString(flight, "flight ID"));
  const aircraft = asArray(first.aircraftTypes, "aircraft types").map((type) => asString(type, "aircraft type")).join(", ");
  const evidence = asArray(payload.evidence, "evidence");
  const recovery = payload.recovery;
  const recommended = recovery.recommended === undefined ? undefined : mapOption(recovery.recommended, evidence);
  const alternatives = asArray(recovery.alternatives, "recovery alternatives").map((option) => mapOption(option, evidence));
  const rejected = asArray(recovery.rejected, "rejected candidates").map(mapRejected);
  const warnings = asArray(payload.warnings, "warnings").filter((warning): warning is string => typeof warning === "string");
  const assumptions = asArray(payload.assumptions, "assumptions").filter((assumption): assumption is string => typeof assumption === "string");
  return {
    ...agentDisplay(payload),
    id: "sick",
    query,
    label: "Sick crew",
    summary: asString(payload.summary, "summary"),
    status: recommended ? "RECOVERY REQUIRED" : "RECOVERY REQUIRED · FALLBACK REVIEW",
    pairing: asString(first.pairingId, "pairing ID"),
    metrics: [
      { label: "Crew", value: asString(payload.entities.crewId, "crew ID") },
      { label: "Role", value: asString(first.role, "role") },
      { label: "Pairing", value: asString(first.pairingId, "pairing ID") },
      { label: "Aircraft", value: aircraft || "—" },
      { label: "Duty days", value: String(asArray(first.dutyDates, "duty dates").length) },
      { label: "Flights affected", value: String(flights.length) },
    ],
    flights,
    recommended,
    alternatives: [...alternatives, ...rejected],
    note: [...warnings, ...assumptions].join(" ") || undefined,
    live: true,
  };
}

/** Maps a deterministic DELAY response; timing/FDP values are rendered, never recomputed here. */
export function mapDelayResponse(payload: unknown, query: string): Scenario {
  if (!isRecord(payload)) throw new CrewOpsApiError("malformed", "CrewOps returned an invalid response.");
  if (payload.success !== true) throw new CrewOpsApiError("backend", isRecord(payload.error) ? errorMessage(payload.error.message) : "CrewOps could not analyze this request.");
  if (!isRecord(payload.intent) || payload.intent.type !== "DELAY" || !isRecord(payload.entities) || !isRecord(payload.consequences) || !isRecord(payload.recovery)) {
    throw new CrewOpsApiError("malformed", "CrewOps returned an unsupported delay response shape.");
  }
  const pairings = asArray(payload.consequences.affectedPairings, "affected pairings");
  if (pairings.length === 0 || !isRecord(pairings[0])) throw new CrewOpsApiError("empty", "No affected duties were returned for this delay analysis.");
  const pairing = pairings[0];
  const flights = asArray(pairing.flightIds, "affected flights").map((flight) => asString(flight, "flight ID"));
  const evidence = asArray(payload.evidence, "evidence");
  const recovery = payload.recovery;
  const recommended = recovery.recommended === undefined ? undefined : mapOption(recovery.recommended, evidence);
  const alternatives = asArray(recovery.alternatives, "recovery alternatives").map((option) => mapOption(option, evidence));
  const rejected = asArray(recovery.rejected, "rejected candidates").map(mapRejected);
  const warnings = asArray(payload.warnings, "warnings").filter((warning): warning is string => typeof warning === "string");
  const assumptions = asArray(payload.assumptions, "assumptions").filter((item): item is string => typeof item === "string");
  const failedRule = evidence.filter(isRecord).find((item) => item.passed === false && typeof item.ruleId === "string");
  const plan = isRecord(recovery.recommendedPlan) ? recovery.recommendedPlan : undefined;
  return {
    ...agentDisplay(payload),
    id: "delay", query, label: "Flight delay", live: true,
    summary: asString(payload.summary, "summary"),
    status: payload.consequences.recoveryRequired === true ? "RECOVERY REQUIRED" : "ABSORBED · LEGAL",
    pairing: asString(pairing.pairingId, "pairing ID"),
    metrics: [
      { label: "Flight", value: asString(payload.entities.flightNo, "flight number") },
      { label: "Route", value: `${asString(payload.entities.origin, "origin")} → ${asString(payload.entities.destination, "destination")}` },
      { label: "Delay", value: `+${asNumber(payload.entities.delayMinutes, "delay minutes")} min` },
      { label: "Pairing", value: asString(pairing.pairingId, "pairing ID") },
      { label: "Crew affected", value: String(asArray(payload.entities.crewIds, "crew IDs").length) },
    ],
    flights,
    consequence: failedRule ? {
      title: "Legality consequence",
      checks: [{ id: failedRule.ruleId as string, label: ruleLabel(failedRule.ruleId as string), status: "rejected", actual: typeof failedRule.actual === "number" ? String(failedRule.actual) : undefined, limit: typeof failedRule.limit === "number" ? String(failedRule.limit) : undefined }],
      note: isRecord(payload.consequences.boundary) ? `First recovery boundary · ${String(payload.consequences.boundary.pairingId)}, after ${String(payload.consequences.boundary.firstAffectedFlight ?? "the legal prefix")}.` : "Timing and legality evaluated through the deterministic delay overlay.",
    } : undefined,
    recommended,
    alternatives: [...alternatives, ...rejected],
    note: [...warnings, ...assumptions, plan ? `Recommended ${String(plan.strategy)} recovery plan total: ${rupees(asNumber(plan.totalCost, "recommended plan cost"))}.` : ""].filter(Boolean).join(" ") || undefined,
  };
}

/** Maps STATION_CLOSURE transport data only; closure impact and recovery remain backend-owned. */
export function mapStationClosureResponse(payload: unknown, query: string): Scenario {
  if (!isRecord(payload)) throw new CrewOpsApiError("malformed", "CrewOps returned an invalid response.");
  if (payload.success !== true) throw new CrewOpsApiError("backend", isRecord(payload.error) ? errorMessage(payload.error.message) : "CrewOps could not analyze this request.");
  if (!isRecord(payload.intent) || payload.intent.type !== "STATION_CLOSURE" || !isRecord(payload.entities) || !isRecord(payload.consequences) || !isRecord(payload.recovery)) {
    throw new CrewOpsApiError("malformed", "CrewOps returned an unsupported station-closure response shape.");
  }
  const details = asArray(payload.consequences.affectedFlights, "affected flights");
  if (details.length === 0) throw new CrewOpsApiError("empty", "No affected operations were returned for this station-closure analysis.");
  const affectedFlights = details.map((item) => {
    if (!isRecord(item)) throw new CrewOpsApiError("malformed", "Malformed affected flight.");
    const reasons = asArray(item.reasons, "affected flight reasons").map((reason) => asString(reason, "affected flight reason"));
    return {
      id: asString(item.flightId, "flight ID"),
      origin: asString(item.origin, "flight origin"),
      destination: asString(item.destination, "flight destination"),
      // Keep the backend's Zulu timestamps intact: Date formatting would convert
      // them to the controller's browser time zone.
      departure: asString(item.scheduledDepartureUtc, "scheduled departure"),
      arrival: asString(item.scheduledArrivalUtc, "scheduled arrival"),
      reason: reasons.join(" + "),
    };
  });
  const evidence = asArray(payload.evidence, "evidence");
  const recovery = payload.recovery;
  const alternatives = asArray(recovery.alternatives, "recovery alternatives").map((option) => mapOption(option, evidence));
  const rejected = asArray(recovery.rejected, "rejected candidates").map(mapRejected);
  const fallbacks = asArray(recovery.cancellationFallbacks, "cancellation fallbacks");
  const firstFallback = fallbacks[0];
  const fallbackCost = isRecord(firstFallback) && isRecord(firstFallback.cost) ? rupees(asNumber(firstFallback.cost.total, "cancellation fallback cost")) : undefined;
  const warnings = asArray(payload.warnings, "warnings").filter((warning): warning is string => typeof warning === "string");
  const assumptions = asArray(payload.assumptions, "assumptions").filter((item): item is string => typeof item === "string");
  const consequences = payload.consequences;
  const operationalConsequences = asArray(consequences.operationalConsequences, "operational consequences");
  const consequence = operationalConsequences.find(isRecord);
  return {
    ...agentDisplay(payload),
    id: "closure", query, label: "Station closure", live: true,
    summary: asString(payload.summary, "summary"),
    status: consequences.recoveryRequired === true ? "RECOVERY REQUIRED" : "MODELED DELAY · LEGAL",
    pairing: `${asNumber(payload.entities.affectedPairingCount, "affected pairing count")} affected pairings`,
    metrics: [
      { label: "Station", value: asString(payload.entities.station, "station") },
      { label: "Closure · UTC", value: `${asString(payload.entities.closureStartUtc, "closure start")} – ${asString(payload.entities.closureEndUtc, "closure end")}` },
      { label: "Affected flights", value: String(asNumber(payload.entities.affectedFlightCount, "affected flight count")) },
      { label: "Pairings", value: String(asNumber(payload.entities.affectedPairingCount, "affected pairing count")) },
      { label: "Crew affected", value: String(asNumber(payload.entities.affectedCrewCount, "affected crew count")) },
    ],
    flights: affectedFlights.map((flight) => flight.id),
    affectedFlights,
    alternatives: [...alternatives, ...rejected],
    closureOutcome: {
      fallbackCost,
      recoveryRequired: consequences.recoveryRequired === true,
      recoveryAvailable: consequences.recoveryAvailable === true ? true : consequences.recoveryAvailable === false ? false : undefined,
      consequence: isRecord(consequence) && typeof consequence.modeledAction === "string" ? consequence.modeledAction.replaceAll("_", " ") : undefined,
    },
    evidence: evidence.filter(isRecord).map((item) => ({
      reason: typeof item.reason === "string" ? item.reason : "Deterministic closure evidence.",
      ruleId: typeof item.ruleId === "string" ? item.ruleId : undefined,
      passed: typeof item.passed === "boolean" ? item.passed : undefined,
      timestamps: isRecord(item.timestamps) ? Object.fromEntries(Object.entries(item.timestamps).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : undefined,
    })),
    note: [...warnings, ...assumptions].join(" ") || undefined,
  };
}

/** Maps CERT_EXPIRY transport data; validity and recovery decisions remain backend-owned. */
export function mapCertificationExpiryResponse(payload: unknown, query: string): Scenario {
  if (!isRecord(payload)) throw new CrewOpsApiError("malformed", "CrewOps returned an invalid response.");
  if (payload.success !== true) throw new CrewOpsApiError("backend", isRecord(payload.error) ? errorMessage(payload.error.message) : "CrewOps could not analyze this request.");
  if (!isRecord(payload.intent) || payload.intent.type !== "CERT_EXPIRY" || !isRecord(payload.entities) || !isRecord(payload.consequences) || !isRecord(payload.recovery)) {
    throw new CrewOpsApiError("malformed", "CrewOps returned an unsupported certification-expiry response shape.");
  }
  const entities = payload.entities;
  const consequences = payload.consequences;
  const inspected = asArray(consequences.inspectedDuties, "inspected duties").map((duty) => {
    if (!isRecord(duty) || typeof duty.certificationLegal !== "boolean") throw new CrewOpsApiError("malformed", "Malformed inspected duty.");
    return { pairingId: asString(duty.pairingId, "inspected pairing"), dutyDate: asString(duty.dutyDate, "inspected duty date"), flightIds: asArray(duty.flightIds, "inspected flights").map((id) => asString(id, "flight ID")), aircraftTypes: asArray(duty.aircraftTypes, "inspected aircraft types").map((type) => asString(type, "aircraft type")), certificationLegal: duty.certificationLegal, expired: asArray(duty.expired, "expired certifications").map((type) => asString(type, "certification type")) };
  });
  const affected = asArray(consequences.affectedDuties, "affected duties").map((duty) => {
    if (!isRecord(duty)) throw new CrewOpsApiError("malformed", "Malformed affected duty.");
    return { pairingId: asString(duty.pairingId, "affected pairing"), dutyDate: asString(duty.dutyDate, "affected duty date"), flightIds: asArray(duty.flightIds, "affected flights").map((id) => asString(id, "flight ID")) };
  });
  const evidence = asArray(payload.evidence, "evidence");
  const failedRule = evidence.filter(isRecord).find((item) => item.passed === false && typeof item.ruleId === "string");
  const recovery = payload.recovery;
  const recommended = recovery.recommended === undefined ? undefined : mapOption(recovery.recommended, evidence);
  const alternatives = asArray(recovery.alternatives, "recovery alternatives").map((option) => mapOption(option, evidence));
  const rejected = asArray(recovery.rejected, "rejected candidates").map(mapRejected);
  const certifications = asArray(entities.certifications, "certifications");
  const firstCertification = certifications[0];
  if (!isRecord(firstCertification)) throw new CrewOpsApiError("malformed", "Malformed certification.");
  const validTo = asString(firstCertification.validTo, "certification valid-to date");
  const warnings = asArray(payload.warnings, "warnings").filter((item): item is string => typeof item === "string");
  const assumptions = asArray(payload.assumptions, "assumptions").filter((item): item is string => typeof item === "string");
  return {
    ...agentDisplay(payload),
    id: "certification", query, label: "Certification expiry", live: true,
    summary: asString(payload.summary, "summary"),
    status: consequences.recoveryRequired === true ? "INVALID FOR DUTY" : "NO AFFECTED DUTY",
    pairing: affected[0]?.pairingId ?? "No affected pairing",
    metrics: [
      { label: "Crew", value: asString(entities.crewId, "crew ID") },
      { label: "Role", value: asString(entities.role, "crew role") },
      { label: "Certification", value: asString(firstCertification.certType, "certification type").replaceAll("_", " ") },
      { label: "Valid through", value: validTo },
      { label: "Affected duty", value: affected[0]?.dutyDate ?? "None" },
    ],
    flights: affected.flatMap((duty) => duty.flightIds),
    recommended,
    alternatives: [...alternatives, ...rejected],
    certificationDuties: inspected,
    consequence: failedRule ? {
      title: "Certification validity",
      checks: [{ id: failedRule.ruleId as string, label: ruleLabel(failedRule.ruleId as string), status: "rejected", actual: isRecord(failedRule.details) && typeof failedRule.details.dutyDate === "string" ? failedRule.details.dutyDate : undefined, limit: isRecord(failedRule.details) && typeof failedRule.details.validTo === "string" ? failedRule.details.validTo : undefined }],
      note: affected[0] ? "The deterministic engine identified this certification-invalid assignment and assessed recovery." : "Inspected duties remain legal under the deterministic certification records.",
    } : undefined,
    evidence: evidence.filter(isRecord).map((item) => ({
      reason: typeof item.reason === "string" ? item.reason : "Deterministic certification evidence.",
      ruleId: typeof item.ruleId === "string" ? item.ruleId : undefined,
      passed: typeof item.passed === "boolean" ? item.passed : undefined,
      details: isRecord(item.details) ? Object.fromEntries(Object.entries(item.details).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : undefined,
    })),
    note: [...warnings, ...assumptions].join(" ") || undefined,
  };
}

/** Maps the deterministic joint MULTI_SICK plan without selecting or pricing anything in the client. */
export function mapMultiSickResponse(payload: unknown, query: string): Scenario {
  if (!isRecord(payload)) throw new CrewOpsApiError("malformed", "CrewOps returned an invalid response.");
  if (payload.success !== true) throw new CrewOpsApiError("backend", isRecord(payload.error) ? errorMessage(payload.error.message) : "CrewOps could not analyze this request.");
  if (!isRecord(payload.intent) || payload.intent.type !== "MULTI_SICK" || !isRecord(payload.entities) || !isRecord(payload.consequences) || !isRecord(payload.recovery)) throw new CrewOpsApiError("malformed", "CrewOps returned an unsupported multi-sick response shape.");
  const disruptions = asArray(payload.consequences.disruptions, "multi-sick disruptions").map((disruption) => {
    if (!isRecord(disruption) || !isRecord(disruption.selected)) throw new CrewOpsApiError("malformed", "Malformed joint disruption.");
    const selected = disruption.selected;
    const kind = asString(selected.kind, "selected recovery kind");
    const cost = asNumber(selected.costTotal, "selected recovery cost");
    const delayMinutes = asNumber(selected.delayMinutes, "selected recovery delay");
    return { pairing: asString(disruption.pairingId, "pairing ID"), unavailableCrew: asString(disruption.crewId, "unavailable crew"), crew: kind === "cancel" ? "Cancellation fallback" : asString(selected.crewId, "replacement crew"), method: kind === "cancel" ? "Cancellation fallback" : "Joint crew recovery", cost: rupees(cost), delay: `${delayMinutes} min`, status: kind === "cancel" ? "not-evaluated" as const : selected.legal === true ? "legal" as const : "rejected" as const };
  });
  const unavailable = asArray(payload.entities.unavailableCrew, "unavailable crew");
  const affectedFlights = asArray(payload.consequences.affectedFlights, "affected flights").map((id) => asString(id, "flight ID"));
  const evidence = asArray(payload.evidence, "evidence");
  const warnings = asArray(payload.warnings, "warnings").filter((item): item is string => typeof item === "string");
  const assumptions = asArray(payload.assumptions, "assumptions").filter((item): item is string => typeof item === "string");
  const totalEvidence = evidence.filter(isRecord).find((item) => isRecord(item.cost) && typeof item.reason === "string" && item.reason.startsWith("joint total"));
  const total = isRecord(totalEvidence) && isRecord(totalEvidence.cost) ? rupees(asNumber(totalEvidence.cost.total, "joint total")) : undefined;
  return { ...agentDisplay(payload), id: "multi", query, label: "Multi-crew disruption", live: true, summary: asString(payload.summary, "summary"), status: payload.consequences.complete === true ? "COMPLETE PLAN" : "INCOMPLETE / UNRESOLVED", pairing: disruptions.map((item) => item.pairing).join(" / "), metrics: [{ label: "Unavailable crew", value: String(unavailable.length) }, { label: "Affected pairings", value: String(asArray(payload.consequences.affectedPairings, "affected pairings").length) }, { label: "Affected flights", value: String(affectedFlights.length) }, { label: "Plan status", value: payload.consequences.complete === true ? "Complete" : "Incomplete" }], flights: affectedFlights, alternatives: [], joint: disruptions, total, evidence: evidence.filter(isRecord).map((item) => ({ reason: typeof item.reason === "string" ? item.reason : "Deterministic joint recovery evidence.", ruleId: typeof item.ruleId === "string" ? item.ruleId : undefined, passed: typeof item.passed === "boolean" ? item.passed : undefined })), note: [...warnings, ...assumptions].join(" ") || undefined };
}

export function mapCrewOpsResponse(payload: unknown, query: string): Scenario {
  if (!isRecord(payload) || !isRecord(payload.intent)) {
    if (isRecord(payload) && payload.success === false) throw new CrewOpsApiError("backend", isRecord(payload.error) ? errorMessage(payload.error.message) : "CrewOps could not analyze this request.");
    throw new CrewOpsApiError("malformed", "CrewOps returned an unsupported agent response shape.");
  }
  switch (payload.intent.type) {
    case "SICK_CREW": return mapSickCrewResponse(payload, query);
    case "DELAY": return mapDelayResponse(payload, query);
    case "STATION_CLOSURE": return mapStationClosureResponse(payload, query);
    case "CERT_EXPIRY": return mapCertificationExpiryResponse(payload, query);
    case "MULTI_SICK": return mapMultiSickResponse(payload, query);
    default: throw new CrewOpsApiError("malformed", "CrewOps returned an unsupported agent intent.");
  }
}

function errorMessage(value: unknown): string {
  return typeof value === "string" ? value : "CrewOps could not analyze this request.";
}

export async function querySickCrew(question: string, signal?: AbortSignal): Promise<Scenario> {
  return queryLive(question, mapSickCrewResponse, signal);
}

export async function queryDelay(question: string, signal?: AbortSignal): Promise<Scenario> {
  return queryLive(question, mapDelayResponse, signal);
}

export async function queryStationClosure(question: string, signal?: AbortSignal): Promise<Scenario> {
  return queryLive(question, mapStationClosureResponse, signal);
}

export async function queryCertificationExpiry(question: string, signal?: AbortSignal): Promise<Scenario> {
  return queryLive(question, mapCertificationExpiryResponse, signal);
}

export async function queryMultiSick(question: string, signal?: AbortSignal): Promise<Scenario> {
  return queryLive(question, mapMultiSickResponse, signal);
}

export async function queryAgent(question: string, signal?: AbortSignal): Promise<Scenario> {
  return queryLive(question, mapCrewOpsResponse, signal);
}

async function queryLive(question: string, mapper: (payload: unknown, question: string) => Scenario, signal?: AbortSignal): Promise<Scenario> {
  let response: Response;
  try {
    response = await fetch(crewOpsApiUrl("/api/crewops/query"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question }),
      signal,
    });
  } catch {
    throw new CrewOpsApiError("network", "The analysis service is temporarily unavailable. Please try again shortly.");
  }
  if (response.status === 429) throw new CrewOpsApiError("backend", "Too many requests. Try again in a few minutes.");
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new CrewOpsApiError("malformed", "The analysis service returned an unexpected response. Please try again.");
  }
  if (!response.ok && (!isRecord(payload) || payload.success !== false)) {
    throw new CrewOpsApiError("network", `CrewOps service request failed (${response.status}).`);
  }
  if (!response.ok && isRecord(payload) && isRecord(payload.error)) {
    if (payload.error.code === "CLARIFICATION_REQUIRED") throw new CrewOpsApiError("clarification", errorMessage(payload.error.message));
    if (payload.error.code === "UNSUPPORTED_INTENT") throw new CrewOpsApiError("unsupported", "Choose a guided scenario for sick crew, flight delays, station closures, certification expiry or joint recovery.");
  }
  return mapper(payload, question);
}
