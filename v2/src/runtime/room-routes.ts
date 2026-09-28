/** Explicit one-step topology for native room locomotion. Unopted worlds retain
 * their legacy package/grid rules. Edges are ordinary persisted AdjacentTo ECS
 * relations; this runtime policy and in-flight authority are never restored. */
import { addComponent, entityExists, getRelationTargets, hasComponent, query, removeComponent } from "bitecs";
import type { World } from "../ecs/world";
import { Agent, Name, Removed, Room, WorkingMemoryIdentity } from "../ecs/components";
import { AdjacentTo } from "../ecs/relations";
import { getRoomForEntity } from "../ecs/location";
import { readSimulationTime } from "../ecs/simulation-time";
import { workingMemoryEntityRef } from "../cognition/working-memory";
import { getCommittedEvents, startCommittedEvents, subscribeCommittedSourceStop } from "./committed-events";
import { assertSimulationTaskActive, getSimulationTaskSignal } from "./task-scope";

type Policy = { generation: object; sourceId: string; installedAt: number; travelMs: number; stopped: boolean;
  edges: Map<string, number>; outgoingRevisions: Map<string, number>; unsubscribe: () => void };
const policies = new WeakMap<World, Policy>();
const room = (world: World, eid: number) => entityExists(world, eid) && hasComponent(world, eid, Room)
  && hasComponent(world, eid, Name) && !!Name.value[eid]?.trim();
const key = (world: World, eid: number) => entityExists(world, eid) && hasComponent(world, eid, WorkingMemoryIdentity)
  ? WorkingMemoryIdentity.id[eid] : undefined;
function current(world: World, policy: Policy): boolean {
  const source = getCommittedEvents(world), now = readSimulationTime(world);
  return policies.get(world) === policy && !policy.stopped && !source.stopped && source.sourceId === policy.sourceId
    && Number.isFinite(now) && now >= policy.installedAt;
}
/** Explicit authority installation; never implicitly revives a stopped source. */
export function enableRoomRouteTopology(world: World, options: { travelMs?: number } = {}): () => void {
  assertSimulationTaskActive();
  if (policies.has(world)) throw new Error("Room route topology is already installed.");
  const travelMs = options.travelMs ?? 3000, now = readSimulationTime(world);
  if (!Number.isFinite(travelMs) || travelMs < 1 || travelMs > 120_000 || !Number.isFinite(now) || now < 0)
    throw new Error("Room traversal requires a finite positive world-time duration of at most 120 seconds.");
  if (getCommittedEvents(world).stopped) throw new Error("Cannot install room routes on a stopped source.");
  const policy: Policy = { generation: Object.freeze({}), sourceId: getCommittedEvents(world).sourceId ?? startCommittedEvents(world),
    installedAt: now, travelMs, stopped: false, edges: new Map(), outgoingRevisions: new Map(), unsubscribe: () => {} };
  policies.set(world, policy);
  policy.unsubscribe = subscribeCommittedSourceStop(world, () => { policy.stopped = true; policy.unsubscribe(); });
  return () => { assertSimulationTaskActive(); if (policies.get(world) !== policy) return;
    policy.stopped = true; policy.unsubscribe(); policies.delete(world); };
}
/** Presence remains explicit after source stop, preventing a legacy fallback. */
export function getRoomRouteTopologyGeneration(world: World): object | undefined { return policies.get(world)?.generation; }
export function isRoomRouteTopologyCurrent(world: World): boolean {
  const policy = policies.get(world); return !!policy && current(world, policy);
}
/** Preflight for bounded authoring before allocating a destination. */
export function assertRoomRouteAuthoringAllowed(world: World): void {
  assertSimulationTaskActive();
  if (!isRoomRouteTopologyCurrent(world)) throw new Error("Room route edits require a current opted-in source.");
}
const edgeKey = (world: World, from: number, to: number) => `${key(world, from)}>${key(world, to)}`;
function changeRoute(world: World, from: number, to: number, open: boolean, bidirectional: boolean): void {
  assertRoomRouteAuthoringAllowed(world); const policy = policies.get(world)!;
  if (!room(world, from) || !room(world, to) || from === to) throw new Error("A room route connects two distinct existing named rooms.");
  workingMemoryEntityRef(world, from); workingMemoryEntityRef(world, to);
  for (const [a, b] of [[from, to], ...(bidirectional ? [[to, from]] : [])]) {
    const present = getRelationTargets(world, a, AdjacentTo).includes(b);
    if (present === open) continue;
    const edge = edgeKey(world, a, b); policy.edges.set(edge, (policy.edges.get(edge) ?? 0) + 1);
    const fromKey = key(world, a)!;
    policy.outgoingRevisions.set(fromKey, (policy.outgoingRevisions.get(fromKey) ?? 0) + 1);
    if (open) addComponent(world, a, AdjacentTo(b)); else removeComponent(world, a, AdjacentTo(b));
  }
}
export function connectRoomRoute(world: World, from: number, to: number, options: { bidirectional?: boolean } = {}): void {
  changeRoute(world, from, to, true, options.bidirectional ?? true);
}
/** Closing/removing a route revokes in-flight crossings even if reopened before
 * arrival through these helpers. Raw ECS edge edits are checked at completion;
 * an unobserved raw remove/re-add has no historical revision to distinguish. */
