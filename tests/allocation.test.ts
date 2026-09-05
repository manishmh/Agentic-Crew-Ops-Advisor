/**
 * Step-3 joint allocation tests (S6): simultaneous disruptions solved
 * together so scarce crew is never double-booked.
 */

import { describe, expect, it, beforeAll } from "vitest";
import { resolve } from "node:path";
import { loadOperationalGraph, type LoadedGraph } from "../src/data/loader.js";
import type { LoadedDataset } from "../src/data/loader.js";
import type { OperationalGraph } from "../src/data/graph.js";
import { allocateJoint } from "../src/recovery/allocation.js";

const DATA_DIR = resolve(process.cwd(), "data");

let dataset: LoadedDataset;
let graph: OperationalGraph;

beforeAll(() => {
  const loaded: LoadedGraph = loadOperationalGraph(DATA_DIR);
  dataset = loaded.dataset;
  graph = loaded.graph;
});

describe("S6 — joint captain cover on 2026-09-18", () => {
  const requests = [
    { pairingId: "P-2205", role: "Captain" as const, sickCrewId: "C-3940", reportedUtc: "2026-09-18T00:30:00Z" },
    { pairingId: "P-2212", role: "Captain" as const, sickCrewId: "C-1938", reportedUtc: "2026-09-18T00:30:00Z" },
  ];

  it("allocates DXA→C-3305 and DXB→C-1017 at ₹42,500 derived from costs", () => {
    const plan = allocateJoint(graph, requests);
    expect(plan.assignments).toHaveLength(2);
    const byPairing = new Map(plan.assignments.map((a) => [a.pairingId, a]));
    expect(byPairing.get("P-2205")?.crewId).toBe("C-3305");
    expect(byPairing.get("P-2212")?.crewId).toBe("C-1017");
    expect(plan.totalCost).toBe(graph.costs.reserveCalloutPilot + graph.costs.dayoffCalloutPilot);
  });

  it("never assigns the same crew twice and stays deterministic", () => {
    const plan = allocateJoint(graph, requests);
    const ids = plan.assignments.map((a) => a.crewId).filter((c) => c !== undefined);
    expect(new Set(ids).size).toBe(ids.length);
    const again = allocateJoint(graph, requests);
    expect(JSON.stringify(again.assignments)).toBe(JSON.stringify(plan.assignments));
    expect(again.totalCost).toBe(plan.totalCost);
  });

  it("resolves forced conflicts without double-booking", () => {
    // Same pairing twice: the cheapest crew cannot take both.
    const plan = allocateJoint(graph, [
      { pairingId: "P-2291", role: "Captain" as const, sickCrewId: "C-1042" },
      { pairingId: "P-2291", role: "Captain" as const, sickCrewId: "C-1042" },
    ]);
    expect(plan.assignments).toHaveLength(2);
    const [a, b] = plan.assignments;
    expect(a.crewId).not.toBe(b.crewId);
    expect(plan.totalCost).toBe(a.costTotal + b.costTotal);
  });
});
