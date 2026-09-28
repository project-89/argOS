/** Single-unit consumables over existing ECS columns. No shadow inventory.
 * These commit primitives do not grant an action: the caller must admit reach,
 * possession, identities and duration, then invoke them at physical completion.
 * Labels, animation, needs and receipts belong to that executor, not quantity law.
 */
import { entityExists, hasComponent, type ComponentRef } from "bitecs";
import type { World } from "../ecs/world";
import { assertSimulationTaskActive } from "../runtime/task-scope";

export interface PortionSupplyStore {
  component: ComponentRef;
  quantities: { [eid: number]: number };
}
export interface PortionVesselStore {
  component: ComponentRef;
  filled: { [eid: number]: boolean };
  consumed: { [eid: number]: number };
}
const count = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) >= 0;
export function hasFinitePortions(world: World, store: PortionSupplyStore, eid: number): boolean {
  return entityExists(world, eid) && hasComponent(world, eid, store.component)
    && count(store.quantities[eid]) && store.quantities[eid] > 0;
}
export function isPortionVessel(world: World, store: PortionVesselStore, eid: number, filled: boolean): boolean {
  return entityExists(world, eid) && hasComponent(world, eid, store.component)
    && store.filled[eid] === filled && count(store.consumed[eid]) && store.consumed[eid] < Number.MAX_SAFE_INTEGER;
}
export function transferSinglePortion(world: World, supply: PortionSupplyStore, vessel: PortionVesselStore,
  sourceEid: number, vesselEid: number, expectedSupply: number): boolean {
  assertSimulationTaskActive();
  if (sourceEid === vesselEid || !count(expectedSupply) || !hasFinitePortions(world, supply, sourceEid)
    || supply.quantities[sourceEid] !== expectedSupply || !isPortionVessel(world, vessel, vesselEid, false)) return false;
  supply.quantities[sourceEid]--; vessel.filled[vesselEid] = true;
  return true;
}
export function consumeSinglePortion(world: World, vessel: PortionVesselStore, vesselEid: number, expectedConsumed: number): boolean {
  assertSimulationTaskActive();
  if (!count(expectedConsumed) || !isPortionVessel(world, vessel, vesselEid, true)
    || vessel.consumed[vesselEid] !== expectedConsumed) return false;
  vessel.filled[vesselEid] = false; vessel.consumed[vesselEid]++;
  return true;
}
