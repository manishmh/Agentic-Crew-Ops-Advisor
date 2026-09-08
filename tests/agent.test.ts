import { beforeAll, describe, expect, test } from "vitest";
import { resolve } from "node:path";
import { createCrewOpsQueryService, type CrewOpsQueryRequest, type CrewOpsQueryResponse } from "../src/api/crewopsQuery.js";
import { createAgentCrewOpsQueryService } from "../src/agent/service.js";
import { executePlan, type Tier2QueryRunner } from "../src/agent/controller.js";
import { explanationIsGrounded } from "../src/agent/explainer.js";
import { planQuestion, validatePlannerPlan } from "../src/agent/planner.js";
import { createLlmProviderFromEnv, OpenAiResponsesProvider, ProviderRequestError, type LlmProvider, type StructuredGenerationRequest, type TextGenerationRequest } from "../src/agent/provider.js";
import { vi } from "vitest";
import type { PlannerPlan } from "../src/agent/types.js";
import { loadOperationalGraph } from "../src/data/loader.js";
import type { OperationalGraph } from "../src/data/graph.js";
import { agentCases } from "../evals/agentCases.js";

class ScriptedProvider implements LlmProvider {
  readonly name = "fake";
  readonly model = "scripted-test";
  structuredCalls = 0;
  textCalls = 0;

  constructor(
    private readonly structured: unknown | Error,
    private readonly text: string | Error = "Deterministic CrewOps result returned.",
  ) {}

  async generateStructured(_request: StructuredGenerationRequest): Promise<unknown> {
    this.structuredCalls += 1;
    if (this.structured instanceof Error) throw this.structured;
    return structuredClone(this.structured);
  }

  async generateText(_request: TextGenerationRequest): Promise<string> {
    this.textCalls += 1;
    if (this.text instanceof Error) throw this.text;
    return this.text;
  }
}

let graph: OperationalGraph;
let tier2: ReturnType<typeof createCrewOpsQueryService>;

const plan = (value: Partial<PlannerPlan> & Pick<PlannerPlan, "intent">): PlannerPlan => ({
  intent: value.intent,
  entities: value.entities ?? {},
  needsClarification: value.needsClarification ?? false,
  clarificationQuestion: value.clarificationQuestion,
});
const validPlannerJson = JSON.stringify({ intent: "SICK_CREW", entities: {}, needsClarification: false, clarificationQuestion: null });
const responsesProvider = (payload: unknown) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } })));
  return new OpenAiResponsesProvider({ apiKey: "test-key", model: "test-model" });
};

beforeAll(() => {
  graph = loadOperationalGraph(resolve(process.cwd(), "data")).graph;
  tier2 = createCrewOpsQueryService(graph);
});

