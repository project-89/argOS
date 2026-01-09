import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "DecisionSystem";
export const description = "Utility AI. Calculates deficit scores to determine the best Zone. Uses standardized direction (100-Current).";
export const frequency = 5;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const Vitals = ctx.getDynamic("Vitals");
  const Traits = ctx.getDynamic("Traits");
  const Location = ctx.getDynamic("Location");
  
  if (!Vitals || !Traits || !Location) return;
  
  const { Name } = ctx.components;
  const entities = Array.from(ctx.query(world, [Name])).filter(eid => 
    Vitals.satiety?.[eid] !== undefined && 
    Traits.satietyPriority?.[eid] !== undefined &&
    Location.zoneId?.[eid] !== undefined
  );
  
  for (const eid of entities) {
    const sAt = Vitals.satiety[eid] ?? 0;
    const sAf = Vitals.safety[eid] ?? 0;
    const sOc = Vitals.social[eid] ?? 0;
  
    const pAt = Traits.satietyPriority[eid] ?? 0;
    const pAf = Traits.safetyPriority[eid] ?? 0;
    const pOc = Traits.socialPriority[eid] ?? 0;
  
    const deficitSatiety = (100 - sAt) * pAt;
    const deficitSafety = (100 - sAf) * pAf;
    const deficitSocial = (100 - sOc) * pOc;
  
    let targetZone = 0; // Default to safety
    let highestUrgency = deficitSafety;
  
    if (deficitSatiety > highestUrgency) {
      targetZone = 1;
      highestUrgency = deficitSatiety;
    }
  
    if (deficitSocial > highestUrgency) {
      targetZone = 2;
    }
  
    Location.zoneId[eid] = targetZone;
  }
}
