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
import { WorldState, Room as RoomData } from "../types";
import { logger } from "../utils/logger";
import {
  Agent,
  Memory,
  Perception,
  Room,
  Stimulus,
  OccupiesRoom,
} from "../components/agent/Agent";
import { ComponentEventBus } from "./ComponentEventBus";
import { ComponentSync } from "./ComponentSync";
import EventEmitter from "events";

// Validate required environment variables
if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  throw new Error(
    "GOOGLE_GENERATIVE_AI_API_KEY is required but not set in environment variables"
  );
}

export type ActionModule = {
  schema: any;
  action: {
    name: string;
    description: string;
    parameters: string[];
    schema: any;
  };
  execute: (world: World, eid: number, parameters: any) => Promise<void>;
};

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
  private world: World;
  private systems: ((world: World) => Promise<World>)[];
  private _isRunning = false;
  private updateInterval: number;
  private observers: (() => void)[] = [];
  public actions: Record<string, ActionModule>;
  private eventBus: ComponentEventBus;
  private componentSync: ComponentSync;

  // Subscription tracking
  private roomSubscriptions = new Map<string, Set<(data: any) => void>>();
  private agentSubscriptions = new Map<number, Set<(data: any) => void>>();

  // Event handlers
  private agentUpdateHandlers: Set<
    (agentId: number, roomId: number, data: any) => void
  > = new Set();
  private roomUpdateHandlers: Set<(roomId: number, data: any) => void> =
    new Set();
  private worldUpdateHandlers: Set<(data: any) => void> = new Set();

  onAgentUpdate(handler: (agentId: number, roomId: number, data: any) => void) {
    this.agentUpdateHandlers.add(handler);
    return () => this.agentUpdateHandlers.delete(handler);
  }

  onRoomUpdate(handler: (roomId: number, data: any) => void) {
    this.roomUpdateHandlers.add(handler);
    return () => this.roomUpdateHandlers.delete(handler);
  }

  onWorldUpdate(handler: (data: any) => void) {
    this.worldUpdateHandlers.add(handler);
    return () => this.worldUpdateHandlers.delete(handler);
  }

  private emitAgentUpdate(agentId: number, roomId: number, data: any) {
    this.agentUpdateHandlers.forEach((handler) =>
      handler(agentId, roomId, data)
    );
  }

  private emitRoomUpdate(roomId: number, data: any) {
    this.roomUpdateHandlers.forEach((handler) => handler(roomId, data));
  }

  private emitWorldUpdate(data: any) {
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
    this.eventBus = new ComponentEventBus(this.world);

    // Set up component event handlers for specific room and agent channels
    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    // Handle room-specific events
    this.eventBus.subscribe("room:*", (data: any, channel?: string) => {
      if (!channel) return;
      const roomId = channel.split(":")[1];
      this.emitRoomUpdate(Number(roomId), data);
    });

    // Handle agent-specific events
    this.eventBus.subscribe("agent:*", (data: any, channel?: string) => {
      if (!channel) return;
      const agentId = Number(channel.split(":")[1]);
      const roomId = this.getAgentRoom(agentId);
      if (roomId) {
        this.emitAgentUpdate(agentId, roomId, data);
      }
    });
  }

  // Methods for event subscription
  subscribeToRoom(roomId: number, handler: (event: any) => void) {
    console.log("Subscribing to room:", roomId);
    const stringRoomId = Room.id[roomId] || String(roomId);
    if (!this.roomSubscriptions.has(stringRoomId)) {
      this.roomSubscriptions.set(stringRoomId, new Set());
    }
    this.roomSubscriptions.get(stringRoomId)?.add(handler);
    return this.eventBus.subscribe(`room:${stringRoomId}`, handler);
  }

  subscribeToAgent(agentId: number, handler: (event: any) => void) {
    console.log("Subscribing to agent:", agentId);
    if (!this.agentSubscriptions.has(agentId)) {
      this.agentSubscriptions.set(agentId, new Set());
    }
    this.agentSubscriptions.get(agentId)?.add(handler);
    return this.eventBus.subscribe(
      `agent:${Agent.id[agentId] || String(agentId)}`,
      handler
    );
  }

  private getAgentRoom(agentId: number): number | null {
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
      this.eventBus.broadcast(`room:${roomId}`, {
        type: "state",
        data: {
          id: roomId,
          name: Room.name[roomId],
          description: Room.description[roomId],
          type: Room.type[roomId],
        },
      });
    });

    agents.forEach((eid) => {
      this.eventBus.broadcast(`agent:${Agent.id[eid]}`, {
        type: "state",
        data: {
          id: eid,
          name: Agent.name[eid],
          role: Agent.role[eid],
          systemPrompt: Agent.systemPrompt[eid],
          active: Agent.active[eid],
          platform: Agent.platform[eid],
          appearance: Agent.appearance[eid],
          attention: Agent.attention[eid],
        },
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
    await action.execute(this.world, eid, parameters);
  }

  // State Management
  getWorldState(): WorldState {
    const agents = query(this.world, [Agent]).map((eid) => ({
      id: `${eid}`,
      eid,
      name: Agent.name[eid],
      role: Agent.role[eid],
      active: Agent.active[eid],
      attention: Agent.attention[eid],
      room: this.getAgentRoom(eid),
    }));

    const rooms = query(this.world, [Room]).map((eid) => ({
      id: Room.id[eid] || String(eid),
      eid,
      name: Room.name[eid],
      type: Room.type[eid],
      description: Room.description[eid],
      occupants: query(this.world, [OccupiesRoom(eid)]).map(
        (agentEid) => agentEid
      ),
    }));

    const relationships = [];
    // Add room occupancy relationships
    for (const room of rooms) {
      for (const agentId of room.occupants) {
        relationships.push({
          source: String(agentId),
          target: room.id,
          type: "presence",
          value: 1,
        });
      }
    }

    return {
      agents,
      rooms,
      relationships,
      isRunning: this._isRunning,
      timestamp: Date.now(),
    };
  }

  private emitWorldState() {
    const worldState = this.getWorldState();
    this.emitWorldUpdate(worldState);
  }

  getAgents() {
    return Object.keys(Agent.name)
      .map(Number)
      .filter(
        (eid) =>
          // Only include agents that have both a name and are active
          Agent.name[eid] && Agent.active[eid] === 1
      )
      .map((eid) => {
        const roomEid = this.getAgentRoom(eid);
        return {
          eid, // Include the entity ID
          id: eid,
          name: Agent.name[eid],
          role: Agent.role[eid],
          room: roomEid
            ? {
                eid: roomEid,
                name: Room.name[roomEid],
                type: Room.type[roomEid],
              }
            : undefined,
          active: Agent.active[eid],
          attention: Agent.attention[eid],
        };
      });
  }

  getRooms(): RoomData[] {
    return query(this.world, [Room]).map((eid) => ({
      id: Room.id[eid] || String(eid),
      eid,
      name: Room.name[eid],
      description: Room.description[eid],
      type: Room.type[eid],
    }));
  }

  private getRoomStimuli(roomId: number): number[] {
    const roomStringId = Room.id[roomId] || String(roomId);
    return Object.keys(Stimulus.roomId)
      .map(Number)
      .filter((eid) => Stimulus.roomId[eid] === roomStringId);
  }

  private getRoomState(roomEntity: number) {
    return {
      room: {
        eid: roomEntity,
        name: Room.name[roomEntity],
        description: Room.description[roomEntity],
        type: Room.type[roomEntity],
        occupants: this.getRoomOccupants(roomEntity),
        stimuli: this.getRoomStimuli(roomEntity),
      },
      timestamp: Date.now(),
    };
  }

  // Helper methods
  getRoomOccupants(roomId: number): number[] {
    return this.eventBus.getRoomOccupants(roomId);
  }
}
