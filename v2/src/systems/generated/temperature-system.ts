import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "TemperatureSystem";
export const description = "Simulates cold exposure and its effect on body temperature and health.";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const ThermalState = ctx.getDynamic("ThermalState");
  if (!ThermalState) return;
  
  const { Agent, Name, GridPosition } = ctx.components;
  const agents = Array.from(ctx.query(world, [Agent, GridPosition])).filter(eid => ctx.hasDynamic(eid, "ThermalState"));
  const objects = Array.from(ctx.query(world, [GridPosition]));
  
  // Find heat sources and shelter
  const burningObjects = objects.filter(oid => {
    const thermal = ctx.hasDynamic(oid, "ThermalState");
    return thermal && ThermalState.isBurning[oid];
  });
  
  const Shelter = objects.filter(oid => {
    const name = ctx.components.Name.value[oid];
    return name && name.toLowerCase().includes("shelter");
  });
  
  for (const eid of agents) {
    const currentTemp = ThermalState.temperature[eid] ?? 37;
    const ax = GridPosition.x[eid];
    const ay = GridPosition.y[eid];
  
    let heating = 0;
    
    // Check for nearby fire
    for (const fid of burningObjects) {
      const fx = GridPosition.x[fid];
      const fy = GridPosition.y[fid];
      const dist = Math.sqrt(Math.pow(ax - fx, 2) + Math.pow(ay - fy, 2));
      if (dist < 3) {
        heating += (3 - dist) * 0.2; // Stronger heating closer to fire
      }
    }
  
    // Check for shelter (passive insulation)
    let insulation = 0;
    for (const sid of Shelter) {
      const sx = GridPosition.x[sid];
      const sy = GridPosition.y[sid];
      const dist = Math.sqrt(Math.pow(ax - sx, 2) + Math.pow(ay - sy, 2));
      if (dist < 2) {
        insulation = 0.04; // Nearly cancels base cooling
      }
    }
  
    // Base cooling rate + heating/insulation
    const cooling = 0.05 - insulation;
    ThermalState.temperature[eid] = currentTemp - cooling + heating;
    
    // Clamp temperature to reasonable human limits for simulation (not death, just vitals)
    ThermalState.temperature[eid] = Math.max(30, Math.min(40, ThermalState.temperature[eid]));
  
    if (ThermalState.temperature[eid] < 35) {
       const Vitals = ctx.getDynamic("Vitals");
       if (Vitals && Vitals.health) {
         Vitals.health[eid] = Math.max(0, Vitals.health[eid] - 0.2);
       }
       if (ctx.tick % 50 === 0) {
          ctx.log(`${Name.value[eid]} is shivering uncontrollably.`);
       }
    }
  }
}
