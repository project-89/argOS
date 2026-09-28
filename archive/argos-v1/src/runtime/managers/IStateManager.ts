import { World } from "bitecs";
import { WorldState, AgentState, RoomState, NetworkLink } from "../../types";
import { z } from "zod";
import { ComponentWithSchema } from "../../components/createComponent";
import { RelationWithSchema } from "../../components/createRelation";

export interface IStateManager {
  // Core state management
  getWorldState(): WorldState;
  getAgentState(eid: number): AgentState;
  getRoomState(eid: number): RoomState;
  getRelationships(): NetworkLink[];

  // Component Registry
  registerComponent(component: ComponentWithSchema<z.ZodObject<any>>): void;
  getComponent(name: string): ComponentWithSchema<z.ZodObject<any>> | undefined;
  getComponents(): Record<string, ComponentWithSchema<z.ZodObject<any>>>;

  // Relationship Registry
  registerRelation(relation: RelationWithSchema<z.ZodObject<any>>): void;
  getRelation(name: string): RelationWithSchema<z.ZodObject<any>> | undefined;
  getRelations(): Record<string, RelationWithSchema<z.ZodObject<any>>>;

  // Prompt Management
  registerPrompt(key: string, template: string): void;
  getPrompt(key: string): string | undefined;
  composePrompts(keys: string[], variables?: Record<string, any>): string;
  hasPrompt(key: string): boolean;

  // Template variables
  setTemplateVariable(key: string, value: any): void;
  getTemplateVariable(key: string): any;
  getTemplateVariables(): Record<string, any>;

  // Cleanup
  cleanup(): void;
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
