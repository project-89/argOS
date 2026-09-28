import { jest } from "@jest/globals";
import { removeEntity } from "bitecs";
import { Goal, LastAction, Plan, ObjectState, Perception, WorkingMemoryIdentity } from "../../ecs/components";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { getDirectContainer, getRoomForEntity, setLocatedIn } from "../../ecs/location";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { advanceSimulationTimeline, clearSimulationTimeline, isSimulationResourceBusy } from "../../runtime/simulation-timeline";
import { getCommittedEvents, startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { createIntentGoal, executeActions, runActorControlStep, hasPendingCognitionStimuli } from "../cognition-system";
import { createPlanEntity } from "../planning-system";
import { drainPendingStimuli, queueStimulus, peekPendingStimuli } from "../stimulus-queue";
import { getForegroundCognitionReadiness } from "../idle-cognition";
import { getAgentPerceptions } from "../agent-mind";

function fixture() {
  const world = createArgosWorld("Finite native work"); world.meta.aiEnabled = false; world.meta.timedActions = true;
  initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Workshop" }), remote = createRoomEntity(world, { name: "Hall" });
  const actor = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "Work with actual objects.", roomId: room });
  const item = createObjectEntity(world, { name: "Brass spool", roomId: room, portable: true });
  const registry = createSystemRegistry();
  const pickup = { type: "pickup" as const, target: "Brass spool" };
  const execute = (action = pickup) => executeActions(world, [{ eid: actor, action }], registry);
  const advance = (ms: number) => advanceSimulationTimeline(world, ms, { integrate: () => {} });
  const plan = () => {
    const goal = createIntentGoal(world, actor, "Collect the spool");
    return createPlanEntity(world, actor, goal, { goalDescription: Goal.description[goal],
      steps: [{ description: "Take the spool", actionType: "pickup", target: "Brass spool" }], estimatedCompletion: "short", potentialObstacles: [] });
  };
  return { world, room, remote, actor, item, registry, execute, advance, plan };
}
beforeEach(() => { drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline test")); });
test("shutdown closes an unfinished native interval without applying its effect", () => {
  const f = fixture(); f.execute(); f.advance(400);
  clearSimulationTimeline(f.world);
  expect(getCommittedEvents(f.world).events.map(e => [e.status, e.atSimMs])).toEqual([["pending", 0], ["failed", 400]]);
  expect(getCommittedEvents(f.world).events.at(-1)?.completedAtSimMs).toBe(400);
  expect(getDirectContainer(f.world, f.item)).toBe(f.room);
  clearSimulationTimeline(f.world); f.advance(1000);
  expect(getCommittedEvents(f.world).events).toHaveLength(2);
  expect(getDirectContainer(f.world, f.item)).toBe(f.room);
});
test("cancellation cannot attribute an old interval to a replacement identity", () => {
  const f = fixture(); f.execute(); f.advance(400);
  WorkingMemoryIdentity.id[f.actor] = "replacement-identity";
  clearSimulationTimeline(f.world);
  expect(getCommittedEvents(f.world).events.map(e => e.status)).toEqual(["pending"]);
  expect(getDirectContainer(f.world, f.item)).toBe(f.room);
});
test("cancellation cannot publish an old interval into a replacement event source", () => {
  const f = fixture(); f.execute(); f.advance(400);
  stopCommittedEvents(f.world); startCommittedEvents(f.world);
  const before = [...getCommittedEvents(f.world).events];
  clearSimulationTimeline(f.world);
  expect(getCommittedEvents(f.world).events).toEqual(before);
  expect(getDirectContainer(f.world, f.item)).toBe(f.room);
});
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli(); });

