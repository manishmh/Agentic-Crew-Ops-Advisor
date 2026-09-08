/**
 * Tier 2B tests — DELAY consequence analysis only.
 * IDs/durations below are fixtures; implementation takes none.
 */

import { describe, expect, it, beforeAll } from "vitest";
import { resolve } from "node:path";
import { loadOperationalGraph, type LoadedGraph } from "../src/data/loader.js";
import type { LoadedDataset } from "../src/data/loader.js";
import type { OperationalGraph } from "../src/data/graph.js";
import { analyzeDelay } from "../src/orchestration/delay.js";
import { analyzeDisruption } from "../src/orchestration/disruptions.js";

const DATA_DIR = resolve(process.cwd(), "data");

let dataset: LoadedDataset;
let graph: OperationalGraph;

beforeAll(() => {
  const loaded: LoadedGraph = loadOperationalGraph(DATA_DIR);
  dataset = loaded.dataset;
  graph = loaded.graph;
});

describe("A/B. basic delay and propagation", () => {
  it("resolves flight, pairing, crew, and shifted times", () => {
    const r = analyzeDelay(graph, { flightId: "DX403-2026-09-16", delayMinutes: 30 });
    expect(r.success).toBe(true);
    expect(r.data.pairingId).toBe("P-2203");
    expect(r.data.crew.length).toBeGreaterThan(0);
    expect(r.data.shiftedFlights.map((f) => f.flightId)).toEqual([
      "DX403-2026-09-16",
      "DX404-2026-09-16",
    ]);
    expect(r.data.reportUtc).toBe("2026-09-16T01:30:00Z");
    expect(r.data.releaseAfterUtc).toBe("2026-09-16T13:15:00Z");
  });

  it("shifts only downstream rotation legs, nothing unrelated", () => {
    const r = analyzeDelay(graph, { flightId: "DX403-2026-09-16", delayMinutes: 30 });
    const dx404 = r.data.shiftedFlights.find((f) => f.flightId === "DX404-2026-09-16");
    expect(dx404?.depUtc).toBe("2026-09-16T11:45:00Z");
    expect(r.data.shiftedFlights.some((f) => f.flightId === "DX401-2026-09-16")).toBe(false);
    expect(r.data.shiftedFlights.some((f) => f.flightId === "DX401-2026-09-14")).toBe(false);
  });
});

describe("C/D. FDP consequence and no-breach explicitness", () => {
  it("detects an FDP breach with exact actual/limit evidence", () => {
    const r = analyzeDelay(graph, { flightId: "DX401-2026-09-16", delayMinutes: 90 });
    expect(r.success).toBe(true);
    expect(r.data.recoveryRequired).toBe(true);
    const fdp = r.evidence.find((e) => e.ruleId === "RULE-FDP-01" && e.passed === false);
    expect(fdp?.actual).toBeCloseTo(12.75, 2);
    expect(fdp?.limit).toBe(12);
  });

  it("states recoveryRequired false explicitly when absorbed", () => {
    const r = analyzeDelay(graph, { flightId: "DX401-2026-09-16", delayMinutes: 30 });
    expect(r.success).toBe(true);
    expect(r.data.recoveryRequired).toBe(false);
    expect(r.data.boundary).toBeUndefined();
    expect(r.data.recommended).toBeUndefined();
    expect(r.data.crew.every((c) => c.legal)).toBe(true);
    expect(r.data.cancelFlights).toEqual([]);
    expect(r.data.cancelCostTotal).toBe(0);
    expect(r.data.timingChanges[0]).toEqual({
      flightId: "DX401-2026-09-16",
      before: { depUtc: "2026-09-16T02:30:00Z", arrUtc: "2026-09-16T05:15:00Z" },
      after: { depUtc: "2026-09-16T03:00:00Z", arrUtc: "2026-09-16T05:45:00Z" },
    });
  });
});

describe("E. rest/downstream consequence", () => {
  it("detects delay-shrunk overnight rest below 12h", () => {
    const r = analyzeDelay(graph, { flightId: "DX412-2026-09-15", delayMinutes: 60 });
    expect(r.success).toBe(true);
    expect(r.data.recoveryRequired).toBe(true);
    const rest = r.evidence.find((e) => e.ruleId === "RULE-REST-04" && e.passed === false);
    expect(rest?.actual).toBeCloseTo(11.5, 2);
    expect(rest?.limit).toBe(12);
  });
});

