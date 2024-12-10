import { World } from "bitecs";
import { WorldState, AgentState, RoomState } from "../../types";

export interface IStateManager {
  // Core state management
  getWorldState(): WorldState;
  getAgentState(eid: number): AgentState;
  getRoomState(roomId: number): RoomState;

  // Global state and prompt management
  registerPromptTemplate(key: string, template: string): void;
  getPromptTemplate(key: string): string | undefined;
  getGlobalState(): Record<string, any>;
  updateGlobalState(updates: Record<string, any>): void;

  // State composition
  composeState(localState: Record<string, any>): Record<string, any>;
}

// Constants for standard prompt template keys
export const PROMPT_TEMPLATES = {
  ECS_INSTRUCTIONS: "ecsInstructions",
  TOOL_INSTRUCTIONS: "toolInstructions",
  PERCEPTION_INSTRUCTIONS: "perceptionInstructions",
  NARRATIVE_INSTRUCTIONS: "narrativeInstructions",
} as const;

export type PromptTemplateKey =
  (typeof PROMPT_TEMPLATES)[keyof typeof PROMPT_TEMPLATES];
