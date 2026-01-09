import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "AnimalSystem";
export const description = "Handles deer movement and skittish behavior.";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const { GridPosition, Name } = ctx.components;
  const AnimalState = ctx.getDynamic("AnimalState");
  if (!AnimalState) return;
  
  const entities = Array.from(ctx.query(world, [GridPosition, Name])).filter(eid => ctx.hasDynamic(eid, "AnimalState"));
  
  for (const eid of entities) {
    const name = Name.value[eid];
    
    // 20% chance to move each tick
    if (Math.random() < 0.2) {
      const directions = ["north", "south", "east", "west"];
      const dir = directions[Math.floor(Math.random() * directions.length)];
      
      let dx = 0, dy = 0;
      if (dir === "north") dy = -1;
      if (dir === "south") dy = 1;
      if (dir === "west") dx = -1;
      if (dir === "east") dx = 1;
      
      // Bounds check (Wilderness is 60x30)
      const nextX = GridPosition.x[eid] + dx;
      const nextY = GridPosition.y[eid] + dy;
      
      if (nextX >= 0 && nextX < 60 && nextY >= 0 && nextY < 30) {
        GridPosition.x[eid] = nextX;
        GridPosition.y[eid] = nextY;
        // No log for every move to avoid spam, but could log if they flee
      }
    }
    
    // If fleeing, move faster or log it
    if (AnimalState.isFleeing[eid]) {
      ctx.log(`${name} is fleeing in terror!`);
      AnimalState.isFleeing[eid] = false; // Reset fleeing after one burst
    }
  }
}
