/**
 * RULE-REST-04 — minimum 12h rest between previous release and next report.
 *
 * Exactly 12h is legal; 11h59m is not (matches validate.py's `< 12h`
 * breach test). Minute-exact integer comparison — no epsilon needed on
 * minute-aligned operational data.
 */

import type { IsoUtc } from "../domain/types.js";
import { minutesBetween, round2 } from "../data/time.js";
import type { RuleCheck } from "./evidence.js";

export const REST_RULE_ID = "RULE-REST-04";
export const MIN_REST_HOURS = 12;

export interface RestEvidence {
  ruleId: typeof REST_RULE_ID;
  legal: boolean;
  previousRelease: IsoUtc;
  nextReport: IsoUtc;
  restHours: number;
  restMinutes: number;
  minimumRestHours: number;
  violation?: string;
}

export function checkRest(
  previousRelease: IsoUtc,
  nextReport: IsoUtc,
  minimumRestHours: number = MIN_REST_HOURS,
): RuleCheck<RestEvidence> {
  const restMin = minutesBetween(previousRelease, nextReport);
  const requiredMin = minimumRestHours * 60;
  const legal = restMin >= requiredMin - 1e-9;
  return {
    ruleId: REST_RULE_ID,
    passed: legal,
    evidence: {
      ruleId: REST_RULE_ID,
      legal,
      previousRelease,
      nextReport,
      restHours: round2(restMin / 60),
      restMinutes: round2(restMin),
      minimumRestHours: minimumRestHours,
      violation: legal
        ? undefined
        : `RULE-REST-04 breached: rest ${round2(restMin / 60)}h from ${previousRelease} to ${nextReport} is below ${minimumRestHours}h minimum`,
    },
  };
}
