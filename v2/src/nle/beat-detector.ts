/** Advisory beat candidates, never proof that a narrative condition occurred.
 * Only this world's committed public executor receipts are inspected. A word
 * match cannot verify free-form triggerCondition prose, so it cannot trigger a
 * beat, resolve a tension, advance an act, or fire an occurrence callback.
 * A verified-predicate engine is deliberately outside this compatibility layer. */
import { entityExists, hasComponent } from "bitecs";
import { Agent, Name, Room, WorkingMemoryIdentity } from "../ecs/components";
import { getRoomForEntity } from "../ecs/location";
import { readSimulationTime } from "../ecs/simulation-time";
import type { World } from "../ecs/world";
import type { ChronicleEntry } from "../cognition/simulation-chronicle";
import { assertSimulationTaskActive } from "../runtime/task-scope";
import { getCommittedEvents, subscribeCommittedEvents, subscribeCommittedSourceStop,
  type PublicCommittedEvent } from "../runtime/committed-events";
import { getStoryScaffold, type DramaticBeat, type NarrativeTension } from "./story-scaffold";

/** Legacy occurrence callback signature. No free-form prose matcher is allowed
 * to invoke it; keep registrations source-compatible until verified predicates
 * have an explicit, separately authorized occurrence boundary. */
export type BeatCallback = (tension: NarrativeTension, beat: DramaticBeat, triggerEvent: ChronicleEntry) => void;
export function onBeatTriggered(_callback: BeatCallback): void { /* Intentionally not registered or fired. */ }

export type BeatCandidate = Readonly<{
  kind: "keyword_candidate"; sourceId: string; atSimMs: number;
  tensionId: string; beatId: string; matchedKeywords: readonly string[];
  evidence: PublicCommittedEvent;
}>;
type Detection = { world: World; sourceId: string; candidates: BeatCandidate[]; seen: Set<string>;
  unsubscribe: () => void; unsubscribeStop: () => void };
const detections = new WeakMap<World, Detection>();
// Stop-all retains only weak references. Source stop also removes subscriptions.
const active = new Set<WeakRef<Detection>>();
const MAX_CANDIDATES = 64, MAX_SEEN = 256;

function release(state: Detection): void {
  state.unsubscribe(); state.unsubscribeStop();
  if (detections.get(state.world) === state) detections.delete(state.world);
  for (const ref of active) if (!ref.deref() || ref.deref() === state) active.delete(ref);
}

/** Subscribe to this source's future public receipts. A stopped source is not
 * restarted, and earlier receipts are not replayed as fresh cues. */
export function startBeatDetection(world: World): void {
  assertSimulationTaskActive();
  stopBeatDetection(world);
  if (getCommittedEvents(world).stopped) return;
  for (const ref of active) if (!ref.deref()) active.delete(ref);
  const state: Detection = { world, sourceId: "", candidates: [], seen: new Set(), unsubscribe: () => {}, unsubscribeStop: () => {} };
  state.unsubscribe = subscribeCommittedEvents(world, event => inspect(state, event));
  state.sourceId = getCommittedEvents(world).sourceId!;
  state.unsubscribeStop = subscribeCommittedSourceStop(world, () => release(state));
  detections.set(world, state); active.add(new WeakRef(state));
}

/** Native callers stop one World. Omission is the explicit legacy stop-all
 * operation for tools/tests, not a simulation's ordinary shutdown. */
export function stopBeatDetection(world?: World): void {
  assertSimulationTaskActive();
  if (world) { const state = detections.get(world); if (state) release(state); return; }
  for (const ref of [...active]) { const state = ref.deref(); if (state) release(state); else active.delete(ref); }
}

/** Operator/debug telemetry only: historical lexical matches do not establish
 * current beat status, NPC knowledge, or a completed narrative occurrence. */
export function getBeatCandidates(world: World): readonly BeatCandidate[] {
  const state = detections.get(world), source = getCommittedEvents(world), now = readSimulationTime(world);
  return Object.freeze(state && !source.stopped && source.sourceId === state.sourceId && Number.isFinite(now) && now >= 0
    ? state.candidates.filter(candidate => candidate.atSimMs <= now) : []);
}

function receiptCurrent(state: Detection, event: PublicCommittedEvent): boolean {
  const world = state.world, source = getCommittedEvents(world), now = readSimulationTime(world);
  return detections.get(world) === state && !source.stopped && source.sourceId === state.sourceId && event.sourceId === state.sourceId
    && source.events.some(actual => actual === event) && Number.isFinite(now) && now >= 0
    && Number.isFinite(event.atSimMs) && event.atSimMs >= 0 && event.atSimMs <= now
    && event.status === "succeeded" && entityExists(world, event.actorId) && hasComponent(world, event.actorId, Agent)
    && hasComponent(world, event.actorId, WorkingMemoryIdentity) && WorkingMemoryIdentity.id[event.actorId] === event.actorKey
    && entityExists(world, event.roomId) && hasComponent(world, event.roomId, Room)
    && hasComponent(world, event.roomId, WorkingMemoryIdentity) && WorkingMemoryIdentity.id[event.roomId] === event.roomKey
    && getRoomForEntity(world, event.actorId) === event.roomId
    && (event.targetId === undefined || entityExists(world, event.targetId)
      && hasComponent(world, event.targetId, WorkingMemoryIdentity) && WorkingMemoryIdentity.id[event.targetId] === event.targetKey);
}
const words = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const STOP_WORDS = new Set(["the", "and", "that", "with", "from", "this", "have", "will", "been", "they", "their", "when", "what", "about", "into", "over", "after", "before"]);
function inspect(state: Detection, event: PublicCommittedEvent): void {
  assertSimulationTaskActive();
  if (!receiptCurrent(state, event)) return;
  const scaffold = getStoryScaffold(state.world); if (!scaffold) return;
  const label = (eid: number | undefined) => eid !== undefined && hasComponent(state.world, eid, Name) ? Name.value[eid] || "" : "";
  const actor = label(event.actorId), target = label(event.targetId), room = label(event.roomId);
  const heard = new Set(words([actor, target, room, event.action, event.operation || "", event.text || ""].join(" ")));
  for (const tension of scaffold.tensions) {
    if (tension.status !== "active") continue;
    const beat = tension.beats.find(row => row.status === "pending");
    // Reconciled proposals have their own evidence-bearing advisory lifecycle.
    if (!beat || beat.reconciliation || typeof beat.triggerCondition !== "string") continue;
    const keywords = [...new Set(words(beat.triggerCondition).filter(word => word.length > 3 && !STOP_WORDS.has(word)))];
    if (!keywords.length) continue;
    const matched = keywords.filter(word => heard.has(word));
    const names = tension.involvedNpcs.map(name => name.trim().toLowerCase());
    const involved = names.includes(actor.toLowerCase()) || !!target && names.includes(target.toLowerCase());
    if (matched.length / keywords.length < (involved ? 0.5 : 0.7)) continue;
    const key = JSON.stringify([tension.id, beat.id, event.executionId]);
    if (state.seen.has(key)) continue;
    state.seen.add(key);
    if (state.seen.size > MAX_SEEN) state.seen.delete(state.seen.values().next().value!);
    state.candidates.push(Object.freeze({ kind: "keyword_candidate", sourceId: state.sourceId, atSimMs: event.atSimMs,
      tensionId: tension.id, beatId: beat.id, matchedKeywords: Object.freeze(matched), evidence: event }));
    if (state.candidates.length > MAX_CANDIDATES) state.candidates.shift();
    return; // One advisory match per public receipt; never scaffold mutation.
  }
}
