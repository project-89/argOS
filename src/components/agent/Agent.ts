import { createRelation, withStore } from "bitecs";
import { z } from "zod";
import { createComponent } from "../createComponent";
import { createSchemaRelation } from "../createRelation";
import { StimulusTypes, StimulusType, SourceTypes } from "../../types/stimulus";

// Core Agent schema and component
export const AgentSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  systemPrompt: z.string(),
  active: z.number(),
  platform: z.string(),
  appearance: z.string(),
  attention: z.number(),
});

export const AgentComponent = createComponent("Agent", AgentSchema, {
  id: [] as string[],
  name: [] as string[],
  role: [] as string[],
  systemPrompt: [] as string[],
  active: [] as number[],
  platform: [] as string[],
  appearance: [] as string[],
  attention: [] as number[],
});

export const Agent = AgentComponent.component;

// Memory schema and component
export const MemorySchema = z.object({
  thoughts: z.array(z.string()),
  lastThought: z.string(),
  lastUpdate: z.number(),
  perceptions: z.array(
    z.object({
      timestamp: z.number(),
      content: z.string(),
      category: z.enum(["speech", "action", "observation", "thought"]),
      context: z
        .object({
          speaker: z.string().optional(),
          target: z.string().optional(),
          location: z.string().optional(),
          relatedTo: z.string().optional(),
        })
        .optional(),
    })
  ),
  experiences: z.array(
    z.object({
      type: z.string(),
      content: z.string(),
      timestamp: z.number(),
      context: z
        .object({
          category: z.string(),
          relatedExperiences: z.array(z.number()),
          conversationState: z.any(),
        })
        .optional(),
    })
  ),
});

export const MemoryComponent = createComponent("Memory", MemorySchema, {
  thoughts: [] as string[][],
  lastThought: [] as string[],
  lastUpdate: [] as number[],
  perceptions: [] as Array<{
    timestamp: number;
    content: string;
  }>[],
  experiences: [] as Array<{
    type: string;
    content: string;
    timestamp: number;
    context: any;
  }>[],
});

export const Memory = MemoryComponent.component;

// Room schema and component
export const RoomTypeEnum = z.enum([
  "physical",
  "discord",
  "twitter",
  "private",
  "astral",
]);
export type RoomType = z.infer<typeof RoomTypeEnum>;

export const RoomSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  type: RoomTypeEnum,
});

export const RoomComponent = createComponent("Room", RoomSchema, {
  id: [] as string[],
  name: [] as string[],
  description: [] as string[],
  type: [] as RoomType[],
});

export const Room = RoomComponent.component;

// Define the schema for the RecentActions component
export const RecentActionsSchema = z.object({
  actions: z.array(
    z.object({
      actionName: z.string(),
      parameters: z.any(),
      success: z.boolean(),
      message: z.string(),
      timestamp: z.number(),
      data: z.any().optional(),
    })
  ),
});

// Create the actual component with a name and schema
export const RecentActionsComponent = createComponent(
  "RecentActions",
  RecentActionsSchema,
  {
    actions: [] as Array<{
      actionName: string;
      parameters: any;
      success: boolean;
      message: string;
      timestamp: number;
      data: Record<string, any>;
    }>[],
  }
);

// Export the component
export const RecentActions = RecentActionsComponent.component;

// TypeScript types for convenience
export type RecentActionsType = z.infer<typeof RecentActionsSchema>;

// Action schema and component
export const ActionSchema = z.object({
  pendingAction: z
    .object({
      tool: z.string(),
      parameters: z.any(),
    })
    .nullable(),
  lastActionTime: z.number(),
  lastActionResult: z
    .object({
      action: z.string(),
      success: z.boolean(),
      result: z.string(),
      timestamp: z.number(),
    })
    .nullable(),
  availableTools: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      parameters: z.array(z.string()),
      schema: z.any(),
    })
  ),
});

