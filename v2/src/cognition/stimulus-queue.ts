import type { World } from "../ecs/world";
import { entityExists, hasComponent, query } from "bitecs";
import { Agent, Name } from "../ecs/components";
import { getRoomForEntity } from "../ecs/location";
import { assertSimulationTaskActive } from "../runtime/task-scope";
import { getCommittedEvents, subscribeCommittedSourceStop } from "../runtime/committed-events";
import { filterPerceivableStimuli, type SensoryModality } from "./sensory-capabilities";
import { isInvalidHeardSpeechNotice, readHeardSpeechProgress, type HeardSpeechProgress } from "./hearing-receipt";
import { bindStimulusGuard, bindStimulusLifetime, hasStimulusLifetime, inheritStimulusGuard, isStimulusCurrent, stimulusWorld } from "./stimulus-guard";
export type { SensoryModality } from "./sensory-capabilities";

export interface PendingStimulus {
  targetEid: number;
  type: string;
  content: string;
  source: string;
  modality?: SensoryModality;
  intensity?: number;
  /** Emission time, retained across pagination and delayed cognition. */
  timestamp?: number;
  /** Opaque, actor-owned receipt from the actual timed hearing producer. */
  hearing?: HeardSpeechProgress;
}

export const STIMULUS_QUEUE_LIMITS = Object.freeze({ perActor: 128, perWorld: 1024, global: 4096,
  contentBytes: 16 * 1024, perWorldBytes: 1024 * 1024, globalBytes: 8 * 1024 * 1024, recentRejections: 32 });
export type StimulusRejectionReason = "unbound_legacy" | "invalid_input" | "invalid_target" | "wrong_world" | "stale_guard"
  | "source_stopped" | "content_limit" | "actor_limit" | "world_limit" | "global_limit" | "world_bytes" | "global_bytes";
type Rejection = { reason: StimulusRejectionReason; targetEid?: number; atWallMs: number; phase: "admission" | "discard" };
type Counters = { accepted: number; rejected: number; discarded: number; reasons: Partial<Record<StimulusRejectionReason, number>>; recentRejections: Rejection[] };
type Mailbox = Counters & { rows: { row: PendingStimulus; bytes: number }[]; bytes: number; sourceId?: string; unsubscribe?: () => void;
  reference?: WeakRef<Mailbox> };
const mailboxes = new WeakMap<World, Mailbox>();
// Only nonempty mailboxes are indexed, weakly, for legacy administrative drains
// and the process-wide safety cap. Neither the index nor counters own a world.
const nonempty = new Set<WeakRef<Mailbox>>();
const finalized = new FinalizationRegistry<WeakRef<Mailbox>>(reference => nonempty.delete(reference));
const counters = (): Counters => ({ accepted: 0, rejected: 0, discarded: 0, reasons: {}, recentRejections: [] });
const unowned = counters();
function mailboxFor(world: World): Mailbox {
  let box = mailboxes.get(world);
  if (!box) { box = { ...counters(), rows: [], bytes: 0 }; mailboxes.set(world, box); }
  return box;
}
function record(box: Counters, reason: StimulusRejectionReason, row: PendingStimulus | undefined, phase: Rejection["phase"]): false {
  box[phase === "admission" ? "rejected" : "discarded"]++;
  box.reasons[reason] = (box.reasons[reason] ?? 0) + 1;
  box.recentRejections.push({ reason, ...(Number.isSafeInteger(row?.targetEid) ? { targetEid: row!.targetEid } : {}), atWallMs: Date.now(), phase });
  if (box.recentRejections.length > STIMULUS_QUEUE_LIMITS.recentRejections) box.recentRejections.shift();
  return false;
}
function deindexEmpty(box: Mailbox): void {
  if (box.rows.length || !box.reference) return;
  nonempty.delete(box.reference); finalized.unregister(box.reference); box.reference = undefined;
}
function removeAt(box: Mailbox, index: number): PendingStimulus {
  const [entry] = box.rows.splice(index, 1); box.bytes -= entry.bytes; deindexEmpty(box); return entry.row;
}
function current(row: PendingStimulus, world?: World): boolean {
  const owner = stimulusWorld(row);
  return !!owner && (!world || owner === world) && hasStimulusLifetime(row) && isStimulusCurrent(row, world)
    && !isInvalidHeardSpeechNotice(owner, row.targetEid, row);
}
function prune(box: Mailbox): void {
  for (let i = 0; i < box.rows.length;) {
    if (current(box.rows[i].row)) i++;
    else record(box, "stale_guard", removeAt(box, i), "discard");
  }
}
function boxes(): Mailbox[] {
  const result: Mailbox[] = [];
  for (const reference of nonempty) {
    const box = reference.deref();
    if (box) result.push(box); else nonempty.delete(reference);
  }
  return result;
}
/** Per-world counters survive an empty mailbox. The no-world administrative
 * view covers currently pending worlds and unowned legacy admission failures. */
