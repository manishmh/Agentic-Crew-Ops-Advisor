/**
 * In-memory operational graph.
 *
 * Small, clean dataset → Maps and arrays only. No vector DB, no graph DB,
 * no external database, no embeddings.
 *
 * Primary operational relationship:
 *   Crew ──assigned_to──▶ Pairing ──contains──▶ Flight
 * Crew → Flight is deliberately NOT the primary relationship: one sick
 * call can uncover an entire multi-day pairing.
 *
 * After construction, common lookups are O(1)/O(k) via the indexes —
 * the query helpers below never scan the full arrays. Filtering is
 * used only during graph construction.
 */

import type {
  AircraftType,
  Certification,
  CertificationType,
  Crew,
  CrewId,
  CrewRank,
  CostModel,
  DutyClock,
  Flight,
  FlightId,
  Pairing,
  PairingId,
  Reserve,
  RiskSignal,
  Rule,
  StationCode,
} from "../domain/types.js";

export interface OperationalGraph {
  // raw collections (source-faithful, insertion order = file order)
  crews: Crew[];
  flights: Flight[];
  pairings: Pairing[];

  dutyClocks: DutyClock[];
  certifications: Certification[];
  reserves: Reserve[];
  riskSignals: RiskSignal[];

  rules: Rule[];
  /** rules.json → definitions, carried so reasoning never rereads raw JSON. */
  ruleDefinitions: Record<string, string>;
  /** rules.json → time_convention. */
  timeConvention: string;
  costs: CostModel;

  // ---- primary indexes ----
  crewById: Map<CrewId, Crew>;
  flightById: Map<FlightId, Flight>;
  pairingById: Map<PairingId, Pairing>;

  // ---- operational traversals ----
  /** Crew → pairings they are assigned to (via Pairing.crew). */
  pairingsByCrew: Map<CrewId, Pairing[]>;
  /** Pairing → its flights, in roster order (days preserved). */
  flightsByPairing: Map<PairingId, Flight[]>;
  /** Pairing → assigned crew, in roster order. */
  crewByPairing: Map<PairingId, Crew[]>;
  /** Flight → the pairing(s) containing it (normally exactly one). */
  pairingsByFlight: Map<FlightId, Pairing[]>;

  // ---- flight access paths ----
  /** Tail number (e.g. "VT-DXA") → flights. */
  flightsByAircraft: Map<string, Flight[]>;
  flightsByOrigin: Map<StationCode, Flight[]>;
  flightsByDestination: Map<StationCode, Flight[]>;

  // ---- crew access paths ----
  crewByBase: Map<StationCode, Crew[]>;
  /** Aircraft type (e.g. "A320") → crews rated on it. */
  crewByRating: Map<string, Crew[]>;

  // ---- per-crew records ----
  certificationsByCrew: Map<CrewId, Certification[]>;
  dutyClockByCrew: Map<CrewId, DutyClock>;
  reserveByCrew: Map<CrewId, Reserve>;
  reservesByBase: Map<StationCode, Reserve[]>;
  riskByCrew: Map<CrewId, RiskSignal>;
}

function pushToList<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export interface GraphInput {
  crews: Crew[];
  flights: Flight[];
  pairings: Pairing[];
  dutyClocks: DutyClock[];
  certifications: Certification[];
  reserves: Reserve[];
  riskSignals: RiskSignal[];
  rules: Rule[];
  ruleDefinitions: Record<string, string>;
  timeConvention: string;
  costs: CostModel;
}