describe("F/G. boundary and recovery options", () => {
  it("identifies the first intervention point deterministically", () => {
    const r = analyzeDelay(graph, { flightId: "DX401-2026-09-16", delayMinutes: 90 });
    expect(r.data.boundary?.feasiblePrefixLegs).toBe(3);
    expect(r.data.boundary?.firstAffectedFlight).toBe("DX404-2026-09-16");
  });

  it("produces partial and full re-crew options from the engine", () => {
    const r = analyzeDelay(graph, { flightId: "DX401-2026-09-16", delayMinutes: 90 });
    expect(r.data.partial?.suffixFlights).toEqual(["DX404-2026-09-16"]);
    expect(r.data.partial?.suffixCovers.length).toBeGreaterThan(0);
    for (const sc of r.data.partial?.suffixCovers ?? []) {
      expect(sc.options.length).toBeGreaterThan(0);
    }
    expect(r.data.fullRecrew?.length).toBeGreaterThan(0);
    for (const fr of r.data.fullRecrew ?? []) {
      expect(fr.solution.ranked.some((o) => o.kind === "cover")).toBe(true);
    }
    expect(r.data.recommended?.strategy).toBe("partial");
  });

  it("enforces the base and positioning rule at a partial recovery boundary", () => {
    const r = analyzeDelay(graph, { flightId: "DX413-2026-09-15", delayMinutes: 75 });
    const partial = r.data.partial;
    expect(partial).toMatchObject({
      prefixFlights: ["DX412-2026-09-15", "DX413-2026-09-15"],
      suffixFlights: ["DX588-2026-09-15"],
      suffixReportUtc: "2026-09-15T12:30:00Z",
      suffixTotalCost: 56000,
    });
    const captain = partial?.suffixCovers.find((cover) => cover.role === "Captain");
    expect(captain?.options[0]).toMatchObject({
      crewId: "C-3310",
      requiredReportLocation: "BLR",
      positioning: { required: false, from: "BLR", to: "BLR" },
      cost: { total: 18500, components: [{ type: "reserve_callout", amount: 18500 }] },
    });
    const crossBase = captain?.options.find((option) => option.crewId === "C-2210");
    expect(crossBase).toMatchObject({
      requiredReportLocation: "BLR",
      requiredReportUtc: "2026-09-15T12:30:00Z",
      positioning: {
        required: true,
        from: "DEL",
        to: "BLR",
        flightId: "DX402-2026-09-15",
        arrivalUtc: "2026-09-15T08:45:00Z",
      },
      cost: {
        total: 25000,
        components: [
          { type: "reserve_callout", amount: 18500 },
          { type: "deadhead", amount: 6500 },
        ],
      },
      delayHours: 0,
    });
    expect(crossBase?.legality.checks).toContainEqual(expect.objectContaining({
      ruleId: "RULE-BASE-07",
      passed: true,
      evidence: expect.objectContaining({ requiresPositioning: true, positioningFlightId: "DX402-2026-09-15" }),
    }));
  });
});

describe("H. exact cost arithmetic", () => {
  it("totals equal deterministic component sums", () => {
    const r = analyzeDelay(graph, { flightId: "DX401-2026-09-16", delayMinutes: 90 });
    const partial = r.data.partial;
    expect(partial?.suffixTotalCost).toBe(
      (partial?.suffixCovers ?? []).reduce((n, s) => n + (s.options[0]?.costTotal ?? 0), 0),
    );
    expect(r.data.recommended?.totalCost).toBe(partial?.suffixTotalCost);
    for (const fr of r.data.fullRecrew ?? []) {
      for (const o of fr.solution.ranked) {
        expect(o.cost.total).toBe(o.cost.components.reduce((n, c) => n + c.amount, 0));
      }
    }
    expect(r.data.cancelCostTotal).toBe(graph.costs.cancellationPerFlight);
  });
});

describe("I/J. determinism and mutation safety", () => {
  it("identical analysis twice deep-compares equal", () => {
    const a = analyzeDelay(graph, { flightId: "DX401-2026-09-16", delayMinutes: 90 });
    const b = analyzeDelay(graph, { flightId: "DX401-2026-09-16", delayMinutes: 90 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("base graph state is unchanged after simulation", () => {
    const before = JSON.stringify([graph.flights, graph.pairings, graph.crews]);
    analyzeDelay(graph, { flightId: "DX401-2026-09-16", delayMinutes: 90 });
    analyzeDelay(graph, { flightId: "DX412-2026-09-15", delayMinutes: 60 });
    expect(JSON.stringify([graph.flights, graph.pairings, graph.crews])).toBe(before);
    expect(graph.flightById.get("DX401-2026-09-16")?.depUtc).toBe("2026-09-16T02:30:00Z");
  });
});

describe("K/L. duration-driven behavior and inclusive limits", () => {
  it("same flight, two durations: legal then illegal", () => {
    const small = analyzeDelay(graph, { flightId: "DX401-2026-09-16", delayMinutes: 30 });
    const large = analyzeDelay(graph, { flightId: "DX401-2026-09-16", delayMinutes: 90 });
    expect(small.data.recoveryRequired).toBe(false);
    expect(large.data.recoveryRequired).toBe(true);
  });

  it("exact limit stays legal, one minute more does not", () => {
    const at = analyzeDelay(graph, { flightId: "DX401-2026-09-16", delayMinutes: 45 });
    const over = analyzeDelay(graph, { flightId: "DX401-2026-09-16", delayMinutes: 46 });
    expect(at.data.recoveryRequired).toBe(false);
    expect(over.data.recoveryRequired).toBe(true);
  });

  it("rejects invalid inputs explicitly", () => {
    expect(analyzeDelay(graph, { flightId: "DX999-2026-09-16", delayMinutes: 30 }).success).toBe(false);
    expect(analyzeDelay(graph, { flightId: "DX401-2026-09-16", delayMinutes: -5 }).success).toBe(false);
  });
});

describe("public DELAY orchestration route", () => {
  it("delegates to the full delay consequence workflow", () => {
    const direct = analyzeDelay(graph, { flightId: "DX401-2026-09-16", delayMinutes: 90 });
    const routed = analyzeDisruption(graph, { type: "DELAY", flightId: "DX401-2026-09-16", delayMinutes: 90 });
    expect(routed).toEqual(direct);
    if (routed.data.kind !== "delay") throw new Error("wrong kind");
    expect(routed.data.recoveryRequired).toBe(true);
    expect(routed.data.boundary?.firstAffectedFlight).toBe("DX404-2026-09-16");
    expect(routed.data.recommended?.totalCost).toBeDefined();
  });
});
