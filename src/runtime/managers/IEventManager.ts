import {
  WorldState,
  AgentEventMessage,
  RoomEvent,
  ServerMessage,
} from "../../types";

export interface IEventManager {
  // Event emission
  emitAgentUpdate(
    agentId: number,
    roomId: number,
    data: AgentEventMessage
  ): void;
  emitRoomUpdate(roomId: string, data: RoomEvent): void;
  emitWorldUpdate(data: WorldState): void;
  emitWorldState(): void;

  // Event subscriptions
  onAgentUpdate(
    handler: (agentId: number, roomId: number, data: AgentEventMessage) => void
  ): () => void;
  onRoomUpdate(handler: (roomId: string, data: RoomEvent) => void): () => void;
  onWorldUpdate(handler: (data: WorldState) => void): () => void;

  // Room/Agent subscriptions
  subscribeToRoom(
    roomId: number,
    handler: (event: ServerMessage) => void
  ): void;
  subscribeToAgent(
    agentId: number,
    handler: (event: ServerMessage) => void
  ): void;

  // Cleanup
  cleanup(): void;
}
