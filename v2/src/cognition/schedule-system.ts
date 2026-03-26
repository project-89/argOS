/**
 * Schedule System
 *
 * Manages time-based routines for agents, implementing the daily
 * schedule concept from the Generative Agents paper.
 *
 * Agents have schedules that define:
 * - What activities they do at different times
 * - Where they prefer to be for each activity
 * - How flexible they are about following the schedule
 *
 * The schedule influences agent behavior by:
 * - Suggesting appropriate actions for the time of day
 * - Creating goals related to scheduled activities
 * - Providing context for decision-making
 */

import { generateText } from "ai";
import { flashModel } from "../llm/config";
import type { World } from "../ecs/world";
import { addEntity, addComponent, query, getRelationTargets, hasComponent, removeEntity } from "bitecs";
import { Name, Description, Agent, Mind, Schedule, Goal, Room } from "../ecs/components";
import { HasSchedule, HasGoal } from "../ecs/relations";
import { getKnowledgeSummary } from "./knowledge-graph";

const model = flashModel;

export interface ScheduledActivity {
  name: string;
  startHour: number;       // 0-23
  duration: number;        // hours
  location?: string;       // Preferred location
  priority: number;        // 1-10
  interruptible: boolean;  // Can be interrupted for emergencies
  description?: string;    // What this activity entails
}

export interface DailySchedule {
  activities: ScheduledActivity[];
  flexibility: number;     // 0-1, how strictly to follow
  personality: string;     // Brief personality description used in generation
}

function workLocationKeywordForRole(role: string): string | undefined {
  const r = String(role || "").toLowerCase();
  // Fantasy / village archetypes
  if (r.includes("baker")) return "bakery";
  if (r.includes("smith") || r.includes("blacksmith")) return "forge";
  if (r.includes("healer") || r.includes("cleric")) return "temple";
  if (r.includes("merchant") || r.includes("trader")) return "market";
  if (r.includes("scholar") || r.includes("librarian")) return "library";
  // Office archetypes
  if (r.includes("engineer") || r.includes("developer") || r.includes("programmer")) return "office";
  if (r.includes("designer")) return "studio";
  if (r.includes("research")) return "lab";
  // Generic
  if (r.includes("npc") || r.includes("villager")) return "square";
  return "work";
}

/**
 * Get or create schedule for an agent
 */
export function getSchedule(world: World, agentEid: number): number | undefined {
  const targets = getRelationTargets(world, agentEid, HasSchedule);
  return targets.length > 0 && hasComponent(world, targets[0], Schedule) ? targets[0] : undefined;
}

/**
 * Initialize a schedule for an agent
 */
export function initializeSchedule(
  world: World,
  agentEid: number,
  activities: ScheduledActivity[],
  flexibility: number = 0.5
): number {
  // Remove existing schedule if any
  const existing = getSchedule(world, agentEid);
  if (existing) {
    removeEntity(world, existing);
  }

  const scheduleEid = addEntity(world);
  addComponent(world, scheduleEid, Schedule);
  addComponent(world, agentEid, HasSchedule(scheduleEid));

  Schedule.activities[scheduleEid] = JSON.stringify(activities);
  Schedule.currentActivity[scheduleEid] = "";
  Schedule.nextTransition[scheduleEid] = 0;
  Schedule.flexibility[scheduleEid] = flexibility;
  Schedule.plannedDay[scheduleEid] = getCurrentDay(world);
  Schedule.lastUpdated[scheduleEid] = Date.now();

  return scheduleEid;
}

/**
 * Get current simulated hour (0-23)
 * Reads from world.time.simulationHour (set by TimeProgression system)
 */
export function getCurrentHour(world: World): number {
  // Read simulation time from world context (set by TimeProgression system)
  const worldContext = world as any;
  if (worldContext.time?.simulationHour !== undefined) {
    return worldContext.time.simulationHour;
  }
  // Fallback to morning if not yet initialized
  return 8;
}

/**
 * Get current time of day string from world
 */
export function getCurrentTimeOfDay(world: World): string {
  const worldContext = world as any;
  return worldContext.time?.timeOfDay ?? "morning";
}

/**
 * Get current simulation day from world
 */
export function getCurrentDay(world: World): number {
  const worldContext = world as any;
  return worldContext.time?.simulationDay ?? 1;
}

/**
 * Get the scheduled activity for a given hour
 */
