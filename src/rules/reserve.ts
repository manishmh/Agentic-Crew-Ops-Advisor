/**
 * RULE-BASE-07 — reserve callout validity (2I).
 *
 * A reserve is usable when:
 *  - a reserve_pool record exists for the crew,
 *  - the crew status is active,
 *  - every duty date of the proposed pairing is in the reserve's dates,
 *  - the required report time falls inside the on-call window
 *    ("HH:MM" wall-clock, wrap-safe),
 * and the callout is flagged requiresDeadhead when the reserve's base
 * differs from the pairing's operating base (first departure station).
 * Cross-base callouts remain possible via deadhead positioning; the
 * deadhead-adjusted report time itself is Step-3 work (the window is
 * evaluated against the rostered report and flagged accordingly).
 *
 * Rank is resolved via Reserve.crewId → Crew (never stored on Reserve).
 */

import type { CrewId, IsoUtc, PairingId } from "../domain/types.js";
import { timeOfDayUtc } from "../data/time.js";
import { getFlightsForPairing, type OperationalGraph } from "../data/graph.js";
import type { RuleCheck } from "./evidence.js";

export const BASE_RULE_ID = "RULE-BASE-07";

export interface OnCallEvaluation {
  reportTime: string;
  windowStart: string;
  windowEnd: string;
  inside: boolean;
}

export interface ReserveCalloutEvidence {
  ruleId: typeof BASE_RULE_ID;
  eligible: boolean;
  hasReserveRecord: boolean;
  crewActive: boolean;
  datesCovered: boolean;
  missingDates: string[];
  window: OnCallEvaluation | undefined;
  reserveBase: string | undefined;
  pairingBase: string | undefined;
  requiresDeadhead: boolean;
  /** True when the report used predates deadhead positioning (Step 3). */
  windowPendingDeadhead: boolean;
  reasons: string[];
}

/** Minutes since midnight for "HH:MM". */
function hhmmToMinutes(s: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (!m) throw new Error(`Invalid HH:MM wall time: ${s}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Wrap-safe containment: end <= start means the window spans midnight. */
export function isTimeInWindow(reportTime: string, windowStart: string, windowEnd: string): boolean {
  const t = hhmmToMinutes(reportTime);
  const s = hhmmToMinutes(windowStart);
  const e = hhmmToMinutes(windowEnd);
  if (e <= s) return t >= s || t <= e;
  return t >= s && t <= e;
}

export interface CheckReserveCalloutInput {
  requiredReportUtc?: IsoUtc;
}

export function checkReserveCallout(
  g: OperationalGraph,
  crewId: CrewId,
  pairingId: PairingId,
  input: CheckReserveCalloutInput = {},
): RuleCheck<ReserveCalloutEvidence> {
  const reasons: string[] = [];
  const pairing = g.pairingById.get(pairingId);
  if (!pairing) throw new Error(`checkReserveCallout: unknown pairing ${pairingId}`);
  const crew = g.crewById.get(crewId);
  if (!crew) throw new Error(`checkReserveCallout: unknown crew ${crewId}`);

  const reserve = g.reserveByCrew.get(crewId);
  const hasReserveRecord = reserve !== undefined;
  if (!hasReserveRecord) reasons.push(`${crewId} has no reserve_pool record`);

  const crewActive = crew.status === "active";
  if (!crewActive) reasons.push(`${crewId} status is ${crew.status}, not active`);

  const dutyDates = pairing.days.map((d) => d.date);
  const missingDates = reserve ? dutyDates.filter((d) => !reserve.dates.includes(d)) : [...dutyDates];
  const datesCovered = missingDates.length === 0;
  if (!datesCovered) reasons.push(`reserve dates miss ${missingDates.join(", ")}`);

  const firstFlights = getFlightsForPairing(g, pairingId);
  const pairingBase = firstFlights.length > 0 ? firstFlights[0].depStation : undefined;
  const requiresDeadhead =
    reserve !== undefined && pairingBase !== undefined && reserve.base !== pairingBase;
  if (requiresDeadhead) {
    reasons.push(`reserve base ${reserve?.base} differs from pairing base ${pairingBase} (deadhead required)`);
  }

  const requiredReport = input.requiredReportUtc ?? pairing.days[0]?.reportUtc;
  let window: OnCallEvaluation | undefined;
  let windowOk = false;
  if (reserve && requiredReport) {
    const reportTime = timeOfDayUtc(requiredReport);
    const inside = isTimeInWindow(reportTime, reserve.oncallWindowUtc.start, reserve.oncallWindowUtc.end);
    window = {
      reportTime,
      windowStart: reserve.oncallWindowUtc.start,
      windowEnd: reserve.oncallWindowUtc.end,
      inside,
    };
    windowOk = inside;
    if (!inside) {
      reasons.push(
        `required report ${reportTime}Z outside on-call window ${reserve.oncallWindowUtc.start}–${reserve.oncallWindowUtc.end}`,
      );
    }
  } else if (!requiredReport) {
    reasons.push("pairing has no days, cannot determine required report");
  }

  const eligible = hasReserveRecord && crewActive && datesCovered && windowOk;
  return {
    ruleId: BASE_RULE_ID,
    passed: eligible,
    evidence: {
      ruleId: BASE_RULE_ID,
      eligible,
      hasReserveRecord,
      crewActive,
      datesCovered,
      missingDates,
      window,
      reserveBase: reserve?.base,
      pairingBase,
      requiresDeadhead,
      windowPendingDeadhead: requiresDeadhead,
      reasons,
    },
  };
}
