import { describe, expect, test } from "vitest";
import { resolve } from "node:path";
import { createCrewOpsQueryService } from "../src/api/crewopsQuery.js";
import { loadOperationalGraph } from "../src/data/loader.js";
import { CrewOpsApiError, mapCrewOpsResponse, mapCertificationExpiryResponse, mapDelayResponse, mapMultiSickResponse, mapSickCrewResponse, mapStationClosureResponse } from "../frontend/src/api/crewops.js";

const response = {
  success: true,
  intent: { type: "SICK_CREW" },
  entities: { crewId: "C-1042", pairingIds: ["P-2291"] },
  summary: "Backend summary",
  consequences: { recoveryRequired: true, affectedPairings: [{ pairingId: "P-2291", role: "Captain", dutyDates: ["2026-09-15"], flightIds: ["DX412"], aircraftTypes: ["A320"], recoveryAvailable: true }] },
  recovery: {
    recommended: { crewId: "C-3310", crewName: "M. Rao", role: "Captain", base: "BLR", kind: "cover", method: "reserve", pairingId: "P-2291", legal: true, legalityEvaluated: true, cost: { currency: "INR", total: 18500, components: [{ type: "reserve_callout", amount: 18500 }] }, delayMinutes: 0, affectedFlightIds: ["DX412"] },
    alternatives: [],
    rejected: [{ crewId: "C-2087", crewName: "R. Sharma", role: "Captain", legalityEvaluated: true, reasons: ["7-day duty limit exceeded"], violations: [{ ruleId: "RULE-DUTY-02", message: "7-day duty limit exceeded", actual: 61.33, limit: 60 }] }],
    cancellationFallbacks: [],
  },
  evidence: [{ ruleId: "RULE-FDP-01", passed: true, actual: 11.5, limit: 12.5 }],
  warnings: [], assumptions: ["Rostered timing used."],
};

describe("frontend SICK_CREW API mapper", () => {
  test("preserves the established display contract without calculating legality or cost", () => {
    const mapped = mapSickCrewResponse(response, "What happens if C-1042 reports sick?");
    expect(mapped.live).toBe(true);
    expect(mapped.recommended).toMatchObject({ id: "C-3310", status: "legal", cost: "₹18,500" });
    expect(mapped.alternatives[0]).toMatchObject({ id: "C-2087", status: "rejected", reason: "7-day duty limit exceeded" });
    expect(mapped.note).toContain("Rostered timing used.");
  });

  test("rejects malformed and empty API payloads instead of showing a mock", () => {
    expect(() => mapSickCrewResponse({ success: true }, "x")).toThrow(CrewOpsApiError);
    expect(() => mapSickCrewResponse({ ...response, consequences: { recoveryRequired: false, affectedPairings: [] } }, "x")).toThrow(/No affected duties/);
  });

  test("maps the additive grounded answer and agent status without replacing structured data", () => {
    const mapped = mapCrewOpsResponse({
      ...response,
      naturalLanguageAnswer: "C-1042 affects P-2291; C-3310 is the deterministic recommendation.",
      agent: { plannerUsed: true, plannerFallback: false, explainerUsed: true, fallbackUsed: false, plannerMs: 12, toolMs: 2, explainerMs: 18 },
    }, "Captain C-1042 called in sick");
    expect(mapped).toMatchObject({ id: "sick", naturalLanguageAnswer: expect.stringContaining("C-3310"), agent: { plannerUsed: true, plannerFallback: false, explainerUsed: true, fallbackUsed: false } });
    expect(mapped.recommended).toMatchObject({ id: "C-3310", cost: "₹18,500" });
  });

  test("rejects malformed agent metadata explicitly", () => {
    expect(() => mapCrewOpsResponse({ ...response, agent: { plannerUsed: "yes" } }, "x")).toThrow(/Malformed CrewOps agent metadata/);
  });
});

