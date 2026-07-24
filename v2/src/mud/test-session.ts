/**
 * ArgOS — NLE+LIL Playtest Session
 *
 * Scripted session that tests the full LSE Trinity:
 *   - ECS world created by God AI genesis
 *   - NLE story scaffold with tensions and dramatic beats
 *   - LIL intent parsing and grounded narration
 *   - NPC responses through their own cognition
 *
 * Run: cd v2 && npx tsx src/mud/test-session.ts
 */

import "dotenv/config";
import { createSimulation } from "../index";
import { query, hasComponent } from "bitecs";
import { Agent, Name, Description, Room, Needs, Traits } from "../ecs/components";
import { getRoomForEntity, listDirectContents } from "../ecs/location";
import { createAgentEntity } from "../ecs/prefabs";
import { registerEntity, executeActions, getActiveGoals } from "../cognition/cognition-system";
import { agentThink, addPerception, getAgentThoughts, addConversationTurn } from "../cognition/agent-mind";
import { Thought } from "../ecs/components";
import { getRelationTargets } from "bitecs";
import { HasThought } from "../ecs/relations";
import { getAspirations } from "../cognition/goal-learning";
import { setAgentBehaviorPolicy } from "../cognition/behavior-policy";
import { createWorldClock, advanceWorldClock, expireWorldEvents, getClockState } from "../systems/world-clock";
import { extractKnowledgeFromInteraction } from "../cognition/knowledge-graph";
import { accumulateImportance } from "../cognition/reflection-system";
import { processSpeechImpact, propagateGossip } from "../lil/speech-impact";

// NLE + LIL
import { generateStoryScaffold, getStoryScaffold } from "../nle/story-scaffold";
import { runNarrativeDirectorCycle } from "../nle/narrative-director";
import { parsePlayerIntent, type ConversationEntry } from "../lil/intent-parser";
import { renderNarrative, renderRoomDescription, type NpcResponse } from "../lil/world-renderer";
import { buildWorldSnapshot } from "../lil/world-snapshot";
import { queueStimulus } from "../cognition/cognition-system";

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", italic: "\x1b[3m",
  yellow: "\x1b[33m", cyan: "\x1b[36m", green: "\x1b[32m", red: "\x1b[31m",
  magenta: "\x1b[35m", white: "\x1b[37m", gray: "\x1b[90m",
};

const SEED = "A medieval village with a blacksmith forge, a cozy tavern, and a market. Rumors of bandits in the nearby forest.";
const PLAYER_NAME = "Traveler";
const PLAYER_ROLE = "wandering adventurer";

const origLog = console.log;
let showGenesisLogs = true;
console.log = (...args: any[]) => {
  if (!showGenesisLogs) return;
  const msg = args.map(String).join(" ");
  if (msg.includes("[Tool] create")) {
    origLog(`  ${C.dim}${msg.replace(/\[Tool\] /, "+ ").split("(")[0].trim()}${C.reset}`);
  } else if (msg.includes("[NLE]")) {
    origLog(`  ${C.magenta}${msg.replace("[NLE] ", "")}${C.reset}`);
  } else if (msg.includes("Genesis complete")) {
    origLog(`${C.green}${C.bold}World ready.${C.reset}`);
  } else if (msg.includes("[GodAgent] Calling")) {
    origLog(`${C.dim}Shaping world...${C.reset}`);
  }
};

function print(text: string) { origLog(text); }
function blank() { print(""); }

// =============================================================================
// GAME TURN (same as mud-client)
// =============================================================================

const conversationHistory: ConversationEntry[] = [];

