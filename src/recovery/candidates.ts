/**
 * Replacement-crew candidate generation (STEP 3 §6).
 *
 * Pool = active crew of the vacated rank, minus unavailable crew.
 * Reachability mirrors the reference semantics: same-base crew operate
 * direct; other-base crew need a same-day positioning flight (deadhead),
 * else they are eliminated with a BASE-07 reason.
 *
 * Deliberately NOT pre-filtered here (final legality always runs through
 * the Step-2 engine): ratings, certifications, duty/rest windows. Only
 * rank, status, availability, and base reachability narrow the pool, and
 * every elimination carries its reason.
 */

import type { CrewId, CrewRank, PairingId } from "../domain/types.js";
import type { Crew } from "../domain/types.js";
import type { OperationalGraph } from "../data/graph.js";
import { planDeadhead, type DeadheadPlan } from "./deadhead.js";

export interface CoverRequirement {
  pairingId: PairingId;
  role: CrewRank;
  /** Sick/unavailable crew to exclude (plus any extra exclusions). */
  excludeCrewIds?: CrewId[];
}

export interface Candidate {
  crewId: CrewId;
  crew: Crew;
  kind: "reserve" | "dayoff";
  deadhead: DeadheadPlan;
}

export interface EliminatedCandidate {
  crewId: CrewId;
  reason: string;
}

export interface CandidateSet {
  candidates: Candidate[];
  eliminated: EliminatedCandidate[];
  pairingBase: string;
}

export function findCandidates(g: OperationalGraph, req: CoverRequirement): CandidateSet {
  const pairing = g.pairingById.get(req.pairingId);
  if (!pairing) throw new Error(`findCandidates: unknown pairing ${req.pairingId}`);
  const excluded = new Set(req.excludeCrewIds ?? []);
  const firstFlight = g.flightById.get(pairing.days[0]?.flights[0] ?? "");
  const pairingBase = firstFlight?.depStation ?? "";
  const dutyDate = pairing.days[0]?.date ?? "";
  const schedFirstDep = firstFlight?.depUtc ?? "";

  const candidates: Candidate[] = [];
  const eliminated: EliminatedCandidate[] = [];
  for (const crew of g.crews) {
    if (crew.rank !== req.role || crew.status !== "active" || excluded.has(crew.crewId)) continue;
    const deadhead = planDeadhead(g, crew.base, pairingBase, dutyDate, schedFirstDep);
    if (!deadhead.reachable) {
      eliminated.push({ crewId: crew.crewId, reason: deadhead.reason ?? "unreachable base" });
      continue;
    }
    candidates.push({
      crewId: crew.crewId,
      crew,
      kind: g.reserveByCrew.has(crew.crewId) ? "reserve" : "dayoff",
      deadhead,
    });
  }
  candidates.sort((a, b) => (a.crewId < b.crewId ? -1 : a.crewId > b.crewId ? 1 : 0));
  return { candidates, eliminated, pairingBase };
}