export const ActionComponent = createComponent("Action", ActionSchema, {
  pendingAction: [] as ({
    tool: string;
    parameters: any;
  } | null)[],
  lastActionTime: [] as number[],
  lastActionResult: [] as ({
    action: string;
    success: boolean;
    result: string;
    timestamp: number;
    data: Record<string, any>;
  } | null)[],
  availableTools: [] as Array<{
    name: string;
    description: string;
    parameters: string[];
    schema: any;
  }>[],
});

export const Action = ActionComponent.component;

// Define a schema for the Perception component
export const PerceptionSchema = z.object({
  currentStimuli: z.array(z.any()).optional(),
  lastProcessedTime: z.number().optional(),
  lastUpdate: z.number().optional(),
  summary: z.string().optional(),
  context: z.any().optional(),
});

export type PerceptionType = z.infer<typeof PerceptionSchema>;

// Create the actual component with a name and schema
export const PerceptionComponent = createComponent(
  "Perception",
  PerceptionSchema,
  {
    currentStimuli: [] as any[][],
    lastProcessedTime: [] as number[],
    lastUpdate: [] as number[],
    summary: [] as string[],
    context: [] as Record<string, any>[],
  }
);

export const Perception = PerceptionComponent.component;

// Appearance schema and component
export const AppearanceSchema = z.object({
  baseDescription: z.string(),
  description: z.string(),
  facialExpression: z.string(),
  bodyLanguage: z.string(),
  currentAction: z.string(),
  socialCues: z.string(),
  lastUpdate: z.number(),
});

export const AppearanceComponent = createComponent(
  "Appearance",
  AppearanceSchema,
  {
    baseDescription: [] as string[],
    description: [] as string[],
    facialExpression: [] as string[],
    bodyLanguage: [] as string[],
    currentAction: [] as string[],
    socialCues: [] as string[],
    lastUpdate: [] as number[],
  }
);

export const Appearance = AppearanceComponent.component;

// Stimulus schema and component
export const StimulusSchema = z.object({
  type: z.enum([
    StimulusTypes.VISUAL,
    StimulusTypes.AUDITORY,
    StimulusTypes.COGNITIVE,
    StimulusTypes.TECHNICAL,
    StimulusTypes.ENVIRONMENTAL,
  ]),
  sourceEntity: z.number(),
  source: z.enum([
    SourceTypes.AGENT,
    SourceTypes.ROOM,
    SourceTypes.USER,
    SourceTypes.SYSTEM,
  ]),
  timestamp: z.number(),
  roomId: z.string(),
  content: z.string(),
  priority: z.number().optional(),
  decay: z.number().optional(),
});

export const StimulusComponent = createComponent("Stimulus", StimulusSchema, {
  type: [] as StimulusType[],
  sourceEntity: [] as number[],
  source: [] as string[],
  content: [] as string[],
  timestamp: [] as number[],
  decay: [] as number[],
  roomId: [] as string[],
  priority: [] as number[],
});

export const Stimulus = StimulusComponent.component;

// Relation schemas
export const StimulusInRoomSchema = z.object({
  roomId: z.string(),
  enteredAt: z.number(),
  intensity: z.number(),
});

export const StimulusSourceSchema = z.object({
  source: z.string(),
  createdAt: z.number(),
  strength: z.number(),
});

export const InteractionSchema = z.object({
  type: z.string(),
  strength: z.number(),
  lastUpdate: z.number(),
});

// Relations with metadata stores
export const StimulusInRoom = createSchemaRelation(
  "StimulusInRoom",
  StimulusInRoomSchema
).relation;

export const StimulusSource = createSchemaRelation(
  "StimulusSource",
  StimulusSourceSchema
).relation;

export const Interaction = createSchemaRelation(
  "Interaction",
  InteractionSchema
).relation;

// Room occupancy relationship
export const OccupiesRoom = createRelation({
  exclusive: true, // An agent can only be in one room at a time
});
