/** Progressive physical speech. A voice is independent of the body; only
 * words emitted at an exact timeline boundary can be heard. */
import { entityExists, hasComponent, query } from "bitecs";
import type { World } from "../ecs/world";
import { Agent, Name, Position, WorkingMemoryIdentity } from "../ecs/components";
import { getRoomForEntity } from "../ecs/location";
import { readSimulationTime } from "../ecs/simulation-time";
import { getAgentSensoryCapabilities } from "./sensory-capabilities";
import { workingMemoryEntityRef } from "./working-memory";
import { getCommittedEvents } from "../runtime/committed-events";
import { getAgentWorldCapabilityGeneration } from "./world-capabilities";
import { reserveSimulationResources, releaseSimulationResources, scheduleSimulationEvent } from "../runtime/simulation-timeline";

export interface SpeechInterval {
  executionId: string; startedAtSimMs: number; expectedEndSimMs: number; completedAtSimMs: number;
}
export interface SpeechFragment {
  executionId: string; content: string; tokenIndex: number; totalTokens: number;
  startedAtSimMs: number; heardAtSimMs: number; roomId: number; audience: ReadonlySet<number>;
}
export interface TimedSpeechResult {
  success: boolean; audience: ReadonlySet<number>; interval: SpeechInterval;
  /** Only the prefix actually emitted, even on interruption. No unsaid script. */
  spokenText: string; emittedTokens: number; reason?: string;
}
type Result = TimedSpeechResult;
type Word = { text: string; offsetMs: number };
type Utterance = {
  actorKey: string; room: number; roomKey: string; generation: object | undefined;
  executionId: string; start: number; end: number; words: Word[]; emitted: number;
  heard: Map<number, { key: string; count: number }>; cancelEvents: Array<() => void>;
  fragment?(fragment: SpeechFragment): void; finish(result: Result): void; abandon(): void;
};
const voices = new WeakMap<World, Map<number, Utterance>>();
const clearingVoices = new WeakSet<World>();
const speechEpochs = new WeakMap<World, number>();
type TurnEnd = { roomKey: string; actorId: number; actorKey: string; atSimMs: number };
const recentTurns = new WeakMap<World, Map<number, TurnEnd>>();

/** Voices carry a speaking distance in worlds that set one (spatial towns): a
 * conversation across a large square is not heard by everyone on it, and people
 * out of earshot of each other do not share a conversational floor. Worlds
 * without positions or without a configured distance keep room-wide hearing. */
export function withinEarshot(world: World, a: number, b: number): boolean {
  const limit = world.meta.speechEarshotMetres;
  if (!limit || a === b || !hasComponent(world, a, Position) || !hasComponent(world, b, Position)) return true;
  const dx = Position.x[a] - Position.x[b], dy = Position.y[a] - Position.y[b];
  return !Number.isFinite(dx) || !Number.isFinite(dy) || dx * dx + dy * dy <= limit * limit;
}
// A place in conversation, never permission to utter saved words. Runtime-only:
// restore/source replacement cannot inherit a reservation. Revisions retain FIFO
// order, but a stalled author can hold an otherwise free floor for only 3 seconds.
type TurnRequest = { actorKey: string; room: number; roomKey: string; source: string | null;
  generation: object | undefined; target?: string; since: number; holdUntil: number;
  current: () => boolean };
