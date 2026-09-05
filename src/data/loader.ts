/**
 * Dataset loader (STEP 1).
 *
 * Reads JSON files from ./data/, converts them 1:1 into the canonical
 * domain types, and builds the operational graph. Source values are
 * preserved verbatim — nothing is "fixed" or normalized away.
 *
 * Loading (read/parse/convert) is kept separate from graph construction
 * (buildOperationalGraph in graph.ts).
 */

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  Certification,
  CostModel,
  Crew,
  DutyClock,
  FlaggedException,
  Flight,
  Pairing,
  Question,
  Reserve,
  RiskSignal,
  Rule,
  Scenario,
} from "../domain/types.js";
import { buildOperationalGraph, type OperationalGraph } from "./graph.js";

export interface LoadedDataset {
  crews: Crew[];
  flights: Flight[];
  pairings: Pairing[];
  flaggedExceptions: FlaggedException[];
  dutyClocks: DutyClock[];
  certifications: Certification[];
  reserves: Reserve[];
  riskSignals: RiskSignal[];
  rules: Rule[];
  timeConvention: string;
  /** rules.json → definitions (duty_period, fdp, sector, reserve_callout). */
  ruleDefinitions: Record<string, string>;
  costs: CostModel;
  /** rosters.json top-level note, when present. */
  rostersNote?: string;
  /** Reference/test data only — NOT part of the operational graph. */
  scenarios: Scenario[];
  /** Reference/test data only — NOT part of the operational graph. */
  questions: Question[];
}

function readJson(dataDir: string, name: string): unknown {
  const path = join(dataDir, name);
  if (!existsSync(path)) throw new Error(`Dataset file not found: ${path}`);
  return JSON.parse(readFileSync(path, "utf-8"));
}