describe("Tier 3 structured planner and controller", () => {
  test("OpenAI provider joins the Responses endpoint once and retains sanitized API errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "Model is unavailable", type: "invalid_request_error", code: "model_not_found" } }), { status: 404, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const provider = new OpenAiResponsesProvider({ apiKey: "test-key", model: "test-model", baseUrl: "https://api.openai.com/v1/responses/" });
      await expect(provider.generateStructured({ system: "route", user: "test", schemaName: "test", schema: {} })).rejects.toMatchObject({
        diagnostic: { kind: "http", status: 404, type: "invalid_request_error", code: "model_not_found", message: "Model is unavailable" },
      });
      expect(fetchMock).toHaveBeenCalledWith("https://api.openai.com/v1/responses", expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer test-key" }), body: expect.stringContaining('"model":"test-model"') }));
    } finally { vi.unstubAllGlobals(); }
  });

  test.each([
    ["reasoning before assistant message", { output: [{ type: "reasoning", summary: [] }, { type: "message", role: "assistant", content: [{ type: "output_text", text: validPlannerJson }] }] }],
    ["multiple reasoning items before assistant message", { output: [{ type: "reasoning" }, { type: "reasoning" }, { type: "message", role: "assistant", content: [{ type: "output_text", text: validPlannerJson }] }] }],
    ["assistant message as first item", { output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: validPlannerJson }] }] }],
  ])("extracts structured output with %s", async (_name, payload) => {
    const provider = responsesProvider(payload);
    try {
      await expect(provider.generateStructured({ system: "route", user: "test", schemaName: "test", schema: {} })).resolves.toEqual(JSON.parse(validPlannerJson));
    } finally { vi.unstubAllGlobals(); }
  });

  test("collects multiple output_text content items and preserves top-level output_text compatibility", async () => {
    let provider = responsesProvider({ output: [{ type: "reasoning" }, { type: "message", role: "assistant", content: [{ type: "output_text", text: "Impact. " }, { type: "output_text", text: "Recommendation." }] }] });
    try { await expect(provider.generateText({ system: "explain", user: "result" })).resolves.toBe("Impact. Recommendation."); }
    finally { vi.unstubAllGlobals(); }
    provider = responsesProvider({ output_text: "SDK-compatible text", output: [{ type: "reasoning" }] });
    try { await expect(provider.generateText({ system: "explain", user: "result" })).resolves.toBe("SDK-compatible text"); }
    finally { vi.unstubAllGlobals(); }
  });

  test("rejects missing assistant output text and malformed structured JSON with sanitized parse diagnostics", async () => {
    let provider = responsesProvider({ output: [{ type: "reasoning" }, { type: "message", role: "assistant", content: [{ type: "refusal", refusal: "no" }] }] });
    try {
      await expect(provider.generateText({ system: "explain", user: "result" })).rejects.toMatchObject({ diagnostic: { phase: "response_parse", kind: "output_shape" } });
    } finally { vi.unstubAllGlobals(); }
    provider = responsesProvider({ output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "not-json" }] }] });
    try {
      await expect(provider.generateStructured({ system: "route", user: "test", schemaName: "test", schema: {} })).rejects.toMatchObject({ diagnostic: { phase: "response_parse", code: "invalid_json" } });
    } finally { vi.unstubAllGlobals(); }
  });

  test("parsed structured JSON still must pass the finite PlannerPlan enum validation", async () => {
    const provider = responsesProvider({ output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify({ intent: "report_absence", entities: {}, needsClarification: false, clarificationQuestion: null }) }] }] });
    try {
      await expect(planQuestion(provider, "C-1042 is sick")).rejects.toThrow("Planner returned an invalid structured plan");
    } finally { vi.unstubAllGlobals(); }
  });
  test("evaluation corpus is a deterministic, schema-valid interpretation corpus", () => {
    expect(agentCases).toHaveLength(46);
    for (const item of agentCases) {
      expect(validatePlannerPlan(plan({ intent: item.expectedIntent, entities: item.expectedEntities, needsClarification: item.expectClarification, clarificationQuestion: item.expectClarification ? "Please clarify." : undefined }))).toBeDefined();
    }
  });
  test.each([
    {
      question: "Captain C-1042 just called in sick. What should we do?",
      planned: plan({ intent: "SICK_CREW", entities: { crewIds: ["C-1042"] } }),
      expected: { type: "SICK_CREW", entity: ["crewId", "C-1042"] },
    },
    {
      question: "Push DX412 back by an hour and a half",
      planned: plan({ intent: "DELAY", entities: { flightIds: ["DX412"], delayMinutes: 90 } }),
      expected: { type: "DELAY", entity: ["delayMinutes", 90] },
    },
    {
      question: "HYD won't be usable between 5 and 9 UTC",
      planned: plan({ intent: "STATION_CLOSURE", entities: { station: "HYD", startUtc: "05:00", endUtc: "09:00" } }),
      expected: { type: "STATION_CLOSURE", entity: ["station", "HYD"] },
    },
    {
      question: "Can C-5417 still work after recurrent training expires?",
      planned: plan({ intent: "CERT_EXPIRY", entities: { crewIds: ["C-5417"], certificationType: "recurrent training" } }),
      expected: { type: "CERT_EXPIRY", entity: ["certificationType", "recurrent_training"] },
    },
    {
      question: "C-3940 and C-1938 are both unavailable",
      planned: plan({ intent: "MULTI_SICK", entities: { crewIds: ["C-3940", "C-1938"], operationalDate: "2026-09-18" } }),
      expected: { type: "MULTI_SICK", entity: ["unavailableCrewCount", 2] },
    },
  ])("routes planner wording: $question", async ({ question, planned, expected }) => {
    const provider = new ScriptedProvider(planned);
    const result = await createAgentCrewOpsQueryService(graph, provider, tier2).query({ question });
    if (!result.success) throw new Error(result.error.message);
    expect(result.intent.type).toBe(expected.type);
    expect(result.entities).toHaveProperty(expected.entity[0] as string, expected.entity[1]);
    if (result.intent.type === "MULTI_SICK") expect(result.entities.unavailableCrew).toEqual(expect.arrayContaining([expect.objectContaining({ crewId: "C-3940" }), expect.objectContaining({ crewId: "C-1938" })]));
    expect(result.agent).toMatchObject({ plannerUsed: true, plannerFallback: false, explainerUsed: true, provider: "fake", model: "scripted-test" });
    expect(result.naturalLanguageAnswer).toBe("Deterministic CrewOps result returned.");
  });

  test("runtime validation accepts strict nullable fields and rejects extra or malformed output", () => {
    expect(validatePlannerPlan({ intent: "DELAY", entities: { crewIds: null, flightIds: ["DX412"], station: null, certificationType: null, delayMinutes: 90, startUtc: null, endUtc: null, operationalDate: null }, needsClarification: false, clarificationQuestion: null })).toEqual(plan({ intent: "DELAY", entities: { flightIds: ["DX412"], delayMinutes: 90 } }));
    expect(validatePlannerPlan({ intent: "DELAY", entities: {}, needsClarification: false, extra: true })).toBeUndefined();
    expect(validatePlannerPlan({ intent: "DELAY", entities: { delayMinutes: "ninety" }, needsClarification: false })).toBeUndefined();
  });

  test("planner clarification prevents deterministic tool execution", async () => {
    let calls = 0;
    const runner: Tier2QueryRunner = { query: (_request: CrewOpsQueryRequest): CrewOpsQueryResponse => { calls += 1; return { success: false, error: { code: "UNSUPPORTED_INTENT", message: "should not run" } }; } };
    const provider = new ScriptedProvider(plan({ intent: "DELAY", entities: { flightIds: ["DX412"] }, needsClarification: true, clarificationQuestion: "How long should DX412 be delayed?" }));
    const result = await createAgentCrewOpsQueryService(graph, provider, runner).query({ question: "Delay DX412" });
    expect(result).toMatchObject({ success: false, error: { code: "CLARIFICATION_REQUIRED", message: "How long should DX412 be delayed?" } });
    expect(calls).toBe(0);
    expect(provider.textCalls).toBe(0);
  });

  test("deterministic entity validation rejects invented entities and unsupported intents", () => {
    expect(executePlan(graph, tier2, plan({ intent: "SICK_CREW", entities: { crewIds: ["C-9999"] } }))).toMatchObject({ success: false, error: { code: "INVALID_REQUEST", message: "unknown crew C-9999" } });
    expect(executePlan(graph, tier2, plan({ intent: "DELAY", entities: { flightIds: ["DX999"], delayMinutes: 90 } }))).toMatchObject({ success: false, error: { code: "INVALID_REQUEST", message: "unknown flight DX999" } });
    expect(executePlan(graph, tier2, plan({ intent: "CERT_EXPIRY", entities: { crewIds: ["C-5417"], certificationType: "invented_cert" } }))).toMatchObject({ success: false, error: { code: "INVALID_REQUEST", message: "unknown certification invented_cert" } });
    expect(executePlan(graph, tier2, plan({ intent: "UNKNOWN" }))).toMatchObject({ success: false, error: { code: "UNSUPPORTED_INTENT" } });
  });

  test("prompt injection cannot grant deterministic authority", () => {
    for (const item of agentCases.filter((candidate) => candidate.category === "injection" && candidate.expectedIntent === "SICK_CREW")) {
      const result = executePlan(graph, tier2, plan({ intent: item.expectedIntent, entities: item.expectedEntities, needsClarification: item.expectClarification, clarificationQuestion: "Please clarify the disruption." }));
      expect(result).toMatchObject({ success: false, error: { code: "CLARIFICATION_REQUIRED" } });
    }
    expect(executePlan(graph, tier2, plan({ intent: "UNKNOWN" }))).toMatchObject({ success: false, error: { code: "UNSUPPORTED_INTENT" } });
  });
});

