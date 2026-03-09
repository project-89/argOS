import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "GroundedNPCLoop";
export const description = "Grounded NPC loop for hunger, energy, and movement.";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const { Needs, Name, Agent, Room, BehaviorPolicy, Traits } = ctx.components;
  const { LocatedIn } = ctx.relations;
  
  const agents = Array.from(ctx.query(world, [Agent, Needs]));
  const rooms = Array.from(ctx.query(world, [Room]));
  const entitiesWithTraits = Array.from(ctx.query(world, [Traits]));
  
  for (const eid of agents) {
      const hunger = Needs.hunger[eid] ?? 0;
      const energy = Needs.energy[eid] ?? 100;
      const name = Name.value[eid];
      
      // Install BehaviorPolicy if missing
      ctx.addComponent(world, eid, BehaviorPolicy);
  
      // Find current room
      const currentRoomEid = ctx.getRelationTargets(world, eid, LocatedIn)[0];
      const currentRoomName = currentRoomEid ? Name.value[currentRoomEid] : "Unknown";
  
      // 1. Hunger Logic
      if (hunger > 70) {
          let foodEid = -1;
          for (const itemEid of entitiesWithTraits) {
              const targets = ctx.getRelationTargets(world, itemEid, LocatedIn);
              if (targets.includes(currentRoomEid)) {
                  const traits = Traits.active[itemEid];
                  if (traits && traits.includes("edible")) {
                      foodEid = itemEid;
                      break;
                  }
              }
          }
  
          if (foodEid !== -1) {
              Needs.hunger[eid] = Math.max(0, hunger - 50);
              ctx.removeEntity(world, foodEid);
              ctx.log(`${name} ate ${Name.value[foodEid]} in ${currentRoomName}`);
          } else {
              const foodRooms = ["Marketplace", "Bakery", "The Golden Wheat"];
              if (!foodRooms.includes(currentRoomName)) {
                  const targetRoomName = foodRooms[ctx.tick % foodRooms.length];
                  const targetRoomEid = rooms.find(r => Name.value[r] === targetRoomName);
                  if (targetRoomEid) {
                      ctx.addRelation(world, eid, targetRoomEid, LocatedIn);
                      ctx.log(`${name} heading to ${targetRoomName} for food`);
                  }
              }
          }
      } 
      // 2. Energy Logic
      else if (energy < 30) {
          let bedEid = -1;
          for (const itemEid of entitiesWithTraits) {
              const targets = ctx.getRelationTargets(world, itemEid, LocatedIn);
              if (targets.includes(currentRoomEid)) {
                  const traits = Traits.active[itemEid];
                  if (traits && traits.includes("sleepable")) {
                      bedEid = itemEid;
                      break;
                  }
              }
          }
  
          if (bedEid !== -1) {
              Needs.energy[eid] = Math.min(100, energy + 5);
              if (ctx.tick % 10 === 0) ctx.log(`${name} resting in ${currentRoomName}`);
          } else {
              const targetRoomName = "The Golden Wheat";
              const targetRoomEid = rooms.find(r => Name.value[r] === targetRoomName);
              if (targetRoomEid && currentRoomName !== targetRoomName) {
                  ctx.addRelation(world, eid, targetRoomEid, LocatedIn);
                  ctx.log(`${name} heading to ${targetRoomName} for rest`);
              }
          }
      }
      // 3. Plausible Room Logic
      else {
          const commonRooms = ["Marketplace", "The Golden Wheat", "Bakery", "Village Square"];
          if (!commonRooms.includes(currentRoomName)) {
              const targetRoomName = commonRooms[ctx.tick % commonRooms.length];
              const targetRoomEid = rooms.find(r => Name.value[r] === targetRoomName);
              if (targetRoomEid) {
                  ctx.addRelation(world, eid, targetRoomEid, LocatedIn);
                  ctx.log(`${name} moved to ${targetRoomName}`);
              }
          }
      }
  }
}
