/** Physical evidence admission. These functions run at sensing/execution boundaries,
 * never while formatting prompts. The ledger itself does not query world truth. */
import { entityExists, getRelationTargets, hasComponent, query } from "bitecs";
import { randomUUID } from "node:crypto";
import { Agent, Goal, Name, ObjectState, Room, WorkingMemoryIdentity } from "../ecs/components";
import { HasGoal } from "../ecs/relations";
import { readSimulationTime } from "../ecs/simulation-time";
import { getCommittedEvents } from "../runtime/committed-events";
import { getSimulationTaskSignal } from "../runtime/task-scope";
import { getDirectContainer, getRoomForEntity, listDirectContents } from "../ecs/location";
import type { World } from "../ecs/world";
import type { AgentAction } from "./agent-mind";
import { getAgentSensoryCapabilities } from "./sensory-capabilities";
import { getAgentVisibleEntities, getAgentVisualEntities, getObservedHeldItemExteriors, getObservedStateFields, getAgentWorldCapabilities, getAgentWorldCapabilityGeneration } from "./world-capabilities";
import { snapshotActorContinuation } from "./actor-continuation";
import { snapshotOngoingActivity } from "./ongoing-activity";
import { refreshKnownInspectionEvidence } from "./inspection-memory";
import { getAccessibleDocumentStatus } from "../world/productive-work";
import { getWorkingMemory, recordWorkingMemoryEvidence, workingMemoryEntityRef,
  WORKING_MEMORY_LIMITS, type WorkingMemoryFact, type WorkingMemoryFactInput, type WorkingMemoryProvenance, type WorkingMemoryActionContext } from "./working-memory";

type Ref = { key: string; label: string };
type ObservedEntity = { eid: number; ref: Ref; container?: number; state?: string };
export interface WorkingMemoryActionSnapshot {
  readonly actor: Ref;
  readonly room?: number;
  readonly entities: readonly ObservedEntity[];
  readonly owned: readonly ObservedEntity[];
}
// Attribution travels with the original executor snapshot, not the latest
// conversational continuation at completion. Copies/restores grant no binding.
const actionContexts = new WeakMap<WorkingMemoryActionSnapshot, { world: World; eid: number; owner: string;
  source: string | null; persona: string; generation: object | undefined; command: string; signal?: AbortSignal;
  startedAtSimMs: number; targetKey?: string; movementRoom?: ObservedEntity; context?: WorkingMemoryActionContext }>();
const commandIdentity = (action: AgentAction) => JSON.stringify([action.type, action.target, action.content]);
const actionPersona = (eid: number) => JSON.stringify([Name.value[eid], Agent.role[eid], Agent.systemPrompt[eid]]);
/** Ephemeral perception returned to the synchronous cognition pass. It refreshes
 * evidence time without appending one serialized receipt for every video frame. */
export interface WorkingMemoryObservationSnapshot {
  readonly ownerKey: string;
  readonly observedAt: number;
  readonly facts: readonly WorkingMemoryFact[];
}
const observationAdmissions = new WeakMap<WorkingMemoryObservationSnapshot, { world: World; eid: number; wallTime: number; sequence: number }>();
const latestObservations = new WeakMap<World, Map<number, WorkingMemoryObservationSnapshot>>();
const observationSequences = new WeakMap<World, number>();
/** An ordering fence, not elapsed time or a request to perform new sensing. */
export function getWorkingMemoryObservationSequence(world: World): number { return observationSequences.get(world) || 0; }

/** Accept only the original immutable snapshot from this actor/world boundary.
 * Retaining a token never restamps its facts, and a newer observation supersedes
 * it. Tokens are consumed once and are not persistence state. */
