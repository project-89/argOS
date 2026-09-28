/** Public executor events, separate from private cognition and operator logs.
 * Publishing records what just happened; it cannot execute or predict it. */
import { entityExists, hasComponent } from "bitecs";
import { randomUUID } from "node:crypto";
import type { World } from "../ecs/world";
import { Agent, Name, Room } from "../ecs/components";
import { readSimulationTime } from "../ecs/simulation-time";
import { assertSimulationTaskActive } from "./task-scope";
import { workingMemoryEntityRef } from "../cognition/working-memory";
import { PUBLIC_PHYSICAL_OPERATIONS, type PublicPhysicalOperation } from "./simulation-timeline";

export type PublicCommittedEventInput = {
  executionId: string; kind: "action" | "speech";
  actorId: number; roomId: number; targetId?: number;
  action: string; status: "pending" | "succeeded" | "failed";
  /** Public motor operation only, never raw command arguments or message text. */
  operation?: PublicPhysicalOperation;
  startedAtSimMs?: number; expectedEndSimMs?: number; completedAtSimMs?: number;
  /** Only words already spoken. A partial speech publisher must send each new
   * slice once; its final action-completion event must not repeat the script. */
  text?: string;
};
export type PublicCommittedEvent = Readonly<PublicCommittedEventInput & { id: string; sourceId: string; actorKey: string;
  roomKey: string; targetKey?: string; actorName?: string; roomName?: string; targetName?: string;
  sequence: number; tick: number; atSimMs: number }>;
type Ledger = { sourceId: string; sequence: number; events: PublicCommittedEvent[]; listeners: Set<(event: PublicCommittedEvent) => void>;
  stopListeners: Set<() => void>; closed: boolean };