function mustBeArray(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Expected ${name} to be a JSON array`);
  return value;
}

/** Assert a field exists; returns it typed as unknown for explicit mapping. */
function field(obj: Record<string, unknown>, key: string, ctx: string): unknown {
  if (!(key in obj) || obj[key] === undefined || obj[key] === null) {
    throw new Error(`Missing field "${key}" in ${ctx}`);
  }
  return obj[key];
}

const asString = (v: unknown, ctx: string): string => {
  if (typeof v !== "string") throw new Error(`Expected string in ${ctx}`);
  return v;
};
const asNumber = (v: unknown, ctx: string): number => {
  if (typeof v !== "number") throw new Error(`Expected number in ${ctx}`);
  return v;
};
const asStringArray = (v: unknown, ctx: string): string[] => {
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) {
    throw new Error(`Expected string[] in ${ctx}`);
  }
  return v as string[];
};

/** Narrow a string to a closed union; throws on unknown members. */
function asUnion<T extends string>(v: unknown, allowed: readonly T[], ctx: string): T {
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) {
    throw new Error(`Expected one of [${allowed.join(", ")}] in ${ctx}, got ${JSON.stringify(v)}`);
  }
  return v as T;
}

const CREW_RANKS = ["Captain", "First Officer", "Senior Cabin Crew", "Cabin Crew"] as const;
const CREW_STATUSES = ["active", "leave", "training"] as const;
const AIRCRAFT_TYPES = ["A320", "ATR72"] as const;
const CERT_TYPES = ["licence", "medical_class1", "recurrent_training", "dangerous_goods"] as const;

// ------------------------------------------------------------- mappers ----
// Each mapper is a strict 1:1 field rename (snake_case → camelCase) that
// preserves every source value exactly.

function toCrew(raw: unknown): Crew {
  const o = raw as Record<string, unknown>;
  const ctx = `crew ${String(o["crew_id"] ?? "?")}`;
  return {
    crewId: asString(field(o, "crew_id", ctx), ctx),
    name: asString(field(o, "name", ctx), ctx),
    rank: asUnion(field(o, "rank", ctx), CREW_RANKS, ctx),
    base: asString(field(o, "base", ctx), ctx),
    ratings: asStringArray(field(o, "ratings", ctx), ctx).map((r) => asUnion(r, AIRCRAFT_TYPES, ctx)),
    seniority: asNumber(field(o, "seniority", ctx), ctx),
    reachabilityMinutes: asNumber(field(o, "reachability_minutes", ctx), ctx),
    status: asUnion(field(o, "status", ctx), CREW_STATUSES, ctx),
  };
}

function toFlight(raw: unknown): Flight {
  const o = raw as Record<string, unknown>;
  const ctx = `flight ${String(o["flight_id"] ?? "?")}`;
  return {
    flightId: asString(field(o, "flight_id", ctx), ctx),
    flightNo: asString(field(o, "flight_no", ctx), ctx),
    date: asString(field(o, "date", ctx), ctx),
    depStation: asString(field(o, "dep_station", ctx), ctx),
    arrStation: asString(field(o, "arr_station", ctx), ctx),
    depUtc: asString(field(o, "dep_utc", ctx), ctx),
    arrUtc: asString(field(o, "arr_utc", ctx), ctx),
    blockHours: asNumber(field(o, "block_hours", ctx), ctx),
    aircraft: asString(field(o, "aircraft", ctx), ctx),
    aircraftType: asUnion(field(o, "aircraft_type", ctx), AIRCRAFT_TYPES, ctx),
    seats: asNumber(field(o, "seats", ctx), ctx),
  };
}

function toPairing(raw: unknown): Pairing {
  const o = raw as Record<string, unknown>;
  const ctx = `pairing ${String(o["pairing_id"] ?? "?")}`;
  const days = mustBeArray(field(o, "days", ctx), `${ctx}.days`).map((d) => {
    const day = d as Record<string, unknown>;
    return {
      date: asString(field(day, "date", ctx), ctx),
      flights: asStringArray(field(day, "flights", ctx), ctx),
      reportUtc: asString(field(day, "report_utc", ctx), ctx),
      releaseUtc: asString(field(day, "release_utc", ctx), ctx),
    };
  });
  const crew = mustBeArray(field(o, "crew", ctx), `${ctx}.crew`).map((m) => {
    const mem = m as Record<string, unknown>;
    return {
      crewId: asString(field(mem, "crew_id", ctx), ctx),
      role: asUnion(field(mem, "role", ctx), CREW_RANKS, ctx),
    };
  });
  return {
    pairingId: asString(field(o, "pairing_id", ctx), ctx),
    aircraft: asString(field(o, "aircraft", ctx), ctx),
    days,
    crew,
  };
}

function toDutyClock(raw: unknown): DutyClock {
  const o = raw as Record<string, unknown>;
  const ctx = `duty_clock ${String(o["crew_id"] ?? "?")}`;
  const dailyHistory = mustBeArray(field(o, "daily_history", ctx), `${ctx}.daily_history`).map((d) => {
    const day = d as Record<string, unknown>;
    return {
      date: asString(field(day, "date", ctx), ctx),
      dutyHours: asNumber(field(day, "duty_hours", ctx), ctx),
      flightHours: asNumber(field(day, "flight_hours", ctx), ctx),
    };
  });
  return {
    crewId: asString(field(o, "crew_id", ctx), ctx),
    asOfUtc: asString(field(o, "as_of_utc", ctx), ctx),
    dutyHours7d: asNumber(field(o, "duty_hours_7d", ctx), ctx),
    flightHours28d: asNumber(field(o, "flight_hours_28d", ctx), ctx),
    lastRestEnded: asString(field(o, "last_rest_ended", ctx), ctx),
    dailyHistory,
  };
}

function toCertification(raw: unknown): Certification {
  const o = raw as Record<string, unknown>;
  const ctx = `certification ${String(o["crew_id"] ?? "?")}/${String(o["cert_type"] ?? "?")}`;
  return {
    crewId: asString(field(o, "crew_id", ctx), ctx),
    certType: asUnion(field(o, "cert_type", ctx), CERT_TYPES, ctx),
    validFrom: asString(field(o, "valid_from", ctx), ctx),
    validTo: asString(field(o, "valid_to", ctx), ctx),
  };
}

function toReserve(raw: unknown): Reserve {
  const o = raw as Record<string, unknown>;
  const ctx = `reserve ${String(o["crew_id"] ?? "?")}`;
  const window = field(o, "oncall_window_utc", ctx) as Record<string, unknown>;
  return {
    crewId: asString(field(o, "crew_id", ctx), ctx),
    base: asString(field(o, "base", ctx), ctx),
    dates: asStringArray(field(o, "dates", ctx), ctx),
    oncallWindowUtc: {
      start: asString(field(window, "start", ctx), ctx),
      end: asString(field(window, "end", ctx), ctx),
    },
    note: typeof o["note"] === "string" ? o["note"] : undefined,
  };
}

function toRiskSignal(raw: unknown): RiskSignal {
  const o = raw as Record<string, unknown>;
  const ctx = `risk_signal ${String(o["crew_id"] ?? "?")}`;
  const drivers = field(o, "drivers", ctx);
  if (!Array.isArray(drivers) || !drivers.every((x) => typeof x === "string")) {
    throw new Error(`Expected string[] drivers in ${ctx}`);
  }
  return {
    crewId: asString(field(o, "crew_id", ctx), ctx),
    asOfUtc: asString(field(o, "as_of_utc", ctx), ctx),
    disruptionRiskScore: asNumber(field(o, "disruption_risk_score", ctx), ctx),
    drivers: drivers as string[],
  };
}

function toRule(raw: unknown): Rule {
  const o = raw as Record<string, unknown>;
  const ctx = `rule ${String(o["rule_id"] ?? "?")}`;
  const params = o["params"];
  let mapped: Record<string, number> | undefined;
  if (params !== undefined) {
    if (typeof params !== "object" || params === null || Array.isArray(params)) {
      throw new Error(`Expected params object in ${ctx}`);
    }
    mapped = {};
    for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
      mapped[k] = asNumber(v, `${ctx}.params.${k}`);
    }
  }
  return {
    ruleId: asString(field(o, "rule_id", ctx), ctx),
    text: asString(field(o, "text", ctx), ctx),
    params: mapped,
  };
}

function toCosts(raw: unknown): CostModel {
  const o = raw as Record<string, unknown>;
  return {
    currency: asString(field(o, "currency", "costs"), "costs"),
    reserveCalloutPilot: asNumber(field(o, "reserve_callout_pilot", "costs"), "costs"),
    reserveCalloutCabin: asNumber(field(o, "reserve_callout_cabin", "costs"), "costs"),
    dayoffCalloutPilot: asNumber(field(o, "dayoff_callout_pilot", "costs"), "costs"),
    dayoffCalloutCabin: asNumber(field(o, "dayoff_callout_cabin", "costs"), "costs"),
    deadheadPositioning: asNumber(field(o, "deadhead_positioning", "costs"), "costs"),
    delayCostPerDutyHour: asNumber(field(o, "delay_cost_per_duty_hour", "costs"), "costs"),
    cancellationPerFlight: asNumber(field(o, "cancellation_per_flight", "costs"), "costs"),
    hotelOvernight: asNumber(field(o, "hotel_overnight", "costs"), "costs"),
    notes: asString(field(o, "notes", "costs"), "costs"),
  };
}

function toFlaggedException(raw: unknown): FlaggedException {
  const o = raw as Record<string, unknown>;
  return {
    crewId: asString(field(o, "crew_id", "flagged_exception"), "flagged_exception"),
    date: asString(field(o, "date", "flagged_exception"), "flagged_exception"),
    rule: asString(field(o, "rule", "flagged_exception"), "flagged_exception"),
    note: asString(field(o, "note", "flagged_exception"), "flagged_exception"),
  };
}

function toScenario(raw: unknown): Scenario {
  const o = raw as Record<string, unknown>;
  const event = field(o, "event", "scenario") as Record<string, unknown>;
  return {
    scenarioId: asString(field(o, "scenario_id", "scenario"), "scenario"),
    difficulty: asString(field(o, "difficulty", "scenario"), "scenario"),
    title: asString(field(o, "title", "scenario"), "scenario"),
    event: {
      type: asString(field(event, "type", "scenario.event"), "scenario.event"),
      crewId: typeof event["crew_id"] === "string" ? event["crew_id"] : undefined,
      pairingId: typeof event["pairing_id"] === "string" ? event["pairing_id"] : undefined,
      reportedUtc: typeof event["reported_utc"] === "string" ? event["reported_utc"] : undefined,
      narrative: asString(field(event, "narrative", "scenario.event"), "scenario.event"),
      ...Object.fromEntries(
        Object.entries(event).filter(
          ([k]) => !["type", "crew_id", "pairing_id", "reported_utc", "narrative"].includes(k),
        ),
      ),
    },
    answerKey: o["answer_key"],
  };
}

function toQuestion(raw: unknown): Question {
  const o = raw as Record<string, unknown>;
  return {
    questionId: asString(field(o, "question_id", "question"), "question"),
    tier: asNumber(field(o, "tier", "question"), "question"),
    prompt: asString(field(o, "prompt", "question"), "question"),
    expectedAnswer: o["expected_answer"],
    explanation: typeof o["explanation"] === "string" ? o["explanation"] : undefined,
    rulesRef:
      o["rules_ref"] === undefined
        ? undefined
        : asStringArray(field(o, "rules_ref", "question"), "question"),
  };
}

// ------------------------------------------------------------------ API ----

/** Default data directory: `<repo>/data` relative to the working directory. */
export function defaultDataDir(): string {
  return resolve(process.cwd(), "data");
}

/** Read + convert every dataset file. Throws on missing file / bad shape. */
export function loadDataset(dataDir: string): LoadedDataset {
  const crews = mustBeArray(readJson(dataDir, "crew.json"), "crew.json").map(toCrew);
  const flights = mustBeArray(readJson(dataDir, "flights.json"), "flights.json").map(toFlight);

  const rosters = readJson(dataDir, "rosters.json") as Record<string, unknown>;
  const pairings = mustBeArray(field(rosters, "pairings", "rosters.json"), "rosters.pairings").map(toPairing);
  const rostersNote = typeof rosters["note"] === "string" ? rosters["note"] : undefined;
  const flaggedRaw = rosters["flagged_exceptions"];
  const flaggedExceptions =
    flaggedRaw === undefined ? [] : mustBeArray(flaggedRaw, "rosters.flagged_exceptions").map(toFlaggedException);

  const dutyClocks = mustBeArray(readJson(dataDir, "duty_clocks.json"), "duty_clocks.json").map(toDutyClock);
  const certifications = mustBeArray(readJson(dataDir, "certifications.json"), "certifications.json").map(
    toCertification,
  );
  const reserves = mustBeArray(readJson(dataDir, "reserve_pool.json"), "reserve_pool.json").map(toReserve);
  const riskSignals = mustBeArray(readJson(dataDir, "risk_signals.json"), "risk_signals.json").map(toRiskSignal);

  const rulesFile = readJson(dataDir, "rules.json") as Record<string, unknown>;
  const rules = mustBeArray(field(rulesFile, "rules", "rules.json"), "rules.rules").map(toRule);
  const timeConvention =
    typeof rulesFile["time_convention"] === "string" ? (rulesFile["time_convention"] as string) : "";
  const definitionsRaw = rulesFile["definitions"];
  if (typeof definitionsRaw !== "object" || definitionsRaw === null || Array.isArray(definitionsRaw)) {
    throw new Error("Expected definitions object in rules.json");
  }
  const ruleDefinitions: Record<string, string> = {};
  for (const [k, v] of Object.entries(definitionsRaw as Record<string, unknown>)) {
    ruleDefinitions[k] = asString(v, `rules.definitions.${k}`);
  }

  const costs = toCosts(readJson(dataDir, "costs.json"));

  const scenarios = mustBeArray(readJson(dataDir, "scenarios.json"), "scenarios.json").map(toScenario);
  const questions = mustBeArray(readJson(dataDir, "questions.json"), "questions.json").map(toQuestion);

  return {
    crews,
    flights,
    pairings,
    flaggedExceptions,
    dutyClocks,
    certifications,
    reserves,
    riskSignals,
    rules,
    timeConvention,
    ruleDefinitions,
    costs,
    rostersNote,
    scenarios,
    questions,
  };
}

export interface LoadedGraph {
  dataset: LoadedDataset;
  graph: OperationalGraph;
}

/**
 * Load the dataset from `dataDir` and build the operational graph.
 * `dataDir` defaults to `<repo>/data`.
 */
export function loadOperationalGraph(dataDir: string = defaultDataDir()): LoadedGraph {
  const dataset = loadDataset(dataDir);
  const graph = buildOperationalGraph({
    crews: dataset.crews,
    flights: dataset.flights,
    pairings: dataset.pairings,
    dutyClocks: dataset.dutyClocks,
    certifications: dataset.certifications,
    reserves: dataset.reserves,
    riskSignals: dataset.riskSignals,
    rules: dataset.rules,
    ruleDefinitions: dataset.ruleDefinitions,
    timeConvention: dataset.timeConvention,
    costs: dataset.costs,
  });
  return { dataset, graph };
}
