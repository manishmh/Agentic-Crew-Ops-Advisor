import type { CrewOpsQueryResponse } from "../api/crewopsQuery.js";

export type AgentIntent = "SICK_CREW" | "DELAY" | "STATION_CLOSURE" | "CERT_EXPIRY" | "MULTI_SICK" | "LOOKUP" | "UNKNOWN";

export interface PlannerEntities {
  crewIds?: string[];
  flightIds?: string[];
  station?: string;
  certificationType?: string;
  delayMinutes?: number;
  startUtc?: string;
  endUtc?: string;
  operationalDate?: string;
}

export interface PlannerPlan {
  intent: AgentIntent;
  entities: PlannerEntities;
  needsClarification: boolean;
  clarificationQuestion?: string;
}

export interface AgentMetadata {
  plannerUsed: boolean;
  plannerFallback: boolean;
  explainerUsed: boolean;
  fallbackUsed: boolean;
  provider?: string;
  model?: string;
  plannerMs: number;
  toolMs: number;
  explainerMs: number;
}

export type AgentCrewOpsResponse = CrewOpsQueryResponse & {
  agent: AgentMetadata;
  naturalLanguageAnswer?: string;
};
