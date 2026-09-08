export type Workspace = "Dashboard" | "Timeline" | "Day Brief" | "CrewOps AI";
export type OperationalStatus =
  | "legal"
  | "rejected"
  | "warning"
  | "not-evaluated";
export type ScenarioId =
  | "sick"
  | "delay"
  | "closure"
  | "certification"
  | "multi"
  | "limits";
export interface RuleCheck {
  id: string;
  label: string;
  status: OperationalStatus;
  actual?: string;
  limit?: string;
}
export interface CostComponent {
  label: string;
  value: string;
}
export interface RecoveryOption {
  id: string;
  name: string;
  role: string;
  method: string;
  status: OperationalStatus;
  cost: string;
  delay: string;
  positioning: string;
  reason: string;
  checks: RuleCheck[];
  components: CostComponent[];
  comparison?: string;
  costLabel?: string;
  assignments?: Array<{
    id: string;
    name: string;
    role: string;
    base: string;
    method: string;
    cost: string;
    positioning: string;
  }>;
  trace?: ScenarioEvidence[];
}
export interface AffectedFlight {
  id: string;
  origin: string;
  destination: string;
  departure: string;
  arrival: string;
  reason?: string;
}
export interface OperationalImpact {
  label: string;
  value: string;
}
export interface ScenarioEvidence {
  reason: string;
  ruleId?: string;
  passed?: boolean;
  timestamps?: Record<string, string>;
  details?: Record<string, string>;
}
export interface Scenario {
  id: ScenarioId;
  query: string;
  label: string;
  summary: string;
  status: string;
  metrics: OperationalImpact[];
  flights: string[];
  pairing: string;
  recommended?: RecoveryOption;
  alternatives: RecoveryOption[];
  affectedFlights?: AffectedFlight[];
  closureOutcome?: { fallbackCost?: string; recoveryRequired: boolean; recoveryAvailable?: boolean; consequence?: string };
  evidence?: ScenarioEvidence[];
  certificationDuties?: Array<{ pairingId: string; dutyDate: string; flightIds: string[]; aircraftTypes: string[]; certificationLegal: boolean; expired: string[] }>;
  consequence?: { title: string; checks: RuleCheck[]; note: string };
  joint?: { pairing: string; crew: string; unavailableCrew?: string; method: string; cost: string; delay?: string; status?: OperationalStatus }[];
  total?: string;
  note?: string;
  /** True when this display scenario was returned by the local deterministic API. */
  live?: boolean;
  naturalLanguageAnswer?: string;
  agent?: { plannerMs?: number; toolMs?: number; explainerMs?: number; plannerUsed: boolean; plannerFallback: boolean; explainerUsed: boolean; fallbackUsed: boolean };
}
export interface AssistantMessage {
  id: number;
  query: string;
  scenario?: Scenario;
  generic?: boolean;
  state?: "loading" | "error" | "empty";
  error?: string;
  errorTitle?: string;
}
export interface TimelineFlight extends AffectedFlight {
  date: string;
  aircraft: string;
  crew: string;
  state: "normal" | "healthy" | "risk" | "critical";
  status: string;
  left: number;
  width: number;
  block: number;
  direction: "DEP" | "ARR";
}
