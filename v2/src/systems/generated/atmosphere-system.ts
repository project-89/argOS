import type { World } from "../../ecs/world";
import { integrateLegacyRateSteps } from "../legacy-rate-time";
import type { SystemContext } from "../system-loader";

export const name = "AtmosphereSystem";
export const description = "Simulates the approaching storm and harvest progress.";
export const frequency = 1;
export const active = true;

export const temporalStepMs = 1000; // Explicit in-world duration for one historical law step.
export function run(world: World, ctx: SystemContext): void {
  integrateLegacyRateSteps(world, ctx, "atmosphere-system", temporalStepMs, runLaw);
}
function runLaw(world: World, ctx: SystemContext): void {
  const WorldState = ctx.getDynamic("WorldState");
  if (!WorldState) return;
  
  const clockEid = Array.from(ctx.query(world, [ctx.components.Name])).find(eid => ctx.components.Name.value[eid] === "Willowbrook World Clock");
  if (clockEid === undefined) return;
  
  // Storm dread increases slowly
  WorldState.stormDread[clockEid] = (WorldState.stormDread[clockEid] || 0) + 0.01;
  
  if (WorldState.stormDread[clockEid] > 50) {
    ctx.emit("atmospheric_event", { content: "The sky turns a bruised purple. The wind picks up, carrying a chill." });
  }
}
