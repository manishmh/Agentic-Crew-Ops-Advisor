/**
 * Shared evidence shapes for deterministic rule checks (STEP 2).
 *
 * Every checker returns machine-readable evidence — never a bare boolean —
 * so candidate generation, simulation, ranking, and the future LLM
 * explainer can all consume the same result.
 */

import type { RuleId } from "../domain/types.js";

/** One evaluated rule: pass/fail plus the numbers behind it. */
export interface RuleCheck<E> {
  ruleId: RuleId;
  passed: boolean;
  evidence: E;
}

/** One breach, aggregated by the combined legality check. */
export interface RuleViolation {
  ruleId: RuleId;
  message: string;
  actual?: number;
  limit?: number;
  details?: Record<string, unknown>;
}
