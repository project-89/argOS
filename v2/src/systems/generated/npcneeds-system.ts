import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "NPCNeedsSystem";
export const description = "Decays agent needs over time.";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const { Needs } = ctx.components;
  const agents = Array.from(ctx.query(world, [Needs]));
  for (const eid of agents) {
    Needs.hunger[eid] = Math.min(100, (Needs.hunger[eid] || 0) + 2);
    Needs.energy[eid] = Math.max(0, (Needs.energy[eid] || 100) - 2);
  }
}
