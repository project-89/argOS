import { jest } from "@jest/globals";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { WorkingMemoryIdentity } from "../../ecs/components";
import { getRoomForEntity, setLocatedIn } from "../../ecs/location";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { advanceSimulationTimeline } from "../../runtime/simulation-timeline";
import { executeActions } from "../../cognition/cognition-system";
import { startCommittedEvents, stopCommittedEvents, getCommittedEvents, publishCommittedEvent, subscribeCommittedEvents } from "../../runtime/committed-events";
import { withSimulationTask } from "../../runtime/task-scope";
import { chronicle } from "../../cognition/simulation-chronicle";
import { createStoryScaffoldEntity, getStoryScaffold, updateStoryScaffold, type StoryScaffoldData } from "../story-scaffold";
import { getBeatCandidates, onBeatTriggered, startBeatDetection, stopBeatDetection } from "../beat-detector";

function fixture() {
  const world = createArgosWorld("Independent beat evidence"); initializePrefabs(world); startCommittedEvents(world);
  const room = createRoomEntity(world, { name: "Bedroom" }), hall = createRoomEntity(world, { name: "Hall" });
  const actor = createAgentEntity(world, { name: "Mara", role: "resident", systemPrompt: "I make my own decisions.", roomId: room });
  const data: StoryScaffoldData = { seed: "A possible visit", currentAct: "setup", adaptations: [], npcRoles: [], tensions: [
    { id: "visit", description: "An optional visit", status: "active", involvedNpcs: ["Mara"], beats: [
      { id: "arrive", description: "Mara reaches Bedroom", act: "resolution", status: "pending", triggerCondition: "Mara arrives in Bedroom" },
      { id: "later", description: "Another possible visit", act: "resolution", status: "pending", triggerCondition: "Mara arrives in Bedroom" },
    ] },
  ] };
  createStoryScaffoldEntity(world, data); world.time.elapsed = 1000;
  const publish = (executionId = "actual-execution", status: "pending" | "succeeded" | "failed" = "succeeded") =>
    publishCommittedEvent(world, { executionId, kind: "action", actorId: actor, roomId: room, action: "move", status });
  return { world, room, hall, actor, data, publish };
}
afterEach(() => stopBeatDetection());

test("global/private prose cannot trigger or offer a candidate; actual public completion is only lexical telemetry", () => {
  const f = fixture(), triggered = jest.fn(); onBeatTriggered(triggered); startBeatDetection(f.world);
  for (const type of ["llm_decision", "conversation", "action_success", "world_mutation", "crisis_event"] as const)
    chronicle.record(type, { agent: "Mara", action: "move", target: "Bedroom", content: "Mara arrives in Bedroom" });
  expect(getBeatCandidates(f.world)).toEqual([]);
  f.publish("pending", "pending"); f.publish("failed", "failed"); expect(getBeatCandidates(f.world)).toEqual([]);
  const event = f.publish();
  expect(getBeatCandidates(f.world)).toEqual([expect.objectContaining({ kind: "keyword_candidate", beatId: "arrive", sourceId: event.sourceId, atSimMs: 1000, evidence: event })]);
  expect(getStoryScaffold(f.world)).toEqual(f.data); expect(triggered).not.toHaveBeenCalled();
  expect(Object.isFrozen(getBeatCandidates(f.world))).toBe(true);
  expect(Object.isFrozen(getBeatCandidates(f.world)[0].matchedKeywords)).toBe(true);
});

test("world subscriptions and scoped stopping are independent despite identical character/room prose", () => {
  const a = fixture(), b = fixture(); startBeatDetection(a.world); startBeatDetection(b.world);
  a.publish(); expect(getBeatCandidates(a.world)).toHaveLength(1); expect(getBeatCandidates(b.world)).toEqual([]);
  stopBeatDetection(a.world); b.publish(); a.publish("later");
  expect(getBeatCandidates(a.world)).toEqual([]); expect(getBeatCandidates(b.world)).toHaveLength(1);
  expect(getStoryScaffold(a.world)).toEqual(a.data); expect(getStoryScaffold(b.world)).toEqual(b.data);
});

test("native timed movement produces a candidate only after actual ECS arrival and committed completion", () => {
  const f = fixture(); f.world.meta.timedActions = true; f.world.meta.aiEnabled = false;
  setLocatedIn(f.world, f.actor, f.hall); startBeatDetection(f.world);
  executeActions(f.world, [{ eid: f.actor, action: { type: "move", target: "Bedroom" } }], createSystemRegistry());
  expect(getBeatCandidates(f.world)).toEqual([]); expect(getRoomForEntity(f.world, f.actor)).toBe(f.hall);
  advanceSimulationTimeline(f.world, 2999, { integrate: () => {} }); expect(getBeatCandidates(f.world)).toEqual([]);
  advanceSimulationTimeline(f.world, 1, { integrate: () => {} });
  expect(getRoomForEntity(f.world, f.actor)).toBe(f.room);
  expect(getBeatCandidates(f.world)).toEqual([expect.objectContaining({ kind: "keyword_candidate", atSimMs: 4000,
    evidence: expect.objectContaining({ action: "move", status: "succeeded", completedAtSimMs: 4000 }) })]);
  expect(getStoryScaffold(f.world)).toEqual(f.data);
});

