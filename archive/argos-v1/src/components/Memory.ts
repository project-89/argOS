import { z } from "zod";
import { createComponent } from "./createComponent";

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
      queries: z.array(z.string()).optional(),
      data: z.record(z.any()).optional(),
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

export type MemoryType = z.infer<typeof MemorySchema>;

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
    queries?: string[];
    data?: Record<string, any>;
  }>[],
});

export const Memory = MemoryComponent.component;
