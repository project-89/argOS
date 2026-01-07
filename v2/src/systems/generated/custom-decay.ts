import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "CustomDecay";
export const description = "Increases hunger by 2 and decreases energy by 1 for all agents with Needs, logging a message if hunger exceeds 50.";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const { Needs, Agent, Name } = ctx.components;
  const agents = Array.from(ctx.query(world, [Agent, Needs]));
  for (const eid of agents) {
    Needs.hunger[eid] = Math.min(100, (Needs.hunger[eid] ?? 0) + 2);
    Needs.energy[eid] = Math.max(0, (Needs.energy[eid] ?? 0) - 1);
    if (Needs.hunger[eid] > 50) {
      ctx.log(`${Name.value[eid]} is getting peckish`);
    }
  }
}
