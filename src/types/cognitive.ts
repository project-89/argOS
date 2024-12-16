import { World } from "./system";
import { AgentSchema } from "../components/Agent";
import { z } from "zod";

export type AgentCognitiveState = z.infer<typeof AgentSchema> & {
  emotionalState?: string;
  goals?: string[];
  memories?: string[];
  context?: string;
  recentThoughts?: string[];
};

export interface CognitiveSystem {
  process(
    world: World,
    agentId: number,
    state: AgentCognitiveState
  ): Promise<void>;
}

export interface ChangeAnalysis {
  significant_change: boolean;
  changes: Array<{
    description: string;
    impact_level: number;
  }>;
  recommendation: "maintain_goals" | "update_goals" | "new_goals";
  reasoning: string[];
}
