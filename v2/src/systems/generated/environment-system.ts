import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "EnvironmentSystem";
export const description = "Applies zone effects. Calculates zone populations first to enforce the 'near others' social constraint.";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const Vitals = ctx.getDynamic("Vitals");
  const Traits = ctx.getDynamic("Traits");
  const Location = ctx.getDynamic("Location");
  
  if (!Vitals || !Traits || !Location) return;
  
  const { Name } = ctx.components;
  const entities = Array.from(ctx.query(world, [Name])).filter(eid => 
    Vitals.satiety?.[eid] !== undefined && 
    Location.zoneId?.[eid] !== undefined
  );
  
  const populations: Record<number, number> = {};
  
  for (const eid of entities) {
    const zoneId = Location.zoneId[eid];
    populations[zoneId] = (populations[zoneId] || 0) + 1;
  }
  
  for (const eid of entities) {
    const zone = Location.zoneId[eid];
  
    if (zone === 0) {
      Vitals.safety[eid] += 2;
      Vitals.social[eid] -= 0.5;
    } else if (zone === 1) {
      Vitals.satiety[eid] += 3;
      Vitals.safety[eid] -= 1.5;
    } else if (zone === 2) {
      Vitals.safety[eid] -= 1.0;
      if ((populations[2] || 0) > 1) {
        Vitals.social[eid] += 2;
      } else {
        Vitals.social[eid] -= 0.2;
      }
    }
  
    Location.ticksInZone[eid]++;
  
    Vitals.satiety[eid] = Math.max(0, Math.min(100, Vitals.satiety[eid]));
    Vitals.safety[eid] = Math.max(0, Math.min(100, Vitals.safety[eid]));
    Vitals.social[eid] = Math.max(0, Math.min(100, Vitals.social[eid]));
  }
}
