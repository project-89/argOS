import {
  World,
  addEntity,
  addComponent,
  removeEntity,
  observe,
  onAdd,
  onRemove,
  onSet,
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
import { getAgentRoom } from "../utils/queries";

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

// Remove EventEmitter import and create minimal event system
class EventEmitter {
  private events: { [key: string]: Function[] } = {};

  on(event: string, callback: Function) {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push(callback);
  }

  emit(event: string, ...args: any[]) {
    if (this.events[event]) {
      this.events[event].forEach((callback) => callback(...args));
    }
  }
}

export class SimulationRuntime extends EventEmitter {
  private world: World;
  private systems: ((world: World) => Promise<World>)[];
  private _isRunning = false;
  private updateInterval: number;
  private observers: (() => void)[] = [];
  public actions: Record<string, ActionModule>;

  // Subscription tracking
  private roomSubscriptions = new Map<string, Set<(data: any) => void>>();
  private agentSubscriptions = new Map<number, Set<(data: any) => void>>();

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
    this.setupObservers();
  }

  private setupObservers() {
    // Clean up any existing observers first
    this.cleanup();

    // Observe room creation and handle setting values
    this.observers.push(
      observe(this.world, onSet(Room), (eid, params) => {
        // Handle partial updates - only set defined values
        if (params.id !== undefined) Room.id[eid] = params.id;
        if (params.name !== undefined) Room.name[eid] = params.name;
        if (params.description !== undefined)
          Room.description[eid] = params.description;
        if (params.type !== undefined) Room.type[eid] = params.type;

        logger.system(`Room updated: ${Room.name[eid]}`);
        this.emit("roomCreated", {
          id: Room.id[eid],
          name: Room.name[eid],
        });
      })
    );

    // Observe room deletion
    this.observers.push(
      observe(this.world, onRemove(Room), (eid) => {
        logger.system(`Room removed: ${Room.name[eid]}`);
        this.emit("roomRemoved", {
          id: Room.id[eid],
        });
      })
    );

    // Observe agent creation/updates
    this.observers.push(
      observe(this.world, onSet(Agent), (eid, params) => {
        // Handle partial updates - only set defined values
        if (params.name !== undefined) Agent.name[eid] = params.name;
        if (params.role !== undefined) Agent.role[eid] = params.role;
        if (params.systemPrompt !== undefined)
          Agent.systemPrompt[eid] = params.systemPrompt;
        if (params.active !== undefined) Agent.active[eid] = params.active;
        if (params.platform !== undefined)
          Agent.platform[eid] = params.platform;
        if (params.appearance !== undefined)
          Agent.appearance[eid] = params.appearance;
        if (params.attention !== undefined)
          Agent.attention[eid] = params.attention;

        logger.system(`Agent updated: ${Agent.name[eid]}`);
        this.emit("agentCreated", {
          id: eid,
          name: Agent.name[eid],
        });
      })
    );

    // Observe agent deletion
    this.observers.push(
      observe(this.world, onRemove(Agent), (eid) => {
        logger.system(`Agent removed: ${Agent.name[eid]}`);
        this.emit("agentRemoved", {
          id: eid,
          name: Agent.name[eid],
        });
      })
    );

    // Observe room occupancy changes
    this.observers.push(
      observe(this.world, onAdd(OccupiesRoom), (eid) => {
        const roomId = this.getAgentRoom(eid);
        if (roomId) {
          this.emit("roomOccupancyChanged", {
            roomId: Room.id[roomId],
            occupants: this.getRoomOccupants(roomId),
          });
        }
      })
    );

    // Observe Memory changes for thoughts and experiences
    this.observers.push(
      observe(this.world, onSet(Memory), (eid, params) => {
        const agentName = Agent.name[eid];

        // Emit thought changes
        if (params.lastThought) {
          this.emit("LOG", {
            type: "AGENT_STATE",
            category: "thought",
            data: {
              thought: params.lastThought,
              agentId: eid,
              agentName,
              actionType: "THOUGHT",
            },
            timestamp: Date.now(),
          });
        }

        // Emit new experiences
        if (params.experiences) {
          const newExperiences = params.experiences.slice(-1)[0];
          if (newExperiences) {
            this.emit("LOG", {
              type: "AGENT_STATE",
              category: "experience",
              data: {
                ...newExperiences,
                agentId: eid,
                agentName,
                actionType: newExperiences.type.toUpperCase(),
              },
              timestamp: newExperiences.timestamp,
            });
          }
        }
      })
    );

    // Observe stimulus creation
    this.observers.push(
      observe(this.world, onAdd(Stimulus), (eid) => {
        const roomId = Stimulus.roomId[eid];
        const type = Stimulus.type[eid];
        const sourceEntity = Stimulus.sourceEntity[eid];
        const content = Stimulus.content[eid]
          ? JSON.parse(Stimulus.content[eid])
          : {};
        const timestamp = Stimulus.timestamp[eid];

        // Emit room-specific stimulus event
        this.emit("LOG", {
          type: "ROOM_STIMULUS",
          data: {
            id: eid,
            type,
            sourceEntity,
            content,
            timestamp,
            roomId,
            metadata: {
              category: this.getStimulusCategory(type),
              sourceName: sourceEntity ? Agent.name[sourceEntity] : "System",
              decay: Stimulus.decay[eid],
            },
          },
          timestamp: Date.now(),
        });

        // Also notify room subscribers
        const subscribers = this.roomSubscriptions.get(roomId);
        if (subscribers) {
          const data = {
            type: "ROOM_STIMULUS",
            data: {
              id: eid,
              type,
              sourceEntity,
              content,
              timestamp,
              roomId,
            },
            timestamp: Date.now(),
          };
          subscribers.forEach((callback) => callback(data));
        }
      })
    );

    // Observe Perception changes
    this.observers.push(
      observe(this.world, onSet(Perception), (eid, params) => {
        if (params.currentStimuli) {
          const agentName = Agent.name[eid];
          const roomEid = this.getAgentRoom(eid);

          if (!roomEid) return;

          // Emit each new stimulus as a perception event
          params.currentStimuli.forEach((stimulus: any) => {
            this.emit("LOG", {
              type: "AGENT_STATE",
              category: "perception",
              data: {
                stimulus,
                agentId: eid,
                agentName,
                roomId: Room.id[roomEid],
                actionType: "PERCEPTION",
              },
              timestamp: Date.now(),
            });
          });
        }
      })
    );
  }

  private getStimulusCategory(type: string): string {
    switch (type) {
      case "VISUAL":
        return "Observation";
      case "AUDITORY":
        return "Speech";
      case "COGNITIVE":
        return "Thought";
      case "TECHNICAL":
        return "Technical";
      case "ENVIRONMENTAL":
        return "Environment";
      default:
        return "Other";
    }
  }

  cleanup() {
    // Cleanup observers
    this.observers.forEach((unsubscribe) => unsubscribe());
    this.observers = [];
  }

  getWorld(): World {
    return this.world;
  }

  async start() {
    this._isRunning = true;
    this.emit("stateChanged", { isRunning: true });
    this.emitWorldState();
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
    this.setupObservers();
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

        // Emit world state updates
        this.emitWorldState();

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
      id: roomData.id || `room-${roomEntity}`,
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
    const agents = Object.keys(Agent.name)
      .map(Number)
      .filter((eid) => Agent.name[eid] && Agent.active[eid] === 1)
      .map((eid) => ({
        eid,
        id: eid,
        name: Agent.name[eid],
        role: Agent.role[eid],
        active: Agent.active[eid],
        attention: Agent.attention[eid],
      }));

    const rooms = query(this.world, [Room]).map((eid) => ({
      id: Room.id[eid],
      eid,
      name: Room.name[eid],
      description: Room.description[eid],
      type: Room.type[eid],
    }));

    // Get all room occupancy relationships
    const relationships = agents
      .map((agent) => {
        const roomEid = this.getAgentRoom(agent.eid);
        if (!roomEid) return null;
        return {
          source: agent.eid.toString(),
          target: roomEid.toString(),
          type: "occupies",
          value: agent.attention || 1,
        };
      })
      .filter((rel): rel is NonNullable<typeof rel> => rel !== null);

    return {
      agents,
      rooms,
      relationships,
      timestamp: Date.now(),
    };
  }

  emitWorldState() {
    const state = this.getWorldState();
    this.emit("worldState", state);
  }

  private getAgents() {
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
                id: Room.id[roomEid],
                name: Room.name[roomEid],
                type: Room.type[roomEid],
              }
            : undefined,
          active: Agent.active[eid],
          attention: Agent.attention[eid],
        };
      });
  }

  private getRooms(): RoomData[] {
    return query(this.world, [Room]).map((eid) => ({
      id: Room.id[eid],
      eid,
      name: Room.name[eid],
      description: Room.description[eid],
      type: Room.type[eid],
    }));
  }

  private getAgentRoom(agentId: number): number | null {
    const rooms = query(this.world, [Room]).filter((roomEid) =>
      hasComponent(this.world, agentId, OccupiesRoom(roomEid))
    );
    return rooms[0] || null;
  }

  private getRoomStimuli(roomId: number): number[] {
    return Object.keys(Stimulus.roomId)
      .map(Number)
      .filter((eid) => Stimulus.roomId[eid] === Room.id[roomId]);
  }

  // Room subscriptions
  subscribeToRoom(roomEntity: number, callback: (data: any) => void) {
    // Initial state
    callback({
      room: {
        id: Room.id[roomEntity],
        name: Room.name[roomEntity],
        description: Room.description[roomEntity],
        type: Room.type[roomEntity],
        occupants: this.getRoomOccupants(roomEntity),
        stimuli: this.getRoomStimuli(roomEntity),
      },
      timestamp: Date.now(),
    });

    // Add to room subscriptions
    if (!this.roomSubscriptions.has(Room.id[roomEntity])) {
      this.roomSubscriptions.set(Room.id[roomEntity], new Set());
    }
    this.roomSubscriptions.get(Room.id[roomEntity])!.add(callback);
  }

  // Agent subscriptions
  subscribeToAgent(agentId: number, callback: (data: any) => void) {
    if (!this.agentSubscriptions.has(agentId)) {
      this.agentSubscriptions.set(agentId, new Set());
    }
    this.agentSubscriptions.get(agentId)?.add(callback);

    // Immediately send current agent state
    callback({
      type: "AGENT_STATE",
      data: {
        id: agentId,
        name: Agent.name[agentId],
        thoughts: Memory.thoughts[agentId],
        lastThought: Memory.lastThought[agentId],
        experiences: Memory.experiences[agentId],
        currentStimuli: Perception.currentStimuli[agentId],
      },
      timestamp: Date.now(),
    });

    return () => {
      this.agentSubscriptions.get(agentId)?.delete(callback);
    };
  }

  // Helper method to get room occupants
  getRoomOccupants(roomEid: number): number[] {
    return query(this.world, [Agent]).filter((agentEid) =>
      hasComponent(this.world, agentEid, OccupiesRoom(roomEid))
    );
  }

  private getRoomState(roomEntity: number) {
    return {
      room: {
        id: Room.id[roomEntity],
        name: Room.name[roomEntity],
        description: Room.description[roomEntity],
        type: Room.type[roomEntity],
        occupants: this.getRoomOccupants(roomEntity),
        stimuli: this.getRoomStimuli(roomEntity),
      },
      timestamp: Date.now(),
    };
  }
}
