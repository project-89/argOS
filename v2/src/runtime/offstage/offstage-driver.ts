/** The offstage driver: traditional AI for residents nobody is watching.
 * A fast-loop step (no awaits, no model). For each free offstage body, at most
 * one native action every few simulated seconds, chosen in this order:
 *   0. an action the resident took in the last summarized scene (queued),
 *   a. a learned procedure/macro or behaviour-tree step (System-1 skills that
 *      grow as the world matures, offloading behaviour from the model),
 *   b. the next stored plan step for their highest-priority active goal,
 *   c. walking to where their schedule says they should be,
 *   d. idle life in keeping with the place (a free seat, a look at something,
 *      a short stroll).
 * Everything goes through executeActions and the world package's executor, so
 * movement is real pathfinding with collisions, and outcomes are real receipts.
 * Nothing is marked complete here. */
import { getRelationTargets, hasComponent, query } from "bitecs";
import type { World } from "../../ecs/world";
import type { SystemRegistry } from "../../ecs/dynamic-systems";
import { Agent, BehaviorPolicy, Goal, Mind, Name, Room, WorkingMemoryIdentity } from "../../ecs/components";
import { HasGoal, SittingOn } from "../../ecs/relations";
import { getRoomForEntity } from "../../ecs/location";
import { readSimulationTime } from "../../ecs/simulation-time";
import { isSimulationResourceBusy } from "../simulation-timeline";
import { executeActions } from "../../cognition/cognition-system";
import type { AgentAction } from "../../cognition/agent-mind";
import { isSpeaking } from "../../cognition/timed-speech";
import { getAgentVisualEntities, getAgentWorldCapabilities } from "../../cognition/world-capabilities";
import { selectProceduralAction, skipLibrarySoftStep, tryStartProcedureExecution } from "../../cognition/procedural-skills";
import { evaluateBehaviorPolicy } from "../../cognition/behavior-policy";
import { getNextPlannedAction } from "../../cognition/planning-system";
import { getCurrentActivity } from "../../cognition/schedule-system";
import { getWorkingMemory } from "../../cognition/working-memory";
import { getOffstageLife, isOffstage, isOwnMindResident, isStructure, nextDriverDelay, offstageAdmitting, offstageRandom,
  trackAttentionTransitions, type OffstageLife, type OffstageOrigin } from "./offstage-life";
import { trackOffstagePlaces } from "./scene-resolver";

type Choice = { origin: OffstageOrigin; action: { type: string; target?: string; content?: string }; roomId?: number; sceneId?: string };
const PLAN_SKIPS = new Set(["speak", "think", "wait", "reflect", "rest", "plan", "remember"]);
const OUTCOME_WINDOW_MS = 120_000;

/** Free for a new act: nothing reserved on the body or voice, package idle and admitting. */
export function isBodyFree(world: World, eid: number): boolean {
  const capabilities = getAgentWorldCapabilities(world, eid);
  return capabilities?.ready() !== false && capabilities?.busy() !== true
    && !isSimulationResourceBusy(world, eid, "body") && !isSpeaking(world, eid);
}

function topGoal(world: World, eid: number): number | undefined {
  return getRelationTargets(world, eid, HasGoal).filter(id => hasComponent(world, id, Goal) && Goal.status[id] === "active")
    .sort((a, b) => (Goal.priority[b] || 0) - (Goal.priority[a] || 0))[0];
}
const usable = (action: { type?: string } | null | undefined): action is { type: string; target?: string; content?: string } =>
  !!action && typeof action.type === "string" && !["wait", "think", "reflect", "rest", "speak"].includes(action.type);

