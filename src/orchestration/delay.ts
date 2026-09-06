/**
 * Tier 2B — DELAY consequence-analysis workflow (orchestration only).
 *
 * Composes existing primitives; no timing, legality, cost, or ranking
 * logic lives here:
 *   flight → pairing/day/crew → rotation overlay (report fixed, release
 *   extends) → per-crew legality → boundary/partial/full-recovery/cancel
 *   → recommendation + evidence
 * Reuses rotationDelayOverlay, extendReleaseOverlay, checkCrewAssign-
 * mentLegality, planPartialDayRecovery, solveCrewCover (delayMinutes
 * passthrough), and the cost engine. Nothing is recomputed for the UI/LLM.
 */

import type { OperationalGraph } from "../data/graph.js";
import { cancellationComponent, breakdown } from "../recovery/cost.js";
import { planPartialDayRecovery, solveCrewCover, type PartialDayPlan } from "../recovery/recovery.js";
import type { CoverSolution } from "../recovery/recovery.js";
import { extendReleaseOverlay, mergeOverlays, rotationDelayOverlay } from "../recovery/simulation.js";
import { checkCrewAssignmentLegality, type AssignmentLegality } from "../rules/assignment.js";
import { collectLegalityEvidence } from "./evidence.js";
import { fail, ok, type EvidenceItem, type ToolResult } from "./types.js";

export interface DelayRequest {
  flightId: string;
  delayMinutes: number;
}

export interface DelayCrewResult {
  crewId: string;
  role: string;
  legal: boolean;
  violations: AssignmentLegality["violations"];
  checks: AssignmentLegality["checks"];
}

export interface DelayCrewAssessment {
  crewId: string;
  pairingId: string;
  date: string;
  fdpLegal: boolean;
  dutyHoursAfter: number;
  fdpLimitHours: number;
}

export interface DelayTimingChange {
  flightId: string;
  before: { depUtc: string; arrUtc: string };
  after: { depUtc: string; arrUtc: string };
}

export interface DelayBoundary {
  pairingId: string;
  date: string;
  feasiblePrefixLegs: number;
  firstAffectedFlight: string | undefined;
  fullDayFdpHours: number;
  fullDayFdpLimit: number;
}

export interface DelayData {
  kind: "delay";
  event: { type: "DELAY"; flightId: string; delayMinutes: number };
  flightId: string;
  delayMinutes: number;
  pairingId: string;
  date: string;
  affectedPairings: string[];
  affectedCrew: string[];
  shiftedFlights: Array<{ flightId: string; depUtc: string; arrUtc: string }>;
  timingChanges: DelayTimingChange[];
  reportUtc: string;
  reportAfterUtc: string;
  releaseUtc: string;
  releaseAfterUtc: string;
  crew: DelayCrewResult[];
  crewAssessments: DelayCrewAssessment[];
  recoveryRequired: boolean;
  boundary?: DelayBoundary;
  partial?: PartialDayPlan;
  fullRecrew?: Array<{ role: string; solution: CoverSolution }>;
  cancelFlights: string[];
  cancelCostTotal: number;
  recommended?: { strategy: "partial" | "full" | "cancel"; totalCost: number };
}

