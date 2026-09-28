import { jest } from "@jest/globals";
import { addComponent, addEntity, getRelationTargets, query, removeComponent, removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { initializeRegistry } from "../../ecs/component-registry";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Agent, Goal, GoalLifecycle, Needs, ObjectState, ObjectType, Plan, Traits, WikiDoc } from "../../ecs/components";
import { initializeWorkDocument } from "../../world/productive-work";
import { captureWorkingMemoryObservation } from "../working-memory-observation";
import { actorKnowsGoalCondition, copyActorGoalCondition } from "../actor-goal-evidence";
import { HasGoal, HasPlan } from "../../ecs/relations";
import { setLocatedIn } from "../../ecs/location";
import { createGeneratedIntention, getGoalCompletionOptions, maintainGoalLifecycles } from "../goal-lifecycle";
import { setGoalContract, type GoalSuccessV1 } from "../goal-contract";
import { registerAgentWorldCapabilities } from "../world-capabilities";
import { evaluateGoalSuccessContract, goalEvaluationSystem } from "../../systems/goal-evaluation-system";

function fixture() {
  const world = createArgosWorld("Intention lifecycle"); initializePrefabs(world); initializeRegistry(world);
  const room = createRoomEntity(world, { name: "Common Room" });
  const store = createRoomEntity(world, { name: "Store Room" });
  const actor = createAgentEntity(world, { name: "Mara", role: "resident", systemPrompt: "Reason from your experience.", roomId: room });
  const relay = createObjectEntity(world, { name: "Relay", roomId: room, portable: false }); ObjectState.current[relay] = "broken";
  Needs.energy[actor] = 30;
  return { world, room, store, actor, relay };
}
type Fixture = ReturnType<typeof fixture>;
const repairSuccess: GoalSuccessV1 = { type: "entity_component_equals", entityName: "Relay", component: "ObjectState", field: "current", equals: "repaired" };
function publish(f: Fixture, success: GoalSuccessV1 = repairSuccess) {
  registerAgentWorldCapabilities(f.world, f.actor, {
    context: () => "", ready: () => true, busy: () => false, execute: () => false,
    goalCompletionOptions: () => [{ id: "provider-id-is-not-authority", description: "Relay repaired", success }],
  });
  return getGoalCompletionOptions(f.world, f.actor).find(o => o.description === "Relay repaired")!;
}
function create(f: Fixture, overrides: Record<string, unknown> = {}) {
  return createGeneratedIntention(f.world, f.actor, { description: "Investigate the room", priority: 5, ...overrides }, "foreground");
}
function attachPlan(f: Fixture, goalId: number, status = "completed") {
  const id = addEntity(f.world); addComponent(f.world, id, Plan); addComponent(f.world, f.actor, HasPlan(id));
  Plan.goalEid[id] = goalId; Plan.status[id] = status; Plan.currentStep[id] = 1;
  Plan.steps[id] = JSON.stringify([{ actionType: "observe", target: "Relay", description: "Check the relay" }]);
  return id;
}
function authored(f: Fixture, success: GoalSuccessV1 = repairSuccess) {
  const id = addEntity(f.world); addComponent(f.world, id, Goal); addComponent(f.world, f.actor, HasGoal(id));
  Goal.createdAt[id] = Date.now(); Goal.status[id] = "active"; Goal.priority[id] = 7; Goal.progress[id] = 0;
  setGoalContract(f.world, id, { version: 1, kind: "use_affordance", params: { targetName: "Relay", affordance: "repair" }, success, description: "Repair the relay" });
  return id;
}
function evaluate(f: Fixture) {
  goalEvaluationSystem(f.world, { query, getRelationTargets, log: () => {}, emit: () => {} });
}
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(100_000); jest.spyOn(console, "log").mockImplementation(() => {}); });
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

test("structural semantics exclude generic occupancy states without removing explicitly published repair criteria", () => {
  const f = fixture(); ObjectState.current[f.relay] = "normal";
  addComponent(f.world, f.relay, Traits); Traits.active[f.relay] = '["structural_geometry","examinable"]';
  expect(getGoalCompletionOptions(f.world, f.actor).filter(o => o.description.includes("Relay"))).toEqual([]);
  const option = publish(f);
  expect(option.description).toBe("Relay repaired");
  expect(getGoalCompletionOptions(f.world, f.actor).filter(o => o.description.includes("Relay"))).toEqual([option]);
});

