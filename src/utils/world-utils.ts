import { World } from "../types/bitecs";
import { query } from "bitecs";
import { Room } from "../components/agent/Agent";

export function findAgentRoom(world: World, agentId: number): number | null {
  const rooms = query(world, [Room]);
  for (const roomId of rooms) {
    if (Room.occupants[roomId]?.includes(agentId)) {
      return roomId;
    }
  }
  return null;
}
