/** Author-only observations. A private intention is demand for possibilities,
 * not a public event, a construction command, or another character's knowledge. */
import { createHash, randomUUID } from "node:crypto";
import { entityExists, getRelationTargets, hasComponent, query, Prefab } from "bitecs";
import type { World } from "../ecs/world";
import { Agent, ExternalParticipant, Goal, GoalLifecycle, GodAgent, Name, Plan, Removed, WorkingMemoryIdentity } from "../ecs/components";
import { HasGoal, HasPlan } from "../ecs/relations";
import { getRoomForEntity } from "../ecs/location";
import { readSimulationTime } from "../ecs/simulation-time";
import { getCommittedEvents } from "../runtime/committed-events";
import { getSimulationTaskSignal } from "../runtime/task-scope";
import { workingMemoryEntityRef } from "../cognition/working-memory";
import { captureCoordinationGoal, getCoordinationGoalRef, getCoordinationMemory, type CoordinationItem } from "../cognition/coordination-memory";
import { getPlanForGoal } from "../cognition/plan-state";
import { observeChosenNextPurpose, snapshotActorContinuation } from "../cognition/actor-continuation";
import { getAgentWorldCapabilityGeneration } from "../cognition/world-capabilities";

export type ActorIntentionEvidence = Readonly<{
  ref: string; causalKey: string; actor: string; actorKey: string; observedRoom: string | null;
  kind: "goal" | "selected_purpose" | "next_purpose" | "planned_step" | "undertaking"; description: string; goalKey?: string; priority?: number;
  actionType?: string; target?: string; status?: string;
}>;
export type ActorIntentionBinding = (() => boolean) & {
  /** Last native validation only. Reading diagnostics does not evaluate guards. */
  invalidatedReferences(): readonly string[];
};

const targetActions = new Set(["move", "interact", "pickup", "give", "drop", "use", "observe", "examine"]);
const text = (value: unknown): value is string => typeof value === "string" && !!value.trim() && value.length <= 300;
const liveWork = (item: CoordinationItem) => item.own && !!item.generation && ["not_started", "in_progress", "blocked"].includes(item.localStatus || "");
const workBasis = (item: CoordinationItem) => JSON.stringify([item.ownerKey, item.id, item.generation, item.task,
  // The criterion is bound privately, but its command arguments are not projected.
  item.completion]);
function planSteps(plan: number): any[] {
  const raw = Plan.steps[plan]; if (!raw || raw.length > 262144) return [];
  try { const rows = JSON.parse(raw); return Array.isArray(rows) && rows.length <= 128 ? rows : []; } catch { return []; }
}
const validFocus = (focus: ReturnType<typeof snapshotActorContinuation>) => !!focus
  && (["proposed", "dispatched", "waiting"].includes(focus.status)
    || focus.status === "needs_revision" && !!focus.reason && !["restored_purpose", "external_control_edit"].includes(focus.reason));
// Capability generations are opaque object identities (often empty objects),
// not serializable values. Preserve their identity across captured observations.
const capabilityIdentity = new WeakMap<object, string>();
function capabilityKey(generation: object | undefined): string | undefined {
  if (!generation) return;
  let key = capabilityIdentity.get(generation);
  if (!key) { key = randomUUID(); capabilityIdentity.set(generation, key); }
  return key;
}

