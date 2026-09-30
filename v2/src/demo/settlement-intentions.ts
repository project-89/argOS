/** Tending a settlement resident's own resolve (goals their mind set in talk).
 *
 * Minds in a drama keep setting fresh intentions — "stand guard at Tent 7",
 * "hold my ground at the flap", "face Ivo and deflect" — and nothing closed the
 * old ones, so a resident carried five contradictory priority-9 goals. This is
 * the engine's own intention lifecycle applied on the settlement clock:
 *
 * - Newer resolve overtakes older: beyond the newest few, older intentions are
 *   put up for reconsideration (paused, review pending) — never marked done.
 * - Resolve goes quiet: an intention unrenewed for part of a game day is put up
 *   for reconsideration the same way.
 * - Let go: a reconsideration nobody's mind got round to reviewing within a
 *   while is retired as let go (explicitly not accomplishment), so paused
 *   intentions never fill the resident's quota for new ones.
 *
 * Only intentions their mind set in play are tended; the authored ones they
 * started with (their trade's duty, a personal aim) are theirs to keep.
 * Nothing here claims success; the mind (experience appraisal) or a fast judge
 * may review a paused intention and keep, defer or release it. */
import { getRelationTargets, hasComponent } from "bitecs";
import { Goal, GoalLifecycle } from "../ecs/components";
import type { World } from "../ecs/world";
import { HasGoal, HasPlan } from "../ecs/relations";
import { isSelfDirectedIntention, isStandingIntention, pendingIntentionReview, requestIntentionReconsideration } from "../cognition/goal-lifecycle";
import { retireGoalPlans } from "../cognition/plan-state";
import { getStampedSimulationTime, readStampedSimulationTime, stampSimulationTime } from "../ecs/temporal-age";
import { readSimulationTime } from "../ecs/simulation-time";

export type IntentionTending = {
  /** How many of their own active intentions a resident carries at once (newest kept). */
  keep: number;
  /** Simulation ms an intention may go unrenewed before it is put up for reconsideration. */
  quietAfterMs: number;
  /** Simulation ms a pending reconsideration may wait unreviewed before it is let go. */
  letGoAfterMs: number;
};
export type TendedIntention = { goal: number; description: string; outcome: "reconsider" | "let go"; reason: string };

export const OVERTAKEN = "Newer resolve has overtaken this intention. Reconsider whether it still matters; nothing about it is claimed done.";
export const WENT_QUIET = "This intention has gone quiet for most of a day. Reconsider whether to keep, defer or release it; quiet is not abandonment.";
export const LET_GO = "Set aside and never taken up again; let go. This is not accomplishment.";

/** Intentions their own mind set in play — not the authored ones they started with (a trade's duty, a personal aim). */
const own = (world: World, eid: number) => getRelationTargets(world, eid, HasGoal)
  .filter(g => hasComponent(world, g, Goal) && isSelfDirectedIntention(world, g) && !isStandingIntention(world, g) && GoalLifecycle.source[g] !== "personal");
/** When the intention was last set or renewed, in simulation time. */
const renewedAt = (world: World, g: number) => Math.max(readStampedSimulationTime(world, g, "Goal.createdAt", Goal.createdAt[g]),
  getStampedSimulationTime(world, g, "GoalLifecycle.resumedAt", GoalLifecycle.resumedAt[g]) ?? -Infinity);

/** A resident's own active intentions, newest first. */
export function activeOwnIntentions(world: World, eid: number): number[] {
  return own(world, eid).filter(g => Goal.status[g] === "active").sort((a, b) => renewedAt(world, b) - renewedAt(world, a));
}

/** Apply the three rules once; returns what changed. */
export function tendIntentions(world: World, eid: number, rules: IntentionTending): TendedIntention[] {
  const now = readSimulationTime(world), out: TendedIntention[] = [];
  const reconsider = (goal: number, reason: string) => {
    if (requestIntentionReconsideration(world, eid, goal, reason)) out.push({ goal, description: Goal.description[goal], outcome: "reconsider", reason });
  };
  const active = activeOwnIntentions(world, eid);
  for (const goal of active.slice(rules.keep)) reconsider(goal, OVERTAKEN);
  for (const goal of active.slice(0, rules.keep)) if (now - renewedAt(world, goal) > rules.quietAfterMs) reconsider(goal, WENT_QUIET);
  for (const goal of own(world, eid)) {
    if (Goal.status[goal] !== "paused") continue;
    const review = pendingIntentionReview(world, eid, goal);
    if (!review || now - review.atSimMs <= rules.letGoAfterMs) continue;
    Goal.status[goal] = "retired"; GoalLifecycle.reason[goal] = LET_GO; GoalLifecycle.reviewPendingJson[goal] = "";
    GoalLifecycle.settledAt[goal] = Date.now(); stampSimulationTime(world, goal, "GoalLifecycle.settledAt", GoalLifecycle.settledAt[goal], now);
    retireGoalPlans(world, goal, getRelationTargets(world, eid, HasPlan));
    out.push({ goal, description: Goal.description[goal], outcome: "let go", reason: LET_GO });
  }
  return out;
}