export function disconnectRoomRoute(world: World, from: number, to: number, options: { bidirectional?: boolean } = {}): void {
  changeRoute(world, from, to, false, options.bidirectional ?? true);
}
function directRoomRouteTargets(world: World, from: number): number[] {
  if (!room(world, from)) return [];
  return getRelationTargets(world, from, AdjacentTo).filter(to => to !== from && room(world, to)).sort((a, b) => a - b);
}

export type RoomRouteObservation = {
  status: "available" | "not_installed" | "stale_source" | "invalid_room";
  travelMs?: number;
  targets: { eid: number; name: string }[];
  omittedTargets: number;
};
/** Bounded author-side facts from the same directed edges used by locomotion.
 * This is a snapshot, not authority to traverse or an all-world reachability
 * claim. Unavailable native policy says nothing about legacy/package transport.
 * NPCs still receive only getRoomRouteTargets for their own current room. */
export function observeRoomRouteExits(world: World, from: number, limit = 16): RoomRouteObservation {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64) throw new Error("Route observation limit must be 1..64");
  const policy = policies.get(world);
  if (!policy) return { status: "not_installed", targets: [], omittedTargets: 0 };
  if (!current(world, policy)) return { status: "stale_source", targets: [], omittedTargets: 0 };
  if (!room(world, from)) return { status: "invalid_room", targets: [], omittedTargets: 0 };
  const targets = directRoomRouteTargets(world, from);
  return { status: "available", travelMs: policy.travelMs,
    targets: targets.slice(0, limit).map(eid => ({ eid, name: Name.value[eid] })),
    omittedTargets: Math.max(0, targets.length - limit) };
}

/** Trusted native construction may extend an observed exit set only with the
 * exact newly allocated room it is assembling. Never accept model-supplied
 * exceptions. These are ephemeral checks, not persisted route authority. */
export type RoomRouteEvidenceAddition = Readonly<{ from: number; to: number; key: string }>;
export function captureRoomRouteEvidence(world: World, fromEids: readonly number[], limit = 16) {
  const policy = policies.get(world), sourceId = getCommittedEvents(world).sourceId;
  const at = readSimulationTime(world), signal = getSimulationTaskSignal();
  const existingRooms = new Set(query(world, [Room]));
  const liveRoom = (eid: number) => room(world, eid) && !hasComponent(world, eid, Removed);
  const identity = (eid: number) => liveRoom(eid) ? workingMemoryEntityRef(world, eid) : undefined;
  const rows = new Map([...new Set(fromEids)].map(eid => {
    const observation = observeRoomRouteExits(world, eid, limit), ref = identity(eid);
    const targets = observation.status === "available" ? directRoomRouteTargets(world, eid).map(target => ({ eid: target, ref: identity(target) })) : [];
    return [eid, { observation, ref, targets, revision: ref ? policy?.outgoingRevisions.get(ref.key) ?? 0 : 0 }] as const;
  }));
  const sameRoom = (eid: number, ref: ReturnType<typeof identity>) => !!ref && liveRoom(eid)
    && key(world, eid) === ref.key && Name.value[eid] === ref.label;
  return {
    // Separate copies keep consumers from rewriting the captured evidence.
    observations: new Map([...rows].map(([eid, row]) => [eid, structuredClone(row.observation)])),
    bind(eids: readonly number[]) {
      const selected = [...new Set(eids)];
      if (selected.some(eid => !rows.has(eid))) throw new Error("Route evidence must reference observed rooms");
      return (additions: readonly RoomRouteEvidenceAddition[] = []): boolean => {
        const source = getCommittedEvents(world), now = readSimulationTime(world);
        if (!sourceId || signal?.aborted || source.stopped || source.sourceId !== sourceId || !Number.isFinite(at) || !Number.isFinite(now) || now < at
          || policies.get(world) !== policy || policy && !current(world, policy)) return false;
        // Only the constructor's own new-room links may differ from the input.
        if (additions.some(a => !selected.includes(a.from) || existingRooms.has(a.to) || !liveRoom(a.to) || key(world, a.to) !== a.key || a.from === a.to)
          || new Set(additions.map(a => `${a.from}>${a.to}`)).size !== additions.length) return false;
        return selected.every(eid => {
          const row = rows.get(eid)!;
          if (!sameRoom(eid, row.ref)) return false;
          if (row.observation.status !== "available") return !policy && row.observation.status === "not_installed";
          const allowed = additions.filter(a => a.from === eid && getRelationTargets(world, eid, AdjacentTo).includes(a.to));
          const targets = directRoomRouteTargets(world, eid).filter(target => !allowed.some(a => a.to === target));
          return (policy!.outgoingRevisions.get(row.ref!.key) ?? 0) === row.revision + allowed.length
            && allowed.every(a => policy!.edges.get(edgeKey(world, eid, a.to)) === 1)
            && targets.length === row.targets.length && row.targets.every((target, i) => target.eid === targets[i] && sameRoom(target.eid, target.ref));
        });
      };
    },
  };
}

