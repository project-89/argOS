import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "SeekNeeds";
export const description = "Agents seek out objects that satisfy their most urgent need";
export const frequency = 3;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const { Needs, Agent, Name, Interactable, CurrentAction, GridPosition } = ctx.components;
  const { OccupiesRoom } = ctx.relations;
  
  const agents = Array.from(ctx.query(world, [Agent, Needs]));
  const interactables = Array.from(ctx.query(world, [Interactable]));
  
  for (const agentEid of agents) {
    if (CurrentAction.type[agentEid]) continue;
    
    const hunger = Needs.hunger[agentEid] ?? 50;
    const energy = Needs.energy[agentEid] ?? 50;
    
    let urgentNeed: string | null = null;
    let urgency = 0;
    
    if (hunger >= 70 && hunger > urgency) {
      urgentNeed = "hunger";
      urgency = hunger;
    }
    if (energy <= 30 && (100 - energy) > urgency) {
      urgentNeed = "energy";
      urgency = 100 - energy;
    }
    
    if (!urgentNeed) continue;
    
    const agentRoom = ctx.getRelationTargets(world, agentEid, OccupiesRoom)[0];
    
    for (const objEid of interactables) {
      const targetNeed = Interactable.targetNeed[objEid];
      if (targetNeed !== urgentNeed) continue;
      
      const objRoom = ctx.getRelationTargets(world, objEid, OccupiesRoom)[0];
      if (objRoom !== agentRoom) continue;
      
      const now = ctx.tick;
      const lastUsed = Interactable.lastUsed[objEid] ?? 0;
      const cooldown = Interactable.cooldown[objEid] ?? 0;
      if (now - lastUsed < cooldown) continue;
      
      ctx.addComponent(world, agentEid, CurrentAction);
      CurrentAction.type[agentEid] = Interactable.action[objEid];
      CurrentAction.targetEid[agentEid] = objEid;
      CurrentAction.startTick[agentEid] = now;
      CurrentAction.duration[agentEid] = 3;
      
      ctx.log(`${Name.value[agentEid]} starts ${Interactable.action[objEid]} at ${Name.value[objEid]}`);
      ctx.emit("action_start", { 
        agent: Name.value[agentEid], 
        action: Interactable.action[objEid],
        target: Name.value[objEid]
      });
      break;
    }
  }
}
