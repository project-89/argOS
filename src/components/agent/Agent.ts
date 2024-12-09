import { createRelation, withStore } from "bitecs";
import { z } from "zod";
import { createComponent } from "../createComponent";
import { createSchemaRelation } from "../createRelation";

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
    })
  ),
  experiences: z.array(
    z.object({
      type: z.string(),
      content: z.string(),
      timestamp: z.number(),
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

// Perception schema and component
export const PerceptionSchema = z.object({
  currentStimuli: z.array(z.any()),
  lastProcessedTime: z.number(),
});

export const PerceptionComponent = createComponent(
  "Perception",
  PerceptionSchema,
  {
    currentStimuli: [] as any[][],
    lastProcessedTime: [] as number[],
  }
);

export const Perception = PerceptionComponent.component;

// Action schema and component
export const ActionSchema = z.object({
  pendingAction: z
    .object({
      tool: z.string(),
      parameters: z.any(),
    })
    .nullable(),
  lastActionTime: z.number(),
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
  availableTools: [] as Array<{
    name: string;
    description: string;
    parameters: string[];
    schema: any;
  }>[],
});

export const Action = ActionComponent.component;

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
  type: z.string(),
  sourceEntity: z.number(),
  source: z.string(),
  content: z.string(),
  timestamp: z.number(),
  decay: z.number(),
  roomId: z.string(),
});

export const StimulusComponent = createComponent("Stimulus", StimulusSchema, {
  type: [] as string[],
  sourceEntity: [] as number[],
  source: [] as string[],
  content: [] as string[],
  timestamp: [] as number[],
  decay: [] as number[],
  roomId: [] as string[],
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