describe("frontend DELAY API mapper", () => {
  test("renders deterministic delay consequences without frontend calculations", () => {
    const mapped = mapDelayResponse({
      success: true, intent: { type: "DELAY" },
      entities: { flightNo: "DX401", origin: "BLR", destination: "HYD", delayMinutes: 90, crewIds: ["C-1"] },
      summary: "Delay recovery required",
      consequences: { recoveryRequired: true, affectedPairings: [{ pairingId: "P-2201", dutyDates: ["2026-09-16"], flightIds: ["DX401"] }], boundary: { pairingId: "P-2201", firstAffectedFlight: "DX404" } },
      recovery: { recommended: response.recovery.recommended, alternatives: [], rejected: response.recovery.rejected, cancellationFallbacks: [], recommendedPlan: { strategy: "partial", totalCost: 18500 } },
      evidence: [{ ruleId: "RULE-FDP-01", passed: false, actual: 12.75, limit: 12.5 }], warnings: [], assumptions: ["Overlay used."],
    }, "Delay DX401 by 90 minutes");
    expect(mapped).toMatchObject({ id: "delay", live: true, status: "RECOVERY REQUIRED", pairing: "P-2201" });
    expect(mapped.consequence?.checks[0]).toMatchObject({ id: "RULE-FDP-01", actual: "12.75", limit: "12.5" });
    expect(mapped.note).toContain("₹18,500");
  });

  test("presents the DX413 recovery as one costed plan with concise unique evidence", () => {
    const graph = loadOperationalGraph(resolve(process.cwd(), "data")).graph;
    const payload = createCrewOpsQueryService(graph).query({ question: "Delay DX413 by 75 minutes" });
    if (!payload.success) throw new Error(payload.error.message);
    const mapped = mapDelayResponse(payload, "DX413 is now expected to depart 75 minutes late.");
    expect(mapped.recommended).toMatchObject({
      id: "PARTIAL RECOVERY",
      cost: "₹56,000",
      costLabel: "Total plan cost",
      delay: "0 min",
      positioning: "No",
      assignments: expect.arrayContaining([
        expect.objectContaining({ id: "C-3310", role: "Captain", base: "BLR", cost: "₹18,500" }),
        expect.objectContaining({ id: "C-3311", role: "First Officer", base: "BLR", cost: "₹18,500" }),
      ]),
    });
    expect(mapped.recommended?.checks.map((check) => check.id)).toEqual([
      "RULE-FDP-01", "RULE-DUTY-02", "RULE-FLT-03", "RULE-REST-04", "RULE-QUAL-05", "RULE-CERT-06", "RULE-BASE-07",
    ]);
    expect(new Set(mapped.recommended?.checks.map((check) => check.id)).size).toBe(mapped.recommended?.checks.length);
    expect(mapped.recommended?.trace).toHaveLength(28);
    expect(mapped.recommended?.trace).toContainEqual(expect.objectContaining({
      ruleId: "RULE-BASE-07",
      details: expect.objectContaining({ requiredReportLocation: "BLR", requiresPositioning: "false" }),
    }));
    expect(mapped.consequence?.note).toContain("Recovery coverage starts before DX588-2026-09-15");
    expect(mapped.alternatives.find((option) => option.id === "C-2210")).toMatchObject({
      cost: "₹25,000",
      positioning: "Yes · DEL → BLR via DX402-2026-09-15",
    });
    expect(mapped.alternatives.flatMap((option) => option.checks).some((check) =>
      check.id === "RULE-REST-04" && check.label.startsWith("DUTY OVERLAP") && check.actual === "DUTY OVERLAP",
    )).toBe(true);
    expect(mapped.evidence?.length).toBe(payload.evidence.length);
  });
});

describe("frontend STATION_CLOSURE API mapper", () => {
  const closure = {
    success: true, intent: { type: "STATION_CLOSURE" },
    entities: { station: "HYD", closureStartUtc: "2026-09-14T05:00:00Z", closureEndUtc: "2026-09-14T09:00:00Z", affectedFlightCount: 2, affectedPairingCount: 1, affectedCrewCount: 2 },
    summary: "HYD closure result",
    consequences: { recoveryRequired: false, recoveryAvailable: undefined, affectedFlights: [
      { flightId: "DX461-2026-09-14", origin: "BLR", destination: "HYD", scheduledDepartureUtc: "2026-09-14T05:00:00Z", scheduledArrivalUtc: "2026-09-14T06:30:00Z", reasons: ["ARRIVAL_IN_CLOSURE", "DEPARTURE_IN_CLOSURE"] },
    ], affectedPairings: [], affectedCrew: [], operationalConsequences: [{ modeledAction: "DELAY_TO_REOPENING" }] },
    recovery: { alternatives: [], rejected: [], cancellationFallbacks: [] }, evidence: [{ flightId: "DX461-2026-09-14", reason: "deterministic timing" }], warnings: ["Model limitation"], assumptions: ["UTC."],
  };

  test("renders backend UTC timestamps and closure data without operational inference", () => {
    const mapped = mapStationClosureResponse(closure, "Close HYD from 05:00-09:00 UTC");
    expect(mapped).toMatchObject({ id: "closure", live: true, status: "MODELED DELAY · LEGAL" });
    expect(mapped.affectedFlights?.[0]).toMatchObject({ departure: "2026-09-14T05:00:00Z", arrival: "2026-09-14T06:30:00Z", reason: "ARRIVAL_IN_CLOSURE + DEPARTURE_IN_CLOSURE" });
    expect(mapped.closureOutcome?.consequence).toBe("DELAY TO REOPENING");
  });

  test("does not mask malformed or empty closure results with mocks", () => {
    expect(() => mapStationClosureResponse({ success: true }, "x")).toThrow(CrewOpsApiError);
    expect(() => mapStationClosureResponse({ ...closure, consequences: { ...closure.consequences, affectedFlights: [] } }, "x")).toThrow(/No affected operations/);
  });
});

