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
