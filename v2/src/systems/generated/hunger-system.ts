import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "HungerSystem";
export const description = "Increases hunger and thirst over time, damaging health if they get too high.";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const Vitals = ctx.getDynamic("Vitals");
  if (!Vitals) return;
  
  const { Agent, Name } = ctx.components;
  const agents = Array.from(ctx.query(world, [Agent]));
  
  for (const eid of agents) {
    if (Vitals.hunger[eid] !== undefined) {
      Vitals.hunger[eid] = Math.min(100, Vitals.hunger[eid] + 0.5);
      if (Vitals.hunger[eid] >= 90) {
        Vitals.health[eid] = Math.max(0, Vitals.health[eid] - 1);
        ctx.log(`${Name.value[eid]} is starving!`);
      }
    }
    if (Vitals.hydration[eid] !== undefined) {
      Vitals.hydration[eid] = Math.min(100, Vitals.hydration[eid] + 0.8);
      if (Vitals.hydration[eid] >= 90) {
        Vitals.health[eid] = Math.max(0, Vitals.health[eid] - 1);
        ctx.log(`${Name.value[eid]} is extremely thirsty!`);
      }
    }
  }
}
