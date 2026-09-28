/** Supporting intentions inherit purpose, not completion. Ending a parent
 * retires dependent proposals; physical callbacks and their receipts stay owned
 * by the action executor. */
import { addComponent, getRelationTargets, hasComponent } from "bitecs";
import { Goal, GoalLifecycle } from "../ecs/components";
import { HasGoal, HasPlan } from "../ecs/relations";
import { stampSimulationTime } from "../ecs/temporal-age";
import type { World } from "../ecs/world";
import { ensureGoalSignature } from "./goal-contract";
import { assertSimulationTaskActive } from "../runtime/task-scope";
import { settleReviewedGoalActivity } from "./ongoing-activity";
import { retireGoalPlans } from "./plan-state";

export function bindSupportingGoal(world: World, actor: number, goal: number, parent: number): void {
  assertSimulationTaskActive();
  const owned = getRelationTargets(world, actor, HasGoal);
  if (goal === parent || !owned.includes(goal) || !owned.includes(parent) || !hasComponent(world, goal, Goal) || !hasComponent(world, parent, Goal))
    throw new Error("Supporting goals require distinct actor-owned goal entities");
  if (!hasComponent(world, goal, GoalLifecycle)) {
    addComponent(world, goal, GoalLifecycle);
    GoalLifecycle.source[goal] = "derived"; GoalLifecycle.mode[goal] = "verified"; GoalLifecycle.persistence[goal] = "episodic";
    GoalLifecycle.settledAt[goal] = 0; GoalLifecycle.reason[goal] = ""; GoalLifecycle.reviewAfter[goal] = 0;
    GoalLifecycle.deferredJson[goal] = ""; GoalLifecycle.resumedAt[goal] = 0;
  }
  GoalLifecycle.parentGoalEid[goal] = parent; GoalLifecycle.parentCreatedAt[goal] = Goal.createdAt[parent];
  GoalLifecycle.parentSignature[goal] = ensureGoalSignature(world, parent) || "";
}

/** Same ownership/episode traversal for read-only admission and retirement. */
export function getGoalDependents(world: World, actor: number, parent: number): number[] {
  const owned = getRelationTargets(world, actor, HasGoal).filter(g => hasComponent(world, g, Goal));
  if (!owned.includes(parent)) return [];
  const visited = new Set<number>([parent]), queue = [parent];
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    for (const child of owned) {
      if (visited.has(child) || !hasComponent(world, child, GoalLifecycle)
        || GoalLifecycle.parentGoalEid[child] !== current || GoalLifecycle.parentCreatedAt[child] !== Goal.createdAt[current]
        || GoalLifecycle.parentSignature[child] !== Goal.signature[current]) continue;
      visited.add(child); queue.push(child);
    }
  }
  return queue.slice(1);
}

export function retireGoalDependents(world: World, actor: number, parent: number, reason: string): number {
  assertSimulationTaskActive();
  let count = 0;
  for (const child of getGoalDependents(world, actor, parent)) {
    if (!["active", "queued", "paused", "pending"].includes(Goal.status[child])) continue;
    Goal.status[child] = "retired"; GoalLifecycle.deferredJson[child] = ""; GoalLifecycle.reason[child] = reason;
    GoalLifecycle.settledAt[child] = Date.now(); stampSimulationTime(world, child, "GoalLifecycle.settledAt", GoalLifecycle.settledAt[child]);
    settleReviewedGoalActivity(world, actor, child, "release");
    retireGoalPlans(world, child, getRelationTargets(world, actor, HasPlan));
    count++;
  }
  return count;
}
