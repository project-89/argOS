import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "NPCBehaviorLoop";
export const description = "Grounded NPC behavior loop for hunger and energy management.";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  
  const { Agent, Needs, Room, Name } = ctx.components;
  const ObjectMeta = ctx.getDynamic("ObjectMeta");
  const LocatedIn = ctx.relations.LocatedIn;
  
  if (!ObjectMeta || !LocatedIn) return;
  
  const foodRooms = [11, 9, 8]; // Bakery, Marketplace, The Golden Wheat
  const sleepRooms = [8, 11, 13, 14, 10]; // Tavern, Bakery, Mill, Farm, Blacksmith
  
  const agents = Array.from(ctx.query(world, [Agent, Needs, Room]));
  const allObjects = Array.from(ctx.query(world, [Name])).filter(eid => ctx.hasDynamic(eid, "ObjectMeta"));
  
  for (const agentEid of agents) {
    const hunger = Needs.hunger[agentEid] ?? 0;
    const energy = Needs.energy[agentEid] ?? 100;
    const currentRoom = Room.value[agentEid];
  
    // 1. Hunger high -> eat
    if (hunger > 80) {
      const edible = allObjects.find(objEid => {
        const traits = ObjectMeta.traits[objEid];
        const locs = ctx.getRelationTargets(world, objEid, LocatedIn);
        return traits && traits.includes("edible") && locs.includes(currentRoom);
      });
  
      if (edible !== undefined) {
        Needs.hunger[agentEid] = 0;
        ctx.removeEntity(world, edible);
        ctx.log(`${Name.value[agentEid]} ate something in ${Name.value[currentRoom]}`);
        continue;
      } else {
        const targetRoom = foodRooms[Math.floor(Math.random() * foodRooms.length)];
        if (currentRoom !== targetRoom) {
          Room.value[agentEid] = targetRoom;
          ctx.log(`${Name.value[agentEid]} is hungry and moving to room ${targetRoom}`);
          continue;
        }
      }
    }
  
    // 2. Energy low -> rest
    if (energy < 20) {
      const sleepable = allObjects.find(objEid => {
        const traits = ObjectMeta.traits[objEid];
        const locs = ctx.getRelationTargets(world, objEid, LocatedIn);
        return traits && traits.includes("sleepable") && locs.includes(currentRoom);
      });
  
      if (sleepable !== undefined) {
        Needs.energy[agentEid] = 100;
        ctx.log(`${Name.value[agentEid]} rested in ${Name.value[currentRoom]}`);
        continue;
      } else {
        const targetRoom = sleepRooms[Math.floor(Math.random() * sleepRooms.length)];
        if (currentRoom !== targetRoom) {
          Room.value[agentEid] = targetRoom;
          ctx.log(`${Name.value[agentEid]} is tired and moving to room ${targetRoom}`);
          continue;
        }
      }
    }
  }
  
}
