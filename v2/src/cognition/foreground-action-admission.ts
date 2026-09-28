/** A returned foreground proposal is not an executed action. Recheck only its
 * relevant, observer-local sources before admitting it, including the gap
 * between parallel decision completion and the actual executor call. */
import { entityExists, hasComponent, query } from "bitecs";
import { randomUUID } from "node:crypto";
import { Agent, Name, ObjectState, Room, WorkingMemoryIdentity } from "../ecs/components";
import { getDirectContainer, getRoomForEntity } from "../ecs/location";
import type { World } from "../ecs/world";
import type { AgentAction } from "./agent-mind";
import { getValidActionTypes } from "./action-registry";
import { getAgentSensoryCapabilities } from "./sensory-capabilities";
import { workingMemoryEntityRef } from "./working-memory";
import { getAgentObservableEntities, getAgentVisualEntities, getAgentWorldCapabilities, getAgentWorldCapabilityGeneration } from "./world-capabilities";
import { getAvailableAffordances } from "../world/affordance-availability";
import { matchesAffordanceCommand } from "../world/affordance-command";
import { captureCognitiveLocalView, isCognitiveLocalViewCurrent, getLocalDependencyChange, type CognitiveLocalView, type LocalDependencyChange } from "./cognitive-local-view";
import { chronicle } from "./simulation-chronicle";
import { getCommittedSource, startCommittedEvents } from "../runtime/committed-events";
import { readSimulationTime } from "../ecs/simulation-time";
import { readLocalSpeechOpportunity } from "./timed-speech";
import { getAspirations } from "./goal-learning";

type Action = Pick<AgentAction, "type" | "target" | "content">;
type LocalEntity = { eid: number; key: string; label: string; container?: string; state?: string; affordances: readonly string[] };
type Surface = {
  ownerKey: string; actorIdentity: string; roomKey?: string; busy: boolean; visual: boolean;
  capabilities: ReturnType<typeof getAgentWorldCapabilities>;
  capabilityGeneration: object | undefined;
  types: readonly string[]; entities: readonly LocalEntity[]; routes: readonly LocalEntity[];
};
export type ForegroundDiscardReason = "source_changed" | "actor_changed" | "location_changed"
  | "target_changed" | "reach_changed" | "command_availability_changed" | "action_type_changed"
  | "body_availability_changed" | "target_state_changed" | "local_view_changed" | "voice_changed" | "invalid_issuance" | "already_consumed";
export type ForegroundSemanticDiscardReason = "undertaking_changed" | "goal_changed" | "dialogue_changed"
  | "working_memory_changed" | "coordination_citation_changed" | "coordination_changed";
export type ForegroundAdmissionFailure = ForegroundDiscardReason | ForegroundSemanticDiscardReason | ForegroundRejectionReason;
export interface ForegroundMentalEnvelope {
  /** New controller protocol: integrate the historical experience/owned intent
   * independently, then validate the immediate command at execution. Legacy
   * callers without this contract retain strict whole-envelope admission. */
  readonly independent?: {
    readonly purpose?: string;
    localDependencies: readonly string[];
    checkExecution(): ForegroundAdmissionFailure | undefined;
    status(value: "waiting" | "needs_revision" | "dispatched", reason?: string): void;
  };
  /** Speech/quiet choices and commands bound to newly proposed work cannot be
   * detached from the cognitive update that gives them their meaning. */
  readonly required: boolean;
  readonly discardedAtResponse?: ForegroundAdmissionFailure;
  checkActionBindings(): ForegroundAdmissionFailure | undefined;
  checkCurrent(): ForegroundAdmissionFailure | undefined;
  commit(): ForegroundAdmissionFailure | undefined;
  admitted(mentalUpdate: "admitted" | "omitted"): void;
}
export interface ForegroundDecisionFence { readonly requestId: string }
export type ForegroundSchemaField = import("./foreground-response-shape").ForegroundActionShapeField | "control" | "appraiseSpeechIds" | "control.goalId" | "goalReview" | "attentionReview"
  | import("./activity-review").ActivityReviewRejectionField
  | import("./goal-pursuit").GoalReviewRejectionField | "goalReview.disabled" | "goalReview.conflict"
  | "control.switchReason" | "control.activityReview" | "control.activityDisposition" | "control.nextPurpose" | "action" | "affectUpdate" | "action.stopSpeaking" | "motorPlan" | "planDecision";
