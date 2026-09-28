import { addComponent, addEntity, hasComponent, removeEntity } from "bitecs";
import { Agent, Appearance, Description, EquipSlot, Name, PhysicalObject, Room } from "../../ecs/components";
import { getDirectContainer, setLocatedIn } from "../../ecs/location";
import { createArgosWorld, type World } from "../../ecs/world";
import { reserveSimulationResources, releaseSimulationResources } from "../../runtime/simulation-timeline";
import { WorkingMemoryIdentity } from "../../ecs/components";
import {
  configureCharacterAppearance,
  registerGarment,
  snapshotCharacterAppearance,
  tryRemoveGarment,
  tryWearGarment,
} from "../character-appearance";

function character(world: World, name: string): number {
  const eid = addEntity(world);
  addComponent(world, eid, Agent);
  addComponent(world, eid, Name);
  Name.value[eid] = name;
  Agent.systemPrompt[eid] = "SECRET backstory and intentions";
  configureCharacterAppearance(world, eid, {
    height: "short", build: "wiry", hairColor: "black", hairStyle: "braided", eyeColor: "green",
    skinTone: "brown", age: "adult", distinguishing: "a crescent scar on the left cheek",
    clothing: "a linen shirt and work trousers", expression: "curious", posture: "upright", condition: "clean",
  });
  return eid;
}

function object(world: World, name: string, container: number): number {
  const eid = addEntity(world);
  addComponent(world, eid, PhysicalObject);
  addComponent(world, eid, Name);
  addComponent(world, eid, Description);
  Name.value[eid] = name;
  Description.value[eid] = name;
  setLocatedIn(world, eid, container);
  return eid;
}

function fixture() {
  const world = createArgosWorld("Wardrobe test");
  const room = addEntity(world);
  addComponent(world, room, Room);
  const actor = character(world, "Mara");
  const other = character(world, "Ivo");
  setLocatedIn(world, actor, room);
  setLocatedIn(world, other, room);
  const blueCoat = object(world, "blue coat", actor);
  registerGarment(world, blueCoat, { slot: "outerwear", description: "a patched blue canvas coat" });
  const redCoat = object(world, "red coat", actor);
  registerGarment(world, redCoat, { slot: "outerwear", description: "a red wool coat with brass buttons" });
  return { world, actor, other, room, blueCoat, redCoat };
}

test("only a live manual operation exposes its directly possessed portable target", () => {
  const { world, actor, room } = fixture(); Agent.active[actor] = true;
  const phone = object(world, "phone", actor), privateItem = object(world, "private inventory", actor);
  PhysicalObject.portable[phone] = true; PhysicalObject.portable[privateItem] = true;
  expect(snapshotCharacterAppearance(world, actor)!.heldItems).toEqual([]);
  expect(reserveSimulationResources(world, actor, "typing", ["body"], { activity: { kind: "operating", operation: "typing", targetEid: phone } })).toBe(true);
  const prior = snapshotCharacterAppearance(world, actor)!;
  expect(prior.heldItems.map(item => item.eid)).toEqual([phone]); expect(prior.visiblyHolding).toBe("phone");
  expect(prior.description).not.toContain("private inventory");
  setLocatedIn(world, phone, room); expect(snapshotCharacterAppearance(world, actor)!.heldItems).toEqual([]);
  setLocatedIn(world, phone, actor); WorkingMemoryIdentity.id[phone] = "replacement-item";
  expect(snapshotCharacterAppearance(world, actor)!.heldItems).toEqual([]);
  releaseSimulationResources(world, actor, "typing"); expect(snapshotCharacterAppearance(world, actor)!.heldItems).toEqual([]);
  expect(prior.visiblyHolding).toBe("phone");
});

test("changing a physical outfit updates wardrobe while preserving stable identity and prior snapshots", () => {
  const { world, actor, blueCoat, redCoat } = fixture();
  expect(tryWearGarment(world, actor, blueCoat)).toEqual({ success: true });
  const before = snapshotCharacterAppearance(world, actor)!;
  expect(before.wornGarments.map((item) => item.eid)).toEqual([blueCoat]);
  expect(before.clothing).toContain("patched blue canvas coat");
  expect(tryWearGarment(world, actor, redCoat)).toMatchObject({ success: false });
  expect(tryRemoveGarment(world, actor, blueCoat)).toEqual({ success: true });
  expect(getDirectContainer(world, blueCoat)).toBe(actor);
  expect(tryWearGarment(world, actor, redCoat)).toEqual({ success: true });
  Appearance.expression[actor] = "smiling";
  Appearance.posture[actor] = "leaning over the workbench";
  Appearance.condition[actor] = "rain-soaked";
  const after = snapshotCharacterAppearance(world, actor)!;
  expect(after.identity).toEqual(before.identity);
  expect(after.wornGarments.map((item) => item.eid)).toEqual([redCoat]);
  expect(after.clothing).toContain("red wool coat");
  expect(after.clothing).not.toContain("blue canvas coat");
  expect(after.description).toContain("leaning over the workbench");
  expect(after.condition).toBe("rain-soaked");
  expect(before.expression).toBe("curious");
  expect(before.clothing).toContain("blue canvas coat");
  expect(Object.isFrozen(after)).toBe(true);
  expect(Object.isFrozen(after.identity)).toBe(true);
  expect(Object.isFrozen(after.wornGarments)).toBe(true);
  expect(Object.isFrozen(after.wornGarments[0])).toBe(true);
  expect(JSON.stringify(after)).not.toContain("SECRET");
});

