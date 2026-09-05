/**
 * RULE-QUAL-05 — crew must hold a valid rating for the assigned type (2G).
 *
 * Pure set-membership check: every aircraft type observed on the proposed
 * pairing must appear in the crew member's ratings.
 */

import type { AircraftType } from "../domain/types.js";
import type { RuleCheck } from "./evidence.js";

export const QUAL_RULE_ID = "RULE-QUAL-05";

export interface QualificationEvidence {
  ruleId: typeof QUAL_RULE_ID;
  passed: boolean;
  crewRatings: AircraftType[];
  observedAircraftTypes: AircraftType[];
  /** Types the crew is missing (empty when qualified). */
  missingRatings: AircraftType[];
  violation?: string;
}

export function checkQualification(
  crewRatings: readonly AircraftType[],
  observedAircraftTypes: readonly AircraftType[],
): RuleCheck<QualificationEvidence> {
  const missing = observedAircraftTypes.filter((t) => !crewRatings.includes(t));
  const passed = missing.length === 0;
  return {
    ruleId: QUAL_RULE_ID,
    passed,
    evidence: {
      ruleId: QUAL_RULE_ID,
      passed,
      crewRatings: [...crewRatings],
      observedAircraftTypes: [...observedAircraftTypes],
      missingRatings: missing,
      violation: passed
        ? undefined
        : `RULE-QUAL-05 breached: crew rated [${crewRatings.join(", ")}] lacks rating for [${missing.join(", ")}]`,
    },
  };
}
