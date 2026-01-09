import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "ResourceGrowthSystem";
export const description = "Applies logistic growth to producers (Grass) based on carrying capacity";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const Population = ctx.getDynamic("Population");
  const Regeneration = ctx.getDynamic("Regeneration");
  
  if (!Population || !Regeneration) return;
  
  const { Name } = ctx.components;
  const entities = Array.from(ctx.query(world, [Name])).filter(eid => 
    Population.current?.[eid] !== undefined && 
    Regeneration.rate?.[eid] !== undefined
  );
  
  for (const eid of entities) {
    const current_pop = Population.current[eid];
    const capacity = Population.max_capacity[eid];
    const growth_rate = Regeneration.rate[eid];
    const min_threshold = Population.min_threshold[eid];
  
    // Logistic growth formula: r * P * (1 - P/K)
    const growth_amount = growth_rate * current_pop * (1 - (current_pop / capacity));
    const new_pop = current_pop + growth_amount;
  
    // Clamp between min_threshold and max_capacity
    Population.current[eid] = Math.max(min_threshold, Math.min(new_pop, capacity));
  }
}
