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
import { advanceSimulationTime, validateSimulationDelta, validateTimeScale } from "../ecs/simulation-time";
import type { SystemRegistry } from "../ecs/dynamic-systems";
import type { SpiritRegistry } from "../spirits/spirit-registry";
import {
  queueTask,
  startTaskQueue,
  stopTaskQueue,
  getQueueStats,
  getQueueSummary,
  isTaskInProgress,
  cancelTask,
  type TaskPriority,
  type TaskLane,
} from "./async-task-queue";
import { withSimulationTask } from "./task-scope";
import { FastRuntimeHealth, type FastRuntimeHealthSnapshot } from "./fast-system-health";

// =============================================================================
// CONFIGURATION
// =============================================================================

export interface SimulationConfig {
  // Fast ECS loop settings
  ecsTickRate: number;           // Ticks per second (default: 20)
  ecsMaxTickTime: number;        // Max ms per tick before warning (default: 50)
  /** Fixed base milliseconds per tick; defaults to 1000 / ecsTickRate. */
  ecsDeltaMs?: number;
  /** In-world delta multiplier. Does not change AI request deadlines or telemetry. */
  timeScale: number;
  /** False only when an enclosing world runner owns clock advancement. */
  ownsWorldClock: boolean;

  // AI loop settings
  aiProcessInterval: number;     // How often to check AI tasks (default: 500ms)
  aiMaxConcurrent: number;       // Background budget hint; global queue configuration owns the actual lane limits

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
  timeScale: 1,
  ownsWorldClock: true,
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
  pendingDeltaMs?: number;
};

export type AIOperation = {
  name: string;
  execute: () => Promise<any>;
  priority?: TaskPriority;
  lane?: TaskLane;
  /** Checked both at enqueue and dispatch; must be a read-only readiness probe. */
  ready?: () => boolean;
  interval: number;              // Run every N ticks
  lastRun?: number;
  metrics?: AIOperationMetrics;
};

export type AIOperationMetrics = {
  queued: number; started: number; completed: number; failed: number; cancelled: number; skipped: number;
  lastStartedAt: number | null; lastCompletedAt: number | null; lastError: string | null;
  maxQueueDelayMs: number; maxDurationMs: number; durationsMs: number[];
};
const operationMetrics = (): AIOperationMetrics => ({ queued: 0, started: 0, completed: 0,
  failed: 0, cancelled: 0, skipped: 0, lastStartedAt: null, lastCompletedAt: null,
  lastError: null, maxQueueDelayMs: 0, maxDurationMs: 0, durationsMs: [] });
let nextRuntimeId = 0;
const activeRuntimes = new Set<SimulationState>();

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
  abort: AbortController;
  tasks: Set<string>;
  /** Actual operation settlement, separate from the queue's cancellation race. */
  settlingOperations: Set<Promise<unknown>>;
  scopeId: string;

  // Systems
  fastSystems: FastSystem[];
  aiOperations: AIOperation[];

  // Timers
  ecsTimer: NodeJS.Timeout | null;
  /** Operator pause: no new AI operation may launch until resume. */
  paused?: boolean;

  // Stats
  tickTimes: number[];
  slowTicks: number;
  fastHealth: FastRuntimeHealth;
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
  if (!Number.isFinite(fullConfig.ecsTickRate) || fullConfig.ecsTickRate <= 0) {
    throw new RangeError("ecsTickRate must be finite and greater than zero");
  }
  validateTimeScale(fullConfig.timeScale);
  if (fullConfig.ecsDeltaMs !== undefined) validateSimulationDelta(fullConfig.ecsDeltaMs);
  validateSimulationDelta((fullConfig.ecsDeltaMs ?? 1000 / fullConfig.ecsTickRate) * fullConfig.timeScale);

  const scopeId = `runtime:${++nextRuntimeId}`;
  return {
    world,
    abort: new AbortController(), tasks: new Set(), settlingOperations: new Set(),
    scopeId,
    systemRegistry,
    spiritRegistry,
    config: fullConfig,
    tick: world.time.tick,
    startTime: 0,
    lastTickTime: 0,
    isRunning: false,
    fastSystems: [],
    aiOperations: [],
    ecsTimer: null,
    tickTimes: [],
    slowTicks: 0,
    fastHealth: new FastRuntimeHealth(world, scopeId),
  };
}

