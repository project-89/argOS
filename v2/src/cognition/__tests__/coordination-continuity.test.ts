import { jest } from "@jest/globals";
import { addComponent, removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Goal, LastAction, Traits } from "../../ecs/components";
import { createSystemRegistry, registerSystem, runSystems } from "../../ecs/dynamic-systems";
import { setLocatedIn } from "../../ecs/location";
import { createIntentGoal, executeActions, completeDeferredAction } from "../cognition-system";
import { createPlanEntity } from "../planning-system";
import { getSocialDialogue } from "../social-memory";
import { getWorkingMemory, workingMemoryEntityRef } from "../working-memory";
import { captureWorkingMemoryObservation } from "../working-memory-observation";
import { applyCoordinationReviews, captureCoordinationWork, getCoordinationGoalRef, getCoordinationMemory, reconcileCoordinationGoals } from "../coordination-memory";
import { registerAgentWorldCapabilities } from "../world-capabilities";
import { setGoalContract } from "../goal-contract";
import { createGoalEvaluationSystem } from "../../systems/builtin-systems";
import { drainPendingStimuli } from "../stimulus-queue";
import type { AgentAction } from "../agent-mind";

const domains = [
  { task: "Deliver the emergency fuel", item: "Fuel can", promise: "I will bring you the emergency fuel." },
  { task: "Bring the clean bandages", item: "Bandage pack", promise: "I will fetch the clean bandages for you." },
];

function fixture(domain = domains[0]) {
  const world = createArgosWorld("Coordination execution"); world.meta.aiEnabled = false; initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Workshop" });
  const remote = createRoomEntity(world, { name: "Store" });
  const make = (name: string, roomId = room) => createAgentEntity(world, { name, role: "resident", systemPrompt: "Act on evidence.", roomId });
  const actor = make("Mara"), listener = make("Ivo"), remoteActor = make("Rook", remote), deaf = make("Sera");
  addComponent(world, deaf, Traits); Traits.active[deaf] = '["deaf"]';
  const item = createObjectEntity(world, { name: domain.item, roomId: room, portable: true });
  const cloth = createObjectEntity(world, { name: "Cleaning cloth", roomId: room, portable: true });
  const registry = createSystemRegistry();
  const execute = (action: AgentAction) => executeActions(world, [{ eid: actor, action }], registry);
  function speech(content: string) {
    execute({ type: "speak", target: "Ivo", content });
    return getSocialDialogue(world, actor).filter(t => t.own).at(-1)!;
  }
  const goal = createIntentGoal(world, actor, domain.task, 8);
  function undertake() {
    const spoken = speech(domain.promise);
    applyCoordinationReviews(world, actor, [{ kind: "undertake", speechId: spoken.id, task: domain.task, goalId: "new", goalRelation: "fulfills" }], { newGoalId: goal });
    return spoken.id;
  }
  function plan(action: AgentAction) {
    return createPlanEntity(world, actor, goal, { goalDescription: domain.task, estimatedCompletion: "short", potentialObstacles: [],
      steps: [{ description: "Fetch the promised supplies", actionType: action.type, target: action.target, content: action.content },
        { description: "Deliver them", actionType: "give", target: "Ivo", content: domain.item }] });
  }
  const memory = (owner = actor) => getCoordinationMemory(world, owner);
  const work = () => captureCoordinationWork(world, actor, memory().items.find(item => item.own)!.id)!;
  return { world, room, remote, actor, listener, remoteActor, deaf, item, cloth, goal, registry, execute, speech, undertake, plan, memory, domain, work };
}

beforeEach(() => {
  drainPendingStimuli();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Coordination integration is offline"));
});
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli(); });

test.each(domains)("$task: committed words create an undertaking, not executed work or remote knowledge", domain => {
  const f = fixture(domain);
  applyCoordinationReviews(f.world, f.actor, [{ kind: "undertake", speechId: "speech:unexecuted-draft", task: domain.task, goalId: f.goal }]);
  expect(f.memory().items).toEqual([]);
  const id = f.undertake();
  expect(f.memory().items).toEqual([expect.objectContaining({ id, task: domain.task, localStatus: "not_started" })]);
  expect(f.memory(f.listener).items).toEqual([expect.objectContaining({ id, task: domain.promise })]);
  expect(JSON.stringify(f.memory(f.listener))).not.toContain(domain.task);
  expect(f.memory(f.listener).items[0]).not.toHaveProperty("localStatus");
  expect(f.memory(f.listener).items[0]).not.toHaveProperty("goal");
  expect(f.memory(f.remoteActor).items).toEqual([]);
  expect(f.memory(f.deaf).items).toEqual([]);
  expect(Goal.status[f.goal]).toBe("active");
});

