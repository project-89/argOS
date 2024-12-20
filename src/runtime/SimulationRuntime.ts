import "dotenv/config";
import { World, removeEntity, query } from "bitecs";
import { ActionModule } from "../types";
import { logger } from "../utils/logger";
import { ALL_COMPONENTS } from "../components";
import { EventBus } from "./EventBus";
import { ComponentSync } from "./ComponentSync";
import EventEmitter from "events";
import { IStateManager } from "./managers/IStateManager";
import { StateManager } from "./managers/StateManager";
import { IRoomManager } from "./managers/IRoomManager";
import { RoomManager } from "./managers/RoomManager";
import { IEventManager } from "./managers/IEventManager";
import { EventManager } from "./managers/EventManager";
import { IActionManager } from "./managers/IActionManager";
import { ActionManager } from "./managers/ActionManager";
import { RoomSystem } from "../systems/RoomSystem";
import { ThinkingSystem } from "../systems/ThinkingSystem";
import { ActionSystem } from "../systems/ActionSystem";
import { CleanupSystem } from "../systems/CleanupSystem";
import { PerceptionSystem } from "../systems/PerceptionSystem";
import { ExperienceSystem } from "../systems/ExperienceSystem";
import { PromptManager } from "./managers/promptManager";
import { perceptionPrompt } from "../prompts/perception";
import { GoalPlanningSystem } from "../systems/GoalPlanningSystem";
import { PlanningSystem } from "../systems/PlanningSystem";

// Validate required environment variables
if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  throw new Error(
    "GOOGLE_GENERATIVE_AI_API_KEY is required but not set in environment variables"
  );
}

export type SystemFactory = (
  runtime: SimulationRuntime
) => (world: World) => Promise<World>;

// Define consciousness levels
export enum ConsciousnessLevel {
  CONSCIOUS = "conscious",
  SUBCONSCIOUS = "subconscious",
  UNCONSCIOUS = "unconscious",
}

// Define system loop configuration
export interface SystemLoopConfig {
  level: ConsciousnessLevel;
  updateInterval: number;
  systems: SystemFactory[];
}

export interface RuntimeConfig {
  systemLoops?: SystemLoopConfig[];
  actions?: Record<string, ActionModule>;
  components?: readonly any[];
}

// Define default system configurations
const defaultConsciousSystems = [
  RoomSystem.create,
  PerceptionSystem.create,
  ThinkingSystem.create,
  ActionSystem.create,
  CleanupSystem.create,
];

const defaultSubconsciousSystems = [
  ExperienceSystem.create,
  GoalPlanningSystem.create,
  PlanningSystem.create,
];

const defaultUnconsciousSystems: SystemFactory[] = [];

const DEFAULT_CONFIG: RuntimeConfig = {
  systemLoops: [
    {
      level: ConsciousnessLevel.CONSCIOUS,
      updateInterval: 10000, // Fast updates for conscious processes
      systems: defaultConsciousSystems,
    },
    {
      level: ConsciousnessLevel.SUBCONSCIOUS,
      updateInterval: 25000, // Slower updates for background processes
      systems: defaultSubconsciousSystems,
    },
    {
      level: ConsciousnessLevel.UNCONSCIOUS,
      updateInterval: 50000, // Very slow updates for maintenance processes
      systems: defaultUnconsciousSystems,
    },
  ],
  actions: {},
  components: ALL_COMPONENTS,
};

// Modify the types
type LifecycleHook = (
  world: World,
  runtime: SimulationRuntime
) => Promise<void>;

interface LifecycleHookConfig {
  hook: LifecycleHook;
  once?: boolean;
}

interface LifecycleSubscriptions {
  beforeSystems: LifecycleHookConfig[];
}

// Define system loop state interface
interface SystemLoop {
  level: ConsciousnessLevel;
  systems: ((world: World) => Promise<World>)[];
  factories: SystemFactory[];
  updateInterval: number;
  lastUpdate: number;
  isRunning: boolean;
}

export class SimulationRuntime extends EventEmitter {
  public world: World;
  private systemLoops: Map<ConsciousnessLevel, SystemLoop>;
  private _isRunning = false;
  private observers: (() => void)[] = [];
  public eventBus: EventBus;
  private componentSync: ComponentSync;
  private stateManager: IStateManager;
  private roomManager: IRoomManager;
  private eventManager: IEventManager;
  private actionManager: IActionManager;
  private promptManager: PromptManager;

  // Add interaction tracking
  private recentInteractions = new Map<string, string>();
  private readonly INTERACTION_TIMEOUT = 5000;

  private lifecycleSubscriptions: LifecycleSubscriptions = {
    beforeSystems: [],
  };

