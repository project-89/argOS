/**
 * Dual-Loop Simulation Runtime
 *
 * Separates the simulation into two independent loops:
 *
 * 1. FAST ECS LOOP (10-100+ Hz)
 *    - Runs deterministic, pure ECS systems
 *    - No AI calls, no blocking operations
 *    - Examples: physics, needs decay, health regen, movement
 *
 * 2. SLOW AI LOOP (variable, async)
 *    - Runs AI-powered operations in background
 *    - Non-blocking, queued processing
 *    - Examples: spirit cognition, system baking, narrative generation
 *
 * This architecture ensures the simulation stays responsive while
 * AI operations happen in the background.
 */

import type { World } from "../ecs/world";
import type { SystemRegistry } from "../ecs/dynamic-systems";
import type { SpiritRegistry } from "../spirits/spirit-registry";
import {
  queueTask,
  startTaskQueue,
  stopTaskQueue,
  getQueueStats,
  getQueueSummary,
  isTaskInProgress,
  type TaskPriority,
} from "./async-task-queue";

// =============================================================================
// CONFIGURATION
// =============================================================================

export interface SimulationConfig {
  // Fast ECS loop settings
  ecsTickRate: number;           // Ticks per second (default: 20)
  ecsMaxTickTime: number;        // Max ms per tick before warning (default: 50)

  // AI loop settings
  aiProcessInterval: number;     // How often to check AI tasks (default: 500ms)
  aiMaxConcurrent: number;       // Max concurrent AI operations (default: 3)

  // Spirit intervals (in ECS ticks)
  watcherTickInterval: number;   // How often watchers observe (default: 100 ticks)
  architectTickInterval: number; // How often architects propose (default: 200 ticks)
  approvalTickInterval: number;  // How often GodAI reviews (default: 300 ticks)

  // Debug
  logTickStats: boolean;         // Log performance stats
  logInterval: number;           // Log every N ticks
}

const DEFAULT_CONFIG: SimulationConfig = {
  ecsTickRate: 20,               // 20 ticks/second = 50ms per tick
  ecsMaxTickTime: 50,
  aiProcessInterval: 500,
  aiMaxConcurrent: 3,
  watcherTickInterval: 100,      // Every 5 seconds at 20 Hz
  architectTickInterval: 200,    // Every 10 seconds
  approvalTickInterval: 300,     // Every 15 seconds
  logTickStats: true,
  logInterval: 100,
};

// =============================================================================
// TYPES
// =============================================================================

export type FastSystem = {
  name: string;
  execute: (world: World, delta: number, tick: number) => void;
  frequency?: number;            // Run every N ticks (default: 1)
  lastRun?: number;
};

export type AIOperation = {
  name: string;
  execute: () => Promise<any>;
  priority?: TaskPriority;
  interval: number;              // Run every N ticks
  lastRun: number;
};

export interface SimulationState {
  world: World;
  systemRegistry: SystemRegistry;
  spiritRegistry: SpiritRegistry;
  config: SimulationConfig;

  // Loop state
  tick: number;
  startTime: number;
  lastTickTime: number;
  isRunning: boolean;

  // Systems
  fastSystems: FastSystem[];
  aiOperations: AIOperation[];

  // Timers
  ecsTimer: NodeJS.Timeout | null;

  // Stats
  tickTimes: number[];
  slowTicks: number;
}

// =============================================================================
// SIMULATION LIFECYCLE
// =============================================================================

/**
 * Create a new simulation state
 */
export function createSimulation(
  world: World,
  systemRegistry: SystemRegistry,
  spiritRegistry: SpiritRegistry,
  config: Partial<SimulationConfig> = {}
): SimulationState {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };

  return {
    world,
    systemRegistry,
    spiritRegistry,
    config: fullConfig,
    tick: 0,
    startTime: 0,
    lastTickTime: 0,
    isRunning: false,
    fastSystems: [],
    aiOperations: [],
    ecsTimer: null,
    tickTimes: [],
    slowTicks: 0,
  };
}

/**
 * Register a fast (synchronous) ECS system
 */
export function registerFastSystem(
  state: SimulationState,
  system: FastSystem
): void {
  state.fastSystems.push({
    ...system,
    lastRun: 0,
  });
  console.log(`[SimLoop] Registered fast system: ${system.name}`);
}

/**
 * Register an AI operation to run periodically
 */
export function registerAIOperation(
  state: SimulationState,
  operation: AIOperation
): void {
  state.aiOperations.push({
    ...operation,
    lastRun: 0,
  });
  console.log(`[SimLoop] Registered AI operation: ${operation.name} (every ${operation.interval} ticks)`);
}

/**
 * Start the simulation
 */
export function startSimulation(state: SimulationState): void {
  if (state.isRunning) {
    console.warn("[SimLoop] Simulation already running");
    return;
  }

  state.isRunning = true;
  state.startTime = Date.now();
  state.lastTickTime = state.startTime;

  // Start the AI task queue
  startTaskQueue();

  // Start the fast ECS loop
  const tickInterval = 1000 / state.config.ecsTickRate;
  state.ecsTimer = setInterval(() => {
    runECSTick(state);
  }, tickInterval);

  console.log(`[SimLoop] Started - ECS: ${state.config.ecsTickRate}Hz, AI interval: ${state.config.aiProcessInterval}ms`);
}

/**
 * Stop the simulation
 */
export function stopSimulation(state: SimulationState): void {
  if (!state.isRunning) return;

  state.isRunning = false;

  if (state.ecsTimer) {
    clearInterval(state.ecsTimer);
    state.ecsTimer = null;
  }

  stopTaskQueue();

  console.log(`[SimLoop] Stopped after ${state.tick} ticks`);
  logFinalStats(state);
}

