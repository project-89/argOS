import { z } from "zod";
import { createComponent } from "./createComponent";

// Goals schema and component
export const GoalSchema = z.object({
  goals: z.array(
    z.object({
      id: z.string(),
      description: z.string(),
      priority: z.number(),
      type: z.enum(["long_term", "short_term", "immediate"]),
      status: z.enum(["active", "completed", "failed", "suspended"]),
      progress: z.number(),
      deadline: z.number().optional(),
      parentGoalId: z.string().optional(),
      createdAt: z.number(),
      updatedAt: z.number(),
      metadata: z.record(z.string(), z.any()).optional(),
    })
  ),
  activeGoalIds: z.array(z.string()),
  lastUpdate: z.number(),
});

export type SingleGoalType = z.infer<typeof GoalSchema.shape.goals>[number];
export type GoalType = z.infer<typeof GoalSchema>;

export const GoalComponent = createComponent("Goal", GoalSchema, {
  goals: [] as Array<{
    id: string;
    description: string;
    priority: number;
    type: "long_term" | "short_term" | "immediate";
    status: "active" | "completed" | "failed" | "suspended";
    progress: number;
    deadline?: number;
    parentGoalId?: string;
    createdAt: number;
    updatedAt: number;
    metadata?: Record<string, any>;
  }>[],
  activeGoalIds: [] as string[][],
  lastUpdate: [] as number[],
});

export const Goal = GoalComponent.component;
