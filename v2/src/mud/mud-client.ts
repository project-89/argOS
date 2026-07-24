/**
 * ArgOS — Continuous Living World MUD
 *
 * The world runs on its own clock. NPCs live their lives.
 * You see ambient narration as events happen around you.
 * Your input is just another event in the stream.
 *
 * Architecture:
 *   - World ticks continuously via dual-loop runtime
 *   - Event collector captures NPC actions, movements, speech in your room
 *   - Flash-Lite renders batched events as atmospheric prose every few seconds
 *   - Player input goes through LIL intent parser → ECS actions → NPC cognition
 *   - NLE shapes the story in the background
 *
 * Run:
 *   cd v2 && npx tsx src/mud/mud-client.ts
 */

import "dotenv/config";
import * as readline from "node:readline";
import { generateText } from "ai";
import { createSimulation, type ArgosSimulation } from "../index";
import { query, hasComponent } from "bitecs";
import {
  Agent, Name, Description, Room, Needs, Traits, Perception, Thought,
} from "../ecs/components";
import { HasThought } from "../ecs/relations";
import { getRoomForEntity, listDirectContents } from "../ecs/location";
import { createAgentEntity } from "../ecs/prefabs";
import {
  registerEntity, executeActions, getActiveGoals,
  queueStimulus,
} from "../cognition/cognition-system";
import {
  agentThink, addPerception, getAgentPerceptions,
  getAgentThoughts, addConversationTurn,
} from "../cognition/agent-mind";
import { getAspirations } from "../cognition/goal-learning";
import { worldSchema } from "../world/schema";
import { setAgentBehaviorPolicy } from "../cognition/behavior-policy";
import { extractKnowledgeFromInteraction } from "../cognition/knowledge-graph";
import { accumulateImportance } from "../cognition/reflection-system";
import { renderModel, intentModel } from "../llm/config";
import { extractJSON } from "../llm/json-extract";
import {
  createWorldClock, advanceWorldClock, getClockState,
  getActiveWorldEvents, expireWorldEvents,
} from "../systems/world-clock";

// NLE
import { generateStoryScaffold, getStoryScaffold } from "../nle/story-scaffold";
import { runNarrativeDirectorCycle, setDirectorGodAgent } from "../nle/narrative-director";
import { startBeatDetection, onBeatTriggered } from "../nle/beat-detector";
import { setNudgeDaemonRegistry } from "../nle/npc-nudge";
import { calculateNarrativeIntegrity } from "../nle/narrative-integrity";

// LIL
import { parsePlayerIntent, type ConversationEntry } from "../lil/intent-parser";
import { renderNarrative, renderRoomDescription, type NpcResponse } from "../lil/world-renderer";
import { buildWorldSnapshot } from "../lil/world-snapshot";
import { processSpeechImpact, propagateGossip } from "../lil/speech-impact";
import { gameTurn, initGameEngine } from "../lil/game-engine";

// =============================================================================
// CONFIG
// =============================================================================

const SEED = process.env.SEED || "A fog-shrouded 1920s New England coastal town called Innsmouth Cove. Professor Aldric Marsh has vanished from Miskatonic University after researching forbidden texts in the restricted archives. His study is locked from the inside. Strange lights pulse over the harbor at night. The local fishermen have become secretive — they won't speak about what their nets have been pulling from the deep. An ancient stone church on the cliff has been holding midnight services again after decades of silence. Something very old and very wrong stirs beneath the waves. The town reeks of salt and decay. Create a Sanity component (0=mad, 100=stable) for all agents and the player. Create an OccultKnowledge component (dangerous to accumulate — the more you know, the faster Sanity decays). Create investigation affordances: investigate_clue, read_forbidden_text (costs Sanity), interrogate_witness. Create a system that decays Sanity when OccultKnowledge exceeds 30.";
const PLAYER_NAME = process.env.PLAYER_NAME || "Detective Crane";
const PLAYER_ROLE = process.env.PLAYER_ROLE || "private investigator from Boston, hired by the university to find the missing professor";
const AMBIENT_INTERVAL_MS = 8000; // Render ambient narration every 8 seconds

// =============================================================================
// COLORS
// =============================================================================

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", italic: "\x1b[3m",
  yellow: "\x1b[33m", cyan: "\x1b[36m", green: "\x1b[32m", red: "\x1b[31m",
  magenta: "\x1b[35m", white: "\x1b[37m", gray: "\x1b[90m",
};

