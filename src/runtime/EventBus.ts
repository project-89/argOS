import { World, query } from "bitecs";
import { Room, OccupiesRoom, Agent, Appearance } from "../components";
import {
  RoomEvent,
  AgentEvent,
  EventType,
  EventCategory,
  RoomState,
  AgentState,
} from "../types";
import { SimulationLogger } from "../utils/simulation-logger";

export class EventBus {
  private world: World;
  private handlers = new Map<
    string,
    Set<(data: RoomEvent | AgentEvent) => void>
  >();
  private roomOccupants = new Map<number, Set<number>>();
  private simulationLogger: SimulationLogger;

  constructor(world: World) {
    this.world = world;
    this.simulationLogger = new SimulationLogger();
  }

  // Get room an agent is in
  private getAgentRoom(eid: number): number | null {
    const rooms = query(this.world, [Room]);
    for (const roomId of rooms) {
      const occupants = query(this.world, [OccupiesRoom(roomId)]);
      if (occupants.includes(eid)) {
        return roomId;
      }
    }
    return null;
  }

  // Build room state object
  private buildRoomState(roomId: number): RoomState {
    const occupants = query(this.world, [OccupiesRoom(roomId)]).map((eid) => ({
      id: String(eid),
      name: Agent.name[eid],
      attention: Agent.attention[eid],
    }));

    return {
      id: Room.id[roomId] || String(roomId),
      eid: roomId,
      name: Room.name[roomId],
      type: Room.type[roomId],
      description: Room.description[roomId],
      occupants,
      stimuli: [], // Populated by stimulus system
      lastUpdate: Date.now(),
    };
  }

  // Build agent state object
  private buildAgentState(eid: number): AgentState {
    const roomId = this.getAgentRoom(eid);

    return {
      id: String(eid),
      name: Agent.name[eid],
      role: Agent.role[eid],
      systemPrompt: Agent.systemPrompt[eid],
      active: Agent.active[eid],
      platform: Agent.platform[eid],
      appearance: {
        description: Appearance.description[eid],
        facialExpression: Appearance.facialExpression[eid],
        bodyLanguage: Appearance.bodyLanguage[eid],
        currentAction: Appearance.currentAction[eid],
        socialCues: Appearance.socialCues[eid],
      },
      attention: Agent.attention[eid],
      roomId: roomId ? Room.id[roomId] || String(roomId) : null,
      facialExpression: Appearance.facialExpression[eid],
      bodyLanguage: Appearance.bodyLanguage[eid],
      currentAction: Appearance.currentAction[eid],
      socialCues: Appearance.socialCues[eid],
      lastUpdate: Date.now(),
      thoughtHistory: [],
      perceptions: {
        narrative: "",
        raw: [],
      },
      lastAction: {
        success: false,
        message: "No action taken yet",
        timestamp: Date.now(),
        actionName: "none",
        parameters: {},
        data: {},
      },
      timeSinceLastAction: 0,
      experiences: [],
      availableTools: [],
      goals: [],
      completedGoals: [],
    };
  }

  // Emit event to a room channel
  emitRoomEvent(
    roomEid: number,
    type: EventType,
    content: any,
    agentId?: string
  ) {
    const stringRoomId = Room.id[roomEid] || String(roomEid);
    const event: RoomEvent = {
      type,
      roomId: stringRoomId,
      content:
        type === "state" ? { room: this.buildRoomState(roomEid) } : content,
      timestamp: Date.now(),
      agentId,
    };

    // First broadcast to subscribers
    this.broadcast(`room:${stringRoomId}`, event);

    // Then log event
    if (type === "state" && content.room) {
      this.simulationLogger.updateRoomState(stringRoomId, content.room);
    }
    this.simulationLogger.logRoomEvent(event);
  }

  // Emit event to an agent channel
  emitAgentEvent(
    agentId: number,
    type: EventType,
    category: EventCategory,
    content: any
  ) {
    const stringAgentId = String(agentId);
    const event: AgentEvent = {
      type,
      agentId: stringAgentId,
      category,
      content:
        type === "state" ? { agent: this.buildAgentState(agentId) } : content,
      timestamp: Date.now(),
    };

    // First broadcast to subscribers
    this.broadcast(`agent:${stringAgentId}`, event);

    // Then emit to room and log
    const roomId = this.getAgentRoom(agentId);
    if (roomId) {
      const stringRoomId = Room.id[roomId] || String(roomId);
      // Emit to room channel
      this.emitRoomEvent(roomId, type, content, stringAgentId);
      // Log agent event
      this.simulationLogger.logAgentEvent(event, stringRoomId);
    }
  }

  // Update room occupancy
  update() {
    const rooms = query(this.world, [Room]);

    for (const roomId of rooms) {
      const currentOccupants = new Set(
        query(this.world, [OccupiesRoom(roomId)])
      );
      const previousOccupants = this.roomOccupants.get(roomId) || new Set();

      // Check for changes in occupancy
      for (const eid of currentOccupants) {
        if (!previousOccupants.has(eid)) {
          this.emitRoomEvent(
            roomId,
            "state",
            {
              room: this.buildRoomState(roomId),
              agent: this.buildAgentState(eid),
            },
            String(eid)
          );
        }
      }

      for (const eid of previousOccupants) {
        if (!currentOccupants.has(eid)) {
          this.emitRoomEvent(
            roomId,
            "state",
            {
              room: this.buildRoomState(roomId),
              agent: this.buildAgentState(eid),
            },
            String(eid)
          );
        }
      }

      this.roomOccupants.set(roomId, currentOccupants);
    }
  }

  // Get current room occupants
  getRoomOccupants(roomId: number): number[] {
    return Array.from(this.roomOccupants.get(roomId) || []);
  }

  // Subscribe to events
  subscribe(channel: string, handler: (data: RoomEvent | AgentEvent) => void) {
    if (!this.handlers.has(channel)) {
      this.handlers.set(channel, new Set());
    }
    this.handlers.get(channel)?.add(handler);
    return () => {
      const handlers = this.handlers.get(channel);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.handlers.delete(channel);
        }
      }
    };
  }

  broadcast(channel: string, data: RoomEvent | AgentEvent) {
    // Exact channel handlers
    const handlers = this.handlers.get(channel);
    if (handlers) {
      handlers.forEach((handler) => handler(data));
    }

    // Wildcard handlers (e.g., "room:*")
    const wildcardChannel = channel.split(":")[0] + ":*";
    const wildcardHandlers = this.handlers.get(wildcardChannel);
    if (wildcardHandlers) {
      wildcardHandlers.forEach((handler) => handler(data));
    }
  }

  cleanup() {
    this.handlers.clear();
    this.roomOccupants.clear();
  }
}
