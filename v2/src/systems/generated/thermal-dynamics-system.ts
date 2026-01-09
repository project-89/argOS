import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "ThermalDynamicsSystem";
export const description = "Calculates heat transfer between nearby entities and manages combustion.";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const Thermal = ctx.getDynamic("ThermalState");
  const Vitals = ctx.getDynamic("Vitals");
  const { Position, Name } = ctx.components;
  if (!Thermal) return;
  
  const entities = Array.from(ctx.query(world, [Position]));
  
  for (const eid of entities) {
    const isBurning = Thermal.isBurning[eid];
    const temp = Thermal.temperature[eid] ?? 20;
  
    // 1. Spreading Heat
    if (isBurning || temp > 100) {
      const x = Position.x[eid];
      const y = Position.y[eid];
      
      // Check neighbors for heat transfer
      for (const otherEid of entities) {
        if (otherEid === eid) continue;
        const dx = Math.abs(Position.x[otherEid] - x);
        const dy = Math.abs(Position.y[otherEid] - y);
        
        if (dx <= 1 && dy <= 1) {
          // Transfer heat
          const otherTemp = Thermal.temperature[otherEid] ?? 20;
          Thermal.temperature[otherEid] = otherTemp + (temp * 0.05);
        }
      }
    }
  
    // 2. Ignition Logic
    if (temp > 200 && !isBurning) {
      Thermal.isBurning[eid] = true;
      ctx.log(`${Name.value[eid]} has caught fire!`);
    }
  
    // 3. Burn Damage
    if (isBurning) {
      Thermal.temperature[eid] = Math.min(1000, temp + 10);
      if (Vitals && Vitals.health[eid] !== undefined) {
        Vitals.health[eid] = Math.max(0, Vitals.health[eid] - 2);
      }
    } else {
      // Natural cooling
      Thermal.temperature[eid] = Math.max(20, temp - 0.5);
    }
  }
}