export function analyzeDelay(g: OperationalGraph, req: DelayRequest): ToolResult<DelayData> {
  try {
    if (!Number.isFinite(req.delayMinutes) || req.delayMinutes < 0) {
      return fail("DISRUPTION_ANALYSIS", `invalid delay ${req.delayMinutes}`, "delayMinutes must be >= 0");
    }
    const anchor = g.flightById.get(req.flightId);
    if (!anchor) return fail("DISRUPTION_ANALYSIS", `unknown flight ${req.flightId}`, `unknown flight ${req.flightId}`);
    const pairing = g.pairingsByFlight.get(req.flightId)?.[0];
    const day = pairing?.days.find((d) => d.flights.includes(req.flightId));
    if (!pairing || !day) {
      return fail("DISRUPTION_ANALYSIS", `${req.flightId} is not rostered to a pairing day`, "unrostered flight");
    }

    const overlay = mergeOverlays(
      rotationDelayOverlay(g, req.flightId, req.delayMinutes),
      extendReleaseOverlay(g, pairing.pairingId, day.date, req.delayMinutes),
    );
    const releaseAfterUtc =
      overlay.dayWindows?.get(`${pairing.pairingId}|${day.date}`)?.releaseUtc ?? day.releaseUtc;

    const evidence: EvidenceItem[] = [
      { flightId: req.flightId, pairingId: pairing.pairingId, reason: `delay ${req.delayMinutes}min, report fixed` },
    ];
    const crew: DelayCrewResult[] = [];
    const crewAssessments: DelayCrewAssessment[] = [];
    for (const m of pairing.crew) {
      const legality = checkCrewAssignmentLegality(g, m.crewId, pairing.pairingId, { timing: overlay });
      crew.push({ crewId: m.crewId, role: m.role, legal: legality.legal, violations: legality.violations, checks: legality.checks });
      const fdpCheck = legality.checks.find((c) => c.ruleId === "RULE-FDP-01");
      if (!fdpCheck) throw new Error(`missing FDP result for ${m.crewId} on ${pairing.pairingId}`);
      const fdpEvidence = collectLegalityEvidence(legality).find((e) => e.ruleId === "RULE-FDP-01");
      if (fdpEvidence?.actual === undefined || fdpEvidence.limit === undefined) {
        throw new Error(`missing FDP evidence for ${m.crewId} on ${pairing.pairingId}`);
      }
      crewAssessments.push({
        crewId: m.crewId,
        pairingId: pairing.pairingId,
        date: day.date,
        fdpLegal: fdpCheck.passed,
        dutyHoursAfter: fdpEvidence.actual,
        fdpLimitHours: fdpEvidence.limit,
      });
      for (const v of legality.violations) {
        evidence.push({
          ruleId: v.ruleId, passed: false, actual: v.actual, limit: v.limit,
          crewId: m.crewId, pairingId: pairing.pairingId, reason: v.message,
        });
      }
    }
    crew.sort((a, b) => (a.crewId < b.crewId ? -1 : 1));
    crewAssessments.sort((a, b) => (a.crewId < b.crewId ? -1 : 1));
    const recoveryRequired = crew.some((c) => !c.legal);

    const shiftedFlights = [...(overlay.flightTimes?.entries() ?? [])].map(([flightId, t]) => ({
      flightId,
      depUtc: t.depUtc,
      arrUtc: t.arrUtc,
    }));
    shiftedFlights.sort((a, b) => (a.depUtc < b.depUtc ? -1 : 1));
    const timingChanges = shiftedFlights.flatMap((shifted) => {
      const original = g.flightById.get(shifted.flightId);
      return original
        ? [{
            flightId: shifted.flightId,
            before: { depUtc: original.depUtc, arrUtc: original.arrUtc },
            after: { depUtc: shifted.depUtc, arrUtc: shifted.arrUtc },
          }]
        : [];
    });

    let boundary: DelayBoundary | undefined;
    let partial: PartialDayPlan | undefined;
    let fullRecrew: DelayData["fullRecrew"];
    let recommended: DelayData["recommended"];
    const warnings: string[] = [];

    if (recoveryRequired) {
      if (day.flights.length >= 2) {
        partial = planPartialDayRecovery(g, pairing.pairingId, day.date, req.delayMinutes);
        const suffix = partial.suffixFlights;
        boundary = {
          pairingId: pairing.pairingId,
          date: day.date,
          feasiblePrefixLegs: partial.feasiblePrefixLegs,
          firstAffectedFlight: suffix[0],
          fullDayFdpHours: crewAssessments[0]?.dutyHoursAfter ?? 0,
          fullDayFdpLimit: crewAssessments[0]?.fdpLimitHours ?? partial.prefixFdpLimit,
        };
      } else {
        warnings.push(`${pairing.pairingId}|${day.date}: single-leg day cannot split; full re-crew only.`);
      }
      const roles = [...new Set(pairing.crew.map((m) => m.role))];
      fullRecrew = roles.map((role) => {
        const holder = pairing.crew.find((m) => m.role === role)?.crewId ?? "";
        return {
          role,
          solution: solveCrewCover(g, {
            pairingId: pairing.pairingId,
            role,
            sickCrewId: holder,
            delayMinutes: req.delayMinutes,
          }),
        };
      });
      const partialFeasible =
        partial !== undefined && partial.suffixCovers.every((s) => s.options.length > 0);
      const fullTotals = (fullRecrew ?? []).map((r) => {
        const best = r.solution.ranked.find((o) => o.kind === "cover");
        return best?.cost.total;
      });
      const fullFeasible = fullTotals.every((t) => t !== undefined);
      const partialTotal = partialFeasible ? (partial as PartialDayPlan).suffixTotalCost : undefined;
      const fullTotal =
        fullFeasible && fullTotals.length > 0
          ? (fullTotals as number[]).reduce((n, t) => n + t, 0)
          : undefined;
      if (partialTotal !== undefined && (fullTotal === undefined || partialTotal <= fullTotal)) {
        recommended = { strategy: "partial", totalCost: partialTotal };
      } else if (fullTotal !== undefined) {
        recommended = { strategy: "full", totalCost: fullTotal };
      } else {
        const cancelTotal = breakdown(g.costs, [cancellationComponent(day.flights.length, g.costs)]).total;
        recommended = { strategy: "cancel", totalCost: cancelTotal };
        warnings.push("No legal crew recovery; cancellation fallback priced.");
      }
      for (const r of fullRecrew ?? []) {
        for (const rej of r.solution.rejected) {
          for (const v of rej.violations) {
            evidence.push({
              ruleId: v.ruleId, passed: false, actual: v.actual, limit: v.limit,
              crewId: rej.crewId, pairingId: pairing.pairingId, reason: v.message,
            });
          }
        }
      }
    }

    const cancelFlights = !recoveryRequired ? [] : partial ? [...partial.suffixFlights] : [...day.flights];
    const cancelCost =
      cancelFlights.length > 0
        ? breakdown(g.costs, [cancellationComponent(cancelFlights.length, g.costs)])
        : breakdown(g.costs, []);

    return ok(
      "DISRUPTION_ANALYSIS",
      recoveryRequired
        ? `${req.flightId} +${req.delayMinutes}min: recovery required on ${pairing.pairingId}|${day.date}`
        : `${req.flightId} +${req.delayMinutes}min: absorbed, no recovery required`,
      {
        kind: "delay",
        event: { type: "DELAY", flightId: req.flightId, delayMinutes: req.delayMinutes },
        flightId: req.flightId,
        delayMinutes: req.delayMinutes,
        pairingId: pairing.pairingId,
        date: day.date,
        affectedPairings: [pairing.pairingId],
        affectedCrew: crew.map((c) => c.crewId),
        shiftedFlights,
        timingChanges,
        reportUtc: day.reportUtc,
        reportAfterUtc: day.reportUtc,
        releaseUtc: day.releaseUtc,
        releaseAfterUtc,
        crew,
        crewAssessments,
        recoveryRequired,
        boundary,
        partial,
        fullRecrew,
        cancelFlights,
        cancelCostTotal: cancelCost.total,
        recommended,
      },
      evidence,
      warnings,
    );
  } catch (e) {
    return fail("DISRUPTION_ANALYSIS", "delay analysis failed", e instanceof Error ? e.message : String(e));
  }
}
