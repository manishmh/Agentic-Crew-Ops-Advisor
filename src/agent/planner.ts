import type { LlmProvider } from "./provider.js";
import { PLANNER_SYSTEM_PROMPT } from "./prompts.js";
import type { AgentIntent, PlannerEntities, PlannerPlan } from "./types.js";

const INTENTS = new Set<AgentIntent>(["SICK_CREW", "DELAY", "STATION_CLOSURE", "CERT_EXPIRY", "MULTI_SICK", "LOOKUP", "UNKNOWN"]);
const stringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");
const absent = (value: unknown): value is undefined | null => value === undefined || value === null;
const hasOnlyKeys = (record: Record<string, unknown>, allowed: readonly string[]): boolean => Object.keys(record).every((key) => allowed.includes(key));

export function validatePlannerPlan(value: unknown): PlannerPlan | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (!hasOnlyKeys(record, ["intent", "entities", "needsClarification", "clarificationQuestion"])) return undefined;
  if (typeof record.intent !== "string" || !INTENTS.has(record.intent as AgentIntent) || typeof record.needsClarification !== "boolean" || typeof record.entities !== "object" || record.entities === null) return undefined;
  if (!absent(record.clarificationQuestion) && typeof record.clarificationQuestion !== "string") return undefined;
  if (record.needsClarification && !record.clarificationQuestion) return undefined;
  const raw = record.entities as Record<string, unknown>;
  if (!hasOnlyKeys(raw, ["crewIds", "flightIds", "station", "certificationType", "delayMinutes", "startUtc", "endUtc", "operationalDate"])) return undefined;
  if (!absent(raw.crewIds) && !stringArray(raw.crewIds)) return undefined;
  if (!absent(raw.flightIds) && !stringArray(raw.flightIds)) return undefined;
  for (const key of ["station", "certificationType", "startUtc", "endUtc", "operationalDate"] as const) if (!absent(raw[key]) && typeof raw[key] !== "string") return undefined;
  if (!absent(raw.delayMinutes) && (typeof raw.delayMinutes !== "number" || !Number.isFinite(raw.delayMinutes))) return undefined;
  const entities: PlannerEntities = {
    crewIds: (raw.crewIds ?? undefined) as string[] | undefined,
    flightIds: (raw.flightIds ?? undefined) as string[] | undefined,
    station: (raw.station ?? undefined) as string | undefined,
    certificationType: (raw.certificationType ?? undefined) as string | undefined,
    delayMinutes: (raw.delayMinutes ?? undefined) as number | undefined,
    startUtc: (raw.startUtc ?? undefined) as string | undefined,
    endUtc: (raw.endUtc ?? undefined) as string | undefined,
    operationalDate: (raw.operationalDate ?? undefined) as string | undefined,
  };
  return { intent: record.intent as AgentIntent, entities, needsClarification: record.needsClarification, clarificationQuestion: (record.clarificationQuestion ?? undefined) as string | undefined };
}

export const PLANNER_SCHEMA: Record<string, unknown> = {
  type: "object", additionalProperties: false, required: ["intent", "entities", "needsClarification", "clarificationQuestion"],
  properties: {
    intent: { type: "string", enum: [...INTENTS] },
    entities: {
      type: "object",
      additionalProperties: false,
      required: ["crewIds", "flightIds", "station", "certificationType", "delayMinutes", "startUtc", "endUtc", "operationalDate"],
      properties: {
        crewIds: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }] },
        flightIds: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }] },
        station: { type: ["string", "null"] },
        certificationType: { type: ["string", "null"] },
        delayMinutes: { type: ["number", "null"] },
        startUtc: { type: ["string", "null"] },
        endUtc: { type: ["string", "null"] },
        operationalDate: { type: ["string", "null"] },
      },
    },
    needsClarification: { type: "boolean" }, clarificationQuestion: { type: ["string", "null"] },
  },
};

export async function planQuestion(provider: LlmProvider, question: string): Promise<PlannerPlan> {
  const raw = await provider.generateStructured({ system: PLANNER_SYSTEM_PROMPT, user: question, schemaName: "crewops_plan", schema: PLANNER_SCHEMA });
  const plan = validatePlannerPlan(raw);
  if (!plan) throw new Error("Planner returned an invalid structured plan");
  return plan;
}
