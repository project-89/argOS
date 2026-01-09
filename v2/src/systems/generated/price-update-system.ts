import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "PriceUpdateSystem";
export const description = "Adjusts price based on the ratio of Supply vs Demand";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const MarketState = ctx.getDynamic("MarketState");
  const { Name } = ctx.components;
  
  if (!MarketState) return;
  
  const markets = Array.from(ctx.query(world, [Name])).filter(eid => 
    MarketState.currentPrice?.[eid] !== undefined
  );
  
  for (const eid of markets) {
    const supply = MarketState.totalSupply[eid] ?? 0;
    const demand = MarketState.totalDemand[eid] ?? 0;
    const currentPrice = MarketState.currentPrice[eid] ?? 0;
  
    const ratio = demand / (supply + 0.001);
    let priceChange = 0;
  
    if (ratio > 1.0) {
      priceChange = 0.05 * (ratio - 1.0);
    } else {
      priceChange = -0.05 * (1.0 - ratio);
    }
  
    MarketState.currentPrice[eid] = Math.max(0.1, currentPrice + priceChange);
  }
}
