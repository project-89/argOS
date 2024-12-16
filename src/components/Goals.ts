import { z } from "zod";
import { createComponent } from "./createComponent";

// Define the goal item schema
const GoalItemSchema = z.object({
  id: z.string(),
  description: z.string(),
  priority: z.number(),
  type: z.enum(["long_term", "short_term", "immediate"]),
  status: z.enum(["active", "completed", "failed", "suspended"]),
  progress: z.number(),
  success_criteria: z.array(z.string()),
  progress_indicators: z.array(z.string()),
  created_at: z.number(),
});

// Goals schema and component
export const GoalSchema = z.object({
  current: z.array(GoalItemSchema),
  completed: z.array(GoalItemSchema),
  lastUpdate: z.number(),
});

export type GoalType = z.infer<typeof GoalSchema>;
export type SingleGoalType = z.infer<typeof GoalItemSchema>;

export const GoalComponent = createComponent("Goal", GoalSchema, {
  current: [],
  completed: [],
  lastUpdate: [],
});

export const Goal = GoalComponent.component;