test.each(domains)("$task: unrelated success is not progress on the promised task", domain => {
  const f = fixture(domain); f.undertake();
  f.execute({ type: "pickup", target: "Cleaning cloth" });
  expect(LastAction.success[f.actor]).toBe(true);
  expect(f.memory().items[0].localStatus).toBe("not_started");
  expect(f.memory(f.listener).items[0]).not.toHaveProperty("localStatus");
});

test.each(domains)("$task: explicit owned undertaking binding credits an actual step without a stored plan", domain => {
  const f = fixture(domain); f.undertake();
  const coordinationGoal = getCoordinationGoalRef(f.world, f.actor, f.goal)!;
  expect(coordinationGoal).toBeDefined();
  f.execute({ type: "pickup", target: domain.item, coordinationGoal, coordinationWork: f.work() });
  expect(LastAction.success[f.actor]).toBe(true);
  expect(f.memory().items[0].localStatus).toBe("in_progress");
  expect(Goal.status[f.goal]).toBe("active");
  expect(f.memory(f.listener).items[0]).not.toHaveProperty("localStatus");
});

test.each(["changed contract", "same-time replacement"])("a foreground binding to a %s goal cannot credit current work", change => {
  jest.spyOn(Date, "now").mockReturnValue(1_000_000);
  const f = fixture(); f.undertake();
  const coordinationGoal = getCoordinationGoalRef(f.world, f.actor, f.goal)!;
  if (change === "changed contract") {
    setGoalContract(f.world, f.goal, { version: 1, kind: "custom", params: {}, success: { type: "in_inventory", itemName: "Cleaning cloth" } });
  } else {
    removeEntity(f.world, f.goal);
    createIntentGoal(f.world, f.actor, f.domain.task, 8);
  }
  f.execute({ type: "pickup", target: f.domain.item, coordinationGoal });
  expect(LastAction.success[f.actor]).toBe(true);
  expect(f.memory().items[0].localStatus).toBe("not_started");
});

test("another actor's valid foreground goal binding cannot attribute my action to their undertaking", () => {
  const f = fixture(); f.undertake();
  const foreignGoal = createIntentGoal(f.world, f.listener, "Fetch the emergency fuel", 8);
  executeActions(f.world, [{ eid: f.listener, action: { type: "speak", target: "Mara", content: "I will fetch the emergency fuel." } }], f.registry);
  const spoken = getSocialDialogue(f.world, f.listener).filter(turn => turn.own).at(-1)!;
  applyCoordinationReviews(f.world, f.listener, [{ kind: "undertake", speechId: spoken.id, task: "Fetch the emergency fuel", goalId: foreignGoal }]);
  const coordinationGoal = getCoordinationGoalRef(f.world, f.listener, foreignGoal)!;
  expect(coordinationGoal).toBeDefined();
  f.execute({ type: "pickup", target: f.domain.item, coordinationGoal });
  expect(LastAction.success[f.actor]).toBe(true);
  expect(f.memory().items.find(item => item.own)?.localStatus).toBe("not_started");
  expect(f.memory(f.listener).items.find(item => item.own)?.localStatus).toBe("not_started");
});

test("explicit foreground work without a stored plan still waits for its actual deferred completion", () => {
  const f = fixture(); f.undertake();
  const action: AgentAction = { type: "pickup", target: f.domain.item, coordinationWork: f.work() };
  const remove = registerAgentWorldCapabilities(f.world, f.actor, { context: () => "", ready: () => true, busy: () => false,
    execute: received => { action.executionId = received.executionId; return true; } });
  try {
    f.execute(action);
    expect(f.memory().items[0].localStatus).toBe("not_started");
    completeDeferredAction(f.world, f.actor, { type: "pickup", target: "Cleaning cloth" }, true, "Another action completed.");
    expect(f.memory().items[0].localStatus).toBe("not_started");
    completeDeferredAction(f.world, f.actor, action, true, "The promised fuel pickup completed.");
    expect(f.memory().items[0].localStatus).toBe("in_progress");
    expect(Goal.status[f.goal]).toBe("active");
  } finally { remove(); }
});

