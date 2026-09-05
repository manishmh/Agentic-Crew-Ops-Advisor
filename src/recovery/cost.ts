/**
 * Deterministic recovery cost calculation (STEP 3 §8).
 *
 * Every rate comes from costs.json via the loaded CostModel — no rupee
 * amount is hardcoded. Returns a breakdown, never just a total, so the
 * future explainer can justify each rupee.
 */

import type { CostModel, Crew } from "../domain/types.js";
import { round2 } from "../data/time.js";

export type CostComponentType =
  | "reserve_callout"
  | "dayoff_callout"
  | "deadhead"
  | "delay"
  | "cancellation"
  | "hotel";

export interface CostComponent {
  type: CostComponentType;
  amount: number;
  detail?: string;
}

export interface CostBreakdown {
  currency: string;
  total: number;
  components: CostComponent[];
}

/** Captains and First Officers price as pilots; cabin roles as cabin. */
export function isPilot(crew: Crew): boolean {
  return crew.rank === "Captain" || crew.rank === "First Officer";
}

export function calloutComponent(crew: Crew, kind: "reserve" | "dayoff", costs: CostModel): CostComponent {
  const pilot = isPilot(crew);
  const amount =
    kind === "reserve"
      ? pilot
        ? costs.reserveCalloutPilot
        : costs.reserveCalloutCabin
      : pilot
        ? costs.dayoffCalloutPilot
        : costs.dayoffCalloutCabin;
  return { type: kind === "reserve" ? "reserve_callout" : "dayoff_callout", amount, detail: `${crew.rank} ${crew.crewId}` };
}

export function deadheadComponent(costs: CostModel): CostComponent {
  return { type: "deadhead", amount: costs.deadheadPositioning };
}

/** delay_hours (rostered→adjusted first departure) × delay_cost_per_duty_hour. */
export function delayComponent(delayHours: number, costs: CostModel): CostComponent {
  const hours = round2(Math.max(0, delayHours));
  return { type: "delay", amount: Math.round(hours * costs.delayCostPerDutyHour), detail: `${hours}h × ${costs.delayCostPerDutyHour}` };
}

export function cancellationComponent(flightCount: number, costs: CostModel): CostComponent {
  return {
    type: "cancellation",
    amount: flightCount * costs.cancellationPerFlight,
    detail: `${flightCount} flight(s) × ${costs.cancellationPerFlight}`,
  };
}

export function hotelComponent(nights: number, costs: CostModel): CostComponent {
  return { type: "hotel", amount: nights * costs.hotelOvernight, detail: `${nights} night(s) × ${costs.hotelOvernight}` };
}

export function breakdown(costs: CostModel, components: CostComponent[]): CostBreakdown {
  return {
    currency: costs.currency,
    total: components.reduce((n, c) => n + c.amount, 0),
    components,
  };
}

/** Full cover price: callout + optional deadhead positioning + delay. */
export function priceCover(
  crew: Crew,
  kind: "reserve" | "dayoff",
  costs: CostModel,
  opts: { deadhead?: boolean; delayHours?: number } = {},
): CostBreakdown {
  const components: CostComponent[] = [calloutComponent(crew, kind, costs)];
  if (opts.deadhead) components.push(deadheadComponent(costs));
  if (opts.delayHours !== undefined && opts.delayHours > 0) {
    components.push(delayComponent(opts.delayHours, costs));
  }
  return breakdown(costs, components);
}
