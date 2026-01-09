import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "AdaptiveBehaviorSystem";
export const description = "The Feedback Loop. Producers and Consumers read the NEW price and adjust their rates/desires for the NEXT tick.";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const ResourceMarket = ctx.getDynamic("ResourceMarket");
  const Producer = ctx.getDynamic("Producer");
  const Consumer = ctx.getDynamic("Consumer");
  const { Name } = ctx.components;
  
  if (!ResourceMarket || !Producer || !Consumer) return;
  
  const entities = Array.from(ctx.query(world, [Name]));
  
  // Map prices by resource_id for quick lookup
  const priceMap = new Map();
  for (const eid of entities) {
    if (ResourceMarket.resource_id?.[eid] !== undefined) {
      const rId = ResourceMarket.resource_id[eid];
      const price = ResourceMarket.current_price[eid] ?? 0;
      priceMap.set(rId, price);
    }
  }
  
  // Process Producers and Consumers
  for (const eid of entities) {
    // Logic 1: Producers
    if (Producer.resource_id?.[eid] !== undefined) {
      const rId = Producer.resource_id[eid];
      const price = priceMap.get(rId);
      
      if (price !== undefined) {
        const sensitivity = Producer.price_sensitivity[eid] ?? 0;
        const currentRate = Producer.production_rate[eid] ?? 0;
        
        // Assume 'high' is > 1.0 and 'low' is < 1.0 as a baseline pivot
        if (price > 1.0) {
          Producer.production_rate[eid] = currentRate + sensitivity;
        } else if (price < 1.0) {
          Producer.production_rate[eid] = Math.max(0, currentRate - sensitivity);
        }
      }
    }
  
    // Logic 2: Consumers
    if (Consumer.resource_id?.[eid] !== undefined) {
      const rId = Consumer.resource_id[eid];
      const price = priceMap.get(rId);
  
      if (price !== undefined) {
        const desired = Consumer.desired_amount[eid] ?? 0;
        const wallet = Consumer.wallet_limit[eid] ?? 0;
        const sensitivity = Consumer.price_sensitivity[eid] ?? 0;
  
        if (price * desired > wallet) {
          Consumer.desired_amount[eid] = Math.max(0, desired - sensitivity);
        } else {
          Consumer.desired_amount[eid] = desired + sensitivity;
        }
      }
    }
  }
}
