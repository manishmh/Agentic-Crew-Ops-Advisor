/** Tier 2F — controller-facing contract integration across all Tier-2 tools. */

import { beforeAll, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { loadOperationalGraph, type LoadedGraph } from "../src/data/loader.js";
import type { OperationalGraph } from "../src/data/graph.js";
import { analyzeDisruption } from "../src/orchestration/disruptions.js";
import { analyzeSickCrew } from "../src/orchestration/sickCrew.js";

const DATA_DIR = resolve(process.cwd(), "data");
let graph: OperationalGraph;

beforeAll(() => {
  const loaded: LoadedGraph = loadOperationalGraph(DATA_DIR);
  graph = loaded.graph;
});

function expectFiniteNumbers(value: unknown): void {
  if (typeof value === "number") {
    expect(Number.isFinite(value)).toBe(true);
  } else if (Array.isArray(value)) {
    value.forEach(expectFiniteNumbers);
  } else if (value && typeof value === "object") {
    Object.values(value).forEach(expectFiniteNumbers);
  }
}

describe("Tier 2F — cross-event ToolResult contract", () => {
  const calls = () => [
    analyzeSickCrew(graph, { crewId: "C-1042", pairingId: "P-2291", reportedUtc: "2026-09-15T05:00:00Z" }),
    analyzeDisruption(graph, { type: "DELAY", flightId: "DX401-2026-09-16", delayMinutes: 90 }),
    analyzeDisruption(graph, { type: "STATION_CLOSURE", station: "BLR", startUtc: "2026-09-17T08:00:00Z", endUtc: "2026-09-17T14:00:00Z" }),
    analyzeDisruption(graph, { type: "CERT_EXPIRY", crewId: "C-5417", dutyDate: "2026-09-16", certificationType: "recurrent_training" }),
    analyzeDisruption(graph, {
      type: "MULTI_SICK",
      events: [
        { crewId: "C-3940", pairingId: "P-2205", reportedUtc: "2026-09-18T00:30:00Z" },
        { crewId: "C-1938", pairingId: "P-2212", reportedUtc: "2026-09-18T00:30:00Z" },
      ],
    }),
  ];

  it("returns complete, evidence-backed ToolResults with finite numeric output", () => {
    for (const result of calls()) {
      expect(result.success).toBe(true);
      expect(result.type).toBe("DISRUPTION_ANALYSIS");
      expect(result.summary).toEqual(expect.any(String));
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.evidence)).toBe(true);
      expect(result.evidence.length).toBeGreaterThan(0);
      expect(Array.isArray(result.warnings)).toBe(true);
      expectFiniteNumbers(result);
    }
  });

  it("labels whether each rejected Tier-2 recovery candidate reached legality evaluation", () => {
    const sick = analyzeSickCrew(graph, { crewId: "C-1042", pairingId: "P-2291" });
    const multi = analyzeDisruption(graph, {
      type: "MULTI_SICK",
      events: [
        { crewId: "C-3940", pairingId: "P-2205", reportedUtc: "2026-09-18T00:30:00Z" },
        { crewId: "C-1938", pairingId: "P-2212", reportedUtc: "2026-09-18T00:30:00Z" },
      ],
    });
    const rejected = [
      ...sick.data.pairings.flatMap((pairing) => pairing.rejected),
      ...(multi.success && multi.data.kind === "multi" ? multi.data.disruptions.flatMap((disruption) => disruption.recovery.rejected) : []),
    ];
    expect(rejected.length).toBeGreaterThan(0);
    expect(rejected.every((candidate) => typeof candidate.legalityEvaluated === "boolean")).toBe(true);
  });

  it("is deterministic and leaves the shared operational graph unchanged", () => {
    const before = JSON.stringify([graph.crews, graph.flights, graph.pairings, graph.certifications, graph.dutyClocks]);
    expect(calls()).toEqual(calls());
    expect(JSON.stringify([graph.crews, graph.flights, graph.pairings, graph.certifications, graph.dutyClocks])).toBe(before);
  });

  it("uses operational failure results for malformed Tier-2 inputs without stack leakage", () => {
    const failures = [
      analyzeSickCrew(graph, { crewId: "C-0000", pairingId: "P-2291" }),
      analyzeSickCrew(graph, { crewId: "C-1042", pairingId: "P-0000" }),
      analyzeDisruption(graph, { type: "DELAY", flightId: "DX-UNKNOWN", delayMinutes: -1 }),
      analyzeDisruption(graph, { type: "STATION_CLOSURE", station: "ZZZ", startUtc: "2026-09-17T14:00:00Z", endUtc: "2026-09-17T08:00:00Z" }),
      analyzeDisruption(graph, { type: "CERT_EXPIRY", crewId: "C-5417", dutyDate: "not-a-date" }),
      analyzeDisruption(graph, { type: "MULTI_SICK", events: [] }),
    ];
    for (const result of failures) {
      expect(result.success).toBe(false);
      expect(result.type).toBe("DISRUPTION_ANALYSIS");
      expect(result.error).toEqual(expect.any(String));
      expect(result.error).not.toContain("\n    at ");
      expect(Array.isArray(result.evidence)).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
    }
  });
});
