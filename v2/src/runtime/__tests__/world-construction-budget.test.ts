import { jest } from "@jest/globals";
import { addEntity, addComponent, getAllEntities, removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { Name, Goal } from "../../ecs/components";
import { createAgentEntity, createRoomEntity, createObjectEntity, createStimulusSourceEntity, initializePrefabs } from "../../ecs/prefabs";
import { createEcsTools, createEntityRegistry } from "../../ecs/tools";
import { createIntentGoal } from "../../cognition/cognition-system";
import { materializeApprovedEntity } from "../../engineering/entity-materialization";
import { ObjectManager } from "../../world/object-manager";
import { worldSchema } from "../../world/schema";
import { getRegistryEntry } from "../../ecs/component-registry";
import { createWorldMap } from "../../world/ascii-world";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { serializeWorld, deserializeWorld } from "../../persistence/world-persistence";
import { startCommittedEvents, stopCommittedEvents } from "../committed-events";
import { assertWorldConstructionAvailable, configureWorldConstructionBudget, getWorldConstructionStatus, snapshotWorldConstructionBudget } from "../world-construction-budget";

function fixture(limit = 1) {
  const world = createArgosWorld("Bounded growth"); initializePrefabs(world);
  configureWorldConstructionBudget(world, limit);
  const room = createRoomEntity(world, { name: "Street" });
  return { world, room, registry: createSystemRegistry() };
}
beforeEach(() => { jest.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => jest.restoreAllMocks());

test("batch preflight validates counts and remaining capacity without reserving or refunding slots", () => {
  const f = fixture(3);
  expect(() => assertWorldConstructionAvailable(f.world, 2)).not.toThrow();
  expect(() => assertWorldConstructionAvailable(f.world, 3)).toThrow(/budget/);
  expect(getWorldConstructionStatus(f.world).admitted).toBe(1);
  for (const count of [-1, 0.5, NaN, Infinity]) expect(() => assertWorldConstructionAvailable(f.world, count)).toThrow(/safe integer/);
  expect(() => assertWorldConstructionAvailable(f.world, 0)).not.toThrow();
});

test.each(["agent", "room", "object", "source", "map", "materialization", "generic tool", "schema", "custom"])("%s shares the construction gate before allocating another entity", route => {
  const f = fixture(), before = [...getAllEntities(f.world)];
  const manager = new ObjectManager(f.world);
  const actions: Record<string, () => unknown> = {
    agent: () => createAgentEntity(f.world, { name: "New resident", role: "resident", systemPrompt: "Choose freely", roomId: f.room }),
    room: () => createRoomEntity(f.world, { name: "New room" }),
    object: () => createObjectEntity(f.world, { name: "New prop", roomId: f.room }),
    source: () => createStimulusSourceEntity(f.world, { name: "Rain", stimulusType: "sound", template: "Rain falls", roomId: f.room }),
    map: () => createWorldMap(f.world, "Map", 2, 2),
    materialization: () => materializeApprovedEntity(f.world, { name: "Owner", description: "A resident", type: "agent", roomEid: f.room, components: [] }),
    custom: () => manager.spawnCustom({ name: "Custom prop", description: "A prop", traits: [], containedIn: f.room }),
  };
  if (route === "generic tool") expect(createEcsTools(f.world, createEntityRegistry()).createEntity({ name: "Generic" })).toMatchObject({ success: false, error: expect.stringMatching(/construction budget/) });
  else if (route === "schema") expect(manager.spawn("chair", { containedIn: f.room })).toBeNull();
  else expect(actions[route]).toThrow(/construction budget/);
  expect([...getAllEntities(f.world)]).toEqual(before);
  expect(getWorldConstructionStatus(f.world)).toMatchObject({ limit: 1, admitted: 1, remaining: 0 });
});

test("denied schema construction cannot leave a newly registered component", () => {
  const f = fixture();
  worldSchema.defineObjectType({ name: "budget_schema_fixture", description: "A prop", traits: [], defaultState: "normal",
    states: { normal: { description: "A prop" } }, defaultComponents: [
      { name: "BudgetDeniedQuantity", values: { amount: 0 }, dynamic: true, schema: { amount: "number" } },
    ] });
  expect(new ObjectManager(f.world).spawn("budget_schema_fixture")).toBeNull();
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining("construction budget exhausted"));
  expect(getRegistryEntry("BudgetDeniedQuantity")).toBeUndefined();
  const unlimited = createArgosWorld("Unbounded control"); initializePrefabs(unlimited);
  expect(new ObjectManager(unlimited).spawn("budget_schema_fixture")).not.toBeNull();
  expect(getRegistryEntry("BudgetDeniedQuantity")).toBeDefined();
});

test("generated inhabitants count once; ordinary cognitive records do not spend construction slots", () => {
  const f = fixture(2);
  const actor = materializeApprovedEntity(f.world, { name: "Ada", description: "A resident", type: "agent", roomEid: f.room, components: [] });
  for (let i = 0; i < 20; i++) createIntentGoal(f.world, actor, `Consider possibility ${i}`, 5);
  expect(getWorldConstructionStatus(f.world)).toMatchObject({ admitted: 2, remaining: 0, byKind: { agent: 1, room: 1, object: 0 } });
  const before = getWorldConstructionStatus(f.world);
  before.byKind.agent = 100;
  expect(getWorldConstructionStatus(f.world).byKind.agent).toBe(1);
});

test("deletion, recycled IDs and source restarts do not refund admissions", () => {
  const f = fixture(); startCommittedEvents(f.world);
  removeEntity(f.world, f.room);
  const internal = addEntity(f.world); addComponent(f.world, internal, Goal);
  stopCommittedEvents(f.world); startCommittedEvents(f.world);
  expect(() => createRoomEntity(f.world, { name: "Replacement" })).toThrow(/construction budget/);
  expect(() => configureWorldConstructionBudget(f.world, 10)).toThrow(/cannot be replaced/);
  expect(getWorldConstructionStatus(f.world).admitted).toBe(1);
});

test("invalid materialization does not allocate or spend a slot", () => {
  const f = fixture(2), before = [...getAllEntities(f.world)];
  expect(() => materializeApprovedEntity(f.world, { name: "Invalid", description: "A prop", type: "object", roomEid: f.room,
    components: [{ name: "NonexistentBudgetComponent", values: {} }] })).toThrow(/Unknown component/);
  expect([...getAllEntities(f.world)]).toEqual(before); expect(getWorldConstructionStatus(f.world).admitted).toBe(1);
});

test("save/restore retains admissions even after all admitted objects were removed", () => {
  const f = fixture(2); createObjectEntity(f.world, { name: "Prop", roomId: f.room }); removeEntity(f.world, f.room);
  const saved = serializeWorld(f.world, f.registry), restored = createArgosWorld("Restored"); initializePrefabs(restored);
  deserializeWorld(restored, createSystemRegistry(), saved);
  expect(snapshotWorldConstructionBudget(restored)).toEqual(saved.constructionBudget);
  expect(() => createRoomEntity(restored, { name: "Another place" })).toThrow(/construction budget/);
});

test.each(["malformed", "different limit", "missing history", "merge"])("restore rejects %s before importing entities", mode => {
  const f = fixture(2), saved = serializeWorld(f.world, f.registry);
  const restored = createArgosWorld("Target"); initializePrefabs(restored);
  if (mode === "malformed") saved.constructionBudget!.admitted = 99;
  if (mode === "different limit") configureWorldConstructionBudget(restored, 3);
  if (mode === "missing history") { configureWorldConstructionBudget(restored, 2); delete saved.constructionBudget; }
  if (mode === "merge") createRoomEntity(restored, { name: "Already here" });
  const before = [...getAllEntities(restored)];
  expect(() => deserializeWorld(restored, createSystemRegistry(), saved)).toThrow(/construction|bounded world/);
  expect([...getAllEntities(restored)]).toEqual(before);
});

test.each([-1, 1.5, NaN, Infinity])("invalid limit %s is rejected", value => {
  const world = createArgosWorld();
  expect(() => configureWorldConstructionBudget(world, value)).toThrow(/safe integer/);
});

test("unlimited worlds remain unlimited and legacy import does not invent bounded history", () => {
  const world = createArgosWorld(); initializePrefabs(world);
  for (let i = 0; i < 4; i++) createRoomEntity(world, { name: `Room ${i}` });
  expect(getWorldConstructionStatus(world)).toMatchObject({ limit: null, admitted: 4, remaining: null });
  const saved = serializeWorld(world, createSystemRegistry()), restored = createArgosWorld(); initializePrefabs(restored);
  deserializeWorld(restored, createSystemRegistry(), saved);
  expect(() => configureWorldConstructionBudget(restored, 10)).toThrow(/without construction history/);
  expect(() => createRoomEntity(restored, { name: "Still unlimited" })).not.toThrow();
});
