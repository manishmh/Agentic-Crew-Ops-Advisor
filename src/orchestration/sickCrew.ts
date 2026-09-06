/**
 * Tier 2A — SICK_CREW consequence-analysis workflow (orchestration only).
 *
 * Composes existing primitives into the full flow; no legality, cost, or
 * ranking logic lives here:
 *   crew → assigned pairing(s) → impact → candidates → legality →
 *   ranking → cost → recommendation + evidence
 * Reuses analyzeDisruption (impact) and findRecoveryOptions (recovery)
 * per affected pairing. Nothing is recomputed for the LLM: every numeric
 * claim already exists in the deterministic outputs below.
 */

import type { OperationalGraph } from "../data/graph.js";
import { getAircraftTypesForPairing } from "../data/graph.js";
import type { CostBreakdown } from "../recovery/cost.js";
import type { RuleViolation } from "../rules/evidence.js";
import type { RecoveryOption } from "../recovery/types.js";
import { analyzeDisruption } from "./disruptions.js";
import { findRecoveryOptions } from "./recoveryTools.js";
import { fail, ok, type EvidenceItem, type ToolResult } from "./types.js";

export interface SickCrewRequest {
  crewId: string;
  /** When omitted, every assigned pairing is analyzed (multi-duty). */
  pairingId?: string;
  reportedUtc?: string;
  /** Additional exclusions beyond the sick crew (forces empty-pool paths). */
  extraExcludeCrewIds?: string[];
}

export interface SickPairingResult {
  pairingId: string;
  role: string;
  dates: string[];
  flights: string[];
  aircraftTypes: string[];
  /** True when the sick call uncovers more than one duty day. */
  multiDuty: boolean;
  recoveryAvailable: boolean;
  noRecoveryReason?: string;
  ranked: RecoveryOption[];
  rejected: Array<{ crewId: string; reasons: string[]; violations: RuleViolation[]; legalityEvaluated: boolean }>;
  selected?: RecoveryOption;
  totalCost: number;
  cancelCost?: CostBreakdown;
}

export interface SickCrewData {
  crewId: string;
  pairings: SickPairingResult[];
}

export function analyzeSickCrew(g: OperationalGraph, req: SickCrewRequest): ToolResult<SickCrewData> {
  try {
    const crew = g.crewById.get(req.crewId);
    if (!crew) return fail("DISRUPTION_ANALYSIS", `unknown crew ${req.crewId}`, `unknown crew ${req.crewId}`);

    const pairingIds = req.pairingId
      ? [req.pairingId]
      : (g.pairingsByCrew.get(req.crewId) ?? []).map((p) => p.pairingId);
    if (pairingIds.length === 0) {
      return fail("DISRUPTION_ANALYSIS", `${req.crewId} has no assigned pairings`, "no assigned pairings");
    }

    const evidence: EvidenceItem[] = [];
    const warnings: string[] = [];
    const pairings: SickPairingResult[] = [];

    for (const pairingId of pairingIds) {
      const impact = analyzeDisruption(g, {
        type: "SICK_CREW",
        crewId: req.crewId,
        pairingId,
        reportedUtc: req.reportedUtc ?? "",
      });
      if (!impact.success || impact.data.kind !== "crew") {
        return fail("DISRUPTION_ANALYSIS", `impact failed for ${pairingId}`, impact.error ?? "impact failed");
      }
      const recovery = findRecoveryOptions(g, {
        pairingId,
        role: impact.data.role,
        sickCrewId: req.crewId,
        reportedUtc: req.reportedUtc,
        extraExcludeCrewIds: req.extraExcludeCrewIds,
      });
      if (!recovery.success) {
        return fail("DISRUPTION_ANALYSIS", `recovery failed for ${pairingId}`, recovery.error ?? "recovery failed");
      }
      const covers = recovery.data.ranked.filter((o) => o.kind === "cover");
      const cancel = recovery.data.ranked.find((o) => o.kind === "cancel");
      const recoveryAvailable = covers.length > 0;
      if (!recoveryAvailable) {
        warnings.push(`${pairingId}: No legal replacement crew found; cancellation fallback priced.`);
      }
      evidence.push(...impact.evidence, ...recovery.evidence);
      for (const r of recovery.data.rejected) {
        for (const v of r.violations) {
          evidence.push({
            ruleId: v.ruleId,
            passed: false,
            actual: v.actual,
            limit: v.limit,
            crewId: r.crewId,
            pairingId,
            reason: v.message,
          });
        }
      }
      pairings.push({
        pairingId,
        role: impact.data.role,
        dates: impact.data.dates,
        flights: impact.data.flights,
        aircraftTypes: [...getAircraftTypesForPairing(g, pairingId)],
        multiDuty: impact.data.dates.length > 1,
        recoveryAvailable,
        noRecoveryReason: recoveryAvailable ? undefined : "No legal replacement crew found.",
        ranked: recovery.data.ranked,
        rejected: recovery.data.rejected,
        selected: recovery.data.selected,
        totalCost: recovery.data.totalCost,
        cancelCost: cancel?.cost,
      });
    }

    pairings.sort((a, b) => (a.pairingId < b.pairingId ? -1 : 1));
    const withRecovery = pairings.filter((p) => p.recoveryAvailable).length;
    return ok(
      "DISRUPTION_ANALYSIS",
      `${req.crewId} sick: ${pairings.length} pairing(s) affected, recovery available for ${withRecovery}/${pairings.length}`,
      { crewId: req.crewId, pairings },
      evidence,
      warnings,
    );
  } catch (e) {
    return fail("DISRUPTION_ANALYSIS", "sick-crew analysis failed", e instanceof Error ? e.message : String(e));
  }
}
