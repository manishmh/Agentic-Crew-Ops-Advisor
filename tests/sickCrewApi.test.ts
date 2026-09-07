import { beforeAll, describe, expect, test } from "vitest";
import { resolve } from "node:path";
import { loadOperationalGraph } from "../src/data/loader.js";
import { createCrewOpsQueryService } from "../src/api/crewopsQuery.js";
import { analyzeDisruption } from "../src/orchestration/disruptions.js";

let query: ReturnType<typeof createCrewOpsQueryService>["query"];

beforeAll(() => {
  query = createCrewOpsQueryService(loadOperationalGraph(resolve(process.cwd(), "data")).graph).query;
});

describe("POST /api/crewops/query — SICK_CREW", () => {
  test("interprets a sick-crew question and returns deterministic recovery evidence", () => {
    const body = query({ question: "What happens if C-1042 reports sick?" });
    if (!body.success) throw new Error(body.error.message);
    expect(body).toMatchObject({
      success: true,
      intent: { type: "SICK_CREW" },
      entities: { crewId: "C-1042", pairingIds: ["P-2291"] },
    });
    expect(body.consequences.affectedPairings[0]).toMatchObject({
      pairingId: "P-2291",
      flightIds: ["DX412-2026-09-15", "DX413-2026-09-15", "DX588-2026-09-15", "DX589-2026-09-16", "DX590-2026-09-16", "DX591-2026-09-16"],
      recoveryAvailable: true,
    });
    expect(body.recovery.recommended).toMatchObject({ crewId: "C-3310", legal: true, cost: { total: 18500 } });
    expect(body.recovery.alternatives.some((option: { crewId?: string }) => option.crewId === "C-2210")).toBe(true);
    expect(body.recovery.rejected).toContainEqual(expect.objectContaining({
      crewId: "C-2087",
      legalityEvaluated: true,
      violations: expect.arrayContaining([expect.objectContaining({ ruleId: "RULE-DUTY-02" })]),
    }));
    expect(body.evidence.length).toBeGreaterThan(0);
    expect(Array.isArray(body.warnings)).toBe(true);
  });

  test("returns structured errors for unsupported and malformed requests", () => {
    expect(query({ question: "Close HYD" })).toMatchObject({ success: false, error: { code: "UNSUPPORTED_INTENT" } });
    expect(query({ question: "" })).toMatchObject({ success: false, error: { code: "INVALID_REQUEST" } });
  });
});

describe("POST /api/crewops/query — DELAY", () => {
  test("interprets a natural-language delay and carries deterministic recovery structures", () => {
    const body = query({ question: "Delay DX401 by 90 minutes" });
    if (!body.success) throw new Error(body.error.message);
    expect(body.intent).toMatchObject({ type: "DELAY" });
    expect(body.entities).toMatchObject({ flightNo: "DX401", delayMinutes: 90, pairingId: "P-2201" });
    expect(body.consequences.recoveryRequired).toBe(true);
    expect(body.consequences.affectedPairings[0]).toMatchObject({ pairingId: "P-2201" });
    expect(body.recovery.recommendedPlan).toMatchObject({ strategy: "partial" });
    expect(body.recovery.recommended).toMatchObject({ kind: "cover", legal: true });
    expect(body.recovery.alternatives.length).toBeGreaterThan(0);
    expect(body.recovery.rejected.some((candidate) => candidate.violations.length > 0)).toBe(true);
    expect(body.evidence.some((item) => item.ruleId === "RULE-FDP-01" && item.passed === false)).toBe(true);
    expect(Array.isArray(body.recovery.cancellationFallbacks)).toBe(true);
  });
});