test("taking off an item removes it from the visible outfit without cloning or dropping it", () => {
  const { world, actor, blueCoat } = fixture();
  expect(tryWearGarment(world, actor, blueCoat).success).toBe(true);
  expect(tryRemoveGarment(world, actor, blueCoat).success).toBe(true);
  const view = snapshotCharacterAppearance(world, actor)!;
  expect(view.wornGarments).toEqual([]);
  expect(view.clothing).toBe("a linen shirt and work trousers");
  expect(view.possessedItems.filter((item) => item.eid === blueCoat)).toHaveLength(1);
  expect(view.heldItems).toEqual([]);
  expect(view.visiblyHolding).toBe("");
  expect(tryRemoveGarment(world, actor, blueCoat).success).toBe(false);
});

test("relocation clears equipment and returning a coat does not silently put it back on", () => {
  const { world, actor, room, blueCoat } = fixture();
  expect(tryWearGarment(world, actor, blueCoat).success).toBe(true);
  setLocatedIn(world, blueCoat, room);
  expect(snapshotCharacterAppearance(world, actor)!.wornGarments).toEqual([]);
  expect(EquipSlot.equippedBy[blueCoat]).toBe(-1);
  setLocatedIn(world, blueCoat, actor);
  expect(snapshotCharacterAppearance(world, actor)!.wornGarments).toEqual([]);
  expect(tryWearGarment(world, actor, blueCoat).success).toBe(true);
  removeEntity(world, blueCoat);
  expect(snapshotCharacterAppearance(world, actor)!.wornGarments).toEqual([]);
  expect(snapshotCharacterAppearance(world, actor)!.clothing).not.toContain("blue canvas coat");
});

test("a character cannot wear another character's garment or a nearby unpossessed garment", () => {
  const { world, actor, other, room, blueCoat } = fixture();
  expect(tryWearGarment(world, other, blueCoat)).toMatchObject({ success: false });
  expect(tryWearGarment(world, actor, blueCoat).success).toBe(true);
  expect(tryRemoveGarment(world, other, blueCoat).success).toBe(false);
  setLocatedIn(world, blueCoat, room);
  expect(tryWearGarment(world, actor, blueCoat).success).toBe(false);
  expect(tryWearGarment(world, other, blueCoat).success).toBe(false);
  expect(getDirectContainer(world, blueCoat)).toBe(room);
  const bag = object(world, "closed bag", actor);
  setLocatedIn(world, blueCoat, bag);
  expect(tryWearGarment(world, actor, blueCoat).success).toBe(false);
});

test("only physically possessed hand equipment is presented as held", () => {
  const { world, actor, room, blueCoat } = fixture();
  Appearance.visiblyHolding[actor] = "blue coat"; // Legacy inventory-derived cache is not evidence.
  expect(snapshotCharacterAppearance(world, actor)!.visiblyHolding).toBe("");
  const lantern = object(world, "brass lantern", actor);
  addComponent(world, lantern, EquipSlot);
  EquipSlot.slot[lantern] = "mainHand";
  EquipSlot.equippedBy[lantern] = actor;
  let view = snapshotCharacterAppearance(world, actor)!;
  expect(view.heldItems.map((item) => item.eid)).toEqual([lantern]);
  expect(view.possessedItems.map((item) => item.eid)).toContain(blueCoat);
  expect(view.visiblyHolding).toBe("brass lantern");
  setLocatedIn(world, lantern, room);
  view = snapshotCharacterAppearance(world, actor)!;
  expect(view.heldItems).toEqual([]);
  expect(view.visiblyHolding).toBe("");
});

test("snapshots are read-only and do not trust equipment claims on unpossessed objects", () => {
  const { world, actor, room, blueCoat } = fixture();
  setLocatedIn(world, blueCoat, room);
  EquipSlot.equippedBy[blueCoat] = actor; // Invalid external state remains invisible.
  const before = Appearance.lastUpdate[actor];
  const snapshot = snapshotCharacterAppearance(world, actor)!;
  expect(snapshot.wornGarments).toEqual([]);
  expect(EquipSlot.equippedBy[blueCoat]).toBe(actor);
  expect(Appearance.lastUpdate[actor]).toBe(before);
  expect(hasComponent(world, actor, Appearance)).toBe(true);
  expect(snapshotCharacterAppearance(world, room)).toBeUndefined();
  removeEntity(world, actor);
  expect(snapshotCharacterAppearance(world, actor)).toBeUndefined();
});
