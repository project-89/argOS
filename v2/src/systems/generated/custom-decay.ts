import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "CustomDecay";
export const description = "Increases hunger by 2 and decreases energy by 1 for all agents with needs every tick. Logs a message when hunger exceeds 50.";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const { Needs, Name } = ctx.components;
  const entities = Array.from(ctx.query(world, [Needs]));
  for (const eid of entities) {
    const h = (Needs.hunger[eid] ?? 0) + 2;
    const e = (Needs.energy[eid] ?? 0) - 1;
    Needs.hunger[eid] = h;
    Needs.energy[eid] = e;
    ctx.log(`Metabolism: ${Name.value[eid]} H:${h} E:${e}`);
  }
}
