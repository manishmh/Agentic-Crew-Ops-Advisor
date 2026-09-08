import type { OperationalGraph } from "../data/graph.js";
import type { CrewOpsQueryRequest, CrewOpsQueryResponse } from "../api/crewopsQuery.js";
import type { PlannerPlan } from "./types.js";

export interface Tier2QueryRunner { query(request: CrewOpsQueryRequest): CrewOpsQueryResponse; }
const fail = (code: "INVALID_REQUEST" | "CLARIFICATION_REQUIRED" | "UNSUPPORTED_INTENT", message: string): CrewOpsQueryResponse => ({ success: false, error: { code, message } });
const isoParts = (value: string): { date: string; time: string } | undefined => {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2})?Z$/);
  return match ? { date: match[1], time: match[2] } : undefined;
};
const utcTime = (value: string): string | undefined => {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return undefined;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
};
const validOperationalDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
};

export function executePlan(graph: OperationalGraph, runner: Tier2QueryRunner, plan: PlannerPlan): CrewOpsQueryResponse {
  if (plan.needsClarification) return fail("CLARIFICATION_REQUIRED", plan.clarificationQuestion ?? "Please clarify the request.");
  if (plan.entities.operationalDate && !validOperationalDate(plan.entities.operationalDate)) return fail("INVALID_REQUEST", `invalid operational date ${plan.entities.operationalDate}`);
  const crewIds = plan.entities.crewIds?.map((id) => id.toUpperCase()) ?? [];
  const unknownCrew = crewIds.find((id) => !graph.crewById.has(id));
  if (unknownCrew) return fail("INVALID_REQUEST", `unknown crew ${unknownCrew}`);
  switch (plan.intent) {
    case "SICK_CREW": return crewIds.length === 1 ? runner.query({ question: `${crewIds[0]} reports sick` }) : fail("INVALID_REQUEST", "SICK_CREW requires exactly one crew ID.");
    case "DELAY": {
      if (plan.entities.flightIds?.length !== 1) return fail("INVALID_REQUEST", "Delay requests require exactly one flight.");
      const requested = plan.entities.flightIds[0].toUpperCase();
      if (!Number.isInteger(plan.entities.delayMinutes) || (plan.entities.delayMinutes ?? 0) <= 0) return fail("INVALID_REQUEST", "Delay requests require a positive whole-minute duration.");
      const flight = graph.flightById.get(requested) ?? graph.flights.find((item) => item.flightNo === requested);
      return flight ? runner.query({ question: `Delay ${flight.flightNo} by ${plan.entities.delayMinutes} minutes` }) : fail("INVALID_REQUEST", `unknown flight ${requested}`);
    }
    case "STATION_CLOSURE": {
      const station = plan.entities.station?.toUpperCase();
      if (!station) return fail("INVALID_REQUEST", "Station closure requests require a station.");
      if (!graph.flightsByOrigin.has(station) && !graph.flightsByDestination.has(station)) return fail("INVALID_REQUEST", `unknown station ${station}`);
      if (!plan.entities.startUtc || !plan.entities.endUtc) return fail("INVALID_REQUEST", "Station closure requests require a UTC start and end time.");
      const startIso = isoParts(plan.entities.startUtc); const endIso = isoParts(plan.entities.endUtc);
      if (startIso || endIso) {
        if (!startIso || !endIso || startIso.date !== endIso.date) return fail("INVALID_REQUEST", "Station closure requires start and end values on the same operational date.");
        if (plan.entities.operationalDate && plan.entities.operationalDate !== startIso.date) return fail("INVALID_REQUEST", "Station closure date does not match its UTC window.");
        return runner.query({ question: `Close ${station} from ${startIso.time}-${endIso.time} UTC on ${startIso.date}` });
      }
      const start = utcTime(plan.entities.startUtc); const end = utcTime(plan.entities.endUtc);
      if (!start || !end) return fail("INVALID_REQUEST", "Station closure times must be UTC HH:MM or ISO UTC values.");
      return runner.query({ question: `Close ${station} from ${start}-${end} UTC${plan.entities.operationalDate ? ` on ${plan.entities.operationalDate}` : ""}` });
    }
    case "CERT_EXPIRY": {
      if (crewIds.length !== 1) return fail("INVALID_REQUEST", "CERT_EXPIRY requires exactly one crew ID.");
      const certificationType = plan.entities.certificationType?.trim().toLowerCase().replace(/[\s-]+/g, "_");
      const knownCertificationTypes = new Set<string>(graph.certifications.map((certification) => certification.certType));
      if (certificationType && !knownCertificationTypes.has(certificationType)) return fail("INVALID_REQUEST", `unknown certification ${certificationType}`);
      const cert = certificationType ? ` certification type ${certificationType}` : " certification";
      const date = plan.entities.operationalDate ? ` on ${plan.entities.operationalDate}` : "";
      return runner.query({ question: `Check ${crewIds[0]}${cert} expiry${date}` });
    }
    case "MULTI_SICK": {
      if (crewIds.length < 2 || crewIds.length > 3 || new Set(crewIds).size !== crewIds.length) return fail("INVALID_REQUEST", "MULTI_SICK requires two or three unique crew IDs.");
      const names = crewIds.length === 2 ? crewIds.join(" and ") : `${crewIds.slice(0, -1).join(", ")} and ${crewIds.at(-1)}`;
      return runner.query({ question: `${names} report sick${plan.entities.operationalDate ? ` on ${plan.entities.operationalDate}` : ""}` });
    }
    case "LOOKUP": case "UNKNOWN": return fail("UNSUPPORTED_INTENT", "This request does not map to a supported deterministic CrewOps capability.");
  }
}
