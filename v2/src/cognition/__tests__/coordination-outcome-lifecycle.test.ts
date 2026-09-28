import { jest } from "@jest/globals";
import { addComponent, addEntity, entityExists, removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { CoordinationMemory, Goal, ObjectState } from "../../ecs/components";
import { HasGoal } from "../../ecs/relations";
import { setLocatedIn } from "../../ecs/location";
import { createSystemRegistry, runSystems } from "../../ecs/dynamic-systems";
import { createGoalCleanupSystem, createGoalEvaluationSystem } from "../../systems/builtin-systems";
import { deserializeWorld, serializeWorld } from "../../persistence/world-persistence";
import { setGoalContract } from "../goal-contract";
import { recordCommittedSpeech } from "../social-memory";
import { captureWorkingMemoryObservation, consumeWorkingMemoryObservation } from "../working-memory-observation";
import { getWorkingMemory, recordWorkingMemoryEvidence } from "../working-memory";
import { applyCoordinationReviews, captureCoordinationAction, captureCoordinationWork, formatCoordinationContext, getCoordinationMemory,
  hasCoordinationCommunicationGap, reconcileCoordinationGoals, recordCoordinationAction } from "../coordination-memory";
import { coordinationDependency } from "../coordination-memory-dependencies";
import { copyActorGoalCondition } from "../actor-goal-evidence";

const EPOCH = 1_700_000_000_000;
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(EPOCH); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Outcome tests stay offline.")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); jest.useRealTimers(); });

function fixture(hidden = false) {
  const world = createArgosWorld("Outcome provenance"); world.meta.aiEnabled = false; initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Control room" }), remote = createRoomEntity(world, { name: "Machine room" });
  const actor = createAgentEntity(world, { name: "Ada", role: "engineer", systemPrompt: "Use evidence.", roomId: room });
  const listener = createAgentEntity(world, { name: "Lin", role: "operator", systemPrompt: "Use evidence.", roomId: room });
  const target = createObjectEntity(world, { name: "Indicator", roomId: remote });
  addComponent(world, target, ObjectState); ObjectState.current[target] = "off";
  function goal() {
    const id = addEntity(world); addComponent(world, id, Goal); addComponent(world, actor, HasGoal(id));
    Goal.description[id] = "Restore the indicator"; Goal.status[id] = "active"; Goal.createdAt[id] = Date.now(); Goal.priority[id] = 8; Goal.deadline[id] = 0;
    setGoalContract(world, id, { version: 1, kind: "custom", params: {}, success: hidden
      ? { type: "entity_component_equals", entityName: "Indicator", component: "PrivateCircuit", field: "energized", equals: true }
      : { type: "entity_component_equals", entityName: "Indicator", component: "ObjectState", field: "current", equals: "on" } });
    return id;
  }
  const g = goal(), source = recordCommittedSpeech(world, actor, "I will restore the indicator.", "Lin")!;
  applyCoordinationReviews(world, actor, [{ kind: "undertake", speechId: source.id, task: "Restore the indicator", goalId: g, goalRelation: "fulfills" }]);
  const registry = createSystemRegistry(), cleanup = createGoalCleanupSystem(); cleanup.frequency = 0; registry.systems.set(cleanup.name, cleanup);
  const at = (ms: number) => jest.setSystemTime(EPOCH + ms);
  const runCleanup = (ms: number) => {
    at(ms); advanceSimulationTime(world, world.time.tick + 1, ms - world.time.elapsed);
    runSystems(world, registry, world.time.tick, 500);
  };
  const observe = (ms: number) => { at(ms); setLocatedIn(world, actor, remote); captureWorkingMemoryObservation(world, actor); };
  const memory = (who = actor) => getCoordinationMemory(world, who);
  return { world, actor, listener, target, room, remote, goal, g, id: source.id, registry, at, runCleanup, observe, memory };
}

test("losing a tracked goal preserves private blocker and permits an explicit new approach", () => {
  const f = fixture(); f.at(1);
  recordWorkingMemoryEvidence(f.world, f.actor, { id: "observed-blocker", kind: "observation", provenance: "own_observation", atMs: Date.now(), summary: "The necessary control is inaccessible.", facts: [] });
  applyCoordinationReviews(f.world, f.actor, [{ kind: "blocked", id: f.id, reason: "The control is inaccessible.", evidenceIds: ["observed-blocker"] }]);
  const before = f.memory().items[0]; removeEntity(f.world, f.g); reconcileCoordinationGoals(f.world, f.actor);
  const after = f.memory().items[0];
  expect(after.localStatus).toBe("blocked"); expect(after.localReason).toBe(before.localReason); expect(after.localEvidence).toEqual(before.localEvidence);
  expect(after.localVersion).toBe(before.localVersion); expect(after.goalTracking).toMatchObject({ status: "ended" });
  const replacement = f.goal();
  expect(applyCoordinationReviews(f.world, f.actor, [{ kind: "link", id: f.id, goalId: replacement }])).toBe(1);
  expect(f.memory().items[0].goalTracking).toBeUndefined(); expect(f.memory().items[0].localStatus).toBe("not_started");
  const work = captureCoordinationAction(f.world, f.actor, captureCoordinationWork(f.world, f.actor, f.id)!, { type: "interact", target: "Indicator" })!;
  expect(recordCoordinationAction(f.world, f.actor, work, { succeeded: true })).toBe(1);
});

test.each(["failed", "expired", "retired"])("a %s intention does not make an actor withdraw or invent a progress report", status => {
  const f = fixture(); Goal.status[f.g] = status;
  reconcileCoordinationGoals(f.world, f.actor);
  expect(f.memory().items[0].localStatus).toBe("not_started");
  expect(hasCoordinationCommunicationGap(f.memory().items[0])).toBe(false);
  expect(f.memory(f.listener).items[0]).not.toHaveProperty("goalTracking");
  expect(reconcileCoordinationGoals(f.world, f.actor)).toBe(0);
});

test("real evaluator completion survives goal cleanup, but becomes known only after own later perception", () => {
  const f = fixture(); f.at(10); ObjectState.current[f.target] = "on";
  const evaluate = createGoalEvaluationSystem(); evaluate.frequency = 0; f.registry.systems.set(evaluate.name, evaluate);
  runSystems(f.world, f.registry, 1, 500); expect(Goal.status[f.g]).toBe("completed");
  f.registry.systems.delete(evaluate.name);
  f.runCleanup(20); f.runCleanup(60_020);
  expect(entityExists(f.world, f.g)).toBe(false);
  expect(f.memory().items[0].localStatus).toBe("not_started");
  expect(f.memory().items[0].pendingGoalProof).toBeDefined();
  expect(formatCoordinationContext(f.world, f.actor)).not.toContain("engine verdict");
  expect(JSON.stringify(f.memory(f.listener))).not.toContain("pendingGoalProof");
  f.observe(60_021); expect(reconcileCoordinationGoals(f.world, f.actor)).toBe(1);
  expect(f.memory().items[0].localStatus).toBe("verified_done");
  expect(f.memory().items[0].pendingGoalProof).toBeUndefined();
});

test("a matching observation from before completion cannot certify a later state cycle", () => {
  const f = fixture(); ObjectState.current[f.target] = "on"; f.observe(1);
  setLocatedIn(f.world, f.actor, f.room); ObjectState.current[f.target] = "off";
  f.at(10); Goal.status[f.g] = "completed"; reconcileCoordinationGoals(f.world, f.actor);
  expect(f.memory().items[0].localStatus).toBe("not_started");
  removeEntity(f.world, f.g); f.observe(11); reconcileCoordinationGoals(f.world, f.actor);
  expect(f.memory().items[0].localStatus).toBe("not_started");
  ObjectState.current[f.target] = "on"; f.observe(12); reconcileCoordinationGoals(f.world, f.actor);
  expect(f.memory().items[0].localStatus).toBe("verified_done");
});

test("fractional same-millisecond observations cannot cross a later completion fence", () => {
  const f = fixture(); ObjectState.current[f.target] = "on"; f.observe(1);
  captureWorkingMemoryObservation(f.world, f.actor);
  expect(Math.max(...getWorkingMemory(f.world, f.actor).facts.map(fact => fact.observedAt))).toBeGreaterThanOrEqual(Date.now());
  setLocatedIn(f.world, f.actor, f.room); ObjectState.current[f.target] = "off";
  Goal.status[f.g] = "completed"; reconcileCoordinationGoals(f.world, f.actor);
  expect(f.memory().items[0].localStatus).toBe("not_started");
  const proof = f.memory().items[0].pendingGoalProof!;
  expect(proof.afterMs).toBeGreaterThan(Math.max(...getWorkingMemory(f.world, f.actor).facts.map(fact => fact.observedAt)));
  f.at(2); reconcileCoordinationGoals(f.world, f.actor, captureWorkingMemoryObservation(f.world, f.actor));
  expect(f.memory().items[0].localStatus).toBe("not_started");
});

test("continuous current perception verifies success without a thirty-second receipt refresh or revision churn", () => {
  const f = fixture(); ObjectState.current[f.target] = "on"; f.observe(1);
  const stored = getWorkingMemory(f.world, f.actor); f.at(2); Goal.status[f.g] = "completed";
  reconcileCoordinationGoals(f.world, f.actor); expect(f.memory().items[0].localStatus).toBe("not_started");
  f.at(3); const current = captureWorkingMemoryObservation(f.world, f.actor)!;
  expect(getWorkingMemory(f.world, f.actor)).toEqual(stored);
  expect(Object.isFrozen(current)).toBe(true); expect(Object.isFrozen(current.facts)).toBe(true); expect(current.facts.every(Object.isFrozen)).toBe(true);
  expect(reconcileCoordinationGoals(f.world, f.actor, current)).toBe(1);
  expect(f.memory().items[0].localStatus).toBe("verified_done");
  expect(getWorkingMemory(f.world, f.actor)).toEqual(stored);
});

test("an old, foreign, forged or already-consumed perception token cannot become fresh personal evidence", () => {
  const f = fixture(); ObjectState.current[f.target] = "on"; f.observe(1);
  const old = captureWorkingMemoryObservation(f.world, f.actor)!;
  f.at(10); Goal.status[f.g] = "completed"; reconcileCoordinationGoals(f.world, f.actor, old);
  expect(f.memory().items[0].localStatus).toBe("not_started");
  const fresh = captureWorkingMemoryObservation(f.world, f.actor)!;
  const otherWorld = createArgosWorld("Not this world");
  expect(consumeWorkingMemoryObservation(otherWorld, f.actor, fresh)).toEqual([]);
  expect(consumeWorkingMemoryObservation(f.world, f.listener, fresh)).toEqual([]);
  expect(consumeWorkingMemoryObservation(f.world, f.actor, { ...fresh })).toEqual([]);
  expect(consumeWorkingMemoryObservation(f.world, f.actor, fresh).length).toBeGreaterThan(0);
  expect(consumeWorkingMemoryObservation(f.world, f.actor, fresh)).toEqual([]);
  reconcileCoordinationGoals(f.world, f.actor, fresh); expect(f.memory().items[0].localStatus).toBe("not_started");
});

test("new unseen observation supersedes an older visible snapshot without filling a remote knowledge gap", () => {
  const f = fixture(); ObjectState.current[f.target] = "on"; f.observe(1);
  const old = captureWorkingMemoryObservation(f.world, f.actor)!;
  setLocatedIn(f.world, f.actor, f.room); f.at(10); Goal.status[f.g] = "completed";
  const current = captureWorkingMemoryObservation(f.world, f.actor)!;
  expect(consumeWorkingMemoryObservation(f.world, f.actor, old)).toEqual([]);
  reconcileCoordinationGoals(f.world, f.actor, current);
  expect(f.memory().items[0].localStatus).toBe("not_started");
});

test.each(["newer", "same-time"])("a current perception token cannot overwrite a %s conflicting receipt", timing => {
  const f = fixture(); f.at(10); Goal.status[f.g] = "completed"; reconcileCoordinationGoals(f.world, f.actor);
  ObjectState.current[f.target] = "on"; f.observe(20);
  const current = captureWorkingMemoryObservation(f.world, f.actor)!;
  const seen = current.facts.find(fact => fact.subjectLabel === "Indicator" && fact.predicate === "state")!;
  ObjectState.current[f.target] = "off"; f.at(21);
  recordWorkingMemoryEvidence(f.world, f.actor, { id: "newer-conflicting-receipt", atMs: timing === "same-time" ? seen.observedAt : Date.now(),
    kind: "observation", provenance: "own_observation", summary: "The indicator went off.",
    facts: [{ subject: seen.subject, subjectLabel: seen.subjectLabel, predicate: "state", slot: seen.slot, value: "off" }] });
  reconcileCoordinationGoals(f.world, f.actor, current);
  expect(f.memory().items[0].localStatus).toBe("not_started");
});

test("a visible label never maps itself to an unsupported hidden completion field", () => {
  const f = fixture(true); Goal.status[f.g] = "completed"; ObjectState.current[f.target] = "on";
  f.observe(1); reconcileCoordinationGoals(f.world, f.actor); f.runCleanup(2); f.runCleanup(60_002);
  expect(f.memory().items[0].localStatus).toBe("not_started");
  expect(f.memory().items[0].pendingGoalProof).toBeUndefined();
  expect(formatCoordinationContext(f.world, f.actor)).not.toContain("PrivateCircuit");
});

test.each(["actor", "container"])("a %s sharing a room's name cannot counterfeit a placement outcome", kind => {
  const f = fixture();
  setGoalContract(f.world, f.g, { version: 1, kind: "custom", params: {}, success: { type: "entity_in_room", entityName: "Indicator", roomName: "Control room", uncarried: true } });
  applyCoordinationReviews(f.world, f.actor, [{ kind: "link", id: f.id, goalId: f.g }]);
  setLocatedIn(f.world, f.target, f.room); captureWorkingMemoryObservation(f.world, f.actor);
  f.at(10); Goal.status[f.g] = "completed"; reconcileCoordinationGoals(f.world, f.actor); removeEntity(f.world, f.g);
  const impostor = kind === "actor"
    ? createAgentEntity(f.world, { name: "Control room", role: "visitor", systemPrompt: "Use evidence.", roomId: f.remote })
    : createObjectEntity(f.world, { name: "Control room", roomId: f.remote });
  setLocatedIn(f.world, f.target, impostor); f.observe(11);
  // A transfer recipient is tactile knowledge; it need not be visually open.
  const targetRef = getWorkingMemory(f.world, f.actor).facts.find(fact => fact.subjectLabel === "Indicator")!;
  const destination = captureWorkingMemoryObservation(f.world, f.actor)!.facts.find(fact => fact.subjectLabel === "Control room" && fact.predicate === "location")!;
  recordWorkingMemoryEvidence(f.world, f.actor, { id: "actual-transfer", atMs: Date.now() + 0.1, kind: "action", provenance: "witnessed_action", succeeded: true,
    summary: "The object was placed with a recipient named Control room.", facts: [{ subject: targetRef.subject, subjectLabel: "Indicator", predicate: "location", value: destination.subject, valueLabel: "Control room" }] });
  reconcileCoordinationGoals(f.world, f.actor);
  expect(f.memory().items[0].localStatus).toBe("not_started");
  setLocatedIn(f.world, f.target, f.room); setLocatedIn(f.world, f.actor, f.room); f.at(12);
  reconcileCoordinationGoals(f.world, f.actor, captureWorkingMemoryObservation(f.world, f.actor));
  expect(f.memory().items[0].localStatus).toBe("verified_done");
});

test("retained proof survives remapped save/restore without the original Goal entity", () => {
  const f = fixture(); f.at(10); Goal.status[f.g] = "completed"; reconcileCoordinationGoals(f.world, f.actor); removeEntity(f.world, f.g);
  const saved = JSON.parse(JSON.stringify(serializeWorld(f.world, f.registry)));
  const world = createArgosWorld("Restored proof"); world.meta.aiEnabled = false; initializePrefabs(world);
  for (let i = 0; i < 12; i++) addEntity(world);
  const { oldToNewId } = deserializeWorld(world, createSystemRegistry(), saved);
  const actor = oldToNewId.get(f.actor)!, target = oldToNewId.get(f.target)!;
  expect(actor).not.toBe(f.actor); expect(getCoordinationMemory(world, actor).items[0].localStatus).toBe("not_started");
  f.at(11); ObjectState.current[target] = "on"; setLocatedIn(world, actor, oldToNewId.get(f.remote)!); captureWorkingMemoryObservation(world, actor);
  reconcileCoordinationGoals(world, actor); expect(getCoordinationMemory(world, actor).items[0].localStatus).toBe("verified_done");
});

test("an explicit new intention discards the earlier completion gate", () => {
  const f = fixture(); f.at(10); Goal.status[f.g] = "completed"; reconcileCoordinationGoals(f.world, f.actor); removeEntity(f.world, f.g);
  const next = f.goal(); applyCoordinationReviews(f.world, f.actor, [{ kind: "link", id: f.id, goalId: next }]);
  ObjectState.current[f.target] = "on"; f.observe(11); reconcileCoordinationGoals(f.world, f.actor);
  expect(f.memory().items[0].pendingGoalProof).toBeUndefined(); expect(f.memory().items[0].localStatus).toBe("not_started");
  expect(Goal.status[next]).toBe("active");
});

test("only dependent decisions see tracking loss; private completion gate never enters dependency context", () => {
  const f = fixture(), before = f.memory(), scope = { itemIds: [f.id] };
  Goal.status[f.g] = "completed"; reconcileCoordinationGoals(f.world, f.actor); const after = f.memory();
  expect(coordinationDependency(before, scope)).not.toBe(coordinationDependency(after, scope));
  expect(coordinationDependency(before, { references: ["unrelated task"] })).toBe(coordinationDependency(after, { references: ["unrelated task"] }));
  const dependency = coordinationDependency(after, scope); delete after.items[0].pendingGoalProof;
  expect(coordinationDependency(after, scope)).toBe(dependency);
  expect(dependency).not.toContain("ObjectState");
});

test("condition retention is bounded and strips non-schema data", () => {
  const leaf = { type: "in_room", roomName: "Control room" };
  expect(copyActorGoalCondition({ ...leaf, secret: "do not retain me" })).toEqual(leaf);
  expect(copyActorGoalCondition({ type: "all_of", conditions: Array(12).fill({ type: "all_of", conditions: Array(12).fill(leaf) }) })).toBeUndefined();
  expect(copyActorGoalCondition({ type: "all_of", conditions: [leaf, { type: "custom", description: "model claim" }] })).toBeUndefined();
  expect(copyActorGoalCondition({ type: "any_of", conditions: [leaf, { type: "custom", description: "unknown alternative" }] }))
    .toEqual({ type: "any_of", conditions: [leaf] });
});

test("malformed retained proof cannot be read as a trusted owner record", () => {
  const f = fixture(), item = f.memory().items[0];
  (item as any).pendingGoalProof = { afterMs: Date.now(), condition: { type: "custom", description: "Done because I said so" } };
  CoordinationMemory.itemsJson[f.actor] = JSON.stringify([item]); expect(f.memory().items).toEqual([]);
});
