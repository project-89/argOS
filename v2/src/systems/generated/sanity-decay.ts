import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "SanityDecay";
export const description = "Decays Sanity by 1 each tick for any entity whose OccultKnowledge exceeds 30. Logs warnings at thresholds.";
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
      if (knowledge > 30) {
        const currentSanity = Sanity.current[eid] || 0;
        if (currentSanity > 0) {
          // Decay sanity
          Sanity.current[eid] = Math.max(0, currentSanity - 1);
          
          // Log effects at thresholds
          if (Sanity.current[eid] === 0) {
            ctx.log(`${Name.value[eid]} has completely lost their mind to the cosmic horrors!`);
            ctx.emit("sanity_break", { entity: Name.value[eid] });
          } else if (Sanity.current[eid] % 10 === 0) {
            ctx.log(`${Name.value[eid]} mutters incoherently as forbidden knowledge rots their mind. Sanity: ${Sanity.current[eid]}`);
          }
        }
      }
    }
  }
}
