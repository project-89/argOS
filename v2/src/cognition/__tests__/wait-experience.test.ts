import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { Plan, WorkingMemoryIdentity } from "../../ecs/components";
import { setLocatedIn } from "../../ecs/location";
import { startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { advanceSimulationTimeline } from "../../runtime/simulation-timeline";
import { recordCognitionOutcome } from "../idle-cognition";
import { snapshotWaitExperience, formatWaitExperience } from "../wait-experience";
import { registerAgentWorldCapabilities } from "../world-capabilities";
import { createIntentGoal, executeActions } from "../cognition-system";
import { createPlanEntity } from "../planning-system";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { captureCoordinationGoal } from "../coordination-memory";
import { integrateActorContinuation } from "../actor-continuation";

function fixture() {
  const world = createArgosWorld("Waiting experience"); initializePrefabs(world); startCommittedEvents(world);
  const room = createRoomEntity(world, { name: "Street" });
  const actor = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "Choose freely", roomId: room });
  const wait = () => recordCognitionOutcome(world, actor, { type: "wait" }, { succeeded: true, pending: false });
  const advance = (ms: number) => advanceSimulationTimeline(world, ms, { integrate: () => {} });
  return { world, actor, room, wait, advance };
}
test("real repeated waits retain elapsed simulation time instead of restarting its clock", () => {
  const f = fixture(); f.wait(); f.advance(3000); f.wait(); f.advance(7000);
  expect(snapshotWaitExperience(f.world, f.actor)).toEqual({ startedAtSimMs: 0, elapsedSimMs: 10000, waitChoices: 2 });
  expect(formatWaitExperience(f.world, f.actor)).toContain("do not establish that an expected event is scheduled");
});
test.each(["interact", "move", "rest"] as const)("%s ends the prior waiting interval", type => {
  const f = fixture(); f.wait(); f.advance(5000);
  recordCognitionOutcome(f.world, f.actor, { type }, { succeeded: true, pending: false });
  expect(snapshotWaitExperience(f.world, f.actor)).toBeUndefined(); f.wait();
  expect(snapshotWaitExperience(f.world, f.actor)?.startedAtSimMs).toBe(5000);
});
test.each(["think", "reflect", "observe", "examine", "speak"] as const)("%s can occur during the same wait without erasing elapsed experience", type => {
  const f = fixture(); f.wait(); f.advance(5000);
  recordCognitionOutcome(f.world, f.actor, { type }, { succeeded: true, pending: false });
  expect(snapshotWaitExperience(f.world, f.actor)).toEqual({ startedAtSimMs: 0, elapsedSimMs: 5000, waitChoices: 1 });
  f.advance(3000); f.wait();
  expect(snapshotWaitExperience(f.world, f.actor)).toEqual({ startedAtSimMs: 0, elapsedSimMs: 8000, waitChoices: 2 });
});

test("a completed background assessment preserves an actual wait without counting its thoughts as waiting choices", () => {
  const f = fixture();
  const goal = createIntentGoal(f.world, f.actor, "Wait for a friend", 5);
  captureCoordinationGoal(f.world, f.actor, goal);
  integrateActorContinuation(f.world, f.actor, { purpose: "Wait here for Bea", actionType: "wait", goalId: goal,
    goalKey: WorkingMemoryIdentity.id[goal], observedAtSimMs: 0 });
  const plan = createPlanEntity(f.world, f.actor, goal, { goalDescription: "Wait for a friend", steps: [
    { description: "Consider my surroundings", actionType: "think", content: "There is shade here." },
  ] });
  const registry = createSystemRegistry();
  executeActions(f.world, [{ eid: f.actor, action: { type: "wait" } }], registry);
  f.advance(5000);
  executeActions(f.world, [{ eid: f.actor, action: { type: "think", content: "There is shade here." } }], registry);
  expect(Plan.status[plan]).toBe("completed");
  expect(snapshotWaitExperience(f.world, f.actor)).toEqual({ startedAtSimMs: 0, elapsedSimMs: 5000, waitChoices: 1 });
});

test("a timed native look briefly occupies the body but does not restart the waiting interval", () => {
  const f = fixture(); f.world.meta.timedActions = true; f.wait(); f.advance(5000);
  expect(WorkingMemoryIdentity.id[f.room]).toBeDefined();
  executeActions(f.world, [{ eid: f.actor, action: { type: "observe", target: "Street" } }], createSystemRegistry());
  expect(snapshotWaitExperience(f.world, f.actor)).toBeUndefined();
  f.advance(1000);
  expect(snapshotWaitExperience(f.world, f.actor)).toEqual({ startedAtSimMs: 0, elapsedSimMs: 6000, waitChoices: 1 });
});