/**
 * Register a fast (synchronous) ECS system
 */
export function registerFastSystem(
  state: SimulationState,
  system: FastSystem
): void {
  const registered = {
    ...system,
    lastRun: 0,
  };
  state.fastSystems.push(registered);
  state.fastHealth.register(registered);
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
    metrics: operationMetrics(),
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
  state.paused = false;
  state.fastHealth.start();
  activeRuntimes.add(state);
  if (state.abort.signal.aborted) state.abort = new AbortController();
  state.startTime = Date.now();
  state.lastTickTime = state.startTime;

  // Start the AI task queue
  startTaskQueue();

  // Start the fast ECS loop
  const tickInterval = 1000 / state.config.ecsTickRate;
  state.lastTickTime = Date.now();
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
  state.fastHealth.stop();
  state.abort.abort();
  for (const id of state.tasks) cancelTask(id);
  state.tasks.clear();

  if (state.ecsTimer) {
    clearInterval(state.ecsTimer);
    state.ecsTimer = null;
  }

  activeRuntimes.delete(state);
  if (activeRuntimes.size === 0) stopTaskQueue();

  console.log(`[SimLoop] Stopped after ${state.tick} ticks`);
  logFinalStats(state);
}

/** Keep observers attached until stopped runtime-owned operations finish their
 * finally callbacks. This neither runs the world clock nor invents cancellation
 * receipts. Uncooperative work remains unsettled and a bounded drain fails. */
export async function drainSimulationOperations(state: SimulationState, timeoutMs = 2000): Promise<void> {
  if (state.isRunning) throw new Error("Operation drain requires a stopped runtime");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000)
    throw new RangeError("Operation drain timeout must be 1..10000 wall milliseconds");
  const generation = state.abort.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.allSettled([...state.settlingOperations]),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(
        `Operation drain timed out; ${state.settlingOperations.size} operation(s) remain unsettled`)), timeoutMs); }),
    ]);
    if (state.isRunning || state.abort.signal !== generation) throw new Error("Runtime restarted during operation drain");
    if (state.settlingOperations.size) throw new Error("Operation drain incomplete");
  } finally { if (timer) clearTimeout(timer); }
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
  // Already-queued operations re-check this at dispatch (below), so a pause
  // also stops model work that was enrolled but had not started yet.
  state.paused = true;

  console.log(`[SimLoop] Paused at tick ${state.tick}`);
  state.fastHealth.pause();
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
  state.paused = false;
  state.lastTickTime = Date.now();
  state.ecsTimer = setInterval(() => {
    runECSTick(state);
  }, tickInterval);

  console.log(`[SimLoop] Resumed at tick ${state.tick}`);
  state.fastHealth.resume();
}

// =============================================================================
// FAST ECS LOOP
// =============================================================================

