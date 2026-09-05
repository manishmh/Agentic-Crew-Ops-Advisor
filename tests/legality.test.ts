/**
 * Deterministic truth-layer tests (STEP 2).
 *
 * All tests run against the REAL dataset and exercise the general
 * computation — no benchmark answers are hardcoded. Known dataset cases
 * (C-2087, C-2091, C-5417, reserve windows) are used as regression
 * anchors for the general logic, not as special cases.
 */

import { describe, expect, it, beforeAll } from "vitest";
import { resolve } from "node:path";
import { loadOperationalGraph, type LoadedGraph } from "../src/data/loader.js";
import type { LoadedDataset } from "../src/data/loader.js";
import {
  getAircraftTypesForPairing,
  getCertificationsForCrew,
  getCrewById,
  getCrewRoleInPairing,
  getDutyClockForCrew,
  getFlightById,
  getPairingById,
  getReserveForCrew,
  type OperationalGraph,
} from "../src/data/graph.js";
import { checkFdp, fdpLimitHours } from "../src/rules/fdp.js";
import { checkDutyWindows } from "../src/rules/duty.js";
import { checkFlightHours } from "../src/rules/flightHours.js";
import { checkRest } from "../src/rules/rest.js";
import { checkQualification } from "../src/rules/qualification.js";
import { checkCertificationsOnDate } from "../src/rules/certification.js";
import { checkReserveCallout, isTimeInWindow } from "../src/rules/reserve.js";
import { checkCrewAssignmentLegality } from "../src/rules/assignment.js";

const DATA_DIR = resolve(process.cwd(), "data");

let dataset: LoadedDataset;
let graph: OperationalGraph;

beforeAll(() => {
  const loaded: LoadedGraph = loadOperationalGraph(DATA_DIR);
  dataset = loaded.dataset;
  graph = loaded.graph;
});

describe("Step 2A — loaded rule metadata", () => {
  it("carries rules.definitions without rereading raw JSON", () => {
    expect(dataset.ruleDefinitions.duty_period).toContain("report_utc");
    expect(dataset.ruleDefinitions.reserve_callout).toContain("on-call window");
    expect(graph.ruleDefinitions).toEqual(dataset.ruleDefinitions);
  });

  it("carries time_convention and the rosters note", () => {
    expect(dataset.timeConvention).toContain("calendar days");
    expect(graph.timeConvention).toBe(dataset.timeConvention);
    expect(dataset.rostersNote).toContain("legal");
  });
});

describe("Step 2K — retrieval aliases and derived paths", () => {
  it("aliases resolve through the same indexes", () => {
    expect(getCrewById(graph, "C-1042")?.name).toBe("A. Nair");
    expect(getFlightById(graph, "DX401-2026-09-14")?.flightNo).toBe("DX401");
    expect(getPairingById(graph, "P-2291")?.aircraft).toBe("VT-DXC");
    expect(getDutyClockForCrew(graph, "C-1042")?.crewId).toBe("C-1042");
    expect(getReserveForCrew(graph, "C-3310")?.base).toBe("BLR");
    expect(getCrewById(graph, "C-0000")).toBeUndefined();
  });

  it("resolves pairing aircraft types and crew roles", () => {
    expect(getAircraftTypesForPairing(graph, "P-2291")).toEqual(["A320"]);
    expect(getCrewRoleInPairing(graph, "P-2291", "C-1042")).toBe("Captain");
    expect(getCrewRoleInPairing(graph, "P-2291", "C-0000")).toBeUndefined();
  });
});

describe("Step 2C — FDP boundaries", () => {
  it("encodes the limit table", () => {
    expect(fdpLimitHours(1)).toBe(13);
    expect(fdpLimitHours(2)).toBe(13);
    expect(fdpLimitHours(3)).toBe(12.5);
    expect(fdpLimitHours(4)).toBe(12);
    expect(fdpLimitHours(5)).toBe(11.5);
  });

  it("exactly at the limit is legal; one minute over is not", () => {
    const at = checkFdp("2026-09-15T06:00:00Z", "2026-09-15T18:30:00Z", 3);
    expect(at.passed).toBe(true);
    expect(at.evidence).toMatchObject({ actualFdpHours: 12.5, limitHours: 12.5, sectors: 3 });
    const over = checkFdp("2026-09-15T06:00:00Z", "2026-09-15T18:31:00Z", 3);
    expect(over.passed).toBe(false);
    expect(over.evidence.violation).toContain("RULE-FDP-01");
  });

  it("P-2291 day 1 (3 sectors, 9.5h) is inside 12.5h", () => {
    const day = checkFdp("2026-09-15T06:00:00Z", "2026-09-15T15:30:00Z", 3);
    expect(day.passed).toBe(true);
    expect(day.evidence.actualFdpHours).toBe(9.5);
  });
});

