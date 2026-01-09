import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "TrophicDynamicsSystem";
export const description = "Handles consumption, calculates births based on food, and applies starvation deaths";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const Population = ctx.getDynamic("Population");
  const Metabolism = ctx.getDynamic("Metabolism");
  
  if (Population && Metabolism) {
    const { Name } = ctx.components;
    const entities = Array.from(ctx.query(world, [Name])).filter(eid => 
      Population.current?.[eid] !== undefined && 
      Metabolism.prey_entity_id?.[eid] !== undefined
    );
  
    for (const i of entities) {
      const prey_id = Metabolism.prey_entity_id[i];
      
      // Skip if prey is invalid or has no population data
      if (prey_id === undefined || Population.current[prey_id] === undefined) continue;
  
      // 1. Determine Demand vs Supply
      const predator_count = Population.current[i];
      const prey_count = Population.current[prey_id];
      const total_demand = predator_count * Metabolism.appetite[i];
      
      // Limit consumption to 50% of prey population to prevent instant extinction
      const max_eatable = prey_count * 0.5;
      const actual_eaten = Math.min(total_demand, max_eatable);
      
      // 2. Update Prey Population (Reduction)
      const prey_min = Population.min_threshold[prey_id] ?? 0;
      Population.current[prey_id] = Math.max(prey_count - actual_eaten, prey_min);
      
      // 3. Calculate Predator Dynamics
      const satisfaction_ratio = actual_eaten / Math.max(total_demand, 0.001);
      
      // Births depend on food consumed * efficiency
      const births = actual_eaten * Metabolism.efficiency[i];
      
      // Deaths scale up significantly if satisfaction is low (Starvation)
      const base_deaths = predator_count * Metabolism.mortality_rate[i];
      const starvation_penalty = 1.0 + (1.0 - satisfaction_ratio) * 2.0;
      const total_deaths = base_deaths * starvation_penalty;
      
      // 4. Update Predator Population
      const new_pop = predator_count + births - total_deaths;
      const predator_min = Population.min_threshold[i] ?? 0;
      const predator_max = Population.max_capacity[i] ?? Infinity;
      
      Population.current[i] = Math.max(predator_min, Math.min(new_pop, predator_max));
    }
  }
}
