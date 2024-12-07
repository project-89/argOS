import "dotenv/config";
import {
  World,
  addEntity,
  addComponent,
  removeEntity,
  query,
  hasComponent,
  removeComponent,
  setComponent,
} from "bitecs";
import {
  WorldState,
  Room as RoomData,
  AgentEventMessage,
  RoomEvent,
  AgentEvent,
  ServerMessage,
  RoomUpdateMessage,
  EventType,
  MessageType,
  Agent as AgentType,
  ActionModule,
  AgentUpdateMessage,
  RoomState,
  AgentState,
  InternalRoomState,
  NetworkLink,
} from "../types";
import { logger } from "../utils/logger";
import {
  Agent,
  Memory,
  Perception,
  Room,
  Stimulus,
  OccupiesRoom,
  Appearance,
} from "../components/agent/Agent";
import { EventBus } from "./EventBus";
import { ComponentSync } from "./ComponentSync";
import EventEmitter from "events";
import { EventPayload } from "../types/events";

// Validate required environment variables
if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  throw new Error(
    "GOOGLE_GENERATIVE_AI_API_KEY is required but not set in environment variables"
  );
}

export type SystemFactory = (
  runtime: SimulationRuntime
) => (world: World) => Promise<World>;

export interface RuntimeConfig {
  updateInterval?: number;
  systems?: SystemFactory[];
  actions?: Record<string, ActionModule>;
  components?: any[];
}

const DEFAULT_CONFIG: RuntimeConfig = {
  updateInterval: 100,
  systems: [],
  actions: {},
  components: [Room, Agent, Memory, Stimulus, Perception],
};

export class SimulationRuntime extends EventEmitter {
  public world: World;
  private systems: ((world: World) => Promise<World>)[];
  private _isRunning = false;
  private updateInterval: number;
  private observers: (() => void)[] = [];
  public actions: Record<string, ActionModule>;
  public eventBus: EventBus;
  private componentSync: ComponentSync;

  // Subscription tracking
  private roomSubscriptions = new Map<string, Set<(data: any) => void>>();
  private agentSubscriptions = new Map<number, Set<(data: any) => void>>();

  // Event handlers
  private agentUpdateHandlers: Set<
    (agentId: number, roomId: number, data: AgentEventMessage) => void
  > = new Set();
  private roomUpdateHandlers: Set<(roomId: string, data: RoomEvent) => void> =
    new Set();
  private worldUpdateHandlers: Set<(data: WorldState) => void> = new Set();

  onAgentUpdate(
    handler: (agentId: number, roomId: number, data: AgentEventMessage) => void
  ) {
    this.agentUpdateHandlers.add(handler);
    return () => this.agentUpdateHandlers.delete(handler);
  }

  onRoomUpdate(handler: (roomId: string, data: RoomEvent) => void) {
    this.roomUpdateHandlers.add(handler);
    return () => this.roomUpdateHandlers.delete(handler);
  }

  onWorldUpdate(handler: (data: WorldState) => void) {
    this.worldUpdateHandlers.add(handler);
    return () => this.worldUpdateHandlers.delete(handler);
  }

  private emitAgentUpdate(
    agentId: number,
    roomId: number,
    data: AgentEventMessage
  ) {
    this.agentUpdateHandlers.forEach((handler) =>
      handler(agentId, roomId, data)
    );
  }

  private emitRoomUpdate(roomId: string, data: RoomEvent) {
    this.roomUpdateHandlers.forEach((handler) => handler(roomId, data));
  }

  private emitWorldUpdate(data: WorldState) {
    this.worldUpdateHandlers.forEach((handler) => handler(data));
  }

  get isRunning() {
    return this._isRunning;
  }

