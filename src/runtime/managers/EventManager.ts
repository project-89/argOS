import { World } from "bitecs";
import {
  WorldState,
  AgentUpdateMessage,
  RoomEvent,
  ServerMessage,
  EventType,
  AgentEvent,
  EventCategory,
} from "../../types";
import { IEventManager } from "./IEventManager";
import { EventBus } from "../EventBus";
import { SimulationRuntime } from "../SimulationRuntime";
import { Agent, Room } from "../../components";
import { logger } from "../../utils/logger";

type EventWithCategory = {
  category: EventCategory;
  type: EventType;
  agentId: string;
  content: string;
  timestamp: number;
};

export class EventManager implements IEventManager {
  // Event handlers
  private agentUpdateHandlers = new Set<
    (agentId: number, roomId: number, data: AgentUpdateMessage) => void
  >();
  private roomUpdateHandlers = new Set<
    (roomId: string, data: RoomEvent) => void
  >();
  private worldUpdateHandlers = new Set<(data: WorldState) => void>();

  // Subscription tracking
  private roomSubscriptions = new Map<string, Set<(data: any) => void>>();
  private agentSubscriptions = new Map<number, Set<(data: any) => void>>();

  constructor(
    private world: World,
    private runtime: SimulationRuntime,
    private eventBus: EventBus
  ) {
    this.setupEventHandlers();
  }

  // Event emission
  emitAgentUpdate(
    agentId: number,
    roomId: number,
    data: AgentUpdateMessage
  ): void {
    this.agentUpdateHandlers.forEach((handler) =>
      handler(agentId, roomId, data)
    );
  }

  emitRoomUpdate(roomId: string, data: RoomEvent): void {
    this.roomUpdateHandlers.forEach((handler) => handler(roomId, data));
  }

  emitWorldUpdate(data: WorldState): void {
    this.worldUpdateHandlers.forEach((handler) => handler(data));
  }

  emitWorldState(): void {
    const worldState = this.runtime.getStateManager().getWorldState();
    this.emitWorldUpdate(worldState);
  }

  // Event subscriptions
  onAgentUpdate(
    handler: (agentId: number, roomId: number, data: AgentUpdateMessage) => void
  ): () => void {
    this.agentUpdateHandlers.add(handler);
    return () => this.agentUpdateHandlers.delete(handler);
  }

  onRoomUpdate(handler: (roomId: string, data: RoomEvent) => void): () => void {
    this.roomUpdateHandlers.add(handler);
    return () => this.roomUpdateHandlers.delete(handler);
  }

  onWorldUpdate(handler: (data: WorldState) => void): () => void {
    this.worldUpdateHandlers.add(handler);
    return () => this.worldUpdateHandlers.delete(handler);
  }

  // Room/Agent subscriptions
  subscribeToRoom(
    roomId: number,
    handler: (event: ServerMessage) => void
  ): void {
    logger.system(`Subscribing to room: ${roomId}`);
    const stringRoomId = Room.id[roomId] || String(roomId);

    if (!this.roomSubscriptions.has(stringRoomId)) {
      this.roomSubscriptions.set(stringRoomId, new Set());
    }
    this.roomSubscriptions.get(stringRoomId)?.add(handler);

    // Send initial room state
    const roomState = this.runtime.getStateManager().getRoomState(roomId);
    handler({
      type: "ROOM_UPDATE",
      data: {
        type: "state",
        roomId: stringRoomId,
        content: { room: roomState },
        timestamp: Date.now(),
      },
      timestamp: Date.now(),
    });

    // Send initial state for all agents in the room
    const occupants = this.runtime.getRoomManager().getRoomOccupants(roomId);
    occupants.forEach((agentId) => {
      const agentState = this.runtime.getStateManager().getAgentState(agentId);
      handler({
        type: "ROOM_UPDATE",
        data: {
          type: "state",
          roomId: stringRoomId,
          content: { agent: agentState },
          timestamp: Date.now(),
          agentId: String(agentId),
        },
        timestamp: Date.now(),
      });
    });
  }

  subscribeToAgent(
    agentId: number,
    handler: (event: ServerMessage) => void
  ): void {
    logger.system(`Subscribing to agent: ${agentId}`);

    if (!this.agentSubscriptions.has(agentId)) {
      this.agentSubscriptions.set(agentId, new Set());
    }
    this.agentSubscriptions.get(agentId)?.add(handler);

    // Send initial agent state
    const agentState = this.runtime.getStateManager().getAgentState(agentId);
    const roomId = this.runtime.getRoomManager().getAgentRoom(agentId);

    if (roomId) {
      handler({
        type: "AGENT_UPDATE",
        channel: {
          room: String(roomId),
          agent: String(agentId),
        },
        data: {
          type: "state",
          agentId: String(agentId),
          category: "state",
          content: { agent: agentState },
          timestamp: Date.now(),
        },
        timestamp: Date.now(),
      });
    }
  }

  cleanup(): void {
    this.agentUpdateHandlers.clear();
    this.roomUpdateHandlers.clear();
    this.worldUpdateHandlers.clear();
    this.roomSubscriptions.clear();
    this.agentSubscriptions.clear();
  }

  private setupEventHandlers(): void {
    // Handle all events for rooms
    this.eventBus.subscribe(
      "room:*",
      (event: RoomEvent<EventType> | AgentEvent<EventType>) => {
        if ("roomId" in event && event.roomId) {
          // Only emit pure room events (not agent events) as room updates
          if (!("category" in event)) {
            this.emitRoomUpdate(event.roomId, event as RoomEvent<EventType>);
          }
        }
      }
    );

    // Handle agent-specific events
    this.eventBus.subscribe(
      "agent:*",
      (_event: RoomEvent<EventType> | AgentEvent<EventType>) => {
        const event = _event as AgentEvent<EventType>;
        if ("category" in event) {
          const agentId = event.agentId;
          if (!agentId) {
            console.error("No agentId in event data:", event);
            return;
          }

          // Get agent's room
          const agentRoom = this.runtime
            .getRoomManager()
            .getAgentRoom(Number(agentId));
          if (agentRoom) {
            // Send full event to direct agent subscribers
            const agentEvent: AgentUpdateMessage = {
              type: "AGENT_UPDATE",
              channel: {
                room: String(agentRoom),
                agent: String(agentId),
              },
              data: {
                type: event.type,
                agentId: event.agentId,
                category: event.category,
                content: event.content,
                timestamp: event.timestamp,
              },
              timestamp: event.timestamp,
            };

            // Send to agent subscribers
            this.emitAgentUpdate(Number(agentId), agentRoom, agentEvent);

            // Categories that directly affect a specific room
            const roomSpecificCategories = ["speech", "action", "appearance"];

            // For room-specific events, send only to the current room
            if (roomSpecificCategories.includes(agentEvent.data.category)) {
              this.emitRoomUpdate(String(agentRoom), {
                type: agentEvent.data.type,
                roomId: String(agentRoom),
                content: agentEvent.data.content,
                timestamp: agentEvent.data.timestamp,
                agentId: agentEvent.data.agentId,
              });
            }
          }
        }
      }
    );
  }
}
