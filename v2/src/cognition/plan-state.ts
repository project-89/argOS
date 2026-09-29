import { getRelationTargets, hasComponent } from "bitecs";
import type { World } from "../ecs/world";
import { Goal, Plan } from "../ecs/components";
import { HasPlan } from "../ecs/relations";

/** Observer for a goal that was completed (by any authority, including a
 * subjective/offstage judgement) while one of its plans was still active. The
 * plan compiler registers here to keep "how I did it" from the executed steps;
 * a listener never changes the transition. */
type CompletedGoalPlanListener = (world: World, goal: number, plan: number) => void;
let completedGoalPlanListener: CompletedGoalPlanListener | undefined;
export function setCompletedGoalPlanListener(listener: CompletedGoalPlanListener | undefined): void {
  completedGoalPlanListener = listener;
}

/** Internal lifecycle transition, not an actor-facing command. Callers decide
 * the authorized goal transition and supply their existing owned/indexed plan
 * set. Retire drafts only: preserve cursors, evidence and in-flight native jobs.
 * Pending decisions and motor steps share the same goal lifetime. */
export function retireGoalPlans(world: World, goal: number, plans: Iterable<number>): void {
  for (const plan of plans) {
    if (!hasComponent(world, plan, Plan) || Plan.goalEid[plan] !== goal) continue;
    if (Plan.status[plan] === "active" && completedGoalPlanListener && hasComponent(world, goal, Goal) && Goal.status[goal] === "completed") {
      try { completedGoalPlanListener(world, goal, plan); } catch { /* learning is never allowed to block a lifecycle transition */ }
    }
    if (Plan.status[plan] === "active" || Plan.status[plan] === "awaiting_evidence"
      || Plan.status[plan] === "awaiting_decision") Plan.status[plan] = "retired";
  }
}

/** A pending decision still owns the plan slot; it is not a completed plan. */
export function getPlanForGoal(world: World, actor: number, goal: number): number | undefined {
  let best: number | undefined, bestScore = -Infinity;
  for (const id of getRelationTargets(world, actor, HasPlan)) {
    if (!hasComponent(world, id, Plan) || Plan.goalEid[id] !== goal) continue;
    const score = (["active", "awaiting_decision"].includes(Plan.status[id]) ? 1_000_000_000_000 : 0)
      + Math.max(Number(Plan.lastUpdated[id] || 0), Number(Plan.createdAt[id] || 0));
    if (score > bestScore || score === bestScore && id > (best ?? -1)) { best = id; bestScore = score; }
  }
  return best;
}
