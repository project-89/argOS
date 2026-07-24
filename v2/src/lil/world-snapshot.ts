/**
 * World Snapshot — Structured ECS state for the LIL
 *
 * A clean, typed representation of the world state around a specific entity.
 * Used by both the intent parser and the world renderer.
 * Built by querying the ECS — all data is grounded in reality.
 */

import { query, hasComponent } from "bitecs";
import { Agent, Name, Description, Room, Needs, Traits, Memory, Goal, Inventory, ObjectState } from "../ecs/components";
import { HasMemory } from "../ecs/relations";
import { getRoomForEntity, listDirectContents } from "../ecs/location";
import { getActiveGoals } from "../cognition/cognition-system";
import { getAspirations } from "../cognition/goal-learning";
import { getAgentMemories, getImpressionOf } from "../cognition/knowledge-graph";
import { worldSchema } from "../world/schema";
import { getClockState, getActiveWorldEvents } from "../systems/world-clock";
import { getStoryScaffold, type StoryScaffoldData } from "../nle/story-scaffold";
import type { World } from "../ecs/world";

// =============================================================================
// TYPES
// =============================================================================

export interface PersonSnapshot {
  name: string;
  eid: number;
  role: string;
  description: string;
  currentGoal?: string;
  aspirations: string[];
  /** NPC's recent relevant memories (for dialogue grounding) */
  recentMemories: string[];
  /** NPC's impression of the observing entity */
  impressionOfViewer?: { sentiment: string; score: number };
  /** Narrative role from story scaffold */
  narrativeRole?: string;
  /** Secrets this NPC knows (for DM context only — not shown to player) */
  secrets?: string[];
}

export interface ObjectSnapshot {
  name: string;
  eid: number;
  description: string;
  traits: string[];
  state?: string;
}

export interface WorldSnapshot {
  // Location
  roomName: string;
  roomDescription: string;
  roomEid?: number;

  // Contents
  people: PersonSnapshot[];
  objects: ObjectSnapshot[];
  exits: string[];

  // Player state
  playerName: string;
  playerHunger: number;
  playerEnergy: number;
  playerSocial: number;

  // World state
  timeOfDay: string;
  day: number;
  worldEvents: Array<{ name: string; description: string }>;
  affordances: string[];

  // Narrative context (DM-only, room-scoped)
  storyScaffold?: StoryScaffoldData | null;

  // Last render output — for continuity and anti-repetition
  lastRender?: string;
}

// =============================================================================
// SNAPSHOT BUILDER
// =============================================================================

/**
 * Build a complete world snapshot centered on a specific entity (usually the player).
 * Includes NPC inner state for the DM to use in narration.
 */
