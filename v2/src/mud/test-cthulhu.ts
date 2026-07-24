/**
 * ArgOS — Cthulhu Mystery Extended Playtest
 *
 * 10-turn investigation through a Lovecraftian coastal town.
 * Uses the full cognitive pipeline from mud-client.ts:
 *   - Conversation turns + multi-turn coherence
 *   - Knowledge extraction from interactions
 *   - Speech impact (impressions, goals, gossip)
 *   - Inner thought capture
 *   - Importance accumulation for reflection
 *   - Narrative director + gossip propagation
 *
 * Run: cd v2 && npx tsx src/mud/test-cthulhu.ts
 */

import "dotenv/config";
import { createSimulation } from "../index";
import { query, hasComponent } from "bitecs";
import {
  Agent, Name, Description, Room, Needs, Traits, Thought,
} from "../ecs/components";
import { HasThought } from "../ecs/relations";
import { getRoomForEntity, listDirectContents } from "../ecs/location";
import { createAgentEntity } from "../ecs/prefabs";
import {
  registerEntity, executeActions, getActiveGoals,
  queueStimulus,
} from "../cognition/cognition-system";
import {
  agentThink, addPerception, getAgentThoughts, addConversationTurn,
} from "../cognition/agent-mind";
import { getAspirations } from "../cognition/goal-learning";
import { setAgentBehaviorPolicy } from "../cognition/behavior-policy";
import { extractKnowledgeFromInteraction } from "../cognition/knowledge-graph";
import { accumulateImportance } from "../cognition/reflection-system";
import {
  createWorldClock, advanceWorldClock, expireWorldEvents, getClockState,
} from "../systems/world-clock";
import { processSpeechImpact, propagateGossip } from "../lil/speech-impact";

// NLE + LIL
import { generateStoryScaffold, getStoryScaffold } from "../nle/story-scaffold";
import { runNarrativeDirectorCycle } from "../nle/narrative-director";
import { parsePlayerIntent, type ConversationEntry } from "../lil/intent-parser";
import { renderNarrative, renderRoomDescription, type NpcResponse } from "../lil/world-renderer";
import { buildWorldSnapshot } from "../lil/world-snapshot";

// =============================================================================
// CONFIG
// =============================================================================

const SEED = "A fog-shrouded 1920s New England coastal town called Innsmouth Cove. Professor Aldric Marsh has vanished from Miskatonic University after researching forbidden texts in the restricted archives. His study is locked from the inside. Strange lights pulse over the harbor at night. The local fishermen have become secretive — they won't speak about what their nets have been pulling from the deep. An ancient stone church on the cliff has been holding midnight services again after decades of silence. Something very old and very wrong stirs beneath the waves. The town reeks of salt and decay. Create a Sanity component (0=mad, 100=stable) for all agents and the player. Create an OccultKnowledge component (dangerous to accumulate — the more you know, the faster Sanity decays). Create investigation affordances: investigate_clue, read_forbidden_text (costs Sanity), interrogate_witness. Create a system that decays Sanity when OccultKnowledge exceeds 30.";

const PLAYER_NAME = "Detective Crane";
const PLAYER_ROLE = "private investigator from Boston, hired by the university to find the missing professor";

// =============================================================================
// COLORS
// =============================================================================

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", italic: "\x1b[3m",
  yellow: "\x1b[33m", cyan: "\x1b[36m", green: "\x1b[32m", red: "\x1b[31m",
  magenta: "\x1b[35m", white: "\x1b[37m", gray: "\x1b[90m",
};

const origLog = console.log;
let showGenesisLogs = true;
let logOutput: string[] = [];

