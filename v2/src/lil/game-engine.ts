/**
 * Game Engine — Unified Player Interaction Pipeline
 *
 * One function that handles the complete player turn:
 *   1. Parse intent (LIL inbound)
 *   2. Match affordances
 *   3. Snapshot state BEFORE
 *   4. Execute actions + trigger NPC cognition
 *   5. Snapshot state AFTER
 *   6. Compute state diff
 *   7. Render narration (LIL outbound)
 *   8. Process cognitive aftereffects (knowledge extraction, gossip, impressions)
 *
 * Used by: MUD client, test scripts, future web/multiplayer server.
 * Never duplicate this logic — all clients call gameEngine.turn().
 */

import { query, hasComponent, getRelationTargets } from "bitecs";
import {
  Agent, Name, Description, Room, Needs, Traits, Perception,
  Inventory, Health,
} from "../ecs/components";
import { getRoomForEntity, listDirectContents } from "../ecs/location";
import {
  registerEntity, executeActions, getActiveGoals, queueStimulus,
} from "../cognition/cognition-system";
import {
  agentThink, addPerception, getAgentPerceptions,
  addConversationTurn,
} from "../cognition/agent-mind";
import { captureThoughtPublication, takeNewAuthoredThoughtEvents } from "../cognition/thought-publication";
import { getSocialDialogue } from "../cognition/social-memory";
import { getCommittedEvents } from "../runtime/committed-events";
import { workingMemoryEntityRef } from "../cognition/working-memory";
import { extractKnowledgeFromInteraction } from "../cognition/knowledge-graph";
import { accumulateImportance } from "../cognition/reflection-system";
import { worldSchema } from "../world/schema";
import {
  advanceWorldClock, expireWorldEvents,
} from "../systems/world-clock";
import { runNarrativeDirectorCycle } from "../nle/narrative-director";
import { parsePlayerIntent, type ConversationEntry } from "./intent-parser";
import { renderNarrative, renderRoomDescription, type NpcResponse } from "./world-renderer";
import { buildWorldSnapshot, type WorldSnapshot } from "./world-snapshot";
import { processSpeechImpact, propagateGossip } from "./speech-impact";
import type { World } from "../ecs/world";
import { getComponent, listNames } from "../ecs/component-registry";

// =============================================================================
// TYPES
// =============================================================================

export interface GameTurnResult {
  narration: string;
  npcResponses: NpcResponse[];
  stateChanges: StateDiff;
  affordancesFired: string[];
  impossible?: string;
}

export interface StateDiff {
  /** Component changes: { componentName: { property: { before, after } } } */
  componentChanges: Record<string, Record<string, { before: any; after: any }>>;
  /** NPCs that arrived in player's room */
  arrivals: string[];
  /** NPCs that left player's room */
  departures: string[];
  /** Objects that appeared */
  objectsAdded: string[];
  /** Objects that disappeared */
  objectsRemoved: string[];
  /** Player moved to a new room */
  playerMoved?: { from: string; to: string };
}

export interface GameEngineConfig {
  playerName: string;
  playerRole: string;
  /** Genre hint for tone: "horror", "fantasy", "noir", "scifi", etc. */
  genre?: string;
  /** Tone keywords to prefer/avoid in narration */
  tonePrefer?: string[];
  toneAvoid?: string[];
}

// =============================================================================
// STATE
// =============================================================================

const conversationHistory: ConversationEntry[] = [];
let lastNarration = "";
let config: GameEngineConfig = { playerName: "Traveler", playerRole: "adventurer" };

export function initGameEngine(cfg: GameEngineConfig): void {
  config = cfg;
  conversationHistory.length = 0;
  lastNarration = "";
}

export function getConversationHistory(): ConversationEntry[] {
  return conversationHistory;
}

// =============================================================================
// MAIN TURN FUNCTION
// =============================================================================

/**
 * Process one player turn. The complete pipeline:
 *   Intent → Affordance Match → Before State → Execute → After State → Diff → Render → Aftereffects
 */
