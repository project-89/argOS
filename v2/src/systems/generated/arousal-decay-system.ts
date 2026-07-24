import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "ArousalDecaySystem";
export const description = "Gradually normalizes agent arousal towards 0.5 every tick.";
export const frequency = 10;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const { Mind, Agent } = ctx.components;
  const agents = Array.from(ctx.query(world, [Agent, Mind]));
  for (const eid of agents) {
    const currentArousal = Mind.arousal[eid];
    if (currentArousal > 0.5) {
      Mind.arousal[eid] = Math.max(0.5, currentArousal - 0.05);
    } else if (currentArousal < 0.5) {
      Mind.arousal[eid] = Math.min(0.5, currentArousal + 0.05);
    }
  }
}