export type ForegroundRejectionReason = "missing_json" | "malformed_json" | "invalid_schema" | "missing_action_input"
  | "selection_suppressed"
  | "invalid_undertaking_reference" | "invalid_goal_reference" | "new_goal_not_admitted" | "undertaking_not_admitted"
  | "provider_error" | "timeout" | "cancelled" | "binding_error" | "commit_error";
export interface ForegroundReferenceDiagnostic {
  supplied: { kind: string; value?: string | number | boolean | null; truncated?: boolean };
  issued: readonly { id: string; status: string; eligible: boolean }[];
  matchesOwnSpeech: boolean;
}
/** Operator metadata only: never retain task prose, prompts, arbitrary objects,
 * provider error bodies or unrestricted model JSON in rejection diagnostics. */
export function foregroundReferenceDiagnostic(value: unknown,
  issued: readonly { id: string; status: string; eligible: boolean }[], matchesOwnSpeech: boolean): ForegroundReferenceDiagnostic {
  const kind = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  const supplied: ForegroundReferenceDiagnostic["supplied"] = { kind };
  if (typeof value === "string") { supplied.value = value.slice(0, 180); if (value.length > 180) supplied.truncated = true; }
  else if (value === null || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) supplied.value = value;
  return { supplied, issued: issued.slice(0, 8).map(item => ({ id: item.id.slice(0, 180), status: item.status.slice(0, 40), eligible: item.eligible })), matchesOwnSpeech };
}
export function rejectForegroundDecision(world: World, eid: number, reason: ForegroundRejectionReason,
  details: { requestId?: string; actionType?: string; reference?: ForegroundReferenceDiagnostic; schemaField?: ForegroundSchemaField;
    schemaIssue?: import("./actor-wait").ActorWaitIssue; controlShape?: string } = {}): AgentAction {
  chronicle.record("decision_rejected", { agent: Name.value[eid], reason, boundary: "response", ...details });
  return discardedForegroundDecision();
}
type Issuance = { world: World; eid: number; atMs: number; sourceId: string; surface: Surface; localView: CognitiveLocalView };
const fences = new WeakMap<ForegroundDecisionFence, Issuance>();
const dependencyChanges = new WeakMap<ForegroundDecisionFence, LocalDependencyChange>();
const latest = new WeakMap<World, Map<number, ForegroundDecisionFence>>();
type Bound = { world: World; eid: number; fence: ForegroundDecisionFence; action: string; reasoning: string; consumed: boolean; integrated?: boolean;
  envelope?: ForegroundMentalEnvelope };
const actions = new WeakMap<AgentAction, Bound>();
const discarded = new WeakSet<AgentAction>();
const pendingSpeech = new WeakMap<World, Map<number, { action: AgentAction; since: number }>>();
const physical = new Set(["move", "interact", "pickup", "drop", "use", "give", "attack", "observe", "examine"]);
export const isPhysicalForegroundAction = (action: Action): boolean => physical.has(action.type);
const label = (value?: string) => String(value || "").trim().toLocaleLowerCase();
const exact = (action: AgentAction) => JSON.stringify([action.type, action.target, action.content,
  action.coordinationGoal, action.coordinationWork, action.executionId, action.speechMode, action.stopSpeechId, action.listeningTo, action.waitUntil]);
const actorIdentity = (world: World, eid: number) => JSON.stringify([Name.value[eid], Agent.role[eid], Agent.systemPrompt[eid], getAspirations(world, eid)]);
function key(world: World, eid: number | undefined, assign: boolean): string | undefined {
  if (eid === undefined || !entityExists(world, eid)) return;
  if (assign) return workingMemoryEntityRef(world, eid)?.key;
  return hasComponent(world, eid, WorkingMemoryIdentity) ? WorkingMemoryIdentity.id[eid] || undefined : undefined;
}
function live(world: World, eid: number): boolean {
  return entityExists(world, eid) && hasComponent(world, eid, Agent) && Agent.active[eid];
}

