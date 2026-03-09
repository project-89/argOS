/**
 * Task Queue System
 *
 * Gives agents explicit task management capabilities:
 * - Personal todo lists with priorities
 * - Task dependencies and blocking
 * - Deadline tracking
 * - Progress monitoring
 * - Task delegation and collaboration
 *
 * This provides the "inbox" model that knowledge workers use,
 * bridging the gap between reactive simulation and proactive planning.
 */

import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";
import type { World } from "../ecs/world";

// =============================================================================
// TYPES
// =============================================================================

export interface Task {
  id: string;
  createdAt: number;
  updatedAt: number;

  // Core properties
  title: string;
  description: string;
  type: "action" | "research" | "communication" | "creation" | "maintenance" | "goal";
  status: "pending" | "in_progress" | "blocked" | "completed" | "failed" | "delegated";

  // Prioritization
  priority: "urgent" | "high" | "medium" | "low";
  importance: number; // 0-1
  urgency: number; // 0-1

  // Timing
  deadline?: number;
  estimatedDuration?: number; // minutes
  actualDuration?: number;
  startedAt?: number;
  completedAt?: number;

  // Dependencies
  blockedBy?: string[]; // Task IDs
  blocks?: string[]; // Task IDs this blocks
  prerequisites?: string[]; // Conditions that must be true

  // Context
  context?: string; // Additional context for the task
  relatedEntities?: string[]; // Entity names involved
  location?: string; // Where to do this
  toolsRequired?: string[]; // Tools/affordances needed

  // Collaboration
  assignedBy?: string; // Who created this task
  assignedTo?: number; // Agent EID
  delegatedTo?: number; // Another agent EID

  // Progress
  subtasks?: Subtask[];
  progress: number; // 0-100
  notes: string[];

  // Outcome
  result?: string;
  lessonsLearned?: string;
}

export interface Subtask {
  id: string;
  title: string;
  completed: boolean;
  result?: string;
}

export interface TaskQueue {
  agentEid: number;
  tasks: Task[];
  completedTasks: Task[];
  maxCompletedHistory: number;
  stats: {
    tasksCreated: number;
    tasksCompleted: number;
    tasksFailed: number;
    totalTimeSpent: number;
    averageCompletionTime: number;
  };
}

// =============================================================================
// STATE MANAGEMENT
// =============================================================================

const taskQueues = new Map<number, TaskQueue>();
let taskIdCounter = 0;
let subtaskIdCounter = 0;

/**
 * Get or create task queue for agent
 */
export function getTaskQueue(agentEid: number): TaskQueue {
  let queue = taskQueues.get(agentEid);
  if (!queue) {
    queue = {
      agentEid,
      tasks: [],
      completedTasks: [],
      maxCompletedHistory: 50,
      stats: {
        tasksCreated: 0,
        tasksCompleted: 0,
        tasksFailed: 0,
        totalTimeSpent: 0,
        averageCompletionTime: 0,
      },
    };
    taskQueues.set(agentEid, queue);
  }
  return queue;
}

// =============================================================================
// TASK OPERATIONS
// =============================================================================

/**
 * Create a new task
 */
