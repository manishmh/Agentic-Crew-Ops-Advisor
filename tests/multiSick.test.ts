/** Tier 2E — MULTI_SICK joint consequence and allocation orchestration. */

import { beforeAll, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { buildOperationalGraph, type OperationalGraph } from "../src/data/graph.js";
import { loadOperationalGraph, type LoadedDataset } from "../src/data/loader.js";
import { analyzeDisruption, type MultiSickData } from "../src/orchestration/disruptions.js";

const DATA_DIR = resolve(process.cwd(), "data");
const S6_EVENTS = [
  { crewId: "C-3940", pairingId: "P-2205", reportedUtc: "2026-09-18T00:30:00Z" },
  { crewId: "C-1938", pairingId: "P-2212", reportedUtc: "2026-09-18T00:30:00Z" },
];
let graph: OperationalGraph;
let dataset: LoadedDataset;

beforeAll(() => {
  const loaded = loadOperationalGraph(DATA_DIR);
  graph = loaded.graph;
  dataset = loaded.dataset;
});

function multi(events = S6_EVENTS, target: OperationalGraph = graph): MultiSickData {
  const result = analyzeDisruption(target, { type: "MULTI_SICK", events });
  expect(result.success).toBe(true);
  if (!result.success || result.data.kind !== "multi") throw new Error("expected joint multi-sick analysis");
  return result.data;
}

describe("Tier 2E — MULTI_SICK joint recovery", () => {
  it("produces one complete joint plan for two simultaneous impacts", () => {
    const data = multi();
    expect(data.complete).toBe(true);
    expect(data.disruptions).toHaveLength(2);
    expect(data.affectedPairings).toHaveLength(2);
    expect(data.affectedFlights.length).toBeGreaterThan(0);
    expect(data.jointPlan.assignments).toHaveLength(2);
  });

  it("preserves legal per-disruption options and exact selected costs", () => {
    const data = multi();
    for (const disruption of data.disruptions) {
      const selected = disruption.recovery.ranked.find((option) => option.kind === disruption.selected.kind && option.crewId === disruption.selected.crewId);
      expect(selected).toBeDefined();
      expect(selected?.cost.total).toBe(disruption.selected.costTotal);
      if (selected?.kind === "cover") expect(selected.legality?.legal).toBe(true);
      expect(disruption.recovery.rejected.some((candidate) => candidate.violations.length > 0)).toBe(true);
    }
  });

  it("resolves shared legal candidates jointly instead of assigning one crew twice", () => {
    const data = multi();
    expect(data.sharedCandidateConflicts.length).toBeGreaterThan(0);
    const independent = data.disruptions.map((disruption) => disruption.recovery.selected?.crewId).filter((crewId) => crewId !== undefined);
    expect(new Set(independent).size).toBeLessThan(independent.length);
    const assigned = data.jointPlan.assignments.map((assignment) => assignment.crewId).filter((crewId) => crewId !== undefined);
    expect(new Set(assigned).size).toBe(assigned.length);
  });

  it("chooses the lowest-cost feasible global combination rather than duplicate independent winners", () => {
    const data = multi();
    const independentCost = data.disruptions.reduce((total, disruption) => total + (disruption.recovery.selected?.cost.total ?? 0), 0);
    expect(data.jointPlan.totalCost).toBeGreaterThanOrEqual(independentCost);
    expect(data.jointPlan.totalCost).toBe(data.jointPlan.assignments.reduce((total, assignment) => total + assignment.costTotal, 0));
    expect(data.jointPlan.assignments.every((assignment) => assignment.kind === "cancel" || assignment.crewId !== undefined)).toBe(true);
  });

  it("excludes every simultaneously unavailable crew member from every recovery pool", () => {
    const data = multi();
    const unavailable = new Set(S6_EVENTS.map((event) => event.crewId));
    for (const disruption of data.disruptions) {
      expect(disruption.recovery.ranked.some((option) => option.kind === "cover" && option.crewId !== undefined && unavailable.has(option.crewId))).toBe(false);
    }
  });

  it("keeps a complete plan when a cabin disruption must cancel while the captain is covered", () => {
    const certifications = dataset.certifications.map((cert) => {
      const owner = dataset.crews.find((crew) => crew.crewId === cert.crewId);
      return owner?.rank === "Cabin Crew" ? { ...cert, validTo: "2026-09-01" } : cert;
    });
    const noCabinCover = buildOperationalGraph({ ...dataset, certifications });
    const data = multi([
      { crewId: "C-3940", pairingId: "P-2205", reportedUtc: "2026-09-18T00:30:00Z" },
      { crewId: "C-5417", pairingId: "P-2213", reportedUtc: "2026-09-18T00:30:00Z" },
    ], noCabinCover);
    expect(data.complete).toBe(true);
    expect(data.jointPlan.assignments.some((assignment) => assignment.kind === "cover")).toBe(true);
    expect(data.jointPlan.assignments.some((assignment) => assignment.kind === "cancel")).toBe(true);
  });

  it("supports more than two disruptions without duplicate selected replacements", () => {
    const data = multi([
      ...S6_EVENTS,
      { crewId: "C-1042", pairingId: "P-2291", reportedUtc: "2026-09-18T00:30:00Z" },
    ]);
    expect(data.complete).toBe(true);
    expect(data.disruptions).toHaveLength(3);
    const assigned = data.jointPlan.assignments.map((assignment) => assignment.crewId).filter((crewId) => crewId !== undefined);
    expect(new Set(assigned).size).toBe(assigned.length);
  });

  it("is deterministic and does not mutate the base graph", () => {
    const before = JSON.stringify([graph.crews, graph.pairings, graph.flights, graph.certifications]);
    expect(analyzeDisruption(graph, { type: "MULTI_SICK", events: S6_EVENTS })).toEqual(
      analyzeDisruption(graph, { type: "MULTI_SICK", events: S6_EVENTS }),
    );
    expect(JSON.stringify([graph.crews, graph.pairings, graph.flights, graph.certifications])).toBe(before);
  });

  it("uses the current S6-shaped benchmark through generic allocation", () => {
    const data = multi();
    const byPairing = new Map(data.jointPlan.assignments.map((assignment) => [assignment.pairingId, assignment]));
    expect(byPairing.get("P-2205")?.crewId).toBe("C-3305");
    expect(byPairing.get("P-2212")?.crewId).toBe("C-1017");
    expect(data.jointPlan.totalCost).toBe(graph.costs.reserveCalloutPilot + graph.costs.dayoffCalloutPilot);
  });

  it("fails cleanly for empty, singleton, duplicate, and unknown crew input", () => {
    const empty = analyzeDisruption(graph, { type: "MULTI_SICK", events: [] });
    const singleton = analyzeDisruption(graph, { type: "MULTI_SICK", events: [S6_EVENTS[0]] });
    const duplicate = analyzeDisruption(graph, { type: "MULTI_SICK", events: [S6_EVENTS[0], { ...S6_EVENTS[0], pairingId: "P-2212" }] });
    const unknown = analyzeDisruption(graph, { type: "MULTI_SICK", events: [{ ...S6_EVENTS[0], crewId: "C-0000" }, S6_EVENTS[1]] });
    expect(empty.error).toContain("at least two");
    expect(singleton.error).toContain("at least two");
    expect(duplicate.error).toContain("duplicate unavailable crew");
    expect(unknown.error).toContain("unknown crew C-0000");
  });
});
