/**
 * Daily Planning System
 *
 * Based on the Generative Agents paper (Park et al., 2023)
 *
 * Each agent:
 * 1. Wakes up with intentions for the day
 * 2. Creates a time-blocked schedule
 * 3. Adapts the schedule as events happen
 * 4. Reflects on the day before sleep
 *
 * This creates more believable, routine-based behavior while
 * still allowing for spontaneous changes.
 */

import { generateText } from "ai";
import type { World } from "../ecs/world";
import { query, entityExists, hasComponent } from "bitecs";
import { Agent, Mind, Name, Goal, Schedule, ScheduledActivity } from "../ecs/components";
import { HasGoal } from "../ecs/relations";
import { safeGetRelationTargets } from "../ecs/dynamic-systems";
import { daemonModel } from "../llm/config";
import type { GlobalSimulationState } from "./global-state";

// =============================================================================
// TYPES
// =============================================================================

export interface DailyPlan {
  agentEid: number;
  agentName: string;

  /** Simulation date this plan is for */
  simDate: Date;

  /** High-level intentions for the day */
  intentions: string[];

  /** Time-blocked schedule */
  schedule: ScheduleBlock[];

  /** Current block index */
  currentBlockIndex: number;

  /** Daily priorities (from goals) */
  priorities: Priority[];

  /** How willing the agent is to deviate (0-1) */
  flexibility: number;

  /** Deviations that have occurred */
  deviations: Deviation[];

  /** Whether the day has been reflected on */
  reflected: boolean;

  /** When this plan was created */
  createdAt: number;
}

export interface ScheduleBlock {
  id: string;
  startHour: number;     // 0-23
  endHour: number;       // 0-23
  activity: string;      // What they plan to do
  location?: string;     // Where they plan to do it
  withAgent?: string;    // Who they plan to do it with (name)
  priority: "low" | "medium" | "high" | "critical";
  flexible: boolean;     // Can this be interrupted/moved?
  status: "pending" | "active" | "completed" | "skipped" | "interrupted";
  actualStart?: number;  // When it actually started
  actualEnd?: number;    // When it actually ended
  notes?: string;        // What actually happened
}

export interface Priority {
  goalDescription: string;
  importance: number;    // 0-1
  timeRequired: number;  // Hours estimate
  mustComplete: boolean; // Deadline today?
}

export interface Deviation {
  timestamp: number;
  originalActivity: string;
  newActivity: string;
  reason: string;
  voluntary: boolean;    // Did they choose to deviate or was it forced?
}

// =============================================================================
// PLAN STORAGE
// =============================================================================

// Store daily plans by agent EID
const dailyPlans = new Map<number, DailyPlan>();

/**
 * Get an agent's current daily plan
 */
export function getDailyPlan(agentEid: number): DailyPlan | undefined {
  return dailyPlans.get(agentEid);
}

/**
 * Check if an agent has a plan for today
 */
export function hasPlanForToday(agentEid: number, simDate: Date): boolean {
  const plan = dailyPlans.get(agentEid);
  if (!plan) return false;

  // Check if plan is for the same day
  return plan.simDate.toDateString() === simDate.toDateString();
}

// =============================================================================
// SCHEDULE TEMPLATES
// =============================================================================

/**
 * Default schedule templates based on agent role
 */
