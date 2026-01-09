import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "PerformanceSystem";
export const description = "Converts agent actions into Applause. Low total applause triggers hostile events.";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const Performance = ctx.getDynamic("Performance");
  const { Name, CurrentAction } = ctx.components;
  if (!Performance) return;
  
  const performers = ctx.query(world, [Performance]);
  let totalApplause = 0;
  
  for (const eid of performers) {
      // If agent is performing (mocking an action check)
      const action = CurrentAction.type[eid];
      if (action === "perform") {
          const gain = (Performance.skill[eid] ?? 10) * 0.1;
          Performance.applauseGenerated[eid] = (Performance.applauseGenerated[eid] ?? 0) + gain;
          totalApplause += gain;
      }
  }
  
  if (ctx.tick % 50 === 0) {
      ctx.log(`The Ringmaster watches... Total Session Applause: ${totalApplause.toFixed(1)}`);
      if (totalApplause < 5) {
          ctx.emit("environmental_hazard", { type: "TheCulling", severity: "high" });
      }
  }
}
