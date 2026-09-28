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
      progress: z.number().optional(),
      metadata: z.record(z.string(), z.any()).optional(),
    })
  ),
  lastUpdate: z.number(),
});

export type SinglePlanType = z.infer<typeof PlanSchema.shape.plans>[number];
export type PlanType = z.infer<typeof PlanSchema>;

export const PlanComponent = createComponent("Plan", PlanSchema, {
  plans: [] as SinglePlanType[],
  lastUpdate: [] as number[],
});

export const Plan = PlanComponent.component;

// Helper functions for plan management
export function getActivePlans(plans: SinglePlanType[]): SinglePlanType[] {
  return plans.filter((plan) => plan.status === "active");
}

export function getPlansForGoal(
  plans: SinglePlanType[],
  goalId: string
): SinglePlanType[] {
  return plans.filter((plan) => plan.goalId === goalId);
}

export function updatePlanStatus(
  plans: SinglePlanType[],
  planId: string,
  status: "active" | "completed" | "failed" | "suspended",
  progress: number = 0
): void {
  const plan = plans.find((p) => p.id === planId);
  if (plan) {
    plan.status = status;
    plan.progress = progress;
    plan.updatedAt = Date.now();
  }
}

// Helper to get active plans for a goal
export function getActivePlansForGoal(
  plans: SinglePlanType[],
  goalId: string
): SinglePlanType[] {
  return plans.filter(
    (plan) => plan.goalId === goalId && plan.status === "active"
  );
}
