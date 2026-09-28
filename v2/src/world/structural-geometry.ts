/** Native semantic classification, never a guess from a display name or prose. */
import { entityExists, hasComponent } from "bitecs";
import { Agent, ObjectType, Traits } from "../ecs/components";
import type { World } from "../ecs/world";
import { worldSchema } from "./schema";

export function isStructuralGeometry(world: World, eid: number): boolean {
  if (!entityExists(world, eid) || hasComponent(world, eid, Agent)) return false;
  if (hasComponent(world, eid, ObjectType)
    && worldSchema.getObjectType(ObjectType.typeId[eid])?.traits.includes("structural_geometry")) return true;
  if (!hasComponent(world, eid, Traits)) return false;
  try { const traits = JSON.parse(Traits.active[eid] || "[]"); return Array.isArray(traits) && traits.includes("structural_geometry"); }
  catch { return false; }
}
