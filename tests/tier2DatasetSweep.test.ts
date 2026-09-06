/** Verification pass D — bounded, deterministic breadth sweep over real data. */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { loadOperationalGraph, type LoadedDataset } from "../src/data/loader.js";
import type { OperationalGraph } from "../src/data/graph.js";
import { addDays, isWithin } from "../src/data/time.js";
import { analyzeSickCrew } from "../src/orchestration/sickCrew.js";
import { analyzeDisruption } from "../src/orchestration/disruptions.js";
import { searchOperationalData } from "../src/orchestration/search.js";
import type { RecoveryOption } from "../src/recovery/types.js";
import type { PartialDayPlan } from "../src/recovery/recovery.js";
import { checkCertificationsOnDate } from "../src/rules/certification.js";

const DATA_DIR = resolve(process.cwd(), "data");
const DELAYS = [30, 60, 120, 240] as const;
const stats = {
  sick: { crew: 0, analyses: 0, impact: 0, legalRecovery: 0, fallback: 0, noImpact: 0, failures: 0 },
  delay: { flights: 0, analyses: 0, legal: 0, fdpBreach: 0, restBreach: 0, recovery: 0, fallback: 0, failures: 0 },
  closure: { stations: 0, windows: 0, analyses: 0, failures: 0 },
  cert: { records: 0, analyses: 0, failures: 0 },
  multi: { pairs: 0, triples: 0, analyses: 0, failures: 0 },
  performance: {} as Record<string, { median: number; p95: number; max: number }>,
};
let graph: OperationalGraph;
let dataset: LoadedDataset;
let baseSnapshot = "";
let sweepStarted = 0;

beforeAll(() => {
  const loaded = loadOperationalGraph(DATA_DIR);
  graph = loaded.graph;
  dataset = loaded.dataset;
  baseSnapshot = JSON.stringify([graph.crews, graph.flights, graph.pairings, graph.certifications, graph.dutyClocks]);
  sweepStarted = performance.now();
});

afterAll(() => {
  expect(JSON.stringify([graph.crews, graph.flights, graph.pairings, graph.certifications, graph.dutyClocks])).toBe(baseSnapshot);
  const total = stats.sick.analyses + stats.delay.analyses + stats.closure.analyses + stats.cert.analyses + stats.multi.analyses;
  console.info(`PASS_D_SWEEP ${JSON.stringify({ ...stats, totalAnalyses: total, elapsedMs: Math.round(performance.now() - sweepStarted) })}`);
});

function finite(value: unknown, context: string): void {
  if (typeof value === "number") {
    expect(Number.isFinite(value), context).toBe(true);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => finite(item, `${context}[${index}]`));
  } else if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => finite(item, `${context}.${key}`));
  }
}

function assertOption(option: RecoveryOption, context: string, unavailable: ReadonlySet<string> = new Set()): void {
  expect(option.cost.total, `${context} total`).toBe(option.cost.components.reduce((total, component) => total + component.amount, 0));
  expect(option.cost.total, `${context} non-negative`).toBeGreaterThanOrEqual(0);
  if (option.kind === "cover") {
    expect(option.crewId, `${context} crew`).toBeTruthy();
    expect(unavailable.has(option.crewId ?? ""), `${context} unavailable crew`).toBe(false);
    expect(option.legality?.legal, `${context} legal`).toBe(true);
  } else {
    expect(option.crewId, `${context} cancellation crew`).toBeUndefined();
    expect(option.legality, `${context} cancellation legality`).toBeUndefined();
  }
}

function assertPartial(plan: PartialDayPlan, context: string): void {
  const cheapest = plan.suffixCovers.map((cover) => {
    for (const option of cover.options) {
      expect(option.legality.legal, `${context}/${cover.role}/${option.crewId} legal`).toBe(true);
      expect(Number.isFinite(option.costTotal), `${context}/${cover.role}/${option.crewId} finite cost`).toBe(true);
    }
    return cover.options[0]?.costTotal ?? 0;
  });
  expect(plan.suffixTotalCost, `${context} component total`).toBe(cheapest.reduce((total, cost) => total + cost, 0));
}

