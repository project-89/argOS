import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "ContentmentSystem";
export const description = "Emits contentment messages to relaxed agents.";
export const frequency = 90;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const { Mind, Name } = ctx.components;
  const beings = Array.from(ctx.query(world, [Mind, Name]));
  
  for (const eid of beings) {
    if (Mind.arousal[eid] < 0.3) {
      ctx.emit("cognitive_stimulus", { 
        target: Name.value[eid], 
        content: "A wave of deep contentment washes over you. Life is good in Willowbrook." 
      });
    }
  }
}
