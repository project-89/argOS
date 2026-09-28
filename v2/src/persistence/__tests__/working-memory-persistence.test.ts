import { jest } from "@jest/globals";
import { addComponent, addEntity, hasComponent } from "bitecs";
import { WorkingMemory } from "../../ecs/components";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { getDirectContainer, setLocatedIn } from "../../ecs/location";
import { formatWorkingMemoryContext, getWorkingMemory, recordWorkingMemoryEvidence, workingMemoryEntityRef } from "../../cognition/working-memory";
import { deserializeWorld, serializeWorld, type SerializedWorld } from "../world-persistence";

function fixture() {
  const world = createArgosWorld("Working memory source"); initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Utility Room" });
  const store = createRoomEntity(world, { name: "Store Room" });
  // The ownership identity is the actor entity, never its display name.
  const first = createAgentEntity(world, { name: "Resident", role: "repairer", systemPrompt: "Private first resident", roomId: room });
  const second = createAgentEntity(world, { name: "Resident", role: "helper", systemPrompt: "Private second resident", roomId: room });
  const fuse = createObjectEntity(world, { name: "Spare fuse", roomId: room, portable: true });
  setLocatedIn(world, fuse, first);
  const registry = createSystemRegistry();
  const save = () => JSON.parse(JSON.stringify(serializeWorld(world, registry))) as SerializedWorld;
  return { world, room, store, first, second, fuse, registry, save };
}

function restore(data: SerializedWorld) {
  const world = createArgosWorld("Working memory restored"); initializePrefabs(world);
  for (let i = 0; i < 12; i++) addEntity(world);
  const registry = createSystemRegistry();
  return { world, registry, ...deserializeWorld(world, registry, data) };
}

function record(f: ReturnType<typeof fixture>, actor: number, item: string, atMs: number) {
  expect(recordWorkingMemoryEvidence(f.world, actor, {
    id: `committed:${item}`, atMs, kind: "action", provenance: "own_action", succeeded: true,
    summary: `You received the ${item}.`,
    facts: [{ subject: `prop:${item}`, subjectLabel: item, predicate: "possession", value: "self", valueLabel: "you" }],
  })).toBe(true);
}

beforeEach(() => { jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Working-memory persistence must stay offline")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test("actor-owned evidence survives remapped IDs without mixing same-name residents", () => {
  const f = fixture();
  record(f, f.first, "Spare fuse", 1000);
  record(f, f.second, "Cleaning cloth", 2000);
  const firstMemory = getWorkingMemory(f.world, f.first);
  const secondMemory = getWorkingMemory(f.world, f.second);
  const saved = f.save();
  const restored = restore(saved);
  const first = restored.oldToNewId.get(f.first)!;
  const second = restored.oldToNewId.get(f.second)!;
  expect(first).not.toBe(f.first);
  expect(second).not.toBe(f.second);
  expect(hasComponent(restored.world, first, WorkingMemory)).toBe(true);
  expect(getWorkingMemory(restored.world, first)).toEqual(firstMemory);
  expect(getWorkingMemory(restored.world, second)).toEqual(secondMemory);
  expect(formatWorkingMemoryContext(restored.world, first, 3000)).toContain("Spare fuse");
  expect(formatWorkingMemoryContext(restored.world, first, 3000)).not.toContain("Cleaning cloth");
  expect(formatWorkingMemoryContext(restored.world, second, 3000)).not.toContain("Spare fuse");
});

test("restoration and repeated context reads preserve last-known evidence, not secret current truth", () => {
  const f = fixture();
  record(f, f.first, "Spare fuse", 1000);
  const before = getWorkingMemory(f.world, f.first);
  // A remote operator changes the world without an observation or receipt.
  setLocatedIn(f.world, f.fuse, f.store);
  Object.assign(f.world.time, { elapsed: 90_000, tick: 180, simulationHour: 20.025 });
  const restored = restore(f.save());
  const actor = restored.oldToNewId.get(f.first)!;
  expect(getDirectContainer(restored.world, restored.oldToNewId.get(f.fuse)!)).toBe(restored.oldToNewId.get(f.store));
  const clock = { ...restored.world.time };
  const json = WorkingMemory.factsJson[actor];
  for (let i = 0; i < 25; i++) {
    const context = formatWorkingMemoryContext(restored.world, actor, 100_000 + i * 1000);
    expect(context).toContain("Spare fuse");
    expect(context).not.toContain("Store Room");
  }
  expect(getWorkingMemory(restored.world, actor)).toEqual(before);
  expect(WorkingMemory.factsJson[actor]).toBe(json);
  expect(restored.world.time).toEqual(clock);
});