function requireSuccess<T extends {
  success: boolean;
  error?: string;
  type?: unknown;
  summary?: unknown;
  data?: unknown;
  evidence?: unknown;
  warnings?: unknown;
}>(result: T, context: string): T {
  if (!result.success) throw new Error(`${context}: ${result.error ?? "unsuccessful result"}`);
  expect(typeof result.type, `${context} result type`).toBe("string");
  expect(typeof result.summary, `${context} summary`).toBe("string");
  expect((result.summary as string).length, `${context} non-empty summary`).toBeGreaterThan(0);
  expect(result.data, `${context} data`).not.toBeUndefined();
  expect(Array.isArray(result.evidence), `${context} evidence`).toBe(true);
  expect(Array.isArray(result.warnings), `${context} warnings`).toBe(true);
  return result;
}

function uniqueCrewEvents(): Array<{ crewId: string; pairingId: string; reportedUtc: string }> {
  const byCrew = new Map<string, { crewId: string; pairingId: string; reportedUtc: string }>();
  for (const pairing of [...graph.pairings].sort((a, b) => a.pairingId.localeCompare(b.pairingId))) {
    for (const assignment of pairing.crew) {
      if (!byCrew.has(assignment.crewId)) {
        byCrew.set(assignment.crewId, { crewId: assignment.crewId, pairingId: pairing.pairingId, reportedUtc: pairing.days[0]?.reportUtc ?? "" });
      }
    }
  }
  return [...byCrew.values()].sort((a, b) => a.crewId.localeCompare(b.crewId));
}

function sample<T>(items: readonly T[], count: number): T[] {
  if (items.length <= count) return [...items];
  return Array.from({ length: count }, (_, index) => items[Math.floor(index * items.length / count)]);
}

function measure(label: string, fn: () => unknown): void {
  fn(); // warm-up
  const values = Array.from({ length: 7 }, () => {
    const start = performance.now();
    fn();
    return performance.now() - start;
  }).sort((a, b) => a - b);
  stats.performance[label] = {
    median: Number(values[Math.floor(values.length / 2)]?.toFixed(3)),
    p95: Number(values[Math.min(values.length - 1, Math.ceil(values.length * 0.95) - 1)]?.toFixed(3)),
    max: Number(values[values.length - 1]?.toFixed(3)),
  };
}

