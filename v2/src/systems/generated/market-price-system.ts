import type { World } from "../../ecs/world";
import { integrateLegacyRateSteps } from "../legacy-rate-time";
import type { SystemContext } from "../system-loader";

export const name = "MarketPriceSystem";
export const description = "Updates prices for goods based on supply and demand.";
export const frequency = 10;
export const active = true;

export const temporalStepMs = 10000; // Explicit in-world duration for one historical law step.
export function run(world: World, ctx: SystemContext): void {
  integrateLegacyRateSteps(world, ctx, "market-price-system", temporalStepMs, runLaw);
}
function runLaw(world: World, ctx: SystemContext): void {
  const Price = ctx.getDynamic("Price");
  if (!Price) return;
  const { Name } = ctx.components;
  const entities = Array.from(ctx.query(world, [Name]));
  for (const eid of entities) {
    if (Price.current[eid] === undefined) continue;
    const supply = Price.supply[eid] ?? 50;
    const demand = Price.demand[eid] ?? 50;
    const base = Price.base[eid] ?? 10;
    
    const targetPrice = base * (demand / Math.max(1, supply));
    const diff = targetPrice - Price.current[eid];
    Price.current[eid] += diff * 0.1;
    
    Price.demand[eid] = Math.max(1, demand + (Math.random() - 0.5) * 2);
  }
}