const turnRequests = new WeakMap<World, Map<number, TurnRequest>>();
function turnCurrent(world: World, eid: number, row: TurnRequest): boolean {
  const now = readSimulationTime(world), tape = getCommittedEvents(world);
  return !tape.stopped && tape.sourceId === row.source && actorCurrent(world, eid, row.actorKey)
    && getAgentWorldCapabilityGeneration(world, eid) === row.generation
    && getRoomForEntity(world, eid) === row.room && entityExists(world, row.room)
    && WorkingMemoryIdentity.id[row.room] === row.roomKey && now >= row.since && now - row.since <= 30_000 && now < row.holdUntil
    && row.current();
}
export function requestConversationTurn(world: World, eid: number, target: string | undefined, current: () => boolean): void {
  const room = getRoomForEntity(world, eid), tape = getCommittedEvents(world);
  if (room === undefined || tape.stopped || !entityExists(world, eid) || !hasComponent(world, eid, Agent) || !Agent.active[eid]) return;
  const actorKey = workingMemoryEntityRef(world, eid)?.key, roomKey = workingMemoryEntityRef(world, room)?.key;
  if (!actorKey || !roomKey) return;
  let rows = turnRequests.get(world); if (!rows) { rows = new Map(); turnRequests.set(world, rows); }
  for (const [actor, row] of rows) if (!turnCurrent(world, actor, row)) rows.delete(actor);
  const old = rows.get(eid), now = readSimulationTime(world);
  const retain = old && turnCurrent(world, eid, old) && old.target === target;
  const floorEnd = Math.max(now, ...[...voices.get(world)?.entries() ?? []]
    .filter(([actor, row]) => voiceCurrent(world, actor, row) && getRoomForEntity(world, actor) === room && withinEarshot(world, eid, actor))
    .map(([, row]) => row.end + SPEECH_HANDOFF_GAP_MS));
  rows.set(eid, { actorKey, room, roomKey, source: tape.sourceId, generation: getAgentWorldCapabilityGeneration(world, eid),
    target, since: retain ? old.since : now, holdUntil: floorEnd + 3000, current });
}
export function reviseConversationTurn(world: World, eid: number): void {
  // Retain the existing bounded lease; revisions cannot renew it indefinitely.
  const row = turnRequests.get(world)?.get(eid);
  if (row && !turnCurrent(world, eid, row)) releaseConversationTurn(world, eid);
}
export function releaseConversationTurn(world: World, eid: number): void { turnRequests.get(world)?.delete(eid); }
export const SPEECH_HANDOFF_GAP_MS = 250;
export const SPEECH_REPEAT_GAP_MS = 1750;
export type SpeechFloorMode = "conversational" | "urgent";
export interface LocalSpeechOpportunity {
  readonly available: boolean;
  readonly reason: "available" | "inactive" | "no_location" | "voice_busy" | "another_speaker" | "handoff_gap" | "recent_turn" | "queued_turn";
  readonly atSimMs: number;
  readonly nextCheckAtSimMs?: number;
  readonly speakerIds: readonly number[];
}

/** A read-only local opportunity, not a ticket or a queue of future dialogue.
 * Cognition may use this to listen or choose a body action. Admission checks it
 * again so two simultaneously generated proposals cannot both take the floor. */
export function readLocalSpeechOpportunity(world: World, eid: number,
  options: { mode?: SpeechFloorMode } = {}): LocalSpeechOpportunity {
  const now = readSimulationTime(world);
  const result = (reason: LocalSpeechOpportunity["reason"], speakerIds: number[] = [], nextCheckAtSimMs?: number): LocalSpeechOpportunity =>
    Object.freeze({ available: reason === "available", reason, atSimMs: now, speakerIds: Object.freeze(speakerIds),
      ...(nextCheckAtSimMs === undefined ? {} : { nextCheckAtSimMs }) });
  if (!entityExists(world, eid) || !hasComponent(world, eid, Agent) || !Agent.active[eid]) return result("inactive");
  const room = getRoomForEntity(world, eid);
  if (room === undefined) return result("no_location");
  const own = voices.get(world)?.get(eid);
  if (own && voiceCurrent(world, eid, own)) return result("voice_busy", [], own.end);
  if (options.mode === "urgent") return result("available");
  const canHear = getAgentSensoryCapabilities(world, eid).auditory > 0;
  const roomKey = hasComponent(world, room, WorkingMemoryIdentity) ? WorkingMemoryIdentity.id[room] : undefined;
  const speakers = canHear ? [...voices.get(world)?.entries() ?? []].filter(([speaker, row]) => speaker !== eid
    && voiceCurrent(world, speaker, row) && getRoomForEntity(world, speaker) === room && withinEarshot(world, eid, speaker)
    && (row.room !== room || row.roomKey === roomKey)) : [];
  if (speakers.length) return result("another_speaker", speakers.map(([speaker]) => speaker).sort((a, b) => a - b),
    Math.min(...speakers.map(([, row]) => row.end)) + SPEECH_HANDOFF_GAP_MS);
  const recent = recentTurns.get(world)?.get(room);
  if (canHear) {
    const next = [...turnRequests.get(world)?.entries() ?? []]
      .filter(([actor, row]) => row.room === room && withinEarshot(world, eid, actor) && turnCurrent(world, actor, row))
      .sort((a, b) => a[1].since - b[1].since)[0];
    if (next && next[0] !== eid) return result("queued_turn", [], now + 250);
  }
  if (!canHear || !recent || recent.roomKey !== roomKey || now < recent.atSimMs
    || entityExists(world, recent.actorId) && !withinEarshot(world, eid, recent.actorId)) return result("available");
  const otherListeners = [...query(world, [Agent])].some(other => other !== eid && Agent.active[other]
    && getRoomForEntity(world, other) === room && withinEarshot(world, eid, other) && getAgentSensoryCapabilities(world, other).auditory > 0);
  const ownLastTurn = recent.actorId === eid && hasComponent(world, eid, WorkingMemoryIdentity)
    && WorkingMemoryIdentity.id[eid] === recent.actorKey;
  const next = recent.atSimMs + (ownLastTurn && otherListeners ? SPEECH_REPEAT_GAP_MS : SPEECH_HANDOFF_GAP_MS);
  return now < next ? result(ownLastTurn && otherListeners ? "recent_turn" : "handoff_gap", [], next) : result("available");
}

