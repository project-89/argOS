/**
 * Appearance Emitter System
 *
 * Broadcasts visual stimuli to nearby NPCs when character appearances change.
 * This allows NPCs to notice when others change expression, pick up items,
 * change clothes, or have their condition change (muddy, bloody, etc).
 */

import type { World } from "../ecs/world";
import { query, entityExists } from "bitecs";
import { Agent, Mind, Name, Appearance } from "../ecs/components";
import { OccupiesRoom } from "../ecs/relations";
import { safeGetRelationTargets } from "../ecs/dynamic-systems";
import {
  hasAppearance,
  getAppearanceDescription,
  broadcastVisual,
  queueStimulus
} from "./cognition-system";

// Track last broadcasted appearance state per entity
interface AppearanceSnapshot {
  expression: string;
  posture: string;
  condition: string;
  visiblyHolding: string;
  clothing: string;
  lastBroadcast: number;
}

const lastAppearanceState = new Map<number, AppearanceSnapshot>();

// Configuration
const APPEARANCE_BROADCAST_INTERVAL = 30000;  // Broadcast full appearance every 30s
const MIN_CHANGE_INTERVAL = 5000;             // Don't spam broadcasts more often than 5s

/**
 * Get current appearance state for comparison
 */
function getAppearanceSnapshot(eid: number): AppearanceSnapshot {
  return {
    expression: Appearance.expression[eid] || "neutral",
    posture: Appearance.posture[eid] || "relaxed",
    condition: Appearance.condition[eid] || "clean",
    visiblyHolding: Appearance.visiblyHolding[eid] || "",
    clothing: Appearance.clothing[eid] || "simple clothes",
    lastBroadcast: Date.now(),
  };
}

/**
 * Check what aspects of appearance have changed
 */
function getAppearanceChanges(
  oldState: AppearanceSnapshot,
  newState: AppearanceSnapshot
): string[] {
  const changes: string[] = [];

  if (oldState.expression !== newState.expression) {
    changes.push(`expression: ${newState.expression}`);
  }
  if (oldState.posture !== newState.posture) {
    changes.push(`posture: ${newState.posture}`);
  }
  if (oldState.condition !== newState.condition) {
    changes.push(`condition: ${newState.condition}`);
  }
  if (oldState.visiblyHolding !== newState.visiblyHolding) {
    if (newState.visiblyHolding) {
      changes.push(`now holding: ${newState.visiblyHolding}`);
    } else {
      changes.push(`no longer holding anything`);
    }
  }
  if (oldState.clothing !== newState.clothing) {
    changes.push(`clothing: ${newState.clothing}`);
  }

  return changes;
}

/**
 * Generate a natural language description of appearance changes
 */
function describeAppearanceChange(
  name: string,
  changes: string[]
): string {
  if (changes.length === 0) return "";

  // Single change - describe it naturally
  if (changes.length === 1) {
    const change = changes[0];

    if (change.startsWith("expression:")) {
      const expr = change.split(": ")[1];
      return `${name}'s expression shifts to ${expr}.`;
    }
    if (change.startsWith("posture:")) {
      const posture = change.split(": ")[1];
      return `${name} shifts to a ${posture} posture.`;
    }
    if (change.startsWith("condition:")) {
      const cond = change.split(": ")[1];
      return `${name} now appears ${cond}.`;
    }
    if (change.startsWith("now holding:")) {
      const item = change.split(": ")[1];
      return `${name} is now holding ${item}.`;
    }
    if (change === "no longer holding anything") {
      return `${name} has put away what they were holding.`;
    }
    if (change.startsWith("clothing:")) {
      const clothes = change.split(": ")[1];
      return `${name} is now wearing ${clothes}.`;
    }
  }

  // Multiple changes - summarize
  return `${name}'s appearance has changed: ${changes.join(", ")}.`;
}

/**
 * Run the appearance emitter system
 * Call this periodically (e.g., every cognition cycle)
 */
