import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "BehaviorAdjustmentSystem";
export const description = "Producers and Consumers adjust their rates based on the latest market prices";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const ResourceType = ctx.getDynamic("ResourceType");
  const MarketState = ctx.getDynamic("MarketState");
  const ProducerParams = ctx.getDynamic("ProducerParams");
  const ConsumerParams = ctx.getDynamic("ConsumerParams");
  
  if (!ResourceType || !MarketState || !ProducerParams || !ConsumerParams) return;
  
  const { Name } = ctx.components;
  const allEntities = Array.from(ctx.query(world, [Name]));
  
  const marketPrices: Record<number, number> = {};
  
  for (const eid of allEntities) {
    const typeId = ResourceType.typeId?.[eid];
    const price = MarketState.currentPrice?.[eid];
    if (typeId !== undefined && price !== undefined) {
      marketPrices[typeId] = price;
    }
  }
  
  for (const eid of allEntities) {
    const typeId = ResourceType.typeId?.[eid];
    if (typeId === undefined) continue;
  
    const marketPrice = marketPrices[typeId] ?? 0;
  
    if (ProducerParams.baseProductionRate?.[eid] !== undefined) {
      const baseRate = ProducerParams.baseProductionRate[eid];
      const breakEven = ProducerParams.breakEvenPrice[eid] || 0;
      const elasticity = ProducerParams.elasticity[eid] || 0;
  
      const priceFactor = marketPrice - breakEven;
      const calculatedRate = baseRate * (1 + (priceFactor * elasticity));
      ProducerParams.currentProductionRate[eid] = Math.max(0, calculatedRate);
    }
  
    if (ConsumerParams.baseDemand?.[eid] !== undefined) {
      const baseDemand = ConsumerParams.baseDemand[eid];
      const maxBudget = ConsumerParams.maxBudget[eid] || 0;
      const elasticity = ConsumerParams.elasticity[eid] || 0;
  
      const affordability = maxBudget - marketPrice;
      const calculatedDemand = baseDemand * (1 + (affordability * elasticity));
      ConsumerParams.currentDemand[eid] = Math.max(0, calculatedDemand);
    }
  }
}