export function consumeWorkingMemoryObservation(world: World, eid: number,
  snapshot: WorkingMemoryObservationSnapshot | undefined, afterSequence?: number): readonly WorkingMemoryFact[] {
  if (!snapshot) return [];
  const admission = observationAdmissions.get(snapshot);
  if (!admission || admission.world !== world || admission.eid !== eid || Date.now() < admission.wallTime
    || afterSequence !== undefined && (!Number.isSafeInteger(afterSequence) || afterSequence < 0 || admission.sequence <= afterSequence)
    || latestObservations.get(world)?.get(eid) !== snapshot || !liveActor(world, eid)
    || !hasComponent(world, eid, WorkingMemoryIdentity) || WorkingMemoryIdentity.id[eid] !== snapshot.ownerKey) return [];
  observationAdmissions.delete(snapshot);
  latestObservations.get(world)?.delete(eid);
  return snapshot.facts;
}
const clocks = new WeakMap<World, number>();
const liveActor = (world: World, eid: number) => entityExists(world, eid) && hasComponent(world, eid, Agent) && Agent.active[eid];
const normalize = (value?: string) => (value || "").trim().toLocaleLowerCase();
const slotKey = (fact: WorkingMemoryFactInput) => JSON.stringify([fact.subject, fact.predicate, fact.slot || ""]);
function sameEntity(world: World, observed: ObservedEntity): boolean {
  return entityExists(world, observed.eid) && hasComponent(world, observed.eid, WorkingMemoryIdentity)
    && WorkingMemoryIdentity.id[observed.eid] === observed.ref.key;
}
function stamp(world: World, eid: number, explicit?: number): number {
  if (explicit !== undefined) return explicit;
  const memory = getWorkingMemory(world, eid);
  const latest = Math.max(memory.evidenceFloorMs, ...memory.facts.map(f => f.observedAt), ...memory.receipts.map(r => r.atMs));
  // Date.now alone cannot order several transfers in one tick. Include restored
  // evidence because the in-process clock is deliberately not persistence state.
  const next = Math.max(Date.now(), (clocks.get(world) || 0) + 0.001, latest + 0.001);
  clocks.set(world, next);
  return next;
}
function location(subject: Ref, destination: Ref): WorkingMemoryFactInput {
  return { subject: subject.key, subjectLabel: subject.label, predicate: "location", value: destination.key, valueLabel: destination.label };
}
function state(subject: Ref, value: string): WorkingMemoryFactInput {
  return { subject: subject.key, subjectLabel: subject.label, predicate: "state", slot: "ObjectState.current", value };
}
function observed(world: World, target: number): ObservedEntity | undefined {
  const ref = workingMemoryEntityRef(world, target);
  return ref ? { eid: target, ref, container: getDirectContainer(world, target),
    state: hasComponent(world, target, ObjectState) ? ObjectState.current[target] : undefined } : undefined;
}

/** Reconcile only personally accessible facts; missing own inventory becomes
 * unknown, never a lookup of whichever hidden container now holds it. */
