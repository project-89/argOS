import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "ActionProcessor";
export const description = "Processes ongoing actions and applies their effects when complete";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const { CurrentAction, Needs, Name, Interactable } = ctx.components;
  const agents = Array.from(ctx.query(world, [CurrentAction]));
  
  for (const agentEid of agents) {
    const actionType = CurrentAction.type[agentEid];
    if (!actionType) continue;
    
    const startTick = CurrentAction.startTick[agentEid];
    const duration = CurrentAction.duration[agentEid];
    const elapsed = ctx.tick - startTick;
    
    if (elapsed < duration) continue;
    
    const targetEid = CurrentAction.targetEid[agentEid];
    const targetNeed = Interactable.targetNeed[targetEid];
    const effectAmount = Interactable.effectAmount[targetEid] ?? 30;
    
    if (targetNeed === "hunger") {
      Needs.hunger[agentEid] = Math.max(0, (Needs.hunger[agentEid] ?? 50) - effectAmount);
    } else if (targetNeed === "energy") {
      Needs.energy[agentEid] = Math.min(100, (Needs.energy[agentEid] ?? 50) + effectAmount);
    }
    
    Interactable.lastUsed[targetEid] = ctx.tick;
    
    ctx.log(`${Name.value[agentEid]} finished ${actionType} - ${targetNeed} ${targetNeed === "hunger" ? "decreased" : "increased"} by ${effectAmount}`);
    ctx.emit("action_complete", {
      agent: Name.value[agentEid],
      action: actionType,
      target: Name.value[targetEid],
      effect: { need: targetNeed, amount: effectAmount }
    });
    
    CurrentAction.type[agentEid] = "";
    CurrentAction.targetEid[agentEid] = 0;
    CurrentAction.startTick[agentEid] = 0;
    CurrentAction.duration[agentEid] = 0;
  }
}
