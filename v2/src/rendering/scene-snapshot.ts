import type { CharacterAppearanceSnapshot } from "./character-appearance";
import { PUBLIC_PHYSICAL_OPERATIONS, type PublicPhysicalOperation } from "../runtime/simulation-timeline";

export type SceneActionStatus = "pending" | "succeeded" | "failed";
/** Executor-owned timing. An expected end is scheduling metadata, never proof. */
export type SceneActionInterval = Readonly<{
  executionId: string;
  startedAtSimMs: number;
  expectedEndSimMs?: number;
  completedAtSimMs?: number;
}>;
export type SceneEvent = Readonly<{
  id: string;
  actorId?: number;
  targetId?: number;
  roomId: number;
  kind: string;
  action?: string;
  operation?: PublicPhysicalOperation;
  status: SceneActionStatus;
  /** Actual committed public speech only. Never a thought, draft or message body. */
  text?: string;
  sourceTick: number;
  elapsedMs: number;
  /** Source event order, not a wall clock or a renderer-generated sequence. */
  sequence?: number;
  interval?: SceneActionInterval;
  actorKey?: string;
  roomKey?: string;
  targetKey?: string;
}>;
export type SceneActor = Readonly<{
  id: number;
  identityKey?: string;
  roomId: number;
  name: string;
  /** Explicitly published social role, not an inferred motive or private biography. */
  publicRole?: string;
  appearance: CharacterAppearanceSnapshot;
  activity?: Readonly<{ action: string; status: SceneActionStatus; targetId?: number }>;
  position?: Readonly<{ x: number; y: number; z?: number }>;
}>;
export type SceneProp = Readonly<{
  id: number;
  identityKey?: string;
  roomId: number;
  name: string;
  description: string;
  state?: string;
  heldBy?: number;
  /** A directly observed support/container; never a concealed ownership link. */
  supportId?: number;
}>;
export type SceneSnapshot = Readonly<{
  sourceId: string;
  sourceTick: number;
  elapsedMs: number;
  capturedWallMs: number;
  room: Readonly<{ id: number; identityKey?: string; name: string; description: string }>;
  actors: readonly SceneActor[];
  props: readonly SceneProp[];
  events: readonly SceneEvent[];
}>;
const PUBLIC_KINDS = new Set(["speech", "action", "movement", "arrival", "departure", "appearance", "wardrobe", "interaction", "observation"]);
const STATUSES = new Set<SceneActionStatus>(["pending", "succeeded", "failed"]);
const PRIVATE_ACTIONS = new Set(["think", "reflect", "remember", "plan", "message", "send_message", "read_message"]);

function str(value: unknown, limit = 512): string {
  return typeof value === "string" ? value.slice(0, limit) : "";
}

/** Copy an explicit visual allowlist; passing a richer agent object cannot leak
 * memories, conversations, arbitrary inventory or hidden action content. */
function copyAppearance(a: CharacterAppearanceSnapshot): CharacterAppearanceSnapshot {
  const i = a.identity;
  return {
    eid: a.eid, name: str(a.name, 96),
    identity: {
      height: str(i.height, 96), build: str(i.build, 96), hairColor: str(i.hairColor, 96),
      hairStyle: str(i.hairStyle, 96), eyeColor: str(i.eyeColor, 96), skinTone: str(i.skinTone, 96),
      age: str(i.age, 96), distinguishing: str(i.distinguishing, 256), description: str(i.description, 1024),
    },
    clothing: str(a.clothing), accessories: str(a.accessories),
    wornGarments: a.wornGarments.map(item => ({ eid: item.eid, name: str(item.name, 96), description: str(item.description, 256), slot: str(item.slot, 48) })),
    expression: str(a.expression, 128), posture: str(a.posture, 128), condition: str(a.condition, 256),
    visiblyHolding: str(a.visiblyHolding, 256),
    // Possession alone does not establish visibility. Render only validated held
    // items and worn garments; concealed possessions stay off the visual surface.
    possessedItems: [],
    heldItems: a.heldItems.map(item => ({ eid: item.eid, name: str(item.name, 96), description: str(item.description, 256), slot: str(item.slot, 48) })),
    description: str(a.description, 2048),
  };
}

function isSpeech(event: SceneEvent): boolean {
  return event.status === "succeeded" && (event.kind === "speech" || (event.kind === "action" && event.action === "speak"));
}

