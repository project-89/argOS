import { World } from "./bitecs";

export interface AgentState {
  name: string;
  role: string;
  systemPrompt: string;
  emotionalState: string;
  goals: string[];
  memories: string[];
  context: string;
  recentThoughts?: string[];
}

export interface Stimulus {
  type: "message" | "observation" | "environmental" | "internal";
  content: any;
  source?: number; // agent ID if from another agent
  timestamp: number;
}

export interface CognitiveSystem {
  process(world: World, agentId: number, state: AgentState): Promise<void>;
}
