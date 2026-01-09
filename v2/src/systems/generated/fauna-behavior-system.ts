import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "FaunaBehaviorSystem";
export const description = "Handles rabbit movement and metabolism.";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const Stats = ctx.getDynamic("EcosystemStats");
  if (!Stats) return;
  
  const { GridPosition, Name } = ctx.components;
  const entities = Array.from(ctx.query(world, [GridPosition]));
  
  for (const eid of entities) {
    const type = Stats.type[eid];
    if (type === "rabbit" || type === "fox") {
      // Metabolism: Predators burn energy faster
      const burnRate = type === "fox" ? 0.8 : 0.5;
      Stats.energy[eid] = (Stats.energy[eid] ?? 50) - burnRate;
  
      // Move randomly
      const directions = ["north", "south", "east", "west"];
      const dir = directions[Math.floor(Math.random() * directions.length)];
      
      const pos = { x: GridPosition.x[eid], y: GridPosition.y[eid] };
      let nextX = pos.x;
      let nextY = pos.y;
  
      if (dir === "north") nextY--;
      if (dir === "south") nextY++;
      if (dir === "east") nextX++;
      if (dir === "west") nextX--;
  
      // Bounds check
      if (nextX >= 0 && nextX < 30 && nextY >= 0 && nextY < 20) {
        GridPosition.x[eid] = nextX;
        GridPosition.y[eid] = nextY;
      }
    }
  }
}
