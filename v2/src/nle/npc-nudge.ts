/**
 * NPC Nudge — DM/NLE Channel to Daemon System
 *
 * Provides a clean interface for the NLE and DM to influence NPC
 * behavior through the daemon system. Nudges are optional suggestions,
 * not execution authority, experienced memories, or selected goals.
 *
 * Types of nudges:
 *   - "arrive" — go to a specific location
 *   - "interact" — engage with a person or object
 *   - "resolve" — address a conflict or tension
 *   - "escalate" — heighten a confrontation
 *   - "reflect" — think about something specific
 *   - "change_goal" — shift focus to a new objective
 */

import { randomUUID } from "node:crypto";
import { query } from "bitecs";
import { Agent, Name, Room } from "../ecs/components";
import { addPerception } from "../cognition/agent-mind";
import { chronicle } from "../cognition/simulation-chronicle";
import { workingMemoryEntityRef } from "../cognition/working-memory";
import { readSimulationTime } from "../ecs/simulation-time";
import { queueNarrativeNudge, type DaemonRegistry } from "../spirits/agent-daemon";
import type { World } from "../ecs/world";
import { getRoomForEntity } from "../ecs/location";
import { getCommittedSource } from "../runtime/committed-events";
import { assertSimulationTaskActive } from "../runtime/task-scope";

// =============================================================================
// STATE
// =============================================================================

const daemonRegistries = new WeakMap<World, DaemonRegistry>();

/** Set this world's daemon registry; another running world cannot replace it. */
export function setNudgeDaemonRegistry(world: World, registry: DaemonRegistry): void {
  assertSimulationTaskActive();
  daemonRegistries.set(world, registry);
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
  /** Runtime-only evidence/plan lease, never authority supplied in model JSON. */
  isCurrent?: () => boolean,
): boolean {
  assertSimulationTaskActive();
  if (isCurrent) { try { if (isCurrent() !== true) return false; } catch { return false; } }
  if (getCommittedSource(world).stopped || typeof npcName !== "string" || !npcName.trim()
    || !nudge || !["arrive", "interact", "resolve", "escalate", "reflect", "change_goal"].includes(nudge.type)
    || typeof nudge.action !== "string" || !nudge.action.trim() || nudge.action.length > 2000
    || typeof nudge.reason !== "string" || nudge.reason.length > 2000) return false;
  const matches = [...query(world, [Agent, Name])].filter(eid => Agent.active[eid]
    && Name.value[eid]?.toLowerCase() === npcName.trim().toLowerCase());
  if (matches.length !== 1) return false;
  const npcEid = matches[0], exactName = Name.value[npcEid];
  // Try daemon system first
  const daemonRegistry = daemonRegistries.get(world);
  if (daemonRegistry) {
    const success = queueNarrativeNudge(daemonRegistry, exactName, {
      type: nudge.type,
      action: nudge.action,
      reason: nudge.reason,
      source: "narrator",
      priority: nudge.priority || "normal",
    }, { world, agentEid: npcEid, ...(isCurrent ? { isCurrent } : {}) });
    if (success) {
      console.log(`[NLE] Nudged ${npcName} via daemon: ${nudge.type} — "${nudge.action}"`);
      return true;
    }
  }

  // No daemon is not permission to take over the NPC. All kinds remain
  // advisory intentions: never a goal, experienced memory, or public event.
  if (isCurrent) { try { if (isCurrent() !== true) return false; } catch { return false; } }
  const sourceId = getCommittedSource(world).sourceId;
  const actorKey = workingMemoryEntityRef(world, npcEid)?.key;
  const issuedAtSimMs = readSimulationTime(world);
  // The resident's own inner voice: a pull, a doubt, a temptation. It moves
  // them; it is not a fact about the world or an order they must follow.
  const perceptionEid = addPerception(world, npcEid, {
    type: "intent", source: "inner_voice", intensity: 0.6,
    content: innerVoice(nudge.action),
  });
  // Transport proof only: this says nothing about whether the NPC considered
  // the suggestion or whether a subsequent action was caused by it.
  if (perceptionEid >= 0) chronicle.record("narrative_nudge_lifecycle", {
    nudgeId: `direct-nudge:${randomUUID()}`, route: "direct", stage: "perception_delivered",
    sourceId, agent: exactName, actorKey, issuedAtSimMs, atSimMs: readSimulationTime(world), perceptionEid,
  }, "Narrative advice transport: perception_delivered");

  console.log(`[NLE] Nudged ${npcName} directly: ${nudge.type} — "${nudge.action}"`);
  return true;
}

/** Keep the author's second-person line as the resident's own thought. */
export function innerVoice(action: string): string {
  const line = action.replace(/\s+/g, " ").trim().replace(/^\[[^\]]*\]\s*/, "");
  return /^(you|your|why|what|maybe|perhaps|if|could|should|don't|do|go|ask|tell|look|find|not)\b/i.test(line) ? line : `You find yourself thinking: ${line}`;
}

/**
 * Offer an optional consideration to the active NPCs in an exact room.
 * A suggestion is not a fabricated shared environmental event.
 */
export function nudgeRoom(world: World, roomName: string, content: string): void {
  assertSimulationTaskActive();
  if (getCommittedSource(world).stopped || typeof roomName !== "string" || !roomName.trim()) return;
  const allAgents = Array.from(query(world as any, [Agent as any, Name as any]));
  const allRooms = Array.from(query(world as any, [Room, Name]));

  const rooms = allRooms.filter((eid: number) =>
    (Name.value[eid] || "").toLowerCase() === roomName.trim().toLowerCase());
  if (rooms.length !== 1) return;
  const roomEid = rooms[0];

  for (const agentEid of allAgents) {
    if (getRoomForEntity(world, agentEid) === roomEid) {
      nudgeNpc(world, Name.value[agentEid], { type: "reflect", action: content,
        reason: "A narrative possibility, not a physical event in the room", priority: "normal" });
    }
  }
}