export function getActivityForHour(scheduleEid: number, hour: number): ScheduledActivity | null {
  const activitiesJson = Schedule.activities[scheduleEid];
  if (!activitiesJson) return null;

  try {
    const activities = JSON.parse(activitiesJson) as ScheduledActivity[];

    for (const activity of activities) {
      const endHour = (activity.startHour + activity.duration) % 24;

      // Handle activities that span midnight
      if (activity.startHour <= endHour) {
        // Normal case: activity doesn't span midnight
        if (hour >= activity.startHour && hour < endHour) {
          return activity;
        }
      } else {
        // Activity spans midnight (e.g., 22:00 - 06:00)
        if (hour >= activity.startHour || hour < endHour) {
          return activity;
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Get the current activity based on world time
 */
export function getCurrentActivity(world: World, agentEid: number): ScheduledActivity | null {
  const scheduleEid = getSchedule(world, agentEid);
  if (!scheduleEid) return null;

  const currentHour = getCurrentHour(world);
  return getActivityForHour(scheduleEid, currentHour);
}

/**
 * Get the next scheduled activity
 */
export function getNextActivity(world: World, agentEid: number): { activity: ScheduledActivity; hoursUntil: number } | null {
  const scheduleEid = getSchedule(world, agentEid);
  if (!scheduleEid) return null;

  const currentHour = getCurrentHour(world);
  const activitiesJson = Schedule.activities[scheduleEid];
  if (!activitiesJson) return null;

  try {
    const activities = JSON.parse(activitiesJson) as ScheduledActivity[];

    // Sort by start hour
    const sorted = [...activities].sort((a, b) => a.startHour - b.startHour);

    // Find next activity after current hour
    for (const activity of sorted) {
      if (activity.startHour > currentHour) {
        return {
          activity,
          hoursUntil: activity.startHour - currentHour,
        };
      }
    }

    // Wrap around to tomorrow
    if (sorted.length > 0) {
      const firstActivity = sorted[0];
      return {
        activity: firstActivity,
        hoursUntil: 24 - currentHour + firstActivity.startHour,
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Build context for schedule generation
 */
function buildScheduleContext(world: World, agentEid: number): string {
  const agentName = Name.value[agentEid];
  const agentDesc = Description.value[agentEid];
  const agentRole = Agent.role[agentEid];

  // Get available rooms
  const rooms = Array.from(query(world, [Room]));
  const roomNames = rooms.map(eid => Name.value[eid]).filter(Boolean);

  // Get knowledge for context
  const knowledge = getKnowledgeSummary(world, agentEid);

  return `You are generating a daily schedule for an agent in a simulation.

AGENT:
- Name: ${agentName}
- Description: ${agentDesc}
- Role: ${agentRole}

${knowledge ? `AGENT'S KNOWLEDGE:\n${knowledge}` : ""}

AVAILABLE LOCATIONS:
${roomNames.length > 0 ? roomNames.join(", ") : "Various locations"}

Create a realistic daily schedule that fits this character's personality and role.`;
}

/**
 * Generate a schedule using LLM based on agent personality
 */
export async function generateSchedule(world: World, agentEid: number): Promise<DailySchedule | null> {
  const context = buildScheduleContext(world, agentEid);
  const agentName = Name.value[agentEid];
  const agentRole = Agent.role[agentEid];

  const prompt = `Create a realistic daily schedule for this agent.

The schedule should:
1. Reflect the agent's personality and role
2. Include 5-8 activities spanning the full 24 hours
3. Include basic needs (sleep, eating) and role-specific activities
4. Assign appropriate locations when known

Respond with JSON only:
{
  "activities": [
    {
      "name": "Activity name",
      "startHour": 6,
      "duration": 2,
      "location": "optional location name",
      "priority": 5,
      "interruptible": true,
      "description": "Brief description of what this entails"
    }
  ],
  "flexibility": 0.5,
  "personality": "Brief summary of scheduling personality"
}

Hours are 0-23. Duration is in hours. Priority is 1-10.`;

  try {
    const { text } = await generateText({
      model,
      system: context,
      prompt,
    });

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[Schedule] Failed to parse schedule JSON");
      return null;
    }

    const raw = JSON.parse(jsonMatch[0]) as Partial<DailySchedule>;

    const cleaned: ScheduledActivity[] = Array.isArray(raw.activities)
      ? raw.activities
          .map((a: any): ScheduledActivity | null => {
            if (!a || typeof a !== "object") return null;
            const name = String(a.name || "").trim();
            const startHour = Number(a.startHour);
            const duration = Number(a.duration);
            if (!name) return null;
            if (!Number.isFinite(startHour) || startHour < 0 || startHour > 23) return null;
            if (!Number.isFinite(duration) || duration <= 0 || duration > 24) return null;
            const priority = Number.isFinite(Number(a.priority)) ? Math.max(1, Math.min(10, Number(a.priority))) : 5;
            const interruptible = a.interruptible === false ? false : true;
            const location = typeof a.location === "string" && a.location.trim().length > 0 ? a.location.trim() : undefined;
            const description = typeof a.description === "string" ? a.description : undefined;
            return { name, startHour: Math.floor(startHour), duration: Math.floor(duration), priority, interruptible, ...(location ? { location } : {}), ...(description ? { description } : {}) };
          })
          .filter((x: ScheduledActivity | null): x is ScheduledActivity => x !== null)
      : [];

    // Normalize to contract: 5–8 activities.
    cleaned.sort((a, b) => a.startHour - b.startHour);
    let activities = cleaned.slice(0, 8);
    if (activities.length < 5) {
      const defaults = createDefaultSchedule(agentRole);
      const existing = new Set(activities.map((a) => a.name));
      for (const d of defaults) {
        if (activities.length >= 5) break;
        if (existing.has(d.name)) continue;
        activities.push(d);
        existing.add(d.name);
      }
      activities.sort((a, b) => a.startHour - b.startHour);
      activities = activities.slice(0, 8);
    }

    const flexibilityRaw = Number((raw as any).flexibility);
    const flexibility = Number.isFinite(flexibilityRaw) ? Math.max(0, Math.min(1, flexibilityRaw)) : 0.5;
    const personality = typeof (raw as any).personality === "string" ? (raw as any).personality : "";

    console.log(`[Schedule] Generated ${activities.length}-activity schedule for ${agentName}`);
    return { activities, flexibility, personality };
  } catch (error) {
    console.error("[Schedule] Error generating schedule:", error);
    return null;
  }
}

/**
 * Create a default schedule for an agent (without LLM)
 */
export function createDefaultSchedule(agentRole: string): ScheduledActivity[] {
  const workLoc = workLocationKeywordForRole(agentRole);
  const baseSchedule: ScheduledActivity[] = [
    {
      name: "sleep",
      startHour: 22,
      duration: 8,
      priority: 9,
      interruptible: false,
      location: "home",
      description: "Resting and recovering energy",
    },
    {
      name: "morning_routine",
      startHour: 6,
      duration: 1,
      priority: 7,
      interruptible: true,
      location: "home",
      description: "Waking up and preparing for the day",
    },
    {
      name: "breakfast",
      startHour: 7,
      duration: 1,
      priority: 6,
      interruptible: true,
      location: "tavern",
      description: "Eating the first meal of the day",
    },
    {
      name: "work",
      startHour: 8,
      duration: 4,
      priority: 8,
      interruptible: true,
      ...(workLoc ? { location: workLoc } : {}),
      description: "Primary daily activities and responsibilities",
    },
    {
      name: "lunch",
      startHour: 12,
      duration: 1,
      priority: 6,
      interruptible: true,
      location: "tavern",
      description: "Midday meal and break",
    },
    {
      name: "afternoon_work",
      startHour: 13,
      duration: 4,
      priority: 7,
      interruptible: true,
      ...(workLoc ? { location: workLoc } : {}),
      description: "Continuing daily activities",
    },
    {
      name: "leisure",
      startHour: 17,
      duration: 3,
      priority: 4,
      interruptible: true,
      location: "square",
      description: "Personal time and relaxation",
    },
    {
      name: "dinner",
      startHour: 20,
      duration: 1,
      priority: 6,
      interruptible: true,
      location: "tavern",
      description: "Evening meal",
    },
    {
      name: "evening_routine",
      startHour: 21,
      duration: 1,
      priority: 5,
      interruptible: true,
      location: "home",
      description: "Winding down before bed",
    },
  ];

  return baseSchedule;
}

/**
 * Run the schedule system - update current activities and suggest goals
 */
export function runScheduleSystem(world: World): void {
  const agents = query(world, [Agent, Mind]);
  const currentHour = getCurrentHour(world);

  for (const agentEid of agents) {
    if (!Agent.active[agentEid]) continue;

    const scheduleEid = getSchedule(world, agentEid);
    if (!scheduleEid) continue;

    const currentActivity = getActivityForHour(scheduleEid, currentHour);
    const storedActivity = Schedule.currentActivity[scheduleEid];

    // Check if activity changed
    if (currentActivity && currentActivity.name !== storedActivity) {
      Schedule.currentActivity[scheduleEid] = currentActivity.name;

      const agentName = Name.value[agentEid];
      console.log(`[Schedule] ${agentName}'s activity changed to: ${currentActivity.name}`);

      // Could create a goal for this activity if desired
      // createActivityGoal(world, agentEid, currentActivity);
    }
  }
}

/**
 * Format schedule for inclusion in agent context
 */
export function formatScheduleForContext(world: World, agentEid: number): string {
  const scheduleEid = getSchedule(world, agentEid);
  if (!scheduleEid) return "";

  const currentHour = getCurrentHour(world);
  const currentActivity = getActivityForHour(scheduleEid, currentHour);
  const nextInfo = getNextActivity(world, agentEid);

  const lines: string[] = ["DAILY SCHEDULE:"];

  if (currentActivity) {
    lines.push(`Current time: ${currentHour}:00`);
    lines.push(`Current activity: ${currentActivity.name}${currentActivity.description ? ` - ${currentActivity.description}` : ""}`);

    if (currentActivity.location) {
      lines.push(`Preferred location: ${currentActivity.location}`);
    }
  }

  if (nextInfo) {
    lines.push(`Next: ${nextInfo.activity.name} in ${nextInfo.hoursUntil} hour(s)`);
  }

  return lines.join("\n");
}

/**
 * Check if current activity allows interruption
 */
export function canInterruptCurrentActivity(world: World, agentEid: number): boolean {
  const currentActivity = getCurrentActivity(world, agentEid);
  if (!currentActivity) return true;

  return currentActivity.interruptible;
}

/**
 * Get schedule flexibility (how strictly agent follows schedule)
 */
export function getScheduleFlexibility(world: World, agentEid: number): number {
  const scheduleEid = getSchedule(world, agentEid);
  if (!scheduleEid) return 1.0; // No schedule = fully flexible

  return Schedule.flexibility[scheduleEid] ?? 0.5;
}

/**
 * Initialize schedules for all agents that don't have one
 */
export async function initializeAllSchedules(world: World, useLLM: boolean = false): Promise<void> {
  const agents = query(world, [Agent, Mind]);

  for (const agentEid of agents) {
    if (!Agent.active[agentEid]) continue;

    const existing = getSchedule(world, agentEid);
    if (existing) continue;

    const agentName = Name.value[agentEid];
    const agentRole = Agent.role[agentEid];

    if (useLLM) {
      console.log(`[Schedule] Generating schedule for ${agentName}...`);
      const generated = await generateSchedule(world, agentEid);
      if (generated) {
        initializeSchedule(world, agentEid, generated.activities, generated.flexibility);
      } else {
        // Fallback to default
        const defaultActivities = createDefaultSchedule(agentRole);
        initializeSchedule(world, agentEid, defaultActivities, 0.5);
      }
    } else {
      // Use default schedule
      const defaultActivities = createDefaultSchedule(agentRole);
      initializeSchedule(world, agentEid, defaultActivities, 0.5);
      console.log(`[Schedule] Created default schedule for ${agentName}`);
    }
  }
}

/**
 * Ensure every active agent has a schedule planned for the current simulation day.
 *
 * - If an agent has no schedule: create one (default or LLM).
 * - If an agent's schedule is for a previous day: regenerate it.
 * - Optional throttling via `maxAgents` to avoid bursting LLM calls.
 */
export async function ensureSchedulesForCurrentDay(
  world: World,
  opts: { useLLM?: boolean; maxAgents?: number } = {}
): Promise<{ processed: number; created: number; regenerated: number }> {
  const useLLM = opts.useLLM === true;
  const maxAgents = Number.isFinite(opts.maxAgents) ? Math.max(1, Math.floor(opts.maxAgents!)) : Infinity;
  const currentDay = getCurrentDay(world);

  const agents = query(world, [Agent, Mind]);
  let processed = 0;
  let created = 0;
  let regenerated = 0;

  for (const agentEid of agents) {
    if (!Agent.active[agentEid]) continue;
    if (processed >= maxAgents) break;

    const scheduleEid = getSchedule(world, agentEid);
    const needsNew = scheduleEid === undefined;
    const plannedDay = scheduleEid !== undefined ? Schedule.plannedDay[scheduleEid] : undefined;
    const needsRegen = scheduleEid !== undefined && plannedDay !== undefined && plannedDay !== currentDay;

    if (!needsNew && !needsRegen) continue;

    const agentName = Name.value[agentEid] || `Agent_${agentEid}`;
    const agentRole = Agent.role[agentEid] || "agent";

    processed++;

    if (useLLM) {
      console.log(`[Schedule] Planning day ${currentDay} for ${agentName}...`);
      const generated = await generateSchedule(world, agentEid);
      if (generated) {
        initializeSchedule(world, agentEid, generated.activities, generated.flexibility);
      } else {
        initializeSchedule(world, agentEid, createDefaultSchedule(agentRole), 0.5);
      }
    } else {
      initializeSchedule(world, agentEid, createDefaultSchedule(agentRole), 0.5);
    }

    if (needsNew) created++;
    else regenerated++;
  }

  return { processed, created, regenerated };
}
