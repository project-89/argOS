import { jest } from "@jest/globals";
import { addEntity, removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { BehaviorPolicy, WorkingMemoryIdentity } from "../../ecs/components";
import { setAgentBehaviorPolicy } from "../behavior-policy";
import { recordOutcome, getReinforcementState, getGrowthSummary, resetLearningState, initializeAffordanceDiscovery } from "../policy-learning";
import { getCommittedEvents, startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { registerAffordance, onAffordanceRegistered } from "../../world/schema";

function fixture(name: string, startSource = true) {
  const world = createArgosWorld(name); initializePrefabs(world); if (startSource) startCommittedEvents(world);
  const room = createRoomEntity(world, { name: "Workshop" });
  const actor = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "Observe", roomId: room });
  setAgentBehaviorPolicy(world, actor, { type: "selector", children: [{ type: "action", action: { type: "wait" } }] }, true);
  return { world, actor };
}
beforeEach(() => { resetLearningState(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); resetLearningState(); jest.restoreAllMocks(); });

test("discovery subscriptions unsubscribe independently and idempotently", () => {
  const listener = jest.fn(), first = onAffordanceRegistered(listener), second = onAffordanceRegistered(listener);
  try {
    first(); first();
    registerAffordance({ name: "lifecycle-subscription", requires: ["examinable"], effects: [] });
    expect(listener).toHaveBeenCalledTimes(1);
  } finally { first(); second(); }
});

test("a replacement actor with the same numeric ID never inherits reinforcement history", () => {
  const f = fixture("A");
  recordOutcome(f.world, { agentEid: f.actor, action: { type: "observe" }, success: true });
  expect(getReinforcementState(f.actor, f.world)?.get("observe:*")?.attempts).toBe(1);
  WorkingMemoryIdentity.id[f.actor] = "replacement-actor";
  expect(getReinforcementState(f.actor, f.world)).toBeUndefined();
  recordOutcome(f.world, { agentEid: f.actor, action: { type: "observe" }, success: true });
  expect(getReinforcementState(f.actor, f.world)?.get("observe:*")?.attempts).toBe(1);
  stopCommittedEvents(f.world);
});

test("world-scoped learning state cannot be read through a different world with overlapping IDs", () => {
  const a = fixture("A"); recordOutcome(a.world, { agentEid: a.actor, action: { type: "observe" }, success: true });
  const b = fixture("B");
  expect(a.actor).toBe(b.actor);
  expect(getReinforcementState(b.actor, b.world)).toBeUndefined();
  recordOutcome(b.world, { agentEid: b.actor, action: { type: "observe" }, success: false });
  expect(getReinforcementState(b.actor, b.world)?.get("observe:*")?.attempts).toBe(1);
  // Shared static SoA does not establish independent simultaneous ECS worlds.
  // Its replacement owner must also invalidate A's stale cache, not transplant it.
  expect(getReinforcementState(a.actor, a.world)).toBeUndefined();
  stopCommittedEvents(a.world); stopCommittedEvents(b.world);
});

test("removed actors and stopped sources cannot accumulate or mutate learning", () => {
  const f = fixture("A"); recordOutcome(f.world, { agentEid: f.actor, action: { type: "observe" }, success: true });
  stopCommittedEvents(f.world); const tree = BehaviorPolicy.treeJson[f.actor];
  recordOutcome(f.world, { agentEid: f.actor, action: { type: "observe" }, success: false });
  expect(BehaviorPolicy.treeJson[f.actor]).toBe(tree);
  expect(getReinforcementState(f.actor, f.world)).toBeUndefined();
  removeEntity(f.world, f.actor); addEntity(f.world);
  expect(getReinforcementState(f.actor, f.world)).toBeUndefined();
});

test("stopped inspection and rejected outcomes preserve same-actor learning for resume", () => {
  const f = fixture("A");
  recordOutcome(f.world, { agentEid: f.actor, action: { type: "observe" }, success: true });
  const prior = getReinforcementState(f.actor, f.world), priorSummary = getGrowthSummary(f.actor, f.world);
  stopCommittedEvents(f.world);
  expect(getReinforcementState(f.actor, f.world)).toBeUndefined();
  expect(getGrowthSummary(f.actor, f.world).reinforcementEntries).toBe(0);
  recordOutcome(f.world, { agentEid: f.actor, action: { type: "observe" }, success: false });
  expect(getReinforcementState(f.actor, f.world)).toBeUndefined();
  startCommittedEvents(f.world);
  expect(getReinforcementState(f.actor, f.world)).toEqual(prior);
  expect(getGrowthSummary(f.actor, f.world)).toEqual(priorSummary);
  recordOutcome(f.world, { agentEid: f.actor, action: { type: "observe" }, success: true });
  expect(getReinforcementState(f.actor, f.world)?.get("observe:*")?.attempts).toBe(2);
  stopCommittedEvents(f.world);
});

test("a stopped source still invalidates a replaced actor's learning ownership", () => {
  const f = fixture("A");
  recordOutcome(f.world, { agentEid: f.actor, action: { type: "observe" }, success: true });
  const oldOwner = WorkingMemoryIdentity.id[f.actor];
  stopCommittedEvents(f.world); WorkingMemoryIdentity.id[f.actor] = "replacement-while-stopped";
  expect(getReinforcementState(f.actor, f.world)).toBeUndefined();
  // Restoring a stale owner field cannot resurrect a cache invalidated above.
  WorkingMemoryIdentity.id[f.actor] = oldOwner; startCommittedEvents(f.world);
  expect(getReinforcementState(f.actor, f.world)).toBeUndefined();
  stopCommittedEvents(f.world);
});

test("affordance discovery unregisters on stop, and can attach to a later source", () => {
  const f = fixture("A"); initializeAffordanceDiscovery(f.world); stopCommittedEvents(f.world);
  const before = BehaviorPolicy.treeJson[f.actor];
  registerAffordance({ name: "lifecycle-old", description: "old", requires: ["examinable"], effects: [] } as any);
  expect(BehaviorPolicy.treeJson[f.actor]).toBe(before);
  startCommittedEvents(f.world); initializeAffordanceDiscovery(f.world);
  registerAffordance({ name: "lifecycle-current", description: "new", requires: ["examinable"], effects: [] } as any);
  expect(BehaviorPolicy.treeJson[f.actor]).toContain("lifecycle-current");
  expect(BehaviorPolicy.treeJson[f.actor]).not.toContain("lifecycle-old");
  stopCommittedEvents(f.world);
});

test("legacy discovery initialization captures the source established by its stop subscription", () => {
  const f = fixture("Legacy", false);
  expect(getCommittedEvents(f.world).sourceId).toBeNull();
  initializeAffordanceDiscovery(f.world);
  expect(getCommittedEvents(f.world).sourceId).not.toBeNull();
  registerAffordance({ name: "lifecycle-legacy", requires: ["examinable"], effects: [] });
  expect(BehaviorPolicy.treeJson[f.actor]).toContain("lifecycle-legacy");
  stopCommittedEvents(f.world);
  const before = BehaviorPolicy.treeJson[f.actor];
  registerAffordance({ name: "lifecycle-legacy-stopped", requires: ["examinable"], effects: [] });
  expect(BehaviorPolicy.treeJson[f.actor]).toBe(before);
});
