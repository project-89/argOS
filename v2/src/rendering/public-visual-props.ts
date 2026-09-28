import { entityExists, hasComponent } from "bitecs";
import type { World } from "../ecs/world";
import { Agent, PhysicalObject, Traits } from "../ecs/components";

/** A sensory emitter is not necessarily a visible object. The object manager
 * also attaches PhysicalObject to abstract ambient sources; their semantic
 * traits distinguish them from real lamps/phones that happen to emit stimuli.
 * Location, open-container visibility and held-state checks remain the caller's
 * responsibility. Never classify an object by its generated display name. */
export function isPublicVisualProp(world: World, eid: number): boolean {
  if (!entityExists(world, eid) || !hasComponent(world, eid, PhysicalObject) || hasComponent(world, eid, Agent)) return false;
  let traits: unknown = [];
  try { if (hasComponent(world, eid, Traits)) traits = JSON.parse(Traits.active[eid] || "[]"); } catch { /* Legacy objects may lack valid trait metadata. */ }
  const tags = new Set(Array.isArray(traits) ? traits.filter((tag): tag is string => typeof tag === "string") : []);
  return !(tags.has("ambient") && tags.has("stimulus_source"))
    && !["hidden", "invisible", "concealed"].some(tag => tags.has(tag));
}
