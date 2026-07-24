/**
 * Narrative Director — Proactive Story Management
 *
 * The NLE's active hand in the simulation. Runs periodically (every 30-60s)
 * and shapes the story by:
 *   - Monitoring which dramatic beats have been triggered
 *   - Nudging NPCs toward the next beat (adjusting goals, planting memories)
 *   - Pre-building world elements the story needs
 *   - Broadcasting environmental stimuli to set atmosphere
 *
 * The Director nudges, it doesn't force. NPCs still make their own decisions
 * through their cognition chain. The story emerges from the interaction
 * between the Director's guidance and the NPCs' autonomy.
 */

import { query, hasComponent } from "bitecs";
import { generateText } from "ai";
import { agentModel } from "../llm/config";
import { extractJSON } from "../llm/json-extract";
import type { World } from "../ecs/world";
import { Agent, Name, Description, Room, Goal } from "../ecs/components";
import { getRoomForEntity, listDirectContents } from "../ecs/location";
import { addMemory } from "../cognition/knowledge-graph";
import { addPerception } from "../cognition/agent-mind";
import { createIntentGoal, getActiveGoals } from "../cognition/cognition-system";
import { broadcastToRoom, queueStimulus } from "../cognition/cognition-system";
import { chronicle } from "../cognition/simulation-chronicle";
import { godCommand, type GodAgentState } from "../god/god-agent";
import {
  getStoryScaffold,
  updateStoryScaffold,
  formatScaffoldForContext,
  type StoryScaffoldData,
  type NarrativeTension,
  type DramaticBeat,
} from "./story-scaffold";
import { healNarrative, calculateNarrativeIntegrity } from "./narrative-integrity";
import { nudgeNpc } from "./npc-nudge";

// =============================================================================
// DIRECTOR STATE
// =============================================================================

let lastDirectorRun = 0;
const DIRECTOR_INTERVAL_MS = 45_000; // Run every 45 seconds

/** God AI reference for world-building commands. Set via setGodAgent(). */
let godAgent: GodAgentState | null = null;

/** Set the God AI reference so the director can build world elements. */
export function setDirectorGodAgent(god: GodAgentState): void {
  godAgent = god;
}

// =============================================================================
// MAIN ENTRY POINT
// =============================================================================

/**
 * Run a narrative director cycle. Call from the AI operation loop.
 * Returns true if the director took action, false if it skipped.
 */
export async function runNarrativeDirectorCycle(world: World): Promise<boolean> {
  const now = Date.now();
  if (now - lastDirectorRun < DIRECTOR_INTERVAL_MS) return false;
  lastDirectorRun = now;

  const scaffold = getStoryScaffold(world);
  if (!scaffold) return false;

  // Find the next pending beat across all active tensions
  const activeTensions = scaffold.tensions.filter(t => t.status === "active");
  if (activeTensions.length === 0) return false;

  // Player engagement: nudge NPCs in the player's room to be responsive
  nudgeNpcsTowardPlayer(world, scaffold);

  // Self-healing: check for missing NPCs and redistribute roles
  const integrity = calculateNarrativeIntegrity(world);
  if (integrity.status !== "intact") {
    const healed = await healNarrative(world);
    if (healed > 0) {
      console.log(`[NLE] Narrative healed: ${healed} roles redistributed. Integrity: ${integrity.score}% (${integrity.status})`);
    }
  }

  // Check if any beats should be triggered based on recent events
  const recentEvents = chronicle.getByTickRange(
    Math.max(0, (chronicle as any).currentTick - 20),
    (chronicle as any).currentTick || 999999
  );

  let tookAction = false;

  for (const tension of activeTensions) {
    const nextBeat = tension.beats.find(b => b.status === "pending");
    if (!nextBeat) {
      // All beats completed — resolve tension
      tension.status = "resolved";
      continue;
    }

    // Try to advance this beat
    const advanced = await advanceBeat(world, scaffold, tension, nextBeat, recentEvents);
    if (advanced) tookAction = true;
  }

  // Update scaffold
  if (tookAction) {
    updateStoryScaffold(world, scaffold);
  }

  return tookAction;
}

// =============================================================================
// BEAT ADVANCEMENT
// =============================================================================