/** Authored 150 words/minute plus onset and punctuation pauses. Each token's
 * deadline is the end of that spoken slice; script suffixes are never exposed. */
function speechWords(content: string): Word[] {
  const matches = [...content.matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)];
  let elapsed = 300, previous = 0;
  const words = matches.map((_match, index) => {
    const end = matches[index + 1]?.index ?? content.length;
    const text = content.slice(previous, end); previous = end;
    elapsed += 400 + (text.match(/[,.!?;:。！？、]/gu)?.length ?? 0) * 120;
    return { text, offsetMs: elapsed };
  });
  if (words.length) words[words.length - 1].offsetMs = Math.max(800, words[words.length - 1].offsetMs);
  return words;
}
export function estimateSpeechDurationMs(content: string): number { return speechWords(content).at(-1)?.offsetMs ?? 0; }
function actorCurrent(world: World, eid: number, key: string) {
  return entityExists(world, eid) && hasComponent(world, eid, Agent) && Agent.active[eid]
    && hasComponent(world, eid, WorkingMemoryIdentity) && WorkingMemoryIdentity.id[eid] === key;
}
function voiceCurrent(world: World, eid: number, row: Utterance): boolean {
  return actorCurrent(world, eid, row.actorKey) && getAgentWorldCapabilityGeneration(world, eid) === row.generation;
}
export function isSpeaking(world: World, eid: number): boolean {
  const row = voices.get(world)?.get(eid); return Boolean(row && voiceCurrent(world, eid, row));
}
/** No future script. Concurrent public body activity is reported separately. */
export function getSpeakingActivity(world: World, eid: number) {
  const row = voices.get(world)?.get(eid);
  return row && voiceCurrent(world, eid, row)
    ? { executionId: row.executionId, startedAtSimMs: row.start, expectedEndSimMs: row.end,
      emittedTokens: row.emitted, spokenText: row.words.slice(0, row.emitted).map(word => word.text).join("") } : undefined;
}
/** Full script of an utterance still being spoken, so a listener within earshot
 * can hear it voiced as it happens. Returns nothing once it has ended or changed. */
