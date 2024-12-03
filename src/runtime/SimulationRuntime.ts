import {
  World,
  createWorld,
  addEntity,
  addComponent,
  removeEntity,
  observe,
  onAdd,
  onRemove,
  onSet,
  query,
} from "bitecs";
import { WorldState, Room as RoomType } from "../types";
import { logger } from "../utils/logger";
import { StimulusType } from "../utils/stimulus-utils";
import {
  Agent,
  Memory,
  Perception,
  Room,
  Stimulus,
} from "../components/agent/Agent";

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

    // Observe room creation
    this.observers.push(
      observe(this.world, onAdd(Room), (eid) => {
        logger.system(`Room created: ${Room.name[eid]}`);
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

    // Observe agent creation
    this.observers.push(
      observe(this.world, onAdd(Agent), (eid) => {
        logger.system(`Agent created: ${Agent.name[eid]}`);
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
      observe(this.world, onSet(Room), (eid, params) => {
        if (params.occupants) {
          logger.system(`Room ${Room.name[eid]} occupancy changed`);
          this.emit("roomOccupancyChanged", {
            roomId: Room.id[eid],
            occupants: Room.occupants[eid],
          });
        }
      })
    );

    // Observe Memory changes for thoughts and experiences
    this.observers.push(
      observe(this.world, onSet(Memory), (eid, params) => {
        const agentName = Agent.name[eid];

        console.log(
          "################Memory changed for agent",
          agentName,
          params
        );

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
          const roomId = this.getAgentRoom(eid)?.id;

          if (!roomId) return;

          // Emit each new stimulus as a perception event
          params.currentStimuli.forEach((stimulus: any) => {
            this.emit("LOG", {
              type: "AGENT_STATE",
              category: "perception",
              data: {
                stimulus,
                agentId: eid,
                agentName,
                roomId,
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
  createRoom(roomData: Partial<RoomType>): number {
    const roomEntity = addEntity(this.world);
    addComponent(this.world, roomEntity, Room);

    Room.id[roomEntity] = roomData.id || `room-${roomEntity}`;
    Room.name[roomEntity] = roomData.name || "New Room";
    Room.description[roomEntity] = roomData.description || "";
    Room.type[roomEntity] = roomData.type || "physical";
    Room.occupants[roomEntity] = [];

    logger.system(
      `Created room: ${Room.name[roomEntity]} (${Room.id[roomEntity]})`
    );
    this.emit("roomCreated", { roomId: Room.id[roomEntity] });
    return roomEntity;
  }

  moveAgentToRoom(agentId: number, roomId: string): void {
    const roomEntity = Object.keys(Room.id)
      .map(Number)
      .find((eid) => Room.id[eid] === roomId);

    if (!roomEntity) {
      logger.error(`Room ${roomId} not found`);
      return;
    }

    // Initialize occupants array if it doesn't exist
    if (!Room.occupants[roomEntity]) {
      Room.occupants[roomEntity] = [];
    }

    // Update room occupants
    const currentRoom = Object.keys(Room.occupants)
      .map(Number)
      .find((eid) => Room.occupants[eid]?.includes(agentId));

    if (currentRoom) {
      Room.occupants[currentRoom] = Room.occupants[currentRoom].filter(
        (id) => id !== agentId
      );
      logger.system(
        `Removed agent ${agentId} from room ${Room.name[currentRoom]}`
      );
    }

    Room.occupants[roomEntity].push(agentId);
    logger.system(`Added agent ${agentId} to room ${Room.name[roomEntity]}`);
    this.emit("agentMoved", { agentId, roomId });

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
    return {
      agents: this.getAgents(),
      rooms: this.getRooms(),
      timestamp: Date.now(),
    };
  }

  emitWorldState() {
    this.emit("worldState", {
      agents: this.getAgents(),
      rooms: this.getRooms(),
      timestamp: Date.now(),
    });
  }

  private getAgents() {
    return Object.keys(Agent.name)
      .map(Number)
      .filter((eid) => Agent.active[eid])
      .map((eid) => ({
        id: eid,
        name: Agent.name[eid],
        role: Agent.role[eid],
        room: this.getAgentRoom(eid),
        active: Agent.active[eid],
        attention: Agent.attention[eid],
      }));
  }

  private getRooms(): RoomType[] {
    return Object.keys(Room.id)
      .map(Number)
      .map((eid) => ({
        id: Room.id[eid],
        name: Room.name[eid],
        description: Room.description[eid],
        type: Room.type[eid],
        occupants: Room.occupants[eid],
        stimuli: this.getRoomStimuli(eid),
      }));
  }

  private getAgentRoom(agentId: number) {
    const roomEntity = Object.keys(Room.occupants)
      .map(Number)
      .find((eid) => Room.occupants[eid].includes(agentId));

    if (!roomEntity) return null;

    return {
      id: Room.id[roomEntity],
      name: Room.name[roomEntity],
    };
  }

  private getRoomStimuli(roomId: number): number[] {
    return Object.keys(Stimulus.roomId)
      .map(Number)
      .filter((eid) => Stimulus.roomId[eid] === Room.id[roomId]);
  }

  // Room subscriptions
  subscribeToRoom(roomId: string, callback: (data: any) => void) {
    if (!this.roomSubscriptions.has(roomId)) {
      this.roomSubscriptions.set(roomId, new Set());
    }
    this.roomSubscriptions.get(roomId)?.add(callback);

    // Immediately send current room state
    const roomEntity = this.findRoomByStringId(roomId);
    if (roomEntity) {
      callback({
        type: "ROOM_STATE",
        data: {
          id: Room.id[roomEntity],
          name: Room.name[roomEntity],
          description: Room.description[roomEntity],
          occupants: Room.occupants[roomEntity],
          stimuli: this.getRoomStimuli(roomEntity),
        },
        timestamp: Date.now(),
      });
    }

    return () => {
      this.roomSubscriptions.get(roomId)?.delete(callback);
    };
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

  // Helper to find room by string ID
  private findRoomByStringId(roomId: string): number | null {
    return (
      Object.keys(Room.id)
        .map(Number)
        .find((eid) => Room.id[eid] === roomId) ?? null
    );
  }
}
