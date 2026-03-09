import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "NPCGroundedLoop";
export const description = "Grounded NPC behavior loop for hunger and energy. Handles decision making and satisfaction deterministically.";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const { Needs, Agent, CurrentAction, Name, Traits } = ctx.components;
  const { LocatedIn } = ctx.relations;
  
  const agents = Array.from(ctx.query(world, [Agent, Needs]));
  const items = Array.from(ctx.query(world, [Traits]));
  
  for (const agentEid of agents) {
    const hunger = Needs.hunger[agentEid] ?? 50;
    const energy = Needs.energy[agentEid] ?? 50;
    const action = CurrentAction.action[agentEid];
  
    // 1. Satisfaction Logic
    if (action === "eat") {
      Needs.hunger[agentEid] = Math.max(0, hunger - 30);
      ctx.log(`${Name.value[agentEid]} is eating. Hunger: ${Needs.hunger[agentEid]}`);
      CurrentAction.action[agentEid] = "";
      CurrentAction.target[agentEid] = 0;
      continue;
    }
    if (action === "sleep") {
      Needs.energy[agentEid] = Math.min(100, energy + 10);
      ctx.log(`${Name.value[agentEid]} is sleeping. Energy: ${Needs.energy[agentEid]}`);
      if (Needs.energy[agentEid] >= 100) {
        CurrentAction.action[agentEid] = "";
        CurrentAction.target[agentEid] = 0;
      }
      continue;
    }
  
    // 2. Decision Logic
    const agentRoomEids = ctx.getRelationTargets(world, agentEid, LocatedIn);
    const agentRoomEid = agentRoomEids.length > 0 ? agentRoomEids[0] : null;
  
    if (hunger > 70) {
      let foodEid = -1;
      for (const itemEid of items) {
        const itemRoomEids = ctx.getRelationTargets(world, itemEid, LocatedIn);
        if (itemRoomEids[0] === agentRoomEid) {
          const traits = Traits.value[itemEid] || "";
          if (traits.includes("edible")) {
            foodEid = itemEid;
            break;
          }
        }
      }
  
      if (foodEid !== -1) {
        CurrentAction.action[agentEid] = "eat";
        CurrentAction.target[agentEid] = foodEid;
      } else {
        // Move to Marketplace (9)
        if (agentRoomEid !== 9) {
          if (agentRoomEid) ctx.removeRelation(world, agentEid, agentRoomEid, LocatedIn);
          ctx.addRelation(world, agentEid, 9, LocatedIn);
          ctx.log(`${Name.value[agentEid]} moved to Marketplace for food.`);
        }
      }
    } else if (energy < 20) {
      let bedEid = -1;
      for (const itemEid of items) {
        const itemRoomEids = ctx.getRelationTargets(world, itemEid, LocatedIn);
        if (itemRoomEids[0] === agentRoomEid) {
          const traits = Traits.value[itemEid] || "";
          if (traits.includes("sleepable")) {
            bedEid = itemEid;
            break;
          }
        }
      }
  
      if (bedEid !== -1) {
        CurrentAction.action[agentEid] = "sleep";
        CurrentAction.target[agentEid] = bedEid;
      } else {
        // Move to Bakery (11) - has Bakery Cot
        if (agentRoomEid !== 11) {
          if (agentRoomEid) ctx.removeRelation(world, agentEid, agentRoomEid, LocatedIn);
          ctx.addRelation(world, agentEid, 11, LocatedIn);
          ctx.log(`${Name.value[agentEid]} moved to Bakery for rest.`);
        }
      }
    }
  }
}
