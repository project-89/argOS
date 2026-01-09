import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "PredationSystem";
export const description = "Calculates biomass transfer from prey to predator. Handles the 'eating' logic.";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const Population = ctx.getDynamic("Population");
  const Consumer = ctx.getDynamic("Consumer");
  
  if (!Population || !Consumer) return;
  
  const { Name } = ctx.components;
  const entities = Array.from(ctx.query(world, [Name])).filter(eid => 
    Population.current?.[eid] !== undefined && 
    Consumer.target_entity_id?.[eid] !== undefined
  );
  
  for (const i of entities) {
    const prey_id = Consumer.target_entity_id[i];
    
    // Validate prey exists and has population data
    if (prey_id === undefined || Population.current[prey_id] === undefined) continue;
  
    const pred_count = Population.current[i] || 0;
    const prey_count = Population.current[prey_id] || 0;
  
    // Mass action: encounters depend on both populations
    const encounter_rate = Consumer.interaction_rate[i] || 0;
    const attempted_consumption = pred_count * prey_count * encounter_rate;
  
    // Ensure we don't eat prey into extinction (preserve min threshold)
    const min_threshold = Population.min_threshold[prey_id] || 0;
    const available_prey = Math.max(0, prey_count - min_threshold);
    const actual_eaten = Math.min(attempted_consumption, available_prey);
  
    // Remove from prey, store energy in predator
    Population.current[prey_id] -= actual_eaten;
    Consumer.energy_gained[i] = actual_eaten;
  }
}
