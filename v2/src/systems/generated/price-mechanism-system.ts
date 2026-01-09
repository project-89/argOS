import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "PriceMechanismSystem";
export const description = "Adjusts the price based on the Supply/Demand ratio gathered in the previous step.";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const ResourceMarket = ctx.getDynamic("ResourceMarket");
  if (!ResourceMarket) return;
  
  const { Name } = ctx.components;
  
  const markets = Array.from(ctx.query(world, [Name])).filter(eid =>
    ResourceMarket.resource_id?.[eid] !== undefined
  );
  
  for (const eid of markets) {
    const supply = ResourceMarket.total_supply[eid] ?? 0;
    const demand = ResourceMarket.total_demand[eid] ?? 0;
    const volatility = ResourceMarket.price_volatility[eid] ?? 0;
    let price = ResourceMarket.current_price[eid] ?? 0;
  
    const ratio = demand / Math.max(supply, 1);
  
    if (ratio > 1) {
      // Price Up
      price += price * volatility;
    } else if (ratio < 1) {
      // Price Down
      price -= price * volatility;
    }
  
    // Ensure price stays above 0.1
    if (price < 0.1) {
      price = 0.1;
    }
  
    ResourceMarket.current_price[eid] = price;
  }
}