export function createTask(
  agentEid: number,
  task: Omit<Task, "id" | "createdAt" | "updatedAt" | "status" | "progress" | "notes">
): Task {
  const queue = getTaskQueue(agentEid);

  const newTask: Task = {
    ...task,
    id: `task_${++taskIdCounter}_${Date.now()}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "pending",
    progress: 0,
    notes: [],
    assignedTo: agentEid,
  };

  queue.tasks.push(newTask);
  queue.stats.tasksCreated++;

  // Update blocking relationships
  if (task.blockedBy) {
    for (const blockerId of task.blockedBy) {
      const blocker = queue.tasks.find(t => t.id === blockerId);
      if (blocker) {
        blocker.blocks = blocker.blocks || [];
        if (!blocker.blocks.includes(newTask.id)) {
          blocker.blocks.push(newTask.id);
        }
      }
    }
  }

  console.log(`[TaskQueue] Created task for agent ${agentEid}: ${newTask.title}`);

  return newTask;
}

/**
 * Get next task to work on (prioritized)
 */
export function getNextTask(agentEid: number): Task | null {
  const queue = getTaskQueue(agentEid);

  // Filter to actionable tasks
  const actionable = queue.tasks.filter(t => {
    // Not already in progress elsewhere
    if (t.status === "in_progress") return true; // Continue current task
    if (t.status !== "pending") return false;

    // Not blocked
    if (t.blockedBy && t.blockedBy.length > 0) {
      const blockers = t.blockedBy.filter(id => {
        const blocker = queue.tasks.find(bt => bt.id === id);
        return blocker && blocker.status !== "completed";
      });
      if (blockers.length > 0) return false;
    }

    return true;
  });

  if (actionable.length === 0) return null;

  // Sort by priority matrix (urgent/important)
  const priorityOrder = { urgent: 4, high: 3, medium: 2, low: 1 };
  actionable.sort((a, b) => {
    // First by explicit priority
    const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
    if (priorityDiff !== 0) return priorityDiff;

    // Then by urgency (deadline proximity)
    const now = Date.now();
    const aUrgency = a.deadline ? 1 / Math.max(1, (a.deadline - now) / (1000 * 60 * 60)) : a.urgency;
    const bUrgency = b.deadline ? 1 / Math.max(1, (b.deadline - now) / (1000 * 60 * 60)) : b.urgency;
    const urgencyDiff = bUrgency - aUrgency;
    if (Math.abs(urgencyDiff) > 0.1) return urgencyDiff;

    // Then by importance
    return b.importance - a.importance;
  });

  // Prefer task already in progress
  const inProgress = actionable.find(t => t.status === "in_progress");
  if (inProgress) return inProgress;

  return actionable[0];
}

/**
 * Start working on a task
 */
export function startTask(agentEid: number, taskId: string): Task | null {
  const queue = getTaskQueue(agentEid);
  const task = queue.tasks.find(t => t.id === taskId);

  if (!task) return null;
  if (task.status !== "pending") return task;

  task.status = "in_progress";
  task.startedAt = Date.now();
  task.updatedAt = Date.now();

  console.log(`[TaskQueue] Agent ${agentEid} started: ${task.title}`);

  return task;
}

/**
 * Update task progress
 */
export function updateTaskProgress(
  agentEid: number,
  taskId: string,
  progress: number,
  note?: string
): Task | null {
  const queue = getTaskQueue(agentEid);
  const task = queue.tasks.find(t => t.id === taskId);

  if (!task) return null;

  task.progress = Math.min(100, Math.max(0, progress));
  task.updatedAt = Date.now();

  if (note) {
    task.notes.push(`[${new Date().toLocaleTimeString()}] ${note}`);
  }

  return task;
}

/**
 * Complete a subtask
 */
export function completeSubtask(
  agentEid: number,
  taskId: string,
  subtaskId: string,
  result?: string
): Task | null {
  const queue = getTaskQueue(agentEid);
  const task = queue.tasks.find(t => t.id === taskId);

  if (!task || !task.subtasks) return null;

  const subtask = task.subtasks.find(st => st.id === subtaskId);
  if (!subtask) return null;

  subtask.completed = true;
  subtask.result = result;

  // Update progress based on subtasks
  const completedCount = task.subtasks.filter(st => st.completed).length;
  task.progress = Math.round((completedCount / task.subtasks.length) * 100);
  task.updatedAt = Date.now();

  return task;
}

/**
 * Complete a task
 */
export function completeTask(
  agentEid: number,
  taskId: string,
  result: string,
  lessonsLearned?: string
): Task | null {
  const queue = getTaskQueue(agentEid);
  const taskIndex = queue.tasks.findIndex(t => t.id === taskId);

  if (taskIndex === -1) return null;

  const task = queue.tasks[taskIndex];
  task.status = "completed";
  task.progress = 100;
  task.completedAt = Date.now();
  task.updatedAt = Date.now();
  task.result = result;
  task.lessonsLearned = lessonsLearned;

  if (task.startedAt) {
    task.actualDuration = (task.completedAt - task.startedAt) / (1000 * 60); // minutes
  }

  // Update stats
  queue.stats.tasksCompleted++;
  if (task.actualDuration) {
    queue.stats.totalTimeSpent += task.actualDuration;
    queue.stats.averageCompletionTime =
      queue.stats.totalTimeSpent / queue.stats.tasksCompleted;
  }

  // Move to completed
  queue.tasks.splice(taskIndex, 1);
  queue.completedTasks.unshift(task);

  // Trim history
  if (queue.completedTasks.length > queue.maxCompletedHistory) {
    queue.completedTasks = queue.completedTasks.slice(0, queue.maxCompletedHistory);
  }

  // Unblock dependent tasks
  if (task.blocks) {
    for (const blockedId of task.blocks) {
      const blocked = queue.tasks.find(t => t.id === blockedId);
      if (blocked && blocked.blockedBy) {
        blocked.blockedBy = blocked.blockedBy.filter(id => id !== taskId);
        if (blocked.blockedBy.length === 0 && blocked.status === "blocked") {
          blocked.status = "pending";
        }
      }
    }
  }

  console.log(`[TaskQueue] Agent ${agentEid} completed: ${task.title}`);

  return task;
}

/**
 * Fail a task
 */
export function failTask(
  agentEid: number,
  taskId: string,
  reason: string
): Task | null {
  const queue = getTaskQueue(agentEid);
  const taskIndex = queue.tasks.findIndex(t => t.id === taskId);

  if (taskIndex === -1) return null;

  const task = queue.tasks[taskIndex];
  task.status = "failed";
  task.completedAt = Date.now();
  task.updatedAt = Date.now();
  task.result = `FAILED: ${reason}`;

  queue.stats.tasksFailed++;

  // Move to completed
  queue.tasks.splice(taskIndex, 1);
  queue.completedTasks.unshift(task);

  // Mark dependent tasks as blocked
  if (task.blocks) {
    for (const blockedId of task.blocks) {
      const blocked = queue.tasks.find(t => t.id === blockedId);
      if (blocked) {
        blocked.status = "blocked";
        blocked.notes.push(`Blocked: dependency ${task.title} failed`);
      }
    }
  }

  console.log(`[TaskQueue] Agent ${agentEid} failed: ${task.title} - ${reason}`);

  return task;
}

/**
 * Delegate task to another agent
 */
export function delegateTask(
  fromAgentEid: number,
  taskId: string,
  toAgentEid: number
): Task | null {
  const fromQueue = getTaskQueue(fromAgentEid);
  const taskIndex = fromQueue.tasks.findIndex(t => t.id === taskId);

  if (taskIndex === -1) return null;

  const task = fromQueue.tasks[taskIndex];
  task.status = "delegated";
  task.delegatedTo = toAgentEid;
  task.updatedAt = Date.now();

  // Remove from original queue
  fromQueue.tasks.splice(taskIndex, 1);

  // Add to new agent's queue
  const toQueue = getTaskQueue(toAgentEid);
  const delegatedTask: Task = {
    ...task,
    id: `task_${++taskIdCounter}_${Date.now()}`, // New ID
    status: "pending",
    assignedBy: `Agent ${fromAgentEid}`,
    assignedTo: toAgentEid,
    notes: [...task.notes, `Delegated from Agent ${fromAgentEid}`],
  };

  toQueue.tasks.push(delegatedTask);
  toQueue.stats.tasksCreated++;

  console.log(`[TaskQueue] Task delegated from ${fromAgentEid} to ${toAgentEid}: ${task.title}`);

  return delegatedTask;
}

// =============================================================================
// TASK GENERATION
// =============================================================================

/**
 * Generate tasks from a goal
 */
export async function generateTasksFromGoal(
  agentEid: number,
  goal: string,
  agentContext: string,
  maxTasks: number = 5
): Promise<Task[]> {
  const model = google("gemini-2.0-flash");

  const response = await generateObject({
    model,
    schema: z.object({
      tasks: z.array(z.object({
        title: z.string(),
        description: z.string(),
        type: z.enum(["action", "research", "communication", "creation", "maintenance"]),
        priority: z.enum(["urgent", "high", "medium", "low"]),
        estimatedDuration: z.number().describe("Estimated minutes"),
        dependencies: z.array(z.number()).describe("Indices of tasks this depends on"),
        subtasks: z.array(z.string()).optional(),
      })).max(maxTasks),
    }),
    prompt: `Break down this goal into actionable tasks:

Goal: ${goal}

Agent Context:
${agentContext}

Create ${maxTasks} or fewer concrete, actionable tasks.
Order them logically and specify dependencies.
Each task should be completable in a single work session.`,
  });

  const createdTasks: Task[] = [];
  const taskIdMap = new Map<number, string>();

  for (let i = 0; i < response.object.tasks.length; i++) {
    const taskDef = response.object.tasks[i];

    // Resolve dependencies
    const blockedBy: string[] = [];
    for (const depIndex of taskDef.dependencies) {
      const depId = taskIdMap.get(depIndex);
      if (depId) blockedBy.push(depId);
    }

    const task = createTask(agentEid, {
      title: taskDef.title,
      description: taskDef.description,
      type: taskDef.type,
      priority: taskDef.priority,
      importance: taskDef.priority === "urgent" ? 0.9 : taskDef.priority === "high" ? 0.7 : 0.5,
      urgency: taskDef.priority === "urgent" ? 0.9 : 0.5,
      estimatedDuration: taskDef.estimatedDuration,
      blockedBy: blockedBy.length > 0 ? blockedBy : undefined,
      subtasks: taskDef.subtasks?.map(st => ({
        id: `st_${++subtaskIdCounter}`,
        title: st,
        completed: false,
      })),
    });

    createdTasks.push(task);
    taskIdMap.set(i, task.id);
  }

  return createdTasks;
}

/**
 * Auto-prioritize tasks based on context
 */
export async function autoPrioritizeTasks(
  agentEid: number,
  context: string
): Promise<void> {
  const queue = getTaskQueue(agentEid);
  const model = google("gemini-2.0-flash");

  const taskSummaries = queue.tasks
    .filter(t => t.status === "pending")
    .map(t => ({
      id: t.id,
      title: t.title,
      deadline: t.deadline,
      currentPriority: t.priority,
    }));

  if (taskSummaries.length === 0) return;

  const response = await generateObject({
    model,
    schema: z.object({
      priorities: z.array(z.object({
        taskId: z.string(),
        newPriority: z.enum(["urgent", "high", "medium", "low"]),
        reason: z.string(),
      })),
    }),
    prompt: `Re-prioritize these tasks based on the current context:

Context:
${context}

Tasks:
${taskSummaries.map(t => `- ${t.id}: ${t.title} (current: ${t.currentPriority})`).join("\n")}

Consider:
- Deadlines
- Dependencies
- Current situation
- What would have the most impact right now`,
  });

  for (const update of response.object.priorities) {
    const task = queue.tasks.find(t => t.id === update.taskId);
    if (task && task.priority !== update.newPriority) {
      task.priority = update.newPriority;
      task.notes.push(`Priority changed to ${update.newPriority}: ${update.reason}`);
      task.updatedAt = Date.now();
    }
  }
}

// =============================================================================
// CONTEXT FORMATTING
// =============================================================================

/**
 * Format task queue for agent prompt
 */
export function formatTaskQueueForPrompt(agentEid: number): string {
  const queue = getTaskQueue(agentEid);
  const lines: string[] = [];

  // Current task
  const current = queue.tasks.find(t => t.status === "in_progress");
  if (current) {
    lines.push("## Current Task");
    lines.push(`**${current.title}** [${current.progress}%]`);
    lines.push(current.description);
    if (current.subtasks) {
      const completed = current.subtasks.filter(st => st.completed).length;
      lines.push(`Subtasks: ${completed}/${current.subtasks.length}`);
      const next = current.subtasks.find(st => !st.completed);
      if (next) lines.push(`Next: ${next.title}`);
    }
    lines.push("");
  }

  // Upcoming tasks
  const pending = queue.tasks
    .filter(t => t.status === "pending")
    .sort((a, b) => {
      const priorityOrder = { urgent: 4, high: 3, medium: 2, low: 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    })
    .slice(0, 5);

  if (pending.length > 0) {
    lines.push("## Task Queue");
    for (const task of pending) {
      const deadline = task.deadline
        ? ` (due: ${new Date(task.deadline).toLocaleDateString()})`
        : "";
      lines.push(`- [${task.priority.toUpperCase()}] ${task.title}${deadline}`);
    }
    lines.push("");
  }

  // Blocked tasks
  const blocked = queue.tasks.filter(t => t.status === "blocked");
  if (blocked.length > 0) {
    lines.push("## Blocked Tasks");
    for (const task of blocked.slice(0, 3)) {
      lines.push(`- ${task.title} (waiting on dependencies)`);
    }
    lines.push("");
  }

  // Recent completions
  const recent = queue.completedTasks.slice(0, 3);
  if (recent.length > 0) {
    lines.push("## Recently Completed");
    for (const task of recent) {
      lines.push(`- ✓ ${task.title}`);
    }
  }

  return lines.join("\n");
}

// =============================================================================
// STATISTICS & REPORTING
// =============================================================================

export function getTaskQueueSummary(agentEid: number): string {
  const queue = getTaskQueue(agentEid);

  const pending = queue.tasks.filter(t => t.status === "pending").length;
  const inProgress = queue.tasks.filter(t => t.status === "in_progress").length;
  const blocked = queue.tasks.filter(t => t.status === "blocked").length;

  const urgent = queue.tasks.filter(t => t.priority === "urgent" && t.status !== "completed").length;
  const overdue = queue.tasks.filter(t => t.deadline && t.deadline < Date.now() && t.status !== "completed").length;

  return `Task Queue (Agent ${agentEid}):
- In Progress: ${inProgress}
- Pending: ${pending}
- Blocked: ${blocked}
- Urgent: ${urgent}
- Overdue: ${overdue}

Stats:
- Created: ${queue.stats.tasksCreated}
- Completed: ${queue.stats.tasksCompleted}
- Failed: ${queue.stats.tasksFailed}
- Avg Completion: ${queue.stats.averageCompletionTime.toFixed(1)} min`;
}

/**
 * Check for overdue tasks and update priorities
 */
export function checkDeadlines(agentEid: number): Task[] {
  const queue = getTaskQueue(agentEid);
  const now = Date.now();
  const overdue: Task[] = [];

  for (const task of queue.tasks) {
    if (task.deadline && task.deadline < now && task.status !== "completed") {
      if (task.priority !== "urgent") {
        task.priority = "urgent";
        task.notes.push(`[${new Date().toLocaleTimeString()}] OVERDUE - Priority escalated`);
        task.updatedAt = now;
      }
      overdue.push(task);
    }
  }

  return overdue;
}
