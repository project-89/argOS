/**
 * Async Task Queue
 *
 * Manages long-running AI operations without blocking the fast ECS loop.
 * Tasks are queued and processed in the background, with results available
 * when ready.
 *
 * Architecture:
 * - Fast ECS loop runs at high frequency (10-100+ ticks/second)
 * - AI tasks (baking, cognition) run in parallel background workers
 * - Task completion triggers callbacks without blocking
 */

export type TaskPriority = "critical" | "high" | "normal" | "low";
export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export type TaskLane = "foreground" | "subconscious" | "background";

export interface AsyncTask<T = any> {
  id: string;
  name: string;
  priority: TaskPriority;
  lane: TaskLane;
  scope?: string;
  abort: AbortController;
  status: TaskStatus;
  queuedAt: number;
  /** Monotonic pending age and FIFO tie-break; wall timestamps remain diagnostic. */
  queuedAtMonotonic: number;
  queueOrder: number;
  startedAt?: number;
  completedAt?: number;
  result?: T;
  error?: string;
  execute: (signal: AbortSignal) => Promise<T>;
  onComplete?: (result: T) => void;
  onError?: (error: Error) => void;
}

export interface TaskQueueConfig {
  maxConcurrent: number;        // Background world/building slots, NOT a global total
  foregroundMaxConcurrent: number; // Reserved responsive work; builders cannot occupy these slots
  subconsciousMaxConcurrent: number; // Reserved planning/goals/reflection; no borrowing between lanes
  subconsciousAgingMs: number;  // After this pending age, FIFO wins over priority in this lane
  monotonicNow: () => number;   // Injectable clock for pending-age fairness, independent of wall clock
  processInterval: number;      // How often to check for new tasks (ms)
  taskTimeout: number;          // Max time per task before timeout (ms)
}

export interface TaskQueueStats {
  pending: number;
  /** Logically running tasks; cancellation/timeout ends this immediately. */
  running: number;
  /** Actual executor reservations, including aborted work still settling. */
  executing: number;
  settling: number;
  completed: number;
  failed: number;
  avgExecutionTime: number;
}

const DEFAULT_CONFIG: TaskQueueConfig = {
  maxConcurrent: 3,
  foregroundMaxConcurrent: 2,
  subconsciousMaxConcurrent: 2, // Default aggregate ceiling: 3 background + 2 foreground + 2 subconscious
  subconsciousAgingMs: 5_000,
  monotonicNow: () => performance.now(),
  processInterval: 100,
  taskTimeout: 300000,  // 5 minutes (system baking can be slow)
};

// =============================================================================
// TASK QUEUE STATE
// =============================================================================

interface TaskQueueState {
  tasks: Map<string, AsyncTask>;
  pendingQueue: string[];       // Task IDs in priority order
  runningTasks: Set<string>;
  executingTasks: Set<string>;
  completedTasks: string[];
  config: TaskQueueConfig;
  isRunning: boolean;
  processTimer: NodeJS.Timeout | null;
  executionTimes: number[];     // For calculating average
}

let globalQueue: TaskQueueState | null = null;
let taskIdCounter = 0;

// =============================================================================
// QUEUE MANAGEMENT
// =============================================================================

/**
 * Initialize the global task queue
 */
export function initializeTaskQueue(config: Partial<TaskQueueConfig> = {}): void {
  if (globalQueue?.isRunning) {
    console.warn("[TaskQueue] Queue already running, stopping first...");
    stopTaskQueue();
  }
  if (globalQueue) for (const task of globalQueue.tasks.values()) cancelTask(task.id);

  globalQueue = {
    tasks: new Map(),
    pendingQueue: [],
    runningTasks: new Set(),
    executingTasks: new Set(),
    completedTasks: [],
    config: { ...DEFAULT_CONFIG, ...config },
    isRunning: false,
    processTimer: null,
    executionTimes: [],
  };

  console.log("[TaskQueue] Initialized with config:", globalQueue.config);
}

/**
 * Start processing the task queue
 */
export function startTaskQueue(): void {
  if (!globalQueue) {
    initializeTaskQueue();
  }

  if (globalQueue!.isRunning) {
    return;
  }

  globalQueue!.isRunning = true;
  scheduleNextProcess();
  console.log("[TaskQueue] Started processing");
}

/**
 * Stop processing the task queue
 */
