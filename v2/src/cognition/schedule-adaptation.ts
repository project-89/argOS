/**
 * Schedule Adaptation System
 *
 * Allows agents to adapt their schedules based on:
 * - Context changes (weather, social situations, emergencies)
 * - Goal priorities (important goals override schedule)
 * - Need states (hungry agents seek food regardless of schedule)
 * - Social opportunities (interesting conversations can delay activities)
 *
 * This bridges the gap between rigid daily schedules and dynamic behavior.
 */

import type { World } from "../ecs/world";
import { query, getRelationTargets, entityExists } from "bitecs";
import { Name, Agent, Mind, Schedule, Goal, Needs, Room } from "../ecs/components";
import { HasSchedule, HasGoal, OccupiesRoom } from "../ecs/relations";
import type { SystemDefinition } from "../ecs/dynamic-systems";
import {
  getSchedule,
  getCurrentActivity,
  getNextActivity,
  getScheduleFlexibility,
  type ScheduledActivity,
} from "./schedule-system";

// ============================================================================
// Configuration
// ============================================================================

/** How often to check for schedule adaptations (ms) */
export const ADAPTATION_CHECK_INTERVAL = 30000; // Every 30 seconds

/** Need thresholds that override schedule */
export const NEED_OVERRIDE_THRESHOLDS = {
  hunger: 0.8, // Very hungry overrides schedule
  energy: 0.2, // Very tired overrides schedule
  social: 0.8, // Very lonely (high need) overrides schedule
};

/** Goal priority threshold that overrides schedule */
export const GOAL_PRIORITY_OVERRIDE = 8;

/** Social interaction threshold (number of agents) to delay leaving */
export const SOCIAL_INTERACTION_THRESHOLD = 2;

// ============================================================================
// Types
// ============================================================================

export interface AdaptationContext {
  agentEid: number;
  agentName: string;
  currentActivity: ScheduledActivity | null;
  nextActivity: { activity: ScheduledActivity; hoursUntil: number } | null;
  flexibility: number;
  needs: {
    hunger: number;
    energy: number;
    social: number;
  };
  activeGoals: Array<{ description: string; priority: number }>;
  socialContext: {
    othersInRoom: number;
    roomAmbience: string;
  };
}

export interface AdaptationDecision {
  shouldAdapt: boolean;
  reason: string;
  suggestedAction?: string;
  delayDuration?: number; // Minutes to delay current transition
}

// ============================================================================
// Context Building
// ============================================================================

/**
 * Build the context needed for adaptation decisions.
 */
export function buildAdaptationContext(world: World, agentEid: number): AdaptationContext | null {
  if (!entityExists(world, agentEid)) return null;

  const agentName = Name.value[agentEid] || `Agent_${agentEid}`;
  const currentActivity = getCurrentActivity(world, agentEid);
  const nextActivity = getNextActivity(world, agentEid);
  const flexibility = getScheduleFlexibility(world, agentEid);

  // Get needs
  const hunger = Needs.hunger[agentEid] ?? 0;
  const energy = Needs.energy[agentEid] ?? 100;
  const social = Needs.social[agentEid] ?? 0;

  // Get active goals
  const goalEids = getRelationTargets(world, agentEid, HasGoal);
  const activeGoals: Array<{ description: string; priority: number }> = [];
  for (const goalEid of goalEids) {
    if (!entityExists(world, goalEid)) continue;
    const status = Goal.status[goalEid];
    if (status !== "active" && status !== "pending") continue;
    activeGoals.push({
      description: Goal.description[goalEid] || "",
      priority: Goal.priority[goalEid] ?? 5,
    });
  }

  // Get social context
  const rooms = getRelationTargets(world, agentEid, OccupiesRoom);
  let othersInRoom = 0;
  let roomAmbience = "neutral";

  if (rooms.length > 0) {
    const roomEid = rooms[0];
    if (entityExists(world, roomEid)) {
      roomAmbience = Room.ambience[roomEid] || "neutral";

      // Count other agents in same room
      const allAgents = Array.from(query(world, [Agent, Mind]));
      for (const otherEid of allAgents) {
        if (otherEid === agentEid) continue;
        if (!entityExists(world, otherEid)) continue;
        const otherRooms = getRelationTargets(world, otherEid, OccupiesRoom);
        if (otherRooms.includes(roomEid)) {
          othersInRoom++;
        }
      }
    }
  }

  return {
    agentEid,
    agentName,
    currentActivity,
    nextActivity,
    flexibility,
    needs: {
      hunger: hunger / 100, // Normalize to 0-1 (hunger increases)
      energy: energy / 100, // Normalize to 0-1 (energy decreases)
      social: social / 100, // Normalize to 0-1
    },
    activeGoals,
    socialContext: {
      othersInRoom,
      roomAmbience,
    },
  };
}