export function getStimulusQueueStatus(world?: World) {
  const owners: Counters[] = world ? (mailboxes.has(world) ? [mailboxes.get(world)!] : []) : [unowned, ...boxes()];
  const queues = world ? (mailboxes.has(world) ? [mailboxes.get(world)!] : []) : boxes();
  const reasons: Partial<Record<StimulusRejectionReason, number>> = {};
  for (const owner of owners) for (const [reason, count] of Object.entries(owner.reasons))
    reasons[reason as StimulusRejectionReason] = (reasons[reason as StimulusRejectionReason] ?? 0) + count!;
  const rejected = owners.reduce((n, box) => n + box.rejected, 0), discarded = owners.reduce((n, box) => n + box.discarded, 0);
  return { pending: queues.reduce((n, box) => n + box.rows.length, 0), pendingBytes: queues.reduce((n, box) => n + box.bytes, 0),
    accepted: owners.reduce((n, box) => n + box.accepted, 0), rejected, discarded, dropped: rejected + discarded, reasons,
    recentRejections: owners.flatMap(box => box.recentRejections).sort((a, b) => a.atWallMs - b.atWallMs)
      .slice(-STIMULUS_QUEUE_LIMITS.recentRejections).map(row => ({ ...row })), limits: STIMULUS_QUEUE_LIMITS };
}

/** Host-owned advisory evidence is rechecked at actual foreground intake. */
export function queueGuardedStimulus(world: World, stimulus: PendingStimulus, isCurrent: () => boolean): boolean {
  assertSimulationTaskActive();
  const row = inheritStimulusGuard(stimulus, { ...stimulus });
  bindStimulusGuard(row, world, isCurrent);
  return queueStimulus(world, row);
}

/** Fresh input requires an explicit world. A one-argument call is retained only
 * for trusted opaque requeue envelopes; JSON/unguarded legacy input is rejected.
 * Failure is observable without throwing after an already committed action. */
