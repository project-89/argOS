import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "WanderMovement";
export const description = "Moves entities with the Wanderer component in random directions on the grid.";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const Wanderer = ctx.getDynamic("Wanderer");
  if (!Wanderer) return;
  
  const { Name, GridPosition } = ctx.components;
  const entities = Array.from(ctx.query(world, [Name, GridPosition]));
  
  for (const eid of entities) {
    if (!ctx.hasDynamic(eid, "Wanderer")) continue;
    
    const interval = Wanderer.interval[eid] ?? 5;
    const lastMove = Wanderer.lastMove[eid] ?? 0;
    
    if (ctx.tick - lastMove >= interval) {
      const directions = ["north", "south", "east", "west"];
      const dir = directions[Math.floor(Math.random() * directions.length)];
      
      // We can use the moveEntityOnGrid tool via an event or just update position
      // Since this is a system, we update GridPosition directly
      let dx = 0, dy = 0;
      if (dir === "north") dy = -1;
      if (dir === "south") dy = 1;
      if (dir === "east") dx = 1;
      if (dir === "west") dx = -1;
      
      // Simple bounds check (assuming 40x20 based on world setup)
      const newX = Math.max(0, Math.min(39, GridPosition.x[eid] + dx));
      const newY = Math.max(0, Math.min(19, GridPosition.y[eid] + dy));
      
      GridPosition.x[eid] = newX;
      GridPosition.y[eid] = newY;
      Wanderer.lastMove[eid] = ctx.tick;
    }
  }
}