const SCHEDULE_TEMPLATES: Record<string, Partial<ScheduleBlock>[]> = {
  farmer: [
    { startHour: 5, endHour: 6, activity: "Wake up, breakfast", priority: "medium", flexible: false },
    { startHour: 6, endHour: 12, activity: "Work in the fields", priority: "high", flexible: false },
    { startHour: 12, endHour: 13, activity: "Midday meal and rest", priority: "medium", flexible: true },
    { startHour: 13, endHour: 17, activity: "Continue farm work", priority: "high", flexible: false },
    { startHour: 17, endHour: 18, activity: "Tend to animals", priority: "high", flexible: false },
    { startHour: 18, endHour: 20, activity: "Evening meal, socialize", priority: "medium", flexible: true },
    { startHour: 20, endHour: 22, activity: "Leisure time", priority: "low", flexible: true },
    { startHour: 22, endHour: 5, activity: "Sleep", priority: "critical", flexible: false },
  ],
  merchant: [
    { startHour: 6, endHour: 7, activity: "Wake up, prepare for day", priority: "medium", flexible: false },
    { startHour: 7, endHour: 8, activity: "Open shop, arrange goods", priority: "high", flexible: false },
    { startHour: 8, endHour: 12, activity: "Sell goods, negotiate", priority: "high", flexible: false },
    { startHour: 12, endHour: 13, activity: "Lunch break", priority: "medium", flexible: true },
    { startHour: 13, endHour: 18, activity: "Continue business", priority: "high", flexible: false },
    { startHour: 18, endHour: 19, activity: "Close shop, count earnings", priority: "high", flexible: false },
    { startHour: 19, endHour: 21, activity: "Dinner, socialize at tavern", priority: "medium", flexible: true },
    { startHour: 21, endHour: 22, activity: "Plan tomorrow's inventory", priority: "medium", flexible: true },
    { startHour: 22, endHour: 6, activity: "Sleep", priority: "critical", flexible: false },
  ],
  guard: [
    { startHour: 6, endHour: 7, activity: "Wake up, gear up", priority: "high", flexible: false },
    { startHour: 7, endHour: 13, activity: "Morning patrol/watch", priority: "critical", flexible: false },
    { startHour: 13, endHour: 14, activity: "Meal break", priority: "medium", flexible: true },
    { startHour: 14, endHour: 20, activity: "Afternoon duties", priority: "critical", flexible: false },
    { startHour: 20, endHour: 22, activity: "Off duty, personal time", priority: "low", flexible: true },
    { startHour: 22, endHour: 6, activity: "Sleep", priority: "critical", flexible: false },
  ],
  innkeeper: [
    { startHour: 5, endHour: 7, activity: "Prepare breakfast, clean", priority: "high", flexible: false },
    { startHour: 7, endHour: 10, activity: "Serve breakfast, manage guests", priority: "high", flexible: false },
    { startHour: 10, endHour: 12, activity: "Manage supplies, bookkeeping", priority: "medium", flexible: true },
    { startHour: 12, endHour: 14, activity: "Lunch service", priority: "high", flexible: false },
    { startHour: 14, endHour: 17, activity: "Rest, minor tasks", priority: "low", flexible: true },
    { startHour: 17, endHour: 23, activity: "Evening service, tavern busy", priority: "critical", flexible: false },
    { startHour: 23, endHour: 5, activity: "Sleep", priority: "critical", flexible: false },
  ],
  default: [
    { startHour: 7, endHour: 8, activity: "Wake up, morning routine", priority: "medium", flexible: true },
    { startHour: 8, endHour: 12, activity: "Morning activities", priority: "medium", flexible: true },
    { startHour: 12, endHour: 13, activity: "Midday meal", priority: "medium", flexible: true },
    { startHour: 13, endHour: 18, activity: "Afternoon activities", priority: "medium", flexible: true },
    { startHour: 18, endHour: 20, activity: "Evening meal", priority: "medium", flexible: true },
    { startHour: 20, endHour: 22, activity: "Leisure", priority: "low", flexible: true },
    { startHour: 22, endHour: 7, activity: "Sleep", priority: "high", flexible: false },
  ],
};

// =============================================================================
// PLAN GENERATION
// =============================================================================

/**
 * Generate a daily plan for an agent
 */
