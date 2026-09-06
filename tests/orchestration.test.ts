/**
 * Orchestration-layer tests. Every expectation flows from the locked
 * engines — the tools only route and reshape. IDs below are regression
 * anchors from supplied data, never logic inputs.
 */

import { describe, expect, it, beforeAll } from "vitest";
import { resolve } from "node:path";
import { loadOperationalGraph, type LoadedGraph } from "../src/data/loader.js";
import type { LoadedDataset } from "../src/data/loader.js";
import type { OperationalGraph } from "../src/data/graph.js";
import { searchOperationalData } from "../src/orchestration/search.js";
import { getCrewStatus } from "../src/orchestration/status.js";
import { analyzeDisruption } from "../src/orchestration/disruptions.js";
import { findRecoveryOptions, optimizeRecovery } from "../src/orchestration/recoveryTools.js";
import { getEvidenceForOption, getEvidenceForJointPlan } from "../src/orchestration/evidence.js";

const DATA_DIR = resolve(process.cwd(), "data");

let dataset: LoadedDataset;
let graph: OperationalGraph;

beforeAll(() => {
  const loaded: LoadedGraph = loadOperationalGraph(DATA_DIR);
  dataset = loaded.dataset;
  graph = loaded.graph;
});

describe("searchOperationalData", () => {
  it("looks up crew, flights, and pairings deterministically", () => {
    const crew = searchOperationalData(graph, { entity: "crew", crewId: "C-1042" });
    expect(crew.success).toBe(true);
    expect(crew.type).toBe("SEARCH");
    expect((crew.data.items[0] as { name: string }).name).toBe("A. Nair");

    const flights = searchOperationalData(graph, { entity: "flights", origin: "BLR", date: "2026-09-15" });
    expect(flights.success).toBe(true);
    expect(flights.data.total).toBeGreaterThan(0);
    for (const f of flights.data.items as Array<{ depStation: string; date: string }>) {
      expect(f.depStation).toBe("BLR");
      expect(f.date).toBe("2026-09-15");
    }

    const pairing = searchOperationalData(graph, { entity: "pairings", pairingId: "P-2291" });
    expect(pairing.data.total).toBe(1);

    const again = searchOperationalData(graph, { entity: "flights", origin: "BLR", date: "2026-09-15" });
    expect(JSON.stringify(again.data.items)).toBe(JSON.stringify(flights.data.items));
  });

  it("covers reserves, certifications, clocks, and risk signals", () => {
    expect(searchOperationalData(graph, { entity: "reserves", base: "BLR" }).data.total).toBeGreaterThan(0);
    expect(searchOperationalData(graph, { entity: "certifications", crewId: "C-1042" }).data.total).toBe(4);
    expect(searchOperationalData(graph, { entity: "dutyClocks", crewId: "C-1042" }).data.total).toBe(1);
    expect(searchOperationalData(graph, { entity: "riskSignals", crewId: "C-1042" }).data.total).toBe(1);
    expect(searchOperationalData(graph, { entity: "crew", crewId: "C-0000" }).data.total).toBe(0);
  });
});

describe("getCrewStatus", () => {
  it("reports roster, hours, quals, certs, reserve, and risk with evidence", () => {
    const r = getCrewStatus(graph, "C-1042");
    expect(r.success).toBe(true);
    expect(r.type).toBe("CREW_STATUS");
    expect(r.data.pairings.map((p) => p.pairingId)).toContain("P-2291");
    expect(r.data.dutyHours7d).toBe(20.93);
    expect(r.data.flightHours28d).toBe(64.27);
    expect(r.data.ratings).toContain("A320");
    expect(r.data.certifications).toHaveLength(4);
    expect(r.data.reserve).toBeUndefined();
    expect(r.data.risk?.disruptionRiskScore).toBe(0.78);
    expect(r.evidence.map((e) => e.ruleId)).toContain("RULE-DUTY-02");
    expect(r.evidence.map((e) => e.ruleId)).toContain("RULE-CERT-06");
  });

  it("fails cleanly for unknown crew", () => {
    const r = getCrewStatus(graph, "C-0000");
    expect(r.success).toBe(false);
    expect(r.error).toContain("C-0000");
  });
});

