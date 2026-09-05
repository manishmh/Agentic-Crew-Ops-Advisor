/**
 * RULE-FLT-03 — max 100 block hours in any 28 consecutive calendar days (2E).
 *
 * Same calendar-day machinery as RULE-DUTY-02: daily_history flight_hours
 * plus rostered block hours plus the proposed assignment's block-hour
 * contribution per duty date.
 */

import type { DateStr, DutyDayEntry } from "../domain/types.js";
import { addDays, round2 } from "../data/time.js";
import type { RuleCheck, RuleViolation } from "./evidence.js";

export const FLIGHT_RULE_ID = "RULE-FLT-03";
export const FLIGHT_LIMIT_HOURS = 100;
export const FLIGHT_WINDOW_DAYS = 28;

import type { DateHours } from "./duty.js";

export interface FlightWindowEvidence {
  windowStart: DateStr;
  windowEnd: DateStr;
  totalHours: number;
  limitHours: number;
  remainingHours: number;
  legal: boolean;
}

export interface FlightHoursEvaluation {
  legal: boolean;
  evaluated: FlightWindowEvidence[];
  worst: FlightWindowEvidence | undefined;
  /** Trailing-28-day history baseline (pre-assignment). */
  currentHours28d: number;
  /** Block hours the proposed assignment adds across its duty dates. */
  proposedHours: number;
}

export interface CheckFlightHoursInput {
  history: readonly DutyDayEntry[];
  existing: DateHours;
  proposed: DateHours;
  limitHours?: number;
  windowDays?: number;
}

export function checkFlightHours(input: CheckFlightHoursInput): RuleCheck<FlightHoursEvaluation> {
  const limit = input.limitHours ?? FLIGHT_LIMIT_HOURS;
  const span = input.windowDays ?? FLIGHT_WINDOW_DAYS;
  const merged: DateHours = new Map();
  for (const day of input.history) merged.set(day.date, (merged.get(day.date) ?? 0) + day.flightHours);
  for (const [date, h] of input.existing) merged.set(date, (merged.get(date) ?? 0) + h);
  for (const [date, h] of input.proposed) merged.set(date, (merged.get(date) ?? 0) + h);

  const proposedDates = new Set(input.proposed.keys());
  const candidateEnds = new Set<string>([...input.existing.keys(), ...proposedDates]);
  const evaluated: FlightWindowEvidence[] = [];
  for (const end of [...candidateEnds].sort()) {
    const start = addDays(end, -(span - 1));
    let touchesProposed = false;
    for (const d of proposedDates) {
      if (d >= start && d <= end) {
        touchesProposed = true;
        break;
      }
    }
    if (!touchesProposed) continue;
    let total = 0;
    for (const [date, h] of merged) {
      if (date >= start && date <= end) total += h;
    }
    const legal = total <= limit + 1e-6;
    evaluated.push({
      windowStart: start,
      windowEnd: end,
      totalHours: round2(total),
      limitHours: limit,
      remainingHours: round2(limit - total),
      legal,
    });
  }

  const sortedHistory = [...input.history].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const currentHours28d = round2(sortedHistory.slice(-span).reduce((n, d) => n + d.flightHours, 0));
  const proposedHours = round2([...input.proposed.values()].reduce((n, h) => n + h, 0));

  let worst = evaluated.find((w) => !w.legal);
  if (!worst && evaluated.length > 0) {
    worst = evaluated.reduce((a, b) => (b.totalHours > a.totalHours ? b : a));
  }
  const legal = evaluated.every((w) => w.legal);
  return {
    ruleId: FLIGHT_RULE_ID,
    passed: legal,
    evidence: { legal, evaluated, worst, currentHours28d, proposedHours },
  };
}

export function flightHoursViolation(evidence: FlightHoursEvaluation): RuleViolation {
  const w = evidence.worst;
  return {
    ruleId: FLIGHT_RULE_ID,
    message: `${FLIGHT_RULE_ID} breached: ${w?.totalHours ?? 0}h exceeds ${FLIGHT_LIMIT_HOURS}h in ${w?.windowStart}..${w?.windowEnd}`,
    actual: w?.totalHours,
    limit: FLIGHT_LIMIT_HOURS,
    details: w ? { windowStart: w.windowStart, windowEnd: w.windowEnd } : undefined,
  };
}
