/**
 * Hypothetical timing overlay (Step-2 clean extension for Step 3).
 *
 * Lets the deterministic legality engine evaluate shifted/delayed duties
 * WITHOUT mutating canonical graph objects: overrides are keyed lookups
 * consulted at resolution time. Absent keys fall back to rostered values,
 * so existing Step-2 behavior is bit-for-bit unchanged when no overlay
 * is supplied.
 */

import type { DateStr, FlightId, IsoUtc, PairingId } from "../domain/types.js";

export interface DayWindowOverride {
  reportUtc: IsoUtc;
  releaseUtc: IsoUtc;
}

export interface FlightTimeOverride {
  depUtc: IsoUtc;
  arrUtc: IsoUtc;
}

export interface TimingOverlay {
  dayWindows?: ReadonlyMap<string, DayWindowOverride>;
  flightTimes?: ReadonlyMap<FlightId, FlightTimeOverride>;
}

/** Overlay key for one pairing duty day. */
export function dayWindowKey(pairingId: PairingId, date: DateStr): string {
  return `${pairingId}|${date}`;
}
