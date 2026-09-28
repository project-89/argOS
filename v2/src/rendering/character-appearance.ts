import {
  addComponent,
  entityExists,
  hasComponent,
  observe,
  onRemove,
  Wildcard,
} from "bitecs";
import { Agent, Appearance, Description, EquipSlot, Name, PhysicalObject } from "../ecs/components";
import { getDirectContainer, listDirectContents } from "../ecs/location";
import { LocatedIn } from "../ecs/relations";
import type { World } from "../ecs/world";
import { getPhysicalHeldItems, HAND_SLOTS } from "../ecs/held-items";

export const GARMENT_SLOTS = ["head", "body", "outerwear", "legs", "feet", "neck", "hands", "waist", "accessory"] as const;
export type GarmentSlot = (typeof GARMENT_SLOTS)[number];

export interface CharacterIdentity {
  readonly height: string;
  readonly build: string;
  readonly hairColor: string;
  readonly hairStyle: string;
  readonly eyeColor: string;
  readonly skinTone: string;
  readonly age: string;
  readonly distinguishing: string;
  readonly description: string;
}

export interface AppearanceItem {
  readonly eid: number;
  readonly name: string;
  readonly description: string;
}

export interface EquippedAppearanceItem extends AppearanceItem {
  readonly slot: string;
}

/** Public physical facts only. Possession does not imply visibility or a held item. */
export interface CharacterAppearanceSnapshot {
  readonly eid: number;
  readonly name: string;
  readonly identity: CharacterIdentity;
  readonly clothing: string;
  readonly accessories: string;
  readonly wornGarments: readonly EquippedAppearanceItem[];
  readonly expression: string;
  readonly posture: string;
  readonly condition: string;
  readonly visiblyHolding: string;
  readonly possessedItems: readonly AppearanceItem[];
  readonly heldItems: readonly EquippedAppearanceItem[];
  readonly description: string;
}

export type CharacterAppearanceConfig = Partial<Omit<CharacterIdentity, "description">> & {
  /** Baseline dress; removable garments should instead be physical entities. */
  clothing?: string;
  accessories?: string;
  expression?: string;
  posture?: string;
  condition?: string;
};

export type GarmentActionResult = { success: true } | { success: false; reason: string };

const IDENTITY_FIELDS = ["height", "build", "hairColor", "hairStyle", "eyeColor", "skinTone", "age", "distinguishing"] as const;
const observedWorlds = new WeakSet<World>();
const garmentSlots = new Set<string>(GARMENT_SLOTS);
const handSlots = new Set<string>(HAND_SLOTS);

/** Configure initial appearance without inferring physical traits from an agent's private prompt. */
export function configureCharacterAppearance(world: World, eid: number, config: CharacterAppearanceConfig): void {
  if (!entityExists(world, eid) || !hasComponent(world, eid, Agent)) {
    throw new Error(`Cannot configure appearance: entity ${eid} is not a character`);
  }
  addComponent(world, eid, Appearance);
  for (const field of IDENTITY_FIELDS) Appearance[field][eid] = config[field]?.trim() ?? "";
  Appearance.clothing[eid] = config.clothing?.trim() ?? "";
  Appearance.accessories[eid] = config.accessories?.trim() ?? "";
  Appearance.expression[eid] = config.expression?.trim() ?? "neutral";
  Appearance.posture[eid] = config.posture?.trim() ?? "relaxed";
  Appearance.condition[eid] = config.condition?.trim() ?? "";
  Appearance.visiblyHolding[eid] = "";
  Appearance.lastUpdate[eid] = Date.now();
  initializeCharacterEquipment(world);
}

/** Install physical equipment invalidation for a new or restored world. */
export function initializeCharacterEquipment(world: World): void {
  if (observedWorlds.has(world)) return;
  observedWorlds.add(world);
  // Equipment remains a claim on one physical item. Moving it elsewhere takes it
  // off, even if another system later returns the same item to its former owner.
  observe(world, onRemove(LocatedIn(Wildcard)), (itemEid) => {
    if (!hasComponent(world, itemEid, EquipSlot)) return;
    const previousWearer = EquipSlot.equippedBy[itemEid];
    EquipSlot.equippedBy[itemEid] = -1;
    if (previousWearer !== undefined && entityExists(world, previousWearer)) {
      syncHeldAppearance(world, previousWearer);
      Appearance.lastUpdate[previousWearer] = Date.now();
    }
  });
}

/** Keep the legacy display cache grounded in explicit hand equipment, never
 * the first inventory item. Called at actual equipment/containment boundaries. */
export function syncHeldAppearance(world: World, actorEid: number): void {
  if (!entityExists(world, actorEid) || !hasComponent(world, actorEid, Appearance)) return;
  Appearance.visiblyHolding[actorEid] = listDirectContents(world, actorEid)
    .filter(item => entityExists(world, item) && hasComponent(world, item, PhysicalObject) && hasComponent(world, item, EquipSlot)
      && EquipSlot.equippedBy[item] === actorEid && handSlots.has(EquipSlot.slot[item]))
    .map(item => Name.value[item] || "item").join(" and ");
  Appearance.lastUpdate[actorEid] = Date.now();
}