export function getUtteranceScript(world: World, eid: number, executionId: string): string | undefined {
  const row = voices.get(world)?.get(eid);
  return row && row.executionId === executionId && voiceCurrent(world, eid, row) ? row.words.map(word => word.text).join("") : undefined;
}
function retire(world: World, eid: number, row: Utterance, result?: Result) {
  const rows = voices.get(world); if (rows?.get(eid) !== row) return;
  rows.delete(eid); releaseSimulationResources(world, eid, row.executionId);
  const events = row.cancelEvents.splice(0); for (const cancel of events) cancel();
  if (row.emitted > 0 && entityExists(world, row.room) && hasComponent(world, row.room, WorkingMemoryIdentity)
    && WorkingMemoryIdentity.id[row.room] === row.roomKey) {
    let turns = recentTurns.get(world); if (!turns) { turns = new Map(); recentTurns.set(world, turns); }
    turns.set(row.room, { roomKey: row.roomKey, actorId: eid, actorKey: row.actorKey, atSimMs: readSimulationTime(world) });
  }
  if (result) row.finish(result); else row.abandon();
}
function failed(world: World, eid: number, row: Utterance, reason = "physical_interruption") {
  retire(world, eid, row, { success: false, audience: new Set(), reason,
    spokenText: row.words.slice(0, row.emitted).map(word => word.text).join(""), emittedTokens: row.emitted, interval: {
    executionId: row.executionId, startedAtSimMs: row.start, expectedEndSimMs: row.end, completedAtSimMs: readSimulationTime(world),
  } });
}
function emitWord(world: World, eid: number, row: Utterance, index: number) {
  if (voices.get(world)?.get(eid) !== row) return;
  if (!voiceCurrent(world, eid, row)) { retire(world, eid, row); return; }
  const now = readSimulationTime(world), room = getRoomForEntity(world, eid);
  // A bypassed scheduler cannot reconstruct historical hearing from current positions.
  if (room === undefined || now > row.start + row.words[index].offsetMs + 0.000001 || now < row.start) { failed(world, eid, row); return; }
  const roomKey = workingMemoryEntityRef(world, room)?.key;
  if (!roomKey || room === row.room && roomKey !== row.roomKey) { failed(world, eid, row); return; }
  row.room = room; row.roomKey = roomKey; // walking speech follows the real speaker
  const audience = new Set<number>();
  for (const listener of query(world, [Agent, Name])) {
    if (listener === eid || !Agent.active[listener] || getRoomForEntity(world, listener) !== room
      || !withinEarshot(world, eid, listener) || getAgentSensoryCapabilities(world, listener).auditory <= 0) continue;
    const key = workingMemoryEntityRef(world, listener)!.key, heard = row.heard.get(listener);
    row.heard.set(listener, { key, count: heard?.key === key ? heard.count + 1 : 1 });
    audience.add(listener);
  }
  row.emitted = index + 1;
  row.fragment?.({ executionId: row.executionId, content: row.words[index].text, tokenIndex: index, totalTokens: row.words.length,
    startedAtSimMs: row.start, heardAtSimMs: now, roomId: room, audience });
  if (voices.get(world)?.get(eid) !== row) return;
  if (index === row.words.length - 1) {
    const fullAudience = new Set([...row.heard].filter(([listener, heard]) => heard.count === row.words.length
      && actorCurrent(world, listener, heard.key)).map(([listener]) => listener));
    retire(world, eid, row, { success: true, audience: fullAudience, interval: {
      executionId: row.executionId, startedAtSimMs: row.start, expectedEndSimMs: row.end, completedAtSimMs: now,
    }, spokenText: row.words.map(word => word.text).join(""), emittedTokens: row.emitted });
  }
}
export function beginTimedSpeech(world: World, eid: number, content: string, executionId: string,
  finish: Utterance["finish"], abandon: () => void,
  options: { fragment?: Utterance["fragment"]; floor?: SpeechFloorMode; maxDurationMs?: number } = {}): boolean {
  const words = speechWords(content);
  if (options.maxDurationMs !== undefined && (!Number.isFinite(options.maxDurationMs) || options.maxDurationMs <= 0))
    throw new RangeError("Speech unit duration must be positive finite simulation milliseconds");
  if (clearingVoices.has(world) || !words.length || options.maxDurationMs !== undefined && words.at(-1)!.offsetMs > options.maxDurationMs
    || !entityExists(world, eid) || !hasComponent(world, eid, Agent)
    || !Agent.active[eid] || isSpeaking(world, eid)) return false;
  const admissionRoom = getRoomForEntity(world, eid);
  if (admissionRoom === undefined) return false;
  const admissionActorKey = workingMemoryEntityRef(world, eid)!.key;
  const admissionRoomKey = workingMemoryEntityRef(world, admissionRoom)!.key;
  const admissionGeneration = getAgentWorldCapabilityGeneration(world, eid), epoch = speechEpochs.get(world) ?? 0;
  let rows = voices.get(world); if (!rows) { rows = new Map(); voices.set(world, rows); }
  const old = rows.get(eid); if (old) retire(world, eid, old);
  // An obsolete generation's cancellation hook may change the world. Re-read
  // the room and voice map instead of enrolling an orphan into the old map.
  const room = getRoomForEntity(world, eid);
  if (clearingVoices.has(world) || (speechEpochs.get(world) ?? 0) !== epoch || room === undefined || room !== admissionRoom
    || !actorCurrent(world, eid, admissionActorKey) || !hasComponent(world, room, WorkingMemoryIdentity)
    || WorkingMemoryIdentity.id[room] !== admissionRoomKey || getAgentWorldCapabilityGeneration(world, eid) !== admissionGeneration
    || isSpeaking(world, eid)) return false;
  if (options.floor && !readLocalSpeechOpportunity(world, eid, { mode: options.floor }).available) return false;
  rows = voices.get(world); if (!rows) { rows = new Map(); voices.set(world, rows); }
  if (!reserveSimulationResources(world, eid, executionId, ["voice"])) return false;
  const start = readSimulationTime(world);
  const row: Utterance = { actorKey: workingMemoryEntityRef(world, eid)!.key, room, roomKey: workingMemoryEntityRef(world, room)!.key,
    generation: getAgentWorldCapabilityGeneration(world, eid), executionId, start, end: start + words.at(-1)!.offsetMs,
    words, emitted: 0, heard: new Map(), cancelEvents: [], fragment: options.fragment, finish, abandon };
  rows.set(eid, row);
  releaseConversationTurn(world, eid);
  // Waiting behind an earlier author's turn must not consume the free-floor
  // authoring grace. Extend only still-live requests when a real voice starts;
  // expired tickets never resurrect, and the total 30-second bound still holds.
  for (const [actor, request] of turnRequests.get(world) ?? []) {
    if (request.room === room && turnCurrent(world, actor, request))
      request.holdUntil = Math.max(request.holdUntil, row.end + SPEECH_HANDOFF_GAP_MS + 3000);
  }
  for (let index = 0; index < words.length; index++) row.cancelEvents.push(scheduleSimulationEvent(world, {
    atSimMs: start + words[index].offsetMs, phase: "speech", run: () => emitWord(world, eid, row, index),
    cancel: () => { if (voices.get(world)?.get(eid) === row) retire(world, eid, row); },
  }));
  return true;
}
/** Deliberately end the current voice, never its body work. A stale cognitive
 * proposal must supply its captured executionId so it cannot stop a newer turn.
 * The result is failure with the exact heard prefix, never complete-turn proof. */