console.log = (...args: any[]) => {
  const msg = args.map(String).join(" ");
  logOutput.push(msg);

  if (!showGenesisLogs) return;

  if (msg.includes("[Tool] createRoom:")) {
    origLog(`  ${C.green}+${C.reset} ${C.white}${msg.split("[Tool] createRoom:")[1]?.trim()}${C.reset}`);
  } else if (msg.includes("[Tool] createAgent:") && msg.includes("aspirations:")) {
    const parts = msg.split("aspirations:");
    const info = parts[0].split("[Tool] createAgent:")[1]?.trim().split(" (")[0];
    origLog(`  ${C.cyan}+${C.reset} ${C.white}${info}${C.reset}`);
    if (parts[1]) for (const a of parts[1].trim().split(";").slice(0, 3)) {
      origLog(`    ${C.dim}${C.italic}dreams: ${a.trim()}${C.reset}`);
    }
  } else if (msg.includes("[Tool] createAgent:")) {
    origLog(`  ${C.cyan}+${C.reset} ${C.white}${msg.split("[Tool] createAgent:")[1]?.trim()}${C.reset}`);
  } else if (msg.includes("[Tool] createObject:")) {
    origLog(`  ${C.dim}+ ${msg.split("[Tool] createObject:")[1]?.trim()}${C.reset}`);
  } else if (msg.includes("[Tool] createComponent:")) {
    origLog(`  ${C.magenta}+ component: ${msg.split("[Tool] createComponent:")[1]?.trim()}${C.reset}`);
  } else if (msg.includes("[Tool] createAffordance:")) {
    origLog(`  ${C.yellow}+ affordance: ${msg.split("[Tool] createAffordance:")[1]?.trim()}${C.reset}`);
  } else if (msg.includes("[Tool] createSystem:")) {
    origLog(`  ${C.yellow}+ system: ${msg.split("[Tool] createSystem:")[1]?.trim()}${C.reset}`);
  } else if (msg.includes("[GodAgent] Thinking")) {
    origLog(`\n${C.dim}${C.italic}The world stirs...${C.reset}`);
  } else if (msg.includes("[GodAgent] Calling Gemini")) {
    origLog(`${C.dim}${C.italic}Reality takes shape...${C.reset}`);
  } else if (msg.includes("Genesis complete")) {
    origLog(`\n${C.green}${C.bold}The world is ready.${C.reset}`);
  } else if (msg.includes("[NLE]")) {
    origLog(`  ${C.magenta}${msg.replace("[NLE] ", "")}${C.reset}`);
  }
};

function print(text: string) { origLog(text); }
function blank() { print(""); }

// =============================================================================
// GAME TURN — full cognitive pipeline from mud-client.ts
// =============================================================================

const conversationHistory: ConversationEntry[] = [];
let lastNarrationOutput = "";