function learnedStep(world: World, eid: number): Choice | undefined {
  // Proven procedures and goal macros compiled from earlier successes.
  let procedural = selectProceduralAction(world, eid);
  // A carried-over (library) procedure's remembered words are the scene's
  // business offstage: step past them instead of stalling on speech.
  for (let skips = 0; procedural && !usable(procedural) && skips < 4 && skipLibrarySoftStep(world, eid); skips++)
    procedural = selectProceduralAction(world, eid);
  if (usable(procedural)) return { origin: "learned", action: { type: procedural.type, target: procedural.target, content: procedural.content } };
  // A learned/authored behaviour tree, where the host enables one.
  if (hasComponent(world, eid, BehaviorPolicy) && BehaviorPolicy.enabled[eid]) {
    const policy = evaluateBehaviorPolicy(world, eid);
    if (policy.kind === "action" && usable(policy.action)) return { origin: "learned", action: { ...policy.action } };
    if (policy.kind === "start_procedure" && tryStartProcedureExecution(world, eid, policy.signature, { minSuccesses: policy.minSuccesses })) {
      const next = selectProceduralAction(world, eid);
      if (usable(next)) return { origin: "learned", action: { type: next.type, target: next.target, content: next.content } };
    }
  }
}

function planStep(world: World, eid: number): Choice | undefined {
  const goal = topGoal(world, eid);
  const step = (goal !== undefined ? getNextPlannedAction(world, eid, { selectedGoalId: goal }) : null) ?? getNextPlannedAction(world, eid);
  if (!step || PLAN_SKIPS.has(step.actionType)) return;
  return { origin: "plan", action: { type: step.actionType, ...(step.target ? { target: step.target } : {}), ...(step.content ? { content: step.content } : {}) } };
}

function roomNamed(world: World, name: string): number | undefined {
  const wanted = name.trim().toLowerCase();
  return [...query(world, [Room, Name])].find(id => Name.value[id]?.trim().toLowerCase() === wanted);
}

function scheduleStep(world: World, eid: number): Choice | undefined {
  const place = getCurrentActivity(world, eid)?.location?.trim();
  if (!place) return;
  const room = getRoomForEntity(world, eid), destination = roomNamed(world, place);
  if (destination === undefined || destination === room) return;
  const reachable = getAgentWorldCapabilities(world, eid)?.movementTargets?.();
  if (reachable && !reachable.includes(destination)) return;
  return { origin: "schedule", action: { type: "move", target: Name.value[destination] } };
}

function idleStep(world: World, eid: number, life: OffstageLife): Choice | "stroll" | undefined {
  // Settled in a seat: staying put is life too.
  if (getRelationTargets(world, eid, SittingOn).length && offstageRandom(life) < 0.85) return;
  const capabilities = getAgentWorldCapabilities(world, eid);
  const visible = getAgentVisualEntities(world, eid).filter(id => id !== eid && !hasComponent(world, id, Agent) && !!Name.value[id]);
  const roll = offstageRandom(life);
  if (roll < 0.55 && !getRelationTargets(world, eid, SittingOn).length) {
    const seats = visible.filter(id => capabilities?.affordances?.(id)?.some(a => a.name === "sit"));
    if (seats.length) return { origin: "idle", action: { type: "interact", target: Name.value[seats[Math.floor(offstageRandom(life) * seats.length)]], content: "sit" } };
  }
  if (roll < 0.8 && life.host?.stroll) return "stroll";
  const things = visible.filter(id => !isStructure(world, id));
  if (things.length) return { origin: "idle", action: { type: "examine", target: Name.value[things[Math.floor(offstageRandom(life) * things.length)]] } };
}

function receiptIds(world: World, eid: number) {
  return new Set(getWorkingMemory(world, eid).receipts.filter(r => r.kind === "action").map(r => r.id));
}

function dispatch(world: World, registry: SystemRegistry, life: OffstageLife, eid: number, choice: Choice): void {
  const label = `${choice.action.type}${choice.action.target ? ` ${choice.action.target}` : ""}${choice.action.content ? ` (${choice.action.content.slice(0, 60)})` : ""}`;
  const known = receiptIds(world, eid);
  executeActions(world, [{ eid, action: { ...choice.action } as AgentAction }], registry);
  life.stats.outcomes[choice.origin].started++;
  if (choice.origin === "scene") life.stats.sceneActionsStarted++;
  life.tracked.push({ eid, actorKey: WorkingMemoryIdentity.id[eid], origin: choice.origin, roomId: choice.roomId, label,
    knownReceipts: known, dispatchedAtSimMs: readSimulationTime(world) });
  if (life.tracked.length > 128) life.tracked.shift();
  const line = `${Name.value[eid]} (offstage, ${choice.origin}): ${label}`;
  console.log(`[Offstage] ${line}`);
  life.host?.record?.("offstage", line);
}

