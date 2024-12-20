import { World } from "bitecs";
import { Room as RoomData, RoomState } from "../../types/state";

export interface IRoomManager {
  // Room CRUD
  createRoom(roomData: Partial<RoomData>): number;
  getRooms(): RoomState[];
  getRoomById(roomId: string): number | null;
  deleteRoom(roomId: number): void;

  // Room occupancy
  moveAgentToRoom(agentId: number, roomId: number): void;
  getRoomOccupants(roomId: number): number[];
  getAgentRoom(agentId: number): number | null;

  // Room-specific operations
  getRoomStimuli(roomId: number): number[];
  updateRoomState(roomId: number, updates: Partial<RoomData>): void;
  addStimulusToRoom(stimulusId: number, roomId: number): void;
}
