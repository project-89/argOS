import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "NPCGroundedBehavior";
export const description = "Deterministic NPC behavior loop for hunger and energy.";
export const frequency = 5;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const { Needs, BehaviorPolicy, Room, Name, Agent } = ctx.components;
  const ObjectMeta = ctx.getDynamic("ObjectMeta");
  if (!ObjectMeta) return;
  
  const agents = Array.from(ctx.query(world, [Agent, Needs, BehaviorPolicy, Room, Name]));
  const allEntities = Array.from(ctx.query(world, [Name, Room]));
  
  for (const eid of agents) {
    const hunger = Needs.hunger[eid] || 0;
    const energy = Needs.energy[eid] || 100;
    const currentRoom = Room.value[eid];
  
    // 1. Hunger Logic
    if (hunger > 80) {
      const food = allEntities.find(targetEid => {
        if (Room.value[targetEid] !== currentRoom) return false;
        if (!ctx.hasDynamic(targetEid, "ObjectMeta")) return false;
        const traits = ObjectMeta.traits[targetEid];
        return traits && traits.includes("edible");
      });
  
      if (food !== undefined) {
        Needs.hunger[eid] = 0;
        ctx.log(`${Name.value[eid]} ate ${Name.value[food]} in ${currentRoom}`);
        ctx.removeEntity(world, food);
        continue;
      } else {
        const destinations = ["Grand Bazaar Market", "The Rusty Tankard Tavern", "Old Town Bakery"];
        if (!destinations.includes(currentRoom)) {
          const target = destinations[Math.floor(Math.random() * destinations.length)];
          Room.value[eid] = target;
          ctx.log(`${Name.value[eid]} is hungry and heading to ${target}`);
          continue;
        }
      }
    }
  
    // 2. Energy Logic
    if (energy < 20) {
      const bed = allEntities.find(targetEid => {
        if (Room.value[targetEid] !== currentRoom) return false;
        if (!ctx.hasDynamic(targetEid, "ObjectMeta")) return false;
        const traits = ObjectMeta.traits[targetEid];
        return traits && traits.includes("sleepable");
      });
  
      if (bed !== undefined) {
        Needs.energy[eid] = 100;
        ctx.log(`${Name.value[eid]} is sleeping on ${Name.value[bed]} in ${currentRoom}`);
        continue;
      } else {
        const target = "The Rusty Tankard Tavern";
        if (currentRoom !== target) {
          Room.value[eid] = target;
          ctx.log(`${Name.value[eid]} is tired and heading to ${target}`);
          continue;
        }
      }
    }
  }
}