describe("analyzeDisruption", () => {
  it("assesses a sick crew impact", () => {
    const r = analyzeDisruption(graph, {
      type: "SICK_CREW", crewId: "C-1042", pairingId: "P-2291", reportedUtc: "2026-09-15T05:00:00Z",
    });
    expect(r.success).toBe(true);
    expect(r.type).toBe("DISRUPTION_ANALYSIS");
    if (r.data.kind !== "crew") throw new Error("wrong kind");
    expect(r.data.role).toBe("Captain");
    expect(r.data.flights).toHaveLength(6);
  });

  it("assesses a flight delay against operating-crew FDP", () => {
    const r = analyzeDisruption(graph, { type: "DELAY", flightId: "DX401-2026-09-16", delayMinutes: 90 });
    expect(r.success).toBe(true);
    if (r.data.kind !== "delay") throw new Error("wrong kind");
    expect(r.data.shiftedFlights).toHaveLength(4);
    expect(r.data.crewAssessments.length).toBeGreaterThan(0);
    expect(r.data.crewAssessments.every((c) => !c.fdpLegal)).toBe(true);
    expect(r.data.crewAssessments[0].fdpLimitHours).toBe(12);
  });

  it("assesses a station closure with illegal crew-days", () => {
    const r = analyzeDisruption(graph, {
      type: "STATION_CLOSURE", station: "BLR", startUtc: "2026-09-17T08:00:00Z", endUtc: "2026-09-17T14:00:00Z",
    });
    expect(r.success).toBe(true);
    if (r.data.kind !== "station") throw new Error("wrong kind");
    expect(r.data.affectedFlights).toContain("DX402-2026-09-17");
    expect(r.data.illegalDays.map((d) => d.pairingId)).toContain("P-2204");
    expect(r.evidence.some((e) => e.ruleId === "RULE-FDP-01" && e.passed === false)).toBe(true);
  });

  it("assesses a certification expiry", () => {
    const r = analyzeDisruption(graph, { type: "CERT_EXPIRY", crewId: "C-5417", dutyDate: "2026-09-17" });
    expect(r.success).toBe(true);
    if (r.data.kind !== "cert") throw new Error("wrong kind");
    expect(r.data.affected.map((a) => a.pairingId)).toContain("P-2213");
  });

  it("assesses simultaneous sick calls jointly in structure", () => {
    const r = analyzeDisruption(graph, {
      type: "MULTI_SICK",
      events: [
        { crewId: "C-3940", pairingId: "P-2205", reportedUtc: "2026-09-18T00:30:00Z" },
        { crewId: "C-1938", pairingId: "P-2212", reportedUtc: "2026-09-18T00:30:00Z" },
      ],
    });
    expect(r.success).toBe(true);
    if (r.data.kind !== "multi") throw new Error("wrong kind");
    expect(r.data.analyses).toHaveLength(2);
  });

  it("fails cleanly on unknown references", () => {
    const r = analyzeDisruption(graph, {
      type: "SICK_CREW", crewId: "C-1042", pairingId: "P-9999", reportedUtc: "2026-09-15T05:00:00Z",
    });
    expect(r.success).toBe(false);
  });
});

describe("findRecoveryOptions / optimizeRecovery", () => {
  it("selects the clean reserve for a sick captain", () => {
    const r = findRecoveryOptions(graph, { pairingId: "P-2291", role: "Captain", sickCrewId: "C-1042" });
    expect(r.success).toBe(true);
    expect(r.type).toBe("RECOVERY_OPTIONS");
    expect(r.data.selected?.crewId).toBe("C-3310");
    expect(r.data.selected?.cost.total).toBe(graph.costs.reserveCalloutPilot);
    expect(r.evidence.length).toBeGreaterThan(0);
  });

  it("falls back to cancellation when no candidate is legal", () => {
    const captains = graph.crews.filter((c) => c.rank === "Captain").map((c) => c.crewId);
    const r = findRecoveryOptions(graph, {
      pairingId: "P-2291", role: "Captain", sickCrewId: "C-1042", extraExcludeCrewIds: captains,
    });
    expect(r.success).toBe(true);
    expect(r.data.selected?.kind).toBe("cancel");
  });

  it("optimizes two simultaneous disruptions without crew reuse", () => {
    const r = optimizeRecovery(graph, {
      requests: [
        { pairingId: "P-2205", role: "Captain", sickCrewId: "C-3940", reportedUtc: "2026-09-18T00:30:00Z" },
        { pairingId: "P-2212", role: "Captain", sickCrewId: "C-1938", reportedUtc: "2026-09-18T00:30:00Z" },
      ],
    });
    expect(r.success).toBe(true);
    expect(r.type).toBe("OPTIMAL_RECOVERY");
    const byPairing = new Map(r.data.assignments.map((a) => [a.pairingId, a]));
    expect(byPairing.get("P-2205")?.crewId).toBe("C-3305");
    expect(byPairing.get("P-2212")?.crewId).toBe("C-1017");
    expect(r.data.totalCost).toBe(graph.costs.reserveCalloutPilot + graph.costs.dayoffCalloutPilot);
  });
});