let origLog: typeof console.log;
function print(text: string) { origLog(text); }
function blank() { print(""); }

// =============================================================================
// EVENT COLLECTOR — captures what happens in the player's room
// =============================================================================

interface RoomEvent {
  type: "arrival" | "departure" | "speech" | "action" | "movement" | "world" | "goal";
  actor: string;
  detail: string;
  timestamp: number;
}

const eventBuffer: RoomEvent[] = [];
const recentAmbientLines: string[] = []; // Last 5 ambient outputs for dedup
let lastNarrationOutput = ""; // Last DM render for continuity
let lastKnownOccupants = new Set<string>();
let lastAmbientRender = 0;
let playerEid = 0;
let simWorld: any = null;
let isProcessingInput = false;

function collectRoomEvent(evt: RoomEvent) {
  // Deduplicate rapid events from same actor
  if (evt.type === "movement") {
    const existing = eventBuffer.findIndex(e =>
      e.type === "movement" && e.actor === evt.actor && (Date.now() - e.timestamp) < 3000);
    if (existing >= 0) { eventBuffer[existing] = evt; return; }
  }
  eventBuffer.push(evt);
}

// =============================================================================
// AMBIENT RENDERER — batches room events into atmospheric prose
// =============================================================================

async function renderAmbientNarration(): Promise<string | null> {
  if (eventBuffer.length === 0) return null;
  if (!simWorld || !playerEid) return null;

  const playerRoom = getRoomForEntity(simWorld, playerEid);
  if (playerRoom === undefined) return null;

  // Check arrivals/departures
  const currentOccupants = new Set<string>();
  for (const eid of listDirectContents(simWorld, playerRoom)) {
    if (eid === playerEid || !hasComponent(simWorld, eid, Agent as any)) continue;
    currentOccupants.add(Name.value[eid] || "");
  }
  const arrived = [...currentOccupants].filter(n => n && !lastKnownOccupants.has(n));
  const departed = [...lastKnownOccupants].filter(n => n && !currentOccupants.has(n));
  lastKnownOccupants = currentOccupants;

  // Add arrival/departure events
  for (const name of arrived) collectRoomEvent({ type: "arrival", actor: name, detail: "enters", timestamp: Date.now() });
  for (const name of departed) collectRoomEvent({ type: "departure", actor: name, detail: "leaves", timestamp: Date.now() });

  // Filter to events worth narrating
  const events = eventBuffer.splice(0, eventBuffer.length);
  if (events.length === 0 && arrived.length === 0 && departed.length === 0) return null;

  // Build event summary for Flash-Lite
  const roomName = Name.value[playerRoom] || "here";
  const clock = getClockState(simWorld);
  const eventLines = events.map(e => {
    switch (e.type) {
      case "arrival": return `${e.actor} arrives.`;
      case "departure": return `${e.actor} leaves.`;
      case "speech": return `${e.actor} says: "${e.detail}"`;
      case "action": return `${e.actor} ${e.detail}`;
      case "goal": return `${e.actor} seems focused on: ${e.detail}`;
      case "world": return e.detail;
      default: return `${e.actor} ${e.detail}`;
    }
  });

  if (eventLines.length === 0) return null;

  // Skip LLM for simple single events — render directly
  if (eventLines.length === 1) {
    const line = eventLines[0];
    // Don't repeat what we just said
    if (recentAmbientLines.some(r => r === line)) return null;
    recentAmbientLines.push(line);
    if (recentAmbientLines.length > 5) recentAmbientLines.shift();
    return line;
  }

  // Multiple events — use Flash-Lite to merge into 1-2 brief lines
  try {
    const recentContext = recentAmbientLines.length > 0
      ? `\nDO NOT repeat these recent descriptions:\n${recentAmbientLines.slice(-3).join("\n")}`
      : "";

    const result = await generateText({
      model: renderModel,
      temperature: 0.6,
      messages: [
        { role: "system", content: `You write MUD-style ambient updates. RULES:
- Maximum 1-2 SHORT sentences. Under 30 words total.
- Simple, direct, present tense. Like a MUD ticker.
- Only include dialogue if someone explicitly spoke.
- ONLY mention people and events from the list provided. Do NOT add anyone not listed.
- Do NOT describe the player's actions. Only describe what NPCs and the environment do.
- Examples of good output:
  "Garrick heads for the door, muttering about supplies."
  "The forge fire dims."
  "A distant shout echoes outside."
- Do NOT be flowery or literary. Be brief and factual.` },
        { role: "user", content: `${roomName}, ${clock.period}.\n${eventLines.join("\n")}${recentContext}` },
      ],
    });
    const rendered = result.text.trim();
    recentAmbientLines.push(rendered);
    if (recentAmbientLines.length > 5) recentAmbientLines.shift();
    return rendered;
  } catch {
    const fallback = eventLines.slice(0, 2).join(" ");
    recentAmbientLines.push(fallback);
    if (recentAmbientLines.length > 5) recentAmbientLines.shift();
    return fallback;
  }
}