/** Reads the same local targets and public route catalog as the action menu.
 * Identity allocation is confined to the real request boundary, not validation.
 * No remote contents, private fields, secret argument validity or executor
 * outcomes are inspected. Affordance names are already actor-visible capability
 * information; their private requirements/reasons are never retained. */
function surface(world: World, eid: number, assign: boolean): Surface | undefined {
  if (!live(world, eid)) return;
  const ownerKey = key(world, eid, assign); if (!ownerKey) return;
  const capabilities = getAgentWorldCapabilities(world, eid);
  const room = getRoomForEntity(world, eid), roomKey = key(world, room, assign);
  const visible = getAgentObservableEntities(world, eid);
  const sighted = new Set(getAgentVisualEntities(world, eid));
  const local = new Set([...visible, ...(room === undefined ? [] : [room])]);
  const visual = getAgentSensoryCapabilities(world, eid).visual > 0;
  const read = (target: number, isLocal: boolean): LocalEntity | undefined => {
    if (!entityExists(world, target) || !hasComponent(world, target, Name)) return;
    const entityKey = key(world, target, assign);
    // A newly observed replacement without an identity is still a different
    // surface. Do not assign metadata while validating an older proposal.
    const targetKey = entityKey || `unadmitted:${target}`;
    const parent = isLocal ? getDirectContainer(world, target) : undefined;
    const knownParent = parent === eid ? ownerKey : parent === room ? roomKey
      : parent !== undefined && local.has(parent) ? key(world, parent, assign) : undefined;
    return Object.freeze({ eid: target, key: targetKey, label: Name.value[target],
      ...(knownParent ? { container: knownParent } : {}),
      ...(isLocal && visual && (sighted.has(target) || target === room) && !hasComponent(world, target, Agent)
        && hasComponent(world, target, ObjectState) ? { state: ObjectState.current[target] } : {}),
      affordances: Object.freeze(isLocal ? [...new Set(getAvailableAffordances(world, eid, target).map(a => a.name))].sort() : []),
    });
  };
  // Preserve existing legacy room-catalog semantics; an explicit empty or invalid
  // package route list is authoritative, never a reason to enumerate rooms.
  const supplied = capabilities?.movementTargets?.();
  const routes = capabilities?.movementTargets ? Array.isArray(supplied) ? supplied : [] : Array.from(query(world, [Room]));
  return Object.freeze({ ownerKey, actorIdentity: actorIdentity(world, eid), roomKey, capabilities,
    capabilityGeneration: getAgentWorldCapabilityGeneration(world, eid), busy: capabilities?.busy() || false, visual,
    types: Object.freeze(getValidActionTypes(world, eid)),
    entities: Object.freeze([...local].map(target => read(target, true)).filter((entry): entry is LocalEntity => !!entry)),
    routes: Object.freeze([...new Set(routes)].filter(target => Number.isSafeInteger(target) && entityExists(world, target)
      && hasComponent(world, target, Room)).map(target => read(target, false)).filter((entry): entry is LocalEntity => !!entry)),
  });
}

export function captureForegroundDecisionFence(world: World, eid: number): ForegroundDecisionFence | undefined {
  if (!live(world, eid) || getCommittedSource(world).stopped) return;
  const source = surface(world, eid, true); if (!source) return;
  // Establish the action menu's public identity metadata first, so sensing and
  // its route fingerprint do not mistake our own UUID allocation for a change.
  const localView = captureCognitiveLocalView(world, eid); if (!localView) return;
  const fence = Object.freeze({ requestId: `foreground:${randomUUID()}` });
  fences.set(fence, { world, eid, atMs: Date.now(), sourceId: startCommittedEvents(world), surface: source, localView });
  let actors = latest.get(world); if (!actors) { actors = new Map(); latest.set(world, actors); }
  actors.set(eid, fence);
  return fence;
}

/** Operator correlation only. No sensing, identity allocation, prompt prose or
 * admission authority escapes this read. A stale scene can still be attributed
 * to its actual request; a replaced actor or another world cannot inherit it. */