describe("Pass D — dataset-wide SICK_CREW and DELAY", () => {
  it("analyzes every crew, including explicit no-pairing outcomes, without selecting illegal cover", () => {
    const crewIds = graph.crews.map((crew) => crew.crewId).sort();
    stats.sick.crew = crewIds.length;
    for (const crewId of crewIds) {
      const raw = analyzeSickCrew(graph, { crewId });
      stats.sick.analyses += 1;
      if (!graph.pairingsByCrew.has(crewId)) {
        expect(raw.success, `SICK_CREW ${crewId} no-pairing state`).toBe(false);
        expect(raw.error, `SICK_CREW ${crewId} no-pairing reason`).toBe("no assigned pairings");
        expect(raw.error, `SICK_CREW ${crewId} error hygiene`).not.toMatch(/Error:|\bat\s+\S+\(/);
        stats.sick.noImpact += 1;
        continue;
      }
      const result = requireSuccess(raw, `SICK_CREW ${crewId}`);
      finite(result, `SICK_CREW ${crewId}`);
      expect(result.data.pairings.length, `SICK_CREW ${crewId} pairings`).toBeGreaterThan(0);
      for (const pairing of result.data.pairings) {
        stats.sick.impact += 1;
        expect(graph.pairingsByCrew.get(crewId)?.some((known) => known.pairingId === pairing.pairingId), `SICK_CREW ${crewId}/${pairing.pairingId} relation`).toBe(true);
        expect(pairing.flights.every((flightId) => graph.pairingById.get(pairing.pairingId)?.days.some((day) => day.flights.includes(flightId))), `SICK_CREW ${crewId}/${pairing.pairingId} flights`).toBe(true);
        for (const option of pairing.ranked) assertOption(option, `SICK_CREW ${crewId}/${pairing.pairingId}`, new Set([crewId]));
        for (const rejected of pairing.rejected) {
          if (rejected.legalityEvaluated) expect(rejected.violations.length, `SICK_CREW ${crewId}/${rejected.crewId} evaluated`).toBeGreaterThan(0);
          else expect(rejected.reasons.length, `SICK_CREW ${crewId}/${rejected.crewId} prefiltered`).toBeGreaterThan(0);
        }
        if (pairing.recoveryAvailable) stats.sick.legalRecovery += 1;
        else {
          stats.sick.fallback += 1;
          expect(pairing.selected?.kind, `SICK_CREW ${crewId}/${pairing.pairingId} fallback`).toBe("cancel");
        }
      }
    }
    for (const crewId of sample(crewIds, 8)) {
      expect(analyzeSickCrew(graph, { crewId }), `SICK_CREW deterministic ${crewId}`).toEqual(analyzeSickCrew(graph, { crewId }));
    }
    const exercised = new Set(crewIds);
    expect(new Set(graph.crews.filter((crew) => exercised.has(crew.crewId)).map((crew) => crew.rank))).toEqual(new Set(graph.crews.map((crew) => crew.rank)));
    expect(new Set(graph.crews.filter((crew) => exercised.has(crew.crewId)).flatMap((crew) => crew.ratings))).toEqual(new Set(graph.crews.flatMap((crew) => crew.ratings)));
  });

  it("simulates every flight at four durations with valid relationships and finite recovery output", () => {
    stats.delay.flights = graph.flights.length;
    for (const flight of graph.flights) {
      for (const delayMinutes of DELAYS) {
        const result = requireSuccess(analyzeDisruption(graph, { type: "DELAY", flightId: flight.flightId, delayMinutes }), `DELAY ${flight.flightId}/${delayMinutes}`);
        if (result.data.kind !== "delay") throw new Error(`DELAY ${flight.flightId}/${delayMinutes}: wrong data kind`);
        stats.delay.analyses += 1;
        finite(result, `DELAY ${flight.flightId}/${delayMinutes}`);
        expect(result.data.flightId, `DELAY identity ${flight.flightId}`).toBe(flight.flightId);
        expect(result.data.affectedPairings.every((pairingId) => graph.pairingsByFlight.get(flight.flightId)?.some((pairing) => pairing.pairingId === pairingId)), `DELAY pairing ${flight.flightId}`).toBe(true);
        expect(result.data.affectedCrew.length, `DELAY crew ${flight.flightId}`).toBe(graph.pairingById.get(result.data.pairingId)?.crew.length);
        if (result.data.recoveryRequired) stats.delay.recovery += 1;
        else stats.delay.legal += 1;
        if (result.data.crewAssessments.some((crew) => !crew.fdpLegal)) stats.delay.fdpBreach += 1;
        if (result.data.crew.some((crew) => crew.violations.some((violation) => violation.ruleId === "RULE-REST-04"))) stats.delay.restBreach += 1;
        if (result.data.recommended?.strategy === "cancel") stats.delay.fallback += 1;
        if (result.data.partial) assertPartial(result.data.partial, `DELAY ${flight.flightId}/${delayMinutes} partial`);
        for (const recovery of result.data.fullRecrew ?? []) for (const option of recovery.solution.ranked) assertOption(option, `DELAY ${flight.flightId}/${delayMinutes}/${recovery.role}`);
      }
    }
    for (const flight of sample(graph.flights, 6)) {
      const event = { type: "DELAY" as const, flightId: flight.flightId, delayMinutes: 120 };
      expect(analyzeDisruption(graph, event), `DELAY deterministic ${flight.flightId}`).toEqual(analyzeDisruption(graph, event));
    }
  });
});

describe("Pass D — dataset-wide STATION_CLOSURE and CERT_EXPIRY", () => {
  it("checks every station against daytime and midnight windows using the independent match predicate", () => {
    const stations = [...new Set(graph.flights.flatMap((flight) => [flight.depStation, flight.arrStation]))].sort();
    const date = [...new Set(graph.flights.map((flight) => flight.date))].sort()[0] ?? "";
    const windows = [
      [`${date}T05:00:00Z`, `${date}T07:00:00Z`],
      [`${date}T05:00:00Z`, `${date}T09:00:00Z`],
      [`${date}T23:00:00Z`, `${addDays(date, 1)}T02:00:00Z`],
    ] as const;
    stats.closure.stations = stations.length;
    stats.closure.windows = windows.length;
    for (const station of stations) {
      for (const [startUtc, endUtc] of windows) {
        const result = requireSuccess(analyzeDisruption(graph, { type: "STATION_CLOSURE", station, startUtc, endUtc }), `CLOSURE ${station}/${startUtc}`);
        if (result.data.kind !== "station") throw new Error(`CLOSURE ${station}/${startUtc}: wrong data kind`);
        const closure = result.data;
        stats.closure.analyses += 1;
        finite(result, `CLOSURE ${station}/${startUtc}`);
        const expected = graph.flights
          .filter((flight) => (flight.depStation === station && isWithin(flight.depUtc, startUtc, endUtc)) || (flight.arrStation === station && isWithin(flight.arrUtc, startUtc, endUtc)))
          .map((flight) => flight.flightId)
          .sort((a, b) => (graph.flightById.get(a)?.depUtc ?? "").localeCompare(graph.flightById.get(b)?.depUtc ?? "") || a.localeCompare(b));
        expect(closure.affectedFlights, `CLOSURE match ${station}/${startUtc}`).toEqual(expected);
        expect(new Set(closure.affectedPairings.map((pairing) => pairing.pairingId)).size, `CLOSURE pairing dedupe ${station}`).toBe(closure.affectedPairings.length);
        expect(new Set(closure.affectedCrew.map((crew) => crew.crewId)).size, `CLOSURE crew dedupe ${station}`).toBe(closure.affectedCrew.length);
        for (const pairing of closure.affectedPairings) {
          expect(pairing.days.flatMap((day) => day.affectedFlightIds).every((flightId) => closure.affectedFlights.includes(flightId)), `CLOSURE pairing flights ${station}/${pairing.pairingId}`).toBe(true);
        }
        for (const requirement of closure.recoveryRequirements) {
          if (requirement.partial) assertPartial(requirement.partial, `CLOSURE ${station}/${requirement.pairingId} partial`);
          for (const recovery of requirement.fullRecrew) for (const option of recovery.solution.ranked) assertOption(option, `CLOSURE ${station}/${requirement.pairingId}/${recovery.role}`);
        }
        expect(result.warnings.some((warning) => warning.includes("rerouting")), `CLOSURE limitations ${station}`).toBe(true);
      }
    }
    for (const station of sample(stations, 3)) {
      const [startUtc, endUtc] = windows[1];
      const event = { type: "STATION_CLOSURE" as const, station, startUtc, endUtc };
      expect(analyzeDisruption(graph, event), `CLOSURE deterministic ${station}`).toEqual(analyzeDisruption(graph, event));
    }
  });

  it("checks every supplied certification at validTo -1, validTo, and validTo +1", () => {
    stats.cert.records = graph.certifications.length;
    for (const cert of graph.certifications) {
      const before = checkCertificationsOnDate([cert], addDays(cert.validTo, -1));
      const exact = checkCertificationsOnDate([cert], cert.validTo);
      const after = checkCertificationsOnDate([cert], addDays(cert.validTo, 1));
      expect(before.passed, `CERT before validTo ${cert.crewId}/${cert.certType}`).toBe(true);
      expect(exact.passed, `CERT exact validTo ${cert.crewId}/${cert.certType}`).toBe(true);
      expect(after.passed, `CERT after validTo ${cert.crewId}/${cert.certType}`).toBe(false);
      expect(after.evidence.expired, `CERT expired record ${cert.crewId}/${cert.certType}`).toContain(cert.certType);
      for (const dutyDate of [addDays(cert.validTo, -1), cert.validTo, addDays(cert.validTo, 1)]) {
        const result = requireSuccess(analyzeDisruption(graph, { type: "CERT_EXPIRY", crewId: cert.crewId, dutyDate, certificationType: cert.certType }), `CERT ${cert.crewId}/${cert.certType}/${dutyDate}`);
        if (result.data.kind !== "cert") throw new Error(`CERT ${cert.crewId}/${cert.certType}/${dutyDate}: wrong data kind`);
        stats.cert.analyses += 1;
        finite(result, `CERT ${cert.crewId}/${cert.certType}/${dutyDate}`);
        for (const assignment of result.data.affected) {
          expect(graph.pairingsByCrew.get(cert.crewId)?.some((pairing) => pairing.pairingId === assignment.pairingId), `CERT relation ${cert.crewId}/${assignment.pairingId}`).toBe(true);
          expect(assignment.expired).toContain(cert.certType);
          for (const option of assignment.recovery.ranked) assertOption(option, `CERT ${cert.crewId}/${assignment.pairingId}`);
        }
      }
    }
    for (const cert of sample(graph.certifications, 8)) {
      const event = { type: "CERT_EXPIRY" as const, crewId: cert.crewId, dutyDate: addDays(cert.validTo, 1), certificationType: cert.certType };
      expect(analyzeDisruption(graph, event), `CERT deterministic ${cert.crewId}/${cert.certType}`).toEqual(analyzeDisruption(graph, event));
    }
  });

  it("keeps representative event calls isolated after the full sweep", () => {
    const events = uniqueCrewEvents();
    const sick = { crewId: events[0]?.crewId ?? "" };
    const first = requireSuccess(analyzeSickCrew(graph, sick), "isolation first SICK_CREW");
    requireSuccess(analyzeDisruption(graph, { type: "DELAY", flightId: graph.flights[0]?.flightId ?? "", delayMinutes: 120 }), "isolation DELAY");
    requireSuccess(analyzeDisruption(graph, { type: "STATION_CLOSURE", station: graph.flights[0]?.depStation ?? "", startUtc: "2026-09-14T05:00:00Z", endUtc: "2026-09-14T09:00:00Z" }), "isolation STATION_CLOSURE");
    const cert = graph.certifications[0];
    requireSuccess(analyzeDisruption(graph, { type: "CERT_EXPIRY", crewId: cert?.crewId ?? "", dutyDate: cert?.validTo ?? "", certificationType: cert?.certType }), "isolation CERT_EXPIRY");
    requireSuccess(analyzeDisruption(graph, { type: "MULTI_SICK", events: [events[0], events[37]] }), "isolation MULTI_SICK");
    expect(analyzeSickCrew(graph, sick), "isolation final SICK_CREW").toEqual(first);
  });
});

describe("Pass D — deterministic MULTI_SICK breadth and diagnostics", () => {
  it("checks a fixed broad sample of joint pairs and triples", () => {
    const events = uniqueCrewEvents();
    const pairStarts = sample(events.slice(0, Math.floor(events.length / 2)), 30);
    const tripleStarts = sample(events.slice(0, Math.floor(events.length / 3)), 8);
    for (const [index, first] of pairStarts.entries()) {
      const selected = [first, events[(index + 37) % events.length]];
      if (selected[0].crewId === selected[1].crewId) throw new Error(`MULTI pair sample duplicate ${selected[0].crewId}`);
      const result = requireSuccess(analyzeDisruption(graph, { type: "MULTI_SICK", events: selected }), `MULTI pair ${selected.map((event) => event.crewId).join(",")}`);
      if (result.data.kind !== "multi") throw new Error("MULTI pair wrong data kind");
      stats.multi.pairs += 1;
      stats.multi.analyses += 1;
      finite(result, `MULTI pair ${index}`);
      const unavailable = new Set(selected.map((event) => event.crewId));
      expect(result.data.disruptions).toHaveLength(selected.length);
      expect(result.data.jointPlan.assignments).toHaveLength(selected.length);
      expect(result.data.complete).toBe(true);
      expect(result.data.jointPlan.totalCost).toBe(result.data.jointPlan.assignments.reduce((total, assignment) => total + assignment.costTotal, 0));
      const covers = result.data.jointPlan.assignments.filter((assignment) => assignment.crewId !== undefined);
      expect(new Set(covers.map((assignment) => assignment.crewId)).size).toBe(covers.length);
      for (const disruption of result.data.disruptions) {
        const selectedOption = disruption.recovery.ranked.find((option) => option.kind === disruption.selected.kind && option.crewId === disruption.selected.crewId);
        expect(selectedOption, `MULTI pair ${index}/${disruption.pairingId} outcome`).toBeDefined();
        if (selectedOption) assertOption(selectedOption, `MULTI pair ${index}/${disruption.pairingId}`, unavailable);
      }
    }
    for (const [index, first] of tripleStarts.entries()) {
      const selected = [first, events[(index + 31) % events.length], events[(index + 63) % events.length]];
      if (new Set(selected.map((event) => event.crewId)).size !== selected.length) throw new Error(`MULTI triple sample duplicate at ${index}`);
      const result = requireSuccess(analyzeDisruption(graph, { type: "MULTI_SICK", events: selected }), `MULTI triple ${index}`);
      if (result.data.kind !== "multi") throw new Error("MULTI triple wrong data kind");
      stats.multi.triples += 1;
      stats.multi.analyses += 1;
      expect(result.data.complete).toBe(true);
      expect(result.data.jointPlan.assignments).toHaveLength(3);
      expect(result.data.jointPlan.totalCost).toBe(result.data.jointPlan.assignments.reduce((total, assignment) => total + assignment.costTotal, 0));
      finite(result, `MULTI triple ${index}`);
      const unavailable = new Set(selected.map((event) => event.crewId));
      const covers = result.data.jointPlan.assignments.filter((assignment) => assignment.crewId !== undefined);
      expect(new Set(covers.map((assignment) => assignment.crewId)).size, `MULTI triple ${index} unique cover`).toBe(covers.length);
      for (const disruption of result.data.disruptions) {
        const selectedOption = disruption.recovery.ranked.find((option) => option.kind === disruption.selected.kind && option.crewId === disruption.selected.crewId);
        expect(selectedOption, `MULTI triple ${index}/${disruption.pairingId} outcome`).toBeDefined();
        if (selectedOption) assertOption(selectedOption, `MULTI triple ${index}/${disruption.pairingId}`, unavailable);
      }
    }
    const representative = [events[0], events[37]];
    expect(analyzeDisruption(graph, { type: "MULTI_SICK", events: representative })).toEqual(analyzeDisruption(graph, { type: "MULTI_SICK", events: representative }));
  });

  it("measures representative execution without enforcing environment-sensitive thresholds", () => {
    const events = uniqueCrewEvents();
    measure("search", () => searchOperationalData(graph, { entity: "crew", base: graph.crews[0]?.base }));
    measure("sick", () => analyzeSickCrew(graph, { crewId: events[0]?.crewId ?? "", pairingId: events[0]?.pairingId }));
    measure("delay", () => analyzeDisruption(graph, { type: "DELAY", flightId: graph.flights[0]?.flightId ?? "", delayMinutes: 120 }));
    measure("closure", () => analyzeDisruption(graph, { type: "STATION_CLOSURE", station: graph.flights[0]?.depStation ?? "", startUtc: "2026-09-14T05:00:00Z", endUtc: "2026-09-14T09:00:00Z" }));
    measure("cert", () => analyzeDisruption(graph, { type: "CERT_EXPIRY", crewId: dataset.certifications[0]?.crewId ?? "", dutyDate: dataset.certifications[0]?.validTo ?? "", certificationType: dataset.certifications[0]?.certType }));
    measure("multi2", () => analyzeDisruption(graph, { type: "MULTI_SICK", events: [events[0], events[37]] }));
    measure("multi3", () => analyzeDisruption(graph, { type: "MULTI_SICK", events: [events[0], events[31], events[63]] }));
    expect(Object.values(stats.performance).every((entry) => Number.isFinite(entry.median) && Number.isFinite(entry.p95) && Number.isFinite(entry.max))).toBe(true);
  });
});
