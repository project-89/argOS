import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "VegetationGrowthSystem";
export const description = "Regenerates producer populations based on logistic growth.";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const Population = ctx.getDynamic("Population");
  const Autotroph = ctx.getDynamic("Autotroph");
  
  if (!Population || !Autotroph) return;
  
  const { Name } = ctx.components;
  const entities = Array.from(ctx.query(world, [Name])).filter(eid => 
    Population.current?.[eid] !== undefined && 
    Autotroph.growth_rate?.[eid] !== undefined
  );
  
  for (const eid of entities) {
    const current = Population.current[eid];
    const max = Population.max_capacity[eid];
    const rate = Autotroph.growth_rate[eid];
  
    if (max > 0) {
      const growth = rate * current * (1 - (current / max));
      Population.current[eid] = current + growth;
    }
  }
}
