import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "WeatherSystem";
export const description = "Tracks the progression of the storm threat and emits atmospheric stimuli.";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const { Name } = ctx.components;
  const WorldState = ctx.getDynamic("WorldState");
  if (!WorldState) {
    // Initialize world state if it doesn't exist on an entity
    return;
  }
  
  const entities = Array.from(ctx.query(world, [Name]));
  for (const eid of entities) {
    if (Name.value[eid] === "Willowbrook Global State") {
      let stormThreat = WorldState.stormThreat[eid] || 0;
      stormThreat += 0.01;
      WorldState.stormThreat[eid] = stormThreat;
  
      if (stormThreat > 0.8) {
         ctx.emit("environmental_event", { 
           content: "The sky turns a bruised purple and the wind picks up sharply.",
           modality: "visual"
         });
      } else if (stormThreat > 0.5) {
         ctx.emit("environmental_event", { 
           content: "A distant roll of thunder echoes through the valley.",
           modality: "auditory"
         });
      }
    }
  }
}
