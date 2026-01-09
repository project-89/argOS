import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "MarketReportingSystem";
export const description = "Aggregates global Supply (from Producers) and Demand (from Consumers) into the Market entities. Resets totals before counting.";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const ResourceMarket = ctx.getDynamic("ResourceMarket");
  const Producer = ctx.getDynamic("Producer");
  const Consumer = ctx.getDynamic("Consumer");
  
  if (!ResourceMarket || !Producer || !Consumer) return;
  
  const { Name } = ctx.components;
  const entities = Array.from(ctx.query(world, [Name]));
  
  const marketEntities = entities.filter(eid => ResourceMarket.resource_id[eid] !== undefined);
  const producerEntities = entities.filter(eid => Producer.resource_id[eid] !== undefined);
  const consumerEntities = entities.filter(eid => Consumer.resource_id[eid] !== undefined);
  
  for (const eid of marketEntities) {
    ResourceMarket.total_supply[eid] = 0;
    ResourceMarket.total_demand[eid] = 0;
  }
  
  for (const eid of producerEntities) {
    const rId = Producer.resource_id[eid];
    const inv = Producer.inventory[eid] || 0;
    const marketEid = marketEntities.find(m => ResourceMarket.resource_id[m] === rId);
    if (marketEid !== undefined) {
      ResourceMarket.total_supply[marketEid] = (ResourceMarket.total_supply[marketEid] || 0) + inv;
    }
  }
  
  for (const eid of consumerEntities) {
    const rId = Consumer.resource_id[eid];
    const desired = Consumer.desired_amount[eid] || 0;
    const marketEid = marketEntities.find(m => ResourceMarket.resource_id[m] === rId);
    if (marketEid !== undefined) {
      ResourceMarket.total_demand[marketEid] = (ResourceMarket.total_demand[marketEid] || 0) + desired;
    }
  }
}
