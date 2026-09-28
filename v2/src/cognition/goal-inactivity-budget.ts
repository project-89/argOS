import { addComponent, entityExists, hasComponent } from "bitecs";
import { Goal, GoalInactivityBudget } from "../ecs/components";
import type { World } from "../ecs/world";

function goalIdentity(goal: number): string {
  // Bind authoritative fields, not a possibly stale cached signature. Progress,
  // priority and plan changes do not replace the episode or renew its budget.
  return JSON.stringify([Goal.createdAt[goal], Goal.description[goal] || "",
    Goal.kind[goal] || "", Goal.paramsJson[goal] || "", Goal.successJson[goal] || ""]);
}

/** Author an explicit stall policy only after establishing the goal episode.
 * It is independent of proof, actor choice and the absolute deadline. */
export function setGoalInactivityBudget(world: World, goal: number, timeoutMs: number): void {
  if (!entityExists(world, goal) || !hasComponent(world, goal, Goal)
    || !Number.isFinite(timeoutMs) || timeoutMs <= 0
    || !Number.isFinite(Goal.createdAt[goal]) || Goal.createdAt[goal] <= 0)
    throw new Error("A goal inactivity budget requires a valid goal episode and positive finite duration");
  if (!hasComponent(world, goal, GoalInactivityBudget)) addComponent(world, goal, GoalInactivityBudget);
  GoalInactivityBudget.timeoutMs[goal] = timeoutMs;
  GoalInactivityBudget.goalIdentity[goal] = goalIdentity(goal);
}

/** Read-only, including for legacy saves and reused entity slots. An old episode
 * cannot lend its policy to a replacement contract; unknown policy uses default. */
export function readGoalInactivityBudget(world: World, goal: number, fallbackMs: number): number {
  if (!entityExists(world, goal) || !hasComponent(world, goal, Goal)
    || !hasComponent(world, goal, GoalInactivityBudget)
    || GoalInactivityBudget.goalIdentity[goal] !== goalIdentity(goal)) return fallbackMs;
  const budget = GoalInactivityBudget.timeoutMs[goal];
  return Number.isFinite(budget) && budget > 0 ? budget : fallbackMs;
}