async function gameTurn(input: string, world: any, playerEid: number, sim: any): Promise<string> {
  const snapshot = buildWorldSnapshot(world, playerEid);

  // Parse intent
  const intent = await parsePlayerIntent(input, snapshot, conversationHistory);

  if (intent.impossible) {
    conversationHistory.push({ role: "player", content: input });
    const narration = await renderNarrative({
      snapshot, playerIntent: intent, npcResponses: [], conversationHistory,
    });
    conversationHistory.push({ role: "dm", content: narration });
    lastNarrationOutput = narration;
    return narration;
  }

  // Post-process: upgrade observe to affordance-specific interact
  const inputLower = input.toLowerCase();
  // Debug: uncomment to trace affordance matching
  // origLog(`  [LIL] Affordances: ${snapshot.affordances.slice(0, 5).join(", ")} | Parser: ${intent.actions.map(a => `${a.type}:${a.target || "?"}`).join(", ")}`);
  for (const action of intent.actions) {
    // Try to match ANY action type against available affordances
    for (const aff of snapshot.affordances) {
      const affName = aff.split(" (")[0];
      const affWords = affName.split("_");
      if (affWords.length >= 2 &&
          (affWords.every(w => inputLower.includes(w)) ||
           inputLower.includes(affName.replace(/_/g, " ")))) {
        origLog(`  ${C.dim}[LIL] Matched affordance: ${affName} from input "${input.slice(0, 40)}"${C.reset}`);
        action.type = "interact";
        action.content = affName;
        if (!action.target && snapshot.objects.length > 0) {
          const bestMatch = snapshot.objects.find(o =>
            o.traits.some(t => affName.includes(t)) ||
            affWords.some(w => o.name.toLowerCase().includes(w))
          ) || snapshot.objects[0];
          action.target = bestMatch.name;
          origLog(`  ${C.dim}[LIL] Auto-resolved target: ${bestMatch.name}${C.reset}`);
        }
        break;
      }
    }
  }

  // Execute actions + collect NPC responses
  const npcResponses: NpcResponse[] = [];

  for (const action of intent.actions) {
    if (action.type === "speak" && action.target) {
      // Directed speech to a specific NPC
      const allAgents = Array.from(query(world, [Agent as any, Name as any]));
      const targetEid = allAgents.find((eid: number) =>
        (Name.value[eid] || "").toLowerCase().includes(action.target!.toLowerCase()));

      if (targetEid !== undefined) {
        const npcName = Name.value[targetEid] || action.target!;
        const speechContent = action.content || "";

        // 1. Inject speech as perception
        addPerception(world, targetEid, {
          type: "directed_speech",
          content: `${PLAYER_NAME} says to you: "${speechContent}"`,
          source: PLAYER_NAME,
          intensity: 1,
        });

        // 2. Record conversation turn for multi-turn coherence
        addConversationTurn(world, targetEid, "user", `${PLAYER_NAME}: "${speechContent}"`);

        try {
          // 3. Full cognition fires
          const npcAction = await agentThink(world, targetEid);

          // 4. Capture innerThought
          const thoughtEids = getAgentThoughts(world, targetEid);
          const latestThought = thoughtEids
            .sort((a, b) => (Thought.timestamp[b] || 0) - (Thought.timestamp[a] || 0))[0];
          const innerThought = latestThought ? (Thought.content[latestThought] || "") : "";

          // 5. Execute (filter hostile)
          if (npcAction.type !== "attack" && npcAction.type !== "defend") {
            await executeActions(world, [{ eid: targetEid, action: npcAction }] as any, sim.god?.systemRegistry);
          }

          // 6. Coerce to dialogue with innerThought
          let response: NpcResponse;
          if (npcAction.type === "attack" || npcAction.type === "defend") {
            response = { name: npcName, action: { type: "observe" }, innerThought: "eyes narrow with suspicion" };
          } else if (npcAction.type === "speak" && npcAction.content) {
            response = { name: npcName, action: npcAction, innerThought };
          } else if ((npcAction.type === "think" && npcAction.content) || innerThought) {
            response = { name: npcName, action: { type: "speak", content: npcAction.content || innerThought }, innerThought };
          } else {
            response = { name: npcName, action: npcAction, innerThought };
          }
          npcResponses.push(response);

          // 7. Record NPC conversation turn
          const npcSpeech = response.action.type === "speak" ? (response.action.content || "") : "";
          if (npcSpeech) addConversationTurn(world, targetEid, "assistant", `${npcName}: "${npcSpeech}"`);

          // 8. Knowledge extraction — NPC learns from conversation
          extractKnowledgeFromInteraction(world, targetEid, {
            type: "conversation",
            content: `${PLAYER_NAME} said: "${speechContent}". I responded: "${npcSpeech || innerThought}"`,
            otherParty: PLAYER_NAME,
            context: `Conversation in ${snapshot.roomName}`,
          }).catch(() => {});

          // 9. Reflection importance accumulates
          accumulateImportance(world, targetEid, 15);

          // 10. Speech impact — impressions, goals, gossip
          processSpeechImpact(world, targetEid, PLAYER_NAME, speechContent, npcSpeech).catch(() => {});

        } catch (err) {
          origLog(`${C.dim}  [NPC cognition error: ${(err as Error).message?.slice(0, 80)}]${C.reset}`);
        }
      }
    } else if (action.type === "speak" && !action.target) {
      // Broadcast speech — trigger all NPCs in room
      const roomEid = getRoomForEntity(world, playerEid);
      if (roomEid !== undefined) {
        for (const eid of listDirectContents(world, roomEid)) {
          if (eid === playerEid || !hasComponent(world, eid, Agent as any)) continue;
          const npcName = Name.value[eid] || "someone";
          addPerception(world, eid, {
            type: "speech",
            content: `${PLAYER_NAME} says: "${action.content || ""}"`,
            source: PLAYER_NAME, intensity: 0.8,
          });
          addConversationTurn(world, eid, "user", `${PLAYER_NAME}: "${action.content || ""}"`);
          try {
            const npcAction = await agentThink(world, eid);
            const thoughtEids = getAgentThoughts(world, eid);
            const lt = thoughtEids.sort((a, b) => (Thought.timestamp[b] || 0) - (Thought.timestamp[a] || 0))[0];
            const it = lt ? (Thought.content[lt] || "") : "";
            if (npcAction.type !== "attack" && npcAction.type !== "defend") {
              await executeActions(world, [{ eid, action: npcAction }] as any, sim.god?.systemRegistry);
            }
            const coerced: NpcResponse = (npcAction.type === "speak" && npcAction.content)
              ? { name: npcName, action: npcAction, innerThought: it }
              : it ? { name: npcName, action: { type: "speak", content: it }, innerThought: it }
              : { name: npcName, action: npcAction, innerThought: it };
            npcResponses.push(coerced);
            const ns = coerced.action.type === "speak" ? (coerced.action.content || "") : "";
            if (ns) addConversationTurn(world, eid, "assistant", `${npcName}: "${ns}"`);
            extractKnowledgeFromInteraction(world, eid, {
              type: "conversation",
              content: `${PLAYER_NAME} said: "${action.content}". I responded: "${ns || it}"`,
              otherParty: PLAYER_NAME, context: `In ${snapshot.roomName}`,
            }).catch(() => {});
            accumulateImportance(world, eid, 10);
            processSpeechImpact(world, eid, PLAYER_NAME, action.content || "", ns).catch(() => {});
          } catch {}
        }
      }
    } else if (action.type !== "wait" && action.type !== "speak") {
      // Non-speech action (move, examine, etc.)
      try {
        await executeActions(world, [{ eid: playerEid, action }] as any, sim.god?.systemRegistry);
      } catch {}
    }
  }

  // Advance world clock
  for (let i = 0; i < 3; i++) { advanceWorldClock(world); expireWorldEvents(world); }

  // Need decay
  Needs.hunger[playerEid] = Math.min(100, (Needs.hunger[playerEid] || 0) + 2);
  Needs.energy[playerEid] = Math.max(0, (Needs.energy[playerEid] ?? 100) - 1);

  // Narrative director + gossip
  await runNarrativeDirectorCycle(world);
  propagateGossip(world);

  // Render
  const updated = buildWorldSnapshot(world, playerEid);
  (updated as any).lastRender = lastNarrationOutput;
  conversationHistory.push({ role: "player", content: input });
  const narration = await renderNarrative({
    snapshot: updated,
    playerIntent: intent,
    npcResponses,
    conversationHistory,
  });
  lastNarrationOutput = narration;
  conversationHistory.push({ role: "dm", content: narration });

  if (conversationHistory.length > 30) conversationHistory.splice(0, conversationHistory.length - 20);

  return narration;
}