export async function gameTurn(
  input: string,
  world: World,
  playerEid: number,
  systemRegistry: any,
): Promise<GameTurnResult> {
  const snapshot = buildWorldSnapshot(world as any, playerEid);
  snapshot.lastRender = lastNarration;

  // 1. Parse player intent
  const intent = await parsePlayerIntent(input, snapshot, conversationHistory);

  if (intent.impossible) {
    conversationHistory.push({ role: "player", content: input });
    const narration = await renderNarrative({
      snapshot, playerIntent: intent, npcResponses: [], conversationHistory,
    });
    conversationHistory.push({ role: "dm", content: narration });
    lastNarration = narration;
    return { narration, npcResponses: [], stateChanges: emptyDiff(), affordancesFired: [], impossible: intent.impossible };
  }

  // 2. Match affordances from player language
  const affordancesFired: string[] = [];
  matchAffordances(input, intent.actions, snapshot, world as any);

  // 3. Snapshot BEFORE state
  const beforeState = capturePlayerState(world as any, playerEid, snapshot);

  // 4. Execute actions + collect NPC responses
  const npcResponses: NpcResponse[] = [];

  for (const action of intent.actions) {
    if (action.type === "speak") {
      await handleSpeech(world as any, playerEid, action, snapshot, npcResponses, systemRegistry);
    } else if (action.type !== "wait") {
      try {
        await executeActions(world as any, [{ eid: playerEid, action }] as any, systemRegistry);
        if (action.type === "interact" && action.content) {
          affordancesFired.push(action.content);
        }
      } catch {}
    }
  }

  // 5. Project the world owned by the simulation runtime. Completing a model
  // narration or typing a command is not three physics ticks or extra hunger.
  // Turn-based hosts must explicitly step their simulation between inputs.
  advanceWorldClock(world); expireWorldEvents(world);
  propagateGossip(world as any);
  await runNarrativeDirectorCycle(world as any);

  // 6. Snapshot AFTER state + compute diff
  const updatedSnapshot = buildWorldSnapshot(world as any, playerEid);
  updatedSnapshot.lastRender = lastNarration;
  const afterState = capturePlayerState(world as any, playerEid, updatedSnapshot);
  const stateChanges = computeDiff(beforeState, afterState, snapshot, updatedSnapshot);

  // 7. Render narration with diff context
  conversationHistory.push({ role: "player", content: input });
  const narration = await renderNarrative({
    snapshot: updatedSnapshot,
    playerIntent: intent,
    npcResponses: publicNpcResponses(npcResponses),
    conversationHistory,
    stateChanges,
    genre: config.genre,
  });
  conversationHistory.push({ role: "dm", content: narration });
  lastNarration = narration;

  // Trim history
  if (conversationHistory.length > 30) conversationHistory.splice(0, conversationHistory.length - 20);

  return { narration, npcResponses, stateChanges, affordancesFired };
}

// =============================================================================
// AFFORDANCE MATCHING
// =============================================================================

function matchAffordances(
  input: string,
  actions: Array<{ type: string; target?: string; content?: string }>,
  snapshot: WorldSnapshot,
  world: any,
): void {
  const inputLower = input.toLowerCase();

  for (const action of actions) {
    for (const aff of snapshot.affordances) {
      const affName = aff.split(" (")[0];
      const affWords = affName.split("_");
      if (affWords.length >= 2 &&
          (affWords.every(w => inputLower.includes(w)) ||
           inputLower.includes(affName.replace(/_/g, " ")))) {
        action.type = "interact";
        action.content = affName;

        // Resolve target
        if (!action.target && snapshot.objects.length > 0) {
          const bestMatch = snapshot.objects.find(o =>
            o.traits.some(t => affName.includes(t)) ||
            affWords.some(w => o.name.toLowerCase().includes(w))
          ) || snapshot.objects[0];
          action.target = bestMatch.name;
        }

        // Auto-tag missing traits on target
        if (action.target) {
          const targetObj = snapshot.objects.find(o =>
            o.name.toLowerCase() === action.target!.toLowerCase());
          if (targetObj) {
            const affDef = worldSchema.getAffordance(affName);
            if (affDef?.requires) {
              const missing = affDef.requires.filter(t => !targetObj.traits.includes(t));
              if (missing.length > 0) {
                const currentTraits = Traits.active?.[targetObj.eid]
                  ? JSON.parse(Traits.active[targetObj.eid]) : [];
                for (const t of missing) {
                  if (!currentTraits.includes(t)) currentTraits.push(t);
                }
                Traits.active[targetObj.eid] = JSON.stringify(currentTraits);
              }
            }
          }
        }
        break;
      }
    }
  }
}

