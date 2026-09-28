import type { World } from "../../ecs/world";
import { integrateLegacyRateSteps } from "../legacy-rate-time";
import type { SystemContext } from "../system-loader";

export const name = "RestAndRecover";
export const description = "Gradually returns agent arousal/mood towards a neutral baseline of 0.5 over time to prevent endless agitation.";
export const frequency = 10;
export const active = true;

export const temporalStepMs = 10000; // Explicit in-world duration for one historical law step.
export function run(world: World, ctx: SystemContext): void {
  integrateLegacyRateSteps(world, ctx, "rest-and-recover", temporalStepMs, runLaw);
}
function runLaw(world: World, ctx: SystemContext): void {
  const { Mind } = ctx.components;
  const agents = Array.from(ctx.query(world, [Mind]));
  for (const eid of agents) {
    const current = Mind.arousal[eid];
    if (current !== undefined) {
      if (current > 0.5) {
        Mind.arousal[eid] = Math.max(0.5, current - 0.1);
      } else if (current < 0.5) {
        Mind.arousal[eid] = Math.min(0.5, current + 0.1);
      }
    }
  }
}
