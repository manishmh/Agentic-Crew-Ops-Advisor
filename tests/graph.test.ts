/**
 * Foundational tests (STEP 1).
 *
 * All tests load the REAL data files — no fixtures, no mocks.
 * Held-out scenarios are not used; expected answers from
 * internal/held_out_scenarios.json are never inspected or hardcoded.
 */

import { describe, expect, it, beforeAll } from "vitest";
import { resolve } from "node:path";
import { loadOperationalGraph, type LoadedGraph } from "../src/data/loader.js";
import {
  getCertificationsForCrew,
  getCrew,
  getCrewByBase,
  getCrewByRating,
  getCrewForPairing,
  getDutyClock,
  getFlightsByDestination,
  getFlightsByOrigin,
  getFlightsForPairing,
  getPairing,
  getPairingsForCrew,
  getReserve,
  getRiskSignal,
  type OperationalGraph,
} from "../src/data/graph.js";
import { isGraphValid, validateGraph } from "../src/data/validation.js";
import type { LoadedDataset } from "../src/data/loader.js";

// Tests run from the repo root, where ./data lives.
const DATA_DIR = resolve(process.cwd(), "data");

let dataset: LoadedDataset;
let graph: OperationalGraph;

beforeAll(() => {
  const loaded: LoadedGraph = loadOperationalGraph(DATA_DIR);
  dataset = loaded.dataset;
  graph = loaded.graph;
});

describe("dataset loads", () => {
  it("loads all collections without throwing", () => {
    expect(dataset.crews.length).toBeGreaterThan(0);
    expect(dataset.flights.length).toBeGreaterThan(0);
    expect(dataset.pairings.length).toBeGreaterThan(0);
  });

  it("has the expected major counts", () => {
    expect(dataset.flights).toHaveLength(147);
    expect(dataset.crews).toHaveLength(150);
    expect(dataset.pairings).toHaveLength(39);
    expect(dataset.reserves).toHaveLength(16);
  });

  it("loads certifications (4 per crew)", () => {
    expect(dataset.certifications.length).toBeGreaterThan(0);
    expect(dataset.certifications).toHaveLength(600);
    const types = new Set(dataset.certifications.map((c) => c.certType));
    expect(types).toEqual(
      new Set(["licence", "medical_class1", "recurrent_training", "dangerous_goods"]),
    );
  });

  it("loads duty clocks (one per crew)", () => {
    expect(dataset.dutyClocks).toHaveLength(150);
    expect(dataset.dutyClocks[0].dailyHistory).toHaveLength(28);
  });

  it("loads all 7 rules as data", () => {
    expect(dataset.rules).toHaveLength(7);
    expect(dataset.rules.map((r) => r.ruleId)).toContain("RULE-FDP-01");
  });

  it("loads the cost model", () => {
    expect(dataset.costs.currency).toBe("INR");
    expect(dataset.costs.reserveCalloutPilot).toBe(18_500);
  });

  it("loads risk signals (one per crew)", () => {
    expect(dataset.riskSignals).toHaveLength(150);
  });

  it("loads reference data without merging it into the graph", () => {
    expect(dataset.scenarios.length).toBeGreaterThan(0);
    expect(dataset.questions.length).toBeGreaterThan(0);
    // Reference data must not leak into graph collections.
    expect(graph.crews).toHaveLength(dataset.crews.length);
    expect(graph.flights).toHaveLength(dataset.flights.length);
    expect(graph.pairings).toHaveLength(dataset.pairings.length);
  });
});

describe("foundational validation", () => {
  it("passes with no error-severity issues on the real dataset", () => {
    const issues = validateGraph(graph);
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors).toEqual([]);
    expect(isGraphValid(issues)).toBe(true);
  });
});

