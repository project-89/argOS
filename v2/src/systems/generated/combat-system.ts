import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "CombatSystem";
export const description = "Handles melee combat between entities and tracks Glory.";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const Combat = ctx.getDynamic("CombatState");
  const Vitals = ctx.getDynamic("Vitals");
  const Psychology = ctx.getDynamic("Psychology");
  const { Name, Position } = ctx.components;
  if (!Combat) return;
  
  const entities = Array.from(ctx.query(world, [Combat, Position]));
  
  for (const eid of entities) {
      const targetEid = Combat.targetEid[eid];
      if (targetEid === undefined || targetEid === 0) continue;
  
      // Proximity check for combat
      const dx = Math.abs(Position.x[eid] - Position.x[targetEid]);
      const dy = Math.abs(Position.y[eid] - Position.y[targetEid]);
  
      if (dx <= 1 && dy <= 1) {
          // Resolve Attack
          const atk = Combat.attack[eid] ?? 10;
          const def = Combat.defense[targetEid] ?? 5;
          const damage = Math.max(1, atk - (def * 0.5));
  
          if (Vitals && Vitals.health[targetEid] !== undefined) {
              Vitals.health[targetEid] -= damage;
              Combat.glory[eid] = (Combat.glory[eid] ?? 0) + 1;
              
              if (ctx.tick % 5 === 0) {
                  ctx.log(`${Name.value[eid]} strikes ${Name.value[targetEid]} for ${damage.toFixed(1)} damage!`);
              }
          }
  
          // Stress from combat
          if (Psychology && Psychology.stress[targetEid] !== undefined) {
              Psychology.stress[targetEid] = Math.min(100, Psychology.stress[targetEid] + 2);
          }
      }
  }
}