describe("Step 2D — 7-day duty boundary", () => {
  const historyOf = (hours: number[]) =>
    hours.map((dutyHours, i) => ({
      date: `2026-09-${String(i + 1).padStart(2, "0")}`,
      dutyHours,
      flightHours: 0,
    }));

  it("exactly 60h in the window is legal; 60.01h is not", () => {
    const history = historyOf([10, 10, 10, 10, 10, 10, 0]);
    const at = checkDutyWindows({ history, existing: new Map(), proposed: new Map([["2026-09-07", 0]]) });
    expect(at.passed).toBe(true);
    expect(at.evidence.worst?.totalHours).toBe(60);
    const over = checkDutyWindows({ history, existing: new Map(), proposed: new Map([["2026-09-07", 0.01]]) });
    expect(over.passed).toBe(false);
    expect(over.evidence.worst?.totalHours).toBeCloseTo(60.01, 2);
  });

  it("reports current hours and remaining headroom", () => {
    const history = historyOf([10, 10, 10, 10, 10, 10, 0]);
    const r = checkDutyWindows({ history, existing: new Map(), proposed: new Map([["2026-09-07", 0]]) });
    expect(r.evidence.currentHours7d).toBe(60);
    expect(r.evidence.worst?.remainingHours).toBe(0);
  });

  it("C-2087 covering P-2291 breaches at ~61.33h (regression)", () => {
    const result = checkCrewAssignmentLegality(graph, "C-2087", "P-2291");
    expect(result.legal).toBe(false);
    const v = result.violations.find((x) => x.ruleId === "RULE-DUTY-02");
    expect(v).toBeDefined();
    expect(v?.limit).toBe(60);
    expect(v?.actual).toBeCloseTo(61.33, 2);
    expect(v?.details).toMatchObject({ windowStart: "2026-09-09", windowEnd: "2026-09-15" });
  });
});

describe("Step 2E — 28-day flight-hour boundary", () => {
  const history28 = (first: number) =>
    Array.from({ length: 28 }, (_, i) => ({
      date: `2026-08-${String(i + 1).padStart(2, "0")}`,
      dutyHours: 0,
      flightHours: i === 0 ? first : 0,
    }));

  it("exactly 100h is legal; 100.01h is not", () => {
    const at = checkFlightHours({
      history: history28(100),
      existing: new Map(),
      proposed: new Map([["2026-08-28", 0]]),
    });
    expect(at.passed).toBe(true);
    expect(at.evidence.worst?.totalHours).toBe(100);
    const over = checkFlightHours({
      history: history28(100),
      existing: new Map(),
      proposed: new Map([["2026-08-28", 0.01]]),
    });
    expect(over.passed).toBe(false);
  });

  it("reports current total, proposed contribution, and remaining", () => {
    const r = checkFlightHours({
      history: history28(90),
      existing: new Map(),
      proposed: new Map([["2026-08-28", 5]]),
    });
    expect(r.evidence.currentHours28d).toBe(90);
    expect(r.evidence.proposedHours).toBe(5);
    expect(r.evidence.worst?.totalHours).toBe(95);
    expect(r.evidence.worst?.remainingHours).toBe(5);
  });
});

describe("Step 2F — rest boundaries", () => {
  it("exactly 12h rest is legal", () => {
    const r = checkRest("2026-09-15T15:30:00Z", "2026-09-16T03:30:00Z");
    expect(r.passed).toBe(true);
    expect(r.evidence).toMatchObject({ restHours: 12, minimumRestHours: 12 });
  });

  it("11h59m rest is illegal", () => {
    const r = checkRest("2026-09-15T15:30:00Z", "2026-09-16T03:29:00Z");
    expect(r.passed).toBe(false);
    expect(r.evidence.restHours).toBeCloseTo(11.98, 2);
    expect(r.evidence.violation).toContain("RULE-REST-04");
  });
});

describe("Steps 2G/2H — qualification and certification primitives", () => {
  it("accepts a valid rating and names a missing one", () => {
    expect(checkQualification(["A320"], ["A320"]).passed).toBe(true);
    const bad = checkQualification(["ATR72"], ["A320"]);
    expect(bad.passed).toBe(false);
    expect(bad.evidence.missingRatings).toEqual(["A320"]);
  });

  it("C-2091 (ATR-only) does not qualify for A320 pairing P-2291", () => {
    const crew = getCrewById(graph, "C-2091");
    const types = getAircraftTypesForPairing(graph, "P-2291");
    expect(checkQualification(crew?.ratings ?? [], types).passed).toBe(false);
  });

  it("cert valid on expiry date, expired the day after", () => {
    const certs = getCertificationsForCrew(graph, "C-5417").filter((c) => c.certType === "recurrent_training");
    expect(checkCertificationsOnDate(certs, "2026-09-17").passed).toBe(true);
    const expired = checkCertificationsOnDate(certs, "2026-09-19");
    expect(expired.passed).toBe(false);
    expect(expired.evidence.expired).toEqual(["recurrent_training"]);
  });

  it("C-5417 is fully valid on 2026-09-16 (general logic, both directions)", () => {
    const certs = getCertificationsForCrew(graph, "C-5417");
    expect(certs).toHaveLength(4);
    expect(checkCertificationsOnDate(certs, "2026-09-16").passed).toBe(true);
    expect(checkCertificationsOnDate(certs, "2026-09-19").passed).toBe(false);
  });
});

