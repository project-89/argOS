import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "FriendlyGreetingSystem";
export const description = "Triggers friendly greetings between agents in the same room.";
export const frequency = 60;
export const active = true;

export function run(world: World, ctx: SystemContext): void {
  const { Agent, Room, Name } = ctx.components;
  const agents = Array.from(ctx.query(world, [Agent, Room, Name]));
  const roomGroups = new Map();
  
  for (const eid of agents) {
    const roomId = Room.value[eid]; // Assuming Room.value stores the room entity ID
    if (!roomGroups.has(roomId)) roomGroups.set(roomId, []);
    roomGroups.get(roomId).push(eid);
  }
  
  for (const [roomId, roomAgents] of roomGroups) {
    if (roomAgents.length > 1) {
      const greeterIndex = Math.floor(Math.random() * roomAgents.length);
      const greeterId = roomAgents[greeterIndex];
      const targetId = roomAgents[(greeterIndex + 1) % roomAgents.length];
      
      const greeterName = Name.value[greeterId];
      ctx.emit("stimulus", { 
        type: "social", 
        target: Name.value[targetId], 
        content: `${greeterName} smiles warmly and gives you a friendly wave.` 
      });
    }
  }
}
