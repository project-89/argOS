import type { World } from "../../ecs/world";
import { integrateLegacyRateSteps } from "../legacy-rate-time";
import type { SystemContext } from "../system-loader";

export const name = "BeaconDecay";
export const description = "Slowly drains fuel from the beacon and extinguishes it when empty.";
export const frequency = 10;
export const active = true;

export const temporalStepMs = 10000; // Explicit in-world duration for one historical law step.
export function run(world: World, ctx: SystemContext): void {
  integrateLegacyRateSteps(world, ctx, "beacon-decay", temporalStepMs, runLaw);
}
function runLaw(world: World, ctx: SystemContext): void {
  const BeaconState = ctx.getDynamic("BeaconState");
  if (!BeaconState) return;
  const { Name, Room } = ctx.components;
  const entities = Array.from(ctx.query(world, [Name])).filter(eid => ctx.hasDynamic(eid, "BeaconState"));

  for (const eid of entities) {
    const currentFuel = BeaconState.fuel[eid] ?? 0;
    if (currentFuel > 0) {
      BeaconState.fuel[eid] = currentFuel - 0.5;
      BeaconState.lit[eid] = true;
      if (BeaconState.fuel[eid] === 20) {
        ctx.log(`The ${Name.value[eid]} flickers ominously as fuel runs low.`);
      }
    } else {
      if (BeaconState.lit[eid] !== false) {
        BeaconState.lit[eid] = false;
        ctx.log(`The ${Name.value[eid]} goes dark!`);
      }
    }
  }
}