test("pickup has a physical interval and advances its captured plan only on completion", () => {
  const f = fixture(), plan = f.plan(); f.execute();
  expect(getDirectContainer(f.world, f.item)).toBe(f.room); expect(Plan.currentStep[plan]).toBe(0);
  expect(isSimulationResourceBusy(f.world, f.actor, "body")).toBe(true);
  f.advance(799); expect(getDirectContainer(f.world, f.item)).toBe(f.room);
  f.advance(1); expect(getDirectContainer(f.world, f.item)).toBe(f.actor); expect(Plan.status[plan]).toBe("completed");
  expect(isSimulationResourceBusy(f.world, f.actor, "body")).toBe(false);
});
test("one coarse advance and many fine advances commit at the same deadline", () => {
  for (const deltas of [[1200], [200, 200, 200, 200, 200, 200]]) {
    const f = fixture(); f.execute();
    for (const delta of deltas) f.advance(delta);
    expect(getDirectContainer(f.world, f.item)).toBe(f.actor); expect(f.world.time.elapsed).toBe(1200);
    expect(getCommittedEvents(f.world).events.map(event => [event.status, event.atSimMs])).toEqual([["pending", 0], ["succeeded", 800]]);
  }
});
test("taking an object away during the interval makes the original operation fail", () => {
  const f = fixture(), plan = f.plan(); f.execute(); setLocatedIn(f.world, f.item, f.remote); f.advance(800);
  expect(getDirectContainer(f.world, f.item)).toBe(f.remote); expect(Plan.currentStep[plan]).toBe(0);
  expect(LastAction.success[f.actor]).toBe(false);
});
test("a replacement with the same name cannot receive the old operation", () => {
  const f = fixture(); f.execute(); removeEntity(f.world, f.item);
  const replacement = createObjectEntity(f.world, { name: "Brass spool", roomId: f.room, portable: true });
  f.advance(800); expect(getDirectContainer(f.world, replacement)).toBe(f.room); expect(LastAction.success[f.actor]).toBe(false);
});
test("a newer matching plan cannot inherit the pending action's receipt", () => {
  const f = fixture(), old = f.plan(); f.execute(); Plan.status[old] = "abandoned";
  const replacement = f.plan(); f.advance(800);
  expect(getDirectContainer(f.world, f.item)).toBe(f.actor); expect(Plan.currentStep[replacement]).toBe(0);
});
test("stop cancels future writes and releases resources", () => {
  const f = fixture(); f.execute(); clearSimulationTimeline(f.world); f.advance(2000);
  expect(getDirectContainer(f.world, f.item)).toBe(f.room); expect(isSimulationResourceBusy(f.world, f.actor, "body")).toBe(false);
});
test("overlapping body commands cannot create a second completion", () => {
  const f = fixture(); f.execute(); f.execute(); f.advance(2000);
  expect(getDirectContainer(f.world, f.item)).toBe(f.actor);
  expect(getCommittedEvents(f.world).events.filter(event => event.status === "succeeded")).toHaveLength(1);
});
test("one world's failed pickup cannot suppress another world's actor with the same ECS slot", () => {
  const a = fixture(); setLocatedIn(a.world, a.item, a.remote); a.execute(); a.advance(800);
  expect(LastAction.success[a.actor]).toBe(false);
  const b = fixture(); expect(b.actor).toBe(a.actor); b.execute(); b.advance(800);
  expect(getDirectContainer(b.world, b.item)).toBe(b.actor);
});
test("room traversal is finite without guessing a distance", () => {
  const f = fixture(); executeActions(f.world, [{ eid: f.actor, action: { type: "move", target: "Hall" } }], f.registry);
  expect(getRoomForEntity(f.world, f.actor)).toBe(f.room); f.advance(2999); expect(getRoomForEntity(f.world, f.actor)).toBe(f.room);
  f.advance(1); expect(getRoomForEntity(f.world, f.actor)).toBe(f.remote);
});

test("native timed observation preserves its committed quiet backoff through cleanup and later probes", () => {
  const f = fixture(), observe = () => executeActions(f.world, [{ eid: f.actor, action: { type: "observe", target: "Brass spool" } }], f.registry);
  observe(); f.advance(1000);
  expect(LastAction.success[f.actor]).toBe(true);
  expect(getForegroundCognitionReadiness(f.world, f.actor)).toMatchObject({ ready: false, reason: "quiet", quietDecisions: 1, nextCheckAtMs: 2000 });
  expect(runActorControlStep(f.world, f.actor, f.registry)).toBe(false);
  f.advance(1000); expect(getForegroundCognitionReadiness(f.world, f.actor).reason).toBe("idle_deadline");
  observe(); f.advance(1000);
  expect(getForegroundCognitionReadiness(f.world, f.actor)).toMatchObject({ ready: false, quietDecisions: 2, nextCheckAtMs: 7000 });
  ObjectState.current[f.item] = "broken";
  expect(getForegroundCognitionReadiness(f.world, f.actor)).toMatchObject({ ready: true, reason: "state_changed" });
});

test("quiet native completion does not erase an independent stimulus that arrived during observation", () => {
  const f = fixture(); executeActions(f.world, [{ eid: f.actor, action: { type: "observe", target: "Brass spool" } }], f.registry);
  queueStimulus(f.world, { targetEid: f.actor, type: "danger", source: "alarm", content: "The alarm sounds.", modality: "auditory" });
  f.advance(1000);
  expect(peekPendingStimuli(f.actor).some(s => s.type === "danger")).toBe(true);
  expect(getForegroundCognitionReadiness(f.world, f.actor, { hasPendingStimuli: hasPendingCognitionStimuli(f.world, f.actor) }))
    .toMatchObject({ ready: true, reason: "new_stimulus" });
});

test("an interrupted native observation still reports failure and wakes reconsideration", () => {
  const f = fixture(); executeActions(f.world, [{ eid: f.actor, action: { type: "observe", target: "Brass spool" } }], f.registry);
  removeEntity(f.world, f.item); f.advance(1000);
  expect(LastAction.success[f.actor]).toBe(false);
  expect(getAgentPerceptions(f.world, f.actor).some(pid => Perception.type[pid] === "attention"
    && Perception.source[pid] === "physical world" && Perception.content[pid].includes("interrupted"))).toBe(true);
  expect(getForegroundCognitionReadiness(f.world, f.actor).ready).toBe(true);
});
