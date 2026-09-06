/**
 * Orchestration-layer contract (application layer over locked Steps 1–3).
 *
 * The deterministic engine remains authoritative: tools only route typed
 * inputs into Step-1 indexes and Step-2/3 primitives and reshape their
 * outputs. No arithmetic, legality decision, or cost figure originates
 * here — every number is computed below and carried up with evidence.
 */

import type { CostBreakdown } from "../recovery/cost.js";

export type ToolResultType =
  | "SEARCH"
  | "CREW_STATUS"
  | "DISRUPTION_ANALYSIS"
  | "RECOVERY_OPTIONS"
  | "OPTIMAL_RECOVERY"
  | "EVIDENCE";

/** Tool-facing disruption event (names match the benchmark event vocabulary). */
export type ToolEvent =
  | { type: "SICK_CREW"; crewId: string; pairingId: string; reportedUtc: string }
  | { type: "DELAY"; flightId: string; delayMinutes: number }
  | { type: "STATION_CLOSURE"; station: string; startUtc: string; endUtc: string }
  | { type: "CERT_EXPIRY"; crewId: string; dutyDate: string; certificationType?: string }
  | { type: "MULTI_SICK"; events: Array<{ crewId: string; pairingId: string; reportedUtc: string }> };

/** Flat, LLM-consumable evidence item. All values engine-computed. */
export interface EvidenceItem {
  ruleId?: string;
  passed?: boolean;
  actual?: number;
  limit?: number;
  crewId?: string;
  flightId?: string;
  pairingId?: string;
  timestamps?: Record<string, string>;
  /** Structured engine-derived context for explainers; never an inferred value. */
  details?: Record<string, unknown>;
  cost?: CostBreakdown;
  reason?: string;
}

export interface ToolResult<T> {
  success: boolean;
  type: ToolResultType;
  summary: string;
  data: T;
  evidence: EvidenceItem[];
  warnings: string[];
  error?: string;
}

export function ok<T>(
  type: ToolResultType,
  summary: string,
  data: T,
  evidence: EvidenceItem[] = [],
  warnings: string[] = [],
): ToolResult<T> {
  return { success: true, type, summary, data, evidence, warnings };
}

export function fail<T>(type: ToolResultType, summary: string, error: string): ToolResult<T> {
  return { success: false, type, summary, data: null as T, evidence: [], warnings: [], error };
}
