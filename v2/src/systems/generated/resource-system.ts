import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "ResourceSystem";
export const description = "Handles stove fuel consumption and shared resource tracking.";
export const frequency = 6;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const StoveState = ctx.getDynamic("StoveState");
  const OutpostResources = ctx.getDynamic("OutpostResources");
  const { Name } = ctx.components;
  
  if (!StoveState || !OutpostResources) return;
  
  const stoveEntity = Array.from(ctx.query(world, [Name])).find(eid => Name.value[eid] === "Iron Stove");
  const controllerEntity = Array.from(ctx.query(world, [Name])).find(eid => Name.value[eid] === "Outpost Controller");
  
  if (!stoveEntity || !controllerEntity) return;
  
  // Stove fuel consumption (frequency 6 = every 60s roughly if tick is 10s)
  if (StoveState.burning[stoveEntity]) {
    StoveState.fuelLevel[stoveEntity] -= 10;
    
    if (StoveState.fuelLevel[stoveEntity] <= 0) {
      if (OutpostResources.wood[controllerEntity] > 0) {
        // Auto-refuel if wood exists (for sim simplicity, or we can make agents do it)
        OutpostResources.wood[controllerEntity] -= 1;
        StoveState.fuelLevel[stoveEntity] = 100;
        ctx.log("Stove refueled from wood pile.");
      } else {
        StoveState.burning[stoveEntity] = false;
        ctx.log("The stove has gone out! No more wood!");
        ctx.emit("broadcast", { content: "the wood stove sputters and dies. The cabin begins to cool rapidly.", modality: "visual" });
      }
    }
  }
  
  // Log status
  ctx.log(`Status: Food: ${OutpostResources.food[controllerEntity]}, Wood: ${OutpostResources.wood[controllerEntity]}, Stove Fuel: ${StoveState.fuelLevel[stoveEntity]}%`);
}