export function queueStimulus(world: World, stimulus: PendingStimulus): boolean;
export function queueStimulus(stimulus: PendingStimulus): boolean;
export function queueStimulus(worldOrStimulus: World | PendingStimulus, input?: PendingStimulus): boolean {
  assertSimulationTaskActive();
  const stimulus = input ?? worldOrStimulus as PendingStimulus;
  const world = input ? worldOrStimulus as World : stimulusWorld(stimulus);
  if (!world || !input && !hasStimulusLifetime(stimulus)) return record(unowned, "unbound_legacy", stimulus, "admission");
  const box = mailboxFor(world);
  if (!stimulus || !Number.isSafeInteger(stimulus.targetEid) || stimulus.targetEid < 0
    || typeof stimulus.content !== "string" || typeof stimulus.source !== "string" || typeof stimulus.type !== "string"
    || stimulus.modality !== undefined && !["visual", "auditory", "olfactory", "tactile", "cognitive"].includes(stimulus.modality)
    || stimulus.intensity !== undefined && !Number.isFinite(stimulus.intensity))
    return record(box, "invalid_input", stimulus, "admission");
  const contentBytes = Buffer.byteLength(stimulus.content), sourceBytes = Buffer.byteLength(stimulus.source), typeBytes = Buffer.byteLength(stimulus.type);
  if (contentBytes > STIMULUS_QUEUE_LIMITS.contentBytes || sourceBytes > 512 || typeBytes > 128)
    return record(box, "content_limit", stimulus, "admission");
  if (stimulusWorld(stimulus) && stimulusWorld(stimulus) !== world) return record(box, "wrong_world", stimulus, "admission");
  if (getCommittedEvents(world).stopped) return record(box, "source_stopped", stimulus, "admission");
  if (!entityExists(world, stimulus.targetEid) || !hasComponent(world, stimulus.targetEid, Agent) || Agent.active[stimulus.targetEid] === false)
    return record(box, "invalid_target", stimulus, "admission");
  if (isInvalidHeardSpeechNotice(world, stimulus.targetEid, stimulus)) return record(box, "stale_guard", stimulus, "admission");
  const hearing = readHeardSpeechProgress(world, stimulus.targetEid, stimulus);
  // Whitelist fields: arbitrary producer metadata must not defeat byte bounds.
  // The exact opaque hearing object is preserved; it cannot be cloned or trimmed.
  const row = inheritStimulusGuard(stimulus, { targetEid: stimulus.targetEid, type: stimulus.type, content: stimulus.content, source: stimulus.source,
    ...(stimulus.modality !== undefined ? { modality: stimulus.modality } : {}), ...(stimulus.intensity !== undefined ? { intensity: stimulus.intensity } : {}),
    ...(hearing ? { hearing } : {}), timestamp: Number.isFinite(stimulus.timestamp) ? stimulus.timestamp : Date.now() });
  if (!bindStimulusLifetime(row, world) || !current(row, world)) return record(box, "stale_guard", stimulus, "admission");
  const bytes = contentBytes + sourceBytes + typeBytes + 256;
  const localLimit = (): StimulusRejectionReason | undefined => {
    if (box.rows.filter(entry => entry.row.targetEid === row.targetEid).length >= STIMULUS_QUEUE_LIMITS.perActor) return "actor_limit";
    if (box.rows.length >= STIMULUS_QUEUE_LIMITS.perWorld) return "world_limit";
    if (box.bytes + bytes > STIMULUS_QUEUE_LIMITS.perWorldBytes) return "world_bytes";
  };
  // Intake always validates each row; admission only sweeps old rows when it
  // needs capacity, avoiding a full receipt-history scan on every fresh signal.
  if (localLimit()) prune(box);
  const localRejection = localLimit(); if (localRejection) return record(box, localRejection, row, "admission");
  const active = boxes();
  const globalLimit = (): StimulusRejectionReason | undefined => {
    if (active.reduce((n, other) => n + other.rows.length, 0) >= STIMULUS_QUEUE_LIMITS.global) return "global_limit";
    if (active.reduce((n, other) => n + other.bytes, 0) + bytes > STIMULUS_QUEUE_LIMITS.globalBytes) return "global_bytes";
  };
  if (globalLimit()) for (const other of active) prune(other);
  const globalRejection = globalLimit(); if (globalRejection) return record(box, globalRejection, row, "admission");
  const sourceId = getCommittedEvents(world).sourceId!;
  if (box.sourceId !== sourceId) {
    box.unsubscribe?.(); box.sourceId = sourceId;
    box.unsubscribe = subscribeCommittedSourceStop(world, () => {
      while (box.rows.length) record(box, "source_stopped", removeAt(box, box.rows.length - 1), "discard");
      box.unsubscribe = undefined;
    });
  }
  if (!box.reference) { box.reference = new WeakRef(box); nonempty.add(box.reference); finalized.register(box, box.reference, box.reference); }
  box.rows.push({ row, bytes }); box.bytes += bytes; box.accepted++;
  return true;
}

/** Without a world this is an administrative/test drain, never actor intake. */
export function drainPendingStimuli(targets?: ReadonlySet<number>, world?: World): PendingStimulus[] {
  const selected: PendingStimulus[] = [];
  const owners = world ? (mailboxes.has(world) ? [mailboxes.get(world)!] : []) : boxes();
  for (const box of owners) {
    prune(box);
    for (let i = 0; i < box.rows.length;) {
      if (!targets || targets.has(box.rows[i].row.targetEid)) selected.push(removeAt(box, i)); else i++;
    }
  }
  return selected;
}

/** Read-only scheduling probe; observing the queue does not consume its signals. */
export function peekPendingStimuli(targetEid?: number, world?: World): PendingStimulus[] {
  const owners = world ? (mailboxes.has(world) ? [mailboxes.get(world)!] : []) : boxes();
  return owners.flatMap(box => box.rows.filter(({ row }) => (targetEid === undefined || row.targetEid === targetEid) && current(row, world))
    .map(({ row }) => inheritStimulusGuard(row, { ...row })));
}

export function queueStimulusForAgent(world: World, agentName: string, stimulus: Omit<PendingStimulus, "targetEid">): boolean {
  for (const eid of query(world, [Agent])) if (Name.value[eid] === agentName) {
    const perceived = filterPerceivableStimuli(world, eid, [stimulus]);
    return perceived.length > 0 && queueStimulus(world, { targetEid: eid, ...perceived[0] });
  }
  return false;
}

export function broadcastToRoom(world: World, roomEid: number, stimulus: Omit<PendingStimulus, "targetEid">, excludeEid?: number) {
  let attempted = 0, accepted = 0;
  for (const eid of query(world, [Agent])) {
    if (excludeEid !== undefined && eid === excludeEid || getRoomForEntity(world, eid) !== roomEid) continue;
    for (const perceived of filterPerceivableStimuli(world, eid, [stimulus])) {
      attempted++; if (queueStimulus(world, { targetEid: eid, ...perceived })) accepted++;
    }
  }
  return { attempted, accepted, rejected: attempted - accepted };
}
