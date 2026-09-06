/**
 * findRecoveryOptions / optimizeRecovery — tool wrappers over the Step-3
 * solver and joint allocator. Routing + ToolResult shaping only: candidate
 * search, legality, pricing, ranking, and joint optimization all run
 * inside the deterministic engine.
 */

import type { OperationalGraph } from "../data/graph.js";
import { allocateJoint, type JointCoverRequest, type JointPlan } from "../recovery/allocation.js";
import { solveCrewCover, type CoverSolution } from "../recovery/recovery.js";
import type { CrewRank, PairingId } from "../domain/types.js";
import { fail, ok, type ToolResult } from "./types.js";
import { collectLegalityEvidence } from "./evidence.js";

export interface FindOptionsInput {
  pairingId: PairingId;
  role: CrewRank;
  sickCrewId: string;
  reportedUtc?: string;
  extraExcludeCrewIds?: string[];
}

export function findRecoveryOptions(g: OperationalGraph, input: FindOptionsInput): ToolResult<CoverSolution> {
  try {
    const solution = solveCrewCover(g, input);
    const evidence = solution.ranked.flatMap((o) => (o.legality ? collectLegalityEvidence(o.legality) : []));
    return ok(
      "RECOVERY_OPTIONS",
      solution.selected
        ? `best: ${solution.selected.kind === "cancel" ? "cancel" : solution.selected.crewId} at ${solution.totalCost} ${g.costs.currency}`
        : "no options available",
      solution,
      evidence,
      solution.rejected.length > 0 ? [`${solution.rejected.length} candidate(s) rejected (see data.rejected)`] : [],
    );
  } catch (e) {
    return fail("RECOVERY_OPTIONS", "option search failed", e instanceof Error ? e.message : String(e));
  }
}

export interface OptimizeInput {
  requests: Array<{ pairingId: PairingId; role: CrewRank; sickCrewId: string; reportedUtc?: string }>;
}

export function optimizeRecovery(g: OperationalGraph, input: OptimizeInput): ToolResult<JointPlan> {
  try {
    const requests: JointCoverRequest[] = input.requests.map((r) => ({ ...r }));
    const plan = allocateJoint(g, requests);
    const evidence = plan.perDisruption.flatMap((s) =>
      s.ranked.flatMap((o) => (o.legality ? collectLegalityEvidence(o.legality) : [])),
    );
    evidence.push({ reason: `joint total ${plan.totalCost} ${g.costs.currency} across ${plan.assignments.length} assignment(s)` });
    return ok(
      "OPTIMAL_RECOVERY",
      `optimal joint plan: ${plan.assignments.map((a) => `${a.pairingId}→${a.crewId ?? "cancel"}`).join(", ")} at ${plan.totalCost}`,
      plan,
      evidence,
    );
  } catch (e) {
    return fail("OPTIMAL_RECOVERY", "joint optimization failed", e instanceof Error ? e.message : String(e));
  }
}
