/** Verification passes B — selected adversarial Tier-2 operational cases. */

import { beforeAll, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { buildOperationalGraph, type OperationalGraph } from "../src/data/graph.js";
import { loadOperationalGraph, type LoadedDataset } from "../src/data/loader.js";
import { addDays, addMinutes, calendarDate } from "../src/data/time.js";
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

function finite(value: unknown): void {
  if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
  else if (Array.isArray(value)) value.forEach(finite);
  else if (value && typeof value === "object") Object.values(value).forEach(finite);
}

describe("Pass B — SICK_CREW", () => {
  it("fans a non-benchmark crew across all multi-day/multi-pairing duties deterministically", () => {
    const first = analyzeSickCrew(graph, { crewId: "C-5837" });
    const second = analyzeSickCrew(graph, { crewId: "C-5837" });
    expect(first).toEqual(second);
    expect(first.success).toBe(true);
    expect(first.data.pairings.length).toBeGreaterThan(1);
    expect(first.data.pairings.every((pairing) => pairing.flights.length > 0 && pairing.dates.length > 0)).toBe(true);
    expect(first.data.pairings.map((pairing) => pairing.pairingId)).toEqual([...first.data.pairings.map((pairing) => pairing.pairingId)].sort());
  });

  it("retains deadhead, pre-legality, evaluated-illegal, and cancellation-only states", () => {
    const regular = analyzeSickCrew(graph, { crewId: "C-1042", pairingId: "P-2291" });
    const pairing = regular.data.pairings[0];
    expect(pairing.ranked.some((option) => option.kind === "cover" && option.delayHours > 0 && option.cost.components.some((component) => component.type === "deadhead"))).toBe(true);
    expect(pairing.rejected.some((candidate) => candidate.legalityEvaluated && candidate.violations.length > 0)).toBe(true);
    const noReachableCandidates = buildOperationalGraph({
      ...dataset,
      crews: dataset.crews.map((crew) => crew.rank === "Captain" && crew.crewId !== "C-1042" ? { ...crew, base: "ZZZ" } : crew),
    });
    const prefiltered = analyzeSickCrew(noReachableCandidates, { crewId: "C-1042", pairingId: "P-2291" });
    expect(prefiltered.data.pairings[0]?.rejected.some((candidate) => !candidate.legalityEvaluated && candidate.violations.length === 0 && candidate.reasons.length > 0)).toBe(true);

    const sameRank = graph.crews.filter((crew) => crew.rank === "Captain").map((crew) => crew.crewId);
    const noCover = analyzeSickCrew(graph, { crewId: "C-1042", pairingId: "P-2291", extraExcludeCrewIds: sameRank });
    const fallback = noCover.data.pairings[0];
    expect(fallback.recoveryAvailable).toBe(false);
    expect(fallback.noRecoveryReason).toContain("No legal replacement");
    expect(fallback.selected?.kind).toBe("cancel");
    expect(fallback.cancelCost?.total).toBe(fallback.cancelCost?.components.reduce((total, component) => total + component.amount, 0));
  });
});

describe("Pass B — DELAY", () => {
  it("moves from absorbed through FDP recovery and remains finite across a UTC-midnight-sized delay", () => {
    const small = analyzeDisruption(graph, { type: "DELAY", flightId: "DX401-2026-09-16", delayMinutes: 30 });
    const boundary = analyzeDisruption(graph, { type: "DELAY", flightId: "DX401-2026-09-16", delayMinutes: 45 });
    const breach = analyzeDisruption(graph, { type: "DELAY", flightId: "DX401-2026-09-16", delayMinutes: 90 });
    const overnight = analyzeDisruption(graph, { type: "DELAY", flightId: "DX401-2026-09-16", delayMinutes: 24 * 60 });
    if (small.data.kind !== "delay" || boundary.data.kind !== "delay" || breach.data.kind !== "delay" || overnight.data.kind !== "delay") throw new Error("expected delay data");
    expect(small.data.recoveryRequired).toBe(false);
    expect(boundary.data.recoveryRequired).toBe(false);
    expect(breach.data.recoveryRequired).toBe(true);
    expect(breach.data.shiftedFlights.length).toBeGreaterThan(1);
    expect(breach.evidence.some((item) => item.ruleId === "RULE-FDP-01" && item.passed === false && item.actual !== undefined && item.limit !== undefined)).toBe(true);
    expect(overnight.data.timingChanges.some((change) => calendarDate(change.before.depUtc) !== calendarDate(change.after.depUtc))).toBe(true);
    finite(overnight);
  });

  it("uses overlay timing for a downstream rest breach and assesses every rostered crew", () => {
    const anchor = graph.pairingById.get("P-2204")?.days[0]?.flights[0];
    expect(anchor).toBeDefined();
    if (!anchor) return;
    const result = analyzeDisruption(graph, { type: "DELAY", flightId: anchor, delayMinutes: 2926 });
    if (!result.success || result.data.kind !== "delay") throw new Error("expected delay analysis");
    expect(result.data.crew).toHaveLength(graph.pairingById.get("P-2204")?.crew.length ?? 0);
    expect(result.data.crew.some((crew) => crew.violations.some((violation) => violation.ruleId === "RULE-REST-04"))).toBe(true);
  });
});

describe("Pass B — STATION_CLOSURE", () => {
  it("handles empty, spanning-midnight, and many-flight closure windows without duplicate summaries", () => {
    const none = analyzeDisruption(graph, { type: "STATION_CLOSURE", station: "BLR", startUtc: "2050-01-01T00:00:00Z", endUtc: "2050-01-02T00:00:00Z" });
    if (!none.success || none.data.kind !== "station") throw new Error("expected closure analysis");
    expect(none.data.affectedFlights).toEqual([]);
    expect(none.data.recoveryRequired).toBe(false);

    const early = graph.flights.find((flight) => flight.depStation === "BLR" && flight.depUtc.slice(11, 13) < "03");
    expect(early).toBeDefined();
    if (!early) return;
    const midnight = analyzeDisruption(graph, {
      type: "STATION_CLOSURE", station: "BLR", startUtc: addMinutes(early.depUtc, -180), endUtc: addMinutes(early.depUtc, 1),
    });
    const broad = analyzeDisruption(graph, {
      type: "STATION_CLOSURE", station: "BLR", startUtc: `${early.date}T00:00:00Z`, endUtc: `${early.date}T23:59:00Z`,
    });
    if (!midnight.success || midnight.data.kind !== "station" || !broad.success || broad.data.kind !== "station") throw new Error("expected closure analyses");
    expect(calendarDate(midnight.data.closureWindow.startUtc)).not.toBe(calendarDate(midnight.data.closureWindow.endUtc));
    expect(midnight.data.affectedFlights).toContain(early.flightId);
    expect(new Set(broad.data.affectedPairings.map((pairing) => pairing.pairingId)).size).toBe(broad.data.affectedPairings.length);
    expect(new Set(broad.data.affectedCrew.map((crew) => crew.crewId)).size).toBe(broad.data.affectedCrew.length);
    finite(broad.data.cancellationFallback);
  });
});

describe("Pass B — CERT_EXPIRY", () => {
  it("fans out an arbitrary expired certification across multiple future duties and respects the type filter", () => {
    const certifications = dataset.certifications.map((cert) =>
      cert.crewId === "C-5837" && cert.certType === "recurrent_training" ? { ...cert, validTo: "2026-09-13" } : cert,
    );
    const altered = buildOperationalGraph({ ...dataset, certifications });
    const expired = analyzeDisruption(altered, { type: "CERT_EXPIRY", crewId: "C-5837", dutyDate: "2026-09-14", certificationType: "recurrent_training" });
    const otherType = analyzeDisruption(altered, { type: "CERT_EXPIRY", crewId: "C-5837", dutyDate: "2026-09-14", certificationType: "licence" });
    if (!expired.success || expired.data.kind !== "cert" || !otherType.success || otherType.data.kind !== "cert") throw new Error("expected certification analysis");
    expect(expired.data.affected.length).toBeGreaterThan(1);
    expect(expired.data.affected.every((assignment) => assignment.expired.includes("recurrent_training") && assignment.recoveryRequired)).toBe(true);
    expect(otherType.data.affected).toEqual([]);
    expect(expired.evidence.some((item) => item.ruleId === "RULE-CERT-06" && item.details?.validTo === "2026-09-13")).toBe(true);
  });
});

describe("Pass B — MULTI_SICK", () => {
  const events = [
    { crewId: "C-3940", pairingId: "P-2205", reportedUtc: "2026-09-18T00:30:00Z" },
    { crewId: "C-1938", pairingId: "P-2212", reportedUtc: "2026-09-18T00:30:00Z" },
  ];

  it("keeps shared candidates and unavailable crew out of a complete globally-priced plan", () => {
    const result = analyzeDisruption(graph, { type: "MULTI_SICK", events });
    if (!result.success || result.data.kind !== "multi") throw new Error("expected multi analysis");
    const unavailable = new Set(events.map((event) => event.crewId));
    const selected = result.data.jointPlan.assignments.filter((assignment) => assignment.crewId !== undefined);
    expect(result.data.complete).toBe(true);
    expect(new Set(selected.map((assignment) => assignment.crewId)).size).toBe(selected.length);
    expect(selected.some((assignment) => unavailable.has(assignment.crewId ?? ""))).toBe(false);
    expect(result.data.jointPlan.totalCost).toBe(result.data.jointPlan.assignments.reduce((total, assignment) => total + assignment.costTotal, 0));
    expect(result.data.disruptions.every((disruption) => disruption.selected.kind === "cancel" || disruption.recovery.ranked.some((option) => option.crewId === disruption.selected.crewId && option.legality?.legal))).toBe(true);
  });

  it("rejects malformed mixed input without partial processing", () => {
    const bad = analyzeDisruption(graph, { type: "MULTI_SICK", events: [{ ...events[0], crewId: "C-0000" }, events[1]] });
    expect(bad.success).toBe(false);
    expect(bad.error).toContain("unknown crew C-0000");
    expect(bad.error).not.toContain("\n    at ");
  });
});