// =============================================================================
// SPEECH HANDLING
// =============================================================================

async function handleSpeech(
  world: any,
  playerEid: number,
  action: { type: string; target?: string; content?: string },
  snapshot: WorldSnapshot,
  npcResponses: NpcResponse[],
  systemRegistry: any,
): Promise<void> {
  const speechContent = action.content || "";
  const allAgents = Array.from(query(world, [Agent as any, Name as any]));

  // Directed speech
  if (action.target) {
    const targetEid = allAgents.find((eid: number) =>
      (Name.value[eid] || "").toLowerCase().includes(action.target!.toLowerCase()));
    if (targetEid !== undefined) {
      await processNpcSpeechInteraction(world, playerEid, targetEid, speechContent, snapshot, npcResponses, systemRegistry);
    }
    return;
  }

  // Broadcast to room
  const roomEid = getRoomForEntity(world, playerEid);
  if (roomEid === undefined) return;

  for (const eid of listDirectContents(world, roomEid)) {
    if (eid === playerEid || !hasComponent(world, eid, Agent as any)) continue;
    await processNpcSpeechInteraction(world, playerEid, eid, speechContent, snapshot, npcResponses, systemRegistry);
  }
}

export async function processNpcSpeechInteraction(
  world: any,
  playerEid: number,
  npcEid: number,
  speechContent: string,
  snapshot: WorldSnapshot,
  npcResponses: NpcResponse[],
  systemRegistry: any,
): Promise<void> {
  const npcName = Name.value[npcEid] || "someone";

  // 1. Inject perception
  addPerception(world, npcEid, {
    type: "directed_speech",
    content: `${config.playerName} says to you: "${speechContent}"`,
    source: config.playerName,
    intensity: 1,
  });

  // 2. Record conversation turn
  addConversationTurn(world, npcEid, "user", `${config.playerName}: "${speechContent}"`);

  try {
    // 3. Full cognition
    const thoughtCursor = captureThoughtPublication(world, npcEid);
    const npcAction = await agentThink(world, npcEid);

    // 5. Execute (filter hostile)
    const speechBefore = new Set(getSocialDialogue(world, npcEid).map(turn => turn.id));
    const ownerBefore = workingMemoryEntityRef(world, npcEid)?.key, sourceBefore = getCommittedEvents(world).sourceId;
    if (npcAction.type !== "attack" && npcAction.type !== "defend") {
      await executeActions(world, [{ eid: npcEid, action: npcAction }] as any, systemRegistry);
    }

    // 6. Private diagnostic thought is only one newly admitted in this turn.
    // The renderer receives a separate public projection; silence stays silence.
    const innerThought = takeNewAuthoredThoughtEvents(thoughtCursor).at(-1)?.thought;
    // A proposed line is not evidence that anyone heard it. Timed speech is
    // still pending here; only a new completed executor-owned turn may answer.
    const tape = getCommittedEvents(world);
    const spoken = npcAction.type === "speak" && ownerBefore && workingMemoryEntityRef(world, npcEid)?.key === ownerBefore
      && !tape.stopped && tape.sourceId === sourceBefore
      ? getSocialDialogue(world, npcEid).find(turn => turn.own && !speechBefore.has(turn.id)
        && turn.content === npcAction.content?.trim()) : undefined;
    const response: NpcResponse = { name: npcName,
      action: npcAction.type === "speak" ? spoken ? { ...npcAction, content: spoken.content } : { type: "wait" }
        : npcAction.type === "attack" || npcAction.type === "defend" ? { type: "wait" } : npcAction,
      ...(innerThought !== undefined ? { innerThought } : {}) };
    npcResponses.push(response);

    // 7. Record NPC turn
    const npcSpeech = response.action.type === "speak" ? (response.action.content || "") : "";
    if (npcSpeech) addConversationTurn(world, npcEid, "assistant", `${npcName}: "${npcSpeech}"`);

    // 8. Knowledge extraction
    extractKnowledgeFromInteraction(world, npcEid, {
      type: "conversation",
      content: `${config.playerName} said: "${speechContent}".${npcSpeech ? ` I responded: "${npcSpeech}"` : " I made no spoken response in this turn."}`,
      otherParty: config.playerName,
      context: `Conversation in ${snapshot.roomName}`,
    }).catch(() => {});

    // 9. Reflection
    accumulateImportance(world, npcEid, 15);

    // 10. Speech impact
    processSpeechImpact(world, npcEid, config.playerName, speechContent, npcSpeech).catch(() => {});

  } catch {}
}

