import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "TraitsDebugger";
export const description = "Debug Traits component structure.";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const { Traits, Name } = ctx.components;
  const items = Array.from(ctx.query(world, [Traits]));
  for (const eid of items) {
    ctx.log(`Item: ${Name.value[eid]}, Traits keys: ${Object.keys(Traits).join(',')}`);
    break;
  }
}