export function interruptTimedSpeech(world: World, eid: number, reason: string,
  options: { executionId?: string } = {}): boolean {
  const row = voices.get(world)?.get(eid);
  if (!row || !voiceCurrent(world, eid, row) || options.executionId !== undefined && options.executionId !== row.executionId) return false;
  failed(world, eid, row, String(reason || "speaker_interrupted").slice(0, 240));
  return true;
}
/** Lifecycle reconciliation only. Use the shared timeline to advance speech. */
export function advanceTimedSpeech(world: World): void {
  for (const [eid, row] of [...voices.get(world)?.entries() ?? []]) {
    if (!voiceCurrent(world, eid, row)) retire(world, eid, row);
    else if (getRoomForEntity(world, eid) === undefined) failed(world, eid, row);
  }
}
export function clearTimedSpeech(world: World): void {
  turnRequests.delete(world);
  const rows = voices.get(world); if (clearingVoices.has(world)) return;
  speechEpochs.set(world, (speechEpochs.get(world) ?? 0) + 1);
  if (!rows) { recentTurns.delete(world); return; }
  clearingVoices.add(world);
  const errors: unknown[] = [];
  try {
    for (const [eid, row] of [...rows]) { try { retire(world, eid, row); } catch (error) { errors.push(error); } }
    if (voices.get(world) === rows) voices.delete(world);
  } finally { recentTurns.delete(world); clearingVoices.delete(world); }
  if (errors.length) throw new AggregateError(errors, "Voice cancellation failed after clearing all pending speech");
}
