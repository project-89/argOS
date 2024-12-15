import { z } from "zod";
import { createComponent } from "./createComponent";

// Plan step schema
export const PlanStepSchema = z.object({
  id: z.string(),
  description: z.string(),
  status: z.enum(["pending", "in_progress", "completed", "failed"]),
  order: z.number(),
  expectedOutcome: z.string().optional(),
  estimatedDuration: z.number().optional(),
  startTime: z.number().optional(),
  endTime: z.number().optional(),
});

export type PlanStepType = z.infer<typeof PlanStepSchema>;

// Plans schema and component
export const PlanSchema = z.object({
  plans: z.array(
    z.object({
      id: z.string(),
      description: z.string(),
      goalId: z.string(),
      steps: z.array(PlanStepSchema),
      currentStepId: z.string().optional(),
      status: z.enum(["active", "completed", "failed", "suspended"]),
      priority: z.number(),
      createdAt: z.number(),
      updatedAt: z.number(),
      deadline: z.number().optional(),
      metadata: z.record(z.string(), z.any()).optional(),
    })
  ),
  activePlanIds: z.array(z.string()),
  lastUpdate: z.number(),
});

export type SinglePlanType = z.infer<typeof PlanSchema.shape.plans>[number];
export type PlanType = z.infer<typeof PlanSchema>;

export const PlanComponent = createComponent("Plan", PlanSchema, {
  plans: [] as Array<{
    id: string;
    description: string;
    goalId: string;
    steps: PlanStepType[];
    currentStepId?: string;
    status: "active" | "completed" | "failed" | "suspended";
    priority: number;
    createdAt: number;
    updatedAt: number;
    deadline?: number;
    metadata?: Record<string, any>;
  }>[],
  activePlanIds: [] as string[][],
  lastUpdate: [] as number[],
});

export const Plan = PlanComponent.component;