describe("Tier 3 safe fallback and grounded explanation", () => {
  test.each([
    ["malformed planner output", new ScriptedProvider({ intent: "SICK_CREW" })],
    ["planner provider failure", new ScriptedProvider(new Error("provider unavailable"))],
    ["planner timeout", new ScriptedProvider(new Error("AbortError: timeout"))],
  ])("falls back to the deterministic parser after %s", async (_label, provider) => {
    const result = await createAgentCrewOpsQueryService(graph, provider, tier2).query({ question: "What happens if C-1042 reports sick?" });
    if (!result.success) throw new Error(result.error.message);
    expect(result.intent.type).toBe("SICK_CREW");
    expect(result.recovery.recommended?.crewId).toBe("C-3310");
    expect(result.agent).toMatchObject({ plannerUsed: true, plannerFallback: true, fallbackUsed: true });
    expect(result.warnings).toContain("Agent planner unavailable or invalid; deterministic query parsing was used.");
  });

  test("an unsupported provider route falls back when the deterministic parser recognizes it", async () => {
    const provider = new ScriptedProvider(plan({ intent: "UNKNOWN" }));
    const result = await createAgentCrewOpsQueryService(graph, provider, tier2).query({ question: "What happens if C-1042 reports sick?" });
    expect(result).toMatchObject({ success: true, intent: { type: "SICK_CREW" }, agent: { plannerFallback: true, fallbackUsed: true } });
  });

  test("missing API key leaves the five Tier-2 paths usable in deterministic mode", async () => {
    expect(createLlmProviderFromEnv({ CREWOPS_LLM_PROVIDER: "openai", CREWOPS_LLM_API_KEY: "" })).toBeUndefined();
    const service = createAgentCrewOpsQueryService(graph, undefined, tier2);
    const questions = [
      "What happens if C-1042 reports sick?",
      "Delay DX412 by 90 minutes",
      "Close HYD from 05:00-09:00 UTC",
      "What happens if C-5417's recurrent training expires?",
      "C-3940 and C-1938 report sick on 2026-09-18",
    ];
    for (const question of questions) {
      const result = await service.query({ question });
      expect(result.success).toBe(true);
      expect(result.agent).toMatchObject({ plannerUsed: false, plannerFallback: true, explainerUsed: false, fallbackUsed: true });
    }
  });

  test("malformed API input never reaches the model", async () => {
    const provider = new ScriptedProvider(plan({ intent: "SICK_CREW", entities: { crewIds: ["C-1042"] } }));
    const result = await createAgentCrewOpsQueryService(graph, provider, tier2).query({ question: "" });
    expect(result).toMatchObject({ success: false, error: { code: "INVALID_REQUEST" }, agent: { plannerUsed: false, plannerFallback: true } });
    expect(provider.structuredCalls).toBe(0);
    expect(provider.textCalls).toBe(0);
  });

  test("explainer failure or an ungrounded claim returns the deterministic summary", async () => {
    const planned = plan({ intent: "SICK_CREW", entities: { crewIds: ["C-1042"] } });
    for (const provider of [new ScriptedProvider(planned, new Error("explainer down")), new ScriptedProvider(planned, "C-9999 is the best recovery at ₹99,999.")]) {
      const result = await createAgentCrewOpsQueryService(graph, provider, tier2).query({ question: "Captain C-1042 is unavailable" });
      if (!result.success) throw new Error(result.error.message);
      expect(result.naturalLanguageAnswer).toBe(result.summary);
      expect(result.agent).toMatchObject({ plannerUsed: true, explainerUsed: false, fallbackUsed: true });
    }
  });

  test("grounding guard rejects altered operational IDs, amounts, rules, flights, and durations", () => {
    const deterministic = tier2.query({ question: "What happens if C-1042 reports sick?" });
    if (!deterministic.success) throw new Error(deterministic.error.message);
    for (const badAnswer of [
      "C-9999 is selected.",
      "C-3310 costs ₹15,000.",
      "C-3310 is rejected under RULE-DUTY-99.",
      "DX999 is affected.",
      "The recovery adds 99999 minutes.",
    ]) expect(explanationIsGrounded(badAnswer, deterministic)).toBe(false);
  });

  test("grounding guard preserves delay-plan totals, selection, method, positioning, and recovery delay", () => {
    const deterministic = tier2.query({ question: "Delay DX413 by 75 minutes" });
    if (!deterministic.success) throw new Error(deterministic.error.message);
    expect(explanationIsGrounded(
      "C-3310 is selected at ₹18,500. Total plan cost is ₹56,000. Operational delay is 0 minutes. No positioning is required.",
      deterministic,
    )).toBe(true);
    expect(explanationIsGrounded("The total plan cost is ₹18,500.", deterministic)).toBe(false);
    expect(explanationIsGrounded("₹18,500 is the total recovery cost.", deterministic)).toBe(false);
    expect(explanationIsGrounded("C-2210 is the selected recovery.", deterministic)).toBe(false);
    expect(explanationIsGrounded("The recovery introduces 15 minutes of delay.", deterministic)).toBe(false);
    expect(explanationIsGrounded("Positioning is required for the selected plan.", deterministic)).toBe(false);
    const dayoff = deterministic.recovery.alternatives.find((option) => option.method === "dayoff" && option.crewId);
    if (!dayoff?.crewId) throw new Error("expected a day-off alternative");
    expect(explanationIsGrounded(`${dayoff.crewId} is a reserve alternative.`, deterministic)).toBe(false);

    const positioned = structuredClone(deterministic);
    const c2210 = positioned.recovery.alternatives.find((option) => option.crewId === "C-2210");
    if (!c2210) throw new Error("expected positioned C-2210 alternative");
    positioned.recovery.recommended = c2210;
    positioned.recovery.recommendedPlan = {
      strategy: "partial",
      totalCost: c2210.cost.total,
      assignments: [c2210],
      delayMinutes: c2210.delayMinutes,
      positioningRequired: true,
      costComponents: c2210.cost.components,
    };
    expect(explanationIsGrounded("C-2210 is selected with no positioning required.", positioned)).toBe(false);
  });

  test("grounded explanation is additive and cannot alter deterministic recovery", async () => {
    const deterministic = tier2.query({ question: "What happens if C-1042 reports sick?" });
    if (!deterministic.success) throw new Error(deterministic.error.message);
    const provider = new ScriptedProvider(plan({ intent: "SICK_CREW", entities: { crewIds: ["C-1042"] } }), "C-1042 affects P-2291. C-3310 is the deterministic recommendation at ₹18,500.");
    const result = await createAgentCrewOpsQueryService(graph, provider, tier2).query({ question: "Captain C-1042 called in sick" });
    if (!result.success) throw new Error(result.error.message);
    expect(result.naturalLanguageAnswer).toContain("C-3310");
    expect(result.recovery).toEqual(deterministic.recovery);
    expect(result.consequences).toEqual(deterministic.consequences);
    expect(result.evidence).toEqual(deterministic.evidence);
    expect(result.recovery.alternatives).toEqual(deterministic.recovery.alternatives);
    expect(explanationIsGrounded(result.naturalLanguageAnswer ?? "", deterministic)).toBe(true);
  });

  test("agent fields are additive and leave the multi-crew joint allocation immutable", async () => {
    const question = "C-3940 and C-1938 report sick on 2026-09-18";
    const deterministic = tier2.query({ question });
    if (!deterministic.success) throw new Error(deterministic.error.message);
    const provider = new ScriptedProvider(plan({ intent: "MULTI_SICK", entities: { crewIds: ["C-3940", "C-1938"], operationalDate: "2026-09-18" } }));
    const result = await createAgentCrewOpsQueryService(graph, provider, tier2).query({ question });
    if (!result.success) throw new Error(result.error.message);
    const { agent: _agent, naturalLanguageAnswer: _answer, ...structured } = result;
    expect(structured).toEqual(deterministic);
  });
});
