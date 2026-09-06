/**
 * Step-3 simulation tests: S3 station closure, S4 partial recovery,
 * hypothetical legality through overlays, and base-state immutability.
 */

import { describe, expect, it, beforeAll } from "vitest";
import { resolve } from "node:path";
import { loadOperationalGraph, type LoadedGraph } from "../src/data/loader.js";
import type { LoadedDataset } from "../src/data/loader.js";
import type { OperationalGraph } from "../src/data/graph.js";
import { checkCrewAssignmentLegality } from "../src/rules/assignment.js";
import {
  extendReleaseOverlay,
  rotationDelayOverlay,
  rotationDownstream,
  shiftPairingOverlay,
} from "../src/recovery/simulation.js";
import { assessStationClosure, planPartialDayRecovery } from "../src/recovery/recovery.js";

const DATA_DIR = resolve(process.cwd(), "data");
const BLR_CLOSE_START = "2026-09-17T08:00:00Z";
const BLR_CLOSE_END = "2026-09-17T14:00:00Z";

let dataset: LoadedDataset;
let graph: OperationalGraph;

beforeAll(() => {
  const loaded: LoadedGraph = loadOperationalGraph(DATA_DIR);
  dataset = loaded.dataset;
  graph = loaded.graph;
});

describe("S3 — BLR station closure", () => {
  it("identifies affected flights by station/timing semantics", () => {
    const a = assessStationClosure(graph, "BLR", BLR_CLOSE_START, BLR_CLOSE_END);
    const ids = a.impact.affectedFlights.map((f) => f.flightId);
    expect(ids).toContain("DX402-2026-09-17");
    expect(ids).toContain("DX462-2026-09-17");
    expect(ids).not.toContain("DX401-2026-09-17"); // dep 02:30, outside window
    // Every affected flight touches BLR inside the window.
    for (const f of a.impact.affectedFlights) {
      const depHit = f.depStation === "BLR" && f.depUtc >= BLR_CLOSE_START && f.depUtc < BLR_CLOSE_END;
      const arrHit = f.arrStation === "BLR" && f.arrUtc >= BLR_CLOSE_START && f.arrUtc < BLR_CLOSE_END;
      expect(depHit || arrHit).toBe(true);
    }
  });

  it("DX402's crew exceeds FDP while DX462's crew stays legal", () => {
    const a = assessStationClosure(graph, "BLR", BLR_CLOSE_START, BLR_CLOSE_END);
    const dx402 = a.dayAssessments.find((d) => d.pairingId === "P-2204");
    expect(dx402?.shiftMinutes).toBeCloseTo(345, 0);
    expect(dx402?.fdpLegal).toBe(false);
    expect(dx402?.dutyHoursAfter).toBeCloseTo(17, 1);
    expect(dx402?.fdpLimitHours).toBe(12);
    const dx462 = a.dayAssessments.find((d) => d.pairingId === "P-2232");
    expect(dx462?.fdpLegal).toBe(true);
    expect(dx462?.dutyHoursAfter).toBeCloseTo(11, 1);
    expect(dx462?.fdpLimitHours).toBe(13);
  });

  it("hypothetical legality agrees through the overlay (Step-2 engine, no fork)", () => {
    const captain = graph.pairingById.get("P-2204")?.crew.find((m) => m.role === "Captain")?.crewId ?? "";
    const illegal = checkCrewAssignmentLegality(graph, captain, "P-2204", {
      timing: extendReleaseOverlay(graph, "P-2204", "2026-09-17", 345),
    });
    expect(illegal.legal).toBe(false);
    expect(illegal.violations.map((v) => v.ruleId)).toContain("RULE-FDP-01");
    const legal = checkCrewAssignmentLegality(graph, captain, "P-2204");
    expect(legal.legal).toBe(true);
  });
});

