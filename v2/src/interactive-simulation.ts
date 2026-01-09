/**
 * Interactive NPC Simulation
 *
 * A long-running simulation where:
 * 1. GodAI builds the world autonomously
 * 2. NPCs perceive, think, plan, act, and form memories
 * 3. User can watch and interact via text commands to GodAI
 */

import "dotenv/config";
import * as readline from "readline";
import { createArgosWorld } from "./ecs/world";
import { initializePrefabs, resetRoomPositionCounter } from "./ecs/prefabs";
import {
  createGodAgent,
  godDesignAndExecute,
  godThink,
  tickWorldAsync,
  type GodAgentState,
} from "./god/god-agent";
import { query, addEntity, addComponent } from "bitecs";
import {
  Name,
  Description,
  Agent,
  Mind,
  Thought,
  Perception,
  Memory,
  Goal,
  Action,
  Personality,
} from "./ecs/components";
import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod/v3";
import { tool } from "ai";
import {
  ObjectManager,
  TextRenderer,
  RulesEngine,
  worldSchema,
} from "./world";
import { getDynamicComponent, listDynamicComponents } from "./ecs/dynamic-components";

// Configuration
const TICK_INTERVAL_MS = 3000; // Time between simulation ticks
const NPC_THINK_INTERVAL = 2; // NPCs think every N ticks
const DISPLAY_REFRESH_LINES = 40;

// Models
const npcModel = google("gemini-2.0-flash");

interface NPCState {
  eid: number;
  name: string;
  personality: string;
  currentGoal: string;
  recentThoughts: string[];
  recentActions: string[];
  memories: string[];
  locationEid: number | null;
}

interface SimulationState {
  godState: GodAgentState;
  objectManager: ObjectManager;
  textRenderer: TextRenderer;
  rulesEngine: RulesEngine;
  npcs: Map<number, NPCState>;
  tick: number;
  running: boolean;
  logs: string[];
  worldDescription: string;
}

// ANSI color codes for terminal
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgBlue: "\x1b[44m",
};

function log(sim: SimulationState, message: string, color: string = colors.white) {
  const timestamp = `[T${sim.tick.toString().padStart(4, "0")}]`;
  sim.logs.push(`${timestamp} ${message}`);
  // Keep only last 100 logs
  if (sim.logs.length > 100) sim.logs.shift();
}

function clearScreen() {
  process.stdout.write("\x1b[2J\x1b[H");
}

function renderUI(sim: SimulationState, userInput: string = "") {
  clearScreen();

  const width = process.stdout.columns || 120;
  const divider = "─".repeat(width);

  // Header
  console.log(`${colors.bgBlue}${colors.bright} ARGOS INTERACTIVE SIMULATION ${colors.reset}  Tick: ${sim.tick}  NPCs: ${sim.npcs.size}  ${sim.running ? "▶ RUNNING" : "⏸ PAUSED"}`);
  console.log(divider);

  // World state (left column)
  console.log(`${colors.cyan}${colors.bright}=== WORLD ===${colors.reset}`);
  if (sim.worldDescription) {
    const lines = sim.worldDescription.split("\n").slice(0, 8);
    for (const line of lines) {
      console.log(`  ${line.slice(0, width - 4)}`);
    }
  }
  console.log();

  // NPCs
  console.log(`${colors.green}${colors.bright}=== NPCs ===${colors.reset}`);
  for (const [eid, npc] of sim.npcs) {
    const thought = npc.recentThoughts[npc.recentThoughts.length - 1] || "...";
    const action = npc.recentActions[npc.recentActions.length - 1] || "idle";
    console.log(`  ${colors.yellow}${npc.name}${colors.reset} [${npc.personality}]`);
    console.log(`    ${colors.dim}Goal:${colors.reset} ${npc.currentGoal.slice(0, 60)}`);
    console.log(`    ${colors.dim}Thinking:${colors.reset} "${thought.slice(0, 60)}"`);
    console.log(`    ${colors.dim}Action:${colors.reset} ${action.slice(0, 60)}`);
  }
  console.log();

  // Recent activity log
  console.log(`${colors.magenta}${colors.bright}=== ACTIVITY LOG ===${colors.reset}`);
  const recentLogs = sim.logs.slice(-10);
  for (const logLine of recentLogs) {
    console.log(`  ${colors.dim}${logLine.slice(0, width - 4)}${colors.reset}`);
  }
  console.log();

  // Command prompt
  console.log(divider);
  console.log(`${colors.bright}Commands:${colors.reset} [p]ause/resume  [q]uit  [i]nspect <npc>  Or type a command for GodAI...`);
  process.stdout.write(`${colors.cyan}>${colors.reset} ${userInput}`);
}

