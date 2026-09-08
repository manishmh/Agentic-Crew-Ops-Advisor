import type { CrewOpsQuerySuccess } from "../api/crewopsQuery.js";
import type { LlmProvider } from "./provider.js";
import { EXPLAINER_SYSTEM_PROMPT } from "./prompts.js";

const normalized = (value: string) => value.replaceAll(",", "").toUpperCase();
function numericValues(value: unknown, values = new Set<number>()): Set<number> {
  if (typeof value === "number" && Number.isFinite(value)) values.add(value);
  else if (Array.isArray(value)) value.forEach((item) => numericValues(item, values));
  else if (typeof value === "object" && value !== null) Object.values(value).forEach((item) => numericValues(item, values));
  return values;
}
function crewCosts(value: unknown, costs = new Map<string, Set<number>>): Map<string, Set<number>> {
  if (Array.isArray(value)) value.forEach((item) => crewCosts(item, costs));
  else if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const crewId = typeof record.crewId === "string" ? record.crewId.toUpperCase() : undefined;
    const total = typeof record.cost === "object" && record.cost !== null && typeof (record.cost as Record<string, unknown>).total === "number"
      ? (record.cost as Record<string, number>).total : undefined;
    if (crewId && total !== undefined) (costs.get(crewId) ?? costs.set(crewId, new Set()).get(crewId)!).add(total);
    Object.values(record).forEach((item) => crewCosts(item, costs));
  }
  return costs;
}
export function explanationIsGrounded(text: string, result: CrewOpsQuerySuccess): boolean {
  if (!text.trim()) return false;
  const source = normalized(JSON.stringify(result));
  const identifiers = text.match(/\b(?:C-\d{4}|DX\d+(?:-\d{4}-\d{2}-\d{2})?|P-\d+|RULE-[A-Z]+-\d+)\b/gi) ?? [];
  if (identifiers.some((token) => !source.includes(normalized(token)))) return false;
  const money = text.match(/(?:₹|INR\s*)[\d,]+/gi) ?? [];
  if (money.some((token) => !source.includes(token.replace(/[^\d]/g, "")))) return false;
  const costs = crewCosts(result);
  for (const sentence of text.split(/[.!?]/)) {
    const crew = sentence.match(/\bC-\d{4}\b/i)?.[0]?.toUpperCase();
    const amount = sentence.match(/(?:₹|INR\s*)[\d,]+/i)?.[0];
    if (crew && amount && costs.has(crew) && !costs.get(crew)!.has(Number(amount.replace(/[^\d]/g, "")))) return false;
  }
  // Unit-bearing values are operational claims; validate the number without trying
  // to police harmless prose or percentages that happen to contain a number.
  const values = numericValues(result);
  const durations = text.match(/\b(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|hours?|hrs?)\b/gi) ?? [];
  return !durations.some((token) => !values.has(Number(token.match(/\d+(?:\.\d+)?/)?.[0])));
}
export async function explainResult(provider: LlmProvider, result: CrewOpsQuerySuccess): Promise<string> {
  const immutableCopy = structuredClone(result);
  const text = await provider.generateText({ system: EXPLAINER_SYSTEM_PROMPT, user: JSON.stringify(immutableCopy) });
  if (!explanationIsGrounded(text, immutableCopy)) throw new Error("Explainer output failed grounding validation");
  return text.trim();
}