describe("POST /api/crewops/query — STATION_CLOSURE", () => {
  test("parses the suggested closure question and adapts the deterministic analysis", () => {
    const body = query({ question: "Close HYD from 05:00–09:00 UTC" });
    if (!body.success) throw new Error(body.error.message);
    expect(body.intent).toMatchObject({ type: "STATION_CLOSURE" });
    expect(body.entities).toMatchObject({ station: "HYD", operationalDate: "2026-09-14", closureStartUtc: "2026-09-14T05:00:00Z", closureEndUtc: "2026-09-14T09:00:00Z" });
    expect(body.consequences.affectedFlights).toEqual(expect.arrayContaining([
      expect.objectContaining({ flightId: "DX461-2026-09-14", reasons: ["ARRIVAL_IN_CLOSURE"] }),
      expect.objectContaining({ flightId: "DX462-2026-09-14", reasons: ["DEPARTURE_IN_CLOSURE"] }),
    ]));
    expect(body.consequences).toMatchObject({ affectedPairings: expect.any(Array), affectedCrew: expect.any(Array), recoveryRequired: expect.any(Boolean) });
    expect(body.evidence.length).toBeGreaterThan(0);
    expect(body.recovery.cancellationFallbacks).toEqual(expect.any(Array));
  });

  test("recognizes alternate closure wording and retains the exclusive end boundary", () => {
    const body = query({ question: "What happens if HYD closes from 05:00 to 09:00 UTC?" });
    if (!body.success) throw new Error(body.error.message);
    expect(body.intent.type).toBe("STATION_CLOSURE");
    expect((body.consequences.affectedFlights as Array<{ flightId: string }>).map((flight) => flight.flightId)).not.toContain("DX453-2026-09-14");
    const dated = query({ question: "Station HYD closed 05:00-09:00 UTC on 2026-09-19" });
    if (!dated.success) throw new Error(dated.error.message);
    expect(dated.entities).toMatchObject({ operationalDate: "2026-09-19", closureStartUtc: "2026-09-19T05:00:00Z" });
  });

  test("returns structured failures for unknown stations, invalid intervals, and malformed times", () => {
    expect(query({ question: "Close ZZZ from 05:00-09:00 UTC" })).toMatchObject({ success: false, error: { code: "ANALYSIS_FAILED", message: "unknown station ZZZ" } });
    expect(query({ question: "HYD closed between 09:00 and 05:00 UTC" })).toMatchObject({ success: false, error: { code: "ANALYSIS_FAILED" } });
    expect(query({ question: "Close HYD from 25:00-09:00 UTC" })).toMatchObject({ success: false, error: { code: "INVALID_REQUEST" } });
  });

  test("is deterministic and does not change existing live intents", () => {
    const request = { question: "HYD closed between 05:00 and 09:00 UTC" };
    expect(query(request)).toEqual(query(request));
    expect(query({ question: "What happens if C-1042 reports sick?" })).toMatchObject({ success: true, intent: { type: "SICK_CREW" } });
    expect(query({ question: "Delay DX412 by 90 minutes" })).toMatchObject({ success: true, intent: { type: "DELAY" } });
  });

  test("passes deterministic recovery, cancellation cost, and evidence through unchanged when recovery is required", () => {
    const body = query({ question: "Close BLR from 08:00-14:00 UTC on 2026-09-17" });
    const expected = analyzeDisruption(loadOperationalGraph(resolve(process.cwd(), "data")).graph, { type: "STATION_CLOSURE", station: "BLR", startUtc: "2026-09-17T08:00:00Z", endUtc: "2026-09-17T14:00:00Z" });
    if (!body.success || !expected.success || expected.data.kind !== "station") throw new Error("expected station closure analysis");
    expect(body.consequences.recoveryRequired).toBe(expected.data.recoveryRequired);
    expect(body.recovery.cancellationFallbacks[0]?.cost).toEqual(expected.data.recoveryRequirements[0]?.cancellationFallback.cost);
    expect(body.evidence).toEqual(expected.evidence);
  });
});

