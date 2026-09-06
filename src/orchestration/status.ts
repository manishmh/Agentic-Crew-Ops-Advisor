/**
 * getCrewStatus — read-only crew snapshot for the planner/explainer.
 * All figures come from Step-1 records; headroom numbers are plain
 * deterministic arithmetic in TS (never left to an LLM).
 */

import type { Certification, Crew, DateStr, DutyClock, Reserve, RiskSignal } from "../domain/types.js";
import type { OperationalGraph } from "../data/graph.js";
import { checkCertificationsOnDate } from "../rules/certification.js";
import { fail, ok, type EvidenceItem, type ToolResult } from "./types.js";

/** Dataset snapshot date: duty-clock history ends here. */
export const SNAPSHOT_DATE: DateStr = "2026-09-14";

export interface CrewStatusData {
  crew: Crew;
  pairings: Array<{ pairingId: string; role: string; dates: DateStr[] }>;
  dutyHours7d: number;
  dutyHeadroom7d: number;
  flightHours28d: number;
  flightHeadroom28d: number;
  ratings: string[];
  certifications: Array<{ certType: string; validFrom: string; validTo: string; validOnDate: boolean }>;
  reserve: Reserve | undefined;
  risk: RiskSignal | undefined;
  dutyClock: DutyClock | undefined;
}

export function getCrewStatus(
  g: OperationalGraph,
  crewId: string,
  asOfDate: DateStr = SNAPSHOT_DATE,
): ToolResult<CrewStatusData> {
  const crew = g.crewById.get(crewId);
  if (!crew) return fail("CREW_STATUS", `unknown crew ${crewId}`, `unknown crew ${crewId}`);

  const pairings = (g.pairingsByCrew.get(crewId) ?? []).map((p) => ({
    pairingId: p.pairingId,
    role: p.crew.find((a) => a.crewId === crewId)?.role ?? "",
    dates: p.days.map((d) => d.date),
  }));

  const clock = g.dutyClockByCrew.get(crewId);
  const dutyHours7d = clock?.dutyHours7d ?? 0;
  const flightHours28d = clock?.flightHours28d ?? 0;

  const certs: Certification[] = g.certificationsByCrew.get(crewId) ?? [];
  const certCheck = checkCertificationsOnDate(certs, asOfDate);

  const evidence: EvidenceItem[] = [
    { ruleId: "RULE-DUTY-02", passed: dutyHours7d <= 60, actual: dutyHours7d, limit: 60, crewId, reason: "7-day clock total vs 60h limit" },
    { ruleId: "RULE-FLT-03", passed: flightHours28d <= 100, actual: flightHours28d, limit: 100, crewId, reason: "28-day clock total vs 100h limit" },
    ...certCheck.evidence.certs.map((c) => ({
      ruleId: "RULE-CERT-06" as const,
      passed: c.valid,
      crewId,
      reason: `${c.certType} valid_to ${c.validTo} vs ${asOfDate}`,
    })),
  ];
  const risk = g.riskByCrew.get(crewId);
  if (risk) {
    evidence.push({ crewId, reason: `disruption risk ${risk.disruptionRiskScore}: ${risk.drivers.join("; ")}` });
  }

  return ok(
    "CREW_STATUS",
    `${crewId} (${crew.rank}, ${crew.base}): ${pairings.length} pairing(s), ${dutyHours7d}h/7d, ${flightHours28d}h/28d`,
    {
      crew,
      pairings,
      dutyHours7d,
      dutyHeadroom7d: Math.round((60 - dutyHours7d) * 100) / 100,
      flightHours28d,
      flightHeadroom28d: Math.round((100 - flightHours28d) * 100) / 100,
      ratings: [...crew.ratings],
      certifications: certCheck.evidence.certs.map((c) => {
        const src = certs.find((x) => x.certType === c.certType);
        return { certType: c.certType, validFrom: src?.validFrom ?? "", validTo: c.validTo, validOnDate: c.valid };
      }),
      reserve: g.reserveByCrew.get(crewId),
      risk,
      dutyClock: clock,
    },
    evidence,
  );
}