async function createNPC(
  sim: SimulationState,
  name: string,
  personality: string,
  goal: string,
  locationEid: number
): Promise<NPCState> {
  const world = sim.godState.world;
  const eid = addEntity(world);

  // Add cognitive components
  addComponent(world, eid, Name);
  addComponent(world, eid, Description);
  addComponent(world, eid, Agent);
  addComponent(world, eid, Mind);
  addComponent(world, eid, Personality);
  addComponent(world, eid, Thought);
  addComponent(world, eid, Goal);
  addComponent(world, eid, Action);
  addComponent(world, eid, Memory);

  // Initialize values
  Name.value[eid] = name;
  Description.value[eid] = `${name}, a ${personality} individual`;
  Agent.role[eid] = personality;
  Agent.systemPrompt[eid] = `You are ${name}, ${personality}. Your current goal is: ${goal}`;
  Agent.active[eid] = true;
  Mind.mode[eid] = "active";
  Mind.arousal[eid] = 0.5;
  Mind.focus[eid] = goal;
  Goal.description[eid] = goal;
  Goal.priority[eid] = 1;
  Goal.status[eid] = "active";
  Goal.progress[eid] = 0;

  // Register with object manager for world interaction
  sim.godState.registry.byName.set(name, eid);
  sim.godState.registry.byId.set(eid, name);

  // Place in location using world system
  if (locationEid) {
    sim.objectManager.moveToContainer(eid, locationEid);
  }

  const npcState: NPCState = {
    eid,
    name,
    personality,
    currentGoal: goal,
    recentThoughts: [],
    recentActions: [],
    memories: [],
    locationEid,
  };

  sim.npcs.set(eid, npcState);
  log(sim, `${name} has entered the world with goal: "${goal}"`, colors.green);

  return npcState;
}

