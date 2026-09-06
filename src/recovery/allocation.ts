/**
 * Joint allocation for simultaneous disruptions (STEP 3 §11).
 *
 * Each disruption is solved independently (legal options + cancellation
 * fallback), then the cheapest globally-consistent combination wins.
 * Consistency rule (mirroring the reference joint plan): the same crew
 * member cannot cover two pairings. Exhaustive search over the small
 * candidate sets — no optimization library. Enumeration is deterministic
 * (requests in order, options cheapest-first), and the first strictly
 * cheapest total wins, so ties resolve deterministically.
 */

import type { CrewId, CrewRank, PairingId } from "../domain/types.js";
import type { OperationalGraph } from "../data/graph.js";
import { solveCrewCover, type CoverSolution } from "./recovery.js";
import type { CoverRequirement } from "./candidates.js";
import type { IsoUtc } from "../domain/types.js";

export interface JointCoverRequest {
  pairingId: PairingId;
  role: CrewRank;
  sickCrewId: CrewId;
  reportedUtc?: IsoUtc;
}

export interface JointAssignment {
  pairingId: PairingId;
  crewId: CrewId | undefined;
  kind: "cover" | "cancel";
  costTotal: number;
  delayHours: number;
}

export interface JointPlan {
  assignments: JointAssignment[];
  totalCost: number;
  perDisruption: CoverSolution[];
}

export function allocateJoint(g: OperationalGraph, requests: JointCoverRequest[]): JointPlan {
  // Every concurrently unavailable crew member is unavailable to every
  // request, not only to their own vacated seat.
  const unavailableCrewIds = requests.map((request) => request.sickCrewId);
  const perDisruption = requests.map((r) =>
    solveCrewCover(g, {
      ...r,
      extraExcludeCrewIds: unavailableCrewIds.filter((crewId) => crewId !== r.sickCrewId),
    }),
  );
  const pools = perDisruption.map((s) => s.ranked);

  let best: JointAssignment[] | undefined;
  let bestTotal = Number.POSITIVE_INFINITY;

  const recurse = (index: number, current: JointAssignment[], usedCrew: Set<CrewId>, total: number): void => {
    if (total >= bestTotal) return; // prune: cannot improve (first strictly-cheapest wins ties)
    if (index === pools.length) {
      best = [...current];
      bestTotal = total;
      return;
    }
    for (const o of pools[index]) {
      if (o.crewId !== undefined && usedCrew.has(o.crewId)) continue;
      const next = new Set(usedCrew);
      if (o.crewId !== undefined) next.add(o.crewId);
      current.push({
        pairingId: o.pairingId,
        crewId: o.crewId,
        kind: o.kind,
        costTotal: o.cost.total,
        delayHours: o.delayHours,
      });
      recurse(index + 1, current, next, total + o.cost.total);
      current.pop();
    }
  };
  recurse(0, [], new Set(), 0);

  return { assignments: best ?? [], totalCost: bestTotal, perDisruption };
}
