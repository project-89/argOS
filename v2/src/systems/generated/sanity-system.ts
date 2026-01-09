import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "SanitySystem";
export const description = "Handles the slow mental erosion of agents in the cursed circus.";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const Psychology = ctx.getDynamic("Psychology");
  const { Name, Room } = ctx.components;
  if (!Psychology) return;
  
  const entities = ctx.query(world, [Name]);
  
  for (const eid of entities) {
      if (Psychology.sanity[eid] === undefined) continue;
  
      // Sanity naturally drains in the Midnight Menagerie
      Psychology.sanity[eid] = Math.max(0, Psychology.sanity[eid] - 0.05);
      
      // Stress increases with low health/hunger (mocking Vitals check)
      const Vitals = ctx.getDynamic("Vitals");
      if (Vitals && Vitals.health[eid] < 30) {
          Psychology.stress[eid] = Math.min(100, (Psychology.stress[eid] ?? 0) + 0.5);
      }
  
      if (Psychology.sanity[eid] < 20 && ctx.tick % 20 === 0) {
          ctx.log(`${Name.value[eid]} is hearing whispers from the Static...`);
      }
  }
}