async function gameTurn(input: string, world: any, playerEid: number, sim: any): Promise<string> {
  const snapshot = buildWorldSnapshot(world, playerEid);
  const intent = await parsePlayerIntent(input, snapshot, conversationHistory);

  if (intent.impossible) {
    conversationHistory.push({ role: "player", content: input });
    const narration = await renderNarrative({
      snapshot, playerIntent: intent, npcResponses: [], conversationHistory,
    });
    conversationHistory.push({ role: "dm", content: narration });
    return narration;
  }

  const npcResponses: NpcResponse[] = [];

  for (const action of intent.actions) {
    if (action.type === "speak" && action.target) {
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
          } else if (npcAction.type === "think" && npcAction.content) {
            response = { name: npcName, action: { type: "speak", content: npcAction.content }, innerThought };
          } else if (innerThought) {
            response = { name: npcName, action: { type: "speak", content: innerThought }, innerThought };
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

        } catch {}
      }
    } else if (action.type !== "wait" && action.type !== "speak") {
      try {
        await executeActions(world, [{ eid: playerEid, action }] as any, sim.god?.systemRegistry);
      } catch {}
    }
  }

  // Advance world
  for (let i = 0; i < 3; i++) { advanceWorldClock(world); expireWorldEvents(world); }
  Needs.hunger[playerEid] = Math.min(100, (Needs.hunger[playerEid] || 0) + 2);
  Needs.energy[playerEid] = Math.max(0, (Needs.energy[playerEid] ?? 100) - 1);

  // Narrative director + gossip
  await runNarrativeDirectorCycle(world);
  propagateGossip(world);

  // Render
  const updated = buildWorldSnapshot(world, playerEid);
  conversationHistory.push({ role: "player", content: input });
  const narration = await renderNarrative({
    snapshot: updated,
    playerIntent: intent,
    npcResponses,
    conversationHistory,
  });
  conversationHistory.push({ role: "dm", content: narration });

  if (conversationHistory.length > 30) conversationHistory.splice(0, conversationHistory.length - 20);

  return narration;
}

// =============================================================================
// SCRIPT
// =============================================================================

const SCRIPT = [
  "I look around carefully, taking in every detail of my surroundings.",
  "I approach the blacksmith and introduce myself. \"Well met. I'm a traveler — just arrived. Fine forge you have here.\"",
  "I ask him what he knows about the bandits people have been whispering about on the road.",
  "I thank him and head to the tavern for a drink and to hear the local gossip.",
  "I look around the tavern and see who's here.",
  "I sit at the bar and ask the innkeeper for a drink, and whether she's heard anything about trouble on the roads.",
];

async function main() {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    origLog("No API key"); process.exit(1);
  }

  origLog(`\n${C.bold}${C.green}╔══════════════════════════════════════════════════════════════╗${C.reset}`);
  origLog(`${C.bold}${C.green}║       ArgOS — NLE + LIL Playtest Session                    ║${C.reset}`);
  origLog(`${C.bold}${C.green}╚══════════════════════════════════════════════════════════════╝${C.reset}\n`);

  origLog(`${C.dim}Creating world from seed...${C.reset}\n`);

  const sim = await createSimulation({
    name: "Playtest",
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

  // Create player
  const allRooms = Array.from(query(sim.world, [Room as any, Name as any]));
  const startRoom = allRooms.length > 0 ? allRooms[0] : undefined;
  const playerEid = createAgentEntity(sim.world, {
    name: PLAYER_NAME, role: PLAYER_ROLE,
    systemPrompt: `You are ${PLAYER_NAME}, controlled by a human player.`,
    description: `A ${PLAYER_ROLE} who recently arrived.`,
    roomId: startRoom,
  });
  registerEntity(playerEid, PLAYER_NAME);
  Agent.active[playerEid] = false;
  setAgentBehaviorPolicy(sim.world, playerEid, { type: "noop" }, false);

  // Opening
  blank();
  const snapshot = buildWorldSnapshot(sim.world, playerEid);
  const opening = await renderRoomDescription(snapshot);
  origLog(`${C.italic}${opening}${C.reset}`);

  // Play through script
  for (const input of SCRIPT) {
    blank();
    origLog(`${C.green}${C.bold}> ${C.reset}${C.white}${input}${C.reset}`);
    origLog(`${C.dim}...${C.reset}`);

    try {
      const narration = await gameTurn(input, sim.world, playerEid, sim);
      blank();
      origLog(`${C.white}${narration}${C.reset}`);
    } catch (err) {
      origLog(`${C.red}Error: ${(err as Error).message}${C.reset}`);
    }
  }

  blank();
  origLog(`${C.bold}${C.green}═══ Session Complete ═══${C.reset}`);
  process.exit(0);
}

main().catch(err => { origLog(err); process.exit(1); });