// =============================================================================
// INVESTIGATION SCRIPT
// =============================================================================

const SCRIPT = [
  "I carefully examine the professor's study, looking for any clues about what happened.",
  "I pick up the forbidden text and read the first few pages, steeling myself.",
  "I examine the locked door — how is it locked from the inside if the professor is gone?",
  "I leave the study and head to the harbor to question the fishermen.",
  "I approach the nearest fisherman and ask about Professor Marsh and the strange lights.",
  "I press harder — I tell him I know about the midnight services at the church.",
  "I head to the old church on the cliff.",
  "I look around the church carefully, examining the altar and any symbols.",
  "I ask the priest what he knows about the professor's disappearance.",
  "I confront him — I tell him I found evidence linking the church to Marsh's research.",
];

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    origLog("No GOOGLE_GENERATIVE_AI_API_KEY"); process.exit(1);
  }

  const startTime = Date.now();

  origLog(`\n${C.bold}${C.green}╔══════════════════════════════════════════════════════════════╗${C.reset}`);
  origLog(`${C.bold}${C.green}║       ArgOS — Cthulhu Mystery Extended Playtest              ║${C.reset}`);
  origLog(`${C.bold}${C.green}╚══════════════════════════════════════════════════════════════╝${C.reset}\n`);

  origLog(`${C.dim}Seed: "${SEED.slice(0, 80)}..."${C.reset}`);
  origLog(`${C.dim}You are ${C.bold}${PLAYER_NAME}${C.reset}${C.dim}, a ${PLAYER_ROLE}.${C.reset}\n`);

  origLog(`${C.dim}Creating world from seed...${C.reset}\n`);

  const sim = await createSimulation({
    name: "Cthulhu Playtest",
    narrative: SEED,
    genesis: true,
    enableAI: true,
    enableSpirits: false,
    godAutopilot: false,
    dualLoop: false,
    enablePlanning: false,
  });

  createWorldClock(sim.world, { ticksPerPeriod: 30 });

  // Generate story scaffold
  origLog(`\n${C.dim}Weaving narrative threads...${C.reset}`);
  await generateStoryScaffold(sim.world, SEED);

  // Show scaffold
  const scaffold = getStoryScaffold(sim.world);
  if (scaffold) {
    origLog(`\n${C.magenta}${C.bold}Story Scaffold:${C.reset}`);
    for (const t of scaffold.tensions) {
      origLog(`  ${C.magenta}Tension: ${t.description}${C.reset}`);
      for (const b of t.beats) {
        origLog(`    ${C.dim}${b.act}: ${b.description}${C.reset}`);
      }
    }
    origLog(`\n${C.magenta}NPC Roles:${C.reset}`);
    for (const r of scaffold.npcRoles) {
      origLog(`  ${C.cyan}${r.name}${C.reset}: ${r.role}${r.secrets.length > 0 ? ` ${C.dim}(secret: ${r.secrets[0]})${C.reset}` : ""}`);
    }
  }

  showGenesisLogs = false;

  // Dump world state
  blank();
  origLog(`${C.bold}World Contents:${C.reset}`);
  const allRooms = Array.from(query(sim.world, [Room as any, Name as any]));
  for (const r of allRooms) {
    const rName = Name.value[r] || "?";
    const contents = listDirectContents(sim.world, r);
    const agents = contents.filter((e: number) => hasComponent(sim.world, e, Agent as any));
    const objects = contents.filter((e: number) => !hasComponent(sim.world, e, Agent as any));
    origLog(`  ${C.green}${rName}${C.reset}`);
    for (const a of agents) {
      const name = Name.value[a] || "?";
      const role = Agent.role[a] || "";
      const aspirations = getAspirations(a);
      origLog(`    ${C.cyan}${name}${C.reset} (${role})${aspirations.length > 0 ? ` — ${C.dim}${aspirations[0]}${C.reset}` : ""}`);
    }
    for (const o of objects) {
      origLog(`    ${C.dim}${Name.value[o] || "?"}${C.reset}`);
    }
  }

  // Create player in first room
  const startRoom = allRooms.length > 0 ? allRooms[0] : undefined;
  const playerEid = createAgentEntity(sim.world, {
    name: PLAYER_NAME, role: PLAYER_ROLE,
    systemPrompt: `You are ${PLAYER_NAME}, controlled by a human player.`,
    description: `A ${PLAYER_ROLE} who recently arrived in Innsmouth Cove.`,
    roomId: startRoom,
  });
  registerEntity(playerEid, PLAYER_NAME);
  Agent.active[playerEid] = false;
  setAgentBehaviorPolicy(sim.world, playerEid, { type: "noop" }, false);

  // Opening
  blank();
  origLog(`${C.bold}${C.yellow}═══ OPENING ═══${C.reset}`);
  const snapshot = buildWorldSnapshot(sim.world, playerEid);
  const opening = await renderRoomDescription(snapshot);
  origLog(`${C.italic}${opening}${C.reset}`);

  // Play through investigation script
  const turnResults: { input: string; narration: string; error?: string }[] = [];

  for (let i = 0; i < SCRIPT.length; i++) {
    const input = SCRIPT[i];
    blank();
    origLog(`${C.bold}${C.yellow}═══ TURN ${i + 1}/10 ═══${C.reset}`);
    origLog(`${C.green}${C.bold}> ${C.reset}${C.white}${input}${C.reset}`);
    origLog(`${C.dim}...${C.reset}`);

    try {
      const narration = await gameTurn(input, sim.world, playerEid, sim);
      blank();
      origLog(`${C.white}${narration}${C.reset}`);
      turnResults.push({ input, narration });
    } catch (err) {
      const errMsg = (err as Error).message || String(err);
      origLog(`${C.red}Error: ${errMsg}${C.reset}`);
      turnResults.push({ input, narration: "", error: errMsg });
    }
  }

  // Final world state
  blank();
  origLog(`${C.bold}${C.yellow}═══ FINAL WORLD STATE ═══${C.reset}`);
  const finalRooms = Array.from(query(sim.world, [Room as any, Name as any]));
  for (const r of finalRooms) {
    const rName = Name.value[r] || "?";
    const contents = listDirectContents(sim.world, r);
    const agents = contents.filter((e: number) => hasComponent(sim.world, e, Agent as any));
    origLog(`  ${C.green}${rName}${C.reset}: ${agents.map((a: number) => Name.value[a] || "?").join(", ") || "(empty)"}`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  blank();
  origLog(`${C.bold}${C.green}═══ Session Complete (${elapsed}s) ═══${C.reset}`);
  origLog(`${C.dim}${turnResults.filter(r => !r.error).length}/10 turns succeeded, ${turnResults.filter(r => r.error).length} errors${C.reset}`);

  // Write raw output for report
  const fs = await import("node:fs");
  const rawOutput = {
    seed: SEED,
    playerName: PLAYER_NAME,
    playerRole: PLAYER_ROLE,
    scaffold,
    turns: turnResults,
    worldRooms: finalRooms.map(r => ({
      name: Name.value[r] || "?",
      agents: listDirectContents(sim.world, r)
        .filter((e: number) => hasComponent(sim.world, e, Agent as any))
        .map((e: number) => Name.value[e] || "?"),
    })),
    elapsedSeconds: Number(elapsed),
    logLines: logOutput.length,
  };
  const dataDir = "/Users/parzival/workspace/oneirocom/project89/argos/v2/data";
  try { fs.mkdirSync(dataDir, { recursive: true }); } catch {}
  fs.writeFileSync(`${dataDir}/playtest-cthulhu-raw.json`, JSON.stringify(rawOutput, null, 2));
  origLog(`${C.dim}Raw output saved to data/playtest-cthulhu-raw.json${C.reset}`);

  process.exit(0);
}

main().catch(err => { origLog(err); process.exit(1); });