/** A successful physical pickup/hand-over may leave a portable object in a
 * free hand. Mere inventory insertion never calls this. Do not silently stow
 * another item, create a third hand, or overwrite garment registration. */
export function tryHoldCarriedItem(world: World, actorEid: number, itemEid: number): GarmentActionResult {
  if (!entityExists(world, actorEid) || !hasComponent(world, actorEid, Agent)
    || !entityExists(world, itemEid) || !hasComponent(world, itemEid, PhysicalObject)
    || !PhysicalObject.portable[itemEid] || getDirectContainer(world, itemEid) !== actorEid) {
    return { success: false, reason: "Only a directly possessed portable item can be held" };
  }
  if (hasComponent(world, itemEid, EquipSlot) && !handSlots.has(EquipSlot.slot[itemEid])) {
    return { success: false, reason: "This item's registered equipment slot is not a hand" };
  }
  if (hasComponent(world, itemEid, EquipSlot) && EquipSlot.equippedBy[itemEid] === actorEid) return { success: true };
  const occupied = new Set(listDirectContents(world, actorEid).filter(item => item !== itemEid && entityExists(world, item)
    && hasComponent(world, item, EquipSlot) && EquipSlot.equippedBy[item] === actorEid).map(item => EquipSlot.slot[item]));
  const slot = ["mainHand", "offHand"].find(value => !occupied.has(value));
  if (!slot) return { success: false, reason: "Both hands already hold items" };
  initializeCharacterEquipment(world);
  addComponent(world, itemEid, EquipSlot); EquipSlot.slot[itemEid] = slot; EquipSlot.equippedBy[itemEid] = actorEid;
  syncHeldAppearance(world, actorEid);
  return { success: true };
}

/** Explicit physical stowing keeps possession but ends hand visibility. A
 * package may expose this as an action; formatting/sensing must never call it. */
export function tryStowCarriedItem(world: World, actorEid: number, itemEid: number): GarmentActionResult {
  if (!entityExists(world, actorEid) || !hasComponent(world, actorEid, Agent)
    || !entityExists(world, itemEid) || getDirectContainer(world, itemEid) !== actorEid
    || !hasComponent(world, itemEid, EquipSlot) || !handSlots.has(EquipSlot.slot[itemEid]) || EquipSlot.equippedBy[itemEid] !== actorEid) {
    return { success: false, reason: "That item is not in this character's hand" };
  }
  EquipSlot.equippedBy[itemEid] = -1; syncHeldAppearance(world, actorEid);
  return { success: true };
}

/** Turn an existing physical object into a garment; never create a duplicate object. */
export function registerGarment(
  world: World,
  garmentEid: number,
  config: { slot: GarmentSlot; description?: string },
): void {
  if (!entityExists(world, garmentEid) || !hasComponent(world, garmentEid, PhysicalObject)) {
    throw new Error(`Cannot register garment: entity ${garmentEid} is not a physical object`);
  }
  if (!garmentSlots.has(config.slot)) throw new Error(`Unknown garment slot: ${config.slot}`);
  if (hasComponent(world, garmentEid, EquipSlot) && (EquipSlot.equippedBy[garmentEid] ?? -1) >= 0) {
    throw new Error("Remove the equipped item before changing its garment registration");
  }
  addComponent(world, garmentEid, EquipSlot);
  EquipSlot.slot[garmentEid] = config.slot;
  EquipSlot.equippedBy[garmentEid] = -1;
  if (config.description !== undefined) {
    addComponent(world, garmentEid, Description);
    Description.value[garmentEid] = config.description.trim();
  }
  initializeCharacterEquipment(world);
}

function validateGarmentAction(world: World, actorEid: number, garmentEid: number): GarmentActionResult {
  if (!entityExists(world, actorEid) || !hasComponent(world, actorEid, Agent)) {
    return { success: false, reason: "The wearer is not a character in this world" };
  }
  if (!entityExists(world, garmentEid) || !hasComponent(world, garmentEid, PhysicalObject)
    || !hasComponent(world, garmentEid, EquipSlot) || !garmentSlots.has(EquipSlot.slot[garmentEid])) {
    return { success: false, reason: "That item is not a registered garment" };
  }
  if (getDirectContainer(world, garmentEid) !== actorEid) {
    return { success: false, reason: "You must physically possess the garment before wearing or removing it" };
  }
  return { success: true };
}

