/** Verification pass C — invariants spanning public Tier-2 analyses. */

import { beforeAll, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { loadOperationalGraph, type LoadedDataset } from "../src/data/loader.js";
import { buildOperationalGraph, type OperationalGraph } from "../src/data/graph.js";
import { analyzeSickCrew } from "../src/orchestration/sickCrew.js";
import { analyzeDisruption } from "../src/orchestration/disruptions.js";

const DATA_DIR = resolve(process.cwd(), "data");
let graph: OperationalGraph;
let dataset: LoadedDataset;

beforeAll(() => {
  const loaded = loadOperationalGraph(DATA_DIR);
  graph = loaded.graph;
  dataset = loaded.dataset;
});

const multiEvents = [
  { crewId: "C-3940", pairingId: "P-2205", reportedUtc: "2026-09-18T00:30:00Z" },
  { crewId: "C-1938", pairingId: "P-2212", reportedUtc: "2026-09-18T00:30:00Z" },
];

function assertFinite(value: unknown): void {
  if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
  else if (Array.isArray(value)) value.forEach(assertFinite);
  else if (value && typeof value === "object") Object.values(value).forEach(assertFinite);
}

describe("Pass C — recovery, cost, and legality invariants", () => {
  it("never selects an illegal cover or an unavailable crew", () => {
    const sick = analyzeSickCrew(graph, { crewId: "C-3231", pairingId: "P-2224" });
    for (const pairing of sick.data.pairings) {
      if (pairing.selected?.kind === "cover") {
        expect(pairing.selected.crewId).not.toBe("C-3231");
        expect(pairing.selected.legality?.legal).toBe(true);
      }
    }
    const multi = analyzeDisruption(graph, { type: "MULTI_SICK", events: multiEvents });
    if (!multi.success || multi.data.kind !== "multi") throw new Error("expected multi analysis");
    const unavailable = new Set(multiEvents.map((event) => event.crewId));
    for (const disruption of multi.data.disruptions) {
      if (disruption.selected.kind === "cover") {
        const option = disruption.recovery.ranked.find((candidate) => candidate.crewId === disruption.selected.crewId);
        expect(option?.legality?.legal).toBe(true);
        expect(unavailable.has(disruption.selected.crewId ?? "")).toBe(false);
      }
    }
  });

  it("accounts for every multi-sick disruption exactly once with finite exact costs", () => {
    const multi = analyzeDisruption(graph, { type: "MULTI_SICK", events: multiEvents });
    if (!multi.success || multi.data.kind !== "multi") throw new Error("expected multi analysis");
    expect(multi.data.complete).toBe(true);
    expect(multi.data.disruptions).toHaveLength(multiEvents.length);
    expect(multi.data.jointPlan.assignments).toHaveLength(multiEvents.length);
    expect(multi.data.jointPlan.totalCost).toBe(multi.data.jointPlan.assignments.reduce((total, assignment) => total + assignment.costTotal, 0));
    for (const disruption of multi.data.disruptions) {
      const selected = disruption.recovery.ranked.find((option) => option.kind === disruption.selected.kind && option.crewId === disruption.selected.crewId);
      expect(selected).toBeDefined();
      if (selected) expect(selected.cost.total).toBe(selected.cost.components.reduce((total, component) => total + component.amount, 0));
    }
    assertFinite(multi);
  });

  it("preserves explicit rejected-candidate state instead of treating empty violations as legal", () => {
    const noReachableCandidates = buildOperationalGraph({
      ...dataset,
      crews: dataset.crews.map((crew) => crew.rank === "Captain" && crew.crewId !== "C-1042" ? { ...crew, base: "ZZZ" } : crew),
    });
    const sick = analyzeSickCrew(noReachableCandidates, { crewId: "C-1042", pairingId: "P-2291" });
    const rejected = sick.data.pairings.flatMap((pairing) => pairing.rejected);
    const prefiltered = rejected.find((candidate) => !candidate.legalityEvaluated);
    const evaluated = analyzeSickCrew(graph, { crewId: "C-1042", pairingId: "P-2291" })
      .data.pairings.flatMap((pairing) => pairing.rejected)
      .find((candidate) => candidate.legalityEvaluated);
    expect(prefiltered?.violations).toEqual([]);
    expect(prefiltered?.reasons.length).toBeGreaterThan(0);
    expect(evaluated?.violations.length).toBeGreaterThan(0);
    expect(sick.data.pairings[0]?.ranked.some((option) => option.crewId === prefiltered?.crewId)).toBe(false);
  });
});

describe("Pass C — public response isolation and timing invariants", () => {
  const calls = () => [
    analyzeSickCrew(graph, { crewId: "C-1042", pairingId: "P-2291" }),
    analyzeDisruption(graph, { type: "DELAY", flightId: "DX401-2026-09-16", delayMinutes: 90 }),
    analyzeDisruption(graph, { type: "STATION_CLOSURE", station: "BLR", startUtc: "2026-09-17T08:00:00Z", endUtc: "2026-09-17T14:00:00Z" }),
    analyzeDisruption(graph, { type: "CERT_EXPIRY", crewId: "C-5417", dutyDate: "2026-09-16" }),
    analyzeDisruption(graph, { type: "MULTI_SICK", events: multiEvents }),
  ];

  it("keeps base state immutable, responses deterministic, and public contract populated after sequential calls", () => {
    const before = JSON.stringify([graph.crews, graph.flights, graph.pairings, graph.certifications, graph.dutyClocks]);
    const firstSick = analyzeSickCrew(graph, { crewId: "C-1042", pairingId: "P-2291" });
    analyzeDisruption(graph, { type: "DELAY", flightId: "DX401-2026-09-16", delayMinutes: 90 });
    expect(analyzeSickCrew(graph, { crewId: "C-1042", pairingId: "P-2291" })).toEqual(firstSick);
    const firstClosure = analyzeDisruption(graph, { type: "STATION_CLOSURE", station: "BLR", startUtc: "2026-09-17T08:00:00Z", endUtc: "2026-09-17T14:00:00Z" });
    analyzeDisruption(graph, { type: "MULTI_SICK", events: multiEvents });
    expect(analyzeDisruption(graph, { type: "STATION_CLOSURE", station: "BLR", startUtc: "2026-09-17T08:00:00Z", endUtc: "2026-09-17T14:00:00Z" })).toEqual(firstClosure);
    for (const result of calls()) {
      expect(result.success).toBe(true);
      expect(result.summary.length).toBeGreaterThan(0);
      expect(result.evidence.length).toBeGreaterThan(0);
      expect(Array.isArray(result.warnings)).toBe(true);
      assertFinite(result);
    }
    expect(JSON.stringify([graph.crews, graph.flights, graph.pairings, graph.certifications, graph.dutyClocks])).toBe(before);
  });

  it("keeps delay/closure evidence tied to resolved timing and maintains hygienic failures", () => {
    const delay = analyzeDisruption(graph, { type: "DELAY", flightId: "DX401-2026-09-16", delayMinutes: 90 });
    const closure = analyzeDisruption(graph, { type: "STATION_CLOSURE", station: "BLR", startUtc: "2026-09-17T08:00:00Z", endUtc: "2026-09-17T14:00:00Z" });
    if (!delay.success || delay.data.kind !== "delay" || !closure.success || closure.data.kind !== "station") throw new Error("expected timing analyses");
    expect(delay.data.releaseAfterUtc).not.toBe(delay.data.releaseUtc);
    expect(closure.evidence.some((item) => item.ruleId === "RULE-FDP-01" && item.actual !== undefined && item.limit !== undefined)).toBe(true);
    const failures = [
      analyzeDisruption(graph, { type: "DELAY", flightId: "missing", delayMinutes: -1 }),
      analyzeDisruption(graph, { type: "STATION_CLOSURE", station: "BLR", startUtc: "bad", endUtc: "also-bad" }),
      analyzeDisruption(graph, { type: "CERT_EXPIRY", crewId: "C-5417", dutyDate: "bad" }),
      analyzeDisruption(graph, { type: "MULTI_SICK", events: [] }),
    ];
    for (const failure of failures) {
      expect(failure.success).toBe(false);
      expect(failure.error).not.toMatch(/\n\s+at |\.ts:\d+/);
    }
  });
});