/** Build the graph and every index from canonical collections. Pure. */
export function buildOperationalGraph(input: GraphInput): OperationalGraph {
  const crewById = new Map<CrewId, Crew>();
  for (const c of input.crews) if (!crewById.has(c.crewId)) crewById.set(c.crewId, c);

  const flightById = new Map<FlightId, Flight>();
  for (const f of input.flights) if (!flightById.has(f.flightId)) flightById.set(f.flightId, f);

  const pairingById = new Map<PairingId, Pairing>();
  for (const p of input.pairings) if (!pairingById.has(p.pairingId)) pairingById.set(p.pairingId, p);

  const pairingsByCrew = new Map<CrewId, Pairing[]>();
  const flightsByPairing = new Map<PairingId, Flight[]>();
  const crewByPairing = new Map<PairingId, Crew[]>();
  const pairingsByFlight = new Map<FlightId, Pairing[]>();

  for (const p of input.pairings) {
    const flights: Flight[] = [];
    for (const day of p.days) {
      for (const fid of day.flights) {
        const f = flightById.get(fid);
        if (f) flights.push(f); // dangling refs reported by validation, skipped here
        pushToList(pairingsByFlight, fid, p);
      }
    }
    flightsByPairing.set(p.pairingId, flights);

    const crew: Crew[] = [];
    for (const a of p.crew) {
      const c = crewById.get(a.crewId);
      if (c) crew.push(c);
      // One pairing object per crew entry keeps pairingsByCrew exact even
      // if the same pairing id appeared twice in source (dupes are flagged
      // by validation, not silently merged).
      pushToList(pairingsByCrew, a.crewId, p);
    }
    crewByPairing.set(p.pairingId, crew);
  }

  const flightsByAircraft = new Map<string, Flight[]>();
  const flightsByOrigin = new Map<StationCode, Flight[]>();
  const flightsByDestination = new Map<StationCode, Flight[]>();
  for (const f of input.flights) {
    pushToList(flightsByAircraft, f.aircraft, f);
    pushToList(flightsByOrigin, f.depStation, f);
    pushToList(flightsByDestination, f.arrStation, f);
  }

  const crewByBase = new Map<StationCode, Crew[]>();
  const crewByRating = new Map<string, Crew[]>();
  for (const c of input.crews) {
    pushToList(crewByBase, c.base, c);
    for (const r of c.ratings) pushToList(crewByRating, r, c);
  }

  const certificationsByCrew = new Map<CrewId, Certification[]>();
  for (const cert of input.certifications) pushToList(certificationsByCrew, cert.crewId, cert);

  const dutyClockByCrew = new Map<CrewId, DutyClock>();
  for (const d of input.dutyClocks) if (!dutyClockByCrew.has(d.crewId)) dutyClockByCrew.set(d.crewId, d);

  const reserveByCrew = new Map<CrewId, Reserve>();
  const reservesByBase = new Map<StationCode, Reserve[]>();
  for (const r of input.reserves) {
    if (!reserveByCrew.has(r.crewId)) reserveByCrew.set(r.crewId, r);
    pushToList(reservesByBase, r.base, r);
  }

  const riskByCrew = new Map<CrewId, RiskSignal>();
  for (const r of input.riskSignals) if (!riskByCrew.has(r.crewId)) riskByCrew.set(r.crewId, r);

  return {
    crews: input.crews,
    flights: input.flights,
    pairings: input.pairings,
    dutyClocks: input.dutyClocks,
    certifications: input.certifications,
    reserves: input.reserves,
    riskSignals: input.riskSignals,
    rules: input.rules,
    ruleDefinitions: input.ruleDefinitions,
    timeConvention: input.timeConvention,
    costs: input.costs,
    crewById,
    flightById,
    pairingById,
    pairingsByCrew,
    flightsByPairing,
    crewByPairing,
    pairingsByFlight,
    flightsByAircraft,
    flightsByOrigin,
    flightsByDestination,
    crewByBase,
    crewByRating,
    certificationsByCrew,
    dutyClockByCrew,
    reserveByCrew,
    reservesByBase,
    riskByCrew,
  };
}

// ------------------------------------------------------- query helpers ----
// All helpers read from indexes only (O(1) map get + O(k) list slice).
// They return readonly views; empty array (never null) when nothing matches.

export function getCrew(g: OperationalGraph, id: CrewId): Crew | undefined {
  return g.crewById.get(id);
}

