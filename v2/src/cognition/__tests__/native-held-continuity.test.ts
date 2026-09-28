import { jest } from "@jest/globals";
import { hasComponent, removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { initializePrefabs, createAgentEntity, createRoomEntity, createObjectEntity } from "../../ecs/prefabs";
import { Appearance, EquipSlot } from "../../ecs/components";
import { setLocatedIn, getDirectContainer } from "../../ecs/location";
import { addToInventory } from "../../ecs/inventory";
import { executeActions, syncVisiblyHoldingFromInventory } from "../cognition-system";
import { configureCharacterAppearance, snapshotCharacterAppearance, registerGarment, tryWearGarment,
  tryHoldCarriedItem, tryStowCarriedItem } from "../../rendering/character-appearance";
import { reserveSimulationResources, releaseSimulationResources } from "../../runtime/simulation-timeline";
import { serializeWorld } from "../../persistence/world-persistence";
import type { AgentAction } from "../agent-mind";

function fixture() {
  const world = createArgosWorld("Hand continuity"); world.meta.aiEnabled = false; initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Workshop" }), hall = createRoomEntity(world, { name: "Hall" });
  const actor = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "test", roomId: room });
  const other = createAgentEntity(world, { name: "Bo", role: "resident", systemPrompt: "test", roomId: room });
  configureCharacterAppearance(world, actor, {}); configureCharacterAppearance(world, other, {});
  const object = (name: string) => createObjectEntity(world, { name, portable: true, roomId: room });
  const device = object("Reader"), privateItem = object("Private notebook"), registry = createSystemRegistry();
  const act = (action: AgentAction) => executeActions(world, [{ eid: actor, action }], registry);
  return { world, room, hall, actor, other, device, privateItem, object, registry, act,
    held: () => snapshotCharacterAppearance(world, actor)!.heldItems.map(x => x.eid) };
}
beforeEach(() => { jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Held-item regressions are offline")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test("native pickup establishes explicit physical hand ownership, not an inventory-wide display guess", () => {
  const f = fixture(); addToInventory(f.world, f.actor, f.privateItem);
  f.act({ type: "pickup", target: "Reader" });
  expect(getDirectContainer(f.world, f.device)).toBe(f.actor); expect(f.held()).toEqual([f.device]);
  expect(EquipSlot.equippedBy[f.device]).toBe(f.actor); expect(EquipSlot.slot[f.device]).toBe("mainHand");
  expect(Appearance.visiblyHolding[f.actor]).toBe("Reader");
  expect(snapshotCharacterAppearance(f.world, f.actor)!.description).not.toContain("Private notebook");
});

test("holding persists across walk/idle/read/type gaps without a fabricated stow transition", () => {
  const f = fixture(); f.act({ type: "pickup", target: "Reader" });
  setLocatedIn(f.world, f.actor, f.hall); f.world.time.elapsed += 5000;
  expect(f.held()).toEqual([f.device]);
  for (const operation of ["reading", "typing"] as const) {
    expect(reserveSimulationResources(f.world, f.actor, operation, ["body"], { activity: { kind: "operating", operation, targetEid: f.device } })).toBe(true);
    expect(f.held()).toEqual([f.device]);
    releaseSimulationResources(f.world, f.actor, operation); f.world.time.elapsed += 3000;
    expect(f.held()).toEqual([f.device]);
  }
});

test("drop revokes hand ownership and does not reveal another inventory item", () => {
  const f = fixture(); addToInventory(f.world, f.actor, f.privateItem); f.act({ type: "pickup", target: "Reader" });
  f.act({ type: "drop", target: "Reader" });
  expect(f.held()).toEqual([]); expect(EquipSlot.equippedBy[f.device]).toBe(-1);
  expect(Appearance.visiblyHolding[f.actor]).toBe(""); expect(getDirectContainer(f.world, f.privateItem)).toBe(f.actor);
});

test("an actual hand-over clears the giver's claim and can occupy a receiver's free hand", () => {
  const f = fixture(); f.act({ type: "pickup", target: "Reader" }); f.act({ type: "give", target: "Bo", content: "Reader" });
  expect(f.held()).toEqual([]); expect(getDirectContainer(f.world, f.device)).toBe(f.other);
  expect(snapshotCharacterAppearance(f.world, f.other)!.heldItems.map(x => x.eid)).toEqual([f.device]);
  expect(Appearance.visiblyHolding[f.actor]).toBe("");
});

test("moving an item away revokes the old claim permanently, even if it is later returned to inventory", () => {
  const f = fixture(); f.act({ type: "pickup", target: "Reader" });
  setLocatedIn(f.world, f.device, f.room);
  expect(f.held()).toEqual([]); expect(Appearance.visiblyHolding[f.actor]).toBe("");
  addToInventory(f.world, f.actor, f.device); expect(f.held()).toEqual([]);
  expect(tryHoldCarriedItem(f.world, f.other, f.device).success).toBe(false);
});

test("explicit stowing removes visibility without dropping or duplicating the physical object", () => {
  const f = fixture(); f.act({ type: "pickup", target: "Reader" });
  expect(tryStowCarriedItem(f.world, f.actor, f.device)).toEqual({ success: true });
  expect(f.held()).toEqual([]); expect(getDirectContainer(f.world, f.device)).toBe(f.actor);
  expect(tryHoldCarriedItem(f.world, f.actor, f.device)).toEqual({ success: true }); expect(f.held()).toEqual([f.device]);
});

test("hand allocation never evicts another item or invents a third hand", () => {
  const f = fixture(), third = f.object("Third object");
  f.act({ type: "pickup", target: "Reader" }); f.act({ type: "pickup", target: "Private notebook" });
  addToInventory(f.world, f.actor, third);
  expect(tryHoldCarriedItem(f.world, f.actor, third)).toMatchObject({ success: false });
  expect(f.held()).toEqual([f.device, f.privateItem]);
  expect(hasComponent(f.world, third, EquipSlot)).toBe(false);
});

test("picking up registered clothing never replaces its wardrobe slot with a hand slot", () => {
  const f = fixture(), coat = f.object("Coat"); registerGarment(f.world, coat, { slot: "outerwear" });
  f.act({ type: "pickup", target: "Coat" });
  expect(EquipSlot.slot[coat]).toBe("outerwear"); expect(EquipSlot.equippedBy[coat]).toBe(-1);
  expect(tryWearGarment(f.world, f.actor, coat)).toEqual({ success: true });
});

test("legacy inventory sync and deletion cannot manufacture a held item", () => {
  const f = fixture(); addToInventory(f.world, f.actor, f.privateItem); syncVisiblyHoldingFromInventory(f.world, f.actor);
  expect(Appearance.visiblyHolding[f.actor]).toBe("");
  f.act({ type: "pickup", target: "Reader" }); removeEntity(f.world, f.device);
  expect(f.held()).toEqual([]); expect(Appearance.visiblyHolding[f.actor]).toBe("");
});

test("physical hand equipment is part of the ECS save, not renderer-only transient state", () => {
  const f = fixture(); f.act({ type: "pickup", target: "Reader" });
  const saved = serializeWorld(f.world, f.registry);
  const item = saved.entities.find(x => x.components.Name?.value === "Reader")!;
  expect(item.components.EquipSlot).toMatchObject({ slot: "mainHand", equippedBy: f.actor });
});