test.each(domains)("$task: a matched actual step starts work but cannot certify delivery", domain => {
  const f = fixture(domain); f.undertake();
  const action: AgentAction = { type: "pickup", target: domain.item, coordinationWork: f.work() }; f.plan(action); f.execute(action);
  expect(LastAction.success[f.actor]).toBe(true);
  expect(f.memory().items[0].localStatus).toBe("in_progress");
  expect(Goal.status[f.goal]).toBe("active");
  expect(f.memory(f.listener).items[0]).not.toHaveProperty("localStatus");
  reconcileCoordinationGoals(f.world, f.actor);
  expect(f.memory().items[0].localStatus).toBe("in_progress");
});

test("a genuinely completed native goal settles the actor's work without broadcasting private proof", () => {
  const f = fixture({ task: "Fetch the emergency fuel", item: "Fuel can", promise: "I will fetch the emergency fuel." });
  setGoalContract(f.world, f.goal, { version: 1, kind: "custom", params: {}, success: { type: "in_inventory", itemName: f.domain.item } });
  f.undertake();
  const action: AgentAction = { type: "pickup", target: f.domain.item }; f.plan(action);
  const evaluator = createGoalEvaluationSystem(); evaluator.frequency = 0; registerSystem(f.registry, evaluator);
  f.execute(action); runSystems(f.world, f.registry, 1, 1000);
  expect(Goal.status[f.goal]).toBe("completed");
  reconcileCoordinationGoals(f.world, f.actor);
  expect(f.memory().items[0].localStatus).toBe("verified_done");
  expect(f.memory(f.listener).items[0].lastReported.status).toBe("not_started");
  expect(f.memory(f.listener).items[0]).not.toHaveProperty("localEvidence");
});

test("failed work and its blocker remain private until an actual audible report", () => {
  const f = fixture(), id = f.undertake();
  const action: AgentAction = { type: "pickup", target: f.domain.item }; f.plan(action);
  setLocatedIn(f.world, f.item, f.remote); f.execute(action);
  expect(LastAction.success[f.actor]).toBe(false);
  const evidence = getWorkingMemory(f.world, f.actor).receipts.filter(r => r.kind === "action" && r.succeeded === false).at(-1)!;
  expect(evidence).toBeDefined();
  applyCoordinationReviews(f.world, f.actor, [{ kind: "blocked", id, reason: "The promised supply is not accessible here.", evidenceIds: [evidence.id] }]);
  expect(f.memory().items[0].localStatus).toBe("blocked");
  expect(JSON.stringify(f.memory(f.listener))).not.toContain("The promised supply is not accessible here.");
  const before = f.memory(f.listener);
  applyCoordinationReviews(f.world, f.actor, [{ kind: "report", id, speechId: "speech:unsent-report", status: "blocked" }]);
  expect(f.memory(f.listener)).toEqual(before);
  const report = f.speech("I cannot get the fuel here. I need help finding it.");
  applyCoordinationReviews(f.world, f.actor, [{ kind: "report", id, speechId: report.id, status: "blocked" }]);
  expect(f.memory(f.listener).items[0].lastReported).toMatchObject({ status: "blocked" });
  expect(f.memory(f.listener).items[0]).not.toHaveProperty("localStatus");
  expect(f.memory(f.remoteActor).items).toEqual([]);
  expect(f.memory(f.deaf).items).toEqual([]);
  expect(Goal.status[f.goal]).toBe("active");
});

test("a spoken completion report remains a claim and cannot finish an unexecuted goal", () => {
  const f = fixture(), id = f.undertake();
  const report = f.speech("The fuel is delivered.");
  applyCoordinationReviews(f.world, f.actor, [{ kind: "report", id, speechId: report.id, status: "completed" }]);
  reconcileCoordinationGoals(f.world, f.actor);
  expect(f.memory().items[0].localStatus).toBe("not_started");
  expect(f.memory(f.listener).items[0].lastReported).toMatchObject({ status: "completed" });
  expect(Goal.status[f.goal]).toBe("active");
  expect(Goal.progress[f.goal]).toBeLessThan(100);
});