export function tryWearGarment(world: World, actorEid: number, garmentEid: number): GarmentActionResult {
  const validation = validateGarmentAction(world, actorEid, garmentEid);
  if (!validation.success) return validation;
  if (EquipSlot.equippedBy[garmentEid] === actorEid) {
    return { success: false, reason: "You are already wearing that garment" };
  }
  const slot = EquipSlot.slot[garmentEid];
  const conflict = listDirectContents(world, actorEid).find((itemEid) =>
    itemEid !== garmentEid && entityExists(world, itemEid) && hasComponent(world, itemEid, EquipSlot)
    && EquipSlot.equippedBy[itemEid] === actorEid && EquipSlot.slot[itemEid] === slot);
  if (conflict !== undefined) {
    return { success: false, reason: `Remove ${Name.value[conflict] || "the current garment"} from the ${slot} slot first` };
  }
  EquipSlot.equippedBy[garmentEid] = actorEid;
  Appearance.lastUpdate[actorEid] = Date.now();
  return { success: true };
}

/** Taking a garment off leaves the same physical item in the character's inventory. */
export function tryRemoveGarment(world: World, actorEid: number, garmentEid: number): GarmentActionResult {
  const validation = validateGarmentAction(world, actorEid, garmentEid);
  if (!validation.success) return validation;
  if (EquipSlot.equippedBy[garmentEid] !== actorEid) {
    return { success: false, reason: "You are not wearing that garment" };
  }
  EquipSlot.equippedBy[garmentEid] = -1;
  Appearance.lastUpdate[actorEid] = Date.now();
  return { success: true };
}

function snapshotItem(world: World, eid: number): AppearanceItem {
  return Object.freeze({
    eid,
    name: hasComponent(world, eid, Name) ? Name.value[eid] || `Item ${eid}` : `Item ${eid}`,
    description: hasComponent(world, eid, Description) ? Description.value[eid] || "" : "",
  });
}

/**
 * Read-only ECS projection. Equipment claims are accepted only while the physical
 * object exists in the character's direct possession. No thoughts, system prompt,
 * inventory cache, or inferred ownership are consulted.
 */
export function snapshotCharacterAppearance(world: World, eid: number): CharacterAppearanceSnapshot | undefined {
  if (!entityExists(world, eid) || !hasComponent(world, eid, Agent)) return undefined;
  const configured = hasComponent(world, eid, Appearance);
  const name = Name.value[eid] || `Character ${eid}`;
  const traits = Object.fromEntries(IDENTITY_FIELDS.map((field) =>
    [field, configured ? Appearance[field][eid] || "" : ""])) as Omit<CharacterIdentity, "description">;
  const identityDescription = [
    traits.age,
    traits.height ? `${traits.height} height` : "",
    traits.build ? `${traits.build} build` : "",
    traits.hairColor === "bald" ? "bald" : [traits.hairStyle, traits.hairColor, traits.hairStyle || traits.hairColor ? "hair" : ""].filter(Boolean).join(" "),
    traits.eyeColor ? `${traits.eyeColor} eyes` : "",
    traits.skinTone ? `${traits.skinTone} skin` : "",
    traits.distinguishing,
  ].filter(Boolean).join(", ");
  const identity = Object.freeze({ ...traits, description: identityDescription });
  const possessedItems = Object.freeze(listDirectContents(world, eid)
    .filter((itemEid) => entityExists(world, itemEid) && hasComponent(world, itemEid, PhysicalObject))
    .sort((a, b) => a - b).map((itemEid) => snapshotItem(world, itemEid)));
  const equipment = possessedItems.filter((item) => hasComponent(world, item.eid, EquipSlot)
    && EquipSlot.equippedBy[item.eid] === eid).map((item) => Object.freeze({ ...item, slot: EquipSlot.slot[item.eid] }));
  const wornGarments = Object.freeze(equipment.filter((item) => garmentSlots.has(item.slot)));
  const heldItems = Object.freeze(getPhysicalHeldItems(world, eid)
    .map(item => Object.freeze({ ...snapshotItem(world, item.eid), slot: item.slot })));
  const clothing = [configured ? Appearance.clothing[eid] || "" : "", ...wornGarments.map((item) => item.description || item.name)]
    .filter(Boolean).join("; ");
  const accessories = configured ? Appearance.accessories[eid] || "" : "";
  const expression = configured ? Appearance.expression[eid] || "neutral" : "";
  const posture = configured ? Appearance.posture[eid] || "relaxed" : "";
  const condition = configured ? Appearance.condition[eid] || "" : "";
  // The legacy visiblyHolding cache can contain the first inventory item. Only
  // actual hand equipment or a live manual operation puts an object on camera.
  const visiblyHolding = heldItems.map((item) => item.name).join(" and ");
  const description = [
    `${name}${identityDescription ? `: ${identityDescription}` : ""}`,
    clothing ? `wearing ${clothing}` : "",
    accessories ? `accessories: ${accessories}` : "",
    expression ? `expression: ${expression}` : "",
    posture ? `posture: ${posture}` : "",
    condition ? `condition: ${condition}` : "",
    visiblyHolding ? `holding ${visiblyHolding}` : "",
  ].filter(Boolean).join(". ");
  return Object.freeze({ eid, name, identity, clothing, accessories, wornGarments, expression, posture, condition,
    visiblyHolding, possessedItems, heldItems, description });
}