export function captureActorIntentionEvidence(world: World) {
  const source = getCommittedEvents(world).sourceId, at = readSimulationTime(world), signal = getSimulationTaskSignal();
  const records: ActorIntentionEvidence[] = [], guards = new Map<string, () => boolean>();
  // Historical recovery lineage, never projected as actor knowledge or build
  // authority. Fresh evidence must still pass its full native binding. A goal
  // and its transient steps share lineage only while their meaning/owner match.
  const demandKeys = new Map<string, readonly string[]>();
  const getDemandKeys = (ref: string): readonly string[] => [...(demandKeys.get(ref) ?? [])];
  const actors=new Map<string,{eid:number;key:string;name:string}>();
  // Only a current, captured intention resolves a native dependency. These
  // references stay in trusted author admission; model output cannot supply IDs.
  const resolveActor=(ref:string)=>{
    const actor=actors.get(ref);
    if(!source || !actor || !sourceCurrent() || !guards.get(ref)?.()) return;
    return Object.freeze({world,sourceId:source,...actor});
  };
  let omitted = 0;
  const sourceCurrent = () => !signal?.aborted && !getCommittedEvents(world).stopped
    && getCommittedEvents(world).sourceId === source && readSimulationTime(world) >= at;
  const issue = (record: Omit<ActorIntentionEvidence, "ref" | "causalKey">, basis: string, current: () => boolean, eid:number,
    demandBases: readonly string[] = [basis]) => {
    if (records.length >= 64) { omitted++; return; }
    const ref = `intention:${randomUUID()}`;
    records.push(Object.freeze({ ...record, ref, causalKey: `intention:${createHash("sha256").update(JSON.stringify([source, basis])).digest("hex")}` }));
    demandKeys.set(ref, demandBases.map(demand => createHash("sha256").update(JSON.stringify([source, demand])).digest("hex")));
    // Once observed stale, this particular admission never revives.
    let revoked = false;
    guards.set(ref, () => { if (!revoked && !current()) revoked = true; return !revoked; });
    actors.set(ref,{eid,key:record.actorKey,name:record.actor});
  };
  if (!sourceCurrent()) return { records, omitted, resolveActor, getDemandKeys, bind: (_refs: readonly string[]): ActorIntentionBinding | undefined => undefined };
  for (const actor of query(world, [Agent, Name])) {
    if (!Agent.active[actor] || hasComponent(world, actor, ExternalParticipant) || hasComponent(world, actor, GodAgent) || hasComponent(world, actor, Removed) || hasComponent(world, actor, Prefab)) continue;
    const owner = workingMemoryEntityRef(world, actor); if (!owner) continue;
    const roomId = getRoomForEntity(world, actor), room = roomId === undefined ? undefined : workingMemoryEntityRef(world, roomId);
    const generation = getAgentWorldCapabilityGeneration(world, actor);
    const generationKey = capabilityKey(generation);
    const persona = JSON.stringify([Agent.role[actor], Agent.systemPrompt[actor]]);
    const actorCurrent = () => sourceCurrent() && entityExists(world, actor) && hasComponent(world, actor, Agent)
      && !hasComponent(world, actor, Removed) && Agent.active[actor] && hasComponent(world, actor, WorkingMemoryIdentity)
      && !hasComponent(world, actor, ExternalParticipant) && !hasComponent(world, actor, GodAgent) && !hasComponent(world, actor, Prefab)
      && WorkingMemoryIdentity.id[actor] === owner.key && Name.value[actor] === owner.label
      && JSON.stringify([Agent.role[actor], Agent.systemPrompt[actor]]) === persona
      && getAgentWorldCapabilityGeneration(world, actor) === generation
      && (roomId === undefined || entityExists(world, roomId) && WorkingMemoryIdentity.id[roomId] === room?.key && Name.value[roomId] === room?.label);
    // Place is historical context, not a requirement to stand still while builders
    // work. Destination/route proposals must bind their own physical dependencies.
    const base = { actor: owner.label, actorKey: owner.key, observedRoom: room?.label ?? null };
    const ownedGoals = getRelationTargets(world, actor, HasGoal).filter(goal => hasComponent(world, goal, Goal)
      && ["active", "in_progress"].includes(Goal.status[goal]));
    const goalBasis = (goal: number) => JSON.stringify([owner.key, persona, getCoordinationGoalRef(world, actor, goal),
      Goal.description[goal], Goal.kind[goal], Goal.paramsJson[goal], Goal.successJson[goal], Goal.status[goal], Goal.priority[goal],
      GoalLifecycle.reviewRevision[goal], GoalLifecycle.settledAt[goal], GoalLifecycle.resumedAt[goal]]);
    const goalDemandBasis = (goal: number) => JSON.stringify([owner.key, persona, generationKey,
      getCoordinationGoalRef(world, actor, goal), Goal.description[goal]]);
    let projectedSteps = 0;
    for (const goal of ownedGoals.sort((a, b) => (Goal.priority[b] || 0) - (Goal.priority[a] || 0)).slice(0, 8)) {
      const reference = captureCoordinationGoal(world, actor, goal);
      if (!reference || !Goal.description[goal]?.trim()) continue;
      const basis = goalBasis(goal);
      issue({ ...base, kind: "goal", goalKey: WorkingMemoryIdentity.id[goal], description: Goal.description[goal].slice(0, 1000), priority: Goal.priority[goal] },
        basis, () => actorCurrent() && entityExists(world, goal) && hasComponent(world, goal, Goal)
          && getRelationTargets(world, actor, HasGoal).includes(goal) && goalBasis(goal) === basis, actor, [goalDemandBasis(goal)]);
      const plan = getPlanForGoal(world, actor, goal);
      if (plan === undefined || !["active", "awaiting_evidence", "awaiting_decision"].includes(Plan.status[plan])) continue;
      const cursor = Plan.currentStep[plan], steps = planSteps(plan);
      if (!Number.isSafeInteger(cursor) || cursor < 0) continue;
      for (let index = cursor; index < steps.length; index++) {
        const step = steps[index];
        if (!step || !targetActions.has(step.actionType) || !text(step.target) || !text(step.evidenceScope) || step.resolution) continue;
        if (projectedSteps >= 3) { omitted++; continue; }
        projectedSteps++;
        // Plans are unnamed ECS records. Their native per-step episode scope,
        // not a fabricated physical-entity identity, identifies the proposal.
        const stepBasis = JSON.stringify(step), born = Plan.createdAt[plan];
        issue({ ...base, kind: "planned_step", goalKey: WorkingMemoryIdentity.id[goal],
          description: `Upcoming ${step.actionType} toward ${step.target} for: ${Goal.description[goal]}`.slice(0, 1000),
          actionType: step.actionType, target: step.target, status: Plan.status[plan] }, JSON.stringify([basis, plan, born, index, stepBasis]), () => {
            const next = Plan.currentStep[plan];
            return actorCurrent() && entityExists(world, goal) && hasComponent(world, goal, Goal) && goalBasis(goal) === basis
              && getRelationTargets(world, actor, HasGoal).includes(goal) && getRelationTargets(world, actor, HasPlan).includes(plan)
              && entityExists(world, plan) && hasComponent(world, plan, Plan)
              && Plan.createdAt[plan] === born && Plan.goalEid[plan] === goal && getPlanForGoal(world, actor, goal) === plan
              && ["active", "awaiting_evidence", "awaiting_decision"].includes(Plan.status[plan])
              && Number.isSafeInteger(next) && next >= cursor && next <= index && JSON.stringify(planSteps(plan)[index]) === stepBasis;
          }, actor, [goalDemandBasis(goal)]);
      }
    }
    omitted += Math.max(0, ownedGoals.length - 8);
    const undertakings = getCoordinationMemory(world, actor).items.filter(liveWork);
    for (const item of undertakings.slice(-3)) {
      const basis = workBasis(item);
      const ownDemand = JSON.stringify([owner.key, persona, generationKey, basis]);
      const linkedGoal = item.goal && ownedGoals.find(goal => {
        const reference = getCoordinationGoalRef(world, actor, goal);
        return reference && JSON.stringify(reference) === JSON.stringify(item.goal);
      });
      // A promise is independent of its supporting reply/coordination goal.
      // Project its interpreted task, never the source message or private proof.
      issue({ ...base, kind: "undertaking", description: item.task, status: item.localStatus,
        ...(item.goal ? { goalKey: item.goal.goalKey } : {}),
        ...(item.completion ? { actionType: item.completion.actionType, target: item.completion.target } : {}) },
        JSON.stringify([owner.key, persona, basis]), () => actorCurrent() && getCoordinationMemory(world, actor).items
          .some(current => liveWork(current) && workBasis(current) === basis), actor,
        [ownDemand, ...(linkedGoal === undefined ? [] : [goalDemandBasis(linkedGoal)])]);
    }
    omitted += Math.max(0, undertakings.length - 3);
    const next = observeChosenNextPurpose(world, actor);
    if (next) {
      const goalDefinition = goalBasis(next.goalId);
      // Native acknowledgement/reconsideration changes phase, not the chosen
      // purpose. Do not bind to the unrelated immediate step or private proof.
      const nextBasis = (value: typeof next) => JSON.stringify([value.id, value.goalId, value.goalKey,
        value.goalBasis, value.purpose, value.chosenAtSimMs]);
      const basis = nextBasis(next);
      issue({ ...base, kind: "next_purpose", description: next.purpose, goalKey: next.goalKey, status: next.status },
        JSON.stringify([owner.key, persona, goalDefinition, basis]), () => {
          const current = observeChosenNextPurpose(world, actor);
          return actorCurrent() && !!current && nextBasis(current) === basis && goalBasis(next.goalId) === goalDefinition;
        }, actor, [goalDemandBasis(next.goalId)]);
    }
    const focus = snapshotActorContinuation(world, actor);
    if (focus && validFocus(focus)) {
      const selectedGoalBasis = focus.goalId === undefined ? undefined : goalBasis(focus.goalId);
      const targeted = targetActions.has(focus.actionType) && text(focus.target);
      const basis = JSON.stringify([owner.key, persona, focus.goalKey, focus.purpose, focus.actionType, focus.target]);
      issue({ ...base, kind: "selected_purpose", description: focus.purpose, goalKey: focus.goalKey, status: focus.status,
        ...(targeted ? { actionType: focus.actionType, target: focus.target } : {}) }, basis, () => {
        const current = snapshotActorContinuation(world, actor);
        return actorCurrent() && !!current && current.goalKey === focus.goalKey && current.purpose === focus.purpose
          && current.actionType === focus.actionType && current.target === focus.target && validFocus(current)
          && (focus.goalId === undefined || entityExists(world, focus.goalId) && hasComponent(world, focus.goalId, Goal)
            && getRelationTargets(world, actor, HasGoal).includes(focus.goalId)
          && ["active", "in_progress"].includes(Goal.status[focus.goalId]) && goalBasis(focus.goalId) === selectedGoalBasis);
      }, actor, [focus.goalId === undefined ? JSON.stringify([basis, generationKey]) : goalDemandBasis(focus.goalId)]);
    }
  }
  return { records, omitted, resolveActor, getDemandKeys, bind: (refs: readonly string[]): ActorIntentionBinding | undefined => {
    const selected = refs.filter(ref => ref.startsWith("intention:"));
    if (selected.some(ref => !guards.has(ref))) return;
    let invalidated: readonly string[] = [];
    const current = () => {
      try {
        if (!sourceCurrent()) { invalidated = [...new Set(selected)]; return false; }
        // Evaluate each cited dependency at the admission boundary, preserving
        // permanent revocation and the original all-dependencies requirement.
        invalidated = [...new Set(selected.filter(ref => {
          try { return !guards.get(ref)!(); } catch { return true; }
        }))];
        return invalidated.length === 0;
      } catch { invalidated = [...new Set(selected)]; return false; }
    };
    return Object.assign(current, { invalidatedReferences: () => [...invalidated] });
  } };
}