test("listeners who miss a later update retain only the original promise", () => {
  const f = fixture();
  setLocatedIn(f.world, f.remoteActor, f.room); Traits.active[f.deaf] = "[]";
  const id = f.undertake();
  expect(f.memory(f.remoteActor).items[0].lastReported.status).toBe("not_started");
  expect(f.memory(f.deaf).items[0].lastReported.status).toBe("not_started");
  setLocatedIn(f.world, f.remoteActor, f.remote); Traits.active[f.deaf] = '["deaf"]';
  applyCoordinationReviews(f.world, f.actor, [{ kind: "release", id, reason: "I have withdrawn from the delivery." }]);
  const report = f.speech("I am no longer handling the delivery. Please find someone else.");
  // The review is retrospective: Ivo still heard it even if he leaves before
  // semantic interpretation. Presence at review time must not substitute for hearing.
  setLocatedIn(f.world, f.listener, f.remote);
  applyCoordinationReviews(f.world, f.actor, [{ kind: "report", id, speechId: report.id, status: "released" }]);
  expect(f.memory(f.listener).items[0].lastReported.status).toBe("released");
  expect(f.memory(f.remoteActor).items[0].lastReported.status).toBe("not_started");
  expect(f.memory(f.deaf).items[0].lastReported.status).toBe("not_started");
  expect(f.memory(f.listener).items[0]).not.toHaveProperty("localStatus");
});

test.each([true, false])("deferred work gets no progress until the matching completion (success=%s)", success => {
  const f = fixture(); f.undertake();
  const action: AgentAction = { type: "pickup", target: f.domain.item, coordinationWork: f.work() }; f.plan(action);
  const remove = registerAgentWorldCapabilities(f.world, f.actor, { context: () => "", ready: () => true, busy: () => false,
    execute: received => { action.executionId = received.executionId; return true; } });
  try {
    f.execute(action);
    expect(f.memory().items[0].localStatus).toBe("not_started");
    completeDeferredAction(f.world, f.actor, { type: "pickup", target: "Cleaning cloth" }, true, "Unrelated callback.");
    expect(f.memory().items[0].localStatus).toBe("not_started");
    completeDeferredAction(f.world, f.actor, action, success, success ? "The fuel was picked up." : "The supply is no longer accessible.");
    expect(f.memory().items[0].localStatus).toBe(success ? "in_progress" : "blocked");
    expect(Goal.status[f.goal]).toBe("active");
    const completed = f.memory();
    completeDeferredAction(f.world, f.actor, action, success, "Duplicate callback.");
    expect(f.memory()).toEqual(completed);
  } finally { remove(); }
});

test("work issued before a new undertaking cannot credit that later undertaking", () => {
  // Issuance and later speech can share the same wall-clock millisecond.
  jest.spyOn(Date, "now").mockReturnValue(1_000_000);
  const f = fixture();
  const action: AgentAction = { type: "pickup", target: f.domain.item }; f.plan(action);
  const remove = registerAgentWorldCapabilities(f.world, f.actor, { context: () => "", ready: () => true, busy: () => false,
    execute: received => { if (received.type === "speak") return false; action.executionId = received.executionId; return true; } });
  try {
    f.execute(action); f.undertake();
    completeDeferredAction(f.world, f.actor, action, true, "Earlier work completed.");
    expect(f.memory().items[0].localStatus).toBe("not_started");
  } finally { remove(); }
});

test("a pending result cannot credit a changed undertaking declaration", () => {
  const f = fixture(); const id = f.undertake();
  const action: AgentAction = { type: "pickup", target: f.domain.item, coordinationWork: f.work() }; f.plan(action);
  const remove = registerAgentWorldCapabilities(f.world, f.actor, { context: () => "", ready: () => true, busy: () => false,
    execute: received => { action.executionId = received.executionId; return true; } });
  try {
    f.execute(action);
    setGoalContract(f.world, f.goal, { version: 1, kind: "custom", params: {}, success: { type: "in_inventory", itemName: "Cleaning cloth" } });
    applyCoordinationReviews(f.world, f.actor, [{ kind: "link", id, goalId: f.goal }]);
    completeDeferredAction(f.world, f.actor, action, true, "The originally issued pickup completed.");
    expect(f.memory().items[0].localStatus).toBe("not_started");
    expect(Goal.status[f.goal]).toBe("active");
  } finally { remove(); }
});

