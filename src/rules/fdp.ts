/**
 * RULE-FDP-01 — maximum flight duty period (STEP 2C).
 *
 * Limit from rules.json params: 13h − 0.5h per sector beyond the 2nd.
 *   1–2 sectors → 13h · 3 sectors → 12.5h · 4 sectors → 12h …
 * Actual FDP = duty-period length (release − report), evaluated per
 * pairing day. Exactly at the limit is legal (matches validate.py).
 */

import type { IsoUtc } from "../domain/types.js";
import { hoursBetween, minutesBetween, round2 } from "../data/time.js";
import type { RuleCheck, RuleViolation } from "./evidence.js";

export const FDP_RULE_ID = "RULE-FDP-01";
export const FDP_BASE_HOURS = 13;
export const FDP_REDUCTION_PER_EXTRA_SECTOR = 0.5;
export const FDP_FREE_SECTORS = 2;

export function fdpLimitHours(sectors: number): number {
  if (!Number.isInteger(sectors) || sectors < 1) {
    throw new Error(`fdpLimitHours expects sectors >= 1, got ${sectors}`);
  }
  return FDP_BASE_HOURS - FDP_REDUCTION_PER_EXTRA_SECTOR * Math.max(0, sectors - FDP_FREE_SECTORS);
}

export interface FdpEvidence {
  ruleId: typeof FDP_RULE_ID;
  legal: boolean;
  actualFdpHours: number;
  limitHours: number;
  sectors: number;
  reportUtc: IsoUtc;
  releaseUtc: IsoUtc;
  violation?: string;
}

export function checkFdp(reportUtc: IsoUtc, releaseUtc: IsoUtc, sectors: number): RuleCheck<FdpEvidence> {
  const actualMin = minutesBetween(reportUtc, releaseUtc);
  if (actualMin < 0) {
    throw new Error(`checkFdp: release ${releaseUtc} precedes report ${reportUtc}`);
  }
  const limit = fdpLimitHours(sectors);
  const legal = actualMin <= limit * 60 + 1e-6;
  return {
    ruleId: FDP_RULE_ID,
    passed: legal,
    evidence: {
      ruleId: FDP_RULE_ID,
      legal,
      actualFdpHours: round2(hoursBetween(reportUtc, releaseUtc)),
      limitHours: limit,
      sectors,
      reportUtc,
      releaseUtc,
      violation: legal
        ? undefined
        : `RULE-FDP-01 breached: FDP ${round2(hoursBetween(reportUtc, releaseUtc))}h exceeds ${limit}h limit for ${sectors} sectors`,
    },
  };
}

export function fdpViolation(date: string, evidence: FdpEvidence): RuleViolation {
  return {
    ruleId: FDP_RULE_ID,
    message: `${FDP_RULE_ID} breached on ${date}: FDP ${evidence.actualFdpHours}h exceeds ${evidence.limitHours}h limit for ${evidence.sectors} sectors`,
    actual: evidence.actualFdpHours,
    limit: evidence.limitHours,
    details: { date, sectors: evidence.sectors },
  };
}
