import { jest } from "@jest/globals";
import { removeEntity } from "bitecs";
import { Agent, Goal, WorkingMemoryIdentity } from "../../ecs/components";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createRoomEntity, createObjectEntity, initializePrefabs } from "../../ecs/prefabs";
import { getRoomForEntity, setLocatedIn } from "../../ecs/location";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { getCommittedEvents, startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { advanceSimulationTimeline } from "../../runtime/simulation-timeline";
import { connectRoomRoute, enableRoomRouteTopology } from "../../runtime/room-routes";
import { withSimulationTask } from "../../runtime/task-scope";
import { createPersonalIntention } from "../goal-lifecycle";
import { integrateActorContinuation } from "../actor-continuation";
import { captureWorkingMemoryAction, recordWorkingMemoryAction } from "../working-memory-observation";
import { getWorkingMemory, workingMemoryEntityRef } from "../working-memory";
import { registerAgentWorldCapabilities } from "../world-capabilities";
import { completeDeferredAction, executeActions } from "../cognition-system";
import type { AgentAction } from "../agent-mind";
import { matchesHouseholdOwnActionMemory } from "../../demo/spatial-household-evidence";
import { SpatialDemo } from "../../demo/spatial-demo";

beforeEach(() => {
  jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("Movement memory regressions are offline"));
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

function fixture(mode: "host" | "native" | "legacy" = "host") {
  const world = createArgosWorld(); initializePrefabs(world); world.meta.aiEnabled = false; startCommittedEvents(world);
  const origin = createRoomEntity(world, { name: "Patio" }), destination = createRoomEntity(world, { name: "Kitchen" });
  const otherRoom = createRoomEntity(world, { name: "Study" });
  const actor = createAgentEntity(world, { name: "Noor", role: "visitor", systemPrompt: "Use your own judgement", roomId: origin });
  const witness = createAgentEntity(world, { name: "Tess", role: "host", systemPrompt: "PRIVATE_OTHER_IDENTITY", roomId: destination });
  const secret = createObjectEntity(world, { name: "PRIVATE_UNSEEN_OBJECT", roomId: destination });
  const goal = createPersonalIntention(world, actor, "Find somewhere comfortable to rest my legs", 7)!;
  const purpose = "Go indoors to find a seat out of the rain", action: AgentAction = { type: "move", target: "Kitchen" };
  const destinationKey = workingMemoryEntityRef(world, destination)!.key;
  let targets = [destination], accepted: AgentAction | undefined;
  let remove = () => {};
  if (mode === "host") remove = registerAgentWorldCapabilities(world, actor, { ownsMovement: true,
    context: () => "", ready: () => true, busy: () => false, movementTargets: () => targets,
    execute: command => { accepted = { ...command }; return true; } });
  if (mode === "native") { remove = enableRoomRouteTopology(world, { travelMs: 1000 }); connectRoomRoute(world, origin, destination); }
  integrateActorContinuation(world, actor, { purpose, actionType: "move", target: "Kitchen", observedAtSimMs: 0,
    goalId: goal, goalKey: WorkingMemoryIdentity.id[goal] });
  const record = (before: ReturnType<typeof captureWorkingMemoryAction>, success = true) => {
    advanceSimulationTime(world, world.time.tick + 1, 1000);
    if (success) setLocatedIn(world, actor, destination);
    recordWorkingMemoryAction(world, actor, action, success, { before });
    return getWorkingMemory(world, actor).receipts.filter(r => r.kind === "action").at(-1)!;
  };
  return { world, actor, witness, secret, goal, origin, destination, destinationKey, otherRoom, action, purpose, record,
    setTargets: (next: number[]) => { targets = next; }, remove, accepted: () => accepted! };
}

test.each(["host", "native", "legacy"] as const)("%s movement retains exact destination identity without pretending to observe its contents", mode => {
  const f = fixture(mode), before = captureWorkingMemoryAction(f.world, f.actor, f.action)!;
  expect(before.entities.some(e => e.eid === f.destination || e.eid === f.secret)).toBe(false);
  expect(JSON.stringify(getWorkingMemory(f.world, f.actor))).not.toContain("PRIVATE_UNSEEN_OBJECT");
  const receipt = f.record(before);
  expect(receipt).toMatchObject({ succeeded: true, completedAtSimMs: 1000,
    action: { type: "move", targetKey: f.destinationKey },
    executionContext: { startedAtSimMs: 0, purpose: f.purpose, intention: { key: WorkingMemoryIdentity.id[f.goal] } } });
  expect(receipt.facts).toContainEqual(expect.objectContaining({ subject: WorkingMemoryIdentity.id[f.actor], predicate: "location", value: f.destinationKey }));
  expect(Goal.status[f.goal]).toBe("active"); expect(Goal.progress[f.goal]).toBe(0);
  expect(getWorkingMemory(f.world, f.witness).receipts.every(r => !r.action && !r.executionContext)).toBe(true);
  expect(JSON.stringify(getWorkingMemory(f.world, f.witness))).not.toContain(f.purpose);
  f.remove();
});

test("movement identity remains physical evidence even without an articulated purpose", () => {
  const f = fixture(); integrateActorContinuation(f.world, f.actor, { purpose: "Listen for a moment", actionType: "wait", observedAtSimMs: 0 });
  const receipt = f.record(captureWorkingMemoryAction(f.world, f.actor, f.action));
  expect(receipt.action).toEqual({ type: "move", targetKey: f.destinationKey });
  expect(receipt.executionContext).toBeUndefined(); f.remove();
});

test("a visible namesake object cannot replace the known movement room in its receipt", () => {
  const f = fixture(); createObjectEntity(f.world, { name: "Kitchen", roomId: f.origin });
  const receipt = f.record(captureWorkingMemoryAction(f.world, f.actor, f.action));
  expect(receipt.action).toEqual({ type: "move", targetKey: f.destinationKey }); f.remove();
});

test("legacy movement toward a visible object retains its exact local target identity", () => {
  const f = fixture("legacy"), bench = createObjectEntity(f.world, { name: "Bench", roomId: f.origin });
  const action: AgentAction = { type: "move", target: "Bench" }, before = captureWorkingMemoryAction(f.world, f.actor, action);
  recordWorkingMemoryAction(f.world, f.actor, action, true, { before });
  expect(getWorkingMemory(f.world, f.actor).receipts.find(r => r.kind === "action")).toMatchObject({
    action: { type: "move", targetKey: workingMemoryEntityRef(f.world, bench)!.key } });
});

test.each(["copy", "source", "persona", "capability", "actor", "command", "rewind", "destination-replaced", "wrong-arrival", "unknown", "ambiguous"])("%s cannot fabricate a structured movement completion", change => {
  const f = fixture();
  if (change === "unknown") f.setTargets([]);
  if (change === "ambiguous") f.setTargets([f.destination, createRoomEntity(f.world, { name: "Kitchen" })]);
  advanceSimulationTime(f.world, 1, 1000);
  let before = captureWorkingMemoryAction(f.world, f.actor, f.action)!;
  if (change === "copy") before = structuredClone(before);
  if (change === "source") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
  if (change === "persona") Agent.systemPrompt[f.actor] = "Replacement identity";
  if (change === "capability") { f.remove(); registerAgentWorldCapabilities(f.world, f.actor, { context: () => "", ready: () => true, busy: () => false, execute: () => false }); }
  if (change === "actor") WorkingMemoryIdentity.id[f.actor] = "replacement:actor";
  if (change === "command") f.action.target = "Study";
  if (change === "rewind") f.world.time.elapsed = 0;
  if (change === "destination-replaced") { removeEntity(f.world, f.destination); createRoomEntity(f.world, { name: "Kitchen" }); }
  if (change !== "destination-replaced") setLocatedIn(f.world, f.actor, change === "wrong-arrival" ? f.otherRoom : f.destination);
  recordWorkingMemoryAction(f.world, f.actor, f.action, true, { before });
  expect(getWorkingMemory(f.world, f.actor).receipts.filter(r => r.kind === "action").at(-1)?.action).toBeUndefined();
  f.remove();
});

test("failed travel identifies the attempted destination but never reports an arrival fact", () => {
  const f = fixture(), receipt = f.record(captureWorkingMemoryAction(f.world, f.actor, f.action), false);
  expect(receipt).toMatchObject({ succeeded: false, facts: [], action: { type: "move", targetKey: f.destinationKey },
    executionContext: { purpose: f.purpose } }); f.remove();
});

test("movement remembers the intention at departure, not a replacement intention at arrival", () => {
  const f = fixture(), before = captureWorkingMemoryAction(f.world, f.actor, f.action), original = Goal.description[f.goal];
  Goal.description[f.goal] = "A different private purpose";
  integrateActorContinuation(f.world, f.actor, { purpose: "Answer a joke", actionType: "speak", observedAtSimMs: 0 });
  const receipt = f.record(before);
  expect(receipt).toMatchObject({ action: { type: "move", targetKey: f.destinationKey },
    executionContext: { purpose: f.purpose, intention: { description: original } } });
  expect(Goal.progress[f.goal]).toBe(0); f.remove();
});

test("an aborted or already-consumed movement capture grants no new action attribution", async () => {
  for (const change of ["aborted", "reused"]) {
    const f = fixture(), controller = new AbortController();
    const before = await withSimulationTask(controller.signal, async () => captureWorkingMemoryAction(f.world, f.actor, f.action));
    if (change === "aborted") controller.abort(); else f.record(before);
    const receipt = f.record(before);
    expect(receipt.action).toBeUndefined(); expect(receipt.executionContext).toBeUndefined(); f.remove();
  }
});

test("a wrong deferred execution cannot credit a same-command retry's destination or purpose", () => {
  const f = fixture(), registry = createSystemRegistry();
  executeActions(f.world, [{ eid: f.actor, action: f.action }], registry);
  const first = f.accepted(); completeDeferredAction(f.world, f.actor, first, false, "The path was interrupted.");
  executeActions(f.world, [{ eid: f.actor, action: f.action }], registry); const second = f.accepted();
  expect(second.executionId).not.toBe(first.executionId);
  setLocatedIn(f.world, f.actor, f.destination); advanceSimulationTime(f.world, 1, 1000);
  const before = JSON.stringify(getWorkingMemory(f.world, f.actor));
  completeDeferredAction(f.world, f.actor, first, true, "Stale completion");
  expect(JSON.stringify(getWorkingMemory(f.world, f.actor))).toBe(before);
  completeDeferredAction(f.world, f.actor, second, true, "You walked to Kitchen.");
  expect(getWorkingMemory(f.world, f.actor).receipts.filter(r => r.kind === "action").at(-1)).toMatchObject({
    succeeded: true, action: { type: "move", targetKey: f.destinationKey } }); f.remove();
});

test("real native timed room traversal joins its completed receipt to exact own-action memory", () => {
  const f = fixture("native"); f.world.meta.timedActions = true;
  executeActions(f.world, [{ eid: f.actor, action: f.action }], createSystemRegistry());
  advanceSimulationTimeline(f.world, 1000, { integrate: () => {} });
  expect(getRoomForEntity(f.world, f.actor)).toBe(f.destination);
  const event = getCommittedEvents(f.world).events.find(e => e.action === "move" && e.status === "succeeded")!;
  expect(event).toBeDefined();
  expect(getWorkingMemory(f.world, f.actor).receipts.some(r => matchesHouseholdOwnActionMemory(event, r))).toBe(true); f.remove();
});
test("manual spatial household travel carries a newly authored intention with exact movement identity", async () => {
  const demo = await SpatialDemo.create({ scenario: "household", householdChallenge: true, live: false, automaticClock: false });
  try {
    await demo.start(); const world = demo.sim.world, actor = demo.actors.find(e => demo.snapshot().actors.find(a => a.id === e)?.name === "Noor")!;
    const destination = demo.byId.get("household-kitchen")!, key = workingMemoryEntityRef(world, destination)!.key;
    const goal = createPersonalIntention(world, actor, "Find a comfortable seat indoors", 8)!;
    integrateActorContinuation(world, actor, { purpose: "Go indoors to look for a comfortable seat", actionType: "move", target: "Kitchen",
      observedAtSimMs: demo.atSimMs, goalId: goal, goalKey: WorkingMemoryIdentity.id[goal] });
    demo.dispatch(WorkingMemoryIdentity.id[actor], "move", key); demo.advance(15_000);
    const event = getCommittedEvents(world).events.find(e => e.actorId === actor && e.action === "move" && e.status === "succeeded")!;
    expect(event).toBeDefined();
    const receipt = getWorkingMemory(world, actor).receipts.find(r => matchesHouseholdOwnActionMemory(event, r));
    expect(receipt).toMatchObject({ action: { type: "move", targetKey: key },
      executionContext: { intention: { key: WorkingMemoryIdentity.id[goal] } } });
    expect(Goal.status[goal]).toBe("active"); // Travelling to seek a seat does not finish the purpose.
  } finally { demo.stop(); }
});