function createNPCTools(sim: SimulationState, npc: NPCState) {
  return {
    look: tool({
      description: "Look around and perceive your surroundings. Use direction 'around' to see everything.",
      inputSchema: z.object({
        direction: z.string().describe("Direction to look: 'around' for full view, or a specific direction"),
      }),
      execute: async ({ direction }) => {
        if (!npc.locationEid) return { perception: "You are nowhere." };
        const detailed = direction === "around" || direction === "carefully";
        const perception = sim.textRenderer.renderPerception(npc.eid, npc.locationEid, {
          detailed,
          includeAffordances: true,
        });
        log(sim, `${npc.name} looks ${direction}`, colors.dim);
        return { perception };
      },
    }),

    examine: tool({
      description: "Examine a specific object or person",
      inputSchema: z.object({
        target: z.string().describe("Name of what to examine"),
      }),
      execute: async ({ target }) => {
        const targetEid = sim.godState.registry.byName.get(target);
        if (!targetEid) return { result: `You don't see any "${target}" here.` };

        const info = sim.objectManager.getInfo(targetEid);
        const affordances = sim.objectManager.getAvailableAffordances(targetEid);

        log(sim, `${npc.name} examines ${target}`, colors.dim);
        return {
          name: info?.name,
          description: info?.description,
          state: info?.state,
          canDo: affordances,
        };
      },
    }),

    interact: tool({
      description: "Perform an action on an object (open, close, sit, take, etc.)",
      inputSchema: z.object({
        action: z.string().describe("The action to perform"),
        target: z.string().describe("The target object"),
      }),
      execute: async ({ action, target }) => {
        const targetEid = sim.godState.registry.byName.get(target);
        if (!targetEid) return { success: false, message: `Cannot find "${target}"` };

        const result = sim.rulesEngine.processAction(action, npc.eid, targetEid, sim.tick);
        npc.recentActions.push(`${action} ${target}: ${result.message}`);
        if (npc.recentActions.length > 5) npc.recentActions.shift();

        log(sim, `${npc.name} ${action}s ${target}: ${result.message}`, colors.yellow);
        return result;
      },
    }),

    moveTo: tool({
      description: "Move to a different location",
      inputSchema: z.object({
        location: z.string().describe("Name of the location to move to"),
      }),
      execute: async ({ location }) => {
        const locationEid = sim.godState.registry.byName.get(location);
        if (!locationEid) return { success: false, message: `Cannot find "${location}"` };

        sim.objectManager.moveToContainer(npc.eid, locationEid);
        npc.locationEid = locationEid;
        npc.recentActions.push(`moved to ${location}`);
        if (npc.recentActions.length > 5) npc.recentActions.shift();

        log(sim, `${npc.name} moves to ${location}`, colors.blue);
        return { success: true, message: `You are now in ${location}` };
      },
    }),

    say: tool({
      description: "Say something out loud",
      inputSchema: z.object({
        message: z.string().describe("What to say"),
      }),
      execute: async ({ message }) => {
        npc.recentActions.push(`said: "${message}"`);
        if (npc.recentActions.length > 5) npc.recentActions.shift();
        log(sim, `${npc.name} says: "${message}"`, colors.cyan);
        return { spoken: message };
      },
    }),

    think: tool({
      description: "Have an internal thought (not spoken)",
      inputSchema: z.object({
        thought: z.string().describe("Your internal thought"),
      }),
      execute: async ({ thought }) => {
        npc.recentThoughts.push(thought);
        if (npc.recentThoughts.length > 5) npc.recentThoughts.shift();
        Thought.content[npc.eid] = thought;
        Thought.timestamp[npc.eid] = Date.now();
        return { thought };
      },
    }),

    remember: tool({
      description: "Commit something important to memory",
      inputSchema: z.object({
        memory: z.string().describe("What to remember"),
        importance: z.number().min(1).max(10).describe("How important (1-10)"),
      }),
      execute: async ({ memory, importance }) => {
        npc.memories.push(memory);
        if (npc.memories.length > 20) npc.memories.shift();
        Memory.content[npc.eid] = memory;
        Memory.importance[npc.eid] = importance;
        Memory.timestamp[npc.eid] = Date.now();
        log(sim, `${npc.name} remembers: "${memory.slice(0, 40)}..."`, colors.magenta);
        return { remembered: memory };
      },
    }),

    setGoal: tool({
      description: "Set a new goal or sub-goal",
      inputSchema: z.object({
        goal: z.string().describe("The new goal"),
        priority: z.number().min(1).max(10).describe("Priority (1-10)"),
      }),
      execute: async ({ goal, priority }) => {
        npc.currentGoal = goal;
        Goal.description[npc.eid] = goal;
        Goal.priority[npc.eid] = priority;
        Goal.status[npc.eid] = "active";
        Mind.focus[npc.eid] = goal;
        log(sim, `${npc.name} sets goal: "${goal}"`, colors.green);
        return { newGoal: goal };
      },
    }),
  };
}

