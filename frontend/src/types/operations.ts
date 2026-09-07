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
  consequence?: { title: string; checks: RuleCheck[]; note: string };
  joint?: { pairing: string; crew: string; method: string; cost: string }[];
  total?: string;
  note?: string;
}
export interface AssistantMessage {
  id: number;
  query: string;
  scenario?: Scenario;
  generic?: boolean;
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
