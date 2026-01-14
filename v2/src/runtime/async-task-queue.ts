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

export interface AsyncTask<T = any> {
  id: string;
  name: string;
  priority: TaskPriority;
  status: TaskStatus;
  queuedAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: T;
  error?: string;
  execute: () => Promise<T>;
  onComplete?: (result: T) => void;
  onError?: (error: Error) => void;
}

export interface TaskQueueConfig {
  maxConcurrent: number;        // Max concurrent AI tasks
  processInterval: number;      // How often to check for new tasks (ms)
  taskTimeout: number;          // Max time per task before timeout (ms)
}

export interface TaskQueueStats {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  avgExecutionTime: number;
}

const DEFAULT_CONFIG: TaskQueueConfig = {
  maxConcurrent: 3,
  processInterval: 100,
  taskTimeout: 120000,  // 2 minutes
};

// =============================================================================
// TASK QUEUE STATE
// =============================================================================

interface TaskQueueState {
  tasks: Map<string, AsyncTask>;
  pendingQueue: string[];       // Task IDs in priority order
  runningTasks: Set<string>;
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

  globalQueue = {
    tasks: new Map(),
    pendingQueue: [],
    runningTasks: new Set(),
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
  execute: () => Promise<T>,
  options: {
    priority?: TaskPriority;
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
    status: "pending",
    queuedAt: Date.now(),
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
 * Cancel a pending task
 */
export function cancelTask(taskId: string): boolean {
  const task = globalQueue?.tasks.get(taskId);
  if (!task || task.status !== "pending") {
    return false;
  }

  task.status = "cancelled";
  const index = globalQueue!.pendingQueue.indexOf(taskId);
  if (index !== -1) {
    globalQueue!.pendingQueue.splice(index, 1);
  }

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

  const { pendingQueue, runningTasks, config, tasks } = globalQueue;

  // Start new tasks if we have capacity
  while (
    pendingQueue.length > 0 &&
    runningTasks.size < config.maxConcurrent
  ) {
    const taskId = pendingQueue.shift()!;
    const task = tasks.get(taskId);

    if (!task || task.status !== "pending") {
      continue;
    }

    runTask(task);
  }
}

async function runTask(task: AsyncTask): Promise<void> {
  if (!globalQueue) return;

  task.status = "running";
  task.startedAt = Date.now();
  globalQueue.runningTasks.add(task.id);

  console.log(`[TaskQueue] Starting: ${task.name} (${task.id})`);

  try {
    // Create a timeout wrapper
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Task timeout after ${globalQueue!.config.taskTimeout}ms`));
      }, globalQueue!.config.taskTimeout);
    });

    // Race between task execution and timeout
    const result = await Promise.race([
      task.execute(),
      timeoutPromise,
    ]);

    task.status = "completed";
    task.result = result;
    task.completedAt = Date.now();

    // Track execution time
    const execTime = task.completedAt - task.startedAt!;
    globalQueue.executionTimes.push(execTime);
    if (globalQueue.executionTimes.length > 100) {
      globalQueue.executionTimes.shift();
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
    task.status = "failed";
    task.error = error instanceof Error ? error.message : String(error);
    task.completedAt = Date.now();

    console.error(`[TaskQueue] Failed: ${task.name} (${task.id}):`, task.error);

    // Call error callback
    if (task.onError) {
      try {
        task.onError(error instanceof Error ? error : new Error(String(error)));
      } catch (callbackError) {
        console.error(`[TaskQueue] Error callback failed for ${task.name}:`, callbackError);
      }
    }
  } finally {
    globalQueue!.runningTasks.delete(task.id);
    globalQueue!.completedTasks.push(task.id);

    // Cleanup old completed tasks (keep last 100)
    while (globalQueue!.completedTasks.length > 100) {
      const oldId = globalQueue!.completedTasks.shift()!;
      globalQueue!.tasks.delete(oldId);
    }
  }
}

// =============================================================================
// STATS & UTILITIES
// =============================================================================

/**
 * Get queue statistics
 */
export function getQueueStats(): TaskQueueStats {
  if (!globalQueue) {
    return { pending: 0, running: 0, completed: 0, failed: 0, avgExecutionTime: 0 };
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
    completed,
    failed,
    avgExecutionTime: Math.round(avgTime),
  };
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
 * Check if a task with given name is already queued or running
 */
export function isTaskInProgress(name: string): boolean {
  if (!globalQueue) return false;

  for (const task of globalQueue.tasks.values()) {
    if (task.name === name && (task.status === "pending" || task.status === "running")) {
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
  return `[TaskQueue] Pending: ${stats.pending}, Running: ${stats.running}, Completed: ${stats.completed}, Failed: ${stats.failed}, Avg: ${stats.avgExecutionTime}ms`;
}
