import { z } from "zod";
import { createComponent } from "./createComponent";

// Schema for working memory items
const WorkingMemoryItemSchema = z.object({
  type: z.enum(["perception", "thought", "decision", "observation", "reasoning_insight", "meta_insight"]),
  content: z.string(),
  timestamp: z.number(),
  importance: z.number().min(0).max(1),
  source: z.string(),
});

export const WorkingMemorySchema = z.object({
  items: z.array(WorkingMemoryItemSchema),
  capacity: z.number().default(20),
  lastStimuliHash: z.string().optional(),
  lastSignificantChange: z.number().optional(),
  stableStateCycles: z.number().optional(),
});

export type WorkingMemoryType = z.infer<typeof WorkingMemorySchema>;

export const WorkingMemoryComponent = createComponent(
  "WorkingMemory",
  WorkingMemorySchema,
  {
    items: [],
    capacity: [],
    lastStimuliHash: [],
    lastSignificantChange: [],
    stableStateCycles: [],
  }
);

export const WorkingMemory = WorkingMemoryComponent.component;
