import { createComponent } from "./createComponent";
import { StimulusType, StimulusSource } from "../types/stimulus";
import { z } from "zod";

export const StimulusMetadataSchema = z
  .object({
    roomId: z.string().optional(),
    targetId: z.number().optional(),
    duration: z.number().optional(),
  })
  .catchall(z.any());

export const StimulusContentSchema = z.object({
  data: z.any(),
  metadata: StimulusMetadataSchema.optional(),
});

export const StimulusSchema = z.object({
  type: z.nativeEnum(StimulusType),
  source: z.nativeEnum(StimulusSource),
  timestamp: z.number(),
  content: z.string(), // JSON stringified StimulusContent
  subtype: z.string().optional(),
  intensity: z.number().optional(),
  private: z.boolean().optional(),
  decay: z.number().optional(),
  priority: z.number().optional(),
  metadata: StimulusMetadataSchema.optional(),
});

export const StimulusComponent = createComponent("Stimulus", StimulusSchema, {
  type: [] as StimulusType[],
  source: [] as StimulusSource[],
  content: [] as string[],
  timestamp: [] as number[],
  decay: [] as number[],
  priority: [] as number[],
  subtype: [] as string[],
  intensity: [] as number[],
  private: [] as boolean[],
  metadata: [] as Record<string, any>[],
});

export const Stimulus = StimulusComponent.component;

// Stimulus relation schemas
export const StimulusInRoomSchema = z.object({
  roomId: z.string(),
  enteredAt: z.number(),
  intensity: z.number(),
});

export const StimulusSourceSchema = z.object({
  source: z.nativeEnum(StimulusSource),
  createdAt: z.number(),
  strength: z.number(),
});
