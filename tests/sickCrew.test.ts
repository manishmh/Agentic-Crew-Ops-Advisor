/**
 * Tier 2A tests — SICK_CREW consequence analysis only.
 * Crew/pairing IDs below are test fixtures; implementation takes none.
 */

import { describe, expect, it, beforeAll } from "vitest";
import { resolve } from "node:path";
import { loadOperationalGraph, type LoadedGraph } from "../src/data/loader.js";
import type { LoadedDataset } from "../src/data/loader.js";
import type { OperationalGraph } from "../src/data/graph.js";
import { analyzeSickCrew } from "../src/orchestration/sickCrew.js";

const DATA_DIR = resolve(process.cwd(), "data");

let dataset: LoadedDataset;
let graph: OperationalGraph;

beforeAll(() => {
  const loaded: LoadedGraph = loadOperationalGraph(DATA_DIR);
  dataset = loaded.dataset;
  graph = loaded.graph;
});

describe("A. general arbitrary sick crew", () => {
  it("resolves crew, pairing, flights, and recovery from dataset relations", () => {
    const pairing = graph.pairings[0];
    const captain = pairing.crew.find((m) => m.role === "Captain")?.crewId ?? "";
    const r = analyzeSickCrew(graph, { crewId: captain });
    expect(r.success).toBe(true);
    expect(r.data.crewId).toBe(captain);
    expect(r.data.pairings.length).toBeGreaterThan(0);
    for (const p of r.data.pairings) {
      expect(p.flights.length).toBeGreaterThan(0);
      expect(p.role).toBeTruthy();
      expect(p.aircraftTypes.length).toBeGreaterThan(0);
    }
  });
});

describe("B. multi-day pairing impact", () => {
  it("a sick call uncovers the whole pairing, not one flight", () => {
    const r = analyzeSickCrew(graph, { crewId: "C-1042", pairingId: "P-2291" });
    expect(r.success).toBe(true);
    const p = r.data.pairings[0];
    expect(p.dates).toEqual(["2026-09-15", "2026-09-16"]);
    expect(p.multiDuty).toBe(true);
    expect(p.flights).toHaveLength(6);
  });
});

describe("C/D. legal and illegal candidates", () => {
  it("returns a legal candidate with deterministic evidence", () => {
    const r = analyzeSickCrew(graph, { crewId: "C-1042", pairingId: "P-2291" });
    const p = r.data.pairings[0];
    expect(p.recoveryAvailable).toBe(true);
    expect(p.selected?.legality?.legal).toBe(true);
    expect(p.selected?.legality?.checks.length).toBeGreaterThan(0);
    expect(r.evidence.map((e) => e.ruleId)).toContain("RULE-DUTY-02");
  });

  it("rejects an illegal candidate with structured rule evidence", () => {
    const r = analyzeSickCrew(graph, { crewId: "C-1042", pairingId: "P-2291" });
    const rej = r.data.pairings[0].rejected.find((x) => x.crewId === "C-2087");
    expect(rej).toBeDefined();
    expect(rej?.violations[0].ruleId).toBe("RULE-DUTY-02");
    expect(rej?.violations[0].actual).toBeCloseTo(61.33, 2);
    expect(rej?.violations[0].limit).toBe(60);
  });
});

describe("E. no legal candidate", () => {
  it("returns explicit no-recovery with cancellation fallback", () => {
    const captains = graph.crews.filter((c) => c.rank === "Captain").map((c) => c.crewId);
    const r = analyzeSickCrew(graph, {
      crewId: "C-1042",
      pairingId: "P-2291",
      extraExcludeCrewIds: captains,
    });
    expect(r.success).toBe(true);
    const p = r.data.pairings[0];
    expect(p.recoveryAvailable).toBe(false);
    expect(p.noRecoveryReason).toBe("No legal replacement crew found.");
    expect(p.selected?.kind).toBe("cancel");
    expect(p.cancelCost?.total).toBe(6 * graph.costs.cancellationPerFlight);
    expect(r.warnings.some((w) => w.includes("No legal replacement crew"))).toBe(true);
  });
});

describe("F. exact cost arithmetic", () => {
  it("selected total equals the deterministic component sum", () => {
    const r = analyzeSickCrew(graph, { crewId: "C-1042", pairingId: "P-2291" });
    const selected = r.data.pairings[0].selected;
    expect(selected).toBeDefined();
    expect(selected?.cost.total).toBe(selected?.cost.components.reduce((n, c) => n + c.amount, 0));
    expect(selected?.cost.total).toBe(graph.costs.reserveCalloutPilot);
  });
});

describe("G/H. determinism and mutation safety", () => {
  it("identical analysis twice deep-compares equal", () => {
    const a = analyzeSickCrew(graph, { crewId: "C-1042", pairingId: "P-2291" });
    const b = analyzeSickCrew(graph, { crewId: "C-1042", pairingId: "P-2291" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("base graph state is unchanged after simulation", () => {
    const before = JSON.stringify([graph.flights, graph.pairings, graph.crews]);
    analyzeSickCrew(graph, { crewId: "C-1042" });
    analyzeSickCrew(graph, { crewId: "C-1042", pairingId: "P-2291" });
    expect(JSON.stringify([graph.flights, graph.pairings, graph.crews])).toBe(before);
  });
});

describe("I. benchmark-shaped case (fixture only)", () => {
  it("C-1042/P-2291 emergences: 2087 out, 3310 best, 2210 deadhead-legal", () => {
    const r = analyzeSickCrew(graph, { crewId: "C-1042", pairingId: "P-2291", reportedUtc: "2026-09-15T05:00:00Z" });
    const p = r.data.pairings[0];
    expect(p.rejected.map((x) => x.crewId)).toContain("C-2087");
    expect(p.selected?.crewId).toBe("C-3310");
    const dh = p.ranked.find((o) => o.crewId === "C-2210");
    expect(dh?.legality?.legal).toBe(true);
    expect(dh?.cost.total).toBe(
      graph.costs.reserveCalloutPilot + graph.costs.deadheadPositioning + 3 * graph.costs.delayCostPerDutyHour,
    );
    // Ranking: cheapest legal first.
    const costs = p.ranked.filter((o) => o.kind === "cover").map((o) => o.cost.total);
    expect([...costs].sort((a, b) => a - b)).toEqual(costs);
  });
});

describe("J. H1-shaped ATR First Officer generalization", () => {
  it("qualification constraints generalize to unseen role/aircraft combos", () => {
    const fo = graph.pairingById.get("P-2224")?.crew.find((m) => m.role === "First Officer")?.crewId ?? "";
    expect(fo).not.toBe("");
    const r = analyzeSickCrew(graph, { crewId: fo, pairingId: "P-2224" });
    expect(r.success).toBe(true);
    const p = r.data.pairings[0];
    expect(p.role).toBe("First Officer");
    expect(p.aircraftTypes).toEqual(["ATR72"]);
    for (const o of p.ranked) {
      if (o.kind === "cover" && o.legality) {
        expect(o.legality.checks.find((c) => c.ruleId === "RULE-QUAL-05")?.passed).toBe(true);
      }
    }
  });
});