export function peekForegroundDecisionSource(world: World, eid: number):
  Readonly<{ requestId: string; actorKey: string }> | undefined {
  const fence = latest.get(world)?.get(eid), issued = fence && fences.get(fence);
  if (!fence || !issued || issued.world !== world || issued.eid !== eid || !live(world, eid)
    || key(world, eid, false) !== issued.surface.ownerKey || actorIdentity(world, eid) !== issued.surface.actorIdentity) return;
  return Object.freeze({ requestId: fence.requestId, actorKey: issued.surface.ownerKey });
}

/** The exact issued, actor-owned view used by the request, not a fresh read that
 * could silently change what an already issued proposal claims to have seen. */
export function getForegroundDecisionLocalView(world: World, eid: number,
  fence: ForegroundDecisionFence | undefined): CognitiveLocalView | undefined {
  const issued = fence && fences.get(fence);
  if (!issued || issued.world !== world || issued.eid !== eid || latest.get(world)?.get(eid) !== fence) return;
  return issued.localView;
}

function matches(entities: readonly LocalEntity[], target?: string): LocalEntity[] {
  const wanted = label(target); return wanted ? entities.filter(entity => label(entity.label) === wanted) : [];
}
function identity(entities: readonly LocalEntity[]): string {
  return JSON.stringify(entities.map(entity => [entity.key, entity.label, entity.container]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function checkOwner(world: World, eid: number, fence: ForegroundDecisionFence | undefined): ForegroundDiscardReason | undefined {
  const issued = fence && fences.get(fence);
  if (!issued || issued.world !== world || issued.eid !== eid || latest.get(world)?.get(eid) !== fence
    || Date.now() < issued.atMs || getCommittedSource(world).stopped || getCommittedSource(world).sourceId !== issued.sourceId) return "source_changed";
  if (!live(world, eid) || key(world, eid, false) !== issued.surface.ownerKey
    || actorIdentity(world, eid) !== issued.surface.actorIdentity) return "actor_changed";
  if (getAgentWorldCapabilities(world, eid) !== issued.surface.capabilities
    || getAgentWorldCapabilityGeneration(world, eid) !== issued.surface.capabilityGeneration) return "source_changed";
}
export function checkForegroundDecision(world: World, eid: number, fence: ForegroundDecisionFence | undefined,
  action: Action, dependencies?: readonly string[]): ForegroundDiscardReason | undefined {
  if (fence) dependencyChanges.delete(fence);
  const ownerChange = checkOwner(world, eid, fence); if (ownerChange) return ownerChange;
  const issued = fences.get(fence!)!;
  // A present-decision thought, wait or conversation may describe the whole
  // local scene without naming any physical target. Reconsider that scene as a
  // unit; do not infer dependencies from prose. Selected physical work retains
  // the narrower checks below so unrelated activity cannot starve execution.
  if (!physical.has(action.type) && dependencies === undefined) {
    if (isCognitiveLocalViewCurrent(world, eid, issued.localView)) return;
    dependencyChanges.set(fence!, Object.freeze({ reason: "whole_view_changed", changed: Object.freeze([]) }));
    return "local_view_changed";
  }
  const current = surface(world, eid, false); if (!current) return "actor_changed";
  const before = issued.surface;
  if (before.capabilities !== current.capabilities || before.capabilityGeneration !== current.capabilityGeneration) return "source_changed";
  if (before.roomKey !== current.roomKey) return "location_changed";
  if (before.types.includes(action.type) !== current.types.includes(action.type)) return "action_type_changed";
  if (dependencies) {
    const dependencyChange = getLocalDependencyChange(world, eid, issued.localView, dependencies, { actionType: action.type });
    if (dependencyChange) { dependencyChanges.set(fence!, dependencyChange); return "local_view_changed"; }
  }
  if (!physical.has(action.type)) {
    if (action.target && identity(matches(before.entities, action.target)) !== identity(matches(current.entities, action.target))) return "target_changed";
    return;
  }
  if (before.busy !== current.busy) return "body_availability_changed";
  const moving = action.type === "move";
  const oldTargets = matches(moving ? before.routes : before.entities, action.target);
  const newTargets = matches(moving ? current.routes : current.entities, action.target);
  if (identity(oldTargets) !== identity(newTargets)) return moving ? "reach_changed" : "target_changed";
  // Unknown/ambiguous names and unavailable commands that are unchanged remain
  // actual choices for the executor to reject, not fabricated stale-source wins.
  if (oldTargets.length === 1 && newTargets.length === 1) {
    if (action.type === "interact") {
      const commands = (entity: LocalEntity) => JSON.stringify(entity.affordances.filter(name => matchesAffordanceCommand(name, action.content || "")));
      if (commands(oldTargets[0]) !== commands(newTargets[0])) return "command_availability_changed";
    }
    if (!["move", "observe", "examine"].includes(action.type) && oldTargets[0].state !== newTargets[0].state) return "target_state_changed";
  }
  if (action.type === "give" && identity(matches(before.entities, action.content)) !== identity(matches(current.entities, action.content))) return "target_changed";
}

function tag(action: AgentAction, id: string): AgentAction {
  Object.defineProperty(action, "foregroundDecisionId", { value: id, enumerable: true, writable: false });
  return action;
}
/** Compatibility-shaped return value, explicitly NOT an intentional wait. Both
 * runCognitionCycle and executeActions refuse it without execution or learning. */
export function discardedForegroundDecision(): AgentAction {
  const action = tag({ type: "wait" }, `discarded:${randomUUID()}`); discarded.add(action); return action;
}
export function isDiscardedForegroundDecision(action: AgentAction): boolean { return discarded.has(action); }

/** Keep the marker enumerable so ordinary object-spread/JSON copies cannot lose
 * provenance accidentally. Only this exact in-process action object is admitted;
 * model-supplied/restored/copied markers confer no execution authority. */
export function bindForegroundAction(world: World, eid: number, fence: ForegroundDecisionFence,
  action: AgentAction, reasoning: string, envelope?: ForegroundMentalEnvelope): AgentAction {
  tag(action, fence.requestId);
  actions.set(action, { world, eid, fence, action: exact(action), reasoning, consumed: false, envelope });
  return action;
}

/** Admission of an interpretation is not execution of its proposed body/voice
 * command. No external scene check is used to erase a historical experience.
 * Identity, owned state and cited review evidence still have to be current. */
export function integrateForegroundAction(world: World, eid: number, action: AgentAction): ForegroundAdmissionFailure | undefined {
  const bound = actions.get(action);
  if (!bound?.envelope?.independent || bound.world !== world || bound.eid !== eid || bound.action !== exact(action)) return "invalid_issuance";
  if (bound.integrated) return;
  const reason = checkOwner(world, eid, bound.fence) || bound.envelope.checkActionBindings() || bound.envelope.checkCurrent();
  if (reason) return reason;
  const rejected = bound.envelope.commit(); if (rejected) return rejected;
  bound.integrated = true;
  chronicle.record("cognition_integrated", { agent: Name.value[eid], agentEid: eid, requestId: bound.fence.requestId });
}
function executionChange(world: World, eid: number, action: AgentAction, bound: Bound): ForegroundAdmissionFailure | undefined {
  return checkForegroundDecision(world, eid, bound.fence, action, bound.envelope?.independent?.localDependencies)
    || bound.envelope?.checkActionBindings() || bound.envelope?.independent?.checkExecution();
}
/** Retain only an already integrated, exact, one-shot speech proposal. Each
 * subsequent tick validates its dependencies; new relevant evidence requests
 * fresh wording while the actor-owned purpose remains in cognition. */
export function deferIntegratedForegroundSpeech(world: World, eid: number, action: AgentAction): boolean {
  const bound = actions.get(action);
  if (!bound?.integrated || !bound.envelope?.independent || bound.consumed || bound.world !== world || bound.eid !== eid
    || bound.action !== exact(action) || action.type !== "speak" || action.stopSpeechId) return false;
  const reason = executionChange(world, eid, action, bound);
  if (reason) { bound.envelope.independent.status("needs_revision", reason); return false; }
  let rows = pendingSpeech.get(world); if (!rows) { rows = new Map(); pendingSpeech.set(world, rows); }
  rows.set(eid, { action, since: readSimulationTime(world) });
  bound.envelope.independent.status("waiting", "speech_floor");
  chronicle.record("continuation_waiting", { agent: Name.value[eid], agentEid: eid, requestId: bound.fence.requestId, actionType: action.type });
  return true;
}
export function pollForegroundContinuation(world: World, eid: number): { waiting: boolean; action?: AgentAction; needsRevision?: boolean } | undefined {
  const row = pendingSpeech.get(world)?.get(eid); if (!row) return;
  const bound = actions.get(row.action), now = readSimulationTime(world);
  const reason = !bound || bound.consumed || bound.action !== exact(row.action) ? "invalid_issuance"
    : now < row.since || now - row.since > 15_000 ? "source_changed" : executionChange(world, eid, row.action, bound);
  if (reason) {
    pendingSpeech.get(world)!.delete(eid);
    bound?.envelope?.independent?.status("needs_revision", reason);
    if (bound) chronicle.record("continuation_revised", { agent: Name.value[eid], agentEid: eid, requestId: bound.fence.requestId,
      actionType: row.action.type, reason, boundary: "controller",
      ...(reason === "local_view_changed" ? { localDependencyChange: dependencyChanges.get(bound.fence) } : {}) });
    return { waiting: false, needsRevision: true };
  }
  if (!readLocalSpeechOpportunity(world, eid, { mode: row.action.speechMode === "interrupt" ? "urgent" : "conversational" }).available) return { waiting: true };
  pendingSpeech.get(world)!.delete(eid);
  if (bound) chronicle.record("continuation_resumed", { agent: Name.value[eid], agentEid: eid, requestId: bound.fence.requestId, actionType: row.action.type });
  return { waiting: false, action: row.action };
}

export function consumeForegroundAction(world: World, eid: number, action: AgentAction):
  { admitted: true; selected?: true; reasoning?: string; purpose?: string; mentalUpdateOmitted?: boolean }
  | { admitted: false; reason?: ForegroundAdmissionFailure; localDependencyChange?: LocalDependencyChange } {
  if (discarded.has(action)) return { admitted: false };
  if (action.foregroundDecisionId === undefined) return { admitted: true }; // Native/deterministic execution is unchanged.
  const bound = actions.get(action);
  if (!bound || bound.world !== world || bound.eid !== eid || action.foregroundDecisionId !== bound.fence.requestId
    || bound.action !== exact(action)) return { admitted: false, reason: "invalid_issuance" };
  if (bound.consumed) return { admitted: false, reason: "already_consumed" };
  bound.consumed = true;
  const reason = bound.envelope?.independent ? executionChange(world, eid, action, bound) : checkForegroundDecision(world, eid, bound.fence, action);
  if (reason) bound.envelope?.independent?.status("needs_revision", reason);
  if (reason) return { admitted: false, reason,
    ...(reason === "local_view_changed" ? { localDependencyChange: dependencyChanges.get(bound.fence) } : {}) };
  const envelope = bound.envelope;
  if (!envelope) return { admitted: true, selected: true, reasoning: bound.reasoning };
  // Telemetry/observer callbacks run after admission. An observer failure must
  // not reject a body command whose cognitive effects were already committed.
  const notify = (state: "admitted" | "omitted") => {
    try { envelope.admitted(state); }
    catch { console.warn("[ForegroundAdmission] Admission notification failed."); }
  };
  try {
    if (envelope.independent) {
      const rejected = integrateForegroundAction(world, eid, action);
      if (rejected) return { admitted: false, reason: rejected };
      envelope.independent.status("dispatched");
      notify("admitted");
      return { admitted: true, selected: true, reasoning: bound.reasoning, purpose: envelope.independent.purpose };
    }
    const binding = envelope.checkActionBindings();
    if (binding) return { admitted: false, reason: binding };
    const mental = envelope.discardedAtResponse || envelope.checkCurrent();
    if (mental && envelope.required) return { admitted: false, reason: mental };
    if (mental) {
      chronicle.record("mental_update_discarded", { agent: Name.value[eid], agentEid: eid, requestId: bound.fence.requestId,
        actionType: action.type, reason: mental, boundary: envelope.discardedAtResponse ? "response" : "dispatch" });
      notify("omitted");
      return { admitted: true, mentalUpdateOmitted: true };
    }
    const rejected = envelope.commit();
    if (rejected) return { admitted: false, reason: rejected };
    notify("admitted");
    return { admitted: true, selected: true, reasoning: bound.reasoning };
  } catch {
    return { admitted: false, reason: "commit_error" };
  }
}
