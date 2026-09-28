import { getRelationTargets, hasComponent } from "bitecs";
import { Goal, WorkingMemoryIdentity } from "../ecs/components";
import { HasGoal } from "../ecs/relations";
import type { World } from "../ecs/world";
import { readSimulationTime } from "../ecs/simulation-time";
import { snapshotActorContinuation } from "./actor-continuation";
import { snapshotOngoingActivity } from "./ongoing-activity";

/** Experimental high-level selection policy; neither option changes execution
 * authority. Kept world-local so separate simulations cannot switch each other. */
export type CognitionController = "priority" | "situated";
export function parseCognitionController(value: unknown): CognitionController {
  if (value === "priority" || value === "situated") return value;
  throw new Error("Unknown cognition controller; choose priority or situated");
}
export function cognitionController(world: World): CognitionController {
  return parseCognitionController(world.meta.cognitionController ?? "priority");
}

export const SITUATED_SELECTION = `Take in your situation as a whole: who you are, what has happened to
you, the people here and what is between you, what you want and what you are
hiding. Then act. Keep a purpose while it still matters to you; change it the
moment something changes your mind. A blocked approach just means finding
another way. Use goalUpdate for a genuinely new intention, not a copy of one you
already hold, and review your intentions with their listed operations.`;

/** Only a recently chosen purpose may recruit a stored plan. No highest-goal
 * fallback. Reconsider at least every ten simulated seconds, and immediately
 * on new attention (checked by the caller). Restored/private edits confer no
 * execution authority; snapshotActorContinuation preserves those fences. */
export function situatedPlanGoal(world: World, eid: number): number | undefined {
  const focus = snapshotActorContinuation(world, eid);
  const age = focus ? readSimulationTime(world) - focus.integratedAtSimMs : Infinity;
  if (!focus || !["proposed", "dispatched"].includes(focus.status) || age < 0 || age >= 10_000
    || focus.goalId === undefined || !getRelationTargets(world, eid, HasGoal).includes(focus.goalId)
    || !hasComponent(world, focus.goalId, Goal) || Goal.status[focus.goalId] !== "active"
    || !hasComponent(world, focus.goalId, WorkingMemoryIdentity)
    || WorkingMemoryIdentity.id[focus.goalId] !== focus.goalKey) return;
  const activity = snapshotOngoingActivity(world, eid);
  // Persistent intention can inhibit a lease, never create one. Resumption
  // still requires the fresh selected-purpose checks above.
  if (activity?.goalKey === focus.goalKey && (activity.status !== "active" || activity.needsRevalidation)) return;
  return focus.goalId;
}

/** A completed independent side turn can return to a validated organizing
 * activity. This selects a candidate goal only; it is not action authority. */
export function activityResumptionGoal(world: World, eid: number): number | undefined {
  const focus = snapshotActorContinuation(world, eid), activity = snapshotOngoingActivity(world, eid);
  if (!focus || focus.status !== "dispatched" || focus.goalId !== undefined
    || !["speak", "think"].includes(focus.actionType) || !activity
    || activity.status !== "active" || activity.needsRevalidation) return;
  const matches = getRelationTargets(world, eid, HasGoal).filter(goal => hasComponent(world, goal, Goal)
    && Goal.status[goal] === "active" && hasComponent(world, goal, WorkingMemoryIdentity)
    && WorkingMemoryIdentity.id[goal] === activity.goalKey);
  return matches.length === 1 ? matches[0] : undefined;
}