describe("S4 — 90-minute delay with partial recovery", () => {
  it("rotation delay propagates downstream with report fixed", () => {
    const downstream = rotationDownstream(graph, "DX401-2026-09-16");
    expect(downstream).toEqual([
      "DX401-2026-09-16",
      "DX402-2026-09-16",
      "DX403-2026-09-16",
      "DX404-2026-09-16",
    ]);
    const o = rotationDelayOverlay(graph, "DX401-2026-09-16", 90);
    expect(o.flightTimes?.get("DX404-2026-09-16")?.depUtc).toBe("2026-09-16T12:45:00Z");
  });

  it("full delayed day is illegal; DX401–DX403 prefix stays legal", () => {
    const plan = planPartialDayRecovery(graph, "P-2203", "2026-09-16", 90);
    expect(plan.fullDayIllegal).toBe(true);
    expect(plan.feasiblePrefixLegs).toBe(3);
    expect(plan.prefixFdpHours).toBeCloseTo(11, 2);
    expect(plan.suffixFlights).toEqual(["DX404-2026-09-16"]);
    expect(plan.suffixReportUtc).toBe("2026-09-16T11:45:00Z");
    expect(plan.suffixReleaseUtc).toBe("2026-09-16T14:15:00Z");
  });

  it("allows an empty prefix when the first delayed leg is already illegal", () => {
    const plan = planPartialDayRecovery(graph, "P-2203", "2026-09-16", 1000);
    expect(plan.fullDayIllegal).toBe(true);
    expect(plan.feasiblePrefixLegs).toBe(0);
    expect(plan.suffixFlights).toEqual([
      "DX401-2026-09-16",
      "DX402-2026-09-16",
      "DX403-2026-09-16",
      "DX404-2026-09-16",
    ]);
  });

  it("produces suffix covers per vacated role with callout-only cost", () => {
    const plan = planPartialDayRecovery(graph, "P-2203", "2026-09-16", 90);
    expect(plan.suffixCovers.length).toBeGreaterThan(0);
    for (const sc of plan.suffixCovers) {
      expect(sc.options.length).toBeGreaterThan(0);
      expect(sc.options[0].legality.legal).toBe(true);
    }
    expect(plan.suffixTotalCost).toBeGreaterThan(0);
  });

  it("shift overlay moves whole pairing days uniformly (deadhead model)", () => {
    const o = shiftPairingOverlay(graph, "P-2291", 180);
    expect(o.dayWindows?.get("P-2291|2026-09-15")).toEqual({
      reportUtc: "2026-09-15T09:00:00Z",
      releaseUtc: "2026-09-15T18:30:00Z",
    });
    expect(o.flightTimes?.get("DX412-2026-09-15")?.depUtc).toBe("2026-09-15T10:00:00Z");
  });
});

describe("simulation invariants", () => {
  it("repeated simulation does not mutate canonical state", () => {
    const before = JSON.stringify([graph.flights, graph.pairings, graph.crews]);
    rotationDelayOverlay(graph, "DX401-2026-09-16", 90);
    extendReleaseOverlay(graph, "P-2204", "2026-09-17", 345);
    shiftPairingOverlay(graph, "P-2291", 180);
    planPartialDayRecovery(graph, "P-2203", "2026-09-16", 90);
    assessStationClosure(graph, "BLR", BLR_CLOSE_START, BLR_CLOSE_END);
    expect(JSON.stringify([graph.flights, graph.pairings, graph.crews])).toBe(before);
    // Source timestamps verbatim after all simulation.
    expect(graph.flightById.get("DX401-2026-09-16")?.depUtc).toBe("2026-09-16T02:30:00Z");
  });

  it("overlay builders return fresh objects every call", () => {
    const a = rotationDelayOverlay(graph, "DX401-2026-09-16", 90);
    const b = rotationDelayOverlay(graph, "DX401-2026-09-16", 90);
    expect(a).not.toBe(b);
    expect(a.flightTimes).not.toBe(b.flightTimes);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
