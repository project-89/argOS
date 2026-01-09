import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "FireSystem";
export const description = "Campfires consume fuel over time and go out when empty.";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const { Name } = ctx.components;
  const Fuel = ctx.getDynamic("Fuel");
  const ObjectState = ctx.getDynamic("ObjectState");
  
  if (!Fuel || !ObjectState) return;
  
  const entities = Array.from(ctx.query(world, [Name])).filter(eid => ctx.hasDynamic(eid, "Fuel"));
  
  for (const eid of entities) {
    // If it's a burning campfire, reduce fuel
    if (ObjectState.state[eid] === 'burning') {
      Fuel.current[eid] -= 0.5;
      
      if (Fuel.current[eid] <= 0) {
        Fuel.current[eid] = 0;
        ObjectState.state[eid] = 'out';
        ctx.emit("narrative_event", { content: `${Name.value[eid]} has burned out.` });
      }
    }
  }
}