async function advanceBeat(
  world: World,
  scaffold: StoryScaffoldData,
  tension: NarrativeTension,
  beat: DramaticBeat,
  recentEvents: any[],
): Promise<boolean> {
  // Get world state for the LLM
  const agents = Array.from(query(world as any, [Agent as any, Name as any]));
  const agentInfo = agents.map(eid => {
    const name = Name.value[eid] || "";
    const role = Agent.role[eid] || "";
    const goals = getActiveGoals(world, eid);
    const room = getRoomForEntity(world, eid);
    const roomName = room !== undefined ? Name.value[room] || "" : "";
    return `${name} (${role}) in ${roomName}${goals.length > 0 ? `, pursuing: "${goals[0].description}"` : ""}`;
  }).join("\n");

  const npcRoles = scaffold.npcRoles.map(r =>
    `${r.name}: ${r.role}${r.hiddenMotivation ? ` (hidden: ${r.hiddenMotivation})` : ""}`
  ).join("\n");

  try {
    const result = await generateText({
      model: agentModel,
      temperature: 0.6,
      messages: [
        {
          role: "system",
          content: `You are the Narrative Director for a living simulation. You shape the story by taking subtle actions — planting memories, broadcasting events, adjusting the atmosphere. You NUDGE, you don't force. NPCs have free will.

You must respond with JSON describing what actions to take RIGHT NOW to advance the story.`,
        },
        {
          role: "user",
          content: `CURRENT TENSION: ${tension.description}
NEXT DRAMATIC BEAT: ${beat.description} (${beat.act})
TRIGGER CONDITION: ${beat.triggerCondition}
BEAT NPC ACTIONS: ${(beat.npcActions || []).join("; ") || "none specified"}

CHARACTERS:
${agentInfo}

NPC ROLES:
${npcRoles}

Based on the current state, decide what to do to nudge the story toward this beat. Choose from these actions:

1. "plant_memory" — Give an NPC a new memory to influence their decisions
2. "inject_perception" — Make an NPC notice something in their environment
3. "broadcast_event" — Announce something to a whole room
4. "suggest_goal" — Create a goal for an NPC that aligns with the narrative
5. "prepare_world" — Create objects, props, or environmental details the next beat needs (e.g., "create a disguise cloak in the market", "place a torn map in the forest")
6. "mark_triggered" — If the beat's trigger condition is already met, mark it as triggered
7. "skip" — The story is progressing naturally, no intervention needed

Respond with JSON:
{
  "assessment": "Brief assessment of narrative state",
  "actions": [
    {
      "type": "plant_memory|inject_perception|broadcast_event|suggest_goal|mark_triggered|skip",
      "target": "NPC name or room name",
      "content": "The memory, perception, event, or goal description"
    }
  ],
  "beatTriggered": false
}`,
        },
      ],
    });

    const raw = extractJSON(result.text);
    if (!raw) return false;
    const json = typeof raw === "string" ? JSON.parse(raw) : raw;

    if (!json.actions || json.actions.length === 0) return false;

    let acted = false;

    for (const action of json.actions) {
      if (!action.type || action.type === "skip") continue;

      const targetName = String(action.target || "").trim();
      const content = String(action.content || "").trim();
      if (!content) continue;

      switch (action.type) {
        case "plant_memory": {
          const targetEid = agents.find(eid =>
            (Name.value[eid] || "").toLowerCase().includes(targetName.toLowerCase()));
          if (targetEid !== undefined) {
            addMemory(world, targetEid, {
              type: "episodic",
              content,
              importance: 80,
              emotionalValence: -0.3,
              timestamp: Date.now(),
            });
            console.log(`[NLE] Planted memory in ${targetName}: "${content.slice(0, 60)}..."`);
            acted = true;
          }
          break;
        }

        case "inject_perception": {
          const targetEid = agents.find(eid =>
            (Name.value[eid] || "").toLowerCase().includes(targetName.toLowerCase()));
          if (targetEid !== undefined) {
            addPerception(world, targetEid, {
              type: "environmental",
              content,
              source: "world",
              intensity: 0.8,
            });
            console.log(`[NLE] Injected perception for ${targetName}: "${content.slice(0, 60)}..."`);
            acted = true;
          }
          break;
        }

        case "broadcast_event": {
          const rooms = Array.from(query(world as any, [Room as any, Name as any]));
          const roomEid = rooms.find(eid =>
            (Name.value[eid] || "").toLowerCase().includes(targetName.toLowerCase()));
          if (roomEid !== undefined) {
            broadcastToRoom(world, roomEid, {
              type: "environmental",
              content,
              source: "world",
            });
            console.log(`[NLE] Broadcast to ${targetName}: "${content.slice(0, 60)}..."`);
            acted = true;
          } else {
            // Broadcast to all rooms
            for (const r of rooms) {
              broadcastToRoom(world, r, { type: "environmental", content, source: "world" });
            }
            console.log(`[NLE] Broadcast to all: "${content.slice(0, 60)}..."`);
            acted = true;
          }
          break;
        }

        case "suggest_goal": {
          const nudged = nudgeNpc(world, targetName, {
            type: "change_goal",
            action: content,
            reason: `Narrative tension: ${tension.description.slice(0, 50)}`,
            priority: "high",
          });
          if (nudged) acted = true;
          break;
        }

        case "prepare_world": {
          // Use God AI to create world elements the story needs
          if (godAgent && content) {
            try {
              const godCmd = `The narrative requires: ${content}. Create the necessary objects, entities, or environmental details to support this. Keep it minimal and grounded.`;
              await godCommand(godAgent, godCmd);
              console.log(`[NLE] World prepared: "${content.slice(0, 60)}..."`);
              acted = true;
            } catch (err) {
              console.warn(`[NLE] Failed to prepare world: ${(err as Error).message}`);
            }
          }
          break;
        }

        case "mark_triggered": {
          beat.status = "triggered";
          console.log(`[NLE] Beat triggered: "${beat.description.slice(0, 60)}..."`);

          // Check if we should advance the act
          const completedBeats = tension.beats.filter(b => b.status !== "pending").length;
          const totalBeats = tension.beats.length;
          if (completedBeats >= totalBeats * 0.5 && scaffold.currentAct === "setup") {
            scaffold.currentAct = "escalation";
            console.log(`[NLE] Act advanced to: escalation`);
          } else if (completedBeats >= totalBeats * 0.75 && scaffold.currentAct === "escalation") {
            scaffold.currentAct = "crisis";
            console.log(`[NLE] Act advanced to: crisis`);
          }

          acted = true;
          break;
        }
      }
    }

    if (json.beatTriggered && beat.status === "pending") {
      beat.status = "triggered";
      acted = true;
    }

    if (acted) {
      scaffold.adaptations.push(`[${new Date().toISOString()}] ${json.assessment || "Director acted"}`);
      chronicle.record("spirit_proposal", {
        spirit: "NarrativeDirector",
        assessment: json.assessment || "",
        actions: json.actions.length,
        beat: beat.description,
      });
    }

    return acted;
  } catch (err) {
    console.warn(`[NLE] Director cycle failed: ${(err as Error).message}`);
    return false;
  }
}

