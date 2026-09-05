/**
 * Deadhead positioning primitive (STEP 3 §7).
 *
 * Dataset convention (README + rules.json): a DEL→BLR cover positions on
 * the day's DEL→BLR flight — DX402 (odd dates, arr 08:45Z) or DX589 (even
 * dates, arr 07:45Z). Resolved DATA-DRIVEN from flights.json (same-day
 * DEL→BLR flight, earliest arrival), never hardcoded:
 *   new report = positioning arrival + 15 min
 *   new first departure = new report + 60 min
 *   delay = max(0, new departure − scheduled first departure)
 * Cost (positioning + delay hours × rate) is computed in cost.ts from
 * costs.json. Candidates with no same-day positioning flight are
 * unreachable — mirroring the reference "no same-day positioning flight"
 * exclusion.
 */

import type { DateStr, FlightId, IsoUtc, StationCode } from "../domain/types.js";
import { addMinutes, minutesBetween, round2 } from "../data/time.js";
import type { OperationalGraph } from "../data/graph.js";

export interface DeadheadPlan {
  reachable: boolean;
  positioningFlightId?: FlightId;
  positioningArrUtc?: IsoUtc;
  /** Adjusted day-1 report (positioning arrival + 15 min). */
  newReportUtc?: IsoUtc;
  /** Adjusted first departure (new report + 60 min). */
  newFirstDepUtc?: IsoUtc;
  /** Hours the first departure moves (0 when same-base). */
  delayHours: number;
  reason?: string;
}

export function planDeadhead(
  g: OperationalGraph,
  candidateBase: StationCode,
  requiredBase: StationCode,
  dutyDate: DateStr,
  schedFirstDepUtc: IsoUtc,
): DeadheadPlan {
  if (candidateBase === requiredBase) {
    return { reachable: true, delayHours: 0 };
  }
  const options = (g.flightsByOrigin.get(candidateBase) ?? [])
    .filter((f) => f.arrStation === requiredBase && f.date === dutyDate)
    .sort((a, b) => (a.arrUtc < b.arrUtc ? -1 : a.arrUtc > b.arrUtc ? 1 : 0));
  if (options.length === 0) {
    return {
      reachable: false,
      delayHours: 0,
      reason: `RULE-BASE-07: no same-day positioning flight from ${candidateBase} to ${requiredBase} on ${dutyDate}`,
    };
  }
  const positioning = options[0];
  const newReportUtc = addMinutes(positioning.arrUtc, 15);
  const newFirstDepUtc = addMinutes(newReportUtc, 60);
  const delayHours = round2(Math.max(0, minutesBetween(schedFirstDepUtc, newFirstDepUtc) / 60));
  return {
    reachable: true,
    positioningFlightId: positioning.flightId,
    positioningArrUtc: positioning.arrUtc,
    newReportUtc,
    newFirstDepUtc,
    delayHours,
  };
}