test("durable object identities keep later observations in the same fact slot after entity remapping", () => {
  const f = fixture();
  const subject = workingMemoryEntityRef(f.world, f.fuse)!;
  const owner = workingMemoryEntityRef(f.world, f.first)!;
  recordWorkingMemoryEvidence(f.world, f.first, {
    id: "transfer:before-save", atMs: 1000, kind: "action", provenance: "own_action", succeeded: true,
    summary: "You received the Spare fuse.",
    facts: [{ subject: subject.key, subjectLabel: subject.label, predicate: "location", value: owner.key, valueLabel: owner.label }],
  });
  const restored = restore(f.save());
  const actor = restored.oldToNewId.get(f.first)!;
  const fuse = restored.oldToNewId.get(f.fuse)!;
  const store = restored.oldToNewId.get(f.store)!;
  expect(workingMemoryEntityRef(restored.world, fuse)).toEqual(subject);
  expect(workingMemoryEntityRef(restored.world, actor)).toEqual(owner);
  setLocatedIn(restored.world, fuse, store);
  setLocatedIn(restored.world, actor, store);
  const current = workingMemoryEntityRef(restored.world, store)!;
  recordWorkingMemoryEvidence(restored.world, actor, {
    id: "observation:after-save", atMs: 2000, kind: "observation", provenance: "visible_observation",
    summary: "You see the Spare fuse lying in the Store Room.",
    facts: [{ subject: subject.key, subjectLabel: subject.label, predicate: "location", value: current.key, valueLabel: current.label }],
  });
  expect(getWorkingMemory(restored.world, actor).facts).toEqual([
    expect.objectContaining({ subject: subject.key, value: current.key, valueLabel: "Store Room", sourceId: "observation:after-save" }),
  ]);
});

test("legacy numeric working memory starts with no imported evidence or side effects", () => {
  const f = fixture();
  addComponent(f.world, f.first, WorkingMemory);
  WorkingMemory.capacity[f.first] = 7;
  WorkingMemory.currentLoad[f.first] = 2;
  WorkingMemory.decayRate[f.first] = .2;
  const saved = f.save();
  saved.entities.find(entity => entity.id === f.first)!.components.WorkingMemory = {
    capacity: 7, currentLoad: 2, decayRate: .2,
  };
  const restored = restore(saved);
  const actor = restored.oldToNewId.get(f.first)!;
  expect(WorkingMemory.capacity[actor]).toBe(7);
  expect(WorkingMemory.currentLoad[actor]).toBe(2);
  expect(WorkingMemory.decayRate[actor]).toBe(.2);
  expect(WorkingMemory.factsJson[actor]).toBe("[]");
  expect(WorkingMemory.receiptsJson[actor]).toBe("[]");
  expect(WorkingMemory.ownerKey[actor]).toBe("");
  expect(getWorkingMemory(restored.world, actor)).toMatchObject({ facts: [], receipts: [], revision: 0, evidenceFloorMs: -1 });
});

test("an old actor without working memory is not hydrated from another actor or current world polling", () => {
  const f = fixture();
  record(f, f.first, "Spare fuse", 1000);
  const saved = f.save();
  delete saved.entities.find(entity => entity.id === f.first)!.components.WorkingMemory;
  const restored = restore(saved);
  const actor = restored.oldToNewId.get(f.first)!;
  expect(hasComponent(restored.world, actor, WorkingMemory)).toBe(false);
  expect(getWorkingMemory(restored.world, actor)).toMatchObject({ facts: [], receipts: [], revision: 0 });
  formatWorkingMemoryContext(restored.world, actor, 3000);
  expect(hasComponent(restored.world, actor, WorkingMemory)).toBe(false);
});

test.each(["foreign_owner", "missing_identity"])("saved working memory with %s is not attributed to the restored actor", failure => {
  const f = fixture();
  record(f, f.first, "Spare fuse", 1000);
  record(f, f.second, "Cleaning cloth", 2000);
  const saved = f.save();
  const first = saved.entities.find(entity => entity.id === f.first)!;
  const second = saved.entities.find(entity => entity.id === f.second)!;
  if (failure === "foreign_owner") first.components.WorkingMemory = structuredClone(second.components.WorkingMemory);
  else delete first.components.WorkingMemoryIdentity;
  const restored = restore(saved);
  const actor = restored.oldToNewId.get(f.first)!;
  expect(getWorkingMemory(restored.world, actor)).toMatchObject({ facts: [], receipts: [], revision: 0 });
  expect(formatWorkingMemoryContext(restored.world, actor, 3000)).not.toContain("Cleaning cloth");
});
