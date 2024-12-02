export interface SimulationEvent {
  type:
    | "LOG"
    | "AGENT_STATE"
    | "SYSTEM_STATE"
    | "AGENT_ACTION"
    | "ERROR"
    | "PERCEPTION";
  category?: string;
  data: any;
  timestamp: number;
  agentId?: number;
  agentName?: string;
  actionType?: "SPEECH" | "THOUGHT" | "WAIT" | "MOVEMENT" | "SYSTEM";
}

export type AgentColor = {
  id: number;
  name: string;
  color: string;
};
