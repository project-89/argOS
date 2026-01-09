import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "TensionBuildupSystem";
export const description = "Increases localized tension in rooms with multiple diverse agents.";
export const frequency = 1;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const Tension = ctx.getDynamic("Tension");
  if (!Tension) return;
  
  const { Room, Agent, Name } = ctx.components;
  const { OccupiesRoom } = ctx.relations;
  
  const rooms = Array.from(ctx.query(world, [Room]));
  
  for (const roomEid of rooms) {
      if (Tension.level[roomEid] === undefined) continue;
  
      // Find agents in this room
      const occupants = ctx.getRelationTargets(world, roomEid, OccupiesRoom);
      const agentsInRoom = occupants.filter(eid => ctx.components.Agent.active[eid]);
  
      if (agentsInRoom.length > 1) {
          // Count unique roles to simulate "different temperaments"
          const roles = new Set();
          for (const agentEid of agentsInRoom) {
              roles.add(Agent.role[agentEid]);
          }
  
          // Increase tension based on the number of different roles present
          const buildup = roles.size * 0.05; 
          const currentLevel = Tension.level[roomEid];
          const maxLevel = Tension.max[roomEid] || 100;
  
          Tension.level[roomEid] = Math.min(maxLevel, currentLevel + buildup);
  
          if (Tension.level[roomEid] > 70 && ctx.tick % 20 === 0) {
              ctx.emit("high_tension", { room: Name.value[roomEid], level: Tension.level[roomEid] });
              ctx.log(`The air in ${Name.value[roomEid]} grows heavy with unspoken conflict.`);
          }
      } else {
          // Tension slowly decays if the room is empty or only has one person
          Tension.level[roomEid] = Math.max(0, Tension.level[roomEid] - 0.02);
      }
  }
}
