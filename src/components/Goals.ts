import { z } from "zod";
import { createComponent } from "./createComponent";

// Define the goal item schema
export const GoalItemSchema = z.object({
  id: z.string(),
  description: z.string(),
  priority: z.number(),
  type: z.enum(["immediate", "short_term", "medium_term", "long_term"]),
  status: z.enum(["pending", "in_progress", "completed", "failed"]),
  progress: z.number(),
  success_criteria: z.array(z.string()),
  progress_indicators: z.array(z.string()),
  created_at: z.number(),
  criteria_met: z.array(z.string()).optional(),
  criteria_partial: z.array(z.string()).optional(),
  criteria_blocked: z.array(z.string()).optional(),
  next_steps: z.array(z.string()).optional(),
});

// Goals schema and component
export const GoalSchema = z.object({
  id: z.string(),
  description: z.string(),
  type: z.enum(["immediate", "short_term", "medium_term", "long_term"]),
  priority: z.number(),
  progress: z.number(),
  status: z.enum(["pending", "in_progress", "completed", "failed"]),
  success_criteria: z.array(z.string()),
  progress_indicators: z.array(z.string()),
  created_at: z.number(),
});

export type GoalType = z.infer<typeof GoalSchema>;
export type SingleGoalType = z.infer<typeof GoalItemSchema>;

export const GoalComponent = createComponent(
  "Goal",
  z.object({
    current: z.array(GoalSchema),
    completed: z.array(GoalSchema),
    lastUpdate: z.number(),
    lastEvaluationTime: z.number(),
  }),
  {
    current: [] as GoalType[][],
    completed: [] as GoalType[][],
    lastUpdate: [] as number[],
    lastEvaluationTime: [] as number[],
  }
);

export const Goal = GoalComponent.component;
