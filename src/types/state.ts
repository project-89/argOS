import { z } from "zod";
import {
  AgentSchema,
  MemorySchema,
  RoomSchema,
  ActionSchema,
  PerceptionSchema,
  AppearanceSchema,
  StimulusSchema,
  RecentActionsSchema,
  InteractionSchema,
} from "../components/agent/Agent";
import { ActionResult } from "./actions";
import { ComponentWithSchema } from "../components/createComponent";
import { RelationWithSchema } from "../components/createRelation";

// Reuse existing schema types
export type AgentStateType = z.infer<typeof AgentSchema>;
export type MemoryStateType = z.infer<typeof MemorySchema>;
export type RoomStateType = z.infer<typeof RoomSchema>;
export type ActionStateType = z.infer<typeof ActionSchema>;
export type PerceptionStateType = z.infer<typeof PerceptionSchema>;
export type AppearanceStateType = z.infer<typeof AppearanceSchema>;
export type StimulusStateType = z.infer<typeof StimulusSchema>;
export type RecentActionsStateType = z.infer<typeof RecentActionsSchema>;
export type InteractionStateType = z.infer<typeof InteractionSchema>;

// Component state that combines all component data for an entity
export interface EntityComponentState {
  agent: AgentStateType;
  memory: MemoryStateType;
  rooms: RoomStateType[];
  action: ActionStateType & {
    lastActionResult?: ActionResult;
  };
  perception: PerceptionStateType;
  appearance: AppearanceStateType;
  recentActions: RecentActionsStateType;
  interactions: Record<string, InteractionStateType>;
}

export interface AgentSummary {
  id: number;
  name: string;
  role: string;
}

// Runtime state that includes global state and current entity state
export interface RuntimeState {
  timestamp: number;
  entityId: number;
  components: EntityComponentState;
  templates: Record<string, string>; // Rendered templates cache
  global: {
    activeAgents: AgentSummary[];
    rooms: Record<string, RoomStateType>;
    stimuli: Record<string, StimulusStateType>;
  };
  engine: {
    availableTools: Array<{
      name: string;
      description: string;
      parameters: string[];
      schema: any;
    }>;
    registeredComponents: Record<string, ComponentWithSchema<z.ZodObject<any>>>;
    registeredRelations: Record<string, RelationWithSchema<z.ZodObject<any>>>;
  };
}
