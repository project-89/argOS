import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "NPCBehaviorLoopSystem";
export const description = "NPC Behavior Loop: Handles hunger/energy decay and autonomous actions (eating, sleeping, moving).";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const { Needs, Room, Name, Agent, BehaviorPolicy } = ctx.components;
  const ObjectMeta = ctx.getDynamic("ObjectMeta");
  if (!ObjectMeta) return;
  
  const agents = Array.from(ctx.query(world, [Agent, Needs, Room, BehaviorPolicy]));
  const objects = Array.from(ctx.query(world, [Room])).filter(eid => ctx.hasDynamic(eid, "ObjectMeta"));
  
  const FOOD_ROOMS = [72, 231, 232]; 
  const SLEEP_ROOMS = [233];
  const ALL_ROOMS = [72, 231, 232, 233];
  
  for (const eid of agents) {
    // Decay needs
    const currentHunger = Needs.hunger[eid] ?? 0;
    const currentEnergy = Needs.energy[eid] ?? 100;
    
    Needs.hunger[eid] = Math.min(100, currentHunger + 1);
    Needs.energy[eid] = Math.max(0, currentEnergy - 1);
  
    const hunger = Needs.hunger[eid];
    const energy = Needs.energy[eid];
    const currentRoom = Room.value[eid];
  
    // Logic
    if (hunger > 80) {
      const food = objects.find(oid => Room.value[oid] === currentRoom && (ObjectMeta.traits[oid] || "").includes("edible"));
      if (food) {
        Needs.hunger[eid] = 0;
        ctx.log(`${Name.value[eid]} eats ${Name.value[food]}.`);
      } else {
        const targetRoom = FOOD_ROOMS[Math.floor(Math.random() * FOOD_ROOMS.length)];
        if (currentRoom !== targetRoom) {
          Room.value[eid] = targetRoom;
          ctx.log(`${Name.value[eid]} is hungry and moves to room ${targetRoom}.`);
        }
      }
    } else if (energy < 20) {
      const bed = objects.find(oid => Room.value[oid] === currentRoom && (ObjectMeta.traits[oid] || "").includes("sleepable"));
      if (bed) {
        Needs.energy[eid] = 100;
        ctx.log(`${Name.value[eid]} sleeps in ${Name.value[bed]}.`);
      } else {
        const targetRoom = SLEEP_ROOMS[0];
        if (currentRoom !== targetRoom) {
          Room.value[eid] = targetRoom;
          ctx.log(`${Name.value[eid]} is tired and moves to room ${targetRoom}.`);
        }
      }
    } else if (Math.random() < 0.02) {
      const targetRoom = ALL_ROOMS[Math.floor(Math.random() * ALL_ROOMS.length)];
      if (currentRoom !== targetRoom) {
        Room.value[eid] = targetRoom;
        ctx.log(`${Name.value[eid]} wanders to a new room.`);
      }
    }
  }
}
