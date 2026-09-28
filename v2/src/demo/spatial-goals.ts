/** Read-only operator projection; never selects an action or grants execution. */
import { entityExists, getRelationTargets, hasComponent } from "bitecs";
import type { World } from "../ecs/world";
import { Agent, Goal, WorkingMemoryIdentity } from "../ecs/components";
import { HasGoal } from "../ecs/relations";
import { observeOngoingActivity } from "../cognition/ongoing-activity";
import { situatedPlanGoal } from "../cognition/decision-policy";
import { isStandingIntention } from "../cognition/goal-lifecycle";
import type { SpatialOperatorActor } from "./spatial-contract";

export function projectSpatialGoals(world: World, actor: number): Pick<SpatialOperatorActor, "focus" | "goals"> {
  if (!entityExists(world, actor) || !hasComponent(world, actor, Agent)) return { goals: [] };
  const goals = getRelationTargets(world, actor, HasGoal).filter(id => entityExists(world, id)
    && hasComponent(world, id, Goal) && ["active", "in_progress"].includes(Goal.status[id]) && Goal.description[id]?.trim())
    .map(id => ({ id, key: hasComponent(world, id, WorkingMemoryIdentity) && WorkingMemoryIdentity.id[id]
      || `unbound-goal:${id}:${Goal.createdAt[id]}`, description: Goal.description[id].slice(0, 400),
      status: Goal.status[id], priority: Number.isFinite(Goal.priority[id]) ? Goal.priority[id] : 0 }))
    .sort((a, b) => b.priority - a.priority || a.id - b.id);
  const activity = observeOngoingActivity(world, actor);
  const current = activity?.status === "active" && !activity.needsRevalidation && activity.currentGoal
    && goals.find(goal => goal.id === activity.goalId);
  // Reuse the actor-owned choice's existing identity/source/freshness checks;
  // showing a goal is neither execution nor a claim that its work has begun.
  const chosen = situatedPlanGoal(world, actor);
  const fallback = goals.find(goal => goal.id === chosen)
    ?? goals.find(goal => !isStandingIntention(world, goal.id)) ?? goals[0];
  const focus = current ? { description: current.description, kind: "activity" as const, status: "active" }
    : fallback ? { description: fallback.description, kind: "goal" as const, status: fallback.status } : undefined;
  return { ...(focus ? { focus } : {}), goals: goals.slice(0, 3) };
}
