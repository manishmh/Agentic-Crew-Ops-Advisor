/**
 * Unit tests for deterministic UTC temporal helpers (STEP 2B).
 * Pure arithmetic — no dataset needed except duty-period conventions.
 */

import { describe, expect, it } from "vitest";
import {
  addDays,
  addMinutes,
  blockMinutes,
  calendarDate,
  compareUtc,
  deriveReleaseUtc,
  deriveReportUtc,
  dutyPeriodHours,
  dutyPeriodMinutes,
  formatDurationMinutes,
  hoursBetween,
  isWithin,
  minutesBetween,
  parseDate,
  parseUtc,
  sameCalendarDay,
  timeOfDayUtc,
} from "../src/data/time.js";

describe("parsing", () => {
  it("parses UTC timestamps to epoch millis", () => {
    expect(parseUtc("2026-09-15T06:00:00Z")).toBe(Date.parse("2026-09-15T06:00:00Z"));
  });

  it("throws on invalid timestamps and dates", () => {
    expect(() => parseUtc("not-a-time")).toThrow();
    expect(() => parseDate("2026-13-45")).toThrow();
  });
});

describe("differences", () => {
  it("minutesBetween is exact", () => {
    expect(minutesBetween("2026-09-15T06:00:00Z", "2026-09-15T15:30:00Z")).toBe(570);
    expect(minutesBetween("2026-09-15T15:30:00Z", "2026-09-15T06:00:00Z")).toBe(-570);
  });

  it("hoursBetween is exact fractional", () => {
    expect(hoursBetween("2026-09-15T06:00:00Z", "2026-09-15T15:30:00Z")).toBe(9.5);
    expect(hoursBetween("2026-09-16T04:00:00Z", "2026-09-16T14:45:00Z")).toBe(10.75);
  });

  it("addMinutes rolls over day boundaries", () => {
    expect(addMinutes("2026-09-15T23:30:00Z", 60)).toBe("2026-09-16T00:30:00Z");
    expect(addMinutes("2026-09-15T07:00:00Z", -60)).toBe("2026-09-15T06:00:00Z");
  });

  it("addDays shifts calendar dates across month end", () => {
    expect(addDays("2026-09-14", 1)).toBe("2026-09-15");
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-09-15", -6)).toBe("2026-09-09");
  });

  it("compareUtc orders timestamps", () => {
    expect(compareUtc("2026-09-15T06:00:00Z", "2026-09-15T06:00:00Z")).toBe(0);
    expect(compareUtc("2026-09-15T05:59:00Z", "2026-09-15T06:00:00Z")).toBe(-1);
    expect(compareUtc("2026-09-16T00:00:00Z", "2026-09-15T06:00:00Z")).toBe(1);
  });
});

describe("calendar helpers", () => {
  it("calendarDate extracts the UTC date", () => {
    expect(calendarDate("2026-09-15T23:59:00Z")).toBe("2026-09-15");
  });

  it("sameCalendarDay uses UTC days", () => {
    expect(sameCalendarDay("2026-09-15T00:00:00Z", "2026-09-15T23:59:00Z")).toBe(true);
    expect(sameCalendarDay("2026-09-15T23:59:00Z", "2026-09-16T00:00:00Z")).toBe(false);
  });

  it("timeOfDayUtc extracts HH:MM", () => {
    expect(timeOfDayUtc("2026-09-15T06:00:00Z")).toBe("06:00");
  });

  it("isWithin is half-open [start, end)", () => {
    expect(isWithin("2026-09-15T06:00:00Z", "2026-09-15T06:00:00Z", "2026-09-15T18:00:00Z")).toBe(true);
    expect(isWithin("2026-09-15T18:00:00Z", "2026-09-15T06:00:00Z", "2026-09-15T18:00:00Z")).toBe(false);
  });
});

describe("formatting", () => {
  it("formatDurationMinutes is deterministic", () => {
    expect(formatDurationMinutes(720)).toBe("12h");
    expect(formatDurationMinutes(719)).toBe("11h59m");
    expect(formatDurationMinutes(45)).toBe("45m");
    expect(formatDurationMinutes(90)).toBe("1h30m");
    expect(() => formatDurationMinutes(1.5)).toThrow();
  });
});

describe("duty-period conventions", () => {
  it("report is first departure minus 60 minutes", () => {
    expect(deriveReportUtc("2026-09-15T07:00:00Z")).toBe("2026-09-15T06:00:00Z");
  });

  it("release is last arrival plus 30 minutes", () => {
    expect(deriveReleaseUtc("2026-09-15T15:00:00Z")).toBe("2026-09-15T15:30:00Z");
  });

  it("P-2291 day 1 derives its rostered report/release", () => {
    // DX412 dep 07:00 → report 06:00; DX588 arr 15:00 → release 15:30.
    expect(deriveReportUtc("2026-09-15T07:00:00Z")).toBe("2026-09-15T06:00:00Z");
    expect(deriveReleaseUtc("2026-09-15T15:00:00Z")).toBe("2026-09-15T15:30:00Z");
    expect(dutyPeriodMinutes("2026-09-15T06:00:00Z", "2026-09-15T15:30:00Z")).toBe(570);
    expect(dutyPeriodHours("2026-09-15T06:00:00Z", "2026-09-15T15:30:00Z")).toBe(9.5);
  });

  it("blockMinutes measures one leg", () => {
    expect(blockMinutes("2026-09-14T02:30:00Z", "2026-09-14T05:15:00Z")).toBe(165);
  });
});
