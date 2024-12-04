import { World, query } from "bitecs";
import { Agent, Room, OccupiesRoom } from "../components/agent/Agent";

type RoomRelation = { room: number[] };

/**
 * Get all occupants of a room
 */
export function getRoomOccupants(
  world: World,
  roomId: number
): readonly number[] {
  return query(world, [OccupiesRoom]).filter(
    (eid) => (OccupiesRoom as unknown as RoomRelation).room[eid] === roomId
  );
}

/**
 * Get the room an agent is in
 */
export function getAgentRoom(
  world: World,
  agentId: number
): number | undefined {
  const hasRoom = query(world, [OccupiesRoom]).includes(agentId);
  if (!hasRoom) return undefined;
  return (OccupiesRoom as unknown as RoomRelation).room[agentId];
}

/**
 * Find a room entity by its string ID
 */
export function findRoomByStringId(
  world: World,
  roomId: string
): number | undefined {
  const rooms = query(world, [Room]);
  return rooms.find((eid) => Room.id[eid] === roomId);
}

/**
 * Get all active agents
 */
export function getActiveAgents(world: World): readonly number[] {
  return query(world, [Agent]).filter((eid) => Agent.active[eid]);
}

/**
 * Get all rooms
 */
export function getRooms(world: World): readonly number[] {
  return query(world, [Room]);
}

/**
 * Get all agents with a given role
 */
export function getAgentsByRole(world: World, role: string): readonly number[] {
  return query(world, [Agent]).filter((eid) => Agent.role[eid] === role);
}