describe("POST /api/crewops/query — CERT_EXPIRY", () => {
  test("parses targeted certification wording and adapts the C-5417 deterministic result", () => {
    const body = query({ question: "What happens if C-5417's recurrent training expires?" });
    if (!body.success) throw new Error(body.error.message);
    expect(body.intent).toMatchObject({ type: "CERT_EXPIRY" });
    expect(body.entities).toMatchObject({ crewId: "C-5417", role: "Cabin Crew", certificationType: "recurrent_training" });
    expect(body.entities.certifications).toEqual(expect.arrayContaining([expect.objectContaining({ validTo: "2026-09-17" })]));
    expect(body.consequences.inspectedDuties).toEqual(expect.arrayContaining([
      expect.objectContaining({ dutyDate: "2026-09-16", certificationLegal: true }),
      expect.objectContaining({ dutyDate: "2026-09-19", certificationLegal: false }),
    ]));
    expect(body.consequences.affectedDuties).toContainEqual(expect.objectContaining({ pairingId: "P-2213", dutyDate: "2026-09-19", flightIds: expect.any(Array), recoveryRequired: true }));
    expect(body.evidence).toContainEqual(expect.objectContaining({ ruleId: "RULE-CERT-06", passed: false, details: expect.objectContaining({ validTo: "2026-09-17", dutyDate: "2026-09-19" }) }));
    expect(body.recovery.recommended).toMatchObject({ kind: "cover", legal: true });
    expect(body.recovery.rejected.some((candidate) => candidate.legalityEvaluated === true && candidate.violations.length > 0)).toBe(true);
    expect(body.recovery.cancellationFallbacks[0]?.cost.total).toBeGreaterThan(0);
  });

  test("accepts underscore and generic targeted certification forms deterministically", () => {
    const underscored = query({ question: "C-5417 recurrent_training expiry" });
    const generic = query({ question: "Check C-5417 certification expiry" });
    if (!underscored.success || !generic.success) throw new Error("expected certification analysis");
    expect(underscored.entities).toMatchObject({ certificationType: "recurrent_training" });
    expect(generic.intent.type).toBe("CERT_EXPIRY");
    expect(query({ question: "C-5417 recurrent_training expiry" })).toEqual(underscored);
  });

  test("passes exact deterministic recovery costs and evidence through", () => {
    const body = query({ question: "C-5417 recurrent training expiry on 2026-09-16" });
    const expected = analyzeDisruption(loadOperationalGraph(resolve(process.cwd(), "data")).graph, { type: "CERT_EXPIRY", crewId: "C-5417", dutyDate: "2026-09-16", certificationType: "recurrent_training" });
    if (!body.success || !expected.success || expected.data.kind !== "cert") throw new Error("expected certification analysis");
    expect(body.recovery.cancellationFallbacks[0]?.cost).toEqual(expected.data.affected[0]?.cancellationFallback.cost);
    expect(body.evidence).toEqual(expected.evidence);
  });

  test("returns structured failures for unknown crew, certification, and malformed date", () => {
    expect(query({ question: "Check C-0000 certification expiry" })).toMatchObject({ success: false, error: { code: "ANALYSIS_FAILED", message: "unknown crew C-0000" } });
    expect(query({ question: "C-5417 certification type not-a-cert expiry" })).toMatchObject({ success: false, error: { code: "ANALYSIS_FAILED", message: expect.stringContaining("unknown certification") } });
    expect(query({ question: "C-5417 recurrent training expiry on 2026-99-99" })).toMatchObject({ success: false, error: { code: "ANALYSIS_FAILED" } });
  });

  test("returns a successful no-affected-duty analysis without pretending it is an error", () => {
    const body = query({ question: "Check C-5417 certification expiry on 2026-09-20" });
    if (!body.success) throw new Error(body.error.message);
    expect(body.consequences.affectedDuties).toEqual([]);
    expect(body.consequences.recoveryRequired).toBe(false);
  });

  test("keeps the three existing live intents green", () => {
    expect(query({ question: "What happens if C-1042 reports sick?" })).toMatchObject({ success: true, intent: { type: "SICK_CREW" } });
    expect(query({ question: "Delay DX412 by 90 minutes" })).toMatchObject({ success: true, intent: { type: "DELAY" } });
    expect(query({ question: "Close HYD from 05:00-09:00 UTC" })).toMatchObject({ success: true, intent: { type: "STATION_CLOSURE" } });
  });
});

