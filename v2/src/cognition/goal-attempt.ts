/** Actor-owned execution history. Neither an action permit nor success proof. */
import { randomUUID } from "node:crypto";
import { addComponent, entityExists, getRelationTargets, hasComponent } from "bitecs";
import type { World } from "../ecs/world";
import { Agent, Goal, GoalAttempt, WorkingMemoryIdentity } from "../ecs/components";
import { HasGoal } from "../ecs/relations";
import { readSimulationTime } from "../ecs/simulation-time";
import { assertSimulationTaskActive } from "../runtime/task-scope";

function owned(world: World, actor: number, goal: number): boolean {
  return entityExists(world, actor) && hasComponent(world, actor, Agent)
    && entityExists(world, goal) && hasComponent(world, goal, Goal)
    && getRelationTargets(world, actor, HasGoal).includes(goal);
}
function contract(goal: number): string {
  return JSON.stringify([Goal.createdAt[goal], Goal.description[goal], Goal.kind[goal], Goal.paramsJson[goal], Goal.successJson[goal]]);
}
function key(world: World, eid: number): string | undefined {
  return hasComponent(world, eid, WorkingMemoryIdentity) ? WorkingMemoryIdentity.id[eid] : undefined;
}
function ensureKey(world: World, eid: number): string {
  if (!key(world, eid)) {
    addComponent(world, eid, WorkingMemoryIdentity); WorkingMemoryIdentity.id[eid] = `entity:${randomUUID()}`;
  }
  return WorkingMemoryIdentity.id[eid];
}
function current(world: World, actor: number, goal: number): boolean {
  return owned(world, actor, goal) && hasComponent(world, goal, GoalAttempt)
    && !!key(world, actor) && !!key(world, goal)
    && GoalAttempt.actorKey[goal] === key(world, actor) && GoalAttempt.goalKey[goal] === key(world, goal)
    && GoalAttempt.contract[goal] === contract(goal);
}
function ensure(world: World, actor: number, goal: number): boolean {
  assertSimulationTaskActive();
  if (!owned(world, actor, goal) || Goal.status[goal] !== "active") return false;
  if (!current(world, actor, goal)) {
    // Legacy 95 was an exhausted-macro sentinel. Keep its conservative replay
    // inhibition during migration, never interpret it as measured achievement.
    const legacyExhausted = !hasComponent(world, goal, GoalAttempt) && Goal.progress[goal] >= 95;
    addComponent(world, goal, GoalAttempt);
    GoalAttempt.actorKey[goal] = ensureKey(world, actor); GoalAttempt.goalKey[goal] = ensureKey(world, goal);
    GoalAttempt.contract[goal] = contract(goal); GoalAttempt.lastActivitySimMs[goal] = -1;
    GoalAttempt.exhaustedMacrosJson[goal] = JSON.stringify(legacyExhausted ? ["*"] : []);
  }
  return true;
}
function exhausted(goal: number): string[] | undefined {
  try {
    const rows = JSON.parse(GoalAttempt.exhaustedMacrosJson[goal]);
    if (Array.isArray(rows) && rows.length <= 32 && rows.every(s => typeof s === "string" && s.length > 0 && s.length <= 512)) return rows;
  } catch { /* Invalid attempt history cannot authorize an automatic retry. */ }
}
export function recordGoalAttemptActivity(world: World, actor: number, goal: number): void {
  if (ensure(world, actor, goal)) GoalAttempt.lastActivitySimMs[goal] = readSimulationTime(world);
}
export function readGoalAttemptActivity(world: World, actor: number, goal: number): number | undefined {
  if (!current(world, actor, goal)) return;
  const at = GoalAttempt.lastActivitySimMs[goal];
  return Number.isFinite(at) && at >= 0 && at <= readSimulationTime(world) ? at : undefined;
}
export function isGoalMacroExhausted(world: World, actor: number, goal: number, signature: string): boolean {
  if (!owned(world, actor, goal)) return true;
  if (!current(world, actor, goal)) return !hasComponent(world, goal, GoalAttempt) && Goal.progress[goal] >= 95;
  const rows = exhausted(goal);
  return !rows || rows.includes("*") || rows.includes(signature);
}
export function exhaustGoalMacro(world: World, actor: number, goal: number, signature: string): void {
  if (!ensure(world, actor, goal)) return;
  const rows = exhausted(goal);
  GoalAttempt.exhaustedMacrosJson[goal] = JSON.stringify(!rows || rows.includes("*") || rows.length >= 32 || signature.length > 512
    ? ["*"] : [...new Set([...rows, signature])]);
}