// =============================================================================
// LOG INTERCEPTOR — captures simulation output as room events
// =============================================================================

let logPhase: "genesis" | "gameplay" = "genesis";

function installLogInterceptor() {
  origLog = console.log;

  console.log = (...args: any[]) => {
    const msg = args.map(String).join(" ");

    if (logPhase === "genesis") {
      // Genesis display (same as before)
      if (msg.includes("[Tool] createRoom:")) {
        origLog(`  ${C.green}+${C.reset} ${C.white}${msg.split("[Tool] createRoom:")[1]?.trim()}${C.reset}`);
      } else if (msg.includes("[Tool] createAgent:") && msg.includes("aspirations:")) {
        const parts = msg.split("aspirations:");
        const info = parts[0].split("[Tool] createAgent:")[1]?.trim().split(" (")[0];
        origLog(`  ${C.cyan}+${C.reset} ${C.white}${info}${C.reset}`);
        if (parts[1]) for (const a of parts[1].trim().split(";").slice(0, 2)) {
          origLog(`    ${C.dim}${C.italic}dreams: ${a.trim()}${C.reset}`);
        }
      } else if (msg.includes("[Tool] createAgent:")) {
        origLog(`  ${C.cyan}+${C.reset} ${C.white}${msg.split("[Tool] createAgent:")[1]?.trim()}${C.reset}`);
      } else if (msg.includes("[Tool] createObject:")) {
        origLog(`  ${C.dim}+ ${msg.split("[Tool] createObject:")[1]?.trim()}${C.reset}`);
      } else if (msg.includes("[Tool] createComponent:")) {
        origLog(`  ${C.magenta}+ ${msg.split("[Tool] createComponent:")[1]?.trim()}${C.reset}`);
      } else if (msg.includes("[Tool] createAffordance:")) {
        origLog(`  ${C.yellow}+ ${msg.split("[Tool] createAffordance:")[1]?.trim()}${C.reset}`);
      } else if (msg.includes("[GodAgent] Thinking")) {
        origLog(`\n${C.dim}${C.italic}The world stirs...${C.reset}`);
      } else if (msg.includes("[GodAgent] Calling Gemini")) {
        origLog(`${C.dim}${C.italic}Reality takes shape...${C.reset}`);
      } else if (msg.includes("Genesis complete")) {
        origLog(`\n${C.green}${C.bold}The world is ready.${C.reset}`);
      } else if (msg.includes("[NLE]")) {
        origLog(`  ${C.magenta}${msg.replace("[NLE] ", "")}${C.reset}`);
      } else if (msg.includes("[Spirit]") && msg.includes("Created")) {
        const match = msg.match(/"([^"]+)"/);
        if (match) origLog(`  ${C.dim}${match[1]} awakens${C.reset}`);
      }
      return;
    }

    // Gameplay: capture events for ambient rendering
    if (logPhase === "gameplay" && !isProcessingInput) {
      if (msg.includes("🚶") && simWorld && playerEid) {
        const match = msg.match(/🚶 (.+?) moves from (.+?) to (.+)/);
        if (match) {
          const playerRoom = getRoomForEntity(simWorld, playerEid);
          const playerRoomName = playerRoom !== undefined ? (Name.value[playerRoom] || "").toLowerCase() : "";
          if (match[3].toLowerCase().includes(playerRoomName) || match[2].toLowerCase().includes(playerRoomName)) {
            collectRoomEvent({ type: "movement", actor: match[1], detail: `heads to ${match[3]}`, timestamp: Date.now() });
          }
        }
      }
      if (msg.includes("[AutonomousGoal]") && msg.includes("sets goal")) {
        const match = msg.match(/\] (.+?) sets goal: "(.+?)"/);
        if (match) collectRoomEvent({ type: "goal", actor: match[1], detail: match[2], timestamp: Date.now() });
      }
      if (msg.includes("[Affordance]") && !msg.includes("talk") && !msg.includes("examine")) {
        const match = msg.match(/(\w[\w\s]*?) -> (\w+) -> (.+?):/);
        if (match) collectRoomEvent({ type: "action", actor: match[1], detail: `${match[2]}s the ${match[3].split(":")[0]}`, timestamp: Date.now() });
      }
    }
  };
}