  constructor(world: World, config: Partial<RuntimeConfig> = {}) {
    super();
    this.world = world;

    // Merge config with defaults
    const fullConfig = { ...DEFAULT_CONFIG, ...config };
    this.updateInterval = fullConfig.updateInterval!;
    this.actions = fullConfig.actions!;

    // Initialize systems from factories
    this.systems = fullConfig.systems!.map((factory) => factory(this));

    logger.system("Runtime initialized with:");
    logger.system(`- ${this.systems.length} systems`);
    logger.system(`- ${Object.keys(this.actions).length} actions`);
    logger.system(`- ${fullConfig.components!.length} components`);

    // Set up observers
    this.componentSync = new ComponentSync(this.world);
    this.eventBus = new EventBus(this.world);

    // Set up component event handlers for specific room and agent channels
    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    // Handle all events for rooms
    this.eventBus.subscribe("room:*", (event: RoomEvent | AgentEvent) => {
      if ("roomId" in event) {
        const roomId = event.roomId;
        if (!roomId) {
          console.error("No roomId in event data:", event);
          return;
        }

        // Only emit pure room events (not agent events) as room updates
        if (!("category" in event)) {
          this.emitRoomUpdate(roomId, event);
        }
      }
    });

    // Handle agent-specific events
    this.eventBus.subscribe("agent:*", (event: AgentEvent | RoomEvent) => {
      if ("category" in event) {
        const agentId = event.agentId;
        if (!agentId) {
          console.error("No agentId in event data:", event);
          return;
        }

        // Get all rooms where agent is present
        const agentRooms = this.getAgentRooms(Number(agentId));

        if (agentRooms.length > 0) {
          // Send full event to direct agent subscribers
          const agentEvent: AgentUpdateMessage = {
            type: "AGENT_UPDATE",
            channel: {
              room: String(agentRooms[0]), // Primary room for agent updates
              agent: String(agentId),
            },
            data: event,
            timestamp: event.timestamp,
          };

          // Send to agent subscribers
          this.emitAgentUpdate(Number(agentId), agentRooms[0], agentEvent);

          // Categories that directly affect a specific room
          const roomSpecificCategories = ["speech", "action", "appearance"];

          // Categories that are processed globally
          const globalCategories = ["thought", "perception"];

          // Internal categories that stay private
          const privateCategories = ["experience", "state"];

          // For room-specific events, send only to the current room
          if (roomSpecificCategories.includes(event.category)) {
            const currentRoom = this.getAgentRoom(Number(agentId));
            if (currentRoom) {
              const roomEvent: RoomEvent = {
                type: event.type as EventType,
                roomId: String(currentRoom),
                content: event.content,
                timestamp: event.timestamp,
                agentId: event.agentId,
              };
              this.emitRoomUpdate(String(currentRoom), roomEvent);
            }
          }

          // For global categories like thoughts, send to all rooms where agent is present
          if (globalCategories.includes(event.category)) {
            agentRooms.forEach((roomId) => {
              const roomEvent: RoomEvent = {
                type: event.type as EventType,
                roomId: String(roomId),
                content: event.content,
                timestamp: event.timestamp,
                agentId: event.agentId,
              };
              this.emitRoomUpdate(String(roomId), roomEvent);
            });
          }
        }
      }
    });
  }

  // Helper method to get all rooms where an agent is present
  private getAgentRooms(agentId: number): number[] {
    return query(this.world, [Room]).filter((roomId) =>
      hasComponent(this.world, agentId, OccupiesRoom(roomId))
    );
  }

