import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "ResourceReplenishmentSystem";
export const description = "Automatically refills natural or commercial sources over time";
export const frequency = 10;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const ResourceContainer = ctx.getDynamic("ResourceContainer");
  if (!ResourceContainer) return;
  
  const { Name } = ctx.components;
  const entities = Array.from(ctx.query(world, [Name])).filter(eid => 
    ResourceContainer.currentStock?.[eid] !== undefined
  );
  
  for (const eid of entities) {
    const currentStock = ResourceContainer.currentStock[eid] ?? 0;
    const maxStock = ResourceContainer.maxStock[eid] ?? 0;
    const replenishRate = ResourceContainer.replenishRate[eid] ?? 0;
  
    if (currentStock < maxStock) {
      ResourceContainer.currentStock[eid] = Math.min(maxStock, currentStock + replenishRate);
    }
  }
}