export function buildWorldSnapshot(world: World, viewerEid: number): WorldSnapshot {
  const roomEid = getRoomForEntity(world, viewerEid);
  const roomName = roomEid !== undefined ? Name.value[roomEid] || "nowhere" : "nowhere";
  const roomDesc = roomEid !== undefined ? Description.value[roomEid] || "" : "";

  // People in room
  const people: PersonSnapshot[] = [];
  const objects: ObjectSnapshot[] = [];

  if (roomEid !== undefined) {
    for (const eid of listDirectContents(world, roomEid)) {
      if (eid === viewerEid) continue;
      const name = Name.value[eid] || "";
      if (!name) continue;

      if (hasComponent(world as any, eid, Agent as any)) {
        const role = Agent.role[eid] || "";
        const desc = Description.value[eid] || "";
        const goals = getActiveGoals(world, eid);
        const aspirations = getAspirations(eid);

        // Get recent memories for dialogue grounding
        const memoryEids = getAgentMemories(world, eid);
        const recentMemories = memoryEids
          .sort((a, b) => (Memory.importance[b] || 0) - (Memory.importance[a] || 0))
          .slice(0, 5)
          .map(mid => Memory.content[mid] || "")
          .filter(Boolean);

        // Get impression of viewer
        const viewerName = Name.value[viewerEid] || "";
        const impression = viewerName ? getImpressionOf(world, eid, viewerName) : undefined;
        const impressionOfViewer = impression ? {
          sentiment: impression.overallSentiment > 0.3 ? "positive" :
            impression.overallSentiment < -0.3 ? "negative" : "neutral",
          score: impression.overallSentiment,
        } : undefined;

        // Get narrative role from scaffold
        const scaffold = getStoryScaffold(world);
        const npcRole = scaffold?.npcRoles.find(r =>
          r.name.toLowerCase() === name.toLowerCase());

        people.push({
          name, eid, role, description: desc,
          currentGoal: goals.length > 0 ? goals[0].description : undefined,
          aspirations,
          recentMemories,
          impressionOfViewer,
          narrativeRole: npcRole?.role,
          secrets: npcRole?.secrets,
        });
      } else if (!hasComponent(world as any, eid, Room as any)) {
        const desc = Description.value[eid] || "";
        const traits = Traits.active?.[eid] ? JSON.parse(Traits.active[eid]) : [];
        const state = ObjectState.current?.[eid] || undefined;
        objects.push({ name, eid, description: desc, traits, state });
      }
    }
  }

  // Exits
  const allRooms = Array.from(query(world as any, [Room as any, Name as any]));
  const exits = allRooms.filter(r => r !== roomEid).map(r => Name.value[r] || "").filter(Boolean);

  // Affordances — include descriptions for intent matching
  // Prioritize custom/genesis affordances over builtins (builtins like examine, take, drop are generic)
  const builtinNames = new Set(["examine", "take", "drop", "open", "close", "lock", "unlock",
    "sit", "sleep", "eat", "drink", "attack", "talk", "read", "power_on", "power_off",
    "use_phone", "answer_call", "make_call", "end_call", "send_text", "use_computer",
    "browse_web", "send_email", "check_email", "search_files", "run_command", "list_dir",
    "read_file", "write_file", "replace_in_file", "init_workspace_fixture", "gemini_cli",
    "generate_image", "describe_image", "edit_image", "git_apply_from_last_gemini",
    "repo_init", "repo_checkout", "repo_submit_pr"]);
  const allAffordances = worldSchema.getAllAffordances();
  const custom = allAffordances.filter(a => !builtinNames.has(a.name));
  const builtin = allAffordances.filter(a => builtinNames.has(a.name));
  const affordances = [
    ...custom.map(a => a.description ? `${a.name} (${a.description})` : a.name),
    ...builtin.slice(0, 5).map(a => a.name), // Just a few builtins for basic actions
  ].slice(0, 20);

  // Player state
  const hunger = Needs.hunger[viewerEid] || 0;
  const energy = Needs.energy[viewerEid] ?? 100;
  const social = Needs.social[viewerEid] ?? 50;

  // Clock
  const clock = getClockState(world);
  const worldEvents = getActiveWorldEvents(world).map(e => ({
    name: e.name,
    description: e.description,
  }));

  // Room-scoped scaffold: only include narrative context for people HERE
  const presentNames = new Set(people.map(p => p.name.toLowerCase()));
  const fullScaffold = getStoryScaffold(world);
  let roomScaffold: StoryScaffoldData | null = null;
  if (fullScaffold) {
    roomScaffold = {
      ...fullScaffold,
      // Only include NPC roles for people in THIS room
      npcRoles: fullScaffold.npcRoles.filter(r => presentNames.has(r.name.toLowerCase())),
      // Only include tensions that involve people in THIS room
      tensions: fullScaffold.tensions.filter(t =>
        t.involvedNpcs.some(n => presentNames.has(n.toLowerCase()))),
    };
  }

  return {
    roomName, roomDescription: roomDesc, roomEid,
    people, objects, exits,
    playerName: Name.value[viewerEid] || "Player",
    playerHunger: hunger, playerEnergy: energy, playerSocial: social,
    timeOfDay: clock.period, day: clock.day,
    worldEvents, affordances,
    storyScaffold: roomScaffold,
  };
}
