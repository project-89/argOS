import { z } from "zod";
import { createComponent } from "./createComponent";

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
