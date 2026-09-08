import { agentCases, type AgentEvalCase } from "./agentCases.js";
import { planQuestion, validatePlannerPlan } from "../src/agent/planner.js";
import { createLlmProviderFromEnv, ProviderRequestError, type LlmProvider, type ProviderDiagnostic, type StructuredGenerationRequest, type TextGenerationRequest } from "../src/agent/provider.js";
import type { PlannerPlan } from "../src/agent/types.js";

class CorpusScriptedProvider implements LlmProvider {
  readonly name = "scripted";
  readonly model = "agent-eval-corpus";
  constructor(private readonly plans: Map<string, PlannerPlan>) {}
  async generateStructured(request: StructuredGenerationRequest): Promise<unknown> {
    const plan = this.plans.get(request.user);
    if (!plan) throw new Error("No scripted plan for evaluation query");
    return structuredClone(plan);
  }
  async generateText(_request: TextGenerationRequest): Promise<string> { return ""; }
}

const toPlan = (testCase: AgentEvalCase): PlannerPlan => ({
  intent: testCase.expectedIntent,
  entities: testCase.expectedEntities,
  needsClarification: testCase.expectClarification,
  clarificationQuestion: testCase.expectClarification ? "Please provide the missing operational detail." : undefined,
});
const sameEntities = (actual: object, expected: object) =>
  Object.entries(expected).every(([key, value]) => JSON.stringify((actual as Record<string, unknown>)[key]) === JSON.stringify(value));
const percentile = (values: number[], ratio: number) => values.length === 0 ? 0 : values[Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1)];

interface EvalMetrics {
  totalCases: number;
  intentAccuracy: number;
  entityAccuracy: number;
  clarificationAccuracy: number;
  unsupportedAccuracy: number;
  schemaValidResponseRate: number;
  fallbackCount: number;
  providerFailures: number;
  medianLatencyMs?: number;
  p95LatencyMs?: number;
  maxLatencyMs?: number;
  diagnostics?: ProviderDiagnostic[];
  failedCases?: Array<{
    name: string;
    query: string;
    expectedIntent: string;
    actualIntent?: string;
    expectedEntities: PlannerPlan["entities"];
    actualEntities?: PlannerPlan["entities"];
    expectedClarification: boolean;
    actualClarification?: boolean;
  }>;
}

async function evaluate(provider: LlmProvider, cases: AgentEvalCase[]): Promise<EvalMetrics> {
  let intents = 0; let entities = 0; let clarifications = 0; let unsupported = 0; let schemas = 0; let failures = 0;
  const latencies: number[] = []; const diagnostics: ProviderDiagnostic[] = []; const failedCases: NonNullable<EvalMetrics["failedCases"]> = [];
  for (const testCase of cases) {
    const started = performance.now();
    try {
      const plan = await planQuestion(provider, testCase.query);
      if (validatePlannerPlan(plan)) schemas += 1;
      if (plan.intent === testCase.expectedIntent) intents += 1;
      if (sameEntities(plan.entities, testCase.expectedEntities)) entities += 1;
      if (plan.needsClarification === testCase.expectClarification) clarifications += 1;
      if ((plan.intent === "UNKNOWN") === testCase.expectUnsupported) unsupported += 1;
      if (plan.intent !== testCase.expectedIntent || !sameEntities(plan.entities, testCase.expectedEntities) || plan.needsClarification !== testCase.expectClarification) {
        failedCases.push({ name: testCase.name, query: testCase.query, expectedIntent: testCase.expectedIntent, actualIntent: plan.intent, expectedEntities: testCase.expectedEntities, actualEntities: plan.entities, expectedClarification: testCase.expectClarification, actualClarification: plan.needsClarification });
      }
    } catch (error) {
      failures += 1;
      if (error instanceof ProviderRequestError) diagnostics.push(error.diagnostic);
      failedCases.push({ name: testCase.name, query: testCase.query, expectedIntent: testCase.expectedIntent, expectedEntities: testCase.expectedEntities, expectedClarification: testCase.expectClarification });
    }
    finally { latencies.push(performance.now() - started); }
  }
  latencies.sort((a, b) => a - b);
  const rate = (value: number) => Number(((value / cases.length) * 100).toFixed(1));
  return {
    totalCases: cases.length, intentAccuracy: rate(intents), entityAccuracy: rate(entities), clarificationAccuracy: rate(clarifications), unsupportedAccuracy: rate(unsupported), schemaValidResponseRate: rate(schemas), fallbackCount: failures, providerFailures: failures,
    medianLatencyMs: Number(percentile(latencies, 0.5).toFixed(1)), p95LatencyMs: Number(percentile(latencies, 0.95).toFixed(1)), maxLatencyMs: Number((latencies.at(-1) ?? 0).toFixed(1)),
    diagnostics: diagnostics.length ? diagnostics : undefined,
    failedCases: failedCases.length ? failedCases : undefined,
  };
}

const print = (title: string, provider: LlmProvider, metrics: EvalMetrics) => {
  console.log(`${title} — provider=${provider.name} model=${provider.model}`);
  console.log(JSON.stringify(metrics, null, 2));
};

const live = process.argv.includes("--live");
if (live) {
  const provider = createLlmProviderFromEnv();
  if (!provider) {
    console.log("REAL PROVIDER EVAL — NOT RUN, CREDENTIAL NOT PRESENT");
    process.exitCode = 0;
  } else {
    const smokeNames = new Set(["sick-called-in", "delay-ninety", "closure-close", "cert-expired", "multi-both-sick", "ambiguous-delay", "unsupported-aircraft-swap"]);
    const metrics = await evaluate(provider, agentCases.filter((item) => smokeNames.has(item.name)));
    print("REAL PROVIDER EVAL", provider, metrics);
  }
} else {
  const provider = new CorpusScriptedProvider(new Map(agentCases.map((item) => [item.query, toPlan(item)])));
  const metrics = await evaluate(provider, agentCases);
  print("OFFLINE AGENT EVAL", provider, metrics);
}
