import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "LifeCycleSystem";
export const description = "Handles starvation and reproduction triggers.";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const Stats = ctx.getDynamic("EcosystemStats");
  if (!Stats) return;
  
  const { Name, GridPosition } = ctx.components;
  const entities = Array.from(ctx.query(world, [GridPosition]));
  
  // Limit total population to prevent chaos
  if (entities.length > 100) return;
  
  for (const eid of entities) {
    const type = Stats.type[eid];
    if (!type) continue;
    
    if (Stats.energy[eid] >= Stats.reproduceThreshold[eid]) {
      Stats.energy[eid] -= 40;
      
      // Position for offspring
      const x = Math.max(0, Math.min(29, GridPosition.x[eid] + (Math.random() > 0.5 ? 1 : -1)));
      const y = Math.max(0, Math.min(19, GridPosition.y[eid] + (Math.random() > 0.5 ? 1 : -1)));
  
      // Emit a spawn signal (the engine will handle the actual creation via the event)
      ctx.emit("spawn_offspring", { 
        type: type, 
        x: x, 
        y: y,
        parentName: Name.value[eid]
      });
      
      ctx.log(`${Name.value[eid]} (${type}) has reproduced at ${x},${y}`);
    }
  }
}