async function runNPCCognition(sim: SimulationState, npc: NPCState) {
  // Build perception context
  let perception = "You cannot perceive anything (no location).";
  if (npc.locationEid) {
    perception = sim.textRenderer.renderPerception(npc.eid, npc.locationEid, {
      detailed: true,
      includeAffordances: true,
    });
  }

  const memorySummary = npc.memories.length > 0
    ? `\nYour memories: ${npc.memories.slice(-5).join("; ")}`
    : "";

  const recentActivity = npc.recentActions.length > 0
    ? `\nRecent actions: ${npc.recentActions.slice(-3).join(", ")}`
    : "";

  // Get list of known locations
  const locations = Array.from(sim.godState.registry.byName.entries())
    .filter(([name, _]) => name.includes("Square") || name.includes("Tavern") || name.includes("Smithy") || name.includes("Chapel"))
    .map(([name, _]) => name);

  const systemPrompt = `You are ${npc.name}, ${npc.personality}.

Your current goal: ${npc.currentGoal}
${memorySummary}
${recentActivity}

Known locations: ${locations.join(", ")}

IMPORTANT: Don't just look around repeatedly. Be proactive! You should:
- Move to different locations to explore
- Examine interesting objects
- Say things out loud (you might meet other people)
- Think about your goals and plans
- Interact with objects (sit on chairs, open chests, etc.)
- Remember important things you discover

Behave naturally as your character would. Take 2-4 varied actions that make progress on your goal.`;

  const userPrompt = `Current perception:
${perception}

Think about what would help you achieve your goal, then take action. Don't just look around - explore, examine, move, interact!`;

  try {
    const tools = createNPCTools(sim, npc);

    await generateText({
      model: npcModel,
      system: systemPrompt,
      prompt: userPrompt,
      tools,
      maxSteps: 5,
    });
  } catch (error: any) {
    const errMsg = error?.message || String(error);
    log(sim, `${npc.name} cognitive error: ${errMsg}`, colors.red);
    if (errMsg.includes("functionDeclaration")) {
      console.error("Full error:", error);
    }
  }
}

async function initializeWorld(sim: SimulationState): Promise<void> {
  console.log("\n🌍 Creating the world...\n");

  // Create world using ObjectManager directly for proper trait support
  // Village Square (central hub)
  const squareEid = sim.objectManager.spawnCustom({
    name: "Village Square",
    description: "The central square of a small medieval village. Cobblestones worn smooth by countless feet. A well stands in the center.",
    traits: ["container", "location"],
  });
  sim.godState.registry.byName.set("Village Square", squareEid);
  sim.godState.registry.byId.set(squareEid, "Village Square");

  // Tavern
  const tavernEid = sim.objectManager.spawnCustom({
    name: "The Rusty Tankard",
    description: "A warm tavern with low wooden beams and the smell of ale. Firelight flickers on the walls.",
    traits: ["container", "location"],
  });
  sim.godState.registry.byName.set("The Rusty Tankard", tavernEid);
  sim.godState.registry.byId.set(tavernEid, "The Rusty Tankard");

  // Blacksmith
  const smithEid = sim.objectManager.spawnCustom({
    name: "Ironheart Smithy",
    description: "A hot, smoky forge. Sparks fly as metal is shaped on the anvil.",
    traits: ["container", "location"],
  });
  sim.godState.registry.byName.set("Ironheart Smithy", smithEid);
  sim.godState.registry.byId.set(smithEid, "Ironheart Smithy");

  // Chapel
  const chapelEid = sim.objectManager.spawnCustom({
    name: "St. Aelric's Chapel",
    description: "A small stone chapel with stained glass windows. Candles flicker before the altar.",
    traits: ["container", "location"],
  });
  sim.godState.registry.byName.set("St. Aelric's Chapel", chapelEid);
  sim.godState.registry.byId.set(chapelEid, "St. Aelric's Chapel");

  // Add objects to locations
  const tableEid = sim.objectManager.spawn("table", { name: "oak table", containedIn: tavernEid });
  sim.godState.registry.byName.set("oak table", tableEid!);

  const chairEid = sim.objectManager.spawn("chair", { name: "tavern chair", containedIn: tavernEid });
  sim.godState.registry.byName.set("tavern chair", chairEid!);

  const chestEid = sim.objectManager.spawn("chest", { name: "old chest", containedIn: tavernEid });
  sim.godState.registry.byName.set("old chest", chestEid!);

  // Add torches to light all the rooms
  const torch1 = sim.objectManager.spawn("torch", { name: "forge torch", containedIn: smithEid });
  sim.godState.registry.byName.set("forge torch", torch1!);

  const torch2 = sim.objectManager.spawn("torch", { name: "tavern lamp", containedIn: tavernEid });
  sim.godState.registry.byName.set("tavern lamp", torch2!);

  const torch3 = sim.objectManager.spawn("torch", { name: "square lantern", containedIn: squareEid });
  sim.godState.registry.byName.set("square lantern", torch3!);

  const torch4 = sim.objectManager.spawn("torch", { name: "chapel candelabra", containedIn: chapelEid });
  sim.godState.registry.byName.set("chapel candelabra", torch4!);

  const wellEid = sim.objectManager.spawnCustom({
    name: "village well",
    description: "A stone well with a wooden bucket. The water looks clear and cold.",
    traits: ["examinable", "container"],
    containedIn: squareEid,
  });
  sim.godState.registry.byName.set("village well", wellEid);

  const benchEid = sim.objectManager.spawn("chair", { name: "stone bench", containedIn: squareEid });
  sim.godState.registry.byName.set("stone bench", benchEid!);

  sim.worldDescription = "A medieval village with a central square, tavern, blacksmith, and chapel.";
  log(sim, "World created with 4 locations and various objects", colors.green);

  // Collect rooms for NPC placement
  const rooms = [squareEid, tavernEid, smithEid, chapelEid];

  // Create NPCs with different personalities and goals
  const npcConfigs = [
    { name: "Aldric", personality: "a curious scholar who loves learning", goal: "Discover something interesting in the village" },
    { name: "Berta", personality: "a practical merchant always looking for opportunity", goal: "Find valuable items to trade" },
    { name: "Cedric", personality: "a grumpy but kind-hearted blacksmith", goal: "Check on the forge and make something useful" },
  ];

  for (const config of npcConfigs) {
    const locationEid = rooms[Math.floor(Math.random() * rooms.length)];
    await createNPC(sim, config.name, config.personality, config.goal, locationEid);
  }

  // Update world description with rendered rooms
  const roomDescriptions: string[] = [];
  for (const roomEid of rooms.slice(0, 3)) {
    try {
      const rendered = sim.textRenderer.renderRoom(roomEid, { detailed: false });
      roomDescriptions.push(rendered.fullText);
    } catch (e) {
      // Room might not have proper structure
    }
  }
  if (roomDescriptions.length > 0) {
    sim.worldDescription = roomDescriptions.join("\n\n");
  }
}

