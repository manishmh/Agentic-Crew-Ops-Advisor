/**
 * Deterministic option ranking (STEP 3 §9).
 *
 * Legality is a HARD constraint: illegal options never appear in `ranked`.
 * Legal options sort by (total cost, delay hours, crew id) — all numbers
 * from the deterministic engine, with crew id as the final tiebreak so
 * output order is fully deterministic.
 */

import type { RecoveryOption } from "./types.js";

export interface RankedRecovery {
  ranked: RecoveryOption[];
  rejected: RecoveryOption[];
}

export function rankOptions(options: RecoveryOption[]): RankedRecovery {
  const ranked = options.filter((o) => o.kind === "cancel" || o.legality?.legal === true);
  const rejected = options.filter((o) => o.kind !== "cancel" && o.legality?.legal !== true);
  ranked.sort((a, b) => {
    if (a.cost.total !== b.cost.total) return a.cost.total - b.cost.total;
    if (a.delayHours !== b.delayHours) return a.delayHours - b.delayHours;
    return (a.crewId ?? "") < (b.crewId ?? "") ? -1 : 1;
  });
  const rejectedSorted = [...rejected].sort((a, b) => ((a.crewId ?? "") < (b.crewId ?? "") ? -1 : 1));
  const rankedWithRank = ranked.map((o, i) => ({ ...o, rank: i + 1 }));
  return { ranked: rankedWithRank, rejected: rejectedSorted };
}