export function captureWorkingMemoryObservation(world: World, eid: number): WorkingMemoryObservationSnapshot | undefined {
  if (!liveActor(world, eid)) return;
  const actor = workingMemoryEntityRef(world, eid); if (!actor) return;
  const room = getRoomForEntity(world, eid);
  const own = listDirectContents(world, eid);
  const ownRefs = own.flatMap(item => { const ref = workingMemoryEntityRef(world, item); return ref ? [ref] : []; });
  const sighted = getAgentSensoryCapabilities(world, eid).visual > 0;
  const visible = sighted ? getAgentVisualEntities(world, eid) : [];
  const accessible = new Set([eid, ...(room === undefined ? [] : [room]), ...visible]);
  const selfFacts: WorkingMemoryFactInput[] = ownRefs.map(ref => location(ref, actor));
  const roomRef = room === undefined ? undefined : workingMemoryEntityRef(world, room);
  if (roomRef) {
    selfFacts.push(location(actor, roomRef));
    if (hasComponent(world, room!, Room)) selfFacts.push({ subject: roomRef.key, subjectLabel: roomRef.label,
      predicate: "state", slot: "Entity.kind", value: "room" });
  }
  const prior = getWorkingMemory(world, eid);
  for (const fact of prior.facts) {
    if (fact.predicate === "location" && fact.value === actor.key && !ownRefs.some(ref => ref.key === fact.subject)) {
      selfFacts.push({ subject: fact.subject, subjectLabel: fact.subjectLabel, predicate: "location",
        value: "unknown", valueLabel: "no longer in your inventory; location unknown" });
    }
  }
  const seenFacts: WorkingMemoryFactInput[] = [];
  for (const item of getObservedHeldItemExteriors(world, eid)) {
    const ref = workingMemoryEntityRef(world, item.eid), holder = workingMemoryEntityRef(world, item.holderEid);
    if (ref && holder) seenFacts.push(location(ref, holder));
  }
  for (const target of visible) {
    const ref = workingMemoryEntityRef(world, target); if (!ref) continue;
    const parent = getDirectContainer(world, target);
    if (parent !== undefined && accessible.has(parent) && parent !== eid) {
      const parentRef = workingMemoryEntityRef(world, parent);
      if (parentRef) seenFacts.push(location(ref, parentRef));
    }
    // Agent ObjectState is not a declared public body surface: it may contain
    // private mental state or stale generic 'idle'. Observe people through
    // physical presence and explicitly authored Observable.* fields instead.
    if (!hasComponent(world, target, Agent) && hasComponent(world, target, ObjectState) && ObjectState.current[target])
      seenFacts.push(state(ref, ObjectState.current[target]));
    // Native document affordances disclose lifecycle status, but not unread
    // contents. Keep its exact slot: generic visual state is not WikiDoc proof.
    const documentStatus = !hasComponent(world, target, Agent) ? getAccessibleDocumentStatus(world, eid, target) : undefined;
    if (documentStatus !== undefined) seenFacts.push({ subject: ref.key, subjectLabel: ref.label,
      predicate: "state", slot: "WikiDoc.status", value: documentStatus });
  }
  // Public fields are explicitly projected by the world package, not guessed
  // from composed display prose or enumerated from dynamic components. The
  // refs above were assigned at this actual sensing boundary; catalog readers
  // elsewhere remain pure and cannot create evidence themselves.
  for (const field of getObservedStateFields(world, eid)) {
    const fact: WorkingMemoryFactInput = { subject: field.subject, subjectLabel: field.subjectLabel,
      predicate: "state", slot: field.slot, value: field.value };
    (field.subject === actor.key ? selfFacts : seenFacts).push(fact);
  }
  if (!liveActor(world, eid) || !hasComponent(world, eid, WorkingMemoryIdentity)
    || WorkingMemoryIdentity.id[eid] !== actor.key || getRoomForEntity(world, eid) !== room) return;
  // A missing possession can simultaneously be visible on the floor. Those are
  // one observation, not competing same-time guesses about the item's location.
  const visibleSlots = new Set(seenFacts.map(slotKey));
  const resolvedSelfFacts = selfFacts.filter(fact => fact.value !== "unknown" || !visibleSlots.has(slotKey(fact)));
  const now = stamp(world, eid);
  const known = new Map(prior.facts.map(fact => [slotKey(fact), fact]));
  for (const [facts, provenance] of [[resolvedSelfFacts, "own_observation"], [seenFacts, "visible_observation"]] as const) {
    const fresh = [...new Map(facts.map(f => [slotKey(f), f])).values()].filter(fact => {
      const old = known.get(slotKey(fact));
      // Refresh unchanged observations sparingly: a resting mind is not a log of
      // every frame, and action receipts should survive ambient perception churn.
      return !old || old.value !== fact.value || old.valueLabel !== fact.valueLabel || old.subjectLabel !== fact.subjectLabel || now - old.observedAt >= 30_000;
    });
    for (let offset = 0; offset < fresh.length; offset += 32) recordWorkingMemoryEvidence(world, eid, {
      id: `observation:${randomUUID()}`, atMs: now, kind: "observation", provenance,
      summary: provenance === "own_observation" ? "Checked my location and possessions." : "Observed the visible local scene.",
      facts: fresh.slice(offset, offset + 32),
    });
  }
  refreshKnownInspectionEvidence(world, eid);
  const snapshot: WorkingMemoryObservationSnapshot = Object.freeze({ ownerKey: actor.key, observedAt: now,
    facts: Object.freeze([...resolvedSelfFacts.map(f => ({ ...f, provenance: "own_observation" as const })),
      ...seenFacts.map(f => ({ ...f, provenance: "visible_observation" as const }))]
      .slice(-WORKING_MEMORY_LIMITS.facts).map(f => Object.freeze({ ...f, sourceId: `perception:${actor.key}:${now}`, observedAt: now }))) });
  const sequence = getWorkingMemoryObservationSequence(world) + 1; observationSequences.set(world, sequence);
  observationAdmissions.set(snapshot, { world, eid, wallTime: Date.now(), sequence });
  let latest = latestObservations.get(world); if (!latest) { latest = new Map(); latestObservations.set(world, latest); }
  latest.set(eid, snapshot);
  queueMicrotask(() => {
    observationAdmissions.delete(snapshot);
    if (latest.get(eid) === snapshot) latest.delete(eid);
  });
  return snapshot;
}

/** Capture before an intention can mutate the world. EIDs are ephemeral here;
 * stable identity checks prevent a deleted/reused object becoming the old item. */