describe("H-shaped generalization (unseen combinations)", () => {
  it("H1-shaped: ATR First Officer sick call recovers legally", () => {
    const fo = graph.pairingById.get("P-2224")?.crew.find((m) => m.role === "First Officer")?.crewId ?? "";
    expect(fo).not.toBe("");
    const impact = analyzeDisruption(graph, {
      type: "SICK_CREW", crewId: fo, pairingId: "P-2224", reportedUtc: "2026-09-16T02:00:00Z",
    });
    expect(impact.success).toBe(true);
    if (impact.data.kind !== "crew") throw new Error("wrong kind");
    expect(impact.data.role).toBe("First Officer");
    const rec = findRecoveryOptions(graph, { pairingId: "P-2224", role: "First Officer", sickCrewId: fo });
    expect(rec.success).toBe(true);
    expect(rec.data.selected?.legality?.legal ?? rec.data.selected?.kind === "cancel").toBe(true);
    // ATR rating enforced on every cover option.
    for (const o of rec.data.ranked) {
      if (o.kind === "cover" && o.legality) {
        expect(o.legality.checks.find((c) => c.ruleId === "RULE-QUAL-05")?.passed).toBe(true);
      }
    }
  });

  it("H2-shaped: HYD closure identifies window-hit flights deterministically", () => {
    const evt = {
      type: "STATION_CLOSURE" as const, station: "HYD", startUtc: "2026-09-19T05:00:00Z", endUtc: "2026-09-19T09:00:00Z",
    };
    const a = analyzeDisruption(graph, evt);
    const b = analyzeDisruption(graph, evt);
    expect(a.success).toBe(true);
    if (a.data.kind !== "station" || b.data.kind !== "station") throw new Error("wrong kind");
    expect(a.data.affectedFlights.length).toBeGreaterThan(0);
    expect(a.data.affectedFlights).toEqual(b.data.affectedFlights);
    for (const fid of a.data.affectedFlights) {
      const f = graph.flightById.get(fid);
      const depHit = f?.depStation === "HYD" && (f?.depUtc ?? "") >= evt.startUtc && (f?.depUtc ?? "") < evt.endUtc;
      const arrHit = f?.arrStation === "HYD" && (f?.arrUtc ?? "") >= evt.startUtc && (f?.arrUtc ?? "") < evt.endUtc;
      expect(depHit || arrHit).toBe(true);
    }
  });
});

describe("getEvidence", () => {
  it("exposes rule evidence, values, and cost for an option", () => {
    const rec = findRecoveryOptions(graph, { pairingId: "P-2291", role: "Captain", sickCrewId: "C-1042" });
    const selected = rec.data.selected;
    expect(selected).toBeDefined();
    if (!selected) throw new Error("no selection");
    const e = getEvidenceForOption(selected);
    expect(e.success).toBe(true);
    expect(e.data.items.map((i) => i.ruleId)).toContain("RULE-DUTY-02");
    expect(e.data.items.some((i) => i.cost !== undefined)).toBe(true);
  });

  it("exposes joint-plan evidence with the total", () => {
    const r = optimizeRecovery(graph, {
      requests: [
        { pairingId: "P-2205", role: "Captain", sickCrewId: "C-3940" },
        { pairingId: "P-2212", role: "Captain", sickCrewId: "C-1938" },
      ],
    });
    const e = getEvidenceForJointPlan(r.data);
    expect(e.success).toBe(true);
    expect(e.data.items.some((i) => i.reason?.includes("joint total"))).toBe(true);
  });
});