/** Settle tracked driver/scene actions from the actor's own action receipts. */
function settleOutcomes(world: World, life: OffstageLife): void {
  const now = readSimulationTime(world);
  life.tracked = life.tracked.filter(row => {
    if (!isOwnMindResident(world, row.eid) || WorkingMemoryIdentity.id[row.eid] !== row.actorKey) return false;
    const fresh = getWorkingMemory(world, row.eid).receipts.filter(r => r.kind === "action" && !row.knownReceipts.has(r.id));
    const receipt = fresh.at(-1);
    if (!receipt) return now - row.dispatchedAtSimMs < OUTCOME_WINDOW_MS;
    const ok = receipt.succeeded === true;
    life.stats.outcomes[row.origin][ok ? "succeeded" : "failed"]++;
    if (!ok && row.origin === "scene" && row.roomId !== undefined) {
      const place = life.places.get(row.roomId);
      if (place) { place.failures.push(`${Name.value[row.eid]} tried to ${row.label} but it failed: ${receipt.summary.slice(0, 200)}`); place.failures = place.failures.slice(-6); }
    }
    return false;
  });
}

function queuedSceneStep(world: World, life: OffstageLife, eid: number): Choice | undefined {
  const queue = life.sceneQueue.get(eid); if (!queue?.length) return;
  const now = readSimulationTime(world);
  while (queue.length) {
    const next = queue.shift()!;
    if (next.actorKey !== WorkingMemoryIdentity.id[eid] || now - next.queuedAtSimMs > life.config.sceneActionTtlMs) { life.stats.sceneActionsDropped++; continue; }
    if (!queue.length) life.sceneQueue.delete(eid);
    return { origin: "scene", action: next.action, roomId: next.roomId, sceneId: next.sceneId };
  }
  life.sceneQueue.delete(eid);
}

/** One fast-loop step. Returns how many actions it dispatched. */
export function runOffstageDriver(world: World, registry: SystemRegistry): number {
  const life = getOffstageLife(world);
  if (!life) return 0;
  trackAttentionTransitions(world, life);
  if (!offstageAdmitting(world, life)) return 0;
  settleOutcomes(world, life);
  trackOffstagePlaces(world, life);
  const now = readSimulationTime(world);
  let dispatched = 0;
  for (const eid of query(world, [Agent, Mind])) {
    // Never double-drive: the operator's body, a live mind, or a mind mid-decision.
    if (!isOwnMindResident(world, eid) || !isOffstage(world, eid) || life.isDeliberating(eid) || !isBodyFree(world, eid)) continue;
    const due = life.nextDriverAtSimMs.get(eid);
    if (due === undefined) { life.nextDriverAtSimMs.set(eid, now + Math.round(nextDriverDelay(life) * offstageRandom(life))); continue; }
    if (now < due) continue;
    life.nextDriverAtSimMs.set(eid, now + nextDriverDelay(life));
    let choice: Choice | "stroll" | undefined;
    try {
      choice = queuedSceneStep(world, life, eid) ?? learnedStep(world, eid) ?? planStep(world, eid) ?? scheduleStep(world, eid) ?? idleStep(world, eid, life);
    } catch (error) {
      console.warn(`[Offstage] could not choose for ${Name.value[eid]}: ${error instanceof Error ? error.message : error}`); continue;
    }
    if (!choice) continue;
    if (choice === "stroll") {
      if (life.host?.stroll?.(eid)) { life.stats.outcomes.idle.started++; life.stats.outcomes.idle.succeeded++; dispatched++;
        const line = `${Name.value[eid]} (offstage, idle): strolls a few steps`; life.host.record?.("offstage", line); }
      continue;
    }
    dispatch(world, registry, life, eid, choice); dispatched++;
  }
  return dispatched;
}
