import type { World } from "../../ecs/world";
import { integrateLegacyRateSteps } from "../legacy-rate-time";
import type { SystemContext } from "../system-loader";

export const name = "ExpandPuddles";
export const description = "Slowly expands puddles of liquid and updates their descriptions, occasionally emitting a visual stimulus.";
export const frequency = 10;
export const active = true;

export const temporalStepMs = 10000; // Explicit in-world duration for one historical law step.
export function run(world: World, ctx: SystemContext): void {
  integrateLegacyRateSteps(world, ctx, "expand-puddles", temporalStepMs, runLaw);
}
function runLaw(world: World, ctx: SystemContext): void {
  const PuddleExpansion = ctx.getDynamic("PuddleExpansion");
  if (!PuddleExpansion) return;

  const { Name, Description } = ctx.components;
  const entities = Array.from(ctx.query(world, [Name, Description])).filter(eid => ctx.hasDynamic(eid, "PuddleExpansion"));

  for (const eid of entities) {
    const current = PuddleExpansion.currentSize[eid];
    const max = PuddleExpansion.maxSize[eid];

    if (current < max) {
      PuddleExpansion.currentSize[eid] = Math.min(max, current + PuddleExpansion.rate[eid]);
      const newSize = PuddleExpansion.currentSize[eid];

      let sizeDesc = "small";
      if (newSize >= 8) sizeDesc = "large, spreading";
      else if (newSize >= 4) sizeDesc = "growing";

      Description.value[eid] = `A ${sizeDesc} pool of cold seawater on the scrubbed wooden floorboards.`;

      // Occasionally emit a stimulus when it grows noticeably
      if (Math.random() < 0.1) {
        ctx.emit("stimulus", {
          type: "visual",
          content: `The pool of cold seawater beneath the chair creeps further across the floorboards.`,
          room: ctx.components.Room?.value[eid]
        });
      }
    }
  }
}
