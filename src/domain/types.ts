/**
 * Canonical domain model for the dCortex Agentic Crew Ops Advisor.
 *
 * STEP 1 ONLY: pure types shaped exactly by the JSON structures in ./data/.
 * Source values are preserved verbatim — no normalization of suspicious
 * values (the dataset contains at least one deliberately illegal assignment;
 * legality is decided by later stages, not here).
 *
 * All operational timestamps are UTC ISO-8601 strings ending in "Z".
 * They are kept as strings (IsoUtc) so the original representation survives.
 */

// ---------------------------------------------------------------- IDs ----

export type CrewId = string;
export type FlightId = string;
export type PairingId = string;
export type StationCode = string;
export type RuleId = string;

/** UTC ISO-8601 timestamp as stored in the dataset, e.g. "2026-09-15T06:00:00Z". */
export type IsoUtc = string;
/** Calendar date as stored in the dataset, e.g. "2026-09-15". */
export type DateStr = string;

// -------------------------------------------------------------- unions ----
// Union members are derived from the actual dataset values (see data/*.json).

export type CrewRank =
  | "Captain"
  | "First Officer"
  | "Senior Cabin Crew"
  | "Cabin Crew";

export type CrewStatus = "active" | "leave" | "training";

export type AircraftType = "A320" | "ATR72";

export type CertificationType =
  | "licence"
  | "medical_class1"
  | "recurrent_training"
  | "dangerous_goods";

// ------------------------------------------------------------ entities ----

/** data/crew.json */
export interface Crew {
  crewId: CrewId;
  name: string;
  rank: CrewRank;
  base: StationCode;
  /** Aircraft types the crew member is rated on, e.g. ["A320"]. */
  ratings: AircraftType[];
  seniority: number;
  reachabilityMinutes: number;
  status: CrewStatus;
}

/** data/flights.json — one leg. */
export interface Flight {
  flightId: FlightId;
  flightNo: string;
  date: DateStr;
  depStation: StationCode;
  arrStation: StationCode;
  depUtc: IsoUtc;
  arrUtc: IsoUtc;
  blockHours: number;
  /** Tail number, e.g. "VT-DXA". */
  aircraft: string;
  aircraftType: AircraftType;
  seats: number;
}

/** One duty day inside a pairing. The nested day structure is preserved:
 *  a pairing is never flattened into unrelated day records. */
export interface PairingDay {
  date: DateStr;
  /** Flight IDs operating on this day, in order. */
  flights: FlightId[];
  reportUtc: IsoUtc;
  releaseUtc: IsoUtc;
}

/** A crew assignment onto a pairing. `role` mirrors CrewRank. */
export interface PairingCrewAssignment {
  crewId: CrewId;
  role: CrewRank;
}

/**
 * data/rosters.json → pairings[].
 * First-class operational entity: Crew is assigned to a Pairing, and the
 * Pairing contains Flights (NOT Crew → Flight directly), because a single
 * sick call can uncover a whole multi-day pairing.
 */
export interface Pairing {
  pairingId: PairingId;
  /** Tail number operating the pairing, e.g. "VT-DXC". */
  aircraft: string;
  days: PairingDay[];
  crew: PairingCrewAssignment[];
}

/** One row of the 28-day daily history in duty_clocks.json. */
export interface DutyDayEntry {
  date: DateStr;
  dutyHours: number;
  flightHours: number;
}

/** data/duty_clocks.json — one record per crew member. */
export interface DutyClock {
  crewId: CrewId;
  asOfUtc: IsoUtc;
  dutyHours7d: number;
  flightHours28d: number;
  lastRestEnded: IsoUtc;
  dailyHistory: DutyDayEntry[];
}

/** data/certifications.json — 4 records per crew member. */
export interface Certification {
  crewId: CrewId;
  certType: CertificationType;
  validFrom: DateStr;
  validTo: DateStr;
}

/** On-call window within a UTC calendar day, "HH:MM" strings preserved. */
export interface OnCallWindow {
  start: string;
  end: string;
}

/**
 * data/reserve_pool.json.
 * Rank is deliberately NOT stored here — resolve it later via
 * Reserve.crewId → Crew. No crew attributes are duplicated.
 */
export interface Reserve {
  crewId: CrewId;
  base: StationCode;
  dates: DateStr[];
  oncallWindowUtc: OnCallWindow;
  note?: string;
}

/** data/risk_signals.json — provided input scores, one per crew member. */
export interface RiskSignal {
  crewId: CrewId;
  asOfUtc: IsoUtc;
  disruptionRiskScore: number;
  drivers: string[];
}

/**
 * data/rules.json → rules[].
 * Rules are CONFIGURATION/DATA at this stage. No legality evaluation
 * (FDP, duty, flight hours, rest, qualification, certification, base)
 * is implemented here — that belongs to later steps.
 */
export interface Rule {
  ruleId: RuleId;
  text: string;
  /** Present on parameterised rules (FDP/DUTY/FLT/REST); absent otherwise. */
  params?: Record<string, number>;
}

/** data/costs.json */
export interface CostModel {
  currency: string;
  reserveCalloutPilot: number;
  reserveCalloutCabin: number;
  dayoffCalloutPilot: number;
  dayoffCalloutCabin: number;
  deadheadPositioning: number;
  delayCostPerDutyHour: number;
  cancellationPerFlight: number;
  hotelOvernight: number;
  notes: string;
}

/** data/rosters.json → flagged_exceptions[] (deliberately illegal roster). */
export interface FlaggedException {
  crewId: CrewId;
  date: DateStr;
  rule: RuleId;
  note: string;
}

// ------------------------------------------------- reference-only data ----
// Scenario and Question are reference/test data. They are typed for
// completeness but are NOT part of the operational graph.

/** data/scenarios.json — one worked scenario; answer_key shape varies. */
export interface Scenario {
  scenarioId: string;
  difficulty: string;
  title: string;
  event: ScenarioEvent;
  /** Computed answer key; structure varies per scenario — kept opaque. */
  answerKey: unknown;
}

export interface ScenarioEvent {
  type: string;
  crewId?: CrewId;
  pairingId?: PairingId;
  reportedUtc?: IsoUtc;
  narrative: string;
  [extra: string]: unknown;
}

/** data/questions.json — one question with its expected answer. */
export interface Question {
  questionId: string;
  tier: number;
  prompt: string;
  /** Expected answer; structure varies per question — kept opaque. */
  expectedAnswer: unknown;
  explanation?: string;
  rulesRef?: string[];
}
