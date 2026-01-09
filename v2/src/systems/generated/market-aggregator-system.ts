import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "MarketAggregatorSystem";
export const description = "Calculates global Supply (total inventory) and Demand (total desire) for each resource type";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const ResourceType = ctx.getDynamic("ResourceType");
  const MarketState = ctx.getDynamic("MarketState");
  const ProducerParams = ctx.getDynamic("ProducerParams");
  const ConsumerParams = ctx.getDynamic("ConsumerParams");
  const Inventory = ctx.getDynamic("Inventory");
  
  if (!ResourceType || !MarketState || !ConsumerParams || !Inventory) return;
  
  const { Name } = ctx.components;
  const entities = Array.from(ctx.query(world, [Name]));
  
  const marketLookup = new Map();
  
  for (const eid of entities) {
    const typeId = ResourceType.typeId?.[eid];
    if (typeId !== undefined && MarketState.totalSupply?.[eid] !== undefined) {
      MarketState.totalSupply[eid] = 0;
      MarketState.totalDemand[eid] = 0;
      marketLookup.set(typeId, eid);
    }
  }
  
  for (const eid of entities) {
    const typeId = ResourceType.typeId?.[eid];
    if (typeId === undefined) continue;
  
    const marketEid = marketLookup.get(typeId);
    if (marketEid === undefined) continue;
  
    const amount = Inventory.amount?.[eid];
    if (amount !== undefined) {
      MarketState.totalSupply[marketEid] += amount;
    }
  
    const demand = ConsumerParams.currentDemand?.[eid];
    if (demand !== undefined) {
      MarketState.totalDemand[marketEid] += demand;
    }
  }
}
