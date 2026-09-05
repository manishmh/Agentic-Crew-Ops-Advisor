/**
 * RULE-DUTY-02 — max 60 duty hours in any 7 consecutive CALENDAR days (2D).
 *
 * This is NOT a rolling 168-hour window: calendar dates aggregate first,
 * then every 7-day date range [end−6, end] is summed. History comes from
 * duty_clocks.json daily_history; rostered duty from the graph; proposed
 * duty from the hypothetical assignment.
 *
 * Window-end enumeration matches validate.py: a window can only breach
 * because of the new assignment, so only windows whose range intersects a
 * proposed duty date are evaluated (all hours are non-negative, so any
 * window containing proposed duty is dominated by one ending on a duty
 * date within range — existing and proposed duty dates are both used as
 * candidate ends).
 */

import type { DateStr, DutyDayEntry } from "../domain/types.js";
import { addDays, round2 } from "../data/time.js";
import type { RuleCheck, RuleViolation } from "./evidence.js";

export const DUTY_RULE_ID = "RULE-DUTY-02";
export const DUTY_LIMIT_HOURS = 60;
export const DUTY_WINDOW_DAYS = 7;

/** Calendar date → hours on that date. */
export type DateHours = Map<DateStr, number>;

export interface DutyWindowEvidence {
  windowStart: DateStr;
  windowEnd: DateStr;
  totalHours: number;
  limitHours: number;
  remainingHours: number;
  legal: boolean;
}

export interface DutyEvaluation {
  legal: boolean;
  /** Every evaluated 7-day window (only those touching proposed duty). */
  evaluated: DutyWindowEvidence[];
  worst: DutyWindowEvidence | undefined;
  /** Sum of the trailing 7 history days (pre-assignment baseline). */
  currentHours7d: number;
}

/** Merge history + existing roster + proposed assignment into one date map. */
export function mergeDutyMaps(
  history: readonly DutyDayEntry[],
  existing: DateHours,
  proposed: DateHours,
): DateHours {
  const merged: DateHours = new Map();
  for (const day of history) merged.set(day.date, (merged.get(day.date) ?? 0) + day.dutyHours);
  for (const [date, h] of existing) merged.set(date, (merged.get(date) ?? 0) + h);
  for (const [date, h] of proposed) merged.set(date, (merged.get(date) ?? 0) + h);
  return merged;
}

/** Sum hours over the closed calendar range [start, end] (YYYY-MM-DD compares lexically). */
export function sumDateRange(merged: DateHours, start: DateStr, end: DateStr): number {
  let total = 0;
  for (const [date, h] of merged) {
    if (date >= start && date <= end) total += h;
  }
  return total;
}

export interface CheckDutyWindowsInput {
  history: readonly DutyDayEntry[];
  existing: DateHours;
  proposed: DateHours;
  limitHours?: number;
  windowDays?: number;
}

export function checkDutyWindows(input: CheckDutyWindowsInput): RuleCheck<DutyEvaluation> {
  const limit = input.limitHours ?? DUTY_LIMIT_HOURS;
  const span = input.windowDays ?? DUTY_WINDOW_DAYS;
  const merged = mergeDutyMaps(input.history, input.existing, input.proposed);

  const proposedDates = new Set(input.proposed.keys());
  const candidateEnds = new Set<string>([...input.existing.keys(), ...proposedDates]);
  const evaluated: DutyWindowEvidence[] = [];
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
    const total = sumDateRange(merged, start, end);
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
  const currentHours7d = round2(sortedHistory.slice(-span).reduce((n, d) => n + d.dutyHours, 0));

  let worst = evaluated.find((w) => !w.legal);
  if (!worst && evaluated.length > 0) {
    worst = evaluated.reduce((a, b) => (b.totalHours > a.totalHours ? b : a));
  }
  const legal = evaluated.every((w) => w.legal);
  return {
    ruleId: DUTY_RULE_ID,
    passed: legal,
    evidence: { legal, evaluated, worst, currentHours7d },
  };
}

export function dutyViolation(evidence: DutyEvaluation): RuleViolation {
  const w = evidence.worst;
  return {
    ruleId: DUTY_RULE_ID,
    message: `${DUTY_RULE_ID} breached: ${w?.totalHours ?? 0}h exceeds ${DUTY_LIMIT_HOURS}h in ${w?.windowStart}..${w?.windowEnd}`,
    actual: w?.totalHours,
    limit: DUTY_LIMIT_HOURS,
    details: w ? { windowStart: w.windowStart, windowEnd: w.windowEnd } : undefined,
  };
}
