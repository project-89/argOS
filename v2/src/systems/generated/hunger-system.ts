import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "HungerSystem";
export const description = "Increases agent hunger over time and emits narrative warnings.";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const { Needs, Name, Room } = ctx.components;
    const agents = Array.from(ctx.query(world, [Needs, Name]));
    
    for (const eid of agents) {
      const currentHunger = Needs.hunger[eid] ?? 0;
      // Hunger increases over time
      Needs.hunger[eid] = Math.min(100, currentHunger + 2);
      
      if (Needs.hunger[eid] > 80) {
        if (Room && Room.name && Room.name[eid]) {
          ctx.emit("narrative_event", { 
            content: `${Name.value[eid]}'s stomach growls loudly. They are starving!`,
            roomName: Room.name[eid]
          });
        } else {
          ctx.log(`Room component or room name missing for entity ${eid}`);
        }
      }
    }
}