  // Methods for event subscription
  subscribeToRoom(roomId: number, handler: (event: ServerMessage) => void) {
    console.log("Subscribing to room:", roomId);
    const stringRoomId = Room.id[roomId] || String(roomId);
    if (!this.roomSubscriptions.has(stringRoomId)) {
      this.roomSubscriptions.set(stringRoomId, new Set());
    }
    this.roomSubscriptions.get(stringRoomId)?.add(handler);

    // Send initial room state
    const roomState = this.mapRoomToState(roomId);
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
    const agents = this.getAgentsInRoom(roomId);
    agents.forEach((agentId) => {
      const agentState = this.mapAgentToState(agentId);
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

  subscribeToAgent(agentId: number, handler: (event: ServerMessage) => void) {
    console.log("Subscribing to agent:", agentId);
    if (!this.agentSubscriptions.has(agentId)) {
      this.agentSubscriptions.set(agentId, new Set());
    }
    this.agentSubscriptions.get(agentId)?.add(handler);

    // Send initial agent state
    const agentState = this.mapAgentToState(agentId);
    const roomId = this.getAgentRoom(agentId);
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

  private getAgentsInRoom(roomId: number): number[] {
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

  cleanup() {
    this.eventBus.cleanup();
    this.componentSync.cleanup();
  }

  getWorld(): World {
    return this.world;
  }

  start() {
    if (this._isRunning) return;
    this._isRunning = true;

    // Emit initial state through component events
    const agents = query(this.world, [Agent]);
    const rooms = query(this.world, [Room]);

    rooms.forEach((roomId) => {
      const roomState = this.mapRoomToState(roomId);
      this.eventBus.broadcast(`room:${roomId}`, {
        type: "state",
        roomId: String(roomId),
        content: { room: roomState },
        timestamp: Date.now(),
      });
    });

    agents.forEach((eid) => {
      const agentState = this.mapAgentToState(eid);
      this.eventBus.broadcast(`agent:${Agent.id[eid]}`, {
        type: "state",
        agentId: String(eid),
        category: "state",
        content: { agent: agentState },
        timestamp: Date.now(),
      });
    });

    this.run();
  }

  stop() {
    this._isRunning = false;
    this.emit("stateChanged", { isRunning: false });
  }

  reset() {
    this.cleanup();
    // Remove all entities
    const allEntities = query(this.world, []);
    for (const eid of allEntities) {
      removeEntity(this.world, eid);
    }
    this.emit("stateChanged", { isRunning: false });
  }

  private async run() {
    while (this.isRunning) {
      const startTime = Date.now();

      try {
        // Run all systems
        for (const system of this.systems) {
          this.world = await system(this.world);
        }

        // Update component event bus - this will trigger component change events
        this.eventBus.update();

        // Calculate time spent and adjust delay
        const elapsed = Date.now() - startTime;
        const delay = Math.max(0, this.updateInterval - elapsed);

        await new Promise((resolve) => setTimeout(resolve, delay));

        if (elapsed > this.updateInterval) {
          logger.system(
            `Warning: Update took ${elapsed}ms (${Math.round(
              (elapsed / this.updateInterval) * 100
            )}% of interval)`
          );
        }
      } catch (error) {
        logger.error(`Runtime error: ${error}`);
        this.emit("error", error);
        this.stop();
      }
    }
  }

  // Room Management
  createRoom(roomData: Partial<RoomData>): number {
    const roomEntity = addEntity(this.world);

    setComponent(this.world, roomEntity, Room, {
      id: roomData.id || String(roomEntity),
      name: roomData.name || "New Room",
      description: roomData.description || "",
      type: roomData.type || "physical",
    });

    return roomEntity;
  }

  moveAgentToRoom(agentId: number, roomEid: number): void {
    // Verify room exists
    const rooms = query(this.world, [Room]);
    if (!rooms.includes(roomEid)) {
      logger.error(`Room ${roomEid} not found`);
      return;
    }

    // Find current room relationship and remove it
    const currentRooms = query(this.world, [Room]).filter((eid) =>
      hasComponent(this.world, agentId, OccupiesRoom(eid))
    );

    for (const currentRoom of currentRooms) {
      removeComponent(this.world, agentId, OccupiesRoom(currentRoom));
      logger.system(
        `Removed agent ${agentId} from room ${Room.name[currentRoom]}`
      );
    }

    // Add new room relationship
    addComponent(this.world, agentId, OccupiesRoom(roomEid));
    logger.system(`Added agent ${agentId} to room ${Room.name[roomEid]}`);

    // Emit updated world state after moving agent
    this.emitWorldState();
  }

  // Action Management
  getAvailableTools() {
    return Object.values(this.actions).map((a) => a.action);
  }

  async executeAction(tool: string, eid: number, parameters: any) {
    const action = this.actions[tool];
    if (!action) {
      throw new Error(`Unknown action: ${tool}`);
    }
    await action.execute(this.world, eid, parameters, this.eventBus);
  }

  // State Management
  private mapAgentToState(eid: number): AgentState {
    return {
      id: String(eid),
      name: Agent.name[eid],
      role: Agent.role[eid],
      systemPrompt: Agent.systemPrompt[eid],
      active: Agent.active[eid] === 1,
      platform: Agent.platform[eid],
      appearance: Agent.appearance[eid],
      attention: Agent.attention[eid],
      roomId: this.getAgentRoom(eid) ? Room.id[this.getAgentRoom(eid)!] : null,
      facialExpression: Appearance.facialExpression[eid],
      bodyLanguage: Appearance.bodyLanguage[eid],
      currentAction: Appearance.currentAction[eid],
      socialCues: Appearance.socialCues[eid],
      lastUpdate: Appearance.lastUpdate[eid] || Date.now(),
    };
  }

  private mapRoomToState(roomId: number): InternalRoomState {
    return {
      id: Room.id[roomId] || String(roomId),
      eid: roomId,
      name: Room.name[roomId],
      description: Room.description[roomId],
      type: Room.type[roomId],
      occupants: this.getRoomOccupants(roomId).map((eid) => ({
        id: String(eid),
        name: Agent.name[eid],
        attention: Agent.attention[eid],
      })),
      stimuli: this.getRoomStimuli(roomId).map((eid) => ({
        type: Stimulus.type[eid],
        content: Stimulus.content[eid],
        source: String(Stimulus.sourceEntity[eid]),
        timestamp: Stimulus.timestamp[eid],
      })),
      lastUpdate: Date.now(),
    };
  }

  getWorldState(): WorldState {
    const agents = Object.keys(Agent.name)
      .map(Number)
      .filter((eid) => Agent.name[eid] && Agent.active[eid] === 1)
      .map((eid) => this.mapAgentToState(eid));

    const rooms = query(this.world, [Room]).map((roomId) =>
      this.mapRoomToState(roomId)
    );

    return {
      agents,
      rooms,
      relationships: this.getRelationships(),
      isRunning: this._isRunning,
      timestamp: Date.now(),
    };
  }

  private emitWorldState() {
    const worldState = this.getWorldState();
    this.emitWorldUpdate(worldState);
  }

  getRooms(): InternalRoomState[] {
    return query(this.world, [Room]).map((roomId) =>
      this.mapRoomToState(roomId)
    );
  }

  private getRoomStimuli(roomId: number): number[] {
    const roomStringId = Room.id[roomId] || String(roomId);
    return Object.keys(Stimulus.roomId)
      .map(Number)
      .filter((eid) => Stimulus.roomId[eid] === roomStringId);
  }

  // Helper methods
  getRoomOccupants(roomId: number): number[] {
    return this.eventBus.getRoomOccupants(roomId);
  }

  getAgentByName(name: string): { eid: number } | null {
    const agents = query(this.world, [Agent]);
    for (const eid of agents) {
      if (Agent.name[eid] === name) {
        return { eid };
      }
    }
    return null;
  }

  getRelationships(): NetworkLink[] {
    const relationships: NetworkLink[] = [];
    const rooms = this.getRooms();

    // Add room occupancy relationships
    for (const room of rooms) {
      const occupants = query(this.world, [OccupiesRoom(room.eid)]);
      for (const agentId of occupants) {
        // Add presence relationship (agent -> room)
        relationships.push({
          source: String(agentId),
          target: room.id,
          type: "presence",
          value: Agent.attention[agentId] || 1,
        });

        // Add attention relationships between agents in the same room
        for (const otherAgentId of occupants) {
          if (agentId !== otherAgentId) {
            relationships.push({
              source: String(agentId),
              target: String(otherAgentId),
              type: "attention",
              value: Agent.attention[agentId] || 0.5,
            });
          }
        }
      }
    }

    // Add interaction relationships based on recent communications
    // This is a placeholder - you might want to track actual interactions
    const agents = query(this.world, [Agent]);
    for (const agentId of agents) {
      for (const otherAgentId of agents) {
        if (agentId !== otherAgentId && Math.random() > 0.8) {
          // Random sampling for demo
          relationships.push({
            source: String(agentId),
            target: String(otherAgentId),
            type: "interaction",
            value: 0.5,
          });
        }
      }
    }

    return relationships;
  }
}