export async function generateDailyPlan(
  world: World,
  agentEid: number,
  globalState: GlobalSimulationState
): Promise<DailyPlan | null> {
  if (!entityExists(world, agentEid)) return null;

  const agentName = Name.value[agentEid] || `Agent_${agentEid}`;
  const agentRole = Agent.role[agentEid] || "villager";
  const simDate = globalState.time.simTime;

  // Get agent's goals
  const goalEids = safeGetRelationTargets(world, agentEid, HasGoal);
  const priorities: Priority[] = goalEids.map(geid => ({
    goalDescription: Goal.description[geid] || "Unknown goal",
    importance: (Goal.priority[geid] || 5) / 10,
    timeRequired: 2, // Default estimate
    mustComplete: Goal.deadline[geid] ? Goal.deadline[geid] < simDate.getTime() + 86400000 : false,
  }));

  // Get base schedule template
  const roleKey = agentRole.toLowerCase();
  const template = SCHEDULE_TEMPLATES[roleKey] || SCHEDULE_TEMPLATES.default;

  // Create schedule blocks from template
  const schedule: ScheduleBlock[] = template.map((block, i) => ({
    id: `${agentEid}_${simDate.toDateString()}_${i}`,
    startHour: block.startHour!,
    endHour: block.endHour!,
    activity: block.activity!,
    priority: block.priority as ScheduleBlock["priority"] || "medium",
    flexible: block.flexible ?? true,
    status: "pending" as const,
  }));

  // Determine flexibility based on personality and global state
  const baseFlexibility = 0.5;
  const tensionModifier = globalState.mood.tension * -0.3; // Higher tension = less flexible
  const routineModifier = globalState.preset.routineStrength * -0.2; // Higher routine = less flexible
  const flexibility = Math.max(0.1, Math.min(0.9, baseFlexibility + tensionModifier + routineModifier));

  // Generate intentions using AI (if we want personalized plans)
  let intentions: string[] = [];
  try {
    const result = await generateText({
      model: daemonModel,
      prompt: `You are ${agentName}, a ${agentRole}.

Today's date in the simulation: ${simDate.toLocaleDateString()}
Current atmosphere: ${globalState.mood.atmosphere}
Global tension: ${(globalState.mood.tension * 100).toFixed(0)}%

Your goals:
${priorities.map(p => `- ${p.goalDescription} (importance: ${(p.importance * 100).toFixed(0)}%)`).join("\n") || "- Live your daily life"}

Based on your role and goals, what are your 3-5 main intentions for today?
Be specific but brief. Consider the atmosphere.

Respond with a JSON array of strings:
["intention 1", "intention 2", "intention 3"]`,
      maxTokens: 200,
    });

    const cleaned = result.text.trim().replace(/```json\n?|\n?```/g, "");
    intentions = JSON.parse(cleaned);
  } catch (error) {
    // Fallback intentions
    intentions = [
      `Complete ${agentRole} duties`,
      "Maintain relationships",
      "Take care of personal needs",
    ];
  }

  const plan: DailyPlan = {
    agentEid,
    agentName,
    simDate,
    intentions,
    schedule,
    currentBlockIndex: 0,
    priorities,
    flexibility,
    deviations: [],
    reflected: false,
    createdAt: Date.now(),
  };

  // Store the plan
  dailyPlans.set(agentEid, plan);

  return plan;
}

/**
 * Get the current scheduled activity for an agent
 */
export function getCurrentScheduledActivity(
  plan: DailyPlan,
  currentHour: number
): ScheduleBlock | null {
  for (let i = 0; i < plan.schedule.length; i++) {
    const block = plan.schedule[i];

    // Handle overnight blocks (e.g., sleep from 22 to 6)
    if (block.startHour > block.endHour) {
      if (currentHour >= block.startHour || currentHour < block.endHour) {
        plan.currentBlockIndex = i;
        return block;
      }
    } else {
      if (currentHour >= block.startHour && currentHour < block.endHour) {
        plan.currentBlockIndex = i;
        return block;
      }
    }
  }

  return null;
}

/**
 * Check if an agent should be doing something different than their plan
 */
