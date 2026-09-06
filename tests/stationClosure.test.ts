/** Tier 2C — station-closure consequence analysis, composed from existing engines. */

import { beforeAll, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { loadOperationalGraph, type LoadedGraph } from "../src/data/loader.js";
import type { OperationalGraph } from "../src/data/graph.js";
import { addMinutes } from "../src/data/time.js";
import { analyzeDisruption, type StationClosureData } from "../src/orchestration/disruptions.js";

const DATA_DIR = resolve(process.cwd(), "data");
let graph: OperationalGraph;

beforeAll(() => {
  const loaded: LoadedGraph = loadOperationalGraph(DATA_DIR);
  graph = loaded.graph;
});

function closure(station: string, startUtc: string, endUtc: string): StationClosureData {
  const result = analyzeDisruption(graph, { type: "STATION_CLOSURE", station, startUtc, endUtc });
  expect(result.success).toBe(true);
  if (!result.success || result.data.kind !== "station") throw new Error("expected station closure analysis");
  return result.data;
}

describe("Tier 2C — STATION_CLOSURE consequence analysis", () => {
  it("accepts an arbitrary station/window and returns sorted structured affected flights", () => {
    const data = closure("HYD", "2026-09-19T05:00:00Z", "2026-09-19T09:00:00Z");
    expect(data.closureWindow.boundarySemantics).toBe("[startUtc, endUtc)");
    expect(data.affectedFlights).toEqual(data.affectedFlightDetails.map((flight) => flight.flightId));
    expect(data.affectedFlightDetails).toHaveLength(2);
    expect(data.affectedFlightDetails[0]).toMatchObject({
      date: "2026-09-19",
      scheduledDepartureUtc: expect.any(String),
      scheduledArrivalUtc: expect.any(String),
    });
  });

  it("matches a departure at the closed station", () => {
    const flight = graph.flights.find((item) => item.depStation === "BLR");
    expect(flight).toBeDefined();
    if (!flight) return;
    const data = closure("BLR", flight.depUtc, addMinutes(flight.depUtc, 1));
    expect(data.affectedFlightDetails.find((item) => item.flightId === flight.flightId)?.reasons)
      .toContain("DEPARTURE_IN_CLOSURE");
  });

  it("matches an arrival at the closed station", () => {
    const flight = graph.flights.find((item) => item.arrStation === "BLR");
    expect(flight).toBeDefined();
    if (!flight) return;
    const data = closure("BLR", flight.arrUtc, addMinutes(flight.arrUtc, 1));
    const detail = data.affectedFlightDetails.find((item) => item.flightId === flight.flightId);
    expect(detail?.reasons).toContain("ARRIVAL_IN_CLOSURE");
    expect(detail?.reasons).not.toContain("DEPARTURE_IN_CLOSURE");
  });

  it("leaves a same-station operation outside a strictly-before or strictly-after window unaffected", () => {
    const flight = graph.flights.find((item) => item.depStation === "BLR");
    expect(flight).toBeDefined();
    if (!flight) return;
    const before = closure("BLR", addMinutes(flight.depUtc, -2), addMinutes(flight.depUtc, -1));
    const after = closure("BLR", addMinutes(flight.depUtc, 1), addMinutes(flight.depUtc, 2));
    expect(before.affectedFlights).not.toContain(flight.flightId);
    expect(after.affectedFlights).not.toContain(flight.flightId);
  });

  it("pins generator-compatible start-inclusive/end-exclusive window boundaries", () => {
    const flight = graph.flights.find((item) => item.depStation === "BLR");
    expect(flight).toBeDefined();
    if (!flight) return;
    const exactStart = closure("BLR", flight.depUtc, addMinutes(flight.depUtc, 1));
    const exactEnd = closure("BLR", addMinutes(flight.depUtc, -1), flight.depUtc);
    expect(exactStart.affectedFlights).toContain(flight.flightId);
    expect(exactEnd.affectedFlights).not.toContain(flight.flightId);
  });

  it("propagates affected flights to pairings and rostered crew without duplicate summaries", () => {
    const data = closure("BLR", "2026-09-17T08:00:00Z", "2026-09-17T14:00:00Z");
    const pairing = data.affectedPairings.find((item) => item.pairingId === "P-2204");
    expect(pairing?.affectedFlightCount).toBeGreaterThan(1);
    expect(pairing?.days[0]?.multipleFlightsInDuty).toBe(true);
    expect(new Set(data.affectedPairings.map((item) => item.pairingId)).size).toBe(data.affectedPairings.length);
    expect(new Set(data.affectedCrew.map((item) => item.crewId)).size).toBe(data.affectedCrew.length);
    const rostered = graph.pairingById.get("P-2204")?.crew.map((member) => member.crewId).sort();
    const propagated = data.affectedCrew
      .filter((crew) => crew.pairingIds.includes("P-2204"))
      .map((crew) => crew.crewId)
      .sort();
    expect(propagated).toEqual(rostered);
    expect(data.affectedCrew.find((crew) => crew.pairingIds.includes("P-2204"))?.roles.length).toBeGreaterThan(0);
  });

  it("distinguishes closure delay from a crew recovery requirement and exposes modeled downstream impact", () => {
    const requiresRecovery = closure("BLR", "2026-09-17T08:00:00Z", "2026-09-17T14:00:00Z");
    expect(requiresRecovery.recoveryRequired).toBe(true);
    expect(requiresRecovery.operationalConsequences.every((item) => item.canOperateAsPlanned === false)).toBe(true);
    expect(requiresRecovery.operationalConsequences.some((item) => item.subsequentFlightsImpacted.length > 0)).toBe(true);

    const absorbed = graph.flights
      .map((flight) => closure(flight.depStation, flight.depUtc, addMinutes(flight.depUtc, 1)))
      .find((data) => !data.recoveryRequired);
    expect(absorbed?.recoveryRequired).toBe(false);
  });

  it("reuses existing partial/full recovery and exposes a deterministic cancellation fallback", () => {
    const data = closure("BLR", "2026-09-17T08:00:00Z", "2026-09-17T14:00:00Z");
    expect(data.recoveryRequirements.length).toBeGreaterThan(0);
    const requirement = data.recoveryRequirements[0];
    expect(requirement.fullRecrew.length).toBeGreaterThan(0);
    expect(requirement.cancellationFallback.flightIds.length).toBeGreaterThan(0);
    expect(requirement.cancellationFallback.cost.components).toHaveLength(1);
    expect(requirement.cancellationFallback.cost.components[0]?.type).toBe("cancellation");
    expect(requirement.recommended).toBeDefined();
  });

  it("aggregates cancellation fallback cost solely from deterministic cost components", () => {
    const data = closure("BLR", "2026-09-17T08:00:00Z", "2026-09-17T14:00:00Z");
    expect(data.cancellationFallback.flightIds.length).toBeGreaterThan(1);
    expect(data.cancellationFallback.cost.total).toBe(
      data.cancellationFallback.cost.components.reduce((total, component) => total + component.amount, 0),
    );
    expect(data.cancellationFallback.cost.total).toBe(
      data.cancellationFallback.flightIds.length * graph.costs.cancellationPerFlight,
    );
  });

  it("reproduces the H2-shaped HYD closure through generic matching", () => {
    const data = closure("HYD", "2026-09-19T05:00:00Z", "2026-09-19T09:00:00Z");
    expect(data.affectedFlights).toEqual(["DX461-2026-09-19", "DX462-2026-09-19"]);
    expect(data.affectedFlightDetails.every((flight) => flight.reasons.length > 0)).toBe(true);
  });

  it("is deterministic and leaves the base graph unchanged", () => {
    const before = JSON.stringify([graph.flights, graph.pairings, graph.crews]);
    const event = { type: "STATION_CLOSURE" as const, station: "HYD", startUtc: "2026-09-19T05:00:00Z", endUtc: "2026-09-19T09:00:00Z" };
    const first = analyzeDisruption(graph, event);
    const second = analyzeDisruption(graph, event);
    expect(first).toEqual(second);
    expect(JSON.stringify([graph.flights, graph.pairings, graph.crews])).toBe(before);
  });

  it("fails cleanly for an unknown station and invalid closure interval", () => {
    const unknown = analyzeDisruption(graph, {
      type: "STATION_CLOSURE", station: "ZZZ", startUtc: "2026-09-19T05:00:00Z", endUtc: "2026-09-19T09:00:00Z",
    });
    const invalid = analyzeDisruption(graph, {
      type: "STATION_CLOSURE", station: "HYD", startUtc: "2026-09-19T09:00:00Z", endUtc: "2026-09-19T05:00:00Z",
    });
    expect(unknown.success).toBe(false);
    expect(unknown.error).toContain("unknown station ZZZ");
    expect(invalid.success).toBe(false);
    expect(invalid.error).toContain("startUtc must be before endUtc");
  });
});