export function getFlight(g: OperationalGraph, id: FlightId): Flight | undefined {
  return g.flightById.get(id);
}

export function getPairing(g: OperationalGraph, id: PairingId): Pairing | undefined {
  return g.pairingById.get(id);
}

export function getPairingsForCrew(g: OperationalGraph, id: CrewId): readonly Pairing[] {
  return g.pairingsByCrew.get(id) ?? [];
}

export function getFlightsForPairing(g: OperationalGraph, id: PairingId): readonly Flight[] {
  return g.flightsByPairing.get(id) ?? [];
}

export function getCrewForPairing(g: OperationalGraph, id: PairingId): readonly Crew[] {
  return g.crewByPairing.get(id) ?? [];
}

export function getPairingsForFlight(g: OperationalGraph, id: FlightId): readonly Pairing[] {
  return g.pairingsByFlight.get(id) ?? [];
}

/** All flights operated by one crew member, via their pairings. */
export function getFlightsForCrew(g: OperationalGraph, id: CrewId): readonly Flight[] {
  const out: Flight[] = [];
  for (const p of getPairingsForCrew(g, id)) {
    for (const f of getFlightsForPairing(g, p.pairingId)) out.push(f);
  }
  return out;
}

export function getFlightsByOrigin(g: OperationalGraph, st: StationCode): readonly Flight[] {
  return g.flightsByOrigin.get(st) ?? [];
}

export function getFlightsByDestination(g: OperationalGraph, st: StationCode): readonly Flight[] {
  return g.flightsByDestination.get(st) ?? [];
}

export function getCrewByBase(g: OperationalGraph, st: StationCode): readonly Crew[] {
  return g.crewByBase.get(st) ?? [];
}

export function getCrewByRating(g: OperationalGraph, rating: string): readonly Crew[] {
  return g.crewByRating.get(rating) ?? [];
}

export function getCertificationsForCrew(
  g: OperationalGraph,
  id: CrewId,
  certType?: CertificationType,
): readonly Certification[] {
  const all = g.certificationsByCrew.get(id) ?? [];
  return certType ? all.filter((c) => c.certType === certType) : all;
}

export function getDutyClock(g: OperationalGraph, id: CrewId): DutyClock | undefined {
  return g.dutyClockByCrew.get(id);
}

export function getReserve(g: OperationalGraph, id: CrewId): Reserve | undefined {
  return g.reserveByCrew.get(id);
}

export function getReservesByBase(g: OperationalGraph, st: StationCode): readonly Reserve[] {
  return g.reservesByBase.get(st) ?? [];
}

export function getRiskSignal(g: OperationalGraph, id: CrewId): RiskSignal | undefined {
  return g.riskByCrew.get(id);
}

// ------------------------------------------------- Step-2 alias helpers ----
// Canonical Step-2 names for the same index-backed lookups above.

export const getCrewById = getCrew;
export const getFlightById = getFlight;
export const getPairingById = getPairing;
export const getDutyClockForCrew = getDutyClock;
export const getReserveForCrew = getReserve;

// ------------------------------------------------- derived access paths ----
// Also index-backed: they compose flightsByPairing / pairingById only.

/**
 * Distinct aircraft types observed on a pairing's flights, in first-seen
 * order. Rosters operate one type per pairing; more than one entry means
 * mixed equipment worth flagging downstream.
 */
export function getAircraftTypesForPairing(
  g: OperationalGraph,
  id: PairingId,
): readonly AircraftType[] {
  const seen: AircraftType[] = [];
  for (const f of getFlightsForPairing(g, id)) {
    if (!seen.includes(f.aircraftType)) seen.push(f.aircraftType);
  }
  return seen;
}

/** The crew member's rostered role on a pairing, if assigned. */
export function getCrewRoleInPairing(
  g: OperationalGraph,
  pairingId: PairingId,
  crewId: CrewId,
): CrewRank | undefined {
  return getPairing(g, pairingId)?.crew.find((a) => a.crewId === crewId)?.role;
}
