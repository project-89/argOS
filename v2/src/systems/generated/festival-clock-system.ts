import type { World } from "../../ecs/world";
import { integrateLegacyRateSteps } from "../legacy-rate-time";
import type { SystemContext } from "../system-loader";

export const name = "FestivalClockSystem";
export const description = "Announces festival events based on time.";
export const frequency = 1;
export const active = true;

export const temporalStepMs = 1000; // Explicit in-world duration for one historical law step.
export function run(world: World, ctx: SystemContext): void {
  integrateLegacyRateSteps(world, ctx, "festival-clock-system", temporalStepMs, runLaw);
}
function runLaw(world: World, ctx: SystemContext): void {
  const { Name, Room } = ctx.components;
  const rooms = Array.from(ctx.query(world, [Room, Name]));
  const time = ctx.tick;
  if (time % 100 === 0) {
    let event = "";
    if (time % 300 === 0) event = "The Night Dance is starting in the Village Square!";
    else if (time % 200 === 0) event = "The Pie Eating Contest is about to begin at the Market Row!";
    else event = "The Opening Ceremony is starting in the Village Square!";
    
    for (const rid of rooms) {
      ctx.emit("stimulus", { room: Name.value[rid], type: "auditory", content: event });
    }
  }
}