/** Inner monologue is operator diagnostic data, not the narrator's dialogue
 * source. Do not leak a private think/wait payload through the action either. */
export function publicNpcResponses(responses: readonly NpcResponse[]): NpcResponse[] {
  return responses.map(({ name, action }) => ({ name, action:
    ["think", "reflect", "remember", "plan", "wait"].includes(action.type) ? { type: action.type } : { ...action } }));
}

// =============================================================================
// STATE DIFFING
// =============================================================================

interface CapturedState {
  roomName: string;
  occupants: Set<string>;
  objects: Set<string>;
  playerNeeds: { hunger: number; energy: number; social: number };
  componentValues: Record<string, number>; // Custom component values on player
}

function capturePlayerState(world: any, playerEid: number, snapshot: WorldSnapshot): CapturedState {
  // Capture custom component values (Sanity, OccultKnowledge, etc.)
  const componentValues: Record<string, number> = {};
  try {
    for (const name of listNames()) {
      const comp = getComponent(name);
      if (!comp) continue;
      for (const prop of Object.keys(comp)) {
        const val = comp[prop]?.[playerEid];
        if (typeof val === "number" && val !== 0) {
          componentValues[`${name}.${prop}`] = val;
        }
      }
    }
  } catch {}

  return {
    roomName: snapshot.roomName,
    occupants: new Set(snapshot.people.map(p => p.name)),
    objects: new Set(snapshot.objects.map(o => o.name)),
    playerNeeds: {
      hunger: Needs.hunger[playerEid] || 0,
      energy: Needs.energy[playerEid] ?? 100,
      social: Needs.social[playerEid] ?? 50,
    },
    componentValues,
  };
}

function computeDiff(before: CapturedState, after: CapturedState, beforeSnap: WorldSnapshot, afterSnap: WorldSnapshot): StateDiff {
  const arrivals = [...after.occupants].filter(n => !before.occupants.has(n));
  const departures = [...before.occupants].filter(n => !after.occupants.has(n));
  const objectsAdded = [...after.objects].filter(n => !before.objects.has(n));
  const objectsRemoved = [...before.objects].filter(n => !after.objects.has(n));

  const componentChanges: Record<string, Record<string, { before: any; after: any }>> = {};

  // Check player needs
  for (const [need, beforeVal] of Object.entries(before.playerNeeds)) {
    const afterVal = (after.playerNeeds as any)[need];
    if (beforeVal !== afterVal) {
      if (!componentChanges["Needs"]) componentChanges["Needs"] = {};
      componentChanges["Needs"][need] = { before: beforeVal, after: afterVal };
    }
  }

  // Check custom components
  const allKeys = new Set([...Object.keys(before.componentValues), ...Object.keys(after.componentValues)]);
  for (const key of allKeys) {
    const bv = before.componentValues[key] ?? 0;
    const av = after.componentValues[key] ?? 0;
    if (bv !== av) {
      const [comp, prop] = key.split(".");
      if (!componentChanges[comp]) componentChanges[comp] = {};
      componentChanges[comp][prop] = { before: bv, after: av };
    }
  }

  const playerMoved = before.roomName !== after.roomName
    ? { from: before.roomName, to: after.roomName }
    : undefined;

  return { componentChanges, arrivals, departures, objectsAdded, objectsRemoved, playerMoved };
}

function emptyDiff(): StateDiff {
  return { componentChanges: {}, arrivals: [], departures: [], objectsAdded: [], objectsRemoved: [] };
}
