import { hasComponent } from "bitecs";
import type { World } from "../ecs/world";
import { Agent, Inventory, Name, Room, Traits } from "../ecs/components";
import { getDirectContainer, getRoomForEntity } from "../ecs/location";
import { getAgentVisibleEntities, isPublicContainerOpen } from "./world-capabilities";

export const storedInventoryActions = ["pickup", "give", "drop"] as const;
type InventoryStep = { actionType: string; target?: string; content?: string };

/** Local, explicit possession effects only. Never predicts travel, opened locks,
 * discovered items, package effects, or another actor's cooperative decisions. */
export type PlanningInventoryProjection = Map<number, number>;

function traits(world: World, eid: number): string[] {
  if (!hasComponent(world, eid, Traits)) return [];
  try { const parsed = JSON.parse(Traits.active[eid] || "[]"); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}

export function inventoryStepIssue(world: World, agentEid: number, step: InventoryStep,
  projection?: PlanningInventoryProjection): string | undefined {
  const room = getRoomForEntity(world, agentEid);
  if (!hasComponent(world, agentEid, Inventory)) return "actor has no inventory";
  if (room === undefined) return "actor has no grounded room";
  const visible = getAgentVisibleEntities(world, agentEid);
  const resolve = (name: string | undefined): number | undefined => {
    const wanted = String(name || "").trim().toLowerCase();
    if (!wanted) return undefined;
    const matches = visible.filter(id => String(Name.value[id] || "").trim().toLowerCase() === wanted);
    return matches.length === 1 ? matches[0] : undefined;
  };
  const holder = (id: number) => projection?.get(id) ?? getDirectContainer(world, id);
  const item = resolve(step.actionType === "give" ? step.content : step.target);
  if (item === undefined || hasComponent(world, item, Agent) || hasComponent(world, item, Room)) return "item must identify one visible or held object";

  if (step.actionType === "pickup") {
    if (!traits(world, item).includes("takeable")) return "item is not currently takeable";
    // Keep the same open-containment reach rule as the native executor, with
    // additional visibility and non-agent-owner constraints. Seeing an item in
    // someone's hands does not make it ground loot.
    let cursor = item, reachable = false;
    for (let depth = 0; depth < 32; depth++) {
      const parent = holder(cursor);
      if (parent === room) { reachable = true; break; }
      if (parent === undefined || hasComponent(world, parent, Agent)
        || !isPublicContainerOpen(world, parent)) break;
      cursor = parent;
    }
    if (!reachable) return "item is not directly accessible through open containers here";
    projection?.set(item, agentEid);
    return undefined;
  }

  if (holder(item) !== agentEid) return "actor does not hold the item";
  if (step.actionType === "drop") { projection?.set(item, room); return undefined; }
  const recipient = resolve(step.target);
  if (recipient === undefined || recipient === agentEid || !hasComponent(world, recipient, Agent)
    || !hasComponent(world, recipient, Inventory) || getRoomForEntity(world, recipient) !== room) {
    return "recipient must identify one other visible, co-located actor with inventory";
  }
  projection?.set(item, recipient);
  return undefined;
}