export function checkForDeviation(
  plan: DailyPlan,
  currentActivity: string,
  currentHour: number
): { shouldDeviate: boolean; reason?: string } {
  const scheduledBlock = getCurrentScheduledActivity(plan, currentHour);

  if (!scheduledBlock) {
    return { shouldDeviate: false };
  }

  // Already doing the scheduled activity (fuzzy match)
  if (currentActivity.toLowerCase().includes(scheduledBlock.activity.toLowerCase().slice(0, 10))) {
    return { shouldDeviate: false };
  }

  // Not doing scheduled activity
  if (scheduledBlock.flexible) {
    return { shouldDeviate: false }; // Flexible blocks can be skipped
  }

  if (scheduledBlock.priority === "critical") {
    return {
      shouldDeviate: true,
      reason: `Should be: ${scheduledBlock.activity} (critical)`,
    };
  }

  if (scheduledBlock.priority === "high" && Math.random() > plan.flexibility) {
    return {
      shouldDeviate: true,
      reason: `Should be: ${scheduledBlock.activity} (high priority)`,
    };
  }

  return { shouldDeviate: false };
}

/**
 * Record a deviation from the plan
 */
export function recordDeviation(
  plan: DailyPlan,
  originalActivity: string,
  newActivity: string,
  reason: string,
  voluntary: boolean
): void {
  plan.deviations.push({
    timestamp: Date.now(),
    originalActivity,
    newActivity,
    reason,
    voluntary,
  });

  // Update the current block status
  const currentBlock = plan.schedule[plan.currentBlockIndex];
  if (currentBlock && currentBlock.status === "active") {
    currentBlock.status = "interrupted";
    currentBlock.notes = reason;
  }
}

/**
 * Start a scheduled activity
 */
export function startScheduledActivity(plan: DailyPlan, blockIndex: number): void {
  const block = plan.schedule[blockIndex];
  if (block) {
    block.status = "active";
    block.actualStart = Date.now();
  }
}

/**
 * Complete a scheduled activity
 */
export function completeScheduledActivity(plan: DailyPlan, blockIndex: number, notes?: string): void {
  const block = plan.schedule[blockIndex];
  if (block) {
    block.status = "completed";
    block.actualEnd = Date.now();
    if (notes) block.notes = notes;
  }
}

/**
 * Skip a scheduled activity
 */
export function skipScheduledActivity(plan: DailyPlan, blockIndex: number, reason: string): void {
  const block = plan.schedule[blockIndex];
  if (block) {
    block.status = "skipped";
    block.notes = reason;
  }
}

/**
 * Update the plan based on a significant event
 */
export function adaptPlanToEvent(
  plan: DailyPlan,
  event: string,
  urgency: "low" | "medium" | "high" | "critical"
): { adapted: boolean; changes: string[] } {
  const changes: string[] = [];

  if (urgency === "low" && Math.random() > plan.flexibility) {
    return { adapted: false, changes: [] };
  }

  // Find flexible blocks that can be modified
  const currentIdx = plan.currentBlockIndex;
  const remainingBlocks = plan.schedule.slice(currentIdx + 1);
  const flexibleBlocks = remainingBlocks.filter(b => b.flexible && b.status === "pending");

  if (urgency === "critical") {
    // Critical events interrupt everything
    const currentBlock = plan.schedule[currentIdx];
    if (currentBlock && currentBlock.status === "active") {
      currentBlock.status = "interrupted";
      currentBlock.notes = `Interrupted by: ${event}`;
      changes.push(`Interrupted "${currentBlock.activity}"`);
    }

    // Mark next few blocks as potentially affected
    for (let i = 0; i < Math.min(3, flexibleBlocks.length); i++) {
      flexibleBlocks[i].notes = `May be affected by: ${event}`;
      changes.push(`"${flexibleBlocks[i].activity}" may be affected`);
    }
  } else if (urgency === "high" || urgency === "medium") {
    // Modify flexible blocks
    if (flexibleBlocks.length > 0) {
      const blockToModify = flexibleBlocks[0];
      const oldActivity = blockToModify.activity;
      blockToModify.activity = `Deal with: ${event}`;
      blockToModify.notes = `Changed from: ${oldActivity}`;
      changes.push(`Changed "${oldActivity}" to address ${event}`);
    }
  }

  return { adapted: changes.length > 0, changes };
}