/** Public, room-local projection. The output owns every nested value. */
export function snapshotDirectorScene(source: SceneSnapshot, options: { eventLimit?: number } = {}): SceneSnapshot {
  if (!source.sourceId || source.sourceId.length > 256 || !Number.isSafeInteger(source.sourceTick) || source.sourceTick < 0 ||
      !Number.isFinite(source.elapsedMs) || source.elapsedMs < 0 || !Number.isFinite(source.capturedWallMs))
    throw new Error("A scene requires a source identity and valid committed source clocks.");
  const room = { id: source.room.id, ...(source.room.identityKey ? { identityKey: str(source.room.identityKey, 128) } : {}), name: str(source.room.name, 128), description: str(source.room.description, 3000) };
  if (!Number.isSafeInteger(room.id) || room.id < 0) throw new Error("A local room requires a valid entity identity.");
  const localActors = source.actors.filter(a => a.roomId === room.id);
  const localProps = source.props.filter(p => p.roomId === room.id);
  if (localActors.length > 24 || localProps.length > 64)
    throw new Error("The small scene testbed supports at most 24 local actors and 64 local props.");
  const actorIds = new Set(localActors.map(a => a.id));
  const visibleIds = new Set([...actorIds, ...localProps.map(p => p.id)]);
  if ([...visibleIds].some(id => !Number.isSafeInteger(id) || id < 0))
    throw new Error("Local actors and props require valid entity identities.");
  if (actorIds.size !== localActors.length || visibleIds.size !== localActors.length + localProps.length)
    throw new Error("Local actors and props require unique entity identities.");
  const actors = localActors.map(a => {
    if (a.appearance.eid !== a.id) throw new Error("Actor appearance must belong to the same entity identity.");
    const activity = a.activity && STATUSES.has(a.activity.status) && !PRIVATE_ACTIONS.has(a.activity.action)
      ? { action: str(a.activity.action, 64), status: a.activity.status,
          ...(a.activity.targetId !== undefined && visibleIds.has(a.activity.targetId) ? { targetId: a.activity.targetId } : {}) }
      : undefined;
    const position = a.position && Number.isFinite(a.position.x) && Number.isFinite(a.position.y)
      ? { x: a.position.x, y: a.position.y, ...(Number.isFinite(a.position.z) ? { z: a.position.z } : {}) } : undefined;
    return { id: a.id, ...(a.identityKey ? { identityKey: str(a.identityKey, 128) } : {}), roomId: room.id, name: str(a.name, 96), appearance: copyAppearance(a.appearance),
      ...(a.publicRole ? { publicRole: str(a.publicRole, 256) } : {}),
      ...(activity ? { activity } : {}), ...(position ? { position } : {}) };
  }).sort((a, b) => a.id - b.id);
  const props = localProps.map(p => ({ id: p.id, ...(p.identityKey ? { identityKey: str(p.identityKey, 128) } : {}), roomId: room.id, name: str(p.name, 96), description: str(p.description),
    ...(p.state ? { state: str(p.state, 256) } : {}),
    ...(p.supportId !== undefined && p.supportId !== p.id && localProps.some(support => support.id === p.supportId) ? { supportId: p.supportId } : {}),
    ...(p.heldBy !== undefined && actorIds.has(p.heldBy) ? { heldBy: p.heldBy } : {}) })).sort((a, b) => a.id - b.id);
  const eventLimit = options.eventLimit ?? 12;
  if (!Number.isSafeInteger(eventLimit) || eventLimit < 1 || eventLimit > 512) throw new Error("Invalid public scene event limit.");
  const targetVisible = (e: SceneEvent) => e.targetId !== undefined && visibleIds.has(e.targetId)
    && (!e.targetKey || [...localActors, ...localProps].some(value => value.id === e.targetId && value.identityKey === e.targetKey));
  const events = source.events.filter(e => PUBLIC_KINDS.has(e.kind) && STATUSES.has(e.status) &&
    !PRIVATE_ACTIONS.has(e.action ?? "") && e.roomId === room.id && e.sourceTick <= source.sourceTick &&
    e.elapsedMs <= source.elapsedMs && e.elapsedMs >= 0 && Number.isSafeInteger(e.sourceTick) && e.sourceTick >= 0 &&
    (e.actorId === undefined || actorIds.has(e.actorId)) && (!e.roomKey || e.roomKey === room.identityKey)
    && (!e.actorKey || localActors.some(a => a.id === e.actorId && a.identityKey === e.actorKey)))
    .map(e => ({ id: str(e.id, 128), roomId: room.id, kind: str(e.kind, 64), status: e.status,
      sourceTick: e.sourceTick, elapsedMs: e.elapsedMs,
      ...(Number.isSafeInteger(e.sequence) && e.sequence! >= 0 ? { sequence: e.sequence } : {}),
      ...(e.actorKey ? { actorKey: str(e.actorKey, 128) } : {}),
      ...(e.roomKey ? { roomKey: str(e.roomKey, 128) } : {}),
      ...(e.targetKey && targetVisible(e) ? { targetKey: str(e.targetKey, 128) } : {}),
      ...(e.interval && str(e.interval.executionId, 128) && Number.isFinite(e.interval.startedAtSimMs)
        && e.interval.startedAtSimMs >= 0 && e.interval.startedAtSimMs <= e.elapsedMs
        ? { interval: { executionId: str(e.interval.executionId, 128), startedAtSimMs: e.interval.startedAtSimMs,
          ...(Number.isFinite(e.interval.expectedEndSimMs) && e.interval.expectedEndSimMs! >= e.interval.startedAtSimMs
            ? { expectedEndSimMs: e.interval.expectedEndSimMs } : {}),
          ...(e.status !== "pending" && Number.isFinite(e.interval.completedAtSimMs)
            && e.interval.completedAtSimMs! >= e.interval.startedAtSimMs && e.interval.completedAtSimMs! <= e.elapsedMs
            ? { completedAtSimMs: e.interval.completedAtSimMs } : {}) } } : {}),
      ...(e.actorId !== undefined ? { actorId: e.actorId } : {}),
      ...(targetVisible(e) ? { targetId: e.targetId } : {}),
      ...(e.action ? { action: str(e.action, 64) } : {}),
      ...(e.kind === "action" && e.operation && PUBLIC_PHYSICAL_OPERATIONS.includes(e.operation) ? { operation: e.operation } : {}),
      ...(isSpeech(e) && e.actorId !== undefined && e.text ? { text: str(e.text, 2000) } : {}) }))
    .filter(e => e.id).sort((a, b) => a.elapsedMs - b.elapsedMs || (a.sequence ?? a.sourceTick) - (b.sequence ?? b.sourceTick) || a.id.localeCompare(b.id)).slice(-eventLimit);
  return { sourceId: source.sourceId, sourceTick: source.sourceTick, elapsedMs: source.elapsedMs,
    capturedWallMs: source.capturedWallMs, room, actors, props, events };
}
