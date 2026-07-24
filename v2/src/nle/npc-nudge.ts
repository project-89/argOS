/**
 * NPC Nudge — DM/NLE Channel to Daemon System
 *
 * Provides a clean interface for the NLE and DM to influence NPC
 * behavior through the daemon system. Nudges are soft suggestions
 * that bias the NPC's next cognition cycle without overriding
 * their autonomy.
 *
 * Types of nudges:
 *   - "arrive" — go to a specific location
 *   - "interact" — engage with a person or object
 *   - "resolve" — address a conflict or tension
 *   - "escalate" — heighten a confrontation
 *   - "reflect" — think about something specific
 *   - "change_goal" — shift focus to a new objective
 */

import { query, hasComponent } from "bitecs";
import { Agent, Name } from "../ecs/components";
import { addPerception } from "../cognition/agent-mind";
import { addMemory } from "../cognition/knowledge-graph";
import { createIntentGoal, getActiveGoals } from "../cognition/cognition-system";
import { queueNarrativeNudge, type DaemonRegistry } from "../spirits/agent-daemon";
import type { World } from "../ecs/world";

// =============================================================================
// STATE
// =============================================================================

let daemonRegistry: DaemonRegistry | null = null;

/** Set the daemon registry for NPC nudging. */
export function setNudgeDaemonRegistry(registry: DaemonRegistry): void {
  daemonRegistry = registry;
}

// =============================================================================
// NUDGE FUNCTIONS
// =============================================================================

/**
 * Nudge an NPC toward a specific behavior.
 * Uses the daemon system if available, falls back to direct perception injection.
 */
export function nudgeNpc(
  world: World,
  npcName: string,
  nudge: {
    type: "arrive" | "interact" | "resolve" | "escalate" | "reflect" | "change_goal";
    action: string;     // What they should do
    reason: string;     // Why (for daemon context)
    priority?: "low" | "normal" | "high";
  },
): boolean {
  // Try daemon system first
  if (daemonRegistry) {
    const success = queueNarrativeNudge(daemonRegistry, npcName, {
      type: nudge.type,
      action: nudge.action,
      reason: nudge.reason,
      source: "narrator",
      priority: nudge.priority || "normal",
    });
    if (success) {
      console.log(`[NLE] Nudged ${npcName} via daemon: ${nudge.type} — "${nudge.action}"`);
      return true;
    }
  }

  // Fallback: direct perception injection
  const allAgents = Array.from(query(world as any, [Agent as any, Name as any]));
  const npcEid = allAgents.find(eid =>
    (Name.value[eid] || "").toLowerCase().includes(npcName.toLowerCase()));

  if (npcEid === undefined) return false;

  // Inject as a strong internal perception that biases their next decision
  switch (nudge.type) {
    case "arrive":
      addPerception(world, npcEid, {
        type: "intent",
        content: `You feel a strong urge to go to ${nudge.action}. ${nudge.reason}`,
        source: "intuition",
        intensity: 0.9,
      });
      break;

    case "interact":
      addPerception(world, npcEid, {
        type: "intent",
        content: `Something compels you to ${nudge.action}. ${nudge.reason}`,
        source: "intuition",
        intensity: 0.8,
      });
      break;

    case "resolve":
    case "escalate":
      addPerception(world, npcEid, {
        type: "event",
        content: nudge.action,
        source: "world",
        intensity: 0.9,
      });
      break;

    case "reflect":
      addMemory(world, npcEid, {
        type: "episodic",
        content: nudge.action,
        importance: 80,
        emotionalValence: 0,
        timestamp: Date.now(),
      });
      break;

    case "change_goal":
      // Check if they already have this goal
      const goals = getActiveGoals(world, npcEid);
      const alreadyHas = goals.some(g =>
        g.description.toLowerCase().includes(nudge.action.toLowerCase().slice(0, 20)));
      if (!alreadyHas) {
        createIntentGoal(world, npcEid, nudge.action, 8);
      }
      break;
  }

  console.log(`[NLE] Nudged ${npcName} directly: ${nudge.type} — "${nudge.action}"`);
  return true;
}

/**
 * Nudge all NPCs in a room with an environmental cue.
 * Used for setting atmosphere before a dramatic beat.
 */
export function nudgeRoom(world: World, roomName: string, content: string): void {
  const allAgents = Array.from(query(world as any, [Agent as any, Name as any]));
  const { getRoomForEntity } = require("../ecs/location");
  const { Room } = require("../ecs/components");
  const allRooms = Array.from(query(world as any, [Room, Name]));

  const roomEid = allRooms.find((eid: number) =>
    (Name.value[eid] || "").toLowerCase().includes(roomName.toLowerCase()));
  if (roomEid === undefined) return;

  for (const agentEid of allAgents) {
    if (getRoomForEntity(world, agentEid) === roomEid) {
      addPerception(world, agentEid, {
        type: "environmental",
        content,
        source: "world",
        intensity: 0.7,
      });
    }
  }
}
