import "dotenv/config";
import {
  World,
  addEntity,
  removeEntity,
  query,
  hasComponent,
  removeComponent,
} from "bitecs";
import {
  WorldState,
  AgentState,
  RoomState,
  NetworkLink,
  ActionModule,
  RoomEvent,
  AgentEvent,
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
import { IStateManager } from "./managers/IStateManager";
import { StateManager } from "./managers/StateManager";
import { IRoomManager } from "./managers/IRoomManager";
import { RoomManager } from "./managers/RoomManager";
import { IEventManager } from "./managers/IEventManager";
import { EventManager } from "./managers/EventManager";

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
  private stateManager: IStateManager;
  private roomManager: IRoomManager;
  private eventManager: IEventManager;

  // Add interaction tracking
  private recentInteractions = new Map<string, string>(); // key: "agent1-agent2", value: timestamp
  private readonly INTERACTION_TIMEOUT = 5000; // 5 seconds

  constructor(world: World, config: Partial<RuntimeConfig> = {}) {
    super();
    this.world = world;

    // Merge config with defaults
    const fullConfig = { ...DEFAULT_CONFIG, ...config };
    this.updateInterval = fullConfig.updateInterval!;
    this.actions = fullConfig.actions!;

    // Initialize systems from factories
    this.systems = fullConfig.systems!.map((factory) => factory(this));

    // Initialize event bus and component sync
    this.eventBus = new EventBus(this.world);
    this.componentSync = new ComponentSync(this.world);

    // Initialize managers
    this.stateManager = new StateManager(this.world, this);
    this.roomManager = new RoomManager(this.world, this);
    this.eventManager = new EventManager(this.world, this, this.eventBus);

    logger.system("Runtime initialized with:");
    logger.system(`- ${this.systems.length} systems`);
    logger.system(`- ${Object.keys(this.actions).length} actions`);
    logger.system(`- ${fullConfig.components!.length} components`);

    // Set up world state change handler
    this.componentSync.onWorldStateChange = () => {
      const worldState = this.stateManager.getWorldState();
      this.eventManager.emitWorldUpdate(worldState);
    };
  }

  // Getters for managers
  getStateManager(): IStateManager {
    return this.stateManager;
  }

  getRoomManager(): IRoomManager {
    return this.roomManager;
  }

  getEventManager(): IEventManager {
    return this.eventManager;
  }

  // Runtime control methods
  start() {
    if (this._isRunning) return;
    this._isRunning = true;
    this.run();
  }

  stop() {
    this._isRunning = false;
    this.emit("stateChanged", { isRunning: false });
  }

  reset() {
    this.cleanup();
    const allEntities = query(this.world, []);
    for (const eid of allEntities) {
      removeEntity(this.world, eid);
    }
    this.emit("stateChanged", { isRunning: false });
  }

  cleanup() {
    this.eventBus.cleanup();
    this.componentSync.cleanup();
    this.eventManager.cleanup();
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

  // Interaction tracking
  hasRecentInteraction(agent1: string, agent2: string): boolean {
    const key = [agent1, agent2].sort().join("-");
    const lastInteraction = this.recentInteractions.get(key);
    return lastInteraction
      ? Date.now() - Number(lastInteraction) < this.INTERACTION_TIMEOUT
      : false;
  }

  private trackInteraction(sourceId: string, targetId: string) {
    const key = [sourceId, targetId].sort().join("-");
    this.recentInteractions.set(key, Date.now().toString());
  }

  // Private helper methods
  private async run() {
    while (this.isRunning) {
      const startTime = Date.now();

      try {
        // Run all systems
        for (const system of this.systems) {
          this.world = await system(this.world);
        }

        // Update component event bus
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

  get isRunning(): boolean {
    return this._isRunning;
  }
}
