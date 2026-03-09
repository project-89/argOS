import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "NPCBehaviorSystem";
export const description = "Updates NPC BehaviorPolicy based on needs and room contents.";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const { Agent, Needs, Room, BehaviorPolicy } = ctx.components;
  const ObjectMeta = ctx.getDynamic("ObjectMeta");
  if (!ObjectMeta) return;
  
  const agents = Array.from(ctx.query(world, [Agent, Needs, Room, BehaviorPolicy]));
  const allEntities = Array.from(ctx.query(world, [Room]));
  const rooms = allEntities.filter(eid => !ctx.components.Agent.value[eid]);
  
  for (const eid of agents) {
    if (BehaviorPolicy.action[eid] && BehaviorPolicy.action[eid] !== "idle") continue;
  
    const hunger = Needs.hunger[eid] || 0;
    const energy = Needs.energy[eid] || 100;
    const currentRoom = Room.value[eid];
  
    if (hunger > 80) {
      const food = allEntities.find(t => Room.value[t] === currentRoom && (ObjectMeta.traits[t] || "").includes("edible"));
      if (food) {
        BehaviorPolicy.target[eid] = food;
        BehaviorPolicy.action[eid] = "eat";
        continue;
      }
    }
  
    if (energy < 20) {
      const bed = allEntities.find(t => Room.value[t] === currentRoom && (ObjectMeta.traits[t] || "").includes("sleepable"));
      if (bed) {
        BehaviorPolicy.target[eid] = bed;
        BehaviorPolicy.action[eid] = "sleep";
        continue;
      }
    }
  
    const dest = rooms[Math.floor(Math.random() * rooms.length)];
    if (dest && dest !== currentRoom) {
      BehaviorPolicy.target[eid] = dest;
      BehaviorPolicy.action[eid] = "move";
    }
  }
}