test("a result finishing after the actor releases the undertaking cannot reactivate it", () => {
  const f = fixture(), id = f.undertake();
  const action: AgentAction = { type: "pickup", target: f.domain.item, coordinationWork: f.work() }; f.plan(action);
  const remove = registerAgentWorldCapabilities(f.world, f.actor, { context: () => "", ready: () => true, busy: () => false,
    execute: received => { action.executionId = received.executionId; return true; } });
  try {
    f.execute(action);
    applyCoordinationReviews(f.world, f.actor, [{ kind: "release", id, reason: "I have handed responsibility back." }]);
    completeDeferredAction(f.world, f.actor, action, true, "The older action finally completed.");
    expect(f.memory().items[0].localStatus).toBe("released");
    expect(Goal.status[f.goal]).toBe("active");
  } finally { remove(); }
});

test("a native action verifies its exact declared promise, without contaminating another task under the same goal", () => {
  const f = fixture(); captureWorkingMemoryObservation(f.world, f.actor);
  const source = f.speech("I will pick up the fuel can."), other = f.speech("I will inspect the store.");
  applyCoordinationReviews(f.world, f.actor, [
    { kind: "undertake", speechId: source.id, task: "Pick up fuel", goalId: f.goal,
      completion: { type: "action", actionType: "pickup", target: f.domain.item } },
    { kind: "undertake", speechId: other.id, task: "Inspect the store", goalId: f.goal },
  ]);
  f.execute({ type: "pickup", target: f.domain.item, coordinationWork: captureCoordinationWork(f.world, f.actor, source.id) });
  expect(f.memory().items.find(item => item.id === source.id)?.localStatus).toBe("verified_done");
  f.execute({ type: "pickup", target: "Missing item", coordinationGoal: getCoordinationGoalRef(f.world, f.actor, f.goal) });
  expect(f.memory().items.find(item => item.id === source.id)?.localStatus).toBe("verified_done");
  expect(f.memory().items.find(item => item.id === other.id)?.localStatus).toBe("not_started");
  expect(Goal.status[f.goal]).toBe("active");
});

test("a same-named replacement object cannot satisfy the originally grounded action criterion", () => {
  const f = fixture(); captureWorkingMemoryObservation(f.world, f.actor);
  const source = f.speech("I will pick up the fuel can.");
  applyCoordinationReviews(f.world, f.actor, [{ kind: "undertake", speechId: source.id, task: "Pick up that fuel can",
    completion: { type: "action", actionType: "pickup", target: f.domain.item } }]);
  const coordinationWork = captureCoordinationWork(f.world, f.actor, source.id);
  removeEntity(f.world, f.item);
  createObjectEntity(f.world, { name: f.domain.item, roomId: f.room, portable: true });
  f.execute({ type: "pickup", target: f.domain.item, coordinationWork });
  expect(LastAction.success[f.actor]).toBe(true);
  expect(f.memory().items.find(item => item.id === source.id)?.localStatus).toBe("in_progress");
});

test.each([false, true])("deferred terminal proof needs the package's actual target identity (provided=%s)", proof => {
  const f = fixture(); captureWorkingMemoryObservation(f.world, f.actor);
  const source = f.speech("I will pick up the fuel can.");
  applyCoordinationReviews(f.world, f.actor, [{ kind: "undertake", speechId: source.id, task: "Pick up fuel",
    completion: { type: "action", actionType: "pickup", target: f.domain.item } }]);
  const action: AgentAction = { type: "pickup", target: f.domain.item, coordinationWork: captureCoordinationWork(f.world, f.actor, source.id) };
  const remove = registerAgentWorldCapabilities(f.world, f.actor, { context: () => "", ready: () => true, busy: () => false,
    execute: received => { action.executionId = received.executionId; return true; } });
  try {
    f.execute(action);
    expect(f.memory().items.find(item => item.id === source.id)?.localStatus).toBe("not_started");
    setLocatedIn(f.world, f.item, f.actor);
    completeDeferredAction(f.world, f.actor, action, true, "Pickup completed.", proof ? { targetKey: workingMemoryEntityRef(f.world, f.item)!.key } : undefined);
    expect(f.memory().items.find(item => item.id === source.id)?.localStatus).toBe(proof ? "verified_done" : "in_progress");
  } finally { remove(); }
});
