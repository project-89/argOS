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
  current: z.array(GoalItemSchema),
  completed: z.array(GoalItemSchema),
  lastUpdate: z.number(),
  lastEvaluationTime: z.number(),
});

export type GoalType = z.infer<typeof GoalSchema>;
export type SingleGoalType = z.infer<typeof GoalItemSchema>;

export const GoalComponent = createComponent("Goal", GoalSchema, {
  current: [],
  completed: [],
  lastUpdate: [],
  lastEvaluationTime: [],
});

export const Goal = GoalComponent.component;