test("a native document completion option is verifiable through the actor's admitted observation", () => {
  const f = fixture();
  const document = createObjectEntity(f.world, { name: "Repair handoff", roomId: f.room, portable: true });
  initializeWorkDocument(f.world, document);
  const option = getGoalCompletionOptions(f.world, f.actor).find(o => o.description === "Finalize Repair handoff")!;
  expect(option).toBeDefined();
  const condition = copyActorGoalCondition(option.success)!;
  const before = captureWorkingMemoryObservation(f.world, f.actor)!;
  expect(actorKnowsGoalCondition(f.world, f.actor, condition, 0, [...before.facts])).toBe(false);
  ObjectState.current[document] = "finished";
  const visualOnly = captureWorkingMemoryObservation(f.world, f.actor)!;
  expect(actorKnowsGoalCondition(f.world, f.actor, condition, 0, [...visualOnly.facts])).toBe(false);
  // Fixture state only: isolates publication/admission, not execution correctness.
  WikiDoc.status[document] = "finished";
  ObjectState.current[document] = "finished";
  const after = captureWorkingMemoryObservation(f.world, f.actor)!;
  expect(actorKnowsGoalCondition(f.world, f.actor, condition, 0, [...after.facts])).toBe(true);
  expect(after.facts.some(fact => fact.slot === "WikiDoc.body")).toBe(false);
  setLocatedIn(f.world, document, f.store);
  const remote = captureWorkingMemoryObservation(f.world, f.actor)!;
  expect(actorKnowsGoalCondition(f.world, f.actor, condition, remote.observedAt, [...remote.facts])).toBe(false);
});

test("generated intentions copy a published engine condition and complete only when native state proves it", () => {
  const f = fixture(), option = publish(f), id = create(f, { description: option.description, completionId: option.id })!;
  expect(id).not.toBeNull(); expect(GoalLifecycle.mode[id]).toBe("verified");
  expect(JSON.parse(Goal.successJson[id])).toEqual(repairSuccess);
  expect(evaluateGoalSuccessContract(f.world, f.actor, id).satisfied).toBe(false);
  ObjectState.current[f.relay] = "repaired"; evaluate(f);
  expect(Goal.status[id]).toBe("completed"); expect(Goal.progress[id]).toBe(100);
});

test("finished plans cannot certify a generated physical objective", () => {
  const f = fixture(), option = publish(f), id = create(f, { description: option.description, completionId: option.id })!;
  attachPlan(f, id); maintainGoalLifecycles(f.world, f.actor); evaluate(f);
  expect(ObjectState.current[f.relay]).toBe("broken"); expect(Goal.status[id]).toBe("active");
  expect(Goal.progress[id]).toBeLessThan(100);
});

test("a generated rest goal has native energy proof, not an action-description certificate", () => {
  const f = fixture(), option = getGoalCompletionOptions(f.world, f.actor).find(o => o.success.type === "need_at_least")!;
  const id = create(f, { description: option.description, completionId: option.id })!;
  attachPlan(f, id); evaluate(f); expect(Goal.status[id]).toBe("active");
  Needs.energy[f.actor] = 80; evaluate(f); expect(Goal.status[id]).toBe("completed");
});

test("a narrower completion hint cannot certify a larger intention or discard its meaning", () => {
  const f = fixture();
  registerAgentWorldCapabilities(f.world, f.actor, { context: () => "", ready: () => true, busy: () => false, execute: () => false,
    goalCompletionOptions: () => [{ id: "ignored", description: "Be in Store Room", success: { type: "in_room", roomName: "Store Room" } }],
  });
  const option = getGoalCompletionOptions(f.world, f.actor).find(o => o.description === "Be in Store Room")!;
  const description = "Inspect the locked tin in Store Room to find the missing letter";
  const id = create(f, { description, completionId: option.id })!;
  expect(Goal.description[id]).toBe(description); expect(GoalLifecycle.mode[id]).toBe("exploratory");
  expect(JSON.parse(Goal.successJson[id]).type).toBe("custom");
  expect(JSON.parse(Goal.paramsJson[id]).completionHint).toEqual({ ...option, authoritative: false });
  setLocatedIn(f.world, f.actor, f.store); evaluate(f);
  expect(Goal.status[id]).toBe("active"); expect(Goal.progress[id]).toBe(0);
  // Finishing the proposed plan is not evidence of the whole inquiry.
  attachPlan(f, id); evaluate(f); maintainGoalLifecycles(f.world, f.actor);
  expect(Goal.status[id]).toBe("active"); expect(Goal.progress[id]).toBe(0);
});

test("an already-satisfied supporting hint does not reject a still-unanswered broader question", () => {
  const f = fixture(), option = getGoalCompletionOptions(f.world, f.actor).find(o => o.description === "Be in Common Room")!;
  const id = create(f, { description: "Investigate the noise in Common Room", completionId: option.id })!;
  expect(id).not.toBeNull(); evaluate(f);
  expect(Goal.status[id]).toBe("active"); expect(GoalLifecycle.mode[id]).toBe("exploratory");
});

