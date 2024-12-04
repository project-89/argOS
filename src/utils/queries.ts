import { World, query, hasComponent } from "bitecs";
import { Agent, Room, OccupiesRoom } from "../components/agent/Agent";

/**
 * Get all occupants of a room
 */
export function getRoomOccupants(
  world: World,
  roomEid: number
): readonly number[] {
  const entities = query(world, [Agent]);
  return entities.filter((eid) =>
    hasComponent(world, eid, OccupiesRoom(roomEid))
  );
}

/**
 * Get the room an agent is in
 */
export function getAgentRoom(
  world: World,
  agentEid: number
): number | undefined {
  const rooms = query(world, [Room]);
  return rooms.find((roomEid) =>
    hasComponent(world, agentEid, OccupiesRoom(roomEid))
  );
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

/**
 * Get all agents in a room with a specific role
 */
export function getAgentsInRoomByRole(
  world: World,
  roomEid: number,
  role: string
): readonly number[] {
  return query(world, [Agent]).filter(
    (eid) =>
      Agent.role[eid] === role &&
      hasComponent(world, eid, OccupiesRoom(roomEid))
  );
}

/**
 * Check if an agent is in a specific room
 */
export function isAgentInRoom(
  world: World,
  agentEid: number,
  roomEid: number
): boolean {
  return hasComponent(world, agentEid, OccupiesRoom(roomEid));
}

/**
 * Get all agents in a room
 */
export function getAgentsInRoom(world: World, roomEid: number): number[] {
  const entities = query(world, [Agent]);
  return entities.filter((eid) =>
    hasComponent(world, eid, OccupiesRoom(roomEid))
  );
}

/**
 * Get all agents with a given role in a room
 */
export function getAgentsByRoleInRoom(
  world: World,
  role: string,
  roomEid: number
): number[] {
  return query(world, [Agent]).filter(
    (eid) =>
      Agent.role[eid] === role &&
      hasComponent(world, eid, OccupiesRoom(roomEid))
  );
}