export function captureWorkingMemoryAction(world: World, eid: number, action: AgentAction): WorkingMemoryActionSnapshot | undefined {
  if (!liveActor(world, eid)) return;
  const actor = workingMemoryEntityRef(world, eid); if (!actor) return;
  const entities = getAgentVisibleEntities(world, eid).flatMap(target => { const item = observed(world, target); return item ? [item] : []; });
  const room = getRoomForEntity(world, eid);
  if (action.type === "give" && room !== undefined) {
    // A blind giver can complete a tactile transfer to an explicitly named
    // local participant. This snapshot is not a percept or a scan of inventory;
    // only the later confirmed containment change can admit the action fact.
    for (const target of listDirectContents(world, room)) {
      if (!hasComponent(world, target, Agent) || normalize(Name.value[target]) !== normalize(action.target)
        || entities.some(item => item.eid === target)) continue;
      const ref = workingMemoryEntityRef(world, target);
      if (ref) entities.push({ eid: target, ref, container: room });
    }
  }
  const capturedEntities = Object.freeze(entities.map(item => Object.freeze({ ...item, ref: Object.freeze({ ...item.ref }) })));
  const snapshot: WorkingMemoryActionSnapshot = Object.freeze({ actor: Object.freeze({ ...actor }), room,
    entities: capturedEntities, owned: Object.freeze(capturedEntities.filter(item => item.container === eid)) });
  const choice = snapshotActorContinuation(world, eid), tape = getCommittedEvents(world);
  const matchingChoice = choice && choice.status !== "needs_revision" && choice.actionType === action.type
    && normalize(choice.target) === normalize(action.target) ? choice : undefined;
  // A route label is known without the destination being visually present.
  // Capture only the unique room's identity, privately with this execution:
  // never its contents/state or a new perception. Match the existing native
  // catalogue: an explicit host route list (including empty) replaces legacy
  // authored room labels. Completion still checks the actual arrived room.
  let movementRoom: ObservedEntity | undefined;
  if (action.type === "move" && normalize(action.target)) {
    const capabilities = getAgentWorldCapabilities(world, eid);
    const supplied = capabilities?.movementTargets?.();
    const rooms = capabilities?.movementTargets ? Array.isArray(supplied) ? supplied : [] : [...query(world, [Room])];
    const matches = [...new Set(rooms)].filter(target => Number.isSafeInteger(target) && entityExists(world, target)
      && hasComponent(world, target, Room) && hasComponent(world, target, Name) && normalize(Name.value[target]) === normalize(action.target));
    if (matches.length === 1) {
      const ref = workingMemoryEntityRef(world, matches[0]);
      if (ref) movementRoom = { eid: matches[0], ref: { ...ref } };
    }
  }
  if ((matchingChoice || action.type === "move") && !tape.stopped) {
    const activity = matchingChoice ? snapshotOngoingActivity(world, eid) : undefined, goal = matchingChoice?.goalId;
    const intention = goal !== undefined && getRelationTargets(world, eid, HasGoal).includes(goal)
      && hasComponent(world, goal, Goal) && Goal.status[goal] === "active" && matchingChoice?.goalKey === WorkingMemoryIdentity.id[goal]
      ? { key: matchingChoice.goalKey!, description: Goal.description[goal],
        ...(activity && !activity.needsRevalidation && activity.goalKey === matchingChoice.goalKey ? { activityId: activity.id } : {}) } : undefined;
    const targets = entities.filter(item => normalize(item.ref.label) === normalize(action.target));
    const startedAtSimMs = readSimulationTime(world);
    actionContexts.set(snapshot, { world, eid, owner: actor.key, source: tape.sourceId, persona: actionPersona(eid),
      generation: getAgentWorldCapabilityGeneration(world, eid), command: commandIdentity(action),
      signal: getSimulationTaskSignal(), startedAtSimMs, ...(movementRoom ? { movementRoom } : {}),
      ...(action.type !== "give" && targets.length === 1 ? { targetKey: targets[0].ref.key } : {}),
      ...(matchingChoice ? { context: { startedAtSimMs, purpose: matchingChoice.purpose, ...(intention ? { intention } : {}) } } : {}) });
  }
  return snapshot;
}

/** Receipts describe committed effects, not the effects the model requested.
 * Only direct participants and sighted local witnesses receive action facts. */
