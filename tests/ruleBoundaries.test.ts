/** Verification pass A — synthetic boundary audit of deterministic rules. */

import { beforeAll, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { loadOperationalGraph, type LoadedGraph } from "../src/data/loader.js";
import type { OperationalGraph } from "../src/data/graph.js";
import { addMinutes } from "../src/data/time.js";
import { checkFdp, fdpLimitHours } from "../src/rules/fdp.js";
import { checkDutyWindows } from "../src/rules/duty.js";
import { checkFlightHours } from "../src/rules/flightHours.js";
import { checkRest } from "../src/rules/rest.js";
import { checkCertificationsOnDate } from "../src/rules/certification.js";
import { checkQualification } from "../src/rules/qualification.js";
import { checkReserveCallout, isTimeInWindow } from "../src/rules/reserve.js";
import { checkCrewAssignmentLegality } from "../src/rules/assignment.js";
import { planDeadhead } from "../src/recovery/deadhead.js";
import { stationClosureImpact } from "../src/recovery/impact.js";
import { extendReleaseOverlay } from "../src/recovery/simulation.js";

const DATA_DIR = resolve(process.cwd(), "data");
let graph: OperationalGraph;

beforeAll(() => {
  const loaded: LoadedGraph = loadOperationalGraph(DATA_DIR);
  graph = loaded.graph;
});

const history = (entries: Array<[string, number, number]>) =>
  entries.map(([date, dutyHours, flightHours]) => ({ date, dutyHours, flightHours }));

describe("FDP exact minute boundaries", () => {
  for (const [sectors, limit] of [[1, 13], [2, 13], [3, 12.5], [4, 12]] as const) {
    it(`${sectors} sector(s): one minute below/at/above ${limit}h`, () => {
      const report = "2026-09-15T00:00:00Z";
      const minutes = limit * 60;
      const below = checkFdp(report, addMinutes(report, minutes - 1), sectors);
      const at = checkFdp(report, addMinutes(report, minutes), sectors);
      const above = checkFdp(report, addMinutes(report, minutes + 1), sectors);
      expect(below.passed).toBe(true);
      expect(at.passed).toBe(true);
      expect(above.passed).toBe(false);
      expect(at.evidence).toMatchObject({ ruleId: "RULE-FDP-01", actualFdpHours: limit, limitHours: limit, sectors });
      expect(above.evidence.violation).toContain("RULE-FDP-01");
    });
  }

  it("rejects zero sectors and continues the documented reduction beyond four sectors", () => {
    expect(() => fdpLimitHours(0)).toThrow("sectors >= 1");
    expect(fdpLimitHours(5)).toBe(11.5);
  });
});

describe("calendar duty and block windows", () => {
  it("applies the inclusive seven-calendar-day boundary at 59h59m, 60h, and 60h01m", () => {
    for (const [hours, legal] of [[59 + 59 / 60, true], [60, true], [60 + 1 / 60, false]] as const) {
      const result = checkDutyWindows({ history: [], existing: new Map(), proposed: new Map([["2026-09-16", hours]]) });
      expect(result.passed).toBe(legal);
      expect(result.evidence.worst).toMatchObject({ windowStart: "2026-09-10", windowEnd: "2026-09-16", totalHours: Math.round(hours * 100) / 100, limitHours: 60, legal });
    }
  });

  it("uses UTC calendar dates and excludes the eighth-oldest duty day", () => {
    const outside = checkDutyWindows({
      history: history([["2026-09-09", 20, 0], ["2026-09-10", 40, 0]]),
      existing: new Map(), proposed: new Map([["2026-09-16", 20]]),
    });
    const inside = checkDutyWindows({
      history: history([["2026-09-09", 20, 0], ["2026-09-10", 40, 0]]),
      existing: new Map(), proposed: new Map([["2026-09-15", 20]]),
    });
    expect(outside.passed).toBe(true);
    expect(outside.evidence.worst?.totalHours).toBe(60);
    expect(inside.passed).toBe(false);
    expect(inside.evidence.worst).toMatchObject({ windowStart: "2026-09-09", windowEnd: "2026-09-15", totalHours: 80, limitHours: 60 });
  });

  it("applies the inclusive 28-calendar-day boundary at 99h59m, 100h, and 100h01m", () => {
    for (const [hours, legal] of [[99 + 59 / 60, true], [100, true], [100 + 1 / 60, false]] as const) {
      const result = checkFlightHours({ history: [], existing: new Map(), proposed: new Map([["2026-09-01", hours]]) });
      expect(result.passed).toBe(legal);
      expect(result.evidence.worst).toMatchObject({ windowStart: "2026-08-05", windowEnd: "2026-09-01", totalHours: Math.round(hours * 100) / 100, limitHours: 100, legal });
    }
  });

  it("spans the August/September boundary and excludes date 28 days outside", () => {
    const result = checkFlightHours({
      history: history([["2026-08-04", 0, 50], ["2026-08-05", 0, 50]]),
      existing: new Map(), proposed: new Map([["2026-09-01", 50]]),
    });
    expect(result.passed).toBe(true);
    expect(result.evidence.worst).toMatchObject({ windowStart: "2026-08-05", windowEnd: "2026-09-01", totalHours: 100, limitHours: 100 });
  });
});

describe("rest, overlap, and resolved timing", () => {
  it("uses previous release to next report at 11h59m, 12h, and 12h01m", () => {
    const release = "2026-09-15T12:30:00Z";
    expect(checkRest(release, "2026-09-16T00:29:00Z").passed).toBe(false);
    const exact = checkRest(release, "2026-09-16T00:30:00Z");
    expect(exact.passed).toBe(true);
    expect(exact.evidence).toMatchObject({ previousRelease: release, nextReport: "2026-09-16T00:30:00Z", restMinutes: 720, minimumRestHours: 12 });
    expect(checkRest(release, "2026-09-16T00:31:00Z").passed).toBe(true);
  });

  it("distinguishes touching duties from a one-minute overlap through the rest evidence", () => {
    const touching = checkRest("2026-09-15T12:00:00Z", "2026-09-15T12:00:00Z");
    const overlap = checkRest("2026-09-15T12:00:00Z", "2026-09-15T11:59:00Z");
    expect(touching.evidence.restMinutes).toBe(0);
    expect(overlap.evidence.restMinutes).toBe(-1);
    expect(touching.passed).toBe(false);
    expect(overlap.passed).toBe(false);
  });

  it("uses an overlay release, rather than rostered timing, for downstream rest", () => {
    const legal = checkCrewAssignmentLegality(graph, "C-5837", "P-2204");
    const shifted = checkCrewAssignmentLegality(graph, "C-5837", "P-2204", {
      timing: extendReleaseOverlay(graph, "P-2204", "2026-09-17", 2926),
    });
    expect(legal.violations.map((violation) => violation.ruleId)).not.toContain("RULE-REST-04");
    expect(shifted.violations.map((violation) => violation.ruleId)).toContain("RULE-REST-04");
  });
});

describe("certification, qualification, reserve, and positioning", () => {
  it("keeps a supplied certification valid through validTo and fails after it", () => {
    const cert = graph.certificationsByCrew.get("C-5417")?.filter((item) => item.certType === "recurrent_training") ?? [];
    expect(checkCertificationsOnDate(cert, "2026-09-16").passed).toBe(true);
    expect(checkCertificationsOnDate(cert, "2026-09-17").passed).toBe(true);
    const expired = checkCertificationsOnDate(cert, "2026-09-18");
    expect(expired.passed).toBe(false);
    expect(expired.evidence).toMatchObject({ ruleId: "RULE-CERT-06", dutyDate: "2026-09-18", expired: ["recurrent_training"] });
  });

  it("records the current supplied-record semantics for an empty certification set", () => {
    // Generator and validator both assess the certifications that are present;
    // neither defines a separate required-certification inventory.
    expect(checkCertificationsOnDate([], "2026-09-18").passed).toBe(true);
  });

  it("keeps certification and aircraft-rating failures separate", () => {
    expect(checkQualification(["A320", "ATR72"], ["ATR72"]).passed).toBe(true);
    const wrongRating = checkCrewAssignmentLegality(graph, "C-2091", "P-2291");
    const expiredCert = checkCrewAssignmentLegality(graph, "C-5417", "P-2213");
    expect(wrongRating.violations.map((item) => item.ruleId)).toContain("RULE-QUAL-05");
    expect(expiredCert.violations.map((item) => item.ruleId)).toContain("RULE-CERT-06");
    expect(expiredCert.violations.map((item) => item.ruleId)).not.toContain("RULE-QUAL-05");
  });

  it("uses inclusive reserve-window endpoints and one-minute exclusions", () => {
    expect(isTimeInWindow("06:00", "06:00", "18:00")).toBe(true);
    expect(isTimeInWindow("05:59", "06:00", "18:00")).toBe(false);
    expect(isTimeInWindow("18:00", "06:00", "18:00")).toBe(true);
    expect(isTimeInWindow("18:01", "06:00", "18:00")).toBe(false);
    expect(checkReserveCallout(graph, "C-3310", "P-2291", { requiredReportUtc: "2026-09-15T18:00:00Z" }).passed).toBe(true);
  });

  it("uses arrival +15m then report +60m for data-driven deadhead positioning", () => {
    const plan = planDeadhead(graph, "DEL", "BLR", "2026-09-15", "2026-09-15T07:00:00Z");
    expect(plan).toMatchObject({ reachable: true, positioningArrUtc: "2026-09-15T08:45:00Z", newReportUtc: "2026-09-15T09:00:00Z", newFirstDepUtc: "2026-09-15T10:00:00Z", delayHours: 3 });
    expect(planDeadhead(graph, "DEL", "BLR", "2026-09-15", "2026-09-15T10:00:00Z").delayHours).toBe(0);
  });
});

describe("UTC closure boundaries", () => {
  for (const side of ["dep", "arr"] as const) {
    it(`uses [start,end) for ${side === "dep" ? "departure" : "arrival"} matching`, () => {
      const flight = graph.flights.find((item) => side === "dep" ? item.depStation === "BLR" : item.arrStation === "BLR");
      expect(flight).toBeDefined();
      if (!flight) return;
      const time = side === "dep" ? flight.depUtc : flight.arrUtc;
      const before = stationClosureImpact(graph, "BLR", addMinutes(time, 1), addMinutes(time, 2));
      const atStart = stationClosureImpact(graph, "BLR", time, addMinutes(time, 2));
      const beforeEnd = stationClosureImpact(graph, "BLR", addMinutes(time, -1), addMinutes(time, 1));
      const atEnd = stationClosureImpact(graph, "BLR", addMinutes(time, -1), time);
      expect(before.affectedFlights.map((item) => item.flightId)).not.toContain(flight.flightId);
      expect(atStart.affectedFlights.map((item) => item.flightId)).toContain(flight.flightId);
      expect(beforeEnd.affectedFlights.map((item) => item.flightId)).toContain(flight.flightId);
      expect(atEnd.affectedFlights.map((item) => item.flightId)).not.toContain(flight.flightId);
    });
  }
});