// ============================================================================
// Adaptation Logic
// ============================================================================

/**
 * Check if needs should override the current schedule.
 */
function checkNeedOverride(context: AdaptationContext): AdaptationDecision | null {
  const { needs, flexibility } = context;

  // Hunger check (hunger increases, so high = bad)
  if (needs.hunger > NEED_OVERRIDE_THRESHOLDS.hunger) {
    return {
      shouldAdapt: true,
      reason: "Critical hunger - need to find food",
      suggestedAction: "seek food",
    };
  }

  // Energy check (energy decreases, so low = bad)
  if (needs.energy < NEED_OVERRIDE_THRESHOLDS.energy) {
    return {
      shouldAdapt: true,
      reason: "Exhausted - need to rest",
      suggestedAction: "find rest",
    };
  }

  // Social need check (social need increases when alone)
  if (needs.social > NEED_OVERRIDE_THRESHOLDS.social && flexibility > 0.3) {
    return {
      shouldAdapt: true,
      reason: "Feeling lonely - seeking social interaction",
      suggestedAction: "socialize",
    };
  }

  return null;
}

/**
 * Check if high-priority goals should override schedule.
 */
function checkGoalOverride(context: AdaptationContext): AdaptationDecision | null {
  const { activeGoals, flexibility } = context;

  // Find highest priority goal
  const highPriorityGoal = activeGoals
    .filter((g) => g.priority >= GOAL_PRIORITY_OVERRIDE)
    .sort((a, b) => b.priority - a.priority)[0];

  if (highPriorityGoal && flexibility > 0.2) {
    return {
      shouldAdapt: true,
      reason: `High-priority goal: ${highPriorityGoal.description}`,
      suggestedAction: "pursue goal",
    };
  }

  return null;
}

/**
 * Check if social context suggests delaying schedule transitions.
 */
function checkSocialDelay(context: AdaptationContext): AdaptationDecision | null {
  const { socialContext, flexibility, currentActivity, nextActivity } = context;

  // Only check if there's a pending transition
  if (!nextActivity || nextActivity.hoursUntil > 0.5) {
    return null;
  }

  // Check if in an interesting social situation
  if (
    socialContext.othersInRoom >= SOCIAL_INTERACTION_THRESHOLD &&
    flexibility > 0.4 &&
    currentActivity?.interruptible
  ) {
    return {
      shouldAdapt: true,
      reason: "Engaged in social interaction - delaying transition",
      delayDuration: 30, // 30 minutes
    };
  }

  return null;
}

/**
 * Main adaptation decision function.
 */
export function decideAdaptation(context: AdaptationContext): AdaptationDecision {
  // Priority order: needs > goals > social

  // 1. Check critical needs
  const needOverride = checkNeedOverride(context);
  if (needOverride) return needOverride;

  // 2. Check high-priority goals
  const goalOverride = checkGoalOverride(context);
  if (goalOverride) return goalOverride;

  // 3. Check social delays
  const socialDelay = checkSocialDelay(context);
  if (socialDelay) return socialDelay;

  // No adaptation needed
  return {
    shouldAdapt: false,
    reason: "Following schedule normally",
  };
}

// ============================================================================
// Schedule Updates
// ============================================================================

/**
 * Update agent's mind focus based on adaptation decision.
 */