test("already-satisfied and unpublished completion conditions are not admitted as new work", () => {
  const f = fixture(), option = publish(f); ObjectState.current[f.relay] = "repaired";
  expect(create(f, { description: option.description, completionId: option.id })).toBeNull();
  expect(create(f, { completionId: "model-invented-proof" })).toBeNull();
  expect(getRelationTargets(f.world, f.actor, HasGoal)).toHaveLength(0);
});

test("normalized canonical wording cannot duplicate an active generated completion criterion", () => {
  const f = fixture(), option = publish(f);
  expect(create(f, { description: option.description, completionId: option.id })).not.toBeNull();
  expect(create(f, { description: "  RELAY   REPAIRED  ", completionId: option.id })).toBeNull();
});

test("different goal kinds and params cannot duplicate an active authored success criterion", () => {
  const f = fixture(); authored(f);
  const option = getGoalCompletionOptions(f.world, f.actor).find(o => JSON.stringify(o.success) === JSON.stringify(repairSuccess))
    || getGoalCompletionOptions(f.world, f.actor).find(o => o.description === "Repair the relay")!;
  expect(create(f, { description: option.description, completionId: option.id })).toBeNull();
});

test("completion options exclude unobserved remote object state and event-history claims", () => {
  const f = fixture(); createObjectEntity(f.world, { name: "Hidden remote relay", roomId: f.store });
  authored(f, { type: "did_action_type", actionType: "speak" });
  const options = getGoalCompletionOptions(f.world, f.actor);
  expect(options.some(o => o.description.includes("Hidden remote relay"))).toBe(false);
  expect(options.some(o => o.success.type === "did_action_type")).toBe(false);
});

test("a custom system state does not inherit impossible generic object completion states", () => {
  const f = fixture();
  // This is the actual testbed shape: generic object prefab, package-owned state.
  expect(ObjectType.typeId[f.relay]).toBe("object");
  ObjectState.current[f.relay] = "repaired";
  const options = getGoalCompletionOptions(f.world, f.actor);
  expect(options.some(o => o.description === "Relay is repaired")).toBe(true);
  expect(options.some(o => o.description === "Relay is normal")).toBe(false);
});

test("matching native state machines still publish their alternate completion states", () => {
  const f = fixture(); ObjectType.typeId[f.relay] = "door"; ObjectState.current[f.relay] = "closed";
  const options = getGoalCompletionOptions(f.world, f.actor);
  expect(options.some(o => o.description === "Relay is open")).toBe(true);
  expect(options.some(o => o.description === "Relay is closed")).toBe(true);
});

test("package-published outcomes survive a prefab schema mismatch and still need physical proof", () => {
  const f = fixture(), option = publish(f);
  expect(getGoalCompletionOptions(f.world, f.actor).some(o => o.description === "Relay is normal")).toBe(false);
  const id = create(f, { description: option.description, completionId: option.id })!;
  expect(id).not.toBeNull(); expect(Goal.status[id]).toBe("active");
  ObjectState.current[f.relay] = "repaired"; evaluate(f);
  expect(Goal.status[id]).toBe("completed");
});

test.each([
  { type: "need_at_least", need: "energy" },
  { type: "need_at_least", need: "invented_need", atLeast: 80 },
  { type: "need_at_most", need: "hunger", atMost: Infinity },
  { type: "entity_component_equals", entityName: "Relay", component: "ObjectState", field: "current", equals: {} },
  { type: "in_room", roomName: "" },
  { type: "all_of", conditions: [] },
  { type: "any_of", conditions: [{ type: "unknown" }] },
])("malformed published criterion %p does not become an impossible generated goal", success => {
  const f = fixture(); publish(f, success as any);
  expect(getGoalCompletionOptions(f.world, f.actor).some(o => o.description === "Relay repaired")).toBe(false);
});

test("a completed partial plan neither settles the intention nor retires its next active plan", () => {
  const f = fixture(), parent = authored(f), id = create(f)!; attachPlan(f, id);
  const otherPlan = attachPlan(f, id, "active"); const events: string[] = [];
  expect(maintainGoalLifecycles(f.world, f.actor, type => events.push(type))).toBe(0);
  expect(Goal.status[id]).toBe("active"); expect(Goal.progress[id]).toBe(0);
  expect(Goal.status[parent]).toBe("active"); expect(Plan.status[otherPlan]).toBe("active");
  expect(events).not.toContain("goal_completed");
  expect(maintainGoalLifecycles(f.world, f.actor)).toBe(0);
});

