import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "MetabolismSystem";
export const description = "Simulates natural entropy. All needs decay naturally over time (100 -> 0).";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const Vitals = ctx.getDynamic("Vitals");
  const { Name } = ctx.components;
  
  if (!Vitals) return;
  
  const entities = Array.from(ctx.query(world, [Name])).filter(eid => 
    Vitals.satiety?.[eid] !== undefined
  );
  
  for (const eid of entities) {
    // Satiety decay
    const currentSatiety = Vitals.satiety[eid] ?? 100;
    Vitals.satiety[eid] = Math.max(0, Math.min(100, currentSatiety - 0.5));
  
    // Social decay
    const currentSocial = Vitals.social[eid] ?? 100;
    Vitals.social[eid] = Math.max(0, Math.min(100, currentSocial - 0.2));
  
    // Safety clamping (No decay, only environment exposure affects this elsewhere)
    const currentSafety = Vitals.safety[eid] ?? 100;
    Vitals.safety[eid] = Math.max(0, Math.min(100, currentSafety));
  }
}
