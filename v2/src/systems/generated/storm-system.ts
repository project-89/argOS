import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "StormSystem";
export const description = "Simulates the slow build-up of the harvest storm.";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const Weather = ctx.getDynamic("WeatherState");
  if (!Weather) return;
  const { Name } = ctx.components;
  const entities = Array.from(ctx.query(world, [Name])).filter(eid => ctx.hasDynamic(eid, "WeatherState"));
  
  for (const eid of entities) {
    Weather.humidity[eid] = Math.min(100, (Weather.humidity[eid] ?? 40) + 0.1);
    Weather.pressure[eid] = Math.max(950, (Weather.pressure[eid] ?? 1012) - 0.05);
    
    if (Weather.humidity[eid] > 80 && Weather.pressure[eid] < 990) {
      Weather.stormImpending[eid] = true;
      ctx.emit("environmental_change", { room: Name.value[eid], condition: "Storm Gathering" });
    }
  }
}
