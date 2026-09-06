/**
 * searchOperationalData — structured, natural-language-independent
 * retrieval over Step-1 indexes. Exact-match filters only; result order
 * follows index/file order, so output is deterministic.
 */

import type {
  Flight,
  Pairing,
  Reserve,
  RiskSignal,
  DutyClock,
  Certification,
  Crew,
} from "../domain/types.js";
import type { OperationalGraph } from "../data/graph.js";
import { fail, ok, type ToolResult } from "./types.js";

export type SearchQuery =
  | { entity: "crew"; crewId?: string; base?: string; rank?: Crew["rank"]; rating?: string; status?: Crew["status"] }
  | { entity: "flights"; flightId?: string; origin?: string; destination?: string; date?: string; aircraft?: string }
  | { entity: "pairings"; pairingId?: string; crewId?: string; date?: string }
  | { entity: "reserves"; crewId?: string; base?: string; date?: string }
  | { entity: "certifications"; crewId?: string; certType?: Certification["certType"] }
  | { entity: "dutyClocks"; crewId: string }
  | { entity: "riskSignals"; crewId?: string; minScore?: number };

export interface SearchData {
  entity: string;
  total: number;
  returned: number;
  items: unknown[];
}

const DEFAULT_LIMIT = 100;

function cap<T>(items: readonly T[], limit: number): { total: number; returned: number; items: T[] } {
  return { total: items.length, returned: Math.min(items.length, limit), items: items.slice(0, limit) };
}

export function searchOperationalData(
  g: OperationalGraph,
  query: SearchQuery,
  limit: number = DEFAULT_LIMIT,
): ToolResult<SearchData> {
  try {
    switch (query.entity) {
      case "crew": {
        let items: readonly Crew[];
        if (query.crewId) {
          const c = g.crewById.get(query.crewId);
          items = c ? [c] : [];
        } else if (query.base) {
          items = g.crewByBase.get(query.base) ?? [];
        } else if (query.rating) {
          items = g.crewByRating.get(query.rating) ?? [];
        } else {
          items = g.crews;
        }
        if (query.rank) items = items.filter((c) => c.rank === query.rank);
        if (query.status) items = items.filter((c) => c.status === query.status);
        if (query.base && query.crewId) items = items.filter((c) => c.base === query.base);
        if (query.rating && (query.base || query.crewId)) {
          items = items.filter((c) => c.ratings.includes(query.rating as Crew["ratings"][number]));
        }
        const r = cap(items, limit);
        return ok("SEARCH", `${r.returned}/${r.total} crew records`, { entity: "crew", ...r });
      }
      case "flights": {
        let items: readonly Flight[];
        if (query.flightId) {
          const f = g.flightById.get(query.flightId);
          items = f ? [f] : [];
        } else if (query.origin) {
          items = g.flightsByOrigin.get(query.origin) ?? [];
        } else if (query.destination) {
          items = g.flightsByDestination.get(query.destination) ?? [];
        } else if (query.aircraft) {
          items = g.flightsByAircraft.get(query.aircraft) ?? [];
        } else {
          items = g.flights;
        }
        if (query.date) items = items.filter((f) => f.date === query.date);
        if (query.origin && query.flightId) items = items.filter((f) => f.depStation === query.origin);
        if (query.destination && (query.flightId || query.origin || query.aircraft)) {
          items = items.filter((f) => f.arrStation === query.destination);
        }
        if (query.aircraft && (query.flightId || query.origin || query.destination)) {
          items = items.filter((f) => f.aircraft === query.aircraft);
        }
        const r = cap(items, limit);
        return ok("SEARCH", `${r.returned}/${r.total} flights`, { entity: "flights", ...r });
      }
      case "pairings": {
        let items: readonly Pairing[];
        if (query.pairingId) {
          const p = g.pairingById.get(query.pairingId);
          items = p ? [p] : [];
        } else if (query.crewId) {
          items = g.pairingsByCrew.get(query.crewId) ?? [];
        } else {
          items = g.pairings;
        }
        if (query.date) items = items.filter((p) => p.days.some((d) => d.date === query.date));
        const r = cap(items, limit);
        return ok("SEARCH", `${r.returned}/${r.total} pairings`, { entity: "pairings", ...r });
      }
      case "reserves": {
        let items: readonly Reserve[];
        if (query.crewId) {
          const r = g.reserveByCrew.get(query.crewId);
          items = r ? [r] : [];
        } else if (query.base) {
          items = g.reservesByBase.get(query.base) ?? [];
        } else {
          items = g.reserves;
        }
        if (query.date) items = items.filter((r) => r.dates.includes(query.date as string));
        const r = cap(items, limit);
        return ok("SEARCH", `${r.returned}/${r.total} reserve records`, { entity: "reserves", ...r });
      }
      case "certifications": {
        const all: Certification[] = [];
        if (query.crewId) {
          all.push(...(g.certificationsByCrew.get(query.crewId) ?? []));
        } else {
          all.push(...g.certifications);
        }
        const items = query.certType ? all.filter((c) => c.certType === query.certType) : all;
        const r = cap(items, limit);
        return ok("SEARCH", `${r.returned}/${r.total} certifications`, { entity: "certifications", ...r });
      }
      case "dutyClocks": {
        const d: DutyClock | undefined = g.dutyClockByCrew.get(query.crewId);
        const items = d ? [d] : [];
        return ok("SEARCH", items.length === 1 ? `duty clock for ${query.crewId}` : `no duty clock for ${query.crewId}`, {
          entity: "dutyClocks",
          total: items.length,
          returned: items.length,
          items,
        });
      }
      case "riskSignals": {
        let items: readonly RiskSignal[];
        if (query.crewId) {
          const r = g.riskByCrew.get(query.crewId);
          items = r ? [r] : [];
        } else {
          items = g.riskSignals;
        }
        if (query.minScore !== undefined) items = items.filter((r) => r.disruptionRiskScore >= (query.minScore as number));
        const r = cap(items, limit);
        return ok("SEARCH", `${r.returned}/${r.total} risk signals`, { entity: "riskSignals", ...r });
      }
    }
  } catch (e) {
    return fail("SEARCH", "search failed", e instanceof Error ? e.message : String(e));
  }
}
