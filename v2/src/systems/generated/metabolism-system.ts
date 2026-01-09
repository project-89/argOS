import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "MetabolismSystem";
export const description = "Handles hunger, thirst, and energy decay for all living beings.";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const Vitals = ctx.getDynamic("Vitals");
  const { Name } = ctx.components;
  if (!Vitals) return;
  
  const entities = ctx.query(world, [Name]);
  for (const eid of entities) {
    if (Vitals.health[eid] === undefined) continue;
  
    // Metabolic Decay
    Vitals.hunger[eid] = Math.max(0, (Vitals.hunger[eid] ?? 100) - 0.2);
    Vitals.hydration[eid] = Math.max(0, (Vitals.hydration[eid] ?? 100) - 0.3);
    Vitals.energy[eid] = Math.max(0, (Vitals.energy[eid] ?? 100) - 0.1);
  
    // Starvation/Dehydration Damage
    if (Vitals.hunger[eid] <= 0 || Vitals.hydration[eid] <= 0) {
      Vitals.health[eid] = Math.max(0, Vitals.health[eid] - 1);
      if (ctx.tick % 10 === 0) {
          ctx.log(`${Name.value[eid]} is wasting away...`);
      }
    }
  
    // Energy Recovery if Hunger/Hydration is good
    if (Vitals.hunger[eid] > 50 && Vitals.hydration[eid] > 50 && Vitals.energy[eid] < 100) {
      Vitals.energy[eid] = Math.min(100, Vitals.energy[eid] + 0.05);
    }
  }
}
