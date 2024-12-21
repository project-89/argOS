import { z } from "zod";
import { createComponent } from "./createComponent";

export const WorkingMemorySchema = z.object({
  lastStimuliHash: z.string(),
  lastSignificantChange: z.number(),
  stableStateCycles: z.number(),
});

export type WorkingMemoryType = z.infer<typeof WorkingMemorySchema>;

export const WorkingMemoryComponent = createComponent(
  "WorkingMemory",
  WorkingMemorySchema,
  {
    lastStimuliHash: [],
    lastSignificantChange: [],
    stableStateCycles: [],
  }
);

export const WorkingMemory = WorkingMemoryComponent.component;
