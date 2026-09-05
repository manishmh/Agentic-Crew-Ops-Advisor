/**
 * Step-3 recovery tests: sick-cover pipeline, S1/S2/S5, cost, ranking.
 * Derived from dataset behavior through the engines — crew IDs below are
 * regression anchors from the supplied task expectations, never logic.
 */

import { describe, expect, it, beforeAll } from "vitest";
import { resolve } from "node:path";
import { loadOperationalGraph, type LoadedGraph } from "../src/data/loader.js";
import type { LoadedDataset } from "../src/data/loader.js";
import type { OperationalGraph } from "../src/data/graph.js";
import { findCandidates } from "../src/recovery/candidates.js";
import { certImpact } from "../src/recovery/impact.js";
import { solveCrewCover } from "../src/recovery/recovery.js";

const DATA_DIR = resolve(process.cwd(), "data");

let dataset: LoadedDataset;
let graph: OperationalGraph;

beforeAll(() => {
  const loaded: LoadedGraph = loadOperationalGraph(DATA_DIR);
  dataset = loaded.dataset;
  graph = loaded.graph;
});

describe("S1 — crew unavailable impact", () => {
  it("identifies the pairing, role, and all affected flights", () => {
    const s = solveCrewCover(graph, { pairingId: "P-2224", role: "Captain", sickCrewId: "C-3231" });
    expect(s.impact.kind).toBe("crew");
    if (s.impact.kind !== "crew") return;
    expect(s.impact.pairingId).toBe("P-2224");
    expect(s.impact.role).toBe("Captain");
    expect(s.impact.flights).toHaveLength(4);
    expect(s.impact.flights.map((f) => f.flightId)).toEqual(
      graph.pairingById.get("P-2224")?.days[0].flights,
    );
    expect(s.selected?.legality?.legal).toBe(true);
  });
});

describe("S2 — P-2291 captain cover", () => {
  it("ranks the clean reserve first with callout-only cost", () => {
    const s = solveCrewCover(graph, {
      pairingId: "P-2291",
      role: "Captain",
      sickCrewId: "C-1042",
      reportedUtc: "2026-09-15T05:00:00Z",
    });
    expect(s.ranked[0].crewId).toBe("C-3310");
    expect(s.ranked[0].cost.total).toBe(graph.costs.reserveCalloutPilot);
    expect(s.ranked[0].cost.components).toHaveLength(1);
    expect(s.ranked[0].delayHours).toBe(0);
    expect(s.selected?.crewId).toBe("C-3310");
  });

  it("prices day-off options from the cost model below deadhead", () => {
    const s = solveCrewCover(graph, { pairingId: "P-2291", role: "Captain", sickCrewId: "C-1042" });
    const dayOff = s.ranked.filter((o) => o.cost.total === graph.costs.dayoffCalloutPilot);
    expect(dayOff.map((o) => o.crewId)).toContain("C-1526");
    expect(dayOff.map((o) => o.crewId)).toContain("C-3983");
    const dh = s.ranked.find((o) => o.crewId === "C-2210");
    expect(dh).toBeDefined();
    expect(dh?.cost.total).toBe(
      graph.costs.reserveCalloutPilot + graph.costs.deadheadPositioning + 3 * graph.costs.delayCostPerDutyHour,
    );
    expect(dh?.delayHours).toBe(3);
    expect(dh?.adjustedReportUtc).toBe("2026-09-15T09:00:00Z");
    expect(dh?.cost.components.map((c) => c.type)).toEqual(["reserve_callout", "deadhead", "delay"]);
    // Every day-off option outranks deadhead; deadhead outranks cancellation.
    const rankOf = (id: string): number => s.ranked.findIndex((o) => o.crewId === id);
    for (const o of dayOff) expect(rankOf(o.crewId ?? "")).toBeLessThan(rankOf("C-2210"));
    const cancel = s.ranked[s.ranked.length - 1];
    expect(cancel.kind).toBe("cancel");
    expect(cancel.cost.total).toBe(6 * graph.costs.cancellationPerFlight);
  });

  it("rejects C-2087 (duty), C-2091 (rating), C-3305 (window) with reasons", () => {
    const s = solveCrewCover(graph, { pairingId: "P-2291", role: "Captain", sickCrewId: "C-1042" });
    const reasons = new Map(s.rejected.map((r) => [r.crewId, r.reasons.join("; ")]));
    expect(reasons.get("C-2087")).toContain("RULE-DUTY-02");
    expect(reasons.get("C-2091")).toContain("RULE-QUAL-05");
    expect(reasons.get("C-3305")).toContain("05:30");
    expect(s.ranked.every((o) => o.legality === undefined || o.legality.legal)).toBe(true);
  });

  it("is deterministic across repeated runs", () => {
    const a = solveCrewCover(graph, { pairingId: "P-2291", role: "Captain", sickCrewId: "C-1042" });
    const b = solveCrewCover(graph, { pairingId: "P-2291", role: "Captain", sickCrewId: "C-1042" });
    expect(JSON.stringify(a.ranked.map((o) => [o.crewId, o.cost.total]))).toBe(
      JSON.stringify(b.ranked.map((o) => [o.crewId, o.cost.total])),
    );
  });
});

describe("S5 — certification grounding", () => {
  it("flags the post-expiry duty as affected", () => {
    const impact = certImpact(graph, "C-5417", "2026-09-17");
    expect(impact.affected).toContainEqual({
      pairingId: "P-2213",
      dutyDate: "2026-09-19",
      expired: ["recurrent_training"],
    });
  });

  it("recovers the grounded cabin-crew seat with a legal cover", () => {
    const s = solveCrewCover(graph, { pairingId: "P-2213", role: "Cabin Crew", sickCrewId: "C-5417" });
    expect(s.selected?.legality?.legal).toBe(true);
    expect(s.ranked[0].cost.total).toBeGreaterThan(0);
  });
});

describe("candidate generation and edge cases", () => {
  it("pools active same-rank crew with deterministic order", () => {
    const a = findCandidates(graph, { pairingId: "P-2291", role: "Captain", excludeCrewIds: ["C-1042"] });
    const b = findCandidates(graph, { pairingId: "P-2291", role: "Captain", excludeCrewIds: ["C-1042"] });
    expect(a.candidates.map((c) => c.crewId)).toEqual(b.candidates.map((c) => c.crewId));
    expect(a.candidates.length).toBeGreaterThan(5);
    expect(a.candidates.every((c) => c.crew.rank === "Captain")).toBe(true);
    expect(a.candidates.find((c) => c.crewId === "C-3310")?.kind).toBe("reserve");
  });

  it("falls back to cancellation when every candidate is excluded", () => {
    const captains = graph.crews.filter((c) => c.rank === "Captain").map((c) => c.crewId);
    const s = solveCrewCover(graph, { pairingId: "P-2291", role: "Captain", sickCrewId: "C-1042", extraExcludeCrewIds: captains });
    expect(s.ranked).toHaveLength(1);
    expect(s.ranked[0].kind).toBe("cancel");
    expect(s.selected?.kind).toBe("cancel");
  });
});