async function runSimulationTick(sim: SimulationState): Promise<void> {
  sim.tick++;

  // Run world systems (rules engine, decay, etc.)
  try {
    await tickWorldAsync(sim.godState, 1000);
    sim.rulesEngine.processTick(sim.tick);
  } catch (e) {
    // Ignore tick errors
  }

  // Run NPC cognition every few ticks - run in parallel for better performance
  if (sim.tick % NPC_THINK_INTERVAL === 0) {
    const cognitionPromises: Promise<void>[] = [];
    for (const [eid, npc] of sim.npcs) {
      if (Agent.active[eid]) {
        cognitionPromises.push(
          runNPCCognition(sim, npc).catch(err => {
            log(sim, `${npc.name} error: ${err?.message || err}`, colors.red);
          })
        );
      }
    }
    await Promise.all(cognitionPromises);
  }
}

async function handleUserCommand(sim: SimulationState, input: string): Promise<void> {
  const trimmed = input.trim().toLowerCase();

  if (trimmed === "p" || trimmed === "pause") {
    sim.running = !sim.running;
    log(sim, sim.running ? "Simulation resumed" : "Simulation paused", colors.yellow);
    return;
  }

  if (trimmed === "q" || trimmed === "quit") {
    console.log("\nGoodbye!\n");
    process.exit(0);
  }

  if (trimmed.startsWith("i ") || trimmed.startsWith("inspect ")) {
    const npcName = input.slice(trimmed.startsWith("i ") ? 2 : 8).trim();
    for (const [eid, npc] of sim.npcs) {
      if (npc.name.toLowerCase().includes(npcName.toLowerCase())) {
        console.log(`\n${colors.bright}=== ${npc.name} ===${colors.reset}`);
        console.log(`Personality: ${npc.personality}`);
        console.log(`Goal: ${npc.currentGoal}`);
        console.log(`Recent thoughts: ${npc.recentThoughts.slice(-3).join(" | ")}`);
        console.log(`Recent actions: ${npc.recentActions.slice(-3).join(" | ")}`);
        console.log(`Memories: ${npc.memories.slice(-5).join(" | ")}`);
        console.log("\nPress Enter to continue...");
        return;
      }
    }
    log(sim, `NPC "${npcName}" not found`, colors.red);
    return;
  }

  // Otherwise, send to GodAI
  if (input.trim()) {
    log(sim, `You command: "${input}"`, colors.cyan);
    sim.running = false; // Pause while GodAI works

    try {
      const { actions, thinking } = await godThink(sim.godState, input);
      log(sim, `GodAI executed ${actions.length} actions`, colors.green);

      // Update world description
      const rooms: number[] = [];
      for (const [name, eid] of sim.godState.registry.byName) {
        const info = sim.objectManager.getInfo(eid);
        if (info?.traits.includes("location")) {
          rooms.push(eid);
        }
      }
      const roomDescriptions: string[] = [];
      for (const roomEid of rooms.slice(0, 3)) {
        try {
          const rendered = sim.textRenderer.renderRoom(roomEid, { detailed: false });
          roomDescriptions.push(rendered.fullText);
        } catch (e) {}
      }
      if (roomDescriptions.length > 0) {
        sim.worldDescription = roomDescriptions.join("\n\n");
      }
    } catch (error) {
      log(sim, `GodAI error: ${error}`, colors.red);
    }

    sim.running = true; // Resume
  }
}

