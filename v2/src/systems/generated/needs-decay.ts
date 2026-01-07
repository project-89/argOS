import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "NeedsDecay";
export const description = "Decreases agent needs over time (hunger increases, energy decreases)";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const { Needs, Agent, Name } = ctx.components;
  const agents = Array.from(ctx.query(world, [Agent, Needs]));
  
  for (const eid of agents) {
    const hunger = Needs.hunger[eid] ?? 50;
    const energy = Needs.energy[eid] ?? 50;
    
    Needs.hunger[eid] = Math.min(100, hunger + 1);
    Needs.energy[eid] = Math.max(0, energy - 0.5);
    
    if (Needs.hunger[eid] >= 80) {
      ctx.log(`${Name.value[eid]} is getting hungry (${Math.round(Needs.hunger[eid])})`);
    }
    if (Needs.energy[eid] <= 20) {
      ctx.log(`${Name.value[eid]} is getting tired (${Math.round(Needs.energy[eid])})`);
    }
  }
}