export function stopTaskQueue(): void {
  if (!globalQueue) return;

  globalQueue.isRunning = false;
  if (globalQueue.processTimer) {
    clearTimeout(globalQueue.processTimer);
    globalQueue.processTimer = null;
  }
  console.log("[TaskQueue] Stopped processing");
}

function scheduleNextProcess(): void {
  if (!globalQueue?.isRunning) return;

  globalQueue.processTimer = setTimeout(() => {
    processQueue();
    scheduleNextProcess();
  }, globalQueue.config.processInterval);
}

// =============================================================================
// TASK OPERATIONS
// =============================================================================

/**
 * Queue a new async task
 */
export function queueTask<T>(
  name: string,
  execute: (signal: AbortSignal) => Promise<T>,
  options: {
    priority?: TaskPriority;
    lane?: TaskLane;
    scope?: string;
    onComplete?: (result: T) => void;
    onError?: (error: Error) => void;
  } = {}
): string {
  if (!globalQueue) {
    initializeTaskQueue();
    startTaskQueue();
  }

  const id = `task_${++taskIdCounter}_${Date.now()}`;

  const task: AsyncTask<T> = {
    id,
    name,
    priority: options.priority || "normal",
    lane: options.lane || "background",
    scope: options.scope,
    abort: new AbortController(),
    status: "pending",
    queuedAt: Date.now(),
    queuedAtMonotonic: globalQueue!.config.monotonicNow(),
    queueOrder: taskIdCounter,
    execute,
    onComplete: options.onComplete,
    onError: options.onError,
  };

  globalQueue!.tasks.set(id, task);
  insertByPriority(id, task.priority);

  console.log(`[TaskQueue] Queued: ${name} (${id}) [${task.priority}]`);
  return id;
}

/**
 * Insert task ID into queue by priority
 */
function insertByPriority(taskId: string, priority: TaskPriority): void {
  const queue = globalQueue!.pendingQueue;
  const priorityOrder: Record<TaskPriority, number> = {
    critical: 0,
    high: 1,
    normal: 2,
    low: 3,
  };

  const taskPriority = priorityOrder[priority];

  // Find insertion point
  let insertIndex = queue.length;
  for (let i = 0; i < queue.length; i++) {
    const existingTask = globalQueue!.tasks.get(queue[i]);
    if (existingTask && priorityOrder[existingTask.priority] > taskPriority) {
      insertIndex = i;
      break;
    }
  }

  queue.splice(insertIndex, 0, taskId);
}

/**
 * Get task status
 */
export function getTaskStatus(taskId: string): AsyncTask | undefined {
  return globalQueue?.tasks.get(taskId);
}

/**
 * Get task result (returns undefined if not complete)
 */
export function getTaskResult<T>(taskId: string): T | undefined {
  const task = globalQueue?.tasks.get(taskId);
  return task?.status === "completed" ? task.result as T : undefined;
}

/**
 * Cancel pending or running work. Cooperative executors receive its signal.
 */
export function cancelTask(taskId: string): boolean {
  const task = globalQueue?.tasks.get(taskId);
  if (!task || !["pending", "running"].includes(task.status)) {
    return false;
  }

  const wasPending = task.status === "pending";
  task.status = "cancelled";
  task.completedAt = Date.now();
  task.abort.abort();
  const index = globalQueue!.pendingQueue.indexOf(taskId);
  if (index !== -1) {
    globalQueue!.pendingQueue.splice(index, 1);
  }
  if (wasPending) retainCompletedTask(globalQueue!, task.id);

  console.log(`[TaskQueue] Cancelled: ${task.name} (${taskId})`);
  return true;
}

/**
 * Wait for a task to complete (useful for testing)
 */
export async function waitForTask<T>(taskId: string, timeout: number = 60000): Promise<T> {
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      const task = globalQueue?.tasks.get(taskId);

      if (!task) {
        reject(new Error(`Task not found: ${taskId}`));
        return;
      }

      if (task.status === "completed") {
        resolve(task.result as T);
        return;
      }

      if (task.status === "failed" || task.status === "cancelled") {
        reject(new Error(task.error || `Task ${task.status}: ${taskId}`));
        return;
      }

      if (Date.now() - startTime > timeout) {
        reject(new Error(`Task timeout: ${taskId}`));
        return;
      }

      setTimeout(check, 100);
    };

    check();
  });
}

