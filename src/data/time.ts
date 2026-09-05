/**
 * Deterministic UTC temporal utilities (STEP 2).
 *
 * The canonical model keeps original ISO UTC strings; these helpers are the
 * ONLY place time math happens, so later reasoning (and eventually the LLM
 * layer) never computes durations itself.
 *
 * Conventions (from the dataset README / rules.json definitions):
 *   report  = first departure − 60 minutes
 *   release = last arrival + 30 minutes
 *   duty period = report → release; FDP = duty period length.
 *
 * Arithmetic is exact: timestamps resolve to integer epoch millis and all
 * comparisons derive from those — no fuzzy parsing, no local time.
 */

import type { DateStr, IsoUtc } from "../domain/types.js";

/** Parse an ISO UTC timestamp to epoch millis. Throws on invalid input. */
export function parseUtc(iso: IsoUtc): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`Invalid UTC timestamp: ${iso}`);
  return ms;
}

/** Parse a "YYYY-MM-DD" calendar date to epoch millis at 00:00Z. */
export function parseDate(d: DateStr): number {
  const ms = Date.parse(`${d}T00:00:00Z`);
  if (Number.isNaN(ms)) throw new Error(`Invalid calendar date: ${d}`);
  return ms;
}

/** Exact minutes from `a` to `b` (fractional when seconds are present). */
export function minutesBetween(a: IsoUtc, b: IsoUtc): number {
  return (parseUtc(b) - parseUtc(a)) / 60_000;
}

/** Exact fractional hours from `a` to `b`. */
export function hoursBetween(fromUtc: IsoUtc, toUtc: IsoUtc): number {
  return (parseUtc(toUtc) - parseUtc(fromUtc)) / 3_600_000;
}

/** Shift a timestamp by whole minutes, preserving ISO UTC form. */
export function addMinutes(ts: IsoUtc, minutes: number): IsoUtc {
  return new Date(parseUtc(ts) + minutes * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Shift a calendar date by whole days. */
export function addDays(d: DateStr, days: number): DateStr {
  const t = new Date(parseDate(d));
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/** Compare two ISO UTC timestamps: -1 | 0 | 1. */
export function compareUtc(a: IsoUtc, b: IsoUtc): number {
  const x = parseUtc(a);
  const y = parseUtc(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Calendar date ("YYYY-MM-DD") of a UTC timestamp. */
export function calendarDate(ts: IsoUtc): DateStr {
  return new Date(parseUtc(ts)).toISOString().slice(0, 10);
}

/** True when both timestamps fall on the same UTC calendar day. */
export function sameCalendarDay(a: IsoUtc, b: IsoUtc): boolean {
  return calendarDate(a) === calendarDate(b);
}

/** "HH:MM" time-of-day of a UTC timestamp. */
export function timeOfDayUtc(ts: IsoUtc): string {
  return new Date(parseUtc(ts)).toISOString().slice(11, 16);
}

/**
 * Deterministic duration formatting: 90 → "1h30m", 45 → "45m", 720 → "12h".
 * Input is whole minutes; throws on fractional input.
 */
export function formatDurationMinutes(totalMinutes: number): string {
  if (!Number.isInteger(totalMinutes) || totalMinutes < 0) {
    throw new Error(`formatDurationMinutes expects non-negative integer minutes, got ${totalMinutes}`);
  }
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, "0")}m`;
}

/** Round to 2 decimals for stable evidence (legality itself uses exact values). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ------------------------------------------------- duty-period helpers ----

/** report = first departure − 60 minutes. */
export function deriveReportUtc(firstDepartureUtc: IsoUtc): IsoUtc {
  return addMinutes(firstDepartureUtc, -60);
}

/** release = last arrival + 30 minutes. */
export function deriveReleaseUtc(lastArrivalUtc: IsoUtc): IsoUtc {
  return addMinutes(lastArrivalUtc, 30);
}

/** Exact duty-period minutes from report to release. */
export function dutyPeriodMinutes(reportUtc: IsoUtc, releaseUtc: IsoUtc): number {
  return minutesBetween(reportUtc, releaseUtc);
}

/** Exact duty-period (FDP) hours from report to release. */
export function dutyPeriodHours(reportUtc: IsoUtc, releaseUtc: IsoUtc): number {
  return hoursBetween(reportUtc, releaseUtc);
}

/** Exact block minutes of one flight leg. */
export function blockMinutes(depUtc: IsoUtc, arrUtc: IsoUtc): number {
  return minutesBetween(depUtc, arrUtc);
}

/** True when `t` falls in the half-open range [startUtc, endUtc). */
export function isWithin(t: IsoUtc, startUtc: IsoUtc, endUtc: IsoUtc): boolean {
  return parseUtc(t) >= parseUtc(startUtc) && parseUtc(t) < parseUtc(endUtc);
}
