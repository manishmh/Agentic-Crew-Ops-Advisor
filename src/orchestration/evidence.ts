/**
 * getEvidence — flatten engine results into LLM-consumable evidence.
 * Pure reshaping: every value already exists in the input; nothing is
 * recomputed or reinterpreted here.
 */

import type { AssignmentLegality } from "../rules/assignment.js";
import type { JointPlan } from "../recovery/allocation.js";
import type { CoverSolution } from "../recovery/recovery.js";
import type { RecoveryOption } from "../recovery/types.js";
import { fail, ok, type EvidenceItem, type ToolResult } from "./types.js";

/** One RuleCheck entry → flat items (violations attached by rule id). */
export function collectLegalityEvidence(l: AssignmentLegality): EvidenceItem[] {
  const byRule = new Map(l.violations.map((v) => [v.ruleId, v]));
  return l.checks.map((c) => {
    const v = byRule.get(c.ruleId);
    const e = c.evidence as Record<string, unknown> | undefined;
    const num = (k: string): number | undefined => (typeof e?.[k] === "number" ? (e[k] as number) : undefined);
    const item: EvidenceItem = { ruleId: c.ruleId, passed: c.passed, crewId: l.crewId, pairingId: l.pairingId };
    const actual = num("actualFdpHours") ?? num("totalHours") ?? num("restHours");
    const limit = num("limitHours") ?? num("minimumRestHours");
    if (actual !== undefined) item.actual = actual;
    if (limit !== undefined) item.limit = limit;
    if (v) {
      item.reason = v.message;
      if (v.actual !== undefined) item.actual = v.actual;
      if (v.limit !== undefined) item.limit = v.limit;
    }
    const ts: Record<string, string> = {};
    for (const k of ["reportUtc", "releaseUtc", "previousRelease", "nextReport", "windowStart", "windowEnd", "dutyDate"]) {
      if (typeof e?.[k] === "string") ts[k] = e[k] as string;
    }
    if (Object.keys(ts).length > 0) item.timestamps = ts;
    return item;
  });
}

export interface EvidenceData {
  items: EvidenceItem[];
}

function optionEvidence(o: RecoveryOption): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  if (o.legality) items.push(...collectLegalityEvidence(o.legality));
  items.push({
    crewId: o.crewId,
    pairingId: o.pairingId,
    cost: o.cost,
    reason: o.kind === "cancel" ? `cancel ${o.affectedFlights.length} flight(s)` : `cover by ${o.crewId}, delay ${o.delayHours}h`,
  });
  return items;
}

export function getEvidenceForOption(o: RecoveryOption): ToolResult<EvidenceData> {
  const items = optionEvidence(o);
  return ok("EVIDENCE", `evidence for ${o.kind} option ${o.crewId ?? "cancel"} on ${o.pairingId}`, { items }, items);
}

export function getEvidenceForSolution(s: CoverSolution): ToolResult<EvidenceData> {
  const items = s.ranked.flatMap(optionEvidence);
  return ok("EVIDENCE", `evidence for cover solution on ${s.impact.kind === "crew" ? s.impact.pairingId : "?"}`, { items }, items);
}

export function getEvidenceForJointPlan(p: JointPlan): ToolResult<EvidenceData> {
  const items = p.perDisruption.flatMap(getEvidenceForSolution).flatMap((r) => r.data.items);
  items.push({
    reason: `joint total ${p.totalCost} across ${p.assignments.length} assignment(s)`,
  });
  return ok("EVIDENCE", `evidence for joint plan (${p.assignments.length} assignments)`, { items }, items);
}

export function getEvidenceUnknown(): ToolResult<EvidenceData> {
  return fail("EVIDENCE", "unknown evidence subject", "pass a RecoveryOption, CoverSolution, or JointPlan");
}