describe("POST /api/crewops/query — MULTI_SICK", () => {
  const twoCrew = "C-3940 and C-1938 report sick on 2026-09-18";

  test("parses two-crew wording and adapts one deterministic joint plan", () => {
    const body = query({ question: twoCrew });
    if (!body.success) throw new Error(body.error.message);
    expect(body.intent).toMatchObject({ type: "MULTI_SICK" });
    expect(body.entities.unavailableCrew).toEqual(expect.arrayContaining([expect.objectContaining({ crewId: "C-3940" }), expect.objectContaining({ crewId: "C-1938" })]));
    expect(body.consequences).toMatchObject({ complete: true, affectedPairings: expect.arrayContaining([expect.objectContaining({ pairingId: "P-2205" }), expect.objectContaining({ pairingId: "P-2212" })]) });
    expect(body.consequences.disruptions as unknown[]).toHaveLength(2);
    expect((body.consequences.disruptions as Array<{ selected?: unknown }>).every((item) => item.selected !== undefined)).toBe(true);
    expect(body.evidence.length).toBeGreaterThan(0);
  });

  test("supports three simultaneous crew IDs", () => {
    const body = query({ question: "C-3940, C-1938 and C-1443 report sick on 2026-09-18" });
    if (!body.success) throw new Error(body.error.message);
    expect(body.entities.unavailableCrewCount).toBe(3);
    expect(body.consequences.disruptions as unknown[]).toHaveLength(3);
    expect(body.consequences.complete).toBe(true);
  });

  test("passes selected assignment costs, legal status, joint total, and evidence through unchanged", () => {
    const body = query({ question: twoCrew });
    const expected = analyzeDisruption(loadOperationalGraph(resolve(process.cwd(), "data")).graph, { type: "MULTI_SICK", events: [
      { crewId: "C-3940", pairingId: "P-2205", reportedUtc: "2026-09-18T01:30:00Z" },
      { crewId: "C-1938", pairingId: "P-2212", reportedUtc: "2026-09-18T02:00:00Z" },
    ] });
    if (!body.success || !expected.success || expected.data.kind !== "multi") throw new Error("expected multi-sick analysis");
    expect((body.consequences.disruptions as Array<{ selected: { costTotal: number } }>).map((item) => item.selected.costTotal)).toEqual(expected.data.jointPlan.assignments.map((item) => item.costTotal));
    expect(body.evidence).toEqual(expected.evidence);
  });

  test("returns clean validation failures for duplicate, singleton, and unknown crew input", () => {
    expect(query({ question: "C-3940 and C-3940 report sick" })).toMatchObject({ success: false, error: { code: "INVALID_REQUEST", message: expect.stringContaining("unique") } });
    expect(query({ question: "Two crew sick: C-3940" })).toMatchObject({ success: false, error: { code: "INVALID_REQUEST", message: expect.stringContaining("at least two") } });
    expect(query({ question: "C-3940 and C-0000 report sick" })).toMatchObject({ success: false, error: { code: "INVALID_REQUEST", message: "unknown crew C-0000" } });
  });

  test("is deterministic and preserves all four existing live intents", () => {
    expect(query({ question: twoCrew })).toEqual(query({ question: twoCrew }));
    expect(query({ question: "What happens if C-1042 reports sick?" })).toMatchObject({ success: true, intent: { type: "SICK_CREW" } });
    expect(query({ question: "Delay DX412 by 90 minutes" })).toMatchObject({ success: true, intent: { type: "DELAY" } });
    expect(query({ question: "Close HYD from 05:00-09:00 UTC" })).toMatchObject({ success: true, intent: { type: "STATION_CLOSURE" } });
    expect(query({ question: "Check C-5417 certification expiry" })).toMatchObject({ success: true, intent: { type: "CERT_EXPIRY" } });
  });
});
