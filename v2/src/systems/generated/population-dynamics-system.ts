import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "PopulationDynamicsSystem";
export const description = "Updates consumer populations based on energy gained (births) and natural mortality (deaths).";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const Population = ctx.getDynamic("Population");
  const Consumer = ctx.getDynamic("Consumer");
  const Metabolism = ctx.getDynamic("Metabolism");
  
  if (!Population || !Consumer || !Metabolism) return;
  
  const { Name } = ctx.components;
  const entities = Array.from(ctx.query(world, [Name])).filter(eid => 
    Population.current?.[eid] !== undefined &&
    Consumer.energy_gained?.[eid] !== undefined &&
    Metabolism.death_rate?.[eid] !== undefined
  );
  
  for (const eid of entities) {
    const consumed = Consumer.energy_gained[eid] || 0;
    const efficiency = Consumer.conversion_efficiency[eid] || 0;
    const deathRate = Metabolism.death_rate[eid] || 0;
    const currentPop = Population.current[eid] || 0;
    const minThreshold = Population.min_threshold[eid] || 0;
    const maxCapacity = Population.max_capacity[eid] || 0;
  
    const births = consumed * efficiency;
    const deaths = currentPop * deathRate;
    
    const newPop = currentPop + births - deaths;
    
    // Clamp results
    Population.current[eid] = Math.max(minThreshold, Math.min(maxCapacity, newPop));
    
    // Reset buffer
    Consumer.energy_gained[eid] = 0;
  }
}
