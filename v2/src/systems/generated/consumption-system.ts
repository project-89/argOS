import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "ConsumptionSystem";
export const description = "Simulates the usage of goods and clears inventory to prepare for next cycle.";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const Producer = ctx.getDynamic("Producer");
  const Consumer = ctx.getDynamic("Consumer");
  
  if (!Producer || !Consumer) return;
  
  const { Name } = ctx.components;
  const allEntities = Array.from(ctx.query(world, [Name]));
  
  // Logic for Producers: Clear inventory (simulating goods being sold/moved to market)
  const producers = allEntities.filter(eid => Producer.inventory?.[eid] !== undefined);
  for (const eid of producers) {
    Producer.inventory[eid] = 0;
  }
  
  // Logic for Consumers: Add desired amount to inventory (Bought) and then simulate consumption
  const consumers = allEntities.filter(eid => Consumer.inventory?.[eid] !== undefined);
  for (const eid of consumers) {
    const currentInventory = Consumer.inventory[eid] || 0;
    const amountBought = Consumer.desired_amount[eid] || 0;
    
    // Update inventory with newly acquired goods
    const totalStock = currentInventory + amountBought;
    
    // Optional: Decay/Consumption simulation
    // Consumers use up 90% of their total inventory per cycle (eating food/using wood)
    Consumer.inventory[eid] = Math.max(0, Math.floor(totalStock * 0.1));
  }
}
