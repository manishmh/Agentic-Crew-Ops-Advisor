import type { OperationalGraph } from "../data/graph.js";
import { createCrewOpsQueryService, type CrewOpsQueryRequest, type CrewOpsQueryResponse } from "../api/crewopsQuery.js";
import { executePlan, type Tier2QueryRunner } from "./controller.js";
import { explainResult } from "./explainer.js";
import { planQuestion } from "./planner.js";
import type { LlmProvider } from "./provider.js";
import type { AgentCrewOpsResponse, AgentMetadata } from "./types.js";

const elapsed = (start: number) => Math.max(0, Date.now() - start);
export function createAgentCrewOpsQueryService(graph: OperationalGraph, provider?: LlmProvider, runner: Tier2QueryRunner = createCrewOpsQueryService(graph)) {
  return { async query(request: CrewOpsQueryRequest): Promise<AgentCrewOpsResponse> {
    const agent: AgentMetadata = { plannerUsed: false, plannerFallback: false, explainerUsed: false, fallbackUsed: false, provider: provider?.name, model: provider?.model, plannerMs: 0, toolMs: 0, explainerMs: 0 };
    if (!request || typeof request.question !== "string" || request.question.trim().length === 0) {
      agent.plannerFallback = true; agent.fallbackUsed = true;
      const toolStart = Date.now(); const invalid = runner.query(request); agent.toolMs = elapsed(toolStart);
      return { ...invalid, agent };
    }
    let result: CrewOpsQueryResponse;
    let plannerFailed = false;
    if (provider) {
      const start = Date.now();
      try {
        const plan = await planQuestion(provider, request.question); agent.plannerUsed = true; agent.plannerMs = elapsed(start);
        const toolStart = Date.now(); result = executePlan(graph, runner, plan);
        // A provider may validly emit UNKNOWN for wording that the frozen parser
        // understands. Preserve deterministic availability rather than treating a
        // conservative model route as authoritative.
        if (!result.success && result.error.code === "UNSUPPORTED_INTENT" && (plan.intent === "UNKNOWN" || plan.intent === "LOOKUP")) {
          const parsed = runner.query(request);
          if (parsed.success) { result = parsed; agent.plannerFallback = true; agent.fallbackUsed = true; }
        }
        agent.toolMs = elapsed(toolStart);
      } catch {
        agent.plannerUsed = true; agent.plannerFallback = true; agent.fallbackUsed = true; agent.plannerMs = elapsed(start); plannerFailed = true;
        const toolStart = Date.now(); result = runner.query(request); agent.toolMs = elapsed(toolStart);
      }
    } else {
      agent.plannerFallback = true; agent.fallbackUsed = true;
      const toolStart = Date.now(); result = runner.query(request); agent.toolMs = elapsed(toolStart);
    }
    if (!result.success) return { ...result, agent };
    let naturalLanguageAnswer = result.summary;
    if (provider && !plannerFailed) {
      const start = Date.now();
      try { naturalLanguageAnswer = await explainResult(provider, result); agent.explainerUsed = true; }
      catch { agent.fallbackUsed = true; }
      finally { agent.explainerMs = elapsed(start); }
    }
    return { ...result, warnings: agent.plannerFallback ? [...result.warnings, "Agent planner unavailable or invalid; deterministic query parsing was used."] : result.warnings, naturalLanguageAnswer, agent };
  } };
}