/**
 * Pause the simulation (can be resumed)
 */
export function pauseSimulation(state: SimulationState): void {
  if (!state.isRunning) return;

  if (state.ecsTimer) {
    clearInterval(state.ecsTimer);
    state.ecsTimer = null;
  }

  console.log(`[SimLoop] Paused at tick ${state.tick}`);
}

/**
 * Resume the simulation
 */
export function resumeSimulation(state: SimulationState): void {
  if (!state.isRunning) {
    console.warn("[SimLoop] Cannot resume - not running");
    return;
  }

  if (state.ecsTimer) {
    console.warn("[SimLoop] Already running");
    return;
  }

  const tickInterval = 1000 / state.config.ecsTickRate;
  state.ecsTimer = setInterval(() => {
    runECSTick(state);
  }, tickInterval);

  console.log(`[SimLoop] Resumed at tick ${state.tick}`);
}

// =============================================================================
// FAST ECS LOOP
// =============================================================================

function runECSTick(state: SimulationState): void {
  const tickStart = Date.now();
  state.tick++;

  // Run all fast systems
  for (const system of state.fastSystems) {
    const frequency = system.frequency || 1;
    if (state.tick % frequency === 0) {
      try {
        const delta = tickStart - state.lastTickTime;
        system.execute(state.world, delta, state.tick);
        system.lastRun = state.tick;
      } catch (error) {
        console.error(`[SimLoop] Fast system error (${system.name}):`, error);
      }
    }
  }

  // Check if any AI operations should be queued
  checkAIOperations(state);

  // Record tick time
  const tickTime = Date.now() - tickStart;
  state.tickTimes.push(tickTime);
  if (state.tickTimes.length > 100) {
    state.tickTimes.shift();
  }

  // Warn about slow ticks
  if (tickTime > state.config.ecsMaxTickTime) {
    state.slowTicks++;
    if (state.slowTicks % 10 === 1) {
      console.warn(`[SimLoop] Slow tick #${state.slowTicks}: ${tickTime}ms (max: ${state.config.ecsMaxTickTime}ms)`);
    }
  }

  // Log stats periodically
  if (state.config.logTickStats && state.tick % state.config.logInterval === 0) {
    logTickStats(state);
  }

  state.lastTickTime = tickStart;
}

// =============================================================================
// AI OPERATION SCHEDULING
// =============================================================================

function checkAIOperations(state: SimulationState): void {
  for (const op of state.aiOperations) {
    // Check if it's time to run this operation
    if (state.tick - op.lastRun >= op.interval) {
      // Don't queue if already in progress
      if (isTaskInProgress(op.name)) {
        continue;
      }

      // Queue the operation
      queueTask(op.name, op.execute, {
        priority: op.priority || "normal",
        onComplete: (result) => {
          console.log(`[SimLoop] AI operation completed: ${op.name}`);
        },
        onError: (error) => {
          console.error(`[SimLoop] AI operation failed: ${op.name}`, error);
        },
      });

      op.lastRun = state.tick;
    }
  }
}

// =============================================================================
// CONVENIENCE: QUEUE ONE-OFF AI TASKS
// =============================================================================

/**
 * Queue a one-off AI task (like baking a system)
 */
export function queueAITask<T>(
  name: string,
  execute: () => Promise<T>,
  options: {
    priority?: TaskPriority;
    onComplete?: (result: T) => void;
    onError?: (error: Error) => void;
  } = {}
): string {
  return queueTask(name, execute, options);
}

// =============================================================================
// STATS & DEBUGGING
// =============================================================================

function logTickStats(state: SimulationState): void {
  const avgTickTime = state.tickTimes.length > 0
    ? state.tickTimes.reduce((a, b) => a + b, 0) / state.tickTimes.length
    : 0;

  const queueStats = getQueueStats();

  console.log(
    `[SimLoop] Tick ${state.tick} | ` +
    `Avg: ${avgTickTime.toFixed(1)}ms | ` +
    `Slow: ${state.slowTicks} | ` +
    `AI Queue: ${queueStats.pending}p/${queueStats.running}r/${queueStats.completed}c`
  );
}

function logFinalStats(state: SimulationState): void {
  const avgTickTime = state.tickTimes.length > 0
    ? state.tickTimes.reduce((a, b) => a + b, 0) / state.tickTimes.length
    : 0;
  const runtime = (Date.now() - state.startTime) / 1000;

  console.log("\n[SimLoop] === FINAL STATS ===");
  console.log(`  Total ticks: ${state.tick}`);
  console.log(`  Runtime: ${runtime.toFixed(1)}s`);
  console.log(`  Avg tick time: ${avgTickTime.toFixed(2)}ms`);
  console.log(`  Slow ticks: ${state.slowTicks}`);
  console.log(`  ${getQueueSummary()}`);
}

/**
 * Get current simulation stats
 */
export function getSimulationStats(state: SimulationState): {
  tick: number;
  runtime: number;
  avgTickTime: number;
  slowTicks: number;
  fastSystems: number;
  aiOperations: number;
  queueStats: ReturnType<typeof getQueueStats>;
} {
  const avgTickTime = state.tickTimes.length > 0
    ? state.tickTimes.reduce((a, b) => a + b, 0) / state.tickTimes.length
    : 0;

  return {
    tick: state.tick,
    runtime: (Date.now() - state.startTime) / 1000,
    avgTickTime,
    slowTicks: state.slowTicks,
    fastSystems: state.fastSystems.length,
    aiOperations: state.aiOperations.length,
    queueStats: getQueueStats(),
  };
}
