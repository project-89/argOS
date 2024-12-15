import { createRelation } from "bitecs";
import { z } from "zod";
import { createComponent } from "./createComponent";
import { createSchemaRelation } from "./createRelation";
import { StimulusInRoomSchema, StimulusSourceSchema } from "./Stimulus";

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

// Relation schemas
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
