import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "SanityDecaySystem";
export const description = "Decays an entity's Sanity over time if their OccultKnowledge exceeds 30. Higher knowledge causes faster decay.";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const Sanity = ctx.getDynamic("Sanity");
  const OccultKnowledge = ctx.getDynamic("OccultKnowledge");
  if (!Sanity || !OccultKnowledge) return;
  
  const { Name } = ctx.components;
  const entities = Array.from(ctx.query(world, [Name]));
  
  for (const eid of entities) {
    if (ctx.hasDynamic(eid, "Sanity") && ctx.hasDynamic(eid, "OccultKnowledge")) {
      const knowledge = OccultKnowledge.level[eid] || 0;
      
      // Only decay if OccultKnowledge is greater than 30
      if (knowledge > 30) {
        // Decay happens every 10 ticks to avoid draining instantly
        if (ctx.tick % 10 === 0) {
          const currentSanity = Sanity.current[eid] || 100;
          if (currentSanity > 0) {
            // The more knowledge you have above 30, the faster it drains
            const decayAmount = Math.floor((knowledge - 30) / 10) + 1;
            Sanity.current[eid] = Math.max(0, currentSanity - decayAmount);
            
            if (Sanity.current[eid] <= 0) {
              ctx.log(`${Name.value[eid]}'s mind has completely snapped from the eldritch revelations!`);
            } else {
              ctx.log(`${Name.value[eid]}'s sanity is slipping... (Sanity: ${Sanity.current[eid]}/${Sanity.max[eid] || 100})`);
            }
          }
        }
      }
    }
  }
}
