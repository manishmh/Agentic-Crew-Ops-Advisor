/** Tier 2D — certification-expiry consequence analysis via locked engines. */

import { beforeAll, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { buildOperationalGraph, type OperationalGraph } from "../src/data/graph.js";
import { loadOperationalGraph, type LoadedGraph, type LoadedDataset } from "../src/data/loader.js";
import { checkCertificationsOnDate } from "../src/rules/certification.js";
import { analyzeDisruption, type CertificationExpiryData } from "../src/orchestration/disruptions.js";

const DATA_DIR = resolve(process.cwd(), "data");
let graph: OperationalGraph;
let dataset: LoadedDataset;

beforeAll(() => {
  const loaded: LoadedGraph = loadOperationalGraph(DATA_DIR);
  graph = loaded.graph;
  dataset = loaded.dataset;
});

function expiry(
  crewId: string,
  dutyDate: string,
  certificationType?: string,
  target: OperationalGraph = graph,
): CertificationExpiryData {
  const result = analyzeDisruption(target, { type: "CERT_EXPIRY", crewId, dutyDate, certificationType });
  expect(result.success).toBe(true);
  if (!result.success || result.data.kind !== "cert") throw new Error("expected certification analysis");
  return result.data;
}

describe("Tier 2D — CERT_EXPIRY consequence analysis", () => {
  it("resolves an arbitrary requested certification and inspects every relevant assignment", () => {
    const data = expiry("C-5417", "2026-09-16", "recurrent_training");
    expect(data.certificationType).toBe("recurrent_training");
    expect(data.inspectedAssignments.map((item) => item.pairingId)).toEqual(["P-2210", "P-2213"]);
    expect(data.affected.map((item) => item.pairingId)).toEqual(["P-2213"]);
    expect(data.affected[0]).toMatchObject({ role: "Cabin Crew", aircraftTypes: ["A320"] });
  });

  it("keeps the day before and exact valid-to date valid, then fails after expiry", () => {
    const certs = graph.certificationsByCrew.get("C-5417")?.filter((cert) => cert.certType === "recurrent_training") ?? [];
    expect(checkCertificationsOnDate(certs, "2026-09-16").passed).toBe(true);
    expect(checkCertificationsOnDate(certs, "2026-09-17").passed).toBe(true);
    expect(checkCertificationsOnDate(certs, "2026-09-18").passed).toBe(false);

    const data = expiry("C-5417", "2026-09-16");
    expect(data.inspectedAssignments.find((item) => item.dutyDate === "2026-09-16")?.certificationLegal).toBe(true);
    expect(data.inspectedAssignments.find((item) => item.dutyDate === "2026-09-19")?.certificationLegal).toBe(false);
  });

  it("exposes RULE-CERT-06 evidence with validity, duty, crew, pairing, and flights", () => {
    const result = analyzeDisruption(graph, { type: "CERT_EXPIRY", crewId: "C-5417", dutyDate: "2026-09-16" });
    if (!result.success || result.data.kind !== "cert") throw new Error("expected certification analysis");
    const evidence = result.evidence.find((item) => item.ruleId === "RULE-CERT-06" && item.passed === false && item.details?.certificationType === "recurrent_training");
    expect(evidence).toMatchObject({ crewId: "C-5417", pairingId: "P-2213" });
    expect(evidence?.details).toMatchObject({ validTo: "2026-09-17", dutyDate: "2026-09-19", flightIds: expect.any(Array) });
  });

  it("keeps aircraft rating and certification legality as distinct rule dimensions", () => {
    const data = expiry("C-5417", "2026-09-16");
    const violations = data.affected[0]?.legality.violations.map((item) => item.ruleId) ?? [];
    expect(graph.crewById.get("C-5417")?.ratings).toContain("A320");
    expect(violations).toContain("RULE-CERT-06");
    expect(violations).not.toContain("RULE-QUAL-05");
  });

  it("generates deterministic legal recovery and cancellation fallback from existing primitives", () => {
    const data = expiry("C-5417", "2026-09-16");
    const affected = data.affected[0];
    expect(affected?.recoveryRequired).toBe(true);
    expect(affected?.recoveryAvailable).toBe(true);
    expect(affected?.recovery.ranked.some((option) => option.kind === "cover" && option.legality?.legal)).toBe(true);
    expect(affected?.cancellationFallback.cost.total).toBe(
      affected?.cancellationFallback.cost.components.reduce((total, component) => total + component.amount, 0),
    );
  });

  it("retains deterministic rule rejections from replacement filtering", () => {
    const data = expiry("C-5417", "2026-09-16");
    const rejected = data.affected[0]?.recovery.rejected ?? [];
    expect(rejected.length).toBeGreaterThan(0);
    expect(rejected.some((candidate) => candidate.violations.length > 0)).toBe(true);
  });

  it("makes no-recovery explicit and prices the engine cancellation fallback", () => {
    const invalidCabinCerts = dataset.certifications.map((cert) => {
      const owner = dataset.crews.find((crew) => crew.crewId === cert.crewId);
      return owner?.rank === "Cabin Crew" ? { ...cert, validTo: "2026-09-01" } : cert;
    });
    const noCoverGraph = buildOperationalGraph({ ...dataset, certifications: invalidCabinCerts });
    const data = expiry("C-5417", "2026-09-16", undefined, noCoverGraph);
    const affected = data.affected[0];
    expect(affected?.recoveryRequired).toBe(true);
    expect(affected?.recoveryAvailable).toBe(false);
    expect(affected?.reason).toContain("No legal replacement crew found");
    expect(affected?.recovery.rejected.some((candidate) => candidate.violations.some((violation) => violation.ruleId === "RULE-CERT-06"))).toBe(true);
    expect(affected?.cancellationFallback.cost.total).toBe(
      affected?.cancellationFallback.flightIds.length * noCoverGraph.costs.cancellationPerFlight,
    );
  });

  it("reproduces the C-5417-shaped and flagged recurrent-training case through generic logic", () => {
    const data = expiry("C-5417", "2026-09-16", "recurrent_training");
    expect(data.affected).toHaveLength(1);
    expect(data.affected[0]?.expired).toEqual(["recurrent_training"]);
    expect(data.affected[0]?.flightIds).toHaveLength(4);
  });

  it("is deterministic and does not mutate the operational graph", () => {
    const before = JSON.stringify([graph.crews, graph.pairings, graph.certifications]);
    const event = { type: "CERT_EXPIRY" as const, crewId: "C-5417", dutyDate: "2026-09-16", certificationType: "recurrent_training" };
    expect(analyzeDisruption(graph, event)).toEqual(analyzeDisruption(graph, event));
    expect(JSON.stringify([graph.crews, graph.pairings, graph.certifications])).toBe(before);
  });

  it("fails cleanly for unknown crew and unknown certification", () => {
    const unknownCrew = analyzeDisruption(graph, { type: "CERT_EXPIRY", crewId: "C-0000", dutyDate: "2026-09-16" });
    const unknownCertification = analyzeDisruption(graph, {
      type: "CERT_EXPIRY", crewId: "C-5417", dutyDate: "2026-09-16", certificationType: "not-a-cert",
    });
    expect(unknownCrew.success).toBe(false);
    expect(unknownCrew.error).toContain("unknown crew C-0000");
    expect(unknownCertification.success).toBe(false);
    expect(unknownCertification.error).toContain("unknown certification not-a-cert");
  });
});
