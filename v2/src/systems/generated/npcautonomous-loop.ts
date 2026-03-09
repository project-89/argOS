import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "NPCAutonomousLoop";
export const description = "Deterministic NPC autonomous loop for hunger and energy satisfaction.";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const { Needs, Agent, Room, Name, BehaviorPolicy, Traits, Position } = ctx.components;
  const { LocatedIn } = ctx.relations;
  
  const foodRooms = ["The Golden Wheat", "Marketplace", "Bakery"];
  const sleepRooms = ["Bakery", "The Golden Wheat"];
  
  const agents = Array.from(ctx.query(world, [Agent, Needs, Room]));
  
  for (const eid of agents) {
    // 1. Install/Update BehaviorPolicy
    if (!ctx.components.BehaviorPolicy.active[eid]) {
      ctx.components.BehaviorPolicy.active[eid] = 1;
      // We can store policy data in a dynamic component if needed, 
      // but here we'll just use the system logic.
    }
  
    const hunger = Needs.hunger[eid] || 0;
    const energy = Needs.energy[eid] || 100;
    const currentRoomEid = ctx.getRelationTargets(world, eid, LocatedIn)[0];
    const currentRoomName = currentRoomEid ? Name.value[currentRoomEid] : "";
  
    // 2. Hunger Logic
    if (hunger > 70) {
      // Look for food in room
      let foodFound = false;
      const roomEntities = ctx.getRelationTargets(world, currentRoomEid, ctx.relations.Contains) || [];
      for (const itemEid of roomEntities) {
        const traits = Traits.value[itemEid] || [];
        if (traits.includes("edible")) {
          // Eat it
          Needs.hunger[eid] = Math.max(0, hunger - 50);
          ctx.log(`${Name.value[eid]} ate ${Name.value[itemEid]}`);
          ctx.removeEntity(world, itemEid);
          foodFound = true;
          break;
        }
      }
  
      if (!foodFound) {
        // Move to food room
        const targetRoomName = foodRooms[Math.floor(Math.random() * foodRooms.length)];
        if (currentRoomName !== targetRoomName) {
          const targetRoomEid = Array.from(ctx.query(world, [Room, Name])).find(reid => Name.value[reid] === targetRoomName);
          if (targetRoomEid) {
            // Teleport for deterministic loop reliability
            ctx.removeRelation(world, eid, currentRoomEid, LocatedIn);
            ctx.addRelation(world, eid, targetRoomEid, LocatedIn);
            ctx.log(`${Name.value[eid]} moved to ${targetRoomName} searching for food`);
          }
        }
      }
      continue; // Action taken
    }
  
    // 3. Energy Logic
    if (energy < 30) {
      let bedFound = false;
      const roomEntities = ctx.getRelationTargets(world, currentRoomEid, ctx.relations.Contains) || [];
      for (const itemEid of roomEntities) {
        const traits = Traits.value[itemEid] || [];
        if (traits.includes("sleepable")) {
          // Sleep
          Needs.energy[eid] = Math.min(100, energy + 50);
          ctx.log(`${Name.value[eid]} is resting on ${Name.value[itemEid]}`);
          bedFound = true;
          break;
        }
      }
  
      if (!bedFound) {
        const targetRoomName = sleepRooms[Math.floor(Math.random() * sleepRooms.length)];
        if (currentRoomName !== targetRoomName) {
          const targetRoomEid = Array.from(ctx.query(world, [Room, Name])).find(reid => Name.value[reid] === targetRoomName);
          if (targetRoomEid) {
            ctx.removeRelation(world, eid, currentRoomEid, LocatedIn);
            ctx.addRelation(world, eid, targetRoomEid, LocatedIn);
            ctx.log(`${Name.value[eid]} moved to ${targetRoomName} searching for a bed`);
          }
        }
      }
    }
  }
}
