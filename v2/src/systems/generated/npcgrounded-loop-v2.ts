import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "NPCGroundedLoopV2";
export const description = "NPC Grounded Loop: Manages hunger/energy and moves NPCs between rooms to satisfy needs.";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const { Needs, Agent, Name, Room, Traits, BehaviorPolicy } = ctx.components;
  const { LocatedIn } = ctx.relations;
  
  const agents = Array.from(ctx.query(world, [Agent, Needs]));
  const allEntities = Array.from(ctx.query(world, [Name]));
  
  // Room IDs
  const rooms = allEntities.filter(eid => {
    const name = Name.value[eid].toLowerCase();
    return name.includes('tavern') || name.includes('market') || name.includes('bakery') || name.includes('kitchen');
  });
  
  for (const eid of agents) {
    const hunger = Needs.hunger[eid] || 0;
    const energy = Needs.energy[eid] || 100;
    const currentRoomEid = ctx.getRelationTargets(world, eid, LocatedIn)[0];
    
    if (!ctx.hasDynamic(eid, "BehaviorPolicy")) {
      // BehaviorPolicy is built-in, but let's check values
    }
  
    let actionTaken = false;
  
    // Hunger high -> eat
    if (hunger > 70) {
      const edibleInRoom = allEntities.find(objEid => {
        const traits = ctx.components.Traits.value[objEid];
        if (!traits) return false;
        const inSameRoom = ctx.getRelationTargets(world, objEid, LocatedIn)[0] === currentRoomEid;
        // Traits might be a bitmask or array. Assuming array of strings based on defineObjectType.
        return inSameRoom && Array.from(traits).includes('edible');
      });
  
      if (edibleInRoom) {
        Needs.hunger[eid] = Math.max(0, hunger - 50);
        BehaviorPolicy.policy[eid] = 'eating';
        ctx.log(`${Name.value[eid]} ate ${Name.value[edibleInRoom]} in ${Name.value[currentRoomEid]}`);
        actionTaken = true;
      } else {
        // Move to a food room
        const foodRoom = rooms.find(r => {
          const n = Name.value[r].toLowerCase();
          return (n.includes('market') || n.includes('bakery') || n.includes('kitchen')) && r !== currentRoomEid;
        });
        if (foodRoom) {
          ctx.removeRelation(world, eid, LocatedIn, currentRoomEid);
          ctx.addRelation(world, eid, LocatedIn, foodRoom);
          BehaviorPolicy.policy[eid] = 'searching_food';
          ctx.log(`${Name.value[eid]} is hungry and moving to ${Name.value[foodRoom]}`);
          actionTaken = true;
        }
      }
    }
  
    // Energy low -> sleep
    if (!actionTaken && energy < 30) {
      const sleepableInRoom = allEntities.find(objEid => {
        const traits = ctx.components.Traits.value[objEid];
        if (!traits) return false;
        const inSameRoom = ctx.getRelationTargets(world, objEid, LocatedIn)[0] === currentRoomEid;
        return inSameRoom && Array.from(traits).includes('sleepable');
      });
  
      if (sleepableInRoom) {
        Needs.energy[eid] = Math.min(100, energy + 40);
        BehaviorPolicy.policy[eid] = 'sleeping';
        ctx.log(`${Name.value[eid]} is resting on ${Name.value[sleepableInRoom]} in ${Name.value[currentRoomEid]}`);
        actionTaken = true;
      } else {
        // Move to Tavern
        const tavern = rooms.find(r => Name.value[r].toLowerCase().includes('tavern') && r !== currentRoomEid);
        if (tavern) {
          ctx.removeRelation(world, eid, LocatedIn, currentRoomEid);
          ctx.addRelation(world, eid, LocatedIn, tavern);
          BehaviorPolicy.policy[eid] = 'searching_rest';
          ctx.log(`${Name.value[eid]} is tired and moving to the Tavern`);
          actionTaken = true;
        }
      }
    }
    
    if (!actionTaken) {
      BehaviorPolicy.policy[eid] = 'idle';
    }
  }
}