// =============================================================================
// QUEUE PROCESSING
// =============================================================================

async function processQueue(): Promise<void> {
  if (!globalQueue) return;

  const { pendingQueue, executingTasks, config, tasks } = globalQueue;

  // Start new tasks if we have capacity
  while (pendingQueue.length > 0) {
    // Aborting a promise is not executor settlement. Keep its lane and scoped
    // operation identity reserved until the underlying work actually returns.
    const active = [...executingTasks].map(id => tasks.get(id)!);
    const laneCounts: Record<TaskLane, number> = { foreground: 0, subconscious: 0, background: 0 };
    for (const task of active) laneCounts[task.lane]++;
    const laneLimits: Record<TaskLane, number> = {
      foreground: config.foregroundMaxConcurrent,
      subconscious: config.subconsciousMaxConcurrent,
      background: config.maxConcurrent,
    };
    const runnable = (task: AsyncTask) => task.status === "pending"
      && laneCounts[task.lane] < laneLimits[task.lane]
      && !active.some(other => other.name === task.name && other.scope === task.scope);
    let next = pendingQueue.findIndex(id => {
      const task = tasks.get(id);
      return !task || task.status !== "pending" || runnable(task);
    });
    if (next < 0) break;
    if (tasks.get(pendingQueue[next])?.lane === "subconscious") {
      // Fresh work retains priority. Once aged, FIFO stops a stream of newer
      // planners from repeatedly overtaking coordination/goals/reflection.
      // This is a dispatch bound, not preemption: older aged runnable tasks,
      // actual executor settlement, and scoped single-flight still come first.
      // Foreground/background selection and all lane reservations are unchanged.
      const now = config.monotonicNow();
      let oldest: AsyncTask | undefined;
      for (let i = 0; i < pendingQueue.length; i++) {
        const task = tasks.get(pendingQueue[i]);
        if (!task || task.lane !== "subconscious" || !runnable(task)
          || now - task.queuedAtMonotonic < config.subconsciousAgingMs) continue;
        if (!oldest || task.queuedAtMonotonic < oldest.queuedAtMonotonic
          || task.queuedAtMonotonic === oldest.queuedAtMonotonic && task.queueOrder < oldest.queueOrder) {
          oldest = task;
          next = i;
        }
      }
    }
    const [taskId] = pendingQueue.splice(next, 1);
    const task = tasks.get(taskId);

    if (!task || task.status !== "pending") {
      continue;
    }

    runTask(task);
  }
}

async function runTask(task: AsyncTask): Promise<void> {
  if (!globalQueue) return;
  const queue = globalQueue;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;

  task.status = "running";
  task.startedAt = Date.now();
  queue.runningTasks.add(task.id);
  queue.executingTasks.add(task.id);

  console.log(`[TaskQueue] Starting: ${task.name} (${task.id})`);

  try {
    // Create a timeout wrapper
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        const error = new Error(`Task timeout after ${queue.config.taskTimeout}ms`);
        task.abort.abort(error);
        reject(error);
      }, queue.config.taskTimeout);
    });
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => reject(task.abort.signal.reason);
      task.abort.signal.addEventListener("abort", onAbort, { once: true });
    });

    // Normalize synchronous throws as executor settlement too. Both branches
    // observe late rejection after cancellation without a second callback.
    const execution = Promise.resolve().then(() => {
      task.abort.signal.throwIfAborted();
      return task.execute(task.abort.signal);
    });
    const releaseExecution = () => {
      queue.executingTasks.delete(task.id);
      if (!queue.runningTasks.has(task.id)) retainCompletedTask(queue, task.id);
    };
    void execution.then(releaseExecution, releaseExecution);

    // Logical outcome may settle before execution. It must not free capacity.
    const result = await Promise.race([
      execution,
      timeoutPromise,
      cancelled,
    ]);
    task.abort.signal.throwIfAborted();

    task.status = "completed";
    task.result = result;
    task.completedAt = Date.now();

    // Track execution time
    const execTime = task.completedAt - task.startedAt!;
    queue.executionTimes.push(execTime);
    if (queue.executionTimes.length > 100) {
      queue.executionTimes.shift();
    }

    console.log(`[TaskQueue] Completed: ${task.name} (${task.id}) in ${execTime}ms`);

    // Call completion callback
    if (task.onComplete) {
      try {
        task.onComplete(result);
      } catch (callbackError) {
        console.error(`[TaskQueue] Callback error for ${task.name}:`, callbackError);
      }
    }

  } catch (error) {
    // cancelTask may have changed this object while execution was suspended.
    const wasCancelled = (task.status as TaskStatus) === "cancelled";
    if (!wasCancelled) task.status = "failed";
    task.error = error instanceof Error ? (error.stack || error.message) : String(error);
    task.completedAt = Date.now();

    if (wasCancelled) {
      console.log(`[TaskQueue] Cancelled running work: ${task.name} (${task.id})`);
    } else if (error instanceof Error) {
      console.error(`[TaskQueue] Failed: ${task.name} (${task.id})`, error);
    } else {
      console.error(`[TaskQueue] Failed: ${task.name} (${task.id}):`, task.error);
    }

    // Call error callback
    if (task.onError) {
      try {
        task.onError(error instanceof Error ? error : new Error(String(error)));
      } catch (callbackError) {
        console.error(`[TaskQueue] Error callback failed for ${task.name}:`, callbackError);
      }
    }
  } finally {
    clearTimeout(timeout);
    if (onAbort) task.abort.signal.removeEventListener("abort", onAbort);
    queue.runningTasks.delete(task.id);
    if (!queue.executingTasks.has(task.id)) retainCompletedTask(queue, task.id);
  }
}