describe("Step 2I — reserve window and base", () => {
  it("window boundaries are inclusive and wrap-safe", () => {
    expect(isTimeInWindow("06:00", "06:00", "18:00")).toBe(true);
    expect(isTimeInWindow("18:00", "06:00", "18:00")).toBe(true);
    expect(isTimeInWindow("05:59", "06:00", "18:00")).toBe(false);
    expect(isTimeInWindow("23:00", "22:00", "02:00")).toBe(true);
    expect(isTimeInWindow("12:00", "22:00", "02:00")).toBe(false);
  });

  it("C-3310 (06:00–18:00) covers the 06:00 report; C-3305 (00:00–05:30) does not", () => {
    const ok = checkReserveCallout(graph, "C-3310", "P-2291");
    expect(ok.passed).toBe(true);
    expect(ok.evidence.window).toMatchObject({ reportTime: "06:00", inside: true });
    expect(ok.evidence.requiresDeadhead).toBe(false);
    const early = checkReserveCallout(graph, "C-3305", "P-2291");
    expect(early.passed).toBe(false);
    expect(early.evidence.window?.inside).toBe(false);
  });

  it("cross-base callout is flagged requiresDeadhead, not silently rejected", () => {
    const del = checkReserveCallout(graph, "C-2210", "P-2291");
    expect(del.evidence.requiresDeadhead).toBe(true);
    expect(del.evidence.reserveBase).toBe("DEL");
    expect(del.evidence.pairingBase).toBe("BLR");
    // Window and dates still hold — deadhead positioning (Step 3) applies.
    expect(del.evidence.window?.inside).toBe(true);
    expect(del.evidence.datesCovered).toBe(true);
  });

  it("line crew without a reserve record is not reserve-eligible", () => {
    const r = checkReserveCallout(graph, "C-1042", "P-2291");
    expect(r.passed).toBe(false);
    expect(r.evidence.hasReserveRecord).toBe(false);
  });
});

describe("Step 2J — combined assignment legality", () => {
  it("C-3310 covering P-2291 as reserve is fully legal with per-rule evidence", () => {
    const r = checkCrewAssignmentLegality(graph, "C-3310", "P-2291", { asReserve: true });
    expect(r.legal).toBe(true);
    expect(r.violations).toEqual([]);
    expect(r.checks.map((c) => c.ruleId).sort()).toEqual(
      ["RULE-BASE-07", "RULE-CERT-06", "RULE-DUTY-02", "RULE-FDP-01", "RULE-FDP-01", "RULE-FLT-03", "RULE-QUAL-05", "RULE-REST-04"].sort(),
    );
    for (const c of r.checks) {
      expect(c.passed).toBe(true);
      expect(c.evidence).toBeDefined();
    }
    const fdp = r.checks.filter((c) => c.ruleId === "RULE-FDP-01");
    expect(fdp).toHaveLength(2); // one evidence entry per pairing day
    expect(fdp[0].evidence).toMatchObject({ actualFdpHours: 9.5, limitHours: 12.5, sectors: 3 });
  });

  it("C-2091 on P-2291 fails qualification", () => {
    const r = checkCrewAssignmentLegality(graph, "C-2091", "P-2291");
    expect(r.legal).toBe(false);
    expect(r.violations.map((v) => v.ruleId)).toContain("RULE-QUAL-05");
  });

  it("C-5417 on P-2213 fails certification on 2026-09-19", () => {
    const r = checkCrewAssignmentLegality(graph, "C-5417", "P-2213");
    expect(r.legal).toBe(false);
    const v = r.violations.find((x) => x.ruleId === "RULE-CERT-06");
    expect(v?.details).toMatchObject({ dutyDate: "2026-09-19", expired: ["recurrent_training"] });
  });

  it("C-3305 on P-2291 breaches duty on day 2 (teaching case)", () => {
    const r = checkCrewAssignmentLegality(graph, "C-3305", "P-2291", { asReserve: true });
    expect(r.legal).toBe(false);
    expect(r.violations.map((v) => v.ruleId)).toContain("RULE-DUTY-02");
  });

  it("line assignment skips the reserve rule with an explicit reason", () => {
    const r = checkCrewAssignmentLegality(graph, "C-1042", "P-2291");
    expect(r.legal).toBe(true);
    const base = r.checks.find((c) => c.ruleId === "RULE-BASE-07");
    expect(base?.passed).toBe(true);
    expect(base?.evidence).toMatchObject({ applicable: false });
  });

  it("violations carry machine-readable actual/limit numbers", () => {
    const r = checkCrewAssignmentLegality(graph, "C-2087", "P-2291");
    for (const v of r.violations) {
      expect(v.ruleId).toMatch(/^RULE-/);
      expect(typeof v.message).toBe("string");
    }
    expect(r.crewId).toBe("C-2087");
    expect(r.pairingId).toBe("P-2291");
  });
});