// =============================================================================
// PLAYER ACTION HANDLER — delegates to unified game engine
// =============================================================================

async function handlePlayerInput(
  input: string,
  world: any,
  pEid: number,
  sim: ArgosSimulation,
): Promise<string | null> {
  const result = await gameTurn(input, world as any, pEid, sim.god?.systemRegistry);
  return result.narration;
}

// =============================================================================

// SLASH COMMANDS
// =============================================================================

async function handleSlashCommand(cmd: string, world: any, pEid: number): Promise<string | null> {
  const c = cmd.slice(1).toLowerCase().trim();
  if (c === "look" || c === "l") {
    const snapshot = buildWorldSnapshot(world, pEid);
    return await renderRoomDescription(snapshot);
  }
  if (c === "map" || c === "m") {
    const allRooms = Array.from(query(world, [Room as any, Name as any]));
    const playerRoom = getRoomForEntity(world, pEid);
    const lines = ["World Map:", ""];
    for (const r of allRooms) {
      const name = Name.value[r] || "?";
      const isHere = r === playerRoom;
      const agents = listDirectContents(world, r).filter((e: number) => e !== pEid && hasComponent(world, e, Agent as any));
      const names = agents.map((e: number) => Name.value[e] || "?");
      lines.push(`${isHere ? "> " : "  "}${name}${names.length > 0 ? `  [${names.join(", ")}]` : ""}${isHere ? "  <-- you" : ""}`);
    }
    return lines.join("\n");
  }
  if (c === "who") {
    const allAgents = Array.from(query(world, [Agent as any, Name as any]));
    const lines = ["People:", ""];
    for (const eid of allAgents) {
      if (eid === pEid) continue;
      const name = Name.value[eid] || "?";
      const role = Agent.role[eid] || "";
      const room = getRoomForEntity(world, eid);
      const rn = room !== undefined ? Name.value[room] || "?" : "?";
      const goals = getActiveGoals(world, eid);
      lines.push(`  ${name} (${role}) — ${rn}${goals.length > 0 ? `, "${goals[0].description}"` : ""}`);
    }
    return lines.join("\n");
  }
  if (c === "status") {
    const h = Needs.hunger[pEid] || 0;
    const e = Needs.energy[pEid] ?? 100;
    return `${PLAYER_NAME} (${PLAYER_ROLE})\n  Hunger: ${h > 70 ? "starving" : h > 40 ? "hungry" : "satisfied"} (${h}/100)\n  Energy: ${e < 30 ? "exhausted" : e < 60 ? "tired" : "rested"} (${e}/100)`;
  }
  if (c === "story") {
    const scaffold = getStoryScaffold(world);
    if (!scaffold) return "No narrative active.";
    const integrity = calculateNarrativeIntegrity(world);
    const lines = [`Story — Act: ${scaffold.currentAct} | Integrity: ${integrity.score}% (${integrity.status})`, ""];
    for (const t of scaffold.tensions) {
      lines.push(`  ${t.status === "active" ? "▶" : "✓"} ${t.description}`);
      lines.push(`    ${t.beats.map(b => b.status === "pending" ? "○" : "●").join("")}`);
    }
    return lines.join("\n");
  }
  if (c === "time") { const ck = getClockState(world); return `${ck.period}, Day ${ck.day}.`; }
  if (c === "help" || c === "?") {
    return `Type what you want to do. The world moves around you.

  /look — describe surroundings
  /map — world overview
  /who — where is everyone
  /status — your condition
  /story — narrative status
  /time — time of day
  /quit — leave`;
  }
  if (c === "quit" || c === "q") { print(`\n${C.italic}You fade from the world...${C.reset}`); process.exit(0); }
  return null;
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    console.error("No GOOGLE_GENERATIVE_AI_API_KEY"); process.exit(1);
  }

  installLogInterceptor();

  print(`\n${C.bold}${C.green}╔══════════════════════════════════════════════════════════════╗${C.reset}`);
  print(`${C.bold}${C.green}║             ArgOS — A Living World                          ║${C.reset}`);
  print(`${C.bold}${C.green}╚══════════════════════════════════════════════════════════════╝${C.reset}\n`);
  print(`${C.dim}Seed: "${SEED.slice(0, 65)}${SEED.length > 65 ? "..." : ""}"${C.reset}`);
  print(`${C.dim}You are ${C.bold}${PLAYER_NAME}${C.reset}${C.dim}, a ${PLAYER_ROLE}.${C.reset}\n`);

  const sim = await createSimulation({
    name: "ArgOS",
    narrative: SEED,
    genesis: true,
    enableAI: true,
    enableSpirits: true,
    godAutopilot: true,
    dualLoop: true,
    ecsTickRate: 0.5,      // One tick every 2 seconds
    ecsDeltaMs: 2000,
    enablePlanning: true,
  });

  createWorldClock(sim.world, { ticksPerPeriod: 30 });

  print(`\n${C.dim}${C.italic}Weaving narrative threads...${C.reset}`);
  await generateStoryScaffold(sim.world, SEED);

  // Wire NLE
  startBeatDetection(sim.world);
  setDirectorGodAgent(sim.god);
  if (sim.daemons) setNudgeDaemonRegistry(sim.daemons);

  logPhase = "gameplay";
  simWorld = sim.world;

  // Detect genre from seed
  const seedLower = SEED.toLowerCase();
  const genre = seedLower.includes("cthulhu") || seedLower.includes("horror") || seedLower.includes("sanity") ? "horror" :
                seedLower.includes("noir") || seedLower.includes("detective") || seedLower.includes("1940") ? "noir" :
                seedLower.includes("space") || seedLower.includes("station") || seedLower.includes("starship") ? "scifi" :
                seedLower.includes("medieval") || seedLower.includes("village") || seedLower.includes("tavern") ? "fantasy" : undefined;

  // Initialize game engine
  initGameEngine({ playerName: PLAYER_NAME, playerRole: PLAYER_ROLE, genre });

  // Create player
  const allRooms = Array.from(query(sim.world, [Room as any, Name as any]));
  const startRoom = allRooms.length > 0 ? allRooms[0] : undefined;

  playerEid = createAgentEntity(sim.world, {
    name: PLAYER_NAME, role: PLAYER_ROLE,
    systemPrompt: `You are ${PLAYER_NAME}, controlled by a human player.`,
    description: `A ${PLAYER_ROLE} who recently arrived.`,
    roomId: startRoom,
  });
  registerEntity(playerEid, PLAYER_NAME);
  Agent.active[playerEid] = false;
  setAgentBehaviorPolicy(sim.world, playerEid, { type: "noop" }, false);

  // Initialize room occupants
  if (startRoom !== undefined) {
    for (const eid of listDirectContents(sim.world, startRoom)) {
      if (eid === playerEid || !hasComponent(sim.world, eid, Agent as any)) continue;
      lastKnownOccupants.add(Name.value[eid] || "");
    }
  }

  // Start simulation (runs continuously in background)
  await sim.start();

  // Opening
  blank();
  const snapshot = buildWorldSnapshot(sim.world, playerEid);
  const opening = await renderRoomDescription(snapshot);
  print(`${C.white}${opening}${C.reset}`);
  print(`\n${C.dim}The world is alive around you. Type what you want to do, or /help.${C.reset}`);

  // Subscribe to chronicle for NPC activity in player's room
  const { chronicle } = await import("../cognition/simulation-chronicle");
  chronicle.subscribe((entry) => {
    if (isProcessingInput) return;
    if (!simWorld || !playerEid) return;

    const playerRoom = getRoomForEntity(simWorld, playerEid);
    if (playerRoom === undefined) return;
    const playerRoomName = (Name.value[playerRoom] || "").toLowerCase();

    const data = entry.data || {};
    const agent = String(data.agent || data.actor || "").trim();
    if (!agent || agent === PLAYER_NAME) return;

    // Check if this agent is in our room
    const allAgents = Array.from(query(simWorld, [Agent as any, Name as any]));
    const agentEid = allAgents.find(e => (Name.value[e] || "").toLowerCase() === agent.toLowerCase());
    if (agentEid === undefined) return;
    const agentRoom = getRoomForEntity(simWorld, agentEid);
    if (agentRoom !== playerRoom) {
      // Agent not in our room — only capture if they're arriving/leaving
      if (entry.type === "action_success" && String(data.action || "").includes("move")) {
        const dest = String(data.to || "").toLowerCase();
        const from = String(data.from || "").toLowerCase();
        if (dest === playerRoomName) {
          collectRoomEvent({ type: "arrival", actor: agent, detail: `arrives from ${data.from || "elsewhere"}`, timestamp: Date.now() });
        } else if (from === playerRoomName) {
          collectRoomEvent({ type: "departure", actor: agent, detail: `leaves toward ${data.to || "elsewhere"}`, timestamp: Date.now() });
        }
      }
      return;
    }

    // Agent IS in our room — capture their activity
    switch (entry.type) {
      case "policy_decision":
      case "llm_decision": {
        const action = String(data.action || "");
        if (action.includes("speak") || action.includes("talk")) {
          // NPC speech will be captured separately
        } else if (action.includes("observe")) {
          collectRoomEvent({ type: "action", actor: agent, detail: "looks around carefully", timestamp: Date.now() });
        } else if (action.includes("interact")) {
          collectRoomEvent({ type: "action", actor: agent, detail: action.replace("→", " with "), timestamp: Date.now() });
        } else if (action.includes("think")) {
          collectRoomEvent({ type: "action", actor: agent, detail: "pauses, lost in thought", timestamp: Date.now() });
        } else if (action.includes("rest")) {
          collectRoomEvent({ type: "action", actor: agent, detail: "shifts weight and rests", timestamp: Date.now() });
        } else if (action.includes("wait")) {
          // Skip — waiting is invisible
        } else if (action.includes("move")) {
          collectRoomEvent({ type: "departure", actor: agent, detail: `heads for the door`, timestamp: Date.now() });
        }
        break;
      }
      case "conversation": {
        const content = String(data.content || data.speech || "").slice(0, 80);
        if (content) collectRoomEvent({ type: "speech", actor: agent, detail: content, timestamp: Date.now() });
        break;
      }
      case "autonomous_goal": {
        collectRoomEvent({ type: "goal", actor: agent, detail: String(data.goal || "something"), timestamp: Date.now() });
        break;
      }
      case "action_success": {
        const action = String(data.action || "");
        if (action && !action.includes("move")) {
          collectRoomEvent({ type: "action", actor: agent, detail: action, timestamp: Date.now() });
        }
        break;
      }
    }
  });

  // Ambient narration loop — renders collected events periodically
  const ambientLoop = setInterval(async () => {
    if (isProcessingInput) return;

    // Advance world clock
    advanceWorldClock(sim.world);
    expireWorldEvents(sim.world);

    // Run narrative director occasionally
    runNarrativeDirectorCycle(sim.world).catch(() => {});
    propagateGossip(sim.world);

    // Render ambient events
    const ambient = await renderAmbientNarration();
    if (ambient) {
      // Save current input, clear line, print ambient, restore input
      const currentInput = (rl as any).line || "";
      process.stdout.write("\r\x1b[K"); // Clear current line
      print(`\n${C.dim}${C.italic}${ambient}${C.reset}`);
      rl.prompt(true); // Re-draw prompt preserving input
      if (currentInput) process.stdout.write(currentInput);
    }
  }, AMBIENT_INTERVAL_MS);

  // REPL
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `\n${C.green}> ${C.reset}`,
  });

  rl.prompt();

  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) { rl.prompt(); return; }

    isProcessingInput = true;

    // Slash commands
    if (trimmed.startsWith("/")) {
      const result = await handleSlashCommand(trimmed, sim.world, playerEid);
      if (result !== null) { blank(); print(`${C.white}${result}${C.reset}`); }
      isProcessingInput = false;
      rl.prompt();
      return;
    }

    // Player action
    print(`\n${C.dim}...${C.reset}`);
    try {
      const narration = await handlePlayerInput(trimmed, sim.world, playerEid, sim);
      if (narration) { blank(); print(`${C.white}${narration}${C.reset}`); }
    } catch (err) {
      print(`${C.red}${(err as Error).message}${C.reset}`);
    }

    isProcessingInput = false;
    rl.prompt();
  });

  rl.on("close", () => {
    clearInterval(ambientLoop);
    sim.stop();
    process.exit(0);
  });
}

main().catch(err => { console.error(err); process.exit(1); });
