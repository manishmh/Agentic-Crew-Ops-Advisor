/**
 * Foundational validation for the operational graph (STEP 1 scope).
 *
 * Lightweight referential-integrity checks only:
 * duplicate IDs, dangling references, missing per-crew records, and
 * clearly-invalid duplicate records.
 *
 * This is NOT the airline legality validator (no FDP/duty/rest/
 * qualification/certification legality evaluation — that is later work
 * and validate.py already covers dataset consistency independently).
 * Suspicious source values are REPORTED, never silently fixed.
 */

import type { OperationalGraph } from "./graph.js";

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  severity: ValidationSeverity;
  code: string;
  message: string;
}

function countBy<T>(items: readonly T[], key: (t: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return counts;
}

function duplicates<T>(items: readonly T[], key: (t: T) => string): string[] {
  const out: string[] = [];
  for (const [k, n] of countBy(items, key)) if (n > 1) out.push(k);
  return out.sort();
}

/**
 * Run all foundational checks. Pure — reads the graph (and the raw
 * collections it carries) and returns every issue found.
 */
export function validateGraph(g: OperationalGraph): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (code: string, message: string): void => {
    issues.push({ severity: "error", code, message });
  };
  const warn = (code: string, message: string): void => {
    issues.push({ severity: "warning", code, message });
  };

  // ---- duplicate IDs ----
  for (const id of duplicates(g.crews, (c) => c.crewId)) err("DUPLICATE_CREW_ID", `Duplicate crew id: ${id}`);
  for (const id of duplicates(g.flights, (f) => f.flightId))
    err("DUPLICATE_FLIGHT_ID", `Duplicate flight id: ${id}`);
  for (const id of duplicates(g.pairings, (p) => p.pairingId))
    err("DUPLICATE_PAIRING_ID", `Duplicate pairing id: ${id}`);
  for (const id of duplicates(g.dutyClocks, (d) => d.crewId))
    err("DUPLICATE_DUTY_CLOCK", `Duplicate duty clock for crew: ${id}`);
  for (const id of duplicates(g.riskSignals, (r) => r.crewId))
    err("DUPLICATE_RISK_SIGNAL", `Duplicate risk signal for crew: ${id}`);
  for (const id of duplicates(g.reserves, (r) => r.crewId))
    err("DUPLICATE_RESERVE", `Duplicate reserve record for crew: ${id}`);
  for (const id of duplicates(g.rules, (r) => r.ruleId)) err("DUPLICATE_RULE_ID", `Duplicate rule id: ${id}`);

  // ---- duplicate certification records (same crew + same cert type) ----
  for (const id of duplicates(g.certifications, (c) => `${c.crewId}|${c.certType}`)) {
    err("DUPLICATE_CERTIFICATION", `Duplicate certification record: ${id.replace("|", " / ")}`);
  }

  // ---- pairing references ----
  for (const p of g.pairings) {
    for (const a of p.crew) {
      if (!g.crewById.has(a.crewId)) {
        err("UNKNOWN_PAIRING_CREW", `Pairing ${p.pairingId} references unknown crew ${a.crewId}`);
      }
    }
    for (const day of p.days) {
      for (const fid of day.flights) {
        if (!g.flightById.has(fid)) {
          err("UNKNOWN_PAIRING_FLIGHT", `Pairing ${p.pairingId} references unknown flight ${fid}`);
        }
      }
    }
  }

  // ---- per-crew record references ----
  const crewIds = new Set(g.crews.map((c) => c.crewId));
  for (const d of g.dutyClocks) {
    if (!crewIds.has(d.crewId)) err("DUTY_CLOCK_UNKNOWN_CREW", `Duty clock references unknown crew ${d.crewId}`);
  }
  for (const c of g.certifications) {
    if (!crewIds.has(c.crewId)) err("CERTIFICATION_UNKNOWN_CREW", `Certification references unknown crew ${c.crewId}`);
  }
  for (const r of g.reserves) {
    if (!crewIds.has(r.crewId)) err("RESERVE_UNKNOWN_CREW", `Reserve references unknown crew ${r.crewId}`);
  }
  for (const r of g.riskSignals) {
    if (!crewIds.has(r.crewId)) err("RISK_UNKNOWN_CREW", `Risk signal references unknown crew ${r.crewId}`);
  }

  // ---- missing per-crew records ----
  // Every crew member is expected to have a duty clock, certifications,
  // and a risk signal (reserves exist only for the 16-person pool).
  const dutyIds = new Set(g.dutyClocks.map((d) => d.crewId));
  const certIds = new Set(g.certifications.map((c) => c.crewId));
  const riskIds = new Set(g.riskSignals.map((r) => r.crewId));
  for (const c of g.crews) {
    if (!dutyIds.has(c.crewId)) warn("MISSING_DUTY_CLOCK", `No duty clock for crew ${c.crewId}`);
    if (!certIds.has(c.crewId)) warn("MISSING_CERTIFICATIONS", `No certifications for crew ${c.crewId}`);
    if (!riskIds.has(c.crewId)) warn("MISSING_RISK_SIGNAL", `No risk signal for crew ${c.crewId}`);
  }

  return issues;
}

/** True when no error-severity issues are present (warnings allowed). */
export function isGraphValid(issues: readonly ValidationIssue[]): boolean {
  return !issues.some((i) => i.severity === "error");
}