test("an unbounded exploratory intention pauses at its review deadline without any fabricated plan", () => {
  const f = fixture(), id = create(f)!;
  const duration = GoalLifecycle.reviewAfter[id] - Goal.createdAt[id];
  advanceSimulationTime(f.world, f.world.time.tick + 1, duration - 1); maintainGoalLifecycles(f.world, f.actor);
  expect(Goal.status[id]).toBe("active");
  advanceSimulationTime(f.world, f.world.time.tick + 1, 1); maintainGoalLifecycles(f.world, f.actor);
  expect(Goal.status[id]).toBe("paused"); expect(Goal.progress[id]).toBe(0);
});

test("social goals preserve their distinct subjective review contract", () => {
  const f = fixture(), id = create(f, { kind: "social", description: "Feel at home with my neighbors" })!;
  attachPlan(f, id); jest.setSystemTime(200_000); maintainGoalLifecycles(f.world, f.actor); evaluate(f);
  expect(Goal.kind[id]).toBe("social"); expect(GoalLifecycle.mode[id]).toBe("social");
  expect(Goal.status[id]).toBe("active"); expect(Goal.progress[id]).toBe(0);
});

test.each(["completed", "replaced", "deleted", "detached", "expired"])("supporting intentions retire after their parent is %s, without independent success", change => {
  const f = fixture(), parent = authored(f), id = create(f, { supportsGoalId: parent })!, p = attachPlan(f, id, "active");
  if (change === "completed") Goal.status[parent] = "completed";
  if (change === "expired") Goal.status[parent] = "expired";
  if (change === "replaced") { Goal.signature[parent] = "replacement-contract"; Goal.createdAt[parent]++; }
  if (change === "deleted") removeEntity(f.world, parent);
  if (change === "detached") removeComponent(f.world, f.actor, HasGoal(parent));
  expect(maintainGoalLifecycles(f.world, f.actor)).toBe(1);
  expect(Goal.status[id]).toBe("retired"); expect(Goal.progress[id]).toBe(0); expect(Plan.status[p]).toBe("retired");
});

test("a paused exploratory child can still retire when its parent is subsequently completed", () => {
  const f = fixture(), parent = authored(f), id = create(f, { supportsGoalId: parent })!;
  attachPlan(f, id, "awaiting_evidence"); maintainGoalLifecycles(f.world, f.actor); expect(Goal.status[id]).toBe("paused");
  Goal.status[parent] = "completed"; maintainGoalLifecycles(f.world, f.actor); expect(Goal.status[id]).toBe("retired");
});

test("direct ECS changes to a parent's contract retire dependent work even if its cached signature was not refreshed", () => {
  const f = fixture(), parent = authored(f), id = create(f, { supportsGoalId: parent })!;
  Goal.successJson[parent] = JSON.stringify({ type: "need_at_least", need: "energy", atLeast: 95 });
  expect(maintainGoalLifecycles(f.world, f.actor)).toBe(1);
  expect(Goal.status[id]).toBe("retired"); expect(Goal.progress[id]).toBe(0);
});

test("a generated child cannot cite a foreign or terminal parent", () => {
  const f = fixture(), parent = authored(f); Goal.status[parent] = "completed";
  expect(create(f, { supportsGoalId: parent })).toBeNull();
  expect(create(f, { supportsGoalId: 999_999 })).toBeNull();
  expect(create(f, { supportsGoalId: 1.5 })).toBeNull();
});

test("recently paused wording is not immediately resurrected with different whitespace", () => {
  const f = fixture(), id = create(f)!; attachPlan(f, id, "awaiting_evidence"); maintainGoalLifecycles(f.world, f.actor);
  expect(create(f, { description: "  INVESTIGATE   THE ROOM  " })).toBeNull();
});

test.each(["inactive", "removed"])("%s actors cannot create generated intentions", change => {
  const f = fixture(); if (change === "inactive") Agent.active[f.actor] = false; else removeEntity(f.world, f.actor);
  expect(create(f)).toBeNull();
});

test.each([{ priority: 0 }, { priority: 11 }, { priority: 4.5 }, { description: " " }, { description: "x".repeat(301) }])("malformed proposal %p is rejected without creating goals", overrides => {
  const f = fixture(); expect(create(f, overrides)).toBeNull(); expect(getRelationTargets(f.world, f.actor, HasGoal)).toHaveLength(0);
});

test.each([null, undefined, [], "not a goal"])("non-object proposal %p fails closed at the model boundary", proposal => {
  const f = fixture();
  expect(() => createGeneratedIntention(f.world, f.actor, proposal as any, "foreground")).not.toThrow();
  expect(createGeneratedIntention(f.world, f.actor, proposal as any, "foreground")).toBeNull();
});