export function applyAdaptation(world: World, context: AdaptationContext, decision: AdaptationDecision): void {
  if (!decision.shouldAdapt) return;

  const { agentEid, agentName } = context;

  // Update mind focus to reflect the adaptation
  if (decision.suggestedAction) {
    Mind.focus[agentEid] = decision.suggestedAction;
    Mind.arousal[agentEid] = Math.min(1, (Mind.arousal[agentEid] || 0.5) + 0.1);
  }

  // If delaying, update schedule transition time
  if (decision.delayDuration) {
    const scheduleEid = getSchedule(world, agentEid);
    if (scheduleEid) {
      const currentTransition = Schedule.nextTransition[scheduleEid] || 0;
      Schedule.nextTransition[scheduleEid] = currentTransition + decision.delayDuration * 60000;
    }
  }

  console.log(`[ScheduleAdaptation] ${agentName}: ${decision.reason}`);
}

// ============================================================================
// Main System
// ============================================================================

/**
 * Run schedule adaptation for all agents.
 */
export function runScheduleAdaptation(world: World): {
  agentsChecked: number;
  adaptations: number;
} {
  const agents = Array.from(query(world, [Agent, Mind]));
  let adaptations = 0;

  for (const agentEid of agents) {
    if (!entityExists(world, agentEid)) continue;
    if (!Agent.active[agentEid]) continue;

    // Check if agent has a schedule
    if (!getSchedule(world, agentEid)) continue;

    const context = buildAdaptationContext(world, agentEid);
    if (!context) continue;

    const decision = decideAdaptation(context);
    if (decision.shouldAdapt) {
      applyAdaptation(world, context, decision);
      adaptations++;
    }
  }

  return {
    agentsChecked: agents.length,
    adaptations,
  };
}

// ============================================================================
// System Integration
// ============================================================================

/**
 * Create a schedule adaptation system for registration with the system registry.
 */
export function createScheduleAdaptationSystem(): SystemDefinition {
  return {
    name: "ScheduleAdaptation",
    description: "Adapts agent schedules based on needs, goals, and social context",
    pseudocode: `
FOR EACH agent WITH Schedule:
  Build adaptation context (needs, goals, social)
  Check if critical needs override schedule
  Check if high-priority goals override schedule
  Check if social interactions should delay transitions
  IF adaptation needed:
    Update mind focus and schedule transition
`,
    frequency: ADAPTATION_CHECK_INTERVAL,
    active: true,
    lastRun: 0,
    compiledFn: (world: World) => {
      runScheduleAdaptation(world);
    },
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Force an agent to deviate from schedule for an emergency.
 */
export function triggerEmergencyAdaptation(
  world: World,
  agentEid: number,
  emergency: string
): void {
  if (!entityExists(world, agentEid)) return;

  const agentName = Name.value[agentEid] || `Agent_${agentEid}`;

  // Override focus
  Mind.focus[agentEid] = emergency;
  Mind.arousal[agentEid] = 1.0; // Maximum alertness
  Mind.mode[agentEid] = "reactive"; // Switch to reactive mode

  console.log(`[ScheduleAdaptation] EMERGENCY for ${agentName}: ${emergency}`);
}

/**
 * Suggest an activity change without forcing it.
 * Returns true if the agent accepted the suggestion (based on flexibility).
 */
export function suggestActivityChange(
  world: World,
  agentEid: number,
  newActivity: string,
  reason: string
): boolean {
  if (!entityExists(world, agentEid)) return false;

  const flexibility = getScheduleFlexibility(world, agentEid);

  // Check if current activity can be interrupted
  const currentActivity = getCurrentActivity(world, agentEid);
  if (currentActivity && !currentActivity.interruptible) {
    return false;
  }

  // Roll against flexibility
  if (Math.random() > flexibility) {
    return false;
  }

  // Accept the suggestion
  const agentName = Name.value[agentEid] || `Agent_${agentEid}`;
  Mind.focus[agentEid] = newActivity;

  console.log(`[ScheduleAdaptation] ${agentName} accepted suggestion: ${newActivity} (${reason})`);
  return true;
}
