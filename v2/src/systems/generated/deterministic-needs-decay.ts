import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "DeterministicNeedsDecay";
export const description = "Deterministic needs decay for hunger and energy.";
export const frequency = 10;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const { Needs, Name, Agent } = ctx.components;
  const agents = Array.from(ctx.query(world, [Agent, Needs]));
  for (const eid of agents) {
    Needs.hunger[eid] = Math.min(100, (Needs.hunger[eid] || 0) + 1);
    Needs.energy[eid] = Math.max(0, (Needs.energy[eid] || 100) - 0.5);
  }
}
