/** Evaluation instrumentation only. This does not choose an NPC action. */
import { createHash } from "node:crypto";
import { getRelationTargets, hasComponent } from "bitecs";
import type { WorldContext } from "../ecs/world";
import { Goal, Plan } from "../ecs/components";
import { HasGoal, HasPlan } from "../ecs/relations";
import { hasPendingPlanning } from "../cognition/planning-system";
import { transitionObjectState, type EffectContext } from "../world/effect-executor";

export function settledReview(world: WorldContext, actorEid: number) {
  const goals = getRelationTargets(world, actorEid, HasGoal);
  const plans = getRelationTargets(world, actorEid, HasPlan)
    .filter(id => hasComponent(world, id, Plan) && goals.includes(Plan.goalEid[id])
      && hasComponent(world, Plan.goalEid[id], Goal) && Goal.status[Plan.goalEid[id]] === "active")
    .sort((a, b) => (Plan.createdAt[b] || 0) - (Plan.createdAt[a] || 0) || b - a);
  const id = plans[0];
  if (id === undefined || plans.some(p => Plan.status[p] === "active")
    || Plan.status[id] !== "completed" || hasPendingPlanning(world, actorEid, { background: true })) return null;
  try {
    const steps = JSON.parse(Plan.steps[id]);
    const dependency = Array.isArray(steps) && steps.at(-1)?.completedWorkDependency;
    if (typeof dependency !== "string") return null;
    return { planId: id, goalId: Plan.goalEid[id], fingerprint: createHash("sha256")
      .update(JSON.stringify([actorEid, id, Plan.createdAt[id], Plan.lastUpdated[id], dependency])).digest("hex") };
  } catch { return null; }
}

/** One continuous eligible interval, measured only in simulation time. */
export class PostQuietDisturbanceGate {
  private since: number | null = null;
  private identity: string | null = null;
  private previousSimMs = -1;
  private fired = false;
  constructor(readonly quietMs = 60_000, readonly responseWindowMs = 90_000) {}
  consider(input: { simMs: number; remainingWallMs: number; remainingSimMs: number;
    sourceId: string | null; reviewKey: string | null; mechanicActive: boolean; valveClosed: boolean }) {
    const key = input.sourceId && input.reviewKey ? JSON.stringify([input.sourceId, input.reviewKey]) : null;
    const eligible = Number.isFinite(input.simMs) && input.simMs >= 0 && key !== null
      && input.mechanicActive && input.valveClosed;
    if (!eligible || input.simMs < this.previousSimMs || key !== this.identity) {
      this.since = eligible ? input.simMs : null;
      this.identity = eligible ? key : null;
    }
    this.previousSimMs = input.simMs;
    if (this.fired || this.since === null || input.simMs - this.since < this.quietMs
      || !(input.remainingWallMs >= this.responseWindowMs) || !(input.remainingSimMs >= this.responseWindowMs)) return false;
    this.fired = true;
    return true;
  }
}

/** A labelled fixture fault, not a forged actor action, goal, thought or receipt. */
export function reopenFixtureValve(ctx: EffectContext, valveEid: number) {
  return transitionObjectState(ctx.world, valveEid, "open", ctx, "diagnostic physical fault");
}