async function main() {
  console.log(`
${colors.bright}╔═══════════════════════════════════════════════════════════╗
║          ARGOS INTERACTIVE NPC SIMULATION                 ║
║                                                           ║
║  Watch NPCs think, plan, and interact in real-time        ║
║  Command GodAI to modify the world as you watch           ║
╚═══════════════════════════════════════════════════════════╝${colors.reset}
`);

  // Initialize world and systems
  const world = createArgosWorld("InteractiveSim");
  initializePrefabs(world);
  resetRoomPositionCounter();

  const godState = createGodAgent(world, {
    name: "WorldArchitect",
    worldName: "InteractiveSim",
    narrative: "An interactive medieval village simulation",
  });

  const objectManager = new ObjectManager(world);
  const textRenderer = new TextRenderer(world, objectManager);
  const rulesEngine = new RulesEngine(world, objectManager);

  const sim: SimulationState = {
    godState,
    objectManager,
    textRenderer,
    rulesEngine,
    npcs: new Map(),
    tick: 0,
    running: false,
    logs: [],
    worldDescription: "",
  };

  // Initialize the world with GodAI
  await initializeWorld(sim);

  // Handle input - check if we have a TTY for interactive mode
  let currentInput = "";
  const isTTY = process.stdin.isTTY;

  if (isTTY) {
    // Interactive mode with raw input
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    process.stdin.on("data", async (key: string) => {
      if (key === "\u0003") { // Ctrl+C
        process.exit();
      } else if (key === "\r" || key === "\n") { // Enter
        const input = currentInput;
        currentInput = "";
        await handleUserCommand(sim, input);
        renderUI(sim, currentInput);
      } else if (key === "\u007F") { // Backspace
        currentInput = currentInput.slice(0, -1);
        renderUI(sim, currentInput);
      } else if (key.length === 1 && key >= " ") {
        currentInput += key;
        renderUI(sim, currentInput);
      }
    });
  } else {
    // Non-interactive mode - use readline for piped input
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    rl.on("line", async (line: string) => {
      await handleUserCommand(sim, line);
      renderUI(sim, "");
    });

    rl.on("close", () => {
      console.log("\n" + colors.yellow + "Input stream closed. Simulation will continue running." + colors.reset);
    });

    console.log(colors.yellow + "Running in non-interactive mode (no TTY detected)." + colors.reset);
    console.log(colors.yellow + "The simulation will run autonomously. Press Ctrl+C to stop." + colors.reset);
  }

  // Main simulation loop
  sim.running = true;
  renderUI(sim, currentInput);

  const tickLoop = async () => {
    if (sim.running) {
      await runSimulationTick(sim);
      renderUI(sim, currentInput);
    }
    setTimeout(tickLoop, TICK_INTERVAL_MS);
  };

  // Start the loop
  log(sim, "Simulation started! Type commands or press 'p' to pause.", colors.green);
  tickLoop();
}

main().catch(console.error);