export function recordWorkingMemoryAction(world: World, eid: number, action: AgentAction, success: boolean,
  options: { before?: WorkingMemoryActionSnapshot; summary?: string; atMs?: number } = {}): void {
  if (!liveActor(world, eid)) return;
  if (["observe", "examine"].includes(action.type)) {
    if (success) captureWorkingMemoryObservation(world, eid);
    return;
  }
  // A successful thought, memory write or plan is not a physical receipt.
  // Repeated observations also must not evict meaningful transfer receipts.
  if (!["give", "pickup", "drop", "move", "interact", "use"].includes(action.type)) return;
  const actor = workingMemoryEntityRef(world, eid); if (!actor) return;
  const before = options.before?.actor.key === actor.key ? options.before : undefined;
  const captured = before && actionContexts.get(before), tape = getCommittedEvents(world);
  const completedAtSimMs = readSimulationTime(world);
  const bindingCurrent = captured && captured.world === world && captured.eid === eid && captured.owner === actor.key
    && captured.source === tape.sourceId && !tape.stopped && captured.persona === actionPersona(eid)
    && !captured.signal?.aborted && !getSimulationTaskSignal()?.aborted
    && captured.generation === getAgentWorldCapabilityGeneration(world, eid) && captured.command === commandIdentity(action)
    && captured.startedAtSimMs <= completedAtSimMs;
  const executionContext = bindingCurrent ? captured.context : undefined;
  if (before) actionContexts.delete(before);
  const facts: WorkingMemoryFactInput[] = [];
  const publicFacts: Array<{ fact: WorkingMemoryFactInput; visibleTarget?: number }> = [];
  let recipient: number | undefined;
  let summary = options.summary || `${actor.label}: ${action.type}${action.target ? ` ${action.target}` : ""}${action.content ? ` (${action.content})` : ""} ${success ? "completed" : "failed"}.`;
  const named = (name?: string) => before?.entities.filter(item => normalize(item.ref.label) === normalize(name)) || [];
  // A successful bound execution can retain its exact historical target after
  // consumption. The key comes from the private issuance record, never a name
  // lookup or the mutable returned snapshot. It is not a claim of current
  // existence: all effect/visibility facts below still require sameEntity.
  // Unbound work requires a still-identical target; give has two operands.
  const namedTargets = named(action.target);
  // Room movement cannot borrow a visual name, a replacement room or the
  // actor's eventual location as retroactive target authority. Failure may
  // remember the attempted destination but still has no arrival facts.
  const movementTargetKey = bindingCurrent && captured.movementRoom && sameEntity(world, captured.movementRoom)
    && hasComponent(world, captured.movementRoom.eid, Room) && (!success || getRoomForEntity(world, eid) === captured.movementRoom.eid)
    ? captured.movementRoom.ref.key : undefined;
  // Legacy grid movement can instead approach a locally visible object. Keep
  // that identity only from the same live issuance, never in preference to a
  // known room with the same label and never from a copied/reused snapshot.
  const localMovementTargetKey = bindingCurrent && !captured.movementRoom && namedTargets.length === 1
    && sameEntity(world, namedTargets[0]) && !hasComponent(world, namedTargets[0].eid, Room) ? captured.targetKey : undefined;
  const typedTarget = action.type === "move" ? captured?.movementRoom ? movementTargetKey : localMovementTargetKey
    : success && executionContext ? captured?.targetKey
    : action.type !== "give" && namedTargets.length === 1 && sameEntity(world, namedTargets[0]) ? namedTargets[0].ref.key : undefined;
  const actionIdentity = typedTarget && typeof action.type === "string" && action.type.length <= 80
    && (action.content === undefined || typeof action.content === "string" && action.content.trim().length > 0 && action.content.length <= 2000)
    ? { type: action.type, targetKey: typedTarget, ...(action.content === undefined ? {} : { content: action.content }) } : undefined;
  if (success && before) {
    const target = named(action.target).find(item => sameEntity(world, item));
    if (["give", "pickup", "drop"].includes(action.type)) {
      const candidates = action.type === "give" ? before.owned.filter(item => normalize(item.ref.label) === normalize(action.content)) : named(action.target);
      for (const item of candidates) {
        if (!sameEntity(world, item)) continue;
        const parent = getDirectContainer(world, item.eid);
        const expected = action.type === "give" ? named(action.target).find(candidate => candidate.eid === parent
          && sameEntity(world, candidate) && hasComponent(world, candidate.eid, Agent))?.eid : action.type === "pickup" ? eid : getRoomForEntity(world, eid);
        if (parent === undefined || parent !== expected || item.container === parent) continue;
        const destination = workingMemoryEntityRef(world, parent); if (!destination) continue;
        const fact = location(item.ref, destination); facts.push(fact); publicFacts.push({ fact,
          ...(action.type === "give" ? { visibleTarget: parent } : {}) });
        if (action.type === "give") {
          recipient = parent;
          summary = `${actor.label} gave ${item.ref.label} to ${destination.label}.`;
        } else summary = `${actor.label} ${action.type === "pickup" ? "picked up" : "put down"} ${item.ref.label}; now located in ${destination.label}.`;
      }
    } else if (action.type === "move") {
      const room = getRoomForEntity(world, eid);
      const destination = room === undefined ? undefined : workingMemoryEntityRef(world, room);
      if (destination) { const fact = location(actor, destination); facts.push(fact); publicFacts.push({ fact }); }
    } else if (["interact", "use"].includes(action.type)) {
      if (target && getAgentVisualEntities(world, eid).includes(target.eid) && !hasComponent(world, target.eid, Agent)
        && hasComponent(world, target.eid, ObjectState) && ObjectState.current[target.eid]) {
        const fact = state(target.ref, ObjectState.current[target.eid]); facts.push(fact); publicFacts.push({ fact, visibleTarget: target.eid });
      }
      if (target) for (const field of getObservedStateFields(world, eid, target.eid)) facts.push({
        subject: field.subject, subjectLabel: field.subjectLabel, predicate: "state", slot: field.slot, value: field.value,
      });
      for (const item of before.owned) {
        if (!sameEntity(world, item)) continue;
        const parent = getDirectContainer(world, item.eid);
        // The known interaction target can receive an installed part. Never turn
        // an unrelated concurrent inventory edit into a remote-location reveal.
        if (target && parent === target.eid && parent !== item.container) {
          const fact = location(item.ref, target.ref); facts.push(fact); publicFacts.push({ fact, visibleTarget: target.eid });
        }
      }
    }
  }
  const atMs = stamp(world, eid, options.atMs);
  const id = `action:${randomUUID()}`;
  const admit = (observer: number, evidence: WorkingMemoryFactInput[], provenance: WorkingMemoryProvenance, eventSummary = summary) => {
    if (!liveActor(world, observer)) return;
    const unique = [...new Map(evidence.map(f => [slotKey(f), f])).values()];
    // All these facts belong to this single committed event, even if a package
    // transfers a larger inventory than the bounded per-record budget.
    for (let offset = 0; offset < Math.max(1, unique.length); offset += 32) recordWorkingMemoryEvidence(world, observer, {
      id: `${id}:${offset}`, atMs, kind: "action", provenance, summary: eventSummary.slice(0, 1000), succeeded: success, facts: unique.slice(offset, offset + 32),
      // A fragmented event cannot grant one execution credit per fragment.
      ...(provenance === "own_action" && actionIdentity && unique.length <= 32 ? { action: actionIdentity } : {}),
      ...(provenance === "own_action" ? { completedAtSimMs, ...(executionContext ? { executionContext } : {}) } : {}),
    });
  };
  admit(eid, facts, "own_action");
  if (success && publicFacts.length) {
    if (recipient !== undefined && recipient !== eid) admit(recipient, publicFacts.map(row => row.fact), "witnessed_action");
    const room = getRoomForEntity(world, eid);
    for (const observer of query(world, [Agent])) {
      if (observer === eid || observer === recipient || room === undefined || getRoomForEntity(world, observer) !== room
        || !getAgentVisualEntities(world, observer).includes(eid)) continue;
      const visible = new Set(getAgentVisualEntities(world, observer));
      const admitted = publicFacts.filter(row => row.visibleTarget === undefined || visible.has(row.visibleTarget)).map(row => row.fact);
      if (!admitted.length) continue;
      // The actor's action arguments can contain private text (a phone message,
      // remembered instruction, etc.). Witnesses receive only visible effects.
      const witnessedSummary = `${actor.label} ${action.type === "give" || action.type === "pickup" || action.type === "drop" ? "transferred an item" : "completed a visible action"}: ${admitted.map(f =>
        `${f.subjectLabel || f.subject} ${f.predicate}${f.slot ? `.${f.slot}` : ""} = ${f.valueLabel || f.value}`).join("; ")}.`;
      admit(observer, admitted, "witnessed_action", witnessedSummary);
    }
  }
  // Own possessions and currently visible scene are sensed after completion,
  // not inferred from requested action text (also safe for missing snapshots).
  if (success) captureWorkingMemoryObservation(world, eid);
}
