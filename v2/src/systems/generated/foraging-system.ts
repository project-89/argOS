import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "ForagingSystem";
export const description = "Processes foraging actions to reduce hunger and deplete resources.";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const Forageable = ctx.getDynamic("Forageable");
  const Vitals = ctx.getDynamic("Vitals");
  if (!Forageable || !Vitals) return;
  
  const { Agent, Name, CurrentAction, GridPosition } = ctx.components;
  const agents = Array.from(ctx.query(world, [Agent, CurrentAction, GridPosition]));
  
  for (const eid of agents) {
    const action = CurrentAction.type[eid];
    const targetEid = CurrentAction.targetEid[eid];
  
    if ((action === "forage" || action === "harvest") && targetEid) {
      // Check proximity
      const ax = GridPosition.x[eid];
      const ay = GridPosition.y[eid];
      const tx = GridPosition.x[targetEid];
      const ty = GridPosition.y[targetEid];
      
      if (tx === undefined || ty === undefined) continue;
  
      const dist = Math.sqrt(Math.pow(ax - tx, 2) + Math.pow(ay - ty, 2));
      
      if (dist < 2) {
        const quantity = Forageable.quantity[targetEid];
        if (quantity > 0) {
          Forageable.quantity[targetEid] -= 1;
          
          // Effects based on item type
          const type = Forageable.itemType[targetEid];
          if (type === "berries" || type === "meat") {
            Vitals.hunger[eid] = Math.max(0, Vitals.hunger[eid] - 15);
            ctx.log(`${Name.value[eid]} foraged ${type} from ${Name.value[targetEid]} and ate.`);
          } else if (type === "wood") {
            // Maybe wood goes into an inventory? For now just log it.
            ctx.log(`${Name.value[eid]} gathered wood from ${Name.value[targetEid]}.`);
          }
          
          if (Forageable.quantity[targetEid] <= 0) {
            ctx.log(`The ${Name.value[targetEid]} has been depleted.`);
          }
        } else {
          ctx.log(`${Name.value[eid]} tried to forage from ${Name.value[targetEid]} but it is empty.`);
        }
      } else {
        ctx.log(`${Name.value[eid]} is too far away from ${Name.value[targetEid]} to forage.`);
      }
    }
  }
}
