import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "ProductionConsumptionSystem";
export const description = "Executes the physical creation and destruction of resources based on calculated rates";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const ProducerParams = ctx.getDynamic("ProducerParams");
  const ConsumerParams = ctx.getDynamic("ConsumerParams");
  const Inventory = ctx.getDynamic("Inventory");
  
  if (!Inventory) return;
  
  const { Name } = ctx.components;
  const entities = Array.from(ctx.query(world, [Name]));
  
  for (const eid of entities) {
    // Ensure the entity has an inventory to modify
    if (Inventory.amount?.[eid] === undefined) continue;
  
    // IF Producer: Inventory.amount[id] += ProducerParams.currentProductionRate[id]
    if (ProducerParams && ProducerParams.currentProductionRate?.[eid] !== undefined) {
      const production = ProducerParams.currentProductionRate[eid] || 0;
      Inventory.amount[eid] = (Inventory.amount[eid] || 0) + production;
    }
  
    // IF Consumer: Inventory.amount[id] = MAX(0, Inventory.amount[id] - ConsumerParams.currentDemand[id])
    if (ConsumerParams && ConsumerParams.currentDemand?.[eid] !== undefined) {
      const currentStock = Inventory.amount[eid] || 0;
      const demand = ConsumerParams.currentDemand[eid] || 0;
      Inventory.amount[eid] = Math.max(0, currentStock - demand);
    }
  }
}
