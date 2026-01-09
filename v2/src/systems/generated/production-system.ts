import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "ProductionSystem";
export const description = "Simulates the creation of goods based on current rates.";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const Producer = ctx.getDynamic("Producer");
  if (!Producer) return;
  
  const { Name } = ctx.components;
  
  const entities = Array.from(ctx.query(world, [Name])).filter(eid =>
    Producer.inventory?.[eid] !== undefined
  );
  
  for (const eid of entities) {
    const currentInventory = Producer.inventory[eid] || 0;
    const productionRate = Producer.production_rate[eid] || 0;
    const maxCapacity = Producer.max_capacity[eid] ?? Infinity;
  
    const nextInventory = currentInventory + productionRate;
  
    // Applying production while respecting max capacity if defined
    Producer.inventory[eid] = Math.min(nextInventory, maxCapacity);
  }
}
