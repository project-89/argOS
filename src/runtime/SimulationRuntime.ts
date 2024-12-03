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
import { EventEmitter } from "events";
import { Room, Agent, Memory, Stimulus } from "../components/agent/Agent";
import { WorldState, Room as RoomType } from "../types";
import { logger } from "../utils/logger";

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
  components: [Room, Agent, Memory, Stimulus],
};

export class SimulationRuntime extends EventEmitter {
  private world: World;
  private systems: ((world: World) => Promise<World>)[];
  private _isRunning = false;
  private updateInterval: number;
  private observers: (() => void)[] = [];
  public actions: Record<string, ActionModule>;

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

    // Observe stimulus creation
    this.observers.push(
      observe(this.world, onAdd(Stimulus), (eid) => {
        const roomId = Stimulus.roomId[eid];
        const type = Stimulus.type[eid];
        const sourceEntity = Stimulus.sourceEntity[eid];
        const content = JSON.parse(Stimulus.content[eid]);
        const timestamp = Stimulus.timestamp[eid];

        // Emit room-specific stimulus event
        this.emit("roomStimulus", {
          roomId,
          stimulus: {
            id: eid,
            type,
            sourceEntity,
            content,
            timestamp,
            metadata: {
              category: this.getStimulusCategory(type),
              sourceName: sourceEntity ? Agent.name[sourceEntity] : "System",
              decay: Stimulus.decay[eid],
            },
          },
        });

        // Also emit general stimulus event
        this.emit("stimulus", {
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
        });
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
}