export function runAppearanceEmitter(world: World): void {
  const now = Date.now();
  const agents = Array.from(query(world, [Agent, Mind]))
    .filter(eid => entityExists(world, eid) && Agent.active[eid] && hasAppearance(eid));

  for (const eid of agents) {
    const name = Name.value[eid] || `Entity ${eid}`;
    const rooms = safeGetRelationTargets(world, eid, OccupiesRoom);
    const roomEid = rooms[0];

    // Skip if not in a room
    if (roomEid === undefined) continue;

    const currentState = getAppearanceSnapshot(eid);
    const lastState = lastAppearanceState.get(eid);

    // First time seeing this agent - just record state, no broadcast
    if (!lastState) {
      lastAppearanceState.set(eid, currentState);
      continue;
    }

    // Check if we've had any changes
    const changes = getAppearanceChanges(lastState, currentState);
    const timeSinceLastBroadcast = now - lastState.lastBroadcast;

    // Broadcast if:
    // 1. There are significant changes AND enough time has passed
    // 2. It's been a while since last broadcast (periodic refresh)
    if (changes.length > 0 && timeSinceLastBroadcast >= MIN_CHANGE_INTERVAL) {
      // Broadcast the specific change to nearby NPCs
      const changeDesc = describeAppearanceChange(name, changes);
      if (changeDesc) {
        broadcastVisual(world, roomEid, changeDesc, name, eid);
      }

      // Update tracked state
      lastAppearanceState.set(eid, currentState);
    } else if (timeSinceLastBroadcast >= APPEARANCE_BROADCAST_INTERVAL) {
      // Periodic full appearance broadcast
      // This helps NPCs "notice" others who have been standing around
      const fullDesc = getAppearanceDescription(eid);
      broadcastVisual(world, roomEid, `You notice ${fullDesc}`, name, eid);

      // Update tracked state
      currentState.lastBroadcast = now;
      lastAppearanceState.set(eid, currentState);
    }
  }
}

/**
 * Force an immediate appearance broadcast for an entity
 * Useful after major changes (combat wounds, getting wet, etc.)
 */
export function broadcastAppearanceChange(
  world: World,
  eid: number,
  customMessage?: string
): void {
  if (!hasAppearance(eid) || !entityExists(world, eid)) return;

  const name = Name.value[eid] || `Entity ${eid}`;
  const rooms = safeGetRelationTargets(world, eid, OccupiesRoom);
  const roomEid = rooms[0];

  if (roomEid === undefined) return;

  const message = customMessage || `${getAppearanceDescription(eid)}`;
  broadcastVisual(world, roomEid, message, name, eid);

  // Update tracked state
  const currentState = getAppearanceSnapshot(eid);
  lastAppearanceState.set(eid, currentState);
}

/**
 * Broadcast when an NPC's expression changes due to emotional state
 * This creates a more natural "you notice X looking worried" kind of stimulus
 */
export function broadcastExpressionChange(
  world: World,
  eid: number,
  oldExpression: string,
  newExpression: string
): void {
  if (!hasAppearance(eid) || !entityExists(world, eid)) return;
  if (oldExpression === newExpression) return;

  const name = Name.value[eid] || `Entity ${eid}`;
  const rooms = safeGetRelationTargets(world, eid, OccupiesRoom);
  const roomEid = rooms[0];

  if (roomEid === undefined) return;

  // Generate contextual description based on expression
  let message: string;
  switch (newExpression) {
    case "happy":
    case "smiling":
      message = `${name}'s face lights up with a smile.`;
      break;
    case "angry":
    case "furious":
      message = `${name}'s expression hardens with anger.`;
      break;
    case "sad":
    case "sorrowful":
      message = `${name}'s face falls, looking sad.`;
      break;
    case "worried":
    case "anxious":
      message = `${name} looks worried, brow furrowed.`;
      break;
    case "surprised":
    case "shocked":
      message = `${name}'s eyes widen in surprise.`;
      break;
    case "confused":
    case "puzzled":
      message = `${name} looks confused, tilting their head.`;
      break;
    case "thoughtful":
    case "pensive":
      message = `${name} takes on a thoughtful expression.`;
      break;
    case "neutral":
      message = `${name}'s expression becomes neutral again.`;
      break;
    default:
      message = `${name}'s expression shifts to ${newExpression}.`;
  }

  broadcastVisual(world, roomEid, message, name, eid);
}

/**
 * Clean up tracked state for removed entities
 */
export function cleanupAppearanceState(eid: number): void {
  lastAppearanceState.delete(eid);
}

/**
 * Get stats about appearance tracking
 */
export function getAppearanceEmitterStats(): {
  trackedEntities: number;
  avgTimeSinceLastBroadcast: number;
} {
  const now = Date.now();
  let totalTime = 0;
  let count = 0;

  for (const state of Array.from(lastAppearanceState.values())) {
    totalTime += now - state.lastBroadcast;
    count++;
  }

  return {
    trackedEntities: lastAppearanceState.size,
    avgTimeSinceLastBroadcast: count > 0 ? totalTime / count : 0,
  };
}