describe("frontend CERT_EXPIRY API mapper", () => {
  const certification = {
    success: true, intent: { type: "CERT_EXPIRY" },
    entities: { crewId: "C-5417", role: "Cabin Crew", certificationType: "recurrent_training", certifications: [{ certType: "recurrent_training", validTo: "2026-09-17" }] },
    summary: "Certification result",
    consequences: { recoveryRequired: true, recoveryAvailable: true, inspectedDuties: [
      { pairingId: "P-2210", dutyDate: "2026-09-16", flightIds: ["DX1"], aircraftTypes: ["A320"], certificationLegal: true, expired: [] },
      { pairingId: "P-2213", dutyDate: "2026-09-19", flightIds: ["DX2"], aircraftTypes: ["A320"], certificationLegal: false, expired: ["recurrent_training"] },
    ], affectedDuties: [{ pairingId: "P-2213", dutyDate: "2026-09-19", flightIds: ["DX2"] }], affectedPairings: [] },
    recovery: { recommended: response.recovery.recommended, alternatives: [], rejected: response.recovery.rejected, cancellationFallbacks: [] },
    evidence: [{ ruleId: "RULE-CERT-06", passed: false, reason: "recurrent_training valid through 2026-09-17; invalid on duty date 2026-09-19", details: { validTo: "2026-09-17", dutyDate: "2026-09-19" } }], warnings: [], assumptions: ["Supplied records only."],
  };

  test("renders inspected legal and affected illegal duties without frontend validity calculation", () => {
    const mapped = mapCertificationExpiryResponse(certification, "Check C-5417 certification expiry");
    expect(mapped).toMatchObject({ id: "certification", live: true, status: "INVALID FOR DUTY", pairing: "P-2213" });
    expect(mapped.metrics).toContainEqual({ label: "Valid through", value: "2026-09-17" });
    expect(mapped.certificationDuties).toEqual(expect.arrayContaining([expect.objectContaining({ dutyDate: "2026-09-16", certificationLegal: true }), expect.objectContaining({ dutyDate: "2026-09-19", certificationLegal: false })]));
    expect(mapped.consequence?.checks[0]).toMatchObject({ id: "RULE-CERT-06", actual: "2026-09-19", limit: "2026-09-17" });
  });

  test("represents a valid no-affected-duty response cleanly and rejects malformed payloads", () => {
    const mapped = mapCertificationExpiryResponse({ ...certification, consequences: { ...certification.consequences, recoveryRequired: false, affectedDuties: [] } }, "x");
    expect(mapped).toMatchObject({ status: "NO AFFECTED DUTY", pairing: "No affected pairing" });
    expect(() => mapCertificationExpiryResponse({ success: true }, "x")).toThrow(CrewOpsApiError);
  });
});

describe("frontend MULTI_SICK API mapper", () => {
  const multi = {
    success: true, intent: { type: "MULTI_SICK" }, entities: { unavailableCrew: [{ crewId: "C-3940" }, { crewId: "C-1938" }] }, summary: "Joint result",
    consequences: { complete: true, recoveryRequired: true, affectedPairings: [{ pairingId: "P-1" }, { pairingId: "P-2" }], affectedFlights: ["DX1", "DX2"], disruptions: [
      { crewId: "C-3940", pairingId: "P-1", selected: { kind: "cover", crewId: "C-3305", legal: true, costTotal: 18500, delayMinutes: 0 } },
      { crewId: "C-1938", pairingId: "P-2", selected: { kind: "cancel", costTotal: 90000, delayMinutes: 0 } },
    ] }, recovery: { alternatives: [], rejected: [], cancellationFallbacks: [] }, evidence: [{ cost: { total: 108500 }, reason: "joint total across 2 disruption(s)" }], warnings: [], assumptions: ["Joint allocator."],
  };
  test("renders each selected joint outcome, including cancellation, without client allocation", () => {
    const mapped = mapMultiSickResponse(multi, "C-3940 and C-1938 report sick");
    expect(mapped).toMatchObject({ id: "multi", live: true, status: "COMPLETE PLAN", total: "₹1,08,500" });
    expect(mapped.joint).toEqual(expect.arrayContaining([expect.objectContaining({ unavailableCrew: "C-3940", crew: "C-3305", status: "legal", cost: "₹18,500" }), expect.objectContaining({ unavailableCrew: "C-1938", crew: "Cancellation fallback", status: "not-evaluated" })]));
  });
  test("rejects malformed joint payloads rather than showing a mock", () => {
    expect(() => mapMultiSickResponse({ success: true }, "x")).toThrow(CrewOpsApiError);
  });
});
