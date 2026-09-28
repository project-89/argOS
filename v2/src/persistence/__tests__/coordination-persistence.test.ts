import { jest } from "@jest/globals";
import { addEntity, removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Goal } from "../../ecs/components";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { createIntentGoal, executeActions } from "../../cognition/cognition-system";
import { getSocialDialogue } from "../../cognition/social-memory";
import { setGoalContract } from "../../cognition/goal-contract";
import { applyCoordinationReviews, getCoordinationMemory, reconcileCoordinationGoals } from "../../cognition/coordination-memory";
import { drainPendingStimuli } from "../../cognition/stimulus-queue";
import { deserializeWorld, serializeWorld, type SerializedWorld } from "../world-persistence";

function fixture() {
  const world = createArgosWorld("Coordination persistence"); world.meta.aiEnabled = false; initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Workshop" });
  const actor = createAgentEntity(world, { name: "Resident", role: "repairer", systemPrompt: "Private first resident", roomId: room });
  const listener = createAgentEntity(world, { name: "Helper", role: "helper", systemPrompt: "Private helper", roomId: room });
  const sameName = createAgentEntity(world, { name: "Resident", role: "helper", systemPrompt: "Private second resident", roomId: room });
  const goal = createIntentGoal(world, actor, "Deliver emergency fuel", 8), registry = createSystemRegistry();
  executeActions(world, [{ eid: actor, action: { type: "speak", target: "Helper", content: "I will bring the emergency fuel." } }], registry);
  const spoken = getSocialDialogue(world, actor).filter(t => t.own).at(-1)!;
  applyCoordinationReviews(world, actor, [{ kind: "undertake", speechId: spoken.id, task: "Deliver emergency fuel", goalId: goal }]);
  const save = () => JSON.parse(JSON.stringify(serializeWorld(world, registry))) as SerializedWorld;
  return { world, actor, listener, sameName, goal, id: spoken.id, registry, save };
}
function restore(data: SerializedWorld) {
  const world = createArgosWorld("Coordination restored"); world.meta.aiEnabled = false; initializePrefabs(world);
  for (let i = 0; i < 12; i++) addEntity(world);
  const registry = createSystemRegistry();
  return { world, registry, ...deserializeWorld(world, registry, data) };
}
beforeEach(() => { drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Coordination persistence stays offline")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli(); });

test("remapped checkpoint preserves a private owner record and distinct attributed listener copies", () => {
  const f = fixture();
  const before = getCoordinationMemory(f.world, f.actor), heard = getCoordinationMemory(f.world, f.listener);
  expect(before.items).toHaveLength(1);
  const r = restore(f.save()), actor = r.oldToNewId.get(f.actor)!, listener = r.oldToNewId.get(f.listener)!;
  const sameName = r.oldToNewId.get(f.sameName)!, goal = r.oldToNewId.get(f.goal)!;
  expect(actor).not.toBe(f.actor); expect(goal).not.toBe(f.goal);
  expect(getCoordinationMemory(r.world, actor)).toEqual(before);
  expect(getCoordinationMemory(r.world, listener)).toEqual(heard);
  expect(getCoordinationMemory(r.world, sameName).items[0]).not.toHaveProperty("localStatus");
  reconcileCoordinationGoals(r.world, actor);
  expect(getCoordinationMemory(r.world, actor).items[0].localStatus).toBe("not_started");
  expect(Goal.status[goal]).toBe("active");
});

test("goal deletion does not erase or complete an outstanding undertaking", () => {
  const f = fixture(); removeEntity(f.world, f.goal);
  reconcileCoordinationGoals(f.world, f.actor);
  const before = getCoordinationMemory(f.world, f.actor);
  expect(before.items).toHaveLength(1);
  expect(before.items[0].localStatus).not.toBe("verified_done");
  const r = restore(f.save()), actor = r.oldToNewId.get(f.actor)!;
  expect(getCoordinationMemory(r.world, actor)).toEqual(before);
  const replacement = createIntentGoal(r.world, actor, "Deliver emergency fuel", 8);
  Goal.status[replacement] = "completed"; Goal.progress[replacement] = 100;
  reconcileCoordinationGoals(r.world, actor);
  expect(getCoordinationMemory(r.world, actor).items[0].localStatus).not.toBe("verified_done");
});

test("an identical replacement goal at the same timestamp is not the original promised work", () => {
  jest.spyOn(Date, "now").mockReturnValue(1_000_000);
  const f = fixture(), originalCreatedAt = Goal.createdAt[f.goal];
  const contract = { version: 1 as const, kind: "move_to_room" as const, params: { roomName: "Workshop" },
    success: { type: "in_room" as const, roomName: "Workshop" } };
  setGoalContract(f.world, f.goal, contract);
  applyCoordinationReviews(f.world, f.actor, [{ kind: "link", id: f.id, goalId: f.goal }]);
  removeEntity(f.world, f.goal);
  const replacement = createIntentGoal(f.world, f.actor, "Deliver emergency fuel", 8);
  setGoalContract(f.world, replacement, contract);
  expect(Goal.createdAt[replacement]).toBe(originalCreatedAt);
  Goal.status[replacement] = "completed"; Goal.progress[replacement] = 100;
  const r = restore(f.save()), actor = r.oldToNewId.get(f.actor)!;
  reconcileCoordinationGoals(r.world, actor);
  expect(getCoordinationMemory(r.world, actor).items[0].localStatus).not.toBe("verified_done");
});

test("released work survives goal cleanup without telling the other actor it was completed", () => {
  const f = fixture();
  applyCoordinationReviews(f.world, f.actor, [{ kind: "release", id: f.id, reason: "I have withdrawn from this task." }]);
  removeEntity(f.world, f.goal); reconcileCoordinationGoals(f.world, f.actor);
  const r = restore(f.save()), actor = r.oldToNewId.get(f.actor)!, listener = r.oldToNewId.get(f.listener)!;
  expect(getCoordinationMemory(r.world, actor).items[0].localStatus).toBe("released");
  expect(JSON.stringify(getCoordinationMemory(r.world, listener))).not.toContain("withdrawn");
  expect(getCoordinationMemory(r.world, listener).items[0]).not.toHaveProperty("localStatus");
});

test.each(["foreign_owner", "missing_identity"])("a checkpoint's %s memory cannot become the restored actor's private undertaking", failure => {
  const f = fixture(), saved = f.save();
  const owner = saved.entities.find(e => e.id === f.actor)!, other = saved.entities.find(e => e.id === f.sameName)!;
  if (failure === "foreign_owner") owner.components.CoordinationMemory = structuredClone(other.components.CoordinationMemory);
  else delete owner.components.WorkingMemoryIdentity;
  const r = restore(saved), actor = r.oldToNewId.get(f.actor)!;
  expect(getCoordinationMemory(r.world, actor)).toMatchObject({ items: [], revision: 0 });
});

test("an old checkpoint with no coordination component does not invent commitments from stored speech", () => {
  const f = fixture(), saved = f.save();
  delete saved.entities.find(e => e.id === f.actor)!.components.CoordinationMemory;
  const r = restore(saved), actor = r.oldToNewId.get(f.actor)!;
  expect(getSocialDialogue(r.world, actor)).toHaveLength(1);
  expect(getCoordinationMemory(r.world, actor)).toMatchObject({ items: [], revision: 0 });
  reconcileCoordinationGoals(r.world, actor);
  expect(getCoordinationMemory(r.world, actor)).toMatchObject({ items: [], revision: 0 });
});
