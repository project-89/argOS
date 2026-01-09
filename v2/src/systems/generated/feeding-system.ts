import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "FeedingSystem";
export const description = "Rabbits eat grass at their current position.";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const Stats = ctx.getDynamic("EcosystemStats");
  if (!Stats) return;
  
  const { GridPosition, Name } = ctx.components;
  const entities = Array.from(ctx.query(world, [GridPosition]));
  
  // Index prey by position
  const rabbitMap = new Map();
  const grassMap = new Map();
  
  for (const eid of entities) {
    const type = Stats.type[eid];
    const key = `${GridPosition.x[eid]},${GridPosition.y[eid]}`;
    if (type === "grass") grassMap.set(key, eid);
    if (type === "rabbit") rabbitMap.set(key, eid);
  }
  
  for (const eid of entities) {
    const type = Stats.type[eid];
    const key = `${GridPosition.x[eid]},${GridPosition.y[eid]}`;
  
    if (type === "rabbit") {
      if (grassMap.has(key)) {
        const target = grassMap.get(key);
        Stats.energy[eid] = Math.min(Stats.maxEnergy[eid], Stats.energy[eid] + 25);
        ctx.removeEntity(world, target);
        ctx.log(`${Name.value[eid]} (Rabbit) ate grass.`);
      }
    } else if (type === "fox") {
      if (rabbitMap.has(key)) {
        const target = rabbitMap.get(key);
        // Fox doesn't eat itself
        if (target !== eid) {
            Stats.energy[eid] = Math.min(Stats.maxEnergy[eid], Stats.energy[eid] + 50);
            ctx.removeEntity(world, target);
            ctx.log(`${Name.value[eid]} (Fox) caught a rabbit!`);
        }
      }
    }
  }
}