test("source stop cleans up; neither stopped starts nor fresh source epochs replay old receipts", () => {
  const f = fixture(); startBeatDetection(f.world); f.publish(); const source = getCommittedEvents(f.world).sourceId;
  stopCommittedEvents(f.world); expect(getBeatCandidates(f.world)).toEqual([]);
  startBeatDetection(f.world); expect(getCommittedEvents(f.world)).toMatchObject({ sourceId: source, stopped: true });
  startCommittedEvents(f.world); f.publish("before-listening"); expect(getBeatCandidates(f.world)).toEqual([]);
  startBeatDetection(f.world); expect(getBeatCandidates(f.world)).toEqual([]);
  f.publish("new-source"); expect(getBeatCandidates(f.world)).toHaveLength(1);
  expect(getBeatCandidates(f.world)[0].sourceId).not.toBe(source);
});

test.each(["owner", "roomOwner", "location", "rewind", "stop"])("a public observer changing %s before inspection invalidates the receipt", change => {
  const f = fixture();
  const off = subscribeCommittedEvents(f.world, () => {
    if (change === "owner") WorkingMemoryIdentity.id[f.actor] = "replacement";
    if (change === "roomOwner") WorkingMemoryIdentity.id[f.room] = "replacement-room";
    if (change === "location") setLocatedIn(f.world, f.actor, f.hall);
    if (change === "rewind") f.world.time.elapsed = 0;
    if (change === "stop") stopCommittedEvents(f.world);
  });
  startBeatDetection(f.world); f.publish(); off();
  expect(getBeatCandidates(f.world)).toEqual([]); expect(getStoryScaffold(f.world)).toEqual(f.data);
});

test("retired and reconciled proposals are never counted as completed or advanced by word matches", () => {
  const f = fixture(); f.data.tensions[0].beats[0].status = "retired";
  f.data.tensions[0].beats[1].reconciliation = { sourceId: getCommittedEvents(f.world).sourceId, atSimMs: 1000,
    reason: "Only a new possibility", evidenceIds: ["public:evidence"], replacesBeatId: "arrive" };
  updateStoryScaffold(f.world, f.data); startBeatDetection(f.world); f.publish();
  expect(getBeatCandidates(f.world)).toEqual([]); expect(getStoryScaffold(f.world)).toEqual(f.data);
});

test("public words about an event do not establish it, and repeated slices of one execution produce at most one candidate", () => {
  const f = fixture(); startBeatDetection(f.world);
  for (const text of ["Mara arrives in Bedroom?", "I am only imagining that."])
    publishCommittedEvent(f.world, { executionId: "one-spoken-turn", kind: "speech", actorId: f.actor, roomId: f.room,
      action: "speak", status: "succeeded", text });
  expect(getBeatCandidates(f.world)).toHaveLength(1); expect(getStoryScaffold(f.world)).toEqual(f.data);
  for (let i = 0; i < 280; i++) f.publish(`other-execution-${i}`);
  expect(getBeatCandidates(f.world)).toHaveLength(64);
  f.world.time.elapsed = 0; expect(getBeatCandidates(f.world)).toEqual([]);
});

test.each([-1, Number.POSITIVE_INFINITY, Number.NaN])("invalid simulation clock %s cannot produce or expose candidates", now => {
  const f = fixture(); startBeatDetection(f.world); f.world.time.elapsed = now; f.publish();
  expect(getBeatCandidates(f.world)).toEqual([]);
  f.world.time.elapsed = 1000; expect(getBeatCandidates(f.world)).toEqual([]);
});

test("canceled work cannot start, stop or publish into another active detector", async () => {
  const f = fixture(); startBeatDetection(f.world); f.publish(); const before = getBeatCandidates(f.world);
  const controller = new AbortController();
  await withSimulationTask(controller.signal, async () => {
    controller.abort();
    expect(() => startBeatDetection(f.world)).toThrow(); expect(() => stopBeatDetection(f.world)).toThrow();
    expect(() => f.publish("canceled")).toThrow();
  });
  expect(getBeatCandidates(f.world)).toEqual(before); f.publish("still-active"); expect(getBeatCandidates(f.world)).toHaveLength(2);
});
