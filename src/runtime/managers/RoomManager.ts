import {
  World,
  addEntity,
  removeEntity,
  query,
  hasComponent,
  setComponent,
  addComponent,
  removeComponent,
} from "bitecs";
import { Room as RoomData, RoomState } from "../../types";
import {
  Agent,
  Room,
  Appearance,
  OccupiesRoom,
  Stimulus,
} from "../../components/agent/Agent";
import { IRoomManager } from "./IRoomManager";
import { logger } from "../../utils/logger";
import { SimulationRuntime } from "../SimulationRuntime";

export class RoomManager implements IRoomManager {
  constructor(private world: World, private runtime: SimulationRuntime) {}

  // Room CRUD
  createRoom(roomData: Partial<RoomData>): number {
    const roomEntity = addEntity(this.world);

    setComponent(this.world, roomEntity, Room, {
      id: roomData.id || String(roomEntity),
      name: roomData.name || "New Room",
      description: roomData.description || "",
      type: roomData.type || "physical",
    });

    logger.system(`Created room: ${roomData.name || "New Room"}`);
    return roomEntity;
  }

  getRooms(): RoomState[] {
    return query(this.world, [Room]).map((roomId) =>
      this.runtime.getStateManager().getRoomState(roomId)
    );
  }

  getRoomById(roomId: string): number | null {
    const rooms = query(this.world, [Room]);
    for (const eid of rooms) {
      if (Room.id[eid] === roomId) {
        return eid;
      }
    }
    return null;
  }

  deleteRoom(roomId: number): void {
    // First, move all occupants out
    const occupants = this.getRoomOccupants(roomId);
    for (const agentId of occupants) {
      removeComponent(this.world, agentId, OccupiesRoom(roomId));
    }

    removeEntity(this.world, roomId);
    logger.system(`Deleted room: ${Room.name[roomId]}`);
  }

  // Room occupancy
  moveAgentToRoom(agentId: number, roomId: number): void {
    // Verify room exists
    const rooms = query(this.world, [Room]);
    if (!rooms.includes(roomId)) {
      logger.error(`Room ${roomId} not found`);
      return;
    }

    // Find and remove current room relationships
    const currentRooms = query(this.world, [Room]).filter((eid) =>
      hasComponent(this.world, agentId, OccupiesRoom(eid))
    );

    for (const currentRoom of currentRooms) {
      removeComponent(this.world, agentId, OccupiesRoom(currentRoom));
      logger.system(
        `Removed agent ${agentId} from room ${Room.name[currentRoom]}`
      );

      // Emit room update for the old room
      this.runtime.eventBus.emitRoomEvent(currentRoom, "state", {
        room: this.runtime.getStateManager().getRoomState(currentRoom),
      });
    }

    // Add new room relationship
    addComponent(this.world, agentId, OccupiesRoom(roomId));
    logger.system(`Added agent ${agentId} to room ${Room.name[roomId]}`);

    // Update agent's appearance to show room transition
    if (hasComponent(this.world, agentId, Appearance)) {
      Appearance.currentAction[agentId] = "entered the room";
      Appearance.lastUpdate[agentId] = Date.now();
    }

    // Emit room update for the new room
    this.runtime.eventBus.emitRoomEvent(roomId, "state", {
      room: this.runtime.getStateManager().getRoomState(roomId),
    });
  }

  getRoomOccupants(roomId: number): number[] {
    return query(this.world, [Agent]).filter((eid) =>
      hasComponent(this.world, eid, OccupiesRoom(roomId))
    );
  }

  getAgentRoom(agentId: number): number | null {
    const rooms = query(this.world, [Room]);
    for (const roomId of rooms) {
      if (hasComponent(this.world, agentId, OccupiesRoom(roomId))) {
        return roomId;
      }
    }
    return null;
  }

  // Room-specific operations
  getRoomStimuli(roomId: number): number[] {
    const roomStringId = Room.id[roomId] || String(roomId);
    return Object.keys(Stimulus.roomId)
      .map(Number)
      .filter((eid) => Stimulus.roomId[eid] === roomStringId);
  }

  updateRoomState(roomId: number, updates: Partial<RoomData>): void {
    if (Room.id[roomId]) {
      setComponent(this.world, roomId, Room, {
        id: updates.id || Room.id[roomId],
        name: updates.name || Room.name[roomId],
        description: updates.description || Room.description[roomId],
        type: updates.type || Room.type[roomId],
      });

      // Emit room update
      this.runtime.eventBus.emitRoomEvent(roomId, "state", {
        room: this.runtime.getStateManager().getRoomState(roomId),
      });

      logger.system(`Updated room: ${Room.name[roomId]}`);
    }
  }
}