/** Pure local map labels, never an all-room list or remote contents lookup. */
export function getRoomRouteTargets(world: World, actor: number): number[] {
  const policy = policies.get(world);
  if (!policy || !current(world, policy) || !entityExists(world, actor) || !hasComponent(world, actor, Agent) || !Agent.active[actor]) return [];
  const from = getRoomForEntity(world, actor); if (from === undefined || !room(world, from)) return [];
  return directRoomRouteTargets(world, from);
}
/** Ambiguous or fuzzy labels never select another room behind the route menu. */
export function resolveRoomRouteTarget(world: World, actor: number, label: string): number | undefined {
  if (typeof label !== "string" || !label.trim()) return;
  const wanted = label.trim().toLowerCase(), from = getRoomForEntity(world, actor);
  const matches = [...new Set([...(from === undefined ? [] : [from]), ...getRoomRouteTargets(world, actor)])]
    .filter(to => room(world, to) && Name.value[to].trim().toLowerCase() === wanted);
  return matches.length === 1 ? matches[0] : undefined;
}
export type RoomTraversal = Readonly<{ from: number; to: number; travelMs: number }>;
type Binding = { world: World; actor: number; owner: string; fromKey: string; toKey: string; targetLabel: string;
  policy: Policy; edgeRevision: number; startedAt: number; signal?: AbortSignal };
const traversals = new WeakMap<RoomTraversal, Binding>();
/** The opaque admission joins the offered edge to its later physical receipt. */
export function captureRoomTraversal(world: World, actor: number, label: string): RoomTraversal | undefined {
  assertSimulationTaskActive(); const policy = policies.get(world);
  if (!policy || !current(world, policy) || !entityExists(world, actor) || !hasComponent(world, actor, Agent) || !Agent.active[actor]) return;
  const from = getRoomForEntity(world, actor), to = resolveRoomRouteTarget(world, actor, label);
  if (from === undefined || to === undefined || !room(world, from) || from !== to && !getRoomRouteTargets(world, actor).includes(to)) return;
  const owner = workingMemoryEntityRef(world, actor)?.key, fromKey = workingMemoryEntityRef(world, from)?.key, toKey = workingMemoryEntityRef(world, to)?.key;
  if (!owner || !fromKey || !toKey) return;
  const receipt = Object.freeze({ from, to, travelMs: from === to ? 0 : policy.travelMs });
  traversals.set(receipt, { world, actor, owner, fromKey, toKey, targetLabel: Name.value[to], policy,
    edgeRevision: policy.edges.get(edgeKey(world, from, to)) ?? 0, startedAt: readSimulationTime(world), signal: getSimulationTaskSignal() });
  return receipt;
}
export function isRoomTraversalCurrent(world: World, actor: number, receipt: RoomTraversal): boolean {
  assertSimulationTaskActive(); const binding = traversals.get(receipt);
  if (!binding || binding.signal?.aborted || binding.world !== world || binding.actor !== actor || !current(world, binding.policy)
    || readSimulationTime(world) < binding.startedAt || !entityExists(world, actor) || !hasComponent(world, actor, Agent)
    || !Agent.active[actor] || key(world, actor) !== binding.owner || getRoomForEntity(world, actor) !== receipt.from
    || !room(world, receipt.from) || !room(world, receipt.to) || key(world, receipt.from) !== binding.fromKey
    || key(world, receipt.to) !== binding.toKey || Name.value[receipt.to] !== binding.targetLabel) return false;
  return receipt.from === receipt.to || getRoomRouteTargets(world, actor).includes(receipt.to)
    && (binding.policy.edges.get(edgeKey(world, receipt.from, receipt.to)) ?? 0) === binding.edgeRevision;
}
