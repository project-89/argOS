import { jest } from "@jest/globals";
import { getAllEntities, hasComponent, query } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Position, PhysicalObject } from "../../ecs/components";
import { getComponent, getRegistryEntry, listNames, registryCreateComponent } from "../../ecs/component-registry";
import { getRoomForEntity } from "../../ecs/location";
import { ObjectManager } from "../object-manager";
import { worldSchema, type ObjectTypeDefinition } from "../schema";
import { materializeRoomFromSchemaPlan } from "../../spirits/steward-spirit";

function fixture() {
  const world = createArgosWorld("Object component laboratory"); initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Living Room" });
  const manager = new ObjectManager(world);
  return { world, room, manager };
}
function define(defaultComponents: ObjectTypeDefinition["defaultComponents"]) {
  const name = "component_preflight_fixture";
  worldSchema.defineObjectType({ name, description: "A test object", traits: ["examinable"],
    states: { normal: { description: "A test object" } }, defaultState: "normal", defaultComponents });
  return name;
}
beforeEach(() => {
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network in object component tests"));
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test("the base laptop materializes its declared Battery as a queryable canonical component", () => {
  const f = fixture(), id = f.manager.spawn("laptop", { containedIn: f.room })!;
  expect(id).not.toBeNull();
  const battery = getComponent("Battery");
  expect(getRegistryEntry("Battery")?.definition?.properties).toEqual({ current: "number", max: "number" });
  expect(hasComponent(f.world, id, battery)).toBe(true);
  expect([...query(f.world, [battery])]).toContain(id);
  expect(battery.current[id]).toBe(80); expect(battery.max[id]).toBe(100);
  expect(getRoomForEntity(f.world, id)).toBe(f.room);
  const another = f.manager.spawn("laptop", { containedIn: f.room, components: { Battery: { current: 25 } } })!;
  expect(getComponent("Battery")).toBe(battery);
  expect(battery.current[another]).toBe(25); expect(battery.max[another]).toBe(100);
  expect(battery.current[id]).toBe(80);
});

test("all other base declared components become real data without inventing schemas", () => {
  const f = fixture();
  const phone = f.manager.spawn("smartphone")!, computer = f.manager.spawn("computer")!, forge = f.manager.spawn("forge")!;
  expect(getComponent("Storage").used[phone]).toBe(20); expect(getComponent("Storage").max[phone]).toBe(128);
  expect(getComponent("ComputerSpec").ram[computer]).toBe(16);
  expect(getComponent("Temperature").current[forge]).toBe(20);
});

test("explicit physical overrides preserve already initialized fields and fill new fields", () => {
  const f = fixture();
  const id = f.manager.spawn("chair", { properties: { material: "oak" }, components: {
    PhysicalObject: { weight: 7 }, Position: { x: 2 },
  } })!;
  expect(PhysicalObject.material[id]).toBe("oak"); expect(PhysicalObject.weight[id]).toBe(7);
  expect(PhysicalObject.portable[id]).toBe(true);
  expect(hasComponent(f.world, id, Position)).toBe(true);
  expect(Position.x[id]).toBe(2); expect(Position.y[id]).toBe(0); expect(Position.z[id]).toBe(0);
});

test.each([
  [{ name: "Position", values: { x: "2" } }],
  [{ name: "Position", values: { x: Infinity } }],
  [{ name: "Position", values: { unregisteredField: 3 } }],
  [{ name: "UnknownPhysical", values: { current: 3 } }],
  [{ name: "UnknownPhysical", values: { current: 3 }, dynamic: true }],
  [{ name: "UnknownPhysical", values: { current: 3 }, dynamic: true, schema: { current: "array" } }],
  [{ name: "UnknownPhysical", values: { current: "3" }, dynamic: true, schema: { current: "number" } }],
  [{ name: "Position", values: { x: 3 }, dynamic: true, schema: { x: "number" } }],
  [{ name: "Agent", values: { active: true } }],
  [{ name: "NarrativeEntry", values: {} }],
])("invalid template specs fail before any entity or dynamic registration: %j", spec => {
  const f = fixture(), before = [...getAllEntities(f.world)], registryBefore = listNames();
  const type = define([{ name: "PreparedButNotRegistered", values: { amount: 1 }, dynamic: true, schema: { amount: "number" } }, spec] as any);
  expect(f.manager.spawn(type, { containedIn: f.room })).toBeNull();
  expect([...getAllEntities(f.world)]).toEqual(before); expect(listNames()).toEqual(registryBefore);
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Cannot spawn"));
});

test("an incompatible registered Battery is rejected without replacing its schema or creating a laptop", () => {
  const f = fixture();
  const battery = registryCreateComponent({ name: "Battery", description: "Different declared schema", properties: { current: "string", max: "number" } });
  const before = [...getAllEntities(f.world)];
  expect(f.manager.spawn("laptop")).toBeNull();
  expect([...getAllEntities(f.world)]).toEqual(before); expect(getComponent("Battery")).toBe(battery);
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Schema conflict"));
});

test.each([
  { Position: { x: "bad" } }, { UnknownFromValues: { x: 1 } }, { Battery: { secret: 3 } },
  { Mind: { focus: "Invented private thought" } }, { WorkingMemoryIdentity: { id: "forged" } },
])("invalid additional values cannot silently override or define components: %j", components => {
  const f = fixture(), before = [...getAllEntities(f.world)], registryBefore = listNames();
  expect(f.manager.spawn("laptop", { components })).toBeNull();
  expect([...getAllEntities(f.world)]).toEqual(before); expect(listNames()).toEqual(registryBefore);
});

test("a declared dynamic component fills unspecified fields from canonical defaults", () => {
  const f = fixture();
  const moisture = registryCreateComponent({ name: "Moisture", description: "Water content", properties: { wet: "boolean", amount: "number" }, defaults: { wet: false, amount: 4 } });
  const id = f.manager.spawn("chair", { components: { Moisture: { wet: true } } })!;
  expect(hasComponent(f.world, id, moisture)).toBe(true); expect(moisture.wet[id]).toBe(true); expect(moisture.amount[id]).toBe(4);
});

test("Steward room materialization produces real template components and skips invalid objects truthfully", () => {
  const f = fixture();
  const type = define([{ name: "Position", values: { x: "not numeric" } }] as any);
  const result = materializeRoomFromSchemaPlan(f.world, { roomName: "Living Room", roomType: "living_room", context: {} } as any, f.room,
    { entities: [{ type: "laptop" }, { type }] }, f.manager);
  expect(result.entityIds).toHaveLength(1);
  expect(hasComponent(f.world, result.entityIds[0], getComponent("Battery"))).toBe(true);
  expect(getComponent("Battery").current[result.entityIds[0]]).toBe(80);
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Invalid type or unknown field Position.x"));
});
