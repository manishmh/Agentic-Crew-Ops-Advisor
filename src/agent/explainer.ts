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
function moneyValue(value: string): number {
  return Number(value.replace(/[^\d]/g, ""));
}
function recoveryRecord(result: CrewOpsQuerySuccess): Record<string, unknown> {
  return result.recovery as unknown as Record<string, unknown>;
}
function recommendedAssignments(result: CrewOpsQuerySuccess): Array<Record<string, unknown>> {
  const recovery = recoveryRecord(result);
  const plan = typeof recovery.recommendedPlan === "object" && recovery.recommendedPlan !== null
    ? recovery.recommendedPlan as Record<string, unknown>
    : undefined;
  if (Array.isArray(plan?.assignments)) {
    return plan.assignments.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
  }
  return typeof recovery.recommended === "object" && recovery.recommended !== null
    ? [recovery.recommended as Record<string, unknown>]
    : [];
}
function planTotal(result: CrewOpsQuerySuccess): number | undefined {
  const plan = recoveryRecord(result).recommendedPlan;
  if (typeof plan === "object" && plan !== null && typeof (plan as Record<string, unknown>).totalCost === "number") {
    return (plan as Record<string, number>).totalCost;
  }
  const recommended = recoveryRecord(result).recommended;
  const cost = typeof recommended === "object" && recommended !== null
    ? (recommended as Record<string, unknown>).cost
    : undefined;
  return typeof cost === "object" && cost !== null && typeof (cost as Record<string, unknown>).total === "number"
    ? (cost as Record<string, number>).total
    : undefined;
}
function planDelayMinutes(result: CrewOpsQuerySuccess): number | undefined {
  const plan = recoveryRecord(result).recommendedPlan;
  if (typeof plan === "object" && plan !== null && typeof (plan as Record<string, unknown>).delayMinutes === "number") {
    return (plan as Record<string, number>).delayMinutes;
  }
  const delays = recommendedAssignments(result).flatMap((item) => typeof item.delayMinutes === "number" ? [item.delayMinutes] : []);
  return delays.length > 0 ? Math.max(...delays) : undefined;
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
    if (crew && amount && costs.has(crew) && !costs.get(crew)!.has(moneyValue(amount))) return false;
  }
  const total = planTotal(result);
  const totalClaims = [
    ...text.matchAll(/(?:total(?:\s+(?:plan|recovery))?\s+cost|plan\s+total)(?:\s+(?:is|of|at))?\s*[:=]?\s*((?:₹|INR\s*)[\d,]+)/gi),
    ...text.matchAll(/((?:₹|INR\s*)[\d,]+)\s+(?:(?:is\s+)?(?:the\s+)?)?(?:total(?:\s+(?:plan|recovery))?\s+cost|plan\s+total)/gi),
  ];
  if (totalClaims.some((claim) => total === undefined || moneyValue(claim[1]) !== total)) return false;

  const selected = recommendedAssignments(result);
  const selectedCrew = new Set(selected.flatMap((item) => typeof item.crewId === "string" ? [item.crewId.toUpperCase()] : []));
  for (const sentence of text.split(/[.!?]/)) {
    if (!/\b(?:selected|recommended|recommendation)\b/i.test(sentence)) continue;
    const mentioned = sentence.match(/\bC-\d{4}\b/gi) ?? [];
    if (mentioned.some((crewId) => !selectedCrew.has(crewId.toUpperCase()))) return false;
  }
  const positioningRequired = selected.some((item) => {
    const positioning = item.positioning;
    return item.method === "positioning" || (typeof positioning === "object" && positioning !== null && (positioning as Record<string, unknown>).required === true);
  });
  const deniesPositioning = /\b(?:no positioning|positioning (?:is )?not required|does not require positioning|without positioning)\b/i.test(text);
  if (deniesPositioning && positioningRequired) return false;
  if (!deniesPositioning && /\bpositioning (?:is )?required\b/i.test(text) && !positioningRequired) return false;
  const recoveryDelay = planDelayMinutes(result);
  const delayClaims = [
    ...text.matchAll(/(?:recovery|plan|operational)(?:[- ]introduced)?\s+delay(?:\s+(?:is|of))?\s*[:=]?\s*(\d+)\s*(?:minutes?|mins?)/gi),
    ...text.matchAll(/(?:recovery|plan)\s+(?:adds|introduces)\s+(\d+)\s*(?:minutes?|mins?)\s+(?:of\s+)?delay/gi),
  ];
  if (delayClaims.some((claim) => recoveryDelay === undefined || Number(claim[1]) !== recoveryDelay)) return false;
  const alternatives = result.recovery.alternatives as unknown as Array<Record<string, unknown>>;
  for (const sentence of text.split(/[.!?]/)) {
    const crew = sentence.match(/\bC-\d{4}\b/i)?.[0]?.toUpperCase();
    if (!crew) continue;
    const matching = [...selected, ...alternatives].filter((item) => item.crewId === crew);
    const hasComponent = (item: Record<string, unknown>, type: string) => {
      const cost = typeof item.cost === "object" && item.cost !== null ? item.cost as Record<string, unknown> : undefined;
      return Array.isArray(cost?.components) && cost.components.some((component) => typeof component === "object" && component !== null && (component as Record<string, unknown>).type === type);
    };
    if (/\breserve\b/i.test(sentence) && matching.length > 0 && matching.every((item) => !hasComponent(item, "reserve_callout"))) return false;
    if (/\bday[- ]off\b/i.test(sentence) && matching.length > 0 && matching.every((item) => !hasComponent(item, "dayoff_callout"))) return false;
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