describe("graph traversals", () => {
  it("1. C-1042 exists", () => {
    const crew = getCrew(graph, "C-1042");
    expect(crew).toBeDefined();
    expect(crew?.crewId).toBe("C-1042");
  });

  it("2. C-1042 is assigned to P-2291", () => {
    const pairings = getPairingsForCrew(graph, "C-1042");
    expect(pairings.map((p) => p.pairingId)).toContain("P-2291");
  });

  it("3. P-2291 exists", () => {
    expect(getPairing(graph, "P-2291")).toBeDefined();
  });

  it("4. P-2291 resolves to its flights", () => {
    const flights = getFlightsForPairing(graph, "P-2291");
    expect(flights.map((f) => f.flightId)).toEqual([
      "DX412-2026-09-15",
      "DX413-2026-09-15",
      "DX588-2026-09-15",
      "DX589-2026-09-16",
      "DX590-2026-09-16",
      "DX591-2026-09-16",
    ]);
    const crew = getCrewForPairing(graph, "P-2291");
    expect(crew.map((c) => c.crewId)).toContain("C-1042");
  });

  it("5. P-2291 is multi-day with nested day structure preserved", () => {
    const pairing = getPairing(graph, "P-2291");
    expect(pairing?.days).toHaveLength(2);
    expect(pairing?.days[0].flights).toEqual([
      "DX412-2026-09-15",
      "DX413-2026-09-15",
      "DX588-2026-09-15",
    ]);
    expect(pairing?.days[1].flights).toEqual([
      "DX589-2026-09-16",
      "DX590-2026-09-16",
      "DX591-2026-09-16",
    ]);
    // Days are nested records on the pairing — not flattened.
    expect(pairing?.days[0].reportUtc).toBe("2026-09-15T06:00:00Z");
  });

  it("6. flights can be found by origin", () => {
    const fromBlr = getFlightsByOrigin(graph, "BLR");
    expect(fromBlr.length).toBeGreaterThan(0);
    expect(fromBlr.every((f) => f.depStation === "BLR")).toBe(true);
  });

  it("7. flights can be found by destination", () => {
    const toDel = getFlightsByDestination(graph, "DEL");
    expect(toDel.length).toBeGreaterThan(0);
    expect(toDel.every((f) => f.arrStation === "DEL")).toBe(true);
  });

  it("8. crew can be found by base", () => {
    const blr = getCrewByBase(graph, "BLR");
    expect(blr.length).toBeGreaterThan(0);
    expect(blr.every((c) => c.base === "BLR")).toBe(true);
    expect(blr.map((c) => c.crewId)).toContain("C-1042");
  });

  it("9. crew can be found by aircraft rating", () => {
    const a320 = getCrewByRating(graph, "A320");
    expect(a320.length).toBeGreaterThan(0);
    expect(a320.every((c) => c.ratings.includes("A320"))).toBe(true);
    expect(a320.map((c) => c.crewId)).toContain("C-1042");
  });

  it("10. certifications can be retrieved by crew", () => {
    const certs = getCertificationsForCrew(graph, "C-1042");
    expect(certs).toHaveLength(4);
    expect(certs.every((c) => c.crewId === "C-1042")).toBe(true);
  });

  it("11. duty clock can be retrieved by crew", () => {
    const clock = getDutyClock(graph, "C-1042");
    expect(clock).toBeDefined();
    expect(clock?.crewId).toBe("C-1042");
  });

  it("12. reserve can be retrieved by crew", () => {
    // C-3310 is a reserve; C-1042 is line crew (not in the pool).
    const reserve = getReserve(graph, "C-3310");
    expect(reserve).toBeDefined();
    expect(reserve?.crewId).toBe("C-3310");
    expect(getReserve(graph, "C-1042")).toBeUndefined();
  });

  it("13. risk signal can be retrieved by crew", () => {
    const risk = getRiskSignal(graph, "C-1042");
    expect(risk).toBeDefined();
    expect(risk?.crewId).toBe("C-1042");
  });
});

describe("source integrity", () => {
  it("preserves the flagged illegal assignment instead of normalizing it", () => {
    // The dataset ships exactly one deliberately illegal roster entry.
    expect(dataset.flaggedExceptions).toHaveLength(1);
    expect(dataset.flaggedExceptions[0].crewId).toBe("C-5417");
    // …and the pairing still references that crew member verbatim.
    const pairingIds = getPairingsForCrew(graph, "C-5417").map((p) => p.pairingId);
    expect(pairingIds.length).toBeGreaterThan(0);
  });

  it("keeps timestamps in their original UTC ISO form", () => {
    const flight = graph.flights[0];
    expect(flight.depUtc).toMatch(/Z$/);
    const pairing = getPairing(graph, "P-2291");
    expect(pairing?.days[0].reportUtc).toMatch(/Z$/);
  });
});