function retainCompletedTask(queue: TaskQueueState, id: string): void {
  queue.completedTasks.push(id);
  while (queue.completedTasks.length > 100) queue.tasks.delete(queue.completedTasks.shift()!);
}

// =============================================================================
// STATS & UTILITIES
// =============================================================================

/**
 * Get queue statistics
 */
export function getQueueStats(): TaskQueueStats {
  if (!globalQueue) {
    return { pending: 0, running: 0, executing: 0, settling: 0, completed: 0, failed: 0, avgExecutionTime: 0 };
  }

  const completed = Array.from(globalQueue.tasks.values())
    .filter(t => t.status === "completed").length;
  const failed = Array.from(globalQueue.tasks.values())
    .filter(t => t.status === "failed").length;

  const avgTime = globalQueue.executionTimes.length > 0
    ? globalQueue.executionTimes.reduce((a, b) => a + b, 0) / globalQueue.executionTimes.length
    : 0;

  return {
    pending: globalQueue.pendingQueue.length,
    running: globalQueue.runningTasks.size,
    executing: globalQueue.executingTasks.size,
    settling: [...globalQueue.executingTasks].filter(id => !globalQueue!.runningTasks.has(id)).length,
    completed,
    failed,
    avgExecutionTime: Math.round(avgTime),
  };
}

/** Names of tasks currently holding a slot (diagnostics only). */
export function getRunningTaskNames(): string[] {
  if (!globalQueue) return [];
  return [...globalQueue.runningTasks].map(id => globalQueue!.tasks.get(id)?.name ?? id);
}

/**
 * Get all pending task names
 */
export function getPendingTaskNames(): string[] {
  if (!globalQueue) return [];

  return globalQueue.pendingQueue
    .map(id => globalQueue!.tasks.get(id)?.name)
    .filter((name): name is string => name !== undefined);
}

/**
 * Check if a task with given name is queued, running, or still settling.
 */
export function isTaskInProgress(name: string, scope?: string): boolean {
  if (!globalQueue) return false;

  for (const task of globalQueue.tasks.values()) {
    if (task.name === name && (scope === undefined || task.scope === scope) &&
        (task.status === "pending" || task.status === "running" || globalQueue.executingTasks.has(task.id))) {
      return true;
    }
  }
  return false;
}

/**
 * Clear all completed tasks from memory
 */
export function clearCompletedTasks(): void {
  if (!globalQueue) return;

  for (const id of globalQueue.completedTasks) {
    globalQueue.tasks.delete(id);
  }
  globalQueue.completedTasks = [];
}

/**
 * Get queue summary for logging
 */
export function getQueueSummary(): string {
  const stats = getQueueStats();
  return `[TaskQueue] Pending: ${stats.pending}, Running: ${stats.running}, Settling: ${stats.settling}, Completed: ${stats.completed}, Failed: ${stats.failed}, Avg: ${stats.avgExecutionTime}ms`;
}