function runECSTick(state: SimulationState): void {
  const tickStart = Date.now();
  // Fixed simulation steps do not turn a slow model, delayed timer, laptop
  // sleep, or pause into a large unobserved leap through physical action time.
  const delta = (state.config.ecsDeltaMs ?? 1000 / state.config.ecsTickRate) * state.config.timeScale;
  validateSimulationDelta(delta);
  const nextTick = Math.max(state.tick, state.world.time.tick) + 1;
  if (state.config.ownsWorldClock) advanceSimulationTime(state.world, nextTick, delta);
  state.tick = nextTick;

  // Run all fast systems
  for (const system of state.fastSystems) {
    system.pendingDeltaMs = (system.pendingDeltaMs ?? 0) + delta;
    const frequency = system.frequency || 1;
    if (state.tick % frequency === 0) {
      const systemDelta = system.pendingDeltaMs;
      system.pendingDeltaMs = 0;
      try {
        state.fastHealth.execute(system, state.tick, () => system.execute(state.world, systemDelta, state.tick));
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

function operationIsReady(op: AIOperation): boolean {
  try {
    return op.ready?.() ?? true;
  } catch (error) {
    // An actor can disappear or its package can unload between ticks. A faulty
    // readiness probe must not crash the fast loop or launch speculative work.
    console.error(`[SimLoop] AI readiness failed: ${op.name}`, error);
    return false;
  }
}

function checkAIOperations(state: SimulationState): void {
  for (const op of state.aiOperations) {
    // Check if it's time to run this operation
    if (state.tick - (op.lastRun ?? 0) >= op.interval) {
      // Don't queue if already in progress
      if (isTaskInProgress(op.name, state.scopeId)) {
        continue;
      }
      // Readiness can inspect an actor's local sensory/goal snapshot. Avoid
      // rebuilding it every fast tick while this operation is already queued
      // or running; dispatch still checks readiness against current evidence.
      if (!operationIsReady(op)) continue;

      // Queue the operation
      const signal = state.abort.signal;
      const previousRun = op.lastRun ?? 0;
      const metrics = op.metrics ??= operationMetrics();
      const queuedAt = Date.now();
      metrics.queued++;
      let skipped = false;
      let beganAt: number | null = null;
      const id = queueTask(op.name, taskSignal => {
        const operation = withSimulationTask(AbortSignal.any([signal, taskSignal]), async () => {
          // Queue capacity may become available long after this operation was
          // enrolled. Never launch a model request for stale readiness.
          if (!state.isRunning || state.paused || !operationIsReady(op)) {
            skipped = true;
            op.lastRun = previousRun;
            return undefined;
          }
          beganAt = Date.now();
          metrics.started++;
          metrics.lastStartedAt = beganAt;
          metrics.maxQueueDelayMs = Math.max(metrics.maxQueueDelayMs, beganAt - queuedAt);
          return op.execute();
        }).finally(() => state.settlingOperations.delete(operation));
        state.settlingOperations.add(operation);
        return operation;
      }, {
        priority: op.priority || "normal",
        lane: op.lane,
        scope: state.scopeId,
        onComplete: (result) => {
          state.tasks.delete(id);
          metrics[skipped ? "skipped" : "completed"]++;
          metrics.lastCompletedAt = Date.now();
          if (beganAt !== null) {
            const duration = Date.now() - beganAt;
            metrics.maxDurationMs = Math.max(metrics.maxDurationMs, duration);
            metrics.durationsMs.push(duration);
            if (metrics.durationsMs.length > 100) metrics.durationsMs.shift();
          }
          metrics.lastError = null;
          console.log(`[SimLoop] AI operation ${skipped ? "skipped (no longer ready)" : "completed"}: ${op.name}`);
        },
        onError: (error) => {
          state.tasks.delete(id);
          if (signal.aborted) metrics.cancelled++;
          else {
            metrics.failed++;
            metrics.lastError = String(error).slice(0, 500);
            console.error(`[SimLoop] AI operation failed: ${op.name}`, error);
          }
        },
      });
      state.tasks.add(id);

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
  pendingTasks: number;
  operations: Array<{ name: string; lane: TaskLane; metrics: AIOperationMetrics }>;
  fastSystemHealth: FastRuntimeHealthSnapshot;
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
    fastSystemHealth: state.fastHealth.snapshot(),
    aiOperations: state.aiOperations.length,
    queueStats: getQueueStats(),
    pendingTasks: state.tasks.size,
    operations: state.aiOperations.map(op => ({ name: op.name, lane: op.lane ?? "background",
      metrics: { ...(op.metrics ?? operationMetrics()), durationsMs: [...(op.metrics?.durationsMs ?? [])] } })),
  };
}