  constructor(world: World, config: Partial<RuntimeConfig> = {}) {
    super();
    this.world = world;

    // Merge config with defaults
    const fullConfig = { ...DEFAULT_CONFIG, ...config };

    // Initialize system loops
    this.systemLoops = new Map();
    (fullConfig.systemLoops || DEFAULT_CONFIG.systemLoops!).forEach(
      (loopConfig) => {
        this.systemLoops.set(loopConfig.level, {
          level: loopConfig.level,
          factories: loopConfig.systems,
          systems: loopConfig.systems.map((factory) => factory(this)),
          updateInterval: loopConfig.updateInterval,
          lastUpdate: 0,
          isRunning: false,
        });
      }
    );

    // Initialize managers and other components
    this.eventBus = new EventBus(this.world);
    this.componentSync = new ComponentSync(this.world);
    this.stateManager = new StateManager(this.world, this);
    this.roomManager = new RoomManager(this.world, this);
    this.eventManager = new EventManager(this.world, this, this.eventBus);
    this.actionManager = new ActionManager(this.world, this, this.eventBus);
    this.promptManager = new PromptManager(
      {
        templates: [perceptionPrompt],
        defaultState: {},
      },
      this
    );

    // Register actions
    Object.entries(fullConfig.actions!).forEach(([name, action]) => {
      this.actionManager.registerAction(name, action);
    });

    // Log initialization
    logger.system("Runtime initialized with:");
    for (const [level, loop] of this.systemLoops) {
      logger.system(`${level}:`);
      logger.system(`- ${loop.systems.length} systems`);
      logger.system(`- ${loop.updateInterval}ms interval`);
    }
    logger.system(`- ${Object.keys(fullConfig.actions!).length} actions`);
    logger.system(`- ${fullConfig.components!.length} components`);

    // Set up world state change handler
    this.componentSync.onWorldStateChange = () => {
      const worldState = this.stateManager.getWorldState();
      this.eventManager.emitWorldUpdate(worldState);
    };
  }

  notifyWorldStateChange() {
    this.componentSync.notifyWorldStateChange();
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

  getActionManager(): IActionManager {
    return this.actionManager;
  }

  // Runtime control methods
  start() {
    if (this._isRunning) return;
    this._isRunning = true;
    for (const loop of this.systemLoops.values()) {
      loop.isRunning = true;
      this.runLoop(loop); // Start each loop independently
    }
  }

  stop() {
    this._isRunning = false;
    for (const loop of this.systemLoops.values()) {
      loop.isRunning = false;
    }
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
    this.actionManager.cleanup();
    // Clear all lifecycle subscriptions
    Object.keys(this.lifecycleSubscriptions).forEach((phase) => {
      this.lifecycleSubscriptions[phase as keyof LifecycleSubscriptions] = [];
    });
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

  // Modify subscription method to accept once option
  public subscribeToLifecycle(
    phase: keyof LifecycleSubscriptions,
    hook: LifecycleHook,
    options: { once?: boolean } = {}
  ) {
    const hookConfig = {
      hook,
      once: options.once ?? false,
    };

    this.lifecycleSubscriptions[phase].push(hookConfig);
    logger.system(
      `Lifecycle hook subscribed to ${phase}${options.once ? " (once)" : ""}`
    );

    return () => this.unsubscribeFromLifecycle(phase, hook);
  }

  private unsubscribeFromLifecycle(
    phase: keyof LifecycleSubscriptions,
    hook: LifecycleHook
  ) {
    const hooks = this.lifecycleSubscriptions[phase];
    const index = hooks.findIndex((config) => config.hook === hook);
    if (index > -1) {
      hooks.splice(index, 1);
      logger.system(`Lifecycle hook unsubscribed from ${phase}`);
    }
  }

  // Modify execute method to handle once hooks
  private async executeLifecycleHooks(phase: keyof LifecycleSubscriptions) {
    const hooks = this.lifecycleSubscriptions[phase];
    const remainingHooks: LifecycleHookConfig[] = [];

    for (const hookConfig of hooks) {
      try {
        await hookConfig.hook(this.world, this);
        // Only keep hooks that aren't 'once' or haven't run yet
        if (!hookConfig.once) {
          remainingHooks.push(hookConfig);
        }
      } catch (error) {
        logger.error(`Error in ${phase} lifecycle hook:`, error);
        // Keep the hook even if it errors, unless it's a 'once' hook
        if (!hookConfig.once) {
          remainingHooks.push(hookConfig);
        }
      }
    }

    // Update the hooks list with remaining hooks
    this.lifecycleSubscriptions[phase] = remainingHooks;
  }

  // Private helper methods
  private async runLoop(loop: SystemLoop) {
    while (this._isRunning && loop.isRunning) {
      const startTime = Date.now();

      try {
        // Run systems for this consciousness level
        logger.debug(`Running ${loop.level} systems`);
        for (const system of loop.systems) {
          if (!this._isRunning || !loop.isRunning) break;
          this.world = await system(this.world);
        }

        // Calculate time spent and adjust delay
        const elapsed = Date.now() - startTime;
        const delay = Math.max(0, loop.updateInterval - elapsed);

        if (elapsed > loop.updateInterval) {
          logger.system(
            `Warning: ${loop.level} loop took ${elapsed}ms (${Math.round(
              (elapsed / loop.updateInterval) * 100
            )}% of interval)`
          );
        }

        // Update component event bus (each loop can trigger updates)
        this.eventBus.update();

        // Wait for next interval
        await new Promise((resolve) => setTimeout(resolve, delay));
      } catch (error) {
        logger.error(`Runtime error in ${loop.level} loop:`, error);
        // Don't stop other loops if one fails
        loop.isRunning = false;
      }
    }
  }

  // Add methods to control individual consciousness levels
  startLevel(level: ConsciousnessLevel) {
    const loop = this.systemLoops.get(level);
    if (loop) {
      loop.isRunning = true;
      logger.system(`Started ${level} systems`);
    }
  }

  stopLevel(level: ConsciousnessLevel) {
    const loop = this.systemLoops.get(level);
    if (loop) {
      loop.isRunning = false;
      logger.system(`Stopped ${level} systems`);
    }
  }

  isLevelRunning(level: ConsciousnessLevel): boolean {
    return this.systemLoops.get(level)?.isRunning || false;
  }

  getLevelSystems(level: ConsciousnessLevel): SystemFactory[] {
    const loop = this.systemLoops.get(level);
    return loop ? loop.factories : [];
  }

  get isRunning(): boolean {
    return this._isRunning;
  }
}
