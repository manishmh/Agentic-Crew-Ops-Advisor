/**
 * Recovery-layer domain types (STEP 3).
 *
 * Disruptions are a discriminated union — never free-form strings —
 * carrying exactly what deterministic simulation needs. Results are
 * structured for later LLM consumption without recomputation.
 */

import type {
  CrewId,
  CrewRank,
  DateStr,
  Flight,
  FlightId,
  IsoUtc,
  Pairing,
  PairingId,
  StationCode,
} from "../domain/types.js";
import type { AssignmentLegality } from "../rules/assignment.js";
import type { CostBreakdown } from "./cost.js";

export type Disruption =
  | { type: "CREW_UNAVAILABLE"; crewId: CrewId; pairingId: PairingId; reportedUtc: IsoUtc }
  | { type: "FLIGHT_DELAY"; flightId: FlightId; delayMinutes: number }
  | { type: "STATION_CLOSURE"; station: StationCode; startUtc: IsoUtc; endUtc: IsoUtc }
  | { type: "CERT_INVALID"; crewId: CrewId; dutyDate: DateStr }
  | { type: "MULTI"; events: Disruption[] };

export interface CrewImpact {
  kind: "crew";
  crewId: CrewId;
  pairingId: PairingId;
  role: CrewRank;
  pairing: Pairing;
  /** All flights uncovered, in roster order. */
  flights: Flight[];
  dates: DateStr[];
}

export interface FlightShiftAssessment {
  flightId: FlightId;
  pairingId: PairingId;
  /** Minutes this flight's triggering op must move to clear the closure. */
  shiftMinutes: number;
  /** Rotation-level applied shift driving release extension. */
  appliedShiftMinutes: number;
  dutyHoursAfter: number;
  fdpLimitHours: number;
  fdpLegal: boolean;
}

export interface StationImpact {
  kind: "station";
  station: StationCode;
  startUtc: IsoUtc;
  endUtc: IsoUtc;
  affectedFlights: Flight[];
  assessments: FlightShiftAssessment[];
}

export interface CertImpactAssignment {
  pairingId: PairingId;
  dutyDate: DateStr;
  expired: string[];
}

export interface CertImpact {
  kind: "cert";
  crewId: CrewId;
  affected: CertImpactAssignment[];
}

export type Impact = CrewImpact | StationImpact | CertImpact;

/** One priced, legality-checked recovery option. */
export interface RecoveryOption {
  /** Undefined for the cancellation fallback. */
  crewId: CrewId | undefined;
  kind: "cover" | "cancel";
  pairingId: PairingId;
  role: CrewRank | undefined;
  legality: AssignmentLegality | undefined;
  cost: CostBreakdown;
  delayHours: number;
  affectedFlights: FlightId[];
  /** Adjusted day-1 report when timing shifts (deadhead/delay), else rostered. */
  adjustedReportUtc: IsoUtc | undefined;
  rank?: number;
}

export interface RecoveryPlan {
  disruption: Disruption;
  impact: Impact;
  /** Legal options, cheapest first. */
  ranked: RecoveryOption[];
  /** Illegal candidates with rule reasons. */
  rejected: Array<{ crewId: CrewId; reasons: string[] }>;
  selected: RecoveryOption | undefined;
  totalCost: number;
}
