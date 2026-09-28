/** Pure physical hand projection shared by rendering and observer admission.
 * No inventory-derived guesses, state/description reads, or execution authority. */
import { hasComponent } from "bitecs";
import { Agent, EquipSlot, PhysicalObject, Traits } from "./components";
import type { World } from "./world";
import { isEntityPresent } from "./entity-presence";
import { getDirectContainer, listDirectContents } from "./location";
import { getSimulationBodyActivity } from "../runtime/simulation-timeline";

export const HAND_SLOTS = ["mainHand", "offHand"] as const;
const hands = new Set<string>(HAND_SLOTS);
function concealed(world: World, eid: number): boolean {
  if (!isEntityPresent(world, eid)) return true;
  if (!hasComponent(world, eid, Traits)) return false;
  try { const traits = JSON.parse(Traits.active[eid] || "[]");
    return Array.isArray(traits) && traits.some(t => typeof t === "string"
      && ["hidden", "concealed", "invisible"].includes(t.trim().toLowerCase()));
  } catch { return false; }
}
export function getPhysicalHeldItems(world: World, holder: number): readonly Readonly<{ eid: number; slot: string }>[] {
  if (concealed(world, holder) || !hasComponent(world, holder, Agent)) return [];
  const activity = getSimulationBodyActivity(world, holder);
  const activeTarget = activity?.kind === "operating" && activity.operation
    && ["reading", "typing", "using", "eating"].includes(activity.operation) ? activity.targetEid : undefined;
  return Object.freeze(listDirectContents(world, holder).filter(eid => !concealed(world, eid)
    && hasComponent(world, eid, PhysicalObject) && getDirectContainer(world, eid) === holder).flatMap(eid => {
      const slot = hasComponent(world, eid, EquipSlot) && EquipSlot.equippedBy[eid] === holder && hands.has(EquipSlot.slot[eid])
        ? EquipSlot.slot[eid] : eid === activeTarget && PhysicalObject.portable[eid] ? "activeHand" : undefined;
      return slot ? [Object.freeze({ eid, slot })] : [];
    }).sort((a, b) => a.eid - b.eid));
}