/**
 * Get a summary of the day's plan for display
 */
export function getPlanSummary(plan: DailyPlan): string {
  const lines: string[] = [
    `=== ${plan.agentName}'s Daily Plan ===`,
    `Date: ${plan.simDate.toLocaleDateString()}`,
    `Flexibility: ${(plan.flexibility * 100).toFixed(0)}%`,
    ``,
    `Intentions:`,
    ...plan.intentions.map(i => `  - ${i}`),
    ``,
    `Schedule:`,
  ];

  for (const block of plan.schedule) {
    const timeStr = `${block.startHour.toString().padStart(2, "0")}:00-${block.endHour.toString().padStart(2, "0")}:00`;
    const statusIcon = {
      pending: "⏳",
      active: "▶️",
      completed: "✅",
      skipped: "⏭️",
      interrupted: "⚠️",
    }[block.status];

    lines.push(`  ${statusIcon} ${timeStr} ${block.activity} [${block.priority}]`);
    if (block.notes) {
      lines.push(`       └─ ${block.notes}`);
    }
  }

  if (plan.deviations.length > 0) {
    lines.push(``, `Deviations (${plan.deviations.length}):`);
    for (const dev of plan.deviations.slice(-5)) {
      lines.push(`  - ${dev.originalActivity} → ${dev.newActivity} (${dev.reason})`);
    }
  }

  return lines.join("\n");
}

/**
 * Clean up old plans (keep only today's)
 */
export function cleanupOldPlans(currentSimDate: Date): number {
  let removed = 0;
  const today = currentSimDate.toDateString();

  for (const [eid, plan] of dailyPlans) {
    if (plan.simDate.toDateString() !== today) {
      dailyPlans.delete(eid);
      removed++;
    }
  }

  return removed;
}

/**
 * Get all current plans (for debugging/display)
 */
export function getAllPlans(): Map<number, DailyPlan> {
  return dailyPlans;
}

// =============================================================================
// INTEGRATION WITH COGNITIVE SYSTEM
// =============================================================================

/**
 * Generate a context string about the agent's current schedule
 * This gets injected into their cognitive prompts
 */
export function getScheduleContext(agentEid: number, currentHour: number): string {
  const plan = dailyPlans.get(agentEid);
  if (!plan) return "";

  const currentBlock = getCurrentScheduledActivity(plan, currentHour);
  if (!currentBlock) return "";

  const lines = [
    `[Your Schedule]`,
    `Current time: ${currentHour}:00`,
    `You should be: ${currentBlock.activity}`,
    `Priority: ${currentBlock.priority}`,
  ];

  // Add next activity
  const nextIdx = plan.currentBlockIndex + 1;
  if (nextIdx < plan.schedule.length) {
    const nextBlock = plan.schedule[nextIdx];
    lines.push(`Next: ${nextBlock.activity} at ${nextBlock.startHour}:00`);
  }

  // Add today's intentions
  if (plan.intentions.length > 0) {
    lines.push(``, `Today's intentions:`);
    plan.intentions.forEach(i => lines.push(`  - ${i}`));
  }

  return lines.join("\n");
}

/**
 * Check if it's time for an agent to generate a new daily plan
 */
export function needsNewPlan(agentEid: number, simDate: Date, currentHour: number): boolean {
  const plan = dailyPlans.get(agentEid);

  // No plan exists
  if (!plan) return true;

  // Plan is for a different day
  if (plan.simDate.toDateString() !== simDate.toDateString()) return true;

  // It's early morning and plan hasn't been reflected on (new day)
  if (currentHour >= 5 && currentHour < 8 && !plan.reflected) {
    // This is actually still the current plan - don't regenerate
    return false;
  }

  return false;
}
