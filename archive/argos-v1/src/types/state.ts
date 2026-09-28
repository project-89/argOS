import { z } from "zod";
import { ComponentWithSchema } from "../components/createComponent";
import { RelationWithSchema } from "../components/createRelation";
import { StimulusData, StimulusSource, StimulusType } from "./stimulus";
import { SinglePlanType } from "../components/Plans";
import { ActionResultType, ActionType, SingleGoalType } from "../components";
import { GoalType } from "../components/Goals";

// Agent summary type for global state
export interface AgentSummary {
  id: string;
  name: string;
  role: string;
}

// Component state that combines all component data for an entity
export interface EntityComponentState {
  agent: any;
  memory: any;
  rooms: any[];
  action: any & {
    lastActionResult?: ActionResultType;
  };
  perception: any;
  appearance: any;
  recentActions: any;
  interactions: Record<string, any>;
}

// Available tool type for runtime state
export interface AvailableTool {
  name: string;
  description: string;
  parameters: string[];
  schema: any;
}

// Engine state interface
export interface EngineState {
  availableTools: AvailableTool[];
  registeredComponents: Record<string, ComponentWithSchema<z.ZodObject<any>>>;
  registeredRelations: Record<string, RelationWithSchema<z.ZodObject<any>>>;
}

// Global state interface
export interface GlobalState {
  activeAgents: AgentSummary[];
  rooms: Record<string, any>; // Room data from components
  stimuli: Record<string, any>; // Stimulus data from components
}

// Runtime state that includes global state and current entity state
export interface RuntimeState {
  timestamp: number;
  entityId: number;
  components: EntityComponentState;
  templates: Record<string, string>; // Rendered templates cache
  global: GlobalState;
  engine: EngineState;
}

export type RoomType =
  | "physical"
  | "discord"
  | "twitter"
  | "private"
  | "astral"
  | "system";

export interface Room {
  id: string;
  name: string;
  description: string;
  type: RoomType;
}

export interface RoomState extends Room {
  eid?: number;
  occupants?: { id: string; name: any; attention: any }[];
  stimuli?: any[];
  lastUpdate?: number;
}

export interface AgentState {
  id: string;
  name: string;
  role: string;
  systemPrompt: string;
  active: boolean;
  platform: string;
  attention: number;
  perceptions: {
    narrative: string;
    raw: any[];
  };
  lastAction?: ActionResultType;
  timeSinceLastAction: number;
  thoughtChain: Array<{
    type: "perception" | "thought" | "action" | "result" | "reflection";
    content: string;
    timestamp: number;
  }>;
  availableTools: Array<{
    name: string;
    description: string;
    schema?: any;
  }>;
  goals: Array<{
    id: string;
    description: string;
    type: string;
    priority: number;
    progress: number;
    status: "pending" | "in_progress" | "completed" | "failed";
    success_criteria: string[];
    progress_indicators: string[];
    created_at: number;
  }>;
  completedGoals: GoalType[];
  activePlans: SinglePlanType[];
  appearance: {
    description?: string;
    facialExpression?: string;
    bodyLanguage?: string;
    currentAction?: string;
    socialCues?: string;
  };
}
