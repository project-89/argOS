import { z } from "zod";
import { createComponent } from "./createComponent";
import { StimulusTypes, StimulusType, SourceTypes } from "../types/stimulus";

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

export type StimulusComponentType = z.infer<typeof StimulusSchema>;

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

// Stimulus relation schemas
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
