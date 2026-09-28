import { entityExists, hasComponent } from "bitecs";
import type { World } from "./world";
import { Container, Inventory, Item, Name, PhysicalObject, Surface } from "./components";
import { getDirectContainer, listDirectContents, setLocatedIn } from "./location";
import { isEntityPresent } from "./entity-presence";

/**
 * Inventory helpers.
 *
 * Canonical inventory contents are derived from `LocatedIn(holderEid)`.
 * `Inventory.items` and `Inventory.weight` are treated as cached projections.
 */

export const DEFAULT_INVENTORY_LIMITS = Object.freeze({ maxSlots: 10, maxWeight: 50 });

export function initializeInventory(eid: number, maxSlots: number = DEFAULT_INVENTORY_LIMITS.maxSlots, maxWeight: number = DEFAULT_INVENTORY_LIMITS.maxWeight): void {
  Inventory.items[eid] = "[]";
  Inventory.maxSlots[eid] = maxSlots;
  Inventory.weight[eid] = 0;
  Inventory.maxWeight[eid] = maxWeight;
}

export function hasInventory(world: World, eid: number): boolean {
  return hasComponent(world, eid, Inventory);
}

export function getInventoryItems(world: World, holderEid: number): number[] {
  return listDirectContents(world, holderEid).filter((childEid) => isEntityPresent(world, childEid));
}

export function syncInventoryCache(world: World, holderEid: number): void {
  if (!entityExists(world, holderEid)) return;
  const items = getInventoryItems(world, holderEid);
  // Containers/surfaces use the same containment graph even without an agent
  // Inventory component. These counts remain projections, never inspection proof.
  if (hasComponent(world, holderEid, Container)) Container.currentCount[holderEid] = items.length;
  if (hasComponent(world, holderEid, Surface)) Surface.currentCount[holderEid] = items.length;
  if (!hasInventory(world, holderEid)) return;
  Inventory.items[holderEid] = JSON.stringify(items);

  let totalWeight = 0;
  for (const itemEid of items) {
    totalWeight += PhysicalObject.weight[itemEid] ?? Item.weight[itemEid] ?? 1;
  }
  Inventory.weight[holderEid] = totalWeight;
}

export type InventoryTransferResult = { success: true } | { success: false; reason: string };

export function tryAddToInventory(world: World, holderEid: number, itemEid: number): InventoryTransferResult {
  if(!isEntityPresent(world,holderEid)||!isEntityPresent(world,itemEid))return {success:false,reason:"Holder or item is no longer physically present"};
  if (!hasInventory(world, holderEid)) {
    return { success: false, reason: `Entity ${holderEid} has no inventory` };
  }

  syncInventoryCache(world, holderEid);

  const currentItems = getInventoryItems(world, holderEid);
  const maxSlots = Inventory.maxSlots[holderEid] ?? 0;
  if (currentItems.length >= maxSlots) {
    return { success: false, reason: "Inventory is full" };
  }

  const currentWeight = Inventory.weight[holderEid] || 0;
  const maxWeight = Inventory.maxWeight[holderEid] ?? 0;
  const itemWeight = PhysicalObject.weight[itemEid] ?? Item.weight[itemEid] ?? 1;
  if (currentWeight + itemWeight > maxWeight) {
    return { success: false, reason: "Item is too heavy" };
  }

  const previousContainer = getDirectContainer(world, itemEid);
  setLocatedIn(world, itemEid, holderEid);
  syncInventoryCache(world, holderEid);
  if (previousContainer !== undefined) syncInventoryCache(world, previousContainer);

  return { success: true };
}

export function addToInventory(world: World, holderEid: number, itemEid: number): boolean {
  return tryAddToInventory(world, holderEid, itemEid).success;
}

export function tryRemoveFromInventory(
  world: World,
  holderEid: number,
  itemEid: number,
  destinationEid: number
): InventoryTransferResult {
  if(!isEntityPresent(world,holderEid)||!isEntityPresent(world,itemEid)||!isEntityPresent(world,destinationEid))
    return {success:false,reason:"Inventory transfer endpoint is no longer physically present"};
  const container = getDirectContainer(world, itemEid);
  if (container !== holderEid) {
    return { success: false, reason: `Item ${itemEid} not in inventory of entity ${holderEid}` };
  }

  setLocatedIn(world, itemEid, destinationEid);
  syncInventoryCache(world, holderEid);
  syncInventoryCache(world, destinationEid);

  return { success: true };
}

export function removeFromInventory(world: World, holderEid: number, itemEid: number, destinationEid: number): boolean {
  return tryRemoveFromInventory(world, holderEid, itemEid, destinationEid).success;
}

export function hasItem(world: World, holderEid: number, itemEid: number): boolean {
  return isEntityPresent(world,itemEid) && getDirectContainer(world, itemEid) === holderEid;
}

export function formatInventory(world: World, eid: number): string {
  const items = getInventoryItems(world, eid);
  if (items.length === 0) {
    return "Your inventory is empty.";
  }

  const itemNames = items.map((itemEid) => Name.value[itemEid] || "Unknown Item");
  return `You are carrying: ${itemNames.join(", ")}`;
}
