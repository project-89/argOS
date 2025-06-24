import { z } from "zod";
import { createComponent } from "./createComponent";

export const ThoughtEntrySchema = z.object({
  id: z.number(),
  timestamp: z.number(),
  type: z.enum(["perception", "thought", "action", "result", "reflection"]),
  content: z.string(),
  context: z
    .object({
      roomId: z.string(),
      relatedEntries: z.array(z.number()).optional(),
      metadata: z.record(z.any()).optional(),
    })
    .optional(),
});

export type ThoughtEntry = z.infer<typeof ThoughtEntrySchema>;

export const ThoughtSchema = z.object({
  entries: z.array(ThoughtEntrySchema),
  lastEntryId: z.number(),
  lastUpdate: z.number(),
});

export const ThoughtComponent = createComponent("Thought", ThoughtSchema, {
  entries: [] as ThoughtEntry[][],
  lastEntryId: [] as number[],
  lastUpdate: [] as number[],
});

export const Thought = ThoughtComponent.component;
