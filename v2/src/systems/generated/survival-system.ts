import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "SurvivalSystem";
export const description = "Handles survivor needs and resource consumption.";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const { Name } = ctx.components;
  const Inventory = ctx.getDynamic("Inventory");
  const Needs = ctx.components.Needs;
  
  if (!Needs || !Inventory) return;
  
  const agents = Array.from(ctx.query(world, [Name, Needs]));
  
  for (const eid of agents) {
    // Brutal hunger decay
    const currentHunger = Needs.hunger[eid] || 0;
    Needs.hunger[eid] = Math.min(100, currentHunger + 0.5);
    
    if (Needs.hunger[eid] > 90) {
      ctx.log(`FATAL: ${Name.value[eid]} is dying of starvation!`);
    } else if (Needs.hunger[eid] > 70) {
      ctx.log(`WARNING: ${Name.value[eid]} is ravenous.`);
    }
    
    // Auto-eat if has meat
    const meatCount = Inventory.meat[eid] || 0;
    if (Needs.hunger[eid] > 50 && meatCount > 0) {
      Inventory.meat[eid] = meatCount - 1;
      Needs.hunger[eid] = Math.max(0, Needs.hunger[eid] - 40);
      ctx.log(`${Name.value[eid]} ate some meat. Hunger is now ${Math.round(Needs.hunger[eid])}.`);
    }
  }
}
