import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "NPCExecutionSystem";
export const description = "Executes actions defined in BehaviorPolicy.";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const { BehaviorPolicy, Needs, Room, Name } = ctx.components;
  const entities = Array.from(ctx.query(world, [BehaviorPolicy]));
  
  for (const eid of entities) {
    const action = BehaviorPolicy.action[eid];
    const target = BehaviorPolicy.target[eid];
    if (!action || action === "idle") continue;
  
    if (action === "eat") {
      Needs.hunger[eid] = Math.max(0, (Needs.hunger[eid] || 0) - 50);
      ctx.log(`${Name.value[eid]} ate at ${Name.value[target]}`);
      BehaviorPolicy.action[eid] = "idle";
    } else if (action === "sleep") {
      Needs.energy[eid] = Math.min(100, (Needs.energy[eid] || 0) + 50);
      ctx.log(`${Name.value[eid]} slept on ${Name.value[target]}`);
      BehaviorPolicy.action[eid] = "idle";
    } else if (action === "move") {
      Room.value[eid] = target;
      ctx.log(`${Name.value[eid]} moved to ${Name.value[target]}`);
      BehaviorPolicy.action[eid] = "idle";
    }
  }
}