test("a rejected or pending wait does not erase or extend an already experienced interval", () => {
  const f = fixture(); f.wait(); f.advance(5000);
  for (const outcome of [{ succeeded: false, pending: false }, { succeeded: true, pending: true }])
    recordCognitionOutcome(f.world, f.actor, { type: "wait" }, outcome);
  expect(snapshotWaitExperience(f.world, f.actor)).toEqual({ startedAtSimMs: 0, elapsedSimMs: 5000, waitChoices: 1 });
});

test("returning to an observed old location cannot resurrect a discarded wait", () => {
  const f = fixture(); f.wait(); f.advance(5000);
  setLocatedIn(f.world, f.actor, createRoomEntity(f.world, { name: "Hall" }));
  expect(snapshotWaitExperience(f.world, f.actor)).toBeUndefined();
  setLocatedIn(f.world, f.actor, f.room);
  expect(snapshotWaitExperience(f.world, f.actor)).toBeUndefined();
  f.wait(); expect(snapshotWaitExperience(f.world, f.actor)?.startedAtSimMs).toBe(5000);
});

test("explicitly ending the organizing activity ends the old wait even if its next action is only a thought", () => {
  const f = fixture();
  const goal = createIntentGoal(f.world, f.actor, "Wait for a friend", 5);
  captureCoordinationGoal(f.world, f.actor, goal);
  const intent = { purpose: "Wait here for Bea", actionType: "wait", goalId: goal,
    goalKey: WorkingMemoryIdentity.id[goal], observedAtSimMs: 0 };
  integrateActorContinuation(f.world, f.actor, intent); f.wait(); f.advance(5000);
  integrateActorContinuation(f.world, f.actor, { ...intent, actionType: "think", purpose: "I am done waiting here",
    activityDisposition: "end", observedAtSimMs: 5000 });
  expect(snapshotWaitExperience(f.world, f.actor)).toBeUndefined();
});
test("failed or pending work does not record a completed wait", () => {
  const f = fixture();
  for (const outcome of [{ succeeded: false, pending: false }, { succeeded: true, pending: true }]) {
    recordCognitionOutcome(f.world, f.actor, { type: "wait" }, outcome);
    expect(snapshotWaitExperience(f.world, f.actor)).toBeUndefined();
  }
});
test("owner, source, location and capability replacement invalidate historical timing", () => {
  const f = fixture(); f.wait(); stopCommittedEvents(f.world); startCommittedEvents(f.world);
  expect(snapshotWaitExperience(f.world, f.actor)).toBeUndefined(); f.wait();
  const next = createRoomEntity(f.world, { name: "Hall" }); setLocatedIn(f.world, f.actor, next);
  expect(snapshotWaitExperience(f.world, f.actor)).toBeUndefined(); f.wait();
  const release = registerAgentWorldCapabilities(f.world, f.actor, { context: () => "", ready: () => true, busy: () => false, execute: () => false });
  expect(snapshotWaitExperience(f.world, f.actor)).toBeUndefined(); f.wait(); release();
  expect(snapshotWaitExperience(f.world, f.actor)).toBeUndefined(); f.wait();
  WorkingMemoryIdentity.id[f.actor] = "replacement";
  expect(snapshotWaitExperience(f.world, f.actor)).toBeUndefined();
});
test("clock reversal and another actor cannot inherit a wait", () => {
  const f = fixture(); f.advance(5000); f.wait();
  const other = createAgentEntity(f.world, { name: "Bea", role: "resident", systemPrompt: "Choose freely", roomId: f.room });
  expect(snapshotWaitExperience(f.world, other)).toBeUndefined();
  f.world.time.elapsed = 1000; expect(snapshotWaitExperience(f.world, f.actor)).toBeUndefined();
});
test("new goal selection resets timing, but paraphrasing the same chosen activity does not", () => {
  const f = fixture(); f.wait(); f.advance(2000);
  const goal = createIntentGoal(f.world, f.actor, "Wait for a friend", 5);
  captureCoordinationGoal(f.world, f.actor, goal);
  const choose = (purpose: string) => integrateActorContinuation(f.world, f.actor, { purpose, actionType: "wait",
    goalId: goal, goalKey: WorkingMemoryIdentity.id[goal], observedAtSimMs: f.world.time.elapsed });
  choose("Wait here for Bea"); expect(snapshotWaitExperience(f.world, f.actor)).toBeUndefined();
  f.wait(); f.advance(3000); choose("Keep waiting for my friend"); f.wait();
  expect(snapshotWaitExperience(f.world, f.actor)).toEqual({ startedAtSimMs: 2000, elapsedSimMs: 3000, waitChoices: 2 });
});
