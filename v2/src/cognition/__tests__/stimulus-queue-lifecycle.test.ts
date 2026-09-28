import { jest } from "@jest/globals";
import { addComponent, addEntity, hasComponent, removeComponent, removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Agent, Name, WorkingMemoryIdentity } from "../../ecs/components";
import { getCommittedEvents, startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { normalizeSensoryEvent } from "../sensory-capabilities";
import { readHeardSpeechProgress, recordHeardSpeechFragment } from "../social-memory";
import * as mailbox from "../stimulus-queue";

function fixture(padding = 0, actorCount = 2) {
  const world = createArgosWorld("Mailbox lifetime");
  // Process-local ECS component arrays share numeric slots: reserve distinct
  // slots when testing simultaneously live control-plane worlds.
  for (let i = 0; i < padding; i++) addEntity(world);
  initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Hall" });
  const actor = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "Observe", roomId: room });
  const other = createAgentEntity(world, { name: "Bo", role: "resident", systemPrompt: "Observe", roomId: room });
  const actors = [actor, other, ...Array.from({ length: actorCount - 2 }, (_, i) => createAgentEntity(world,
    { name: `Resident ${i}`, role: "resident", systemPrompt: "Observe", roomId: room }))];
  return { world, room, actor, other, actors };
}
const signal = (targetEid: number, content = "A phone buzzes") => ({ targetEid, type: "auditory", content, source: "phone" });
// Keep red evidence runnable against the prior one-argument API.
const enqueue = (...args: any[]): boolean => (mailbox.queueStimulus as any)(...args);
const status = (world?: ReturnType<typeof createArgosWorld>): any => (mailbox as any).getStimulusQueueStatus(world);
const limits = (): any => (mailbox as any).STIMULUS_QUEUE_LIMITS;
beforeEach(() => { mailbox.drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline mailbox regression")); });
afterEach(() => { mailbox.drainPendingStimuli(); expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test("fresh signals require explicit ownership and never cross worlds", () => {
  const a = fixture(), b = fixture(64);
  expect(enqueue(a.world, signal(a.actor))).toBe(true);
  expect(enqueue(b.world, signal(b.actor, "Other world"))).toBe(true);
  expect(mailbox.drainPendingStimuli(new Set([a.actor]), b.world)).toEqual([]);
  expect(mailbox.peekPendingStimuli(a.actor, b.world)).toEqual([]);
  expect(mailbox.drainPendingStimuli(new Set([a.actor]), a.world)).toMatchObject([signal(a.actor)]);
  expect(mailbox.drainPendingStimuli(undefined, b.world).map(row => row.content)).toEqual(["Other world"]);
  expect(enqueue(signal(a.actor))).toBe(false);
  expect(status().reasons.unbound_legacy).toBeGreaterThan(0);
});

test.each(["stop", "restart", "owner", "removed", "component removed"])("%s invalidates ordinary unguarded input before intake", cause => {
  const f = fixture(); expect(enqueue(f.world, signal(f.actor))).toBe(true);
  const [copy] = mailbox.peekPendingStimuli(f.actor, f.world);
  if (cause === "stop" || cause === "restart") stopCommittedEvents(f.world);
  if (cause === "restart") startCommittedEvents(f.world);
  if (cause === "owner") WorkingMemoryIdentity.id[f.actor] = "recycled-owner";
  if (cause === "removed") removeEntity(f.world, f.actor);
  if (cause === "component removed") removeComponent(f.world, f.actor, WorkingMemoryIdentity);
  expect(enqueue(f.world, copy)).toBe(false);
  expect(mailbox.peekPendingStimuli(f.actor, f.world)).toEqual([]);
  expect(mailbox.drainPendingStimuli(undefined, f.world)).toEqual([]);
  expect(status(f.world).dropped).toBeGreaterThan(0);
});

test("stopped sources reject new input without implicitly restarting; explicit restart admits only fresh input", () => {
  const f = fixture(); startCommittedEvents(f.world); stopCommittedEvents(f.world);
  const oldSource = getCommittedEvents(f.world).sourceId;
  expect(enqueue(f.world, signal(f.actor))).toBe(false);
  expect(getCommittedEvents(f.world)).toMatchObject({ sourceId: oldSource, stopped: true });
  startCommittedEvents(f.world); expect(enqueue(f.world, signal(f.actor, "New phone buzz"))).toBe(true);
  expect(mailbox.drainPendingStimuli(undefined, f.world).map(row => row.content)).toEqual(["New phone buzz"]);
});

test("read-only probes never mint identity or a source", () => {
  const f = fixture(); removeComponent(f.world, f.actor, WorkingMemoryIdentity);
  expect(getCommittedEvents(f.world).sourceId).toBeNull();
  mailbox.peekPendingStimuli(f.actor, f.world); mailbox.drainPendingStimuli(undefined, f.world); status(f.world);
  expect(hasComponent(f.world, f.actor, WorkingMemoryIdentity)).toBe(false);
  expect(getCommittedEvents(f.world).sourceId).toBeNull();
});

test("normalization and legacy requeue preserve advisory guards, target identity and emission time", () => {
  const f = fixture(); let current = true;
  expect(mailbox.queueGuardedStimulus(f.world, { ...signal(f.actor), timestamp: 123 }, () => current)).toBe(true);
  const [row] = mailbox.drainPendingStimuli(undefined, f.world);
  expect(enqueue(normalizeSensoryEvent(row))).toBe(true);
  const [copy] = mailbox.peekPendingStimuli(f.actor, f.world);
  expect(copy.timestamp).toBe(123); copy.targetEid = f.other;
  expect(enqueue(f.world, copy)).toBe(false);
  current = false;
  expect(enqueue(f.world, normalizeSensoryEvent(row))).toBe(false);
  expect(mailbox.drainPendingStimuli(undefined, f.world)).toEqual([]);
});

test("a different explicit world cannot launder a bound signal", () => {
  const f = fixture(), other = fixture(64); enqueue(f.world, signal(f.actor));
  const [row] = mailbox.drainPendingStimuli(undefined, f.world);
  expect(enqueue(other.world, row)).toBe(false);
  expect(mailbox.drainPendingStimuli()).toEqual([]);
});

test("actor overflow rejects newest input explicitly, preserves FIFO and leaves other actors usable", () => {
  const f = fixture(), cap = limits().perActor;
  for (let i = 0; i < cap; i++) expect(enqueue(f.world, signal(f.actor, `signal ${i}`))).toBe(true);
  expect(enqueue(f.world, signal(f.actor, "OVERFLOW"))).toBe(false);
  expect(status(f.world)).toMatchObject({ pending: cap, rejected: 1, reasons: { actor_limit: 1 } });
  expect(enqueue(f.world, signal(f.other, "other actor"))).toBe(true);
  expect(mailbox.drainPendingStimuli(new Set([f.actor]), f.world).map(row => row.content))
    .toEqual(Array.from({ length: cap }, (_, i) => `signal ${i}`));
  expect(mailbox.drainPendingStimuli(undefined, f.world).map(row => row.content)).toEqual(["other actor"]);
  expect(status(f.world).pending).toBe(0);
});

test("byte bounds reject without trimming exact text; stop releases pending capacity immediately", () => {
  const f = fixture(), tooLarge = "é".repeat(limits().contentBytes);
  expect(enqueue(f.world, signal(f.actor, tooLarge))).toBe(false);
  expect(status(f.world)).toMatchObject({ pending: 0, reasons: { content_limit: 1 } });
  expect(JSON.stringify(status(f.world))).not.toContain(tooLarge);
  enqueue(f.world, signal(f.actor)); stopCommittedEvents(f.world);
  expect(status(f.world)).toMatchObject({ pending: 0, discarded: 1, reasons: { source_stopped: 1 } });
});

test("invalid and non-agent targets reject instead of accumulating unaddressable input", () => {
  const f = fixture(); removeComponent(f.world, f.actor, Agent);
  expect(enqueue(f.world, signal(f.actor))).toBe(false);
  expect(enqueue(f.world, signal(9999999))).toBe(false);
  expect(status(f.world)).toMatchObject({ pending: 0, rejected: 2, reasons: { invalid_target: 2 } });
});

test("a recycled numeric EID cannot inherit input from the removed actor", () => {
  const world = createArgosWorld("Recycled mailbox actor"), actor = addEntity(world);
  addComponent(world, actor, Agent); addComponent(world, actor, Name); Agent.active[actor] = true; Name.value[actor] = "Old actor";
  expect(enqueue(world, signal(actor, "OLD PRIVATE INPUT"))).toBe(true);
  const [old] = mailbox.peekPendingStimuli(actor, world), identity = WorkingMemoryIdentity.id[actor];
  removeEntity(world, actor); const replacement = addEntity(world); expect(replacement).toBe(actor);
  addComponent(world, replacement, Agent); addComponent(world, replacement, Name); Agent.active[replacement] = true; Name.value[replacement] = "New actor";
  expect(enqueue(world, old)).toBe(false);
  expect(enqueue(world, signal(replacement, "New input"))).toBe(true);
  expect(WorkingMemoryIdentity.id[replacement]).not.toBe(identity);
  expect(mailbox.drainPendingStimuli(undefined, world).map(row => row.content)).toEqual(["New input"]);
});

test("exact hearing receipt survives normalization and requeue, while altered or stale evidence rejects", () => {
  const f = fixture(); startCommittedEvents(f.world);
  const [heard] = recordHeardSpeechFragment(f.world, f.actor, { executionId: "actual-speech", content: "Hello.", tokenIndex: 0, totalTokens: 1,
    startedAtSimMs: 0, heardAtSimMs: 0, roomId: f.room, audience: new Set([f.other]) });
  const input = { targetEid: heard.eid, type: "speech_fragment", source: "Ada", content: heard.content, hearing: heard.hearing, timestamp: 123 };
  expect(enqueue(f.world, input)).toBe(true);
  const [row] = mailbox.drainPendingStimuli(undefined, f.world);
  expect(row.hearing).toBe(heard.hearing); expect(readHeardSpeechProgress(f.world, f.other, row)).toBe(heard.hearing);
  expect(enqueue(normalizeSensoryEvent(row))).toBe(true);
  const [again] = mailbox.drainPendingStimuli(undefined, f.world); expect(again.timestamp).toBe(123); expect(again.hearing).toBe(heard.hearing);
  expect(enqueue(f.world, { ...again, content: "Unheard extra words" })).toBe(false);
  stopCommittedEvents(f.world); startCommittedEvents(f.world);
  expect(enqueue(f.world, again)).toBe(false); expect(mailbox.drainPendingStimuli(undefined, f.world)).toEqual([]);
});

test("untrusted receipt metadata cannot bypass byte bounds or become hearing authority", () => {
  const f = fixture(), input = { ...signal(f.actor), hearing: { executionId: "forged", boundary: "end", hidden: "x".repeat(100000) } };
  expect(enqueue(f.world, input)).toBe(true);
  const [row] = mailbox.drainPendingStimuli(undefined, f.world);
  expect(row.hearing).toBeUndefined(); expect(JSON.stringify(row)).not.toContain("hidden");
  expect(enqueue(f.world, { ...signal(f.actor), modality: "x".repeat(100000) })).toBe(false);
});

test("32 actor mailboxes stay inside world/global count budgets and release capacity on stop", () => {
  const worlds = Array.from({ length: 5 }, (_, i) => fixture(i * 64, 9));
  const actors = worlds.map(f => f.actors.slice(0, 8));
  for (let w = 0; w < 4; w++) for (const actor of actors[w]) for (let i = 0; i < limits().perActor; i++)
    expect(enqueue(worlds[w].world, signal(actor, `${i}`))).toBe(true);
  expect(status().pending).toBe(limits().global);
  const overflowActor = worlds[0].actors[8];
  expect(enqueue(worlds[0].world, signal(overflowActor))).toBe(false); expect(status(worlds[0].world).reasons.world_limit).toBe(1);
  expect(enqueue(worlds[4].world, signal(worlds[4].actor))).toBe(false); expect(status(worlds[4].world).reasons.global_limit).toBe(1);
  stopCommittedEvents(worlds[0].world);
  expect(status().pending).toBe(limits().global - limits().perWorld);
  expect(enqueue(worlds[4].world, signal(worlds[4].actor))).toBe(true);
});

test("global byte pressure rejects visibly even below count limits", () => {
  const worlds = Array.from({ length: 9 }, (_, i) => fixture(i * 64));
  const content = "x".repeat(limits().contentBytes);
  for (const f of worlds) while (enqueue(f.world, signal(f.actor, content))) { /* fill to the first declared cap */ }
  expect(status().pendingBytes).toBeLessThanOrEqual(limits().globalBytes);
  expect(status(worlds[8].world).reasons.global_bytes).toBe(1);
  expect(status().pending).toBeLessThan(limits().global);
});

test("world byte budget and bounded rejection history prevent payload-driven memory growth", () => {
  const f = fixture(), content = "x".repeat(limits().contentBytes);
  let admitted = 0; while (enqueue(f.world, signal(f.actor, content))) admitted++;
  expect(admitted).toBeGreaterThan(0); expect(admitted).toBeLessThan(limits().perActor);
  expect(status(f.world).pendingBytes).toBeLessThanOrEqual(limits().perWorldBytes);
  expect(status(f.world).reasons.world_bytes).toBe(1);
  for (let i = 0; i < 100; i++) enqueue(f.world, signal(f.actor, content));
  expect(status(f.world).recentRejections).toHaveLength(limits().recentRejections);
  expect(JSON.stringify(status(f.world))).not.toContain(content);
});
