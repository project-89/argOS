import { z } from "zod";
import { createComponent } from "./createComponent";

// Define a schema for individual actions within a sequence
export const ActionSequenceItemSchema = z.object({
  id: z.string(),
  tool: z.string(),
  parameters: z.record(z.any()),
  result: z.object({
    success: z.boolean(),
    result: z.string(),
    timestamp: z.number(),
  }),
  order: z.number(),
});

export type ActionSequenceItem = z.infer<typeof ActionSequenceItemSchema>;

// Define a schema for action sequences
export const ActionSequenceSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  description: z.string(),
  actions: z.array(ActionSequenceItemSchema),
  goalIds: z.array(z.string()).optional(), // Associated goals
  planIds: z.array(z.string()).optional(), // Associated plans
  startTime: z.number(),
  endTime: z.number().optional(),
  success: z.boolean().optional(), // Overall success of the sequence
  reflection: z.string().optional(), // Agent's reflection on the sequence
  tags: z.array(z.string()).optional(), // For categorization and retrieval
  effectiveness: z.number().optional(), // Rating from 0-1 of how effective this sequence was
  context: z.record(z.any()).optional(), // Additional context about when this sequence was used
});

export type ActionSequence = z.infer<typeof ActionSequenceSchema>;

// Define the main ActionMemory component schema
export const ActionMemorySchema = z.object({
  sequences: z.array(ActionSequenceSchema), // Completed action sequences
  currentSequence: ActionSequenceSchema.optional(), // Currently executing sequence
  lastUpdate: z.number(),
});

export type ActionMemoryType = z.infer<typeof ActionMemorySchema>;

// Create the component
export const ActionMemoryComponent = createComponent(
  "ActionMemory",
  ActionMemorySchema,
  {
    sequences: [] as ActionSequence[][],
    currentSequence: [] as (ActionSequence | undefined)[],
    lastUpdate: [] as number[],
  }
);

export const ActionMemory = ActionMemoryComponent.component;

// Helper functions for action memory management
export function startNewSequence(
  description: string,
  goalIds?: string[],
  planIds?: string[]
): ActionSequence {
  return {
    id: `seq_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    description,
    actions: [],
    goalIds: goalIds || [],
    planIds: planIds || [],
    startTime: Date.now(),
    tags: [],
  };
}

export function addActionToSequence(
  sequence: ActionSequence,
  tool: string,
  parameters: Record<string, any>,
  result: { success: boolean; result: string; timestamp: number }
): ActionSequence {
  const newAction: ActionSequenceItem = {
    id: `act_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    tool,
    parameters,
    result,
    order: sequence.actions.length,
  };

  return {
    ...sequence,
    actions: [...sequence.actions, newAction],
  };
}

export function completeSequence(
  sequence: ActionSequence,
  success: boolean,
  reflection?: string
): ActionSequence {
  return {
    ...sequence,
    endTime: Date.now(),
    success,
    reflection,
  };
}

export function findSimilarSequences(
  sequences: ActionSequence[],
  goalId?: string,
  tags?: string[],
  toolName?: string
): ActionSequence[] {
  return sequences
    .filter((seq) => {
      // Filter by goal if provided
      if (goalId && seq.goalIds && !seq.goalIds.includes(goalId)) {
        return false;
      }

      // Filter by tags if provided
      if (tags && tags.length > 0 && seq.tags) {
        if (!tags.some((tag) => seq.tags?.includes(tag))) {
          return false;
        }
      }

      // Filter by tool name if provided
      if (toolName) {
        if (!seq.actions.some((action) => action.tool === toolName)) {
          return false;
        }
      }

      return true;
    })
    .sort((a, b) => {
      // Sort by effectiveness (if available) or success
      if (a.effectiveness !== undefined && b.effectiveness !== undefined) {
        return b.effectiveness - a.effectiveness;
      }

      if (a.success === true && b.success !== true) return -1;
      if (a.success !== true && b.success === true) return 1;

      // Sort by recency as fallback
      return (b.endTime || 0) - (a.endTime || 0);
    });
}

// Get the most successful sequences for a specific goal
export function getMostSuccessfulSequences(
  sequences: ActionSequence[],
  goalId: string,
  limit: number = 3
): ActionSequence[] {
  return findSimilarSequences(sequences, goalId)
    .filter((seq) => seq.success === true)
    .slice(0, limit);
}