// =============================================================================
// RESET
// =============================================================================

// =============================================================================
// PLAYER ENGAGEMENT — nudge NPCs to interact with the player
// =============================================================================

/** Track which NPCs have been nudged toward the player this session */
const playerEngagementNudged = new Set<number>();

/**
 * Check if any scaffold NPCs are in the same room as the player
 * and nudge them to engage rather than ignore.
 * The player is the audience — NPCs should find them interesting.
 */
function nudgeNpcsTowardPlayer(world: World, scaffold: StoryScaffoldData): void {
  // Find the player (Agent.active === false means human-controlled)
  const allAgents = Array.from(query(world as any, [Agent as any, Name as any]));
  const playerEid = allAgents.find(eid => !Agent.active[eid]);
  if (playerEid === undefined) return;

  const playerRoom = getRoomForEntity(world, playerEid);
  if (playerRoom === undefined) return;

  const playerName = Name.value[playerEid] || "the traveler";

  for (const npcRole of scaffold.npcRoles) {
    const npcEid = allAgents.find(eid =>
      (Name.value[eid] || "").toLowerCase() === npcRole.name.toLowerCase() &&
      Agent.active[eid]);
    if (npcEid === undefined) continue;

    // Only nudge if NPC is in the same room as the player
    const npcRoom = getRoomForEntity(world, npcEid);
    if (npcRoom !== playerRoom) continue;

    // Don't nudge the same NPC repeatedly
    if (playerEngagementNudged.has(npcEid)) continue;
    playerEngagementNudged.add(npcEid);

    // Nudge based on their narrative role
    const nudgeContent = getNarrativeEngagementNudge(npcRole, playerName, scaffold);
    if (nudgeContent) {
      nudgeNpc(world, npcRole.name, {
        type: "interact",
        action: nudgeContent,
        reason: `${playerName} is present — they may be important to the unfolding story`,
        priority: "normal",
      });
    }
  }
}

function getNarrativeEngagementNudge(
  role: { name: string; role: string; secrets: string[]; hiddenMotivation?: string },
  playerName: string,
  scaffold: StoryScaffoldData,
): string | null {
  switch (role.role) {
    case "protagonist":
      return `A stranger has arrived — assess whether ${playerName} could help with your current troubles`;
    case "antagonist":
      return `A stranger named ${playerName} has appeared — evaluate whether they are a threat or an opportunity`;
    case "catalyst":
      return `The arrival of ${playerName} could change things — share what you know and see what they offer`;
    case "witness":
      return `${playerName} is new here — they might need guidance about the village and its people`;
    case "ally":
      return `A traveler named ${playerName} has arrived — welcome them and see if they share your concerns`;
    case "wild_card":
      return `${playerName} is someone new — probe them for useful information before deciding your stance`;
    default:
      return null;
  }
}

export function resetNarrativeDirector(): void {
  lastDirectorRun = 0;
  playerEngagementNudged.clear();
}