const ledgers = new WeakMap<World, Ledger>();
const LIMIT = 2048;
const prohibited = new Set(["think", "reflect", "remember", "plan", "message", "send_message", "read_message"]);
const time = (n: number | undefined) => n !== undefined && Number.isFinite(n) && n >= 0;
function ledger(world: World): Ledger {
  let value = ledgers.get(world);
  if (!value) { value = { sourceId: `source:${randomUUID()}`, sequence: 0, events: [], listeners: new Set(), stopListeners: new Set(), closed: false }; ledgers.set(world, value); }
  return value;
}
export function publishCommittedEvent(world: World, input: PublicCommittedEventInput): PublicCommittedEvent {
  assertSimulationTaskActive();
  const state = ledger(world), now = readSimulationTime(world);
  if (state.closed) throw new Error("Public event source is stopped.");
  if (input?.operation !== undefined && (input.kind !== "action" || !PUBLIC_PHYSICAL_OPERATIONS.includes(input.operation)))
    throw new Error("Only a known public physical operation may enter an action receipt.");
  if (!input || !["action", "speech"].includes(input.kind) || !["pending", "succeeded", "failed"].includes(input.status)
    || typeof input.executionId !== "string" || !input.executionId.trim() || input.executionId.length > 128
    || typeof input.action !== "string" || !input.action.trim() || input.action.length > 64 || prohibited.has(input.action)
    || !entityExists(world, input.actorId) || !hasComponent(world, input.actorId, Agent)
    || !entityExists(world, input.roomId) || !hasComponent(world, input.roomId, Room)
    || input.targetId !== undefined && !entityExists(world, input.targetId)) throw new Error("Invalid public executor event.");
  if (input.startedAtSimMs !== undefined && (!time(input.startedAtSimMs) || input.startedAtSimMs > now)
    || input.expectedEndSimMs !== undefined && (!time(input.expectedEndSimMs) || input.expectedEndSimMs < (input.startedAtSimMs ?? now))
    || input.completedAtSimMs !== undefined && (input.status === "pending" || !time(input.completedAtSimMs)
      || input.completedAtSimMs < (input.startedAtSimMs ?? 0) || input.completedAtSimMs > now))
    throw new Error("Executor intervals must describe actual committed simulation time.");
  if (input.text !== undefined && (input.kind !== "speech" || input.action !== "speak" || input.status !== "succeeded"
    || typeof input.text !== "string" || !input.text.trim() || input.text.length > 2000))
    throw new Error("Only actually committed public speech can carry text.");
  const actorKey = workingMemoryEntityRef(world, input.actorId)!.key;
  const targetKey = input.targetId === undefined ? undefined : workingMemoryEntityRef(world, input.targetId)!.key;
  // A consumed/deleted target is historical evidence, not a live ECS address.
  // Recover only from this source's matching admitted interval. Never resolve
  // an old numeric ID against a replacement object, or accept supplied labels.
  const start = input.status === "pending" ? undefined : [...state.events].reverse().find(event =>
    event.status === "pending" && event.executionId === input.executionId && event.actorKey === actorKey
    && event.kind === input.kind && event.action === input.action && event.startedAtSimMs === input.startedAtSimMs);
  if (start && (targetKey !== undefined && start.targetKey !== targetKey
    || input.operation !== undefined && start.operation !== input.operation))
    throw new Error("Completion cannot rebind its admitted public interval.");
  const label = (eid: number) => hasComponent(world, eid, Name) ? Name.value[eid]?.slice(0, 200) : undefined;
  const operation = start?.operation ?? input.operation;
  const event: PublicCommittedEvent = Object.freeze({ id: `public-event:${randomUUID()}`, sequence: ++state.sequence,
    sourceId: state.sourceId, actorKey, actorName: start?.actorName ?? label(input.actorId), roomName: label(input.roomId),
    roomKey: workingMemoryEntityRef(world, input.roomId)!.key,
    tick: world.time.tick, atSimMs: now, executionId: input.executionId, kind: input.kind, actorId: input.actorId,
    roomId: input.roomId, action: input.action, status: input.status,
    ...(operation !== undefined ? { operation } : {}),
    ...(input.targetId !== undefined ? { targetId: input.targetId } : {}),
    ...((start?.targetKey ?? targetKey) ? { targetKey: start?.targetKey ?? targetKey,
      targetName: start?.targetName ?? (input.targetId === undefined ? undefined : label(input.targetId)) } : {}),
    ...(input.startedAtSimMs !== undefined ? { startedAtSimMs: input.startedAtSimMs } : {}),
    ...(input.expectedEndSimMs !== undefined ? { expectedEndSimMs: input.expectedEndSimMs } : {}),
    ...(input.completedAtSimMs !== undefined ? { completedAtSimMs: input.completedAtSimMs } : {}),
    ...(input.text !== undefined ? { text: input.text } : {}) });
  state.events.push(event); if (state.events.length > LIMIT) state.events.shift();
  // Observers cannot turn a committed action into a failed transaction.
  for (const listener of [...state.listeners]) { try { listener(event); } catch { /* observer failure is isolated */ } }
  return event;
}
export function getCommittedEvents(world: World, afterSequence = 0) {
  if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) throw new Error("Invalid public event cursor.");
  const state = ledgers.get(world), first = state?.events[0]?.sequence ?? 1;
  return { sourceId: state?.sourceId ?? null, events: state?.events.filter(e => e.sequence > afterSequence) ?? [], latestSequence: state?.sequence ?? 0,
    gap: afterSequence < first - 1, stopped: state?.closed ?? false };
}
/** Constant-time source status for identity/lifecycle checks. This is not an
 * event cursor, acknowledgement or execution authority. Never starts a source,
 * scans/copies history, or caches a result across a stop/restart boundary. */
export function getCommittedSource(world: World): Readonly<{ sourceId: string | null; latestSequence: number; stopped: boolean }> {
  const state = ledgers.get(world);
  return Object.freeze({ sourceId: state?.sourceId ?? null, latestSequence: state?.sequence ?? 0, stopped: state?.closed ?? false });
}
export function subscribeCommittedEvents(world: World, listener: (event: PublicCommittedEvent) => void): () => void {
  const state = ledger(world); if (state.closed) throw new Error("Public event source is stopped.");
  state.listeners.add(listener); return () => { state.listeners.delete(listener); };
}
export function stopCommittedEvents(world: World): void {
  const state = ledger(world); if (state.closed) return; state.closed = true; state.listeners.clear();
  for (const stop of [...state.stopListeners]) { try { stop(); } catch { /* isolated observer */ } }
  state.stopListeners.clear();
}
export function subscribeCommittedSourceStop(world: World, listener: () => void): () => void {
  const state = ledger(world); if (state.closed) { listener(); return () => {}; }
  state.stopListeners.add(listener); return () => { state.stopListeners.delete(listener); };
}
/** Restart means a fresh source epoch, not permission to append to prior film. */
export function startCommittedEvents(world: World): string {
  if (ledgers.get(world)?.closed) ledgers.delete(world);
  return ledger(world).sourceId;
}
