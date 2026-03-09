/**
 * Full Simulation End-to-End Stress Test
 *
 * This script runs a comprehensive, VISIBLE stress test of the entire ArgOS system:
 * - GodAI builds out the simulation from a narrative prompt
 * - Spirit hierarchy grows organically (watchers, architects, narrator)
 * - NPCs think, act, and interact - all visible in terminal
 * - Narrator generates story prose in real-time
 * - Cognitive enhancements (planning, reflection, schedules)
 * - File outputs: narrative.txt (story) + raw-log.json (data)
 *
 * Usage:
 *   npm run stress-test                    # 5 minute run
 *   npm run stress-test -- --duration=30  # 30 minute run
 *   tsx src/behavioral-tests/10-full-simulation-stress-test.ts --duration=10
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { query, getRelationTargets, addEntity, addComponent } from "bitecs";
import {
  Name,
  Description,
  Agent,
  Room,
  Health,
  Needs,
  Goal,
  Mind,
  Thought,
  Memory,
} from "../ecs/components";
import { HasGoal, HasThought, OccupiesRoom } from "../ecs/relations";
import { createArgosWorld, type WorldContext } from "../ecs/world";
import { initializePrefabs } from "../ecs/prefabs";

// GodAgent imports
import {
  createGodAgent,
  godCommand,
  getWorldState,
  tickWorld,
  getSpiritContext,
  updateGlobalTime,
  setGlobalTension,
  canDoGlobalAction,
  logGlobalAction,
  getGlobalStateSummary,
  PRESET_SLICE_OF_LIFE,
  type GodAgentState,
} from "../god/god-agent";
import { modifySystem, createPrebakePreset } from "../god/system-baker";
import { consumeSystemErrors, clearSystemErrorCount, runSystems } from "../ecs/dynamic-systems";
import {
  registerAllBuiltinSystems,
  getBuiltinSystemNames,
} from "../systems/builtin-systems";

// Spirit imports
import {
  createSpiritRegistry,
  setGodAgent,
  createSpirit,
  type SpiritRegistry,
} from "../spirits/spirit-registry";
import {
  createDynamicSpirit,
  getPendingProposals,
  approveProposal,
  rejectProposal,
  resetFactoryState,
  type DynamicSpiritState,
} from "../spirits/spirit-factory";
import {
  recordSystemExecution,
  runWatcherCognition,
  createSystemWatcherConfig,
} from "../spirits/system-watcher";
import {
  runArchitectCognition,
  createArchitectConfig,
  queueAllApprovedProposals,
} from "../spirits/architect-spirit";
import {
  runArtificerCognition,
  runArtificerWithTools,
} from "../spirits/artificer-spirit";
import { getAndClearAccumulatedIssues } from "../spirits/consistency-spirit";
import { NarratorDefinition } from "../spirits/narrator-spirit";
import { runSpiritCognition, collectEcsSnapshot } from "../spirits/spirit-cognition";
import { setGlobalContext } from "../spirits/spirit-system";
import type { SpiritState } from "../spirits/types";

// Daemon imports
import {
  createDaemonRegistry,
  createDaemonsForAllAgents,
  setDaemonSuperior,
  runDaemonSystem,
  getDaemonSummary,
  detectGrowthOpportunities,
  setSimulationTension,
  type DaemonRegistry,
  type DaemonReport,
} from "../spirits/agent-daemon";

// Runtime imports
import {
  createSimulation,
  registerFastSystem,
  registerAIOperation,
  startSimulation,
  stopSimulation,
  getSimulationStats,
  type SimulationState,
} from "../runtime/simulation-loop";
import {
  initializeTaskQueue,
  getQueueStats,
} from "../runtime/async-task-queue";

// Cognition imports
import {
  generatePlanForGoal,
  createPlanEntity,
  getCurrentStep,
  advancePlanStep,
  getAgentPlans,
} from "../cognition/planning-system";
import {
  initializeReflectionState,
  accumulateImportance,
  maybeReflect,
  getRecentInsights,
} from "../cognition/reflection-system";
import {
  initializeAllSchedules,
  runScheduleSystem,
  getCurrentActivity,
} from "../cognition/schedule-system";
import { addMemory, getAgentMemories } from "../cognition/knowledge-graph";
import {
  agentThink,
  addPerception,
  getAgentThoughts,
  type AgentAction,
} from "../cognition/agent-mind";
import { listSystems } from "../ecs/dynamic-systems";

// =============================================================================
// TERMINAL COLORS
// =============================================================================

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  underscore: "\x1b[4m",
  blink: "\x1b[5m",
  reverse: "\x1b[7m",

  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",

  bgBlack: "\x1b[40m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
  bgMagenta: "\x1b[45m",
  bgCyan: "\x1b[46m",
  bgWhite: "\x1b[47m",
};

const c = {
  god: (s: string) => `${colors.bright}${colors.yellow}${s}${colors.reset}`,
  spirit: (s: string) => `${colors.magenta}${s}${colors.reset}`,
  agent: (s: string) => `${colors.cyan}${s}${colors.reset}`,
  action: (s: string) => `${colors.green}${s}${colors.reset}`,
  thought: (s: string) => `${colors.dim}${colors.white}${s}${colors.reset}`,
  narrator: (s: string) => `${colors.bright}${colors.blue}${s}${colors.reset}`,
  event: (s: string) => `${colors.yellow}${s}${colors.reset}`,
  error: (s: string) => `${colors.red}${s}${colors.reset}`,
  success: (s: string) => `${colors.green}${s}${colors.reset}`,
  dim: (s: string) => `${colors.dim}${s}${colors.reset}`,
  header: (s: string) => `${colors.bright}${colors.white}${s}${colors.reset}`,
};

// =============================================================================
// CONFIGURATION
// =============================================================================

interface StressTestConfig {
  durationMinutes: number;
  ecsTickRate: number;
  reportIntervalSeconds: number;
  agentCognitionIntervalMs: number;
  narratorIntervalMs: number;
  enableSpirits: boolean;
  enableCognition: boolean;
  outputDir: string;
  verbose: boolean;
}

const DEFAULT_CONFIG: StressTestConfig = {
  durationMinutes: 5,
  ecsTickRate: 10,
  reportIntervalSeconds: 60,
  agentCognitionIntervalMs: 6000,  // More frequent cognition for active agents
  narratorIntervalMs: 20000,       // Narrate every 20s instead of 30s
  enableSpirits: true,
  enableCognition: true,
  outputDir: "./stress-test-output",
  verbose: true,
};

function parseArgs(): Partial<StressTestConfig> {
  const args: Partial<StressTestConfig> = {};
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--duration=")) {
      args.durationMinutes = parseInt(arg.split("=")[1], 10);
    }
    if (arg === "--quiet") {
      args.verbose = false;
    }
    if (arg === "--no-spirits") {
      args.enableSpirits = false;
    }
    if (arg === "--no-cognition") {
      args.enableCognition = false;
    }
    if (arg.startsWith("--output=")) {
      args.outputDir = arg.split("=")[1];
    }
  }
  return args;
}

// =============================================================================
// FILE OUTPUT STREAMS
// =============================================================================

interface FileOutputs {
  narrativeFile: string;
  rawLogFile: string;
  narrativeStream: fs.WriteStream;
  rawLogStream: fs.WriteStream;
  narrativeBuffer: string[];
  rawLogBuffer: Array<{timestamp: number; type: string; data: any}>;
}

function canWriteStream(stream: fs.WriteStream): boolean {
  return !stream.destroyed && !stream.writableEnded;
}

function initFileOutputs(outputDir: string): FileOutputs {
  // Create output directory
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const narrativeFile = path.join(outputDir, `narrative-${timestamp}.txt`);
  const rawLogFile = path.join(outputDir, `raw-log-${timestamp}.json`);

  const narrativeStream = fs.createWriteStream(narrativeFile, { flags: "a" });
  const rawLogStream = fs.createWriteStream(rawLogFile, { flags: "a" });

  // Write headers
  narrativeStream.write("═".repeat(70) + "\n");
  narrativeStream.write("A PEACEFUL DAY IN WILLOWBROOK\n");
  narrativeStream.write("A Slice-of-Life Village Story\n");
  narrativeStream.write("═".repeat(70) + "\n\n");

  rawLogStream.write("[\n");

  return {
    narrativeFile,
    rawLogFile,
    narrativeStream,
    rawLogStream,
    narrativeBuffer: [],
    rawLogBuffer: [],
  };
}

function closeFileOutputs(outputs: FileOutputs): void {
  if (canWriteStream(outputs.narrativeStream)) {
    outputs.narrativeStream.write("\n" + "═".repeat(70) + "\n");
    outputs.narrativeStream.write("THE END\n");
    outputs.narrativeStream.write("═".repeat(70) + "\n");
    outputs.narrativeStream.end();
  }

  // Finalize JSON array
  if (canWriteStream(outputs.rawLogStream)) {
    outputs.rawLogStream.write("\n]");
    outputs.rawLogStream.end();
  }
}

function writeNarrative(outputs: FileOutputs, prose: string): void {
  if (!canWriteStream(outputs.narrativeStream)) return;
  const formatted = `${prose}\n\n`;
  outputs.narrativeStream.write(formatted);
  outputs.narrativeBuffer.push(prose);
}

function writeRawLog(outputs: FileOutputs, type: string, data: any): void {
  if (!canWriteStream(outputs.rawLogStream)) return;
  const entry = { timestamp: Date.now(), type, data };
  const needsComma = outputs.rawLogBuffer.length > 0;
  outputs.rawLogStream.write((needsComma ? ",\n" : "") + JSON.stringify(entry));
  outputs.rawLogBuffer.push(entry);
}

// =============================================================================
// TEST STATE
// =============================================================================

interface StressTestState {
  world: WorldContext;
  godState: GodAgentState;
  spiritRegistry: SpiritRegistry;
  simulation: SimulationState;
  config: StressTestConfig;
  outputs: FileOutputs;

  // Spirits
  watchers: DynamicSpiritState[];
  architects: DynamicSpiritState[];
  artificers: DynamicSpiritState[];
  narratorSpirit: SpiritState | null;

  // Daemons (guardian spirits for each agent)
  daemonRegistry: DaemonRegistry;
  pendingDaemonReports: DaemonReport[];

  // Metrics
  startTime: number;
  lastReportTime: number;
  lastAgentCognitionTime: number;
  lastNarratorTime: number;
  eventLog: Array<{ time: number; type: string; message: string }>;

  // Stats
  proposalsSubmitted: number;
  proposalsApproved: number;
  proposalsRejected: number;
  systemsCreated: number;
  systemsFixed: number;
  systemsDisabled: number;
  reflectionsTriggered: number;
  plansGenerated: number;
  planStepsCompleted: number;
  narrativeProsesGenerated: number;
  agentThoughtsGenerated: number;
  agentActionsPerformed: number;
  daemonWhispers: number;
  daemonChallenges: number;
  godAIInterventions: number;
}

// =============================================================================
// WORLD CREATION VIA GODAI
// =============================================================================

const WORLD_BUILDING_PROMPT = `
You are creating a PEACEFUL, TRANQUIL medieval village simulation called "Willowbrook" during a gentle autumn day.

This is a CALM simulation focused on everyday life, gentle interactions, and simple pleasures.
NO DRAMA, NO CONFLICT, NO TENSION. Just peaceful village life.

Please create:

1. LOCATIONS (6-8 rooms):
   - A central village square with a bubbling fountain (peaceful gathering spot)
   - A cozy tavern called "The Golden Wheat" (warm, welcoming atmosphere)
   - A small marketplace (quiet trading, friendly merchants)
   - A blacksmith's workshop (rhythmic sounds of crafting)
   - Peaceful farm fields (golden crops swaying in breeze)
   - A serene temple with a garden (meditation and reflection)
   - A scenic mill by the stream (water wheel turning gently)
   - A beautiful meadow outside the village (wildflowers and birdsong)

2. VILLAGERS (10-12 friendly agents with simple, peaceful goals):

   COMMUNITY LEADERS:
   - Mayor Aldric: Kind and fair, loves his village. Goal: Make everyone feel welcome
   - Elder Mathis: Wise storyteller who shares village history. Goal: Pass on traditions to youth

   MERCHANTS & CRAFTERS:
   - Greta the Merchant: Generous trader who loves chatting. Goal: Have pleasant conversations with customers
   - Bjorn the Blacksmith: Cheerful craftsman, whistles while he works. Goal: Make useful tools for neighbors
   - Ada the Baker: Sweet-natured, makes the best bread. Goal: Perfect a new pastry recipe
   - Old Miller Tobias: Gentle soul who feeds the birds. Goal: Enjoy the peaceful day

   FARMERS & WORKERS:
   - Farmer Willem: Content with his land. Goal: Tend his crops and enjoy the harvest
   - Farmer Hilda: Friendly neighbor. Goal: Share her surplus vegetables with friends
   - Young Lars: Curious apprentice who loves learning. Goal: Master a new smithing technique

   SPIRITUAL:
   - Priestess Anya: Serene and compassionate. Goal: Tend the temple garden
   - Brother Cael: Peaceful monk who loves nature. Goal: Feed the birds and enjoy silence

   YOUTH:
   - Young Emma: Cheerful girl who helps everyone. Goal: Learn new skills from the villagers

Each agent should have:
- A warm, friendly personality
- A simple, peaceful goal (learning, helping, creating, enjoying nature)
- Positive relationships (friends, family, mentors)
- A calm activity appropriate to their role
- Be placed in an appropriate starting location

3. PEACEFUL ATMOSPHERE (no conflicts!):
   - Everyone gets along well
   - Neighbors help each other
   - Simple pleasures: good food, friendly conversation, nature
   - Content with their lives

4. SET THE SCENE:
   - It's a beautiful autumn morning
   - Golden leaves drift gently from trees
   - The air is crisp and fresh
   - Birds are singing, the fountain burbles
   - Everyone is relaxed and content

Create this world now. Make every character feel content, friendly, and at peace.
`;

async function buildWorldWithGodAI(state: StressTestState): Promise<void> {
  console.log("\n" + c.header("═".repeat(70)));
  console.log(c.header("  GODAI WORLD BUILDING"));
  console.log(c.header("═".repeat(70)));
  console.log(c.god("\n🌟 The Weaver speaks reality into existence...\n"));

  writeRawLog(state.outputs, "world_building_start", { prompt: WORLD_BUILDING_PROMPT.slice(0, 500) });

  const MAX_RETRIES = 3;
  let attempt = 0;
  let roomsCreated = 0;
  let agentsCreated = 0;

  while (attempt < MAX_RETRIES && (roomsCreated === 0 || agentsCreated === 0)) {
    attempt++;
    if (attempt > 1) {
      console.log(c.god(`\n🔄 Retry ${attempt}/${MAX_RETRIES} - The Weaver tries again...\n`));
    }

    try {
      const results = await godCommand(state.godState, WORLD_BUILDING_PROMPT);

      // Count successful vs failed actions
      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;

      console.log(c.god(`\n✨ The Weaver executed ${results.length} divine actions (${successCount} succeeded, ${failCount} failed).\n`));

      // Show some result previews
      if (state.config.verbose) {
        const previewCount = Math.min(10, results.length);
        for (let i = 0; i < previewCount; i++) {
          const result = results[i];
          if (result.success) {
            const preview = typeof result.result === "string"
              ? result.result.substring(0, 60)
              : JSON.stringify(result.result).substring(0, 60);
            console.log(c.dim(`  ✓ ${preview}...`));
          } else {
            console.log(c.error(`  ✗ ${result.error}`));
          }
        }
        if (results.length > previewCount) {
          console.log(c.dim(`  ... and ${results.length - previewCount} more actions`));
        }
      }

      // Count actual entities created (from world state, not tool results)
      roomsCreated = Array.from(query(state.world, [Room])).length;
      agentsCreated = Array.from(query(state.world, [Agent])).length;
      const goalsCreated = Array.from(query(state.world, [Goal])).length;

      console.log(c.success(`\n📍 Created ${roomsCreated} locations`));
      console.log(c.success(`👥 Created ${agentsCreated} villagers`));
      console.log(c.success(`🎯 Set ${goalsCreated} goals\n`));

      writeRawLog(state.outputs, "world_building_complete", {
        attempt,
        actions: results.length,
        roomsCreated,
        agentsCreated,
        goalsCreated,
      });

      // If we got nothing, log warning and retry
      if (roomsCreated === 0 && agentsCreated === 0 && attempt < MAX_RETRIES) {
        console.warn(c.error(`\n⚠️ World building produced no entities! LLM may not have called tools.`));
        continue;
      }

    } catch (error) {
      console.error(c.error(`[GodAI] Error building world (attempt ${attempt}):`), error);
      if (attempt >= MAX_RETRIES) {
        throw error;
      }
    }
  }

  // Show world state summary
  const worldState = getWorldState(state.godState);
  console.log(c.dim("─".repeat(70)));
  console.log(c.header("WORLD STATE SUMMARY:"));
  console.log(c.dim(worldState.substring(0, 2000)));
  if (worldState.length > 2000) {
    console.log(c.dim("... (truncated)"));
  }
  console.log(c.dim("─".repeat(70)));
}

async function elaborateWorld(state: StressTestState): Promise<void> {
  console.log(c.god("\n🔮 The Weaver adds finishing touches...\n"));

  const elaborationPrompt = `
Look at the world you've created and enhance it with PEACEFUL elements:

1. Add cozy objects to rooms (comfortable benches, flower arrangements, warm hearths)
2. Make sure agents have appropriate items for their roles
3. Create FRIENDLY relationship links between characters (friends, neighbors, mentors)
4. Ensure everything feels warm and welcoming

NO CONFLICT. NO DRAMA. Just pleasant village life.
Don't create new agents - just enrich what exists.
`;

  try {
    const results = await godCommand(state.godState, elaborationPrompt);
    console.log(c.god(`  ✨ Elaboration: ${results.length} additional touches.\n`));
  } catch (error) {
    console.log(c.dim("  Elaboration skipped."));
  }

  // Now create PEACEFUL systems for this simulation
  console.log(c.god("\n⚙️ The Weaver designs gentle laws for this peaceful world...\n"));

  const systemsPrompt = `
Now create PEACEFUL SYSTEMS for this calm simulation. Use bakeNewSystem to create these:

1. **GentleGoalSystem**: When agents have no goals, give them simple, pleasant goals based on:
   - Their role (baker makes bread, farmer tends crops, etc.)
   - Nearby friends they could chat with
   - Beautiful scenery they could appreciate
   Run every 45 seconds.

2. **FriendlyGreetingSystem**: When agents are in the same room, occasionally emit friendly
   stimuli like "You notice a neighbor waving hello" or "Someone smiles warmly at you"
   Run every 60 seconds.

3. **NatureAppreciationSystem**: Emit peaceful environmental stimuli:
   - "Birds sing sweetly in the trees"
   - "A gentle breeze carries the scent of flowers"
   - "Sunlight dances on the water"
   Run every 30 seconds.

4. **ContentmentSystem**: When agents have low arousal (<0.3) and are in a pleasant location,
   emit contentment stimuli: "You feel at peace" or "Life feels good today"
   Run every 90 seconds.

After creating each system, activate it with activateSystem.
`;

  try {
    const systemResults = await godCommand(state.godState, systemsPrompt);
    const systemsCreated = systemResults.filter(r => r.success && r.toolName?.includes("System")).length;
    console.log(c.god(`  ⚡ Created ${systemsCreated} peaceful systems.\n`));
  } catch (error) {
    console.log(c.dim("  System creation skipped."));
  }
}

// =============================================================================
// GOAL GENERATION FROM ROLE
// =============================================================================

const roleGoals: Record<string, string[]> = {
  mayor: [
    "Walk through the village and greet everyone warmly",
    "Enjoy the beautiful autumn weather with neighbors",
    "Share a story about the village's history with the young folk",
  ],
  guard: [
    "Take a peaceful patrol around the village",
    "Help an elderly villager carry their goods",
    "Enjoy a quiet moment watching the sunset from the square",
  ],
  farmer: [
    "Tend the crops and appreciate the good harvest",
    "Share some fresh vegetables with a neighbor",
    "Take a break and enjoy the autumn breeze",
  ],
  merchant: [
    "Have a pleasant chat with customers at the market",
    "Admire the quality goods other vendors are selling",
    "Share a warm drink with fellow merchants",
  ],
  blacksmith: [
    "Work on a beautiful piece and enjoy the craft",
    "Show a curious child how the bellows work",
    "Take pride in a tool well-made",
  ],
  healer: [
    "Tend the herb garden and enjoy the sunshine",
    "Prepare soothing tea for anyone who needs it",
    "Take a peaceful walk gathering wildflowers",
  ],
  priest: [
    "Tend the temple garden with care and love",
    "Offer a blessing to passing villagers",
    "Meditate peacefully in the shrine",
  ],
  elder: [
    "Share a fond memory with the young ones",
    "Enjoy a quiet moment of reflection",
    "Appreciate how the village has grown",
  ],
  baker: [
    "Bake fresh bread and enjoy the aroma",
    "Share a warm pastry with a neighbor",
    "Perfect a new recipe with love",
  ],
  child: [
    "Play a gentle game with friends",
    "Help an adult with a simple task",
    "Explore the meadow and pick flowers",
  ],
  miller: [
    "Listen to the soothing sound of the water wheel",
    "Grind grain with steady, rhythmic work",
    "Wave hello to passersby",
  ],
  default: [
    "Enjoy the peaceful autumn day",
    "Have a friendly conversation with a neighbor",
    "Find a quiet spot to appreciate nature",
  ],
};

function generateGoalFromRole(name: string, role: string, description: string): string {
  const normalizedRole = role.toLowerCase();

  // Try to match role keywords
  for (const [key, goals] of Object.entries(roleGoals)) {
    if (normalizedRole.includes(key) || description.toLowerCase().includes(key)) {
      return goals[Math.floor(Math.random() * goals.length)];
    }
  }

  // Check description for role hints
  const descLower = description.toLowerCase();
  if (descLower.includes("old") || descLower.includes("elder") || descLower.includes("wise")) {
    return roleGoals.elder[Math.floor(Math.random() * roleGoals.elder.length)];
  }
  if (descLower.includes("young") || descLower.includes("child") || descLower.includes("little")) {
    return roleGoals.child[Math.floor(Math.random() * roleGoals.child.length)];
  }
  if (descLower.includes("mysterious") || descLower.includes("stranger") || descLower.includes("outsider")) {
    return roleGoals.stranger[Math.floor(Math.random() * roleGoals.stranger.length)];
  }

  // Fallback to default goals
  return roleGoals.default[Math.floor(Math.random() * roleGoals.default.length)];
}

// =============================================================================
// SPIRIT CREATION
// =============================================================================

function createSpirits(state: StressTestState): void {
  console.log(c.spirit("\n👻 Summoning spirit hierarchy...\n"));

  // Economic Watcher
  const economicWatcher = createDynamicSpirit(state.spiritRegistry, {
    name: "The Economist",
    title: "Trade & Resource Observer",
    type: "watcher",
    domain: "economy",
    rank: "angel",
    superiorEid: state.godState.eid,
    watchConfig: createSystemWatcherConfig(
      ["NeedsDecay", "TradeSystem", "ResourceFlow"],
      ["stagnation", "imbalance", "shortage"]
    ),
  });
  if (economicWatcher) state.watchers.push(economicWatcher);

  // Social Watcher
  const socialWatcher = createDynamicSpirit(state.spiritRegistry, {
    name: "The Sociologist",
    title: "Social Dynamics Observer",
    type: "watcher",
    domain: "social",
    rank: "angel",
    superiorEid: state.godState.eid,
    watchConfig: createSystemWatcherConfig(
      ["ConversationSystem", "RelationshipSystem"],
      ["conflict", "isolation", "stagnation"]
    ),
  });
  if (socialWatcher) state.watchers.push(socialWatcher);

  // System Health Watcher
  const systemWatcher = createDynamicSpirit(state.spiritRegistry, {
    name: "The Guardian",
    title: "System Health Monitor",
    type: "watcher",
    domain: "meta",
    rank: "angel",
    superiorEid: state.godState.eid,
    watchConfig: createSystemWatcherConfig(
      ["*"],
      ["errors", "performance", "crashes"]
    ),
  });
  if (systemWatcher) state.watchers.push(systemWatcher);

  // Economic Architect
  const economicArchitect = createDynamicSpirit(state.spiritRegistry, {
    name: "The Merchant Prince",
    title: "Economic Systems Architect",
    type: "architect",
    domain: "economy",
    rank: "angel",
    superiorEid: state.godState.eid,
    architectConfig: createArchitectConfig({
      canProposeSystems: true,
      canProposeComponents: true,
      canProposeEntities: false,
      maxProposals: 2,
    }),
  });
  if (economicArchitect) state.architects.push(economicArchitect);

  // Narrative Architect
  const narrativeArchitect = createDynamicSpirit(state.spiritRegistry, {
    name: "The Storyteller",
    title: "Narrative Systems Architect",
    type: "architect",
    domain: "narrative",
    rank: "angel",
    superiorEid: state.godState.eid,
    architectConfig: createArchitectConfig({
      canProposeSystems: true,
      canProposeComponents: false,
      canProposeEntities: true,
      maxProposals: 2,
    }),
  });
  if (narrativeArchitect) state.architects.push(narrativeArchitect);

  // THE ARTIFICER - System maintenance and repair specialist
  const systemArtificer = createDynamicSpirit(state.spiritRegistry, {
    name: "The Tinkerer",
    title: "Systems Maintenance Artificer",
    type: "artificer",
    domain: "systems",
    rank: "angel",
    superiorEid: state.godState.eid,
    artificerConfig: {
      inspectionInterval: 45000,  // Check every 45 seconds
      maxErrorsBeforeDisable: 5,
      autoFixEnabled: true,
      ignoreSystems: [],  // Watch everything
    },
    observationInterval: 30000,  // Think every 30 seconds
  });
  if (systemArtificer) state.artificers.push(systemArtificer);

  // THE NARRATOR - Archangel who writes the story
  const narrator = createSpirit(state.spiritRegistry, NarratorDefinition);
  if (narrator) {
    state.narratorSpirit = narrator;
    // Initialize narrative state
    narrator.narrativeState = {
      currentAct: 1,
      currentPhase: "exposition",
      tension: 0.3,
      plotThreads: [],
      protagonists: [],
      antagonists: [],
      ticksSinceLastEvent: 0,
    };
    console.log(c.narrator("  📖 The Narrator awakens to tell the tale..."));
  }

  console.log(c.spirit(`\n  Created ${state.watchers.length} watchers, ${state.architects.length} architects, ${state.artificers.length} artificers`));
  if (state.narratorSpirit) {
    console.log(c.narrator("  The Narrator spirit is active"));
  }
}

// =============================================================================
// COGNITIVE INITIALIZATION
// =============================================================================

async function initializeCognition(state: StressTestState): Promise<void> {
  console.log(c.agent("\n🧠 Awakening agent minds...\n"));

  const agents = Array.from(query(state.world, [Agent]));

  // Initialize schedules
  await initializeAllSchedules(state.world, false);
  console.log(c.dim(`  📅 Schedules initialized for ${agents.length} agents`));

  // Initialize reflection states with lower threshold for more activity
  for (const agentEid of agents) {
    initializeReflectionState(state.world, agentEid, 30);
  }
  console.log(c.dim(`  💭 Reflection states initialized`));

  // Create initial goals for each agent based on their role
  for (const agentEid of agents) {
    const agentName = Name.value[agentEid];
    const role = Agent.role[agentEid] || "villager";
    const description = Description.value[agentEid] || "";

    // Generate a goal based on role/description
    const goalDescription = generateGoalFromRole(agentName, role, description);

    // Create goal entity and link to agent
    const goalEid = addEntity(state.world);
    addComponent(state.world, goalEid, Goal);
    addComponent(state.world, agentEid, HasGoal(goalEid));

    Goal.description[goalEid] = goalDescription;
    Goal.priority[goalEid] = 5 + Math.floor(Math.random() * 5); // 5-9 priority
    Goal.status[goalEid] = "active";
    Goal.progress[goalEid] = 0;
    Goal.deadline[goalEid] = 0;
  }
  console.log(c.dim(`  🎯 Goals assigned to ${agents.length} agents`));

  // Add initial memories and perceptions
  for (const agentEid of agents) {
    const agentName = Name.value[agentEid];
    const goals = getRelationTargets(state.world, agentEid, HasGoal);
    const goalDesc = goals.length > 0 ? Goal.description[goals[0]] : "enjoying the day";
    const rooms = getRelationTargets(state.world, agentEid, OccupiesRoom);
    const location = rooms.length > 0 ? Name.value[rooms[0]] : "the village";

    addMemory(state.world, agentEid, {
      type: "episodic",
      content: `I woke up this morning in ${location}. The harvest festival is in 2 days and everyone is busy preparing. My focus: ${goalDesc}`,
      importance: 6,
      emotionalValence: 0.4,
      timestamp: Date.now(),
    });

    addPerception(state.world, agentEid, {
      type: "environmental",
      content: `The morning sun warms ${location}. The village bustles with festival preparations.`,
      source: "the world",
    });
  }

  console.log(c.success(`  ✓ ${agents.length} agents awakened and aware\n`));
}

// =============================================================================
// AGENT COGNITION DISPLAY
// =============================================================================

async function runAgentCognitionCycle(state: StressTestState): Promise<void> {
  const agents = Array.from(query(state.world, [Agent]));
  if (agents.length === 0) return;

  // Select 2-4 random agents for this cycle
  const shuffled = agents.sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, Math.min(4, agents.length));

  console.log(c.header("\n─── VILLAGE LIFE ───"));

  for (const agentEid of selected) {
    const agentName = Name.value[agentEid];
    const rooms = getRelationTargets(state.world, agentEid, OccupiesRoom);
    const location = rooms.length > 0 ? Name.value[rooms[0]] : "somewhere";
    const activity = getCurrentActivity(state.world, agentEid);
    const activityName = activity?.name || "being present";

    // Show what they're doing
    console.log(c.agent(`\n  ${agentName}`) + c.dim(` @ ${location} (${activityName})`));

    try {
      // Run cognition
      const action = await agentThink(state.world, agentEid);
      state.agentThoughtsGenerated++;

      // Get their most recent thought
      const thoughts = getAgentThoughts(state.world, agentEid);
      if (thoughts.length > 0) {
        const latestThought = Thought.content[thoughts[thoughts.length - 1]];
        if (latestThought) {
          console.log(c.thought(`    💭 thinks: "${latestThought.slice(0, 80)}..."`));
        }
      }

      // Show their action
      if (action.type !== "wait") {
        state.agentActionsPerformed++;
        const actionDesc = formatAction(action);
        console.log(c.action(`    → ${actionDesc}`));

        // Add to event log
        state.eventLog.push({
          time: Date.now(),
          type: action.type,
          message: `${agentName} ${actionDesc}`,
        });

        // Write to raw log
        writeRawLog(state.outputs, "agent_action", {
          agent: agentName,
          location,
          action,
        });

        // Accumulate importance for potential reflection
        accumulateImportance(state.world, agentEid, 8);
      }

      // Maybe they reflect
      const reflected = await maybeReflect(state.world, agentEid);
      if (reflected) {
        state.reflectionsTriggered++;
        const insights = getRecentInsights(state.world, agentEid, 1);
        if (insights.length > 0) {
          console.log(c.narrator(`    ✨ realizes: "${insights[0].slice(0, 60)}..."`));
          writeRawLog(state.outputs, "reflection", {
            agent: agentName,
            insight: insights[0],
          });
        }
      }

    } catch (error) {
      console.log(c.error(`    (cognition error)`));
    }
  }

  state.lastAgentCognitionTime = Date.now();
}

function formatAction(action: AgentAction): string {
  switch (action.type) {
    case "speak":
      return `says: "${action.content?.slice(0, 50)}..."`;
    case "observe":
      return `watches ${action.target || "carefully"}`;
    case "think":
      return `ponders: "${action.content?.slice(0, 40)}..."`;
    case "interact":
      return `${action.content?.slice(0, 40) || "interacts"} with ${action.target || "something"}`;
    case "move":
      return `heads toward ${action.target || "elsewhere"}`;
    case "wait":
      return `waits quietly`;
    default:
      return action.type;
  }
}

// =============================================================================
// NARRATOR CYCLE
// =============================================================================

async function runNarratorCycle(state: StressTestState): Promise<void> {
  if (!state.narratorSpirit) return;

  console.log(c.narrator("\n───────────────────────────────────────"));
  console.log(c.narrator("  📖 THE NARRATOR SPEAKS"));
  console.log(c.narrator("───────────────────────────────────────\n"));

  try {
    // Collect recent events for the narrator
    const recentEvents = state.eventLog.slice(-10).map(e => ({
      type: e.type as any,
      content: e.message,
      timestamp: e.time,
      entities: [],
      significance: 0.5,
    }));

    // Run narrator cognition with global context (peaceful mood, low tension)
    const output = await runSpiritCognition(
      state.narratorSpirit,
      state.world,
      state.godState.registry,
      state.spiritRegistry,
      recentEvents.map(e => ({
        id: `act_${e.timestamp}`,
        timestamp: e.timestamp,
        agentName: "unknown",
        actionType: e.type,
        description: e.content,
        location: "village",
        result: "completed",
      })),
      getSpiritContext(state.godState)  // Pass global context for peaceful narration
    );

    // Display and save the story prose
    if (output.storyProse && output.storyProse.trim()) {
      state.narrativeProsesGenerated++;

      // Display with beautiful formatting
      console.log(c.dim("  " + "─".repeat(60)));
      console.log("");
      const lines = output.storyProse.split(". ");
      for (const line of lines) {
        if (line.trim()) {
          console.log(`  ${colors.white}${line.trim()}.${colors.reset}`);
        }
      }
      console.log("");
      console.log(c.dim("  " + "─".repeat(60)));

      // Write to narrative file
      writeNarrative(state.outputs, output.storyProse);

      // Write to raw log
      writeRawLog(state.outputs, "narrator_prose", {
        prose: output.storyProse,
        narrativeState: state.narratorSpirit.narrativeState,
      });

      // Update narrative state
      if (state.narratorSpirit.narrativeState && output.updatedNarrativeState) {
        Object.assign(state.narratorSpirit.narrativeState, output.updatedNarrativeState);
      }
    } else {
      console.log(c.dim("  (The village holds its breath... quiet for now)"));
    }

    // Show narrative metrics
    if (state.narratorSpirit.narrativeState) {
      const ns = state.narratorSpirit.narrativeState;
      console.log(c.dim(`\n  Phase: ${ns.currentPhase} | Tension: ${(ns.tension * 100).toFixed(0)}% | Threads: ${ns.plotThreads.length}`));

      // SYNC TENSION TO DAEMONS: Let daemons know about narrative tension
      // so they can back off challenges when things are already tense
      setSimulationTension(state.daemonRegistry, ns.tension);
    }

  } catch (error) {
    console.log(c.error("  (Narrator encountered an error)"));
    console.error(error);
  }

  state.lastNarratorTime = Date.now();
}

// =============================================================================
// RANDOM EVENTS SYSTEM
// =============================================================================

function generateRandomEvent(state: StressTestState): void {
  const agents = Array.from(query(state.world, [Agent]));
  if (agents.length === 0 || Math.random() > 0.4) return;

  const agent = agents[Math.floor(Math.random() * agents.length)];
  const agentName = Name.value[agent];

  const events = [
    { type: "discovery", msg: `${agentName} noticed something unusual`, importance: 7 },
    { type: "social", msg: `${agentName} shared gossip with a passerby`, importance: 5 },
    { type: "work", msg: `${agentName} made progress on festival preparations`, importance: 4 },
    { type: "tension", msg: `${agentName} felt a twinge of worry`, importance: 6 },
    { type: "memory", msg: `${agentName} remembered something from last year's festival`, importance: 5 },
    { type: "observation", msg: `${agentName} spotted the stranger watching from afar`, importance: 8 },
    { type: "rumor", msg: `${agentName} overheard whispers about Crazy Bess's warnings`, importance: 7 },
    { type: "weather", msg: `${agentName} looked up at the sky, wondering about Bess's storm`, importance: 5 },
  ];

  const event = events[Math.floor(Math.random() * events.length)];

  addMemory(state.world, agent, {
    type: "episodic",
    content: event.msg,
    importance: event.importance,
    emotionalValence: event.type === "tension" ? -0.2 : 0.2,
    timestamp: Date.now(),
  });

  accumulateImportance(state.world, agent, event.importance);
  state.eventLog.push({ time: Date.now(), type: event.type, message: event.msg });

  if (state.config.verbose) {
    console.log(c.event(`\n  ⚡ ${event.msg}`));
  }

  writeRawLog(state.outputs, "random_event", { agent: agentName, event });
}

// =============================================================================
// SYSTEM REGISTRATION
// =============================================================================

function registerSystems(state: StressTestState): void {
  console.log(c.dim("\n[Setup] Registering ECS systems...\n"));

  // Needs Decay
  registerFastSystem(state.simulation, {
    name: "NeedsDecay",
    frequency: 5,
    execute: (w) => {
      const agentList = Array.from(query(w, [Agent, Needs]));
      for (const eid of agentList) {
        if (Needs.hunger[eid] < 100) Needs.hunger[eid] += 0.02;
        if (Needs.energy[eid] > 0) Needs.energy[eid] -= 0.01;
        if (Needs.social[eid] < 100) Needs.social[eid] += 0.005;
      }
      recordSystemExecution("NeedsDecay", 1, agentList.length);
    },
  });

  // Health Regen
  registerFastSystem(state.simulation, {
    name: "HealthRegen",
    frequency: 10,
    execute: (w) => {
      const agentList = Array.from(query(w, [Agent, Health, Needs]));
      for (const eid of agentList) {
        if (Needs.hunger[eid] < 50 && Needs.energy[eid] > 50) {
          if (Health.current[eid] < Health.max[eid]) {
            Health.current[eid] = Math.min(Health.max[eid], Health.current[eid] + 0.1);
          }
        }
      }
      recordSystemExecution("HealthRegen", 0.5, agentList.length);
    },
  });

  // Random Events
  registerFastSystem(state.simulation, {
    name: "RandomEvents",
    frequency: 60,
    execute: () => generateRandomEvent(state),
  });

  // Schedule Runner
  if (state.config.enableCognition) {
    registerFastSystem(state.simulation, {
      name: "ScheduleRunner",
      frequency: 50,
      execute: (w) => runScheduleSystem(w),
    });
  }

  // GodAI World Tick
  registerFastSystem(state.simulation, {
    name: "GodAITick",
    frequency: 10,
    execute: () => tickWorld(state.godState, 100),
  });

  // Dynamic Systems Runner - executes all dynamically created systems
  registerFastSystem(state.simulation, {
    name: "DynamicSystemsRunner",
    frequency: 1, // Run every tick
    execute: (w, delta, tick) => {
      runSystems(w, state.godState.systemRegistry, tick, delta);
    },
  });
}

function registerAIOperations(state: StressTestState): void {
  if (!state.config.enableSpirits) return;

  // Watcher Cognition
  registerAIOperation(state.simulation, {
    name: "WatcherCognition",
    interval: 180,
    lastRun: 0,
    execute: async () => {
      if (state.watchers.length === 0) return null;
      const watcher = state.watchers[Math.floor(Math.random() * state.watchers.length)];

      try {
        const report = await runWatcherCognition(
          state.world,
          state.godState.systemRegistry,
          state.spiritRegistry,
          watcher
        );
        if (report) {
          const watcherName = watcher.definition?.name || "Unknown Watcher";
          console.log(c.spirit(`\n  👁️ ${watcherName} observes: Health ${report.overallHealth}`));
          writeRawLog(state.outputs, "watcher_report", { watcher: watcherName, report });
        }
        return report;
      } catch (error) {
        return null;
      }
    },
  });

  // Architect Cognition
  registerAIOperation(state.simulation, {
    name: "ArchitectCognition",
    interval: 300,
    lastRun: 0,
    execute: async () => {
      if (state.architects.length === 0) return null;
      const architect = state.architects[Math.floor(Math.random() * state.architects.length)];

      try {
        const proposals = await runArchitectCognition(
          state.world,
          state.godState.systemRegistry,
          state.spiritRegistry,
          architect
        );
        state.proposalsSubmitted += proposals.length;
        if (proposals.length > 0) {
          const architectName = architect.definition?.name || "Unknown Architect";
          console.log(c.spirit(`\n  🏗️ ${architectName} proposes: ${proposals.map(p => p.name).join(", ")}`));
          writeRawLog(state.outputs, "architect_proposal", { architect: architectName, proposals });
        }
        return proposals;
      } catch (error) {
        return null;
      }
    },
  });

  // Artificer Cognition - System maintenance and repair
  registerAIOperation(state.simulation, {
    name: "ArtificerCognition",
    interval: 240,  // Between architect and approval cycles
    lastRun: 0,
    execute: async () => {
      if (state.artificers.length === 0) return null;
      const artificer = state.artificers[Math.floor(Math.random() * state.artificers.length)];

      try {
        // Use tool-based Artificer cognition - AI decides what to do
        const report = await runArtificerWithTools(
          state.world,
          state.godState.systemRegistry,
          state.spiritRegistry,
          artificer
        );
        if (report) {
          const artificerName = artificer.definition?.name || "Unknown Artificer";
          const issuesCount = report.warningSystems + report.criticalSystems;
          const repairsSucceeded = report.repairsAttempted.filter(r => r.success).length;
          console.log(c.spirit(`\n  🔧 ${artificerName} inspects: ${report.systemsInspected} systems, ${issuesCount} issues, ${repairsSucceeded} repairs`));
          if (report.recommendations.length > 0) {
            console.log(c.dim(`     Recommendations: ${report.recommendations.join("; ")}`));
          }
          writeRawLog(state.outputs, "artificer_report", { artificer: artificerName, report });
          state.systemsFixed += repairsSucceeded;
        }
        return report;
      } catch (error) {
        console.error("[Artificer] Error:", error);
        return null;
      }
    },
  });

  // GodAI Approval
  registerAIOperation(state.simulation, {
    name: "GodAIApproval",
    interval: 250,
    lastRun: 0,
    execute: async () => {
      const pending = getPendingProposals();
      if (pending.length === 0) return { approved: 0, rejected: 0 };

      let approved = 0;
      let rejected = 0;

      for (const proposal of pending) {
        if (proposal.type === "system" || Math.random() > 0.3) {
          approveProposal(proposal.id, state.godState.eid);
          approved++;
          state.proposalsApproved++;
          console.log(c.god(`\n  ✓ GodAI approved: ${proposal.name}`));
        } else {
          rejectProposal(proposal.id, "Not needed");
          rejected++;
          state.proposalsRejected++;
        }
      }

      queueAllApprovedProposals(state.world, state.godState.systemRegistry, (completed, total, name) => {
        if (completed === total) {
          state.systemsCreated++;
          console.log(c.success(`  ⚡ System baked: ${name}`));
          writeRawLog(state.outputs, "system_created", { name });
        }
      });

      return { approved, rejected };
    },
  });

  // Agent Planning
  if (state.config.enableCognition) {
    registerAIOperation(state.simulation, {
      name: "AgentPlanning",
      interval: 400,
      lastRun: 0,
      execute: async () => {
        const agents = Array.from(query(state.world, [Agent]));
        if (agents.length === 0) return null;

        const agent = agents[Math.floor(Math.random() * agents.length)];
        const agentName = Name.value[agent];
        const goals = getRelationTargets(state.world, agent, HasGoal);

        if (goals.length === 0) return null;

        const plans = getAgentPlans(state.world, agent);
        if (plans.length === 0) {
          try {
            const plan = await generatePlanForGoal(state.world, agent, goals[0]);
            if (plan) {
              createPlanEntity(state.world, agent, goals[0], plan);
              state.plansGenerated++;
              console.log(c.agent(`\n  📋 ${agentName} made a ${plan.steps.length}-step plan`));
              writeRawLog(state.outputs, "plan_created", { agent: agentName, plan });
            }
          } catch (error) {
            // Plan generation can fail
          }
        } else {
          const step = getCurrentStep(plans[0]);
          if (step && Math.random() > 0.3) {
            advancePlanStep(plans[0]);
            state.planStepsCompleted++;
          }
        }

        return { agentName };
      },
    });
  }

  // Daemon System - Guardian spirits observe agents, whisper guidance, and report to GodAI
  // Note: Runs frequently but with batching to avoid timeout from too many LLM calls
  let daemonBatchIndex = 0;
  const DAEMON_BATCH_SIZE = 4;  // Process max 4 agents per cycle to avoid timeout

  registerAIOperation(state.simulation, {
    name: "DaemonSystem",
    interval: 50,  // Run more frequently since we're batching
    lastRun: 0,
    execute: async () => {
      // Get all daemons and process a subset each cycle
      const allDaemons = Array.from(state.daemonRegistry.daemons.values());
      if (allDaemons.length === 0) return null;

      // Get the batch for this cycle
      const startIdx = daemonBatchIndex % allDaemons.length;
      const endIdx = Math.min(startIdx + DAEMON_BATCH_SIZE, allDaemons.length);
      daemonBatchIndex = endIdx >= allDaemons.length ? 0 : endIdx;

      // Run daemon observations, whispers, and reports for this batch only
      const result = await runDaemonSystem(
        state.world,
        state.daemonRegistry,
        state.spiritRegistry
      );

      state.daemonWhispers += result.whispers;
      state.daemonChallenges += result.challenges;

      // Log daemon activity
      if (result.observations > 0 && state.config.verbose) {
        console.log(c.spirit(`\n  👻 Daemons: ${result.observations} observations, ${result.whispers} whispers, ${result.challenges} challenges`));
      }

      // Collect growth opportunities for GodAI intervention
      // If daemons sent challenges, we have agents that could use divine intervention
      const daemonsWithOpportunities: Array<{
        agentName: string;
        opportunity: { type: string; description: string; suggestedChallenge: string; urgency: string };
      }> = [];

      // When we have challenges, that means agents are stable/comfortable enough for growth
      if (result.challenges > 0) {
        // Find daemons that recently challenged their agents
        for (const daemon of allDaemons) {
          if (daemon.lastAgentState && daemon.concernLevel < 0.5 && daemon.observationCount > 0) {
            // Create a simple growth opportunity based on the daemon's state
            daemonsWithOpportunities.push({
              agentName: daemon.agentName,
              opportunity: {
                type: "ready_for_challenge",
                description: `${daemon.agentName} is in stable condition, ready for a challenge`,
                suggestedChallenge: "Present a meaningful obstacle or unexpected event",
                urgency: "medium",
              },
            });
          }
        }
      }

      // If there are growth opportunities, occasionally have GodAI create an intervention
      // Debug: log how many opportunities we found
      if (daemonsWithOpportunities.length > 0) {
        console.log(c.dim(`     [Daemon] Found ${daemonsWithOpportunities.length} growth opportunities`));
      }

      // Only trigger interventions occasionally (20% when opportunities exist)
      if (daemonsWithOpportunities.length > 0 && Math.random() < 0.2) {
        // Pick a random opportunity to act on
        const selected = daemonsWithOpportunities[Math.floor(Math.random() * daemonsWithOpportunities.length)];

        console.log(c.god(`\n  🌟 GodAI responding to daemon report for ${selected.agentName}...`));
        console.log(c.dim(`     Opportunity: ${selected.opportunity.type} - ${selected.opportunity.description}`));

        try {
          // Have GodAI create an intervention based on the daemon's suggestion
          const interventionPrompt = `
A guardian daemon has reported a growth opportunity for ${selected.agentName}:

Type: ${selected.opportunity.type}
Description: ${selected.opportunity.description}
Suggested Challenge: ${selected.opportunity.suggestedChallenge}

Based on this daemon report, create a small intervention in the world to provide this agent with an interesting challenge or stimulus. You could:
- Create a minor event in their location (strange sound, unusual weather, dropped item)
- Have an existing NPC approach them with news or a request
- Introduce a small obstacle or puzzle related to their goals
- Create dramatic tension with another character

Keep the intervention small but meaningful. Do NOT create new agents. Just create a situation that will challenge ${selected.agentName}.
`;

          const results = await godCommand(state.godState, interventionPrompt);

          if (results.length > 0) {
            state.godAIInterventions++;
            console.log(c.god(`  ✨ GodAI created ${results.length} divine action(s) for ${selected.agentName}`));

            writeRawLog(state.outputs, "god_intervention", {
              agent: selected.agentName,
              opportunity: selected.opportunity,
              actions: results.length,
            });

            // Add to event log
            state.eventLog.push({
              time: Date.now(),
              type: "divine_intervention",
              message: `The divine intervened for ${selected.agentName}: ${selected.opportunity.suggestedChallenge}`,
            });
          }
        } catch (error) {
          console.log(c.error(`  ✗ GodAI intervention failed for ${selected.agentName}`));
        }
      }

      writeRawLog(state.outputs, "daemon_system", result);
      return result;
    },
  });

  // System Error Handler - GodAI reviews and fixes broken systems
  registerAIOperation(state.simulation, {
    name: "SystemErrorHandler",
    interval: 120,  // Check every 2 minutes
    lastRun: 0,
    execute: async () => {
      const errors = consumeSystemErrors(state.godState.systemRegistry);
      if (errors.length === 0) return { fixed: 0, disabled: 0 };

      let fixed = 0;
      let disabled = 0;

      for (const error of errors) {
        // Skip if too many errors - system will be auto-disabled
        if (error.errorCount >= 3) {
          console.log(c.error(`\n  ❌ System ${error.systemName} disabled after ${error.errorCount} failures`));
          disabled++;
          writeRawLog(state.outputs, "system_disabled", {
            systemName: error.systemName,
            errorCount: error.errorCount,
            lastError: error.error,
          });
          continue;
        }

        // Try to fix the system
        console.log(c.god(`\n  🔧 GodAI attempting to fix ${error.systemName}...`));
        console.log(c.dim(`     Error: ${error.error.slice(0, 80)}...`));

        try {
          const fixDescription = `Fix this error: ${error.error}. The system should handle missing components gracefully.`;
          const result = await modifySystem(
            error.systemName,
            fixDescription,
            state.world,
            state.godState.systemRegistry
          );

          if (result.success) {
            fixed++;
            state.systemsFixed++;
            clearSystemErrorCount(state.godState.systemRegistry, error.systemName);
            console.log(c.success(`  ✓ Fixed ${error.systemName}`));
            writeRawLog(state.outputs, "system_fixed", {
              systemName: error.systemName,
              modification: fixDescription,
            });
          } else {
            console.log(c.error(`  ✗ Could not fix ${error.systemName}: ${result.error}`));
          }
        } catch (fixError) {
          console.log(c.error(`  ✗ Fix attempt failed for ${error.systemName}`));
        }
      }

      state.systemsDisabled += disabled;
      return { fixed, disabled };
    },
  });
}

// =============================================================================
// REPORTING
// =============================================================================

function printStatusReport(state: StressTestState): void {
  const elapsed = (Date.now() - state.startTime) / 1000;
  const stats = getSimulationStats(state.simulation);
  const queueStats = getQueueStats();

  console.log("\n" + c.header("═".repeat(70)));
  console.log(c.header(`  STATUS REPORT - ${formatTime(elapsed)} elapsed`));
  console.log(c.header("═".repeat(70)));

  const agents = Array.from(query(state.world, [Agent]));
  const rooms = Array.from(query(state.world, [Room]));

  console.log(`\n  ${c.header("📊 SIMULATION")}`);
  console.log(`     Tick: ${stats.tick} | Avg: ${stats.avgTickTime.toFixed(1)}ms`);

  console.log(`\n  ${c.header("👥 POPULATION")}`);
  console.log(`     ${agents.length} villagers in ${rooms.length} locations`);

  console.log(`\n  ${c.header("🧠 COGNITION")}`);
  console.log(`     Thoughts: ${state.agentThoughtsGenerated} | Actions: ${state.agentActionsPerformed}`);
  console.log(`     Plans: ${state.plansGenerated} | Reflections: ${state.reflectionsTriggered}`);

  if (state.config.enableSpirits) {
    console.log(`\n  ${c.header("👻 SPIRITS")}`);
    console.log(`     Proposals: ${state.proposalsSubmitted} → ${state.proposalsApproved} approved`);
    console.log(`     Systems: ${state.systemsCreated} created | ${state.systemsFixed} fixed | ${state.systemsDisabled} disabled`);
    console.log(`     Daemons: ${state.daemonWhispers} whispers | ${state.daemonChallenges} challenges | ${state.godAIInterventions} interventions`);
  }

  console.log(`\n  ${c.header("📖 NARRATIVE")}`);
  console.log(`     Story passages: ${state.narrativeProsesGenerated}`);
  if (state.narratorSpirit?.narrativeState) {
    const ns = state.narratorSpirit.narrativeState;
    console.log(`     Phase: ${ns.currentPhase} | Tension: ${(ns.tension * 100).toFixed(0)}%`);
  }

  console.log(`\n  ${c.header("🤖 AI QUEUE")}`);
  console.log(`     Pending: ${queueStats.pending} | Running: ${queueStats.running}`);

  console.log("\n" + c.dim("═".repeat(70)));

  writeRawLog(state.outputs, "status_report", {
    elapsed,
    tick: stats.tick,
    agents: agents.length,
    rooms: rooms.length,
    thoughts: state.agentThoughtsGenerated,
    actions: state.agentActionsPerformed,
    proses: state.narrativeProsesGenerated,
  });
}

function printFinalReport(state: StressTestState): void {
  const elapsed = (Date.now() - state.startTime) / 1000;
  const stats = getSimulationStats(state.simulation);

  console.log("\n" + c.header("╔" + "═".repeat(68) + "╗"));
  console.log(c.header("║" + " ".repeat(18) + "FINAL SIMULATION REPORT" + " ".repeat(27) + "║"));
  console.log(c.header("╚" + "═".repeat(68) + "╝"));

  console.log(`\n${c.header("⏱️ DURATION")}: ${formatTime(elapsed)}`);
  console.log(`   Total ticks: ${stats.tick}`);

  const agents = Array.from(query(state.world, [Agent]));
  const rooms = Array.from(query(state.world, [Room]));

  console.log(`\n${c.header("👥 FINAL POPULATION")}:`);
  console.log(`   ${agents.length} villagers | ${rooms.length} locations`);

  console.log(`\n${c.header("🧠 COGNITIVE ACTIVITY")}:`);
  console.log(`   Agent thoughts: ${state.agentThoughtsGenerated}`);
  console.log(`   Actions performed: ${state.agentActionsPerformed}`);
  console.log(`   Plans generated: ${state.plansGenerated}`);
  console.log(`   Plan steps: ${state.planStepsCompleted}`);
  console.log(`   Reflections: ${state.reflectionsTriggered}`);

  console.log(`\n${c.header("👻 SPIRIT ACTIVITY")}:`);
  console.log(`   Proposals: ${state.proposalsSubmitted} submitted`);
  console.log(`   Approved: ${state.proposalsApproved} | Rejected: ${state.proposalsRejected}`);
  console.log(`   Systems created: ${state.systemsCreated}`);
  console.log(`   Systems fixed: ${state.systemsFixed} | Disabled: ${state.systemsDisabled}`);

  console.log(`\n${c.header("👻 DAEMON ACTIVITY")}:`);
  console.log(`   Daemon whispers: ${state.daemonWhispers}`);
  console.log(`   Daemon challenges: ${state.daemonChallenges}`);
  console.log(`   GodAI interventions: ${state.godAIInterventions}`);
  console.log(`   Active daemons: ${state.daemonRegistry.daemons.size}`);

  console.log(`\n${c.header("📖 NARRATIVE")}:`);
  console.log(`   Story passages: ${state.narrativeProsesGenerated}`);
  console.log(`   Events logged: ${state.eventLog.length}`);

  console.log(`\n${c.header("📁 OUTPUT FILES")}:`);
  console.log(`   Narrative: ${state.outputs.narrativeFile}`);
  console.log(`   Raw log: ${state.outputs.rawLogFile}`);

  const systems = listSystems(state.godState.systemRegistry);
  console.log(`\n${c.header("⚙️ SYSTEMS")} (${systems.length}):`);
  for (const sys of systems.slice(0, 8)) {
    console.log(`   ${sys.active ? "✓" : "○"} ${sys.name}`);
  }
  if (systems.length > 8) {
    console.log(`   ... and ${systems.length - 8} more`);
  }

  // Validation
  console.log(`\n${c.header("✅ VALIDATION")}:`);
  const checks = [
    { name: "Simulation completed", pass: elapsed >= state.config.durationMinutes * 60 * 0.9 },
    { name: "Agents created", pass: agents.length > 0 },
    { name: "Agent thoughts generated", pass: state.agentThoughtsGenerated > 0 },
    { name: "Narrative generated", pass: state.narrativeProsesGenerated > 0 },
    { name: "Events occurred", pass: state.eventLog.length > 0 },
    { name: "File outputs created", pass: fs.existsSync(state.outputs.narrativeFile) },
  ];

  let allPassed = true;
  for (const check of checks) {
    console.log(`   ${check.pass ? "✓" : "✗"} ${check.name}`);
    if (!check.pass) allPassed = false;
  }

  console.log("\n" + c.header("═".repeat(70)));
  console.log(allPassed ? c.success("STRESS TEST PASSED") : c.error("STRESS TEST COMPLETED WITH ISSUES"));
  console.log(c.header("═".repeat(70)));

  writeRawLog(state.outputs, "final_report", {
    elapsed,
    passed: allPassed,
    agents: agents.length,
    rooms: rooms.length,
    thoughts: state.agentThoughtsGenerated,
    actions: state.agentActionsPerformed,
    proses: state.narrativeProsesGenerated,
    events: state.eventLog.length,
  });
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}m ${secs}s`;
}

// =============================================================================
// MAIN LOOP
// =============================================================================

async function setup(config: StressTestConfig): Promise<StressTestState> {
  console.log("\n" + c.header("═".repeat(70)));
  console.log(c.header("  ARGOS STRESS TEST INITIALIZATION"));
  console.log(c.header("═".repeat(70)));

  resetFactoryState();
  getAndClearAccumulatedIssues();
  initializeTaskQueue({ maxConcurrent: 3, processInterval: 200 });

  // Initialize file outputs
  const outputs = initFileOutputs(config.outputDir);
  console.log(c.dim(`\n[Setup] Output directory: ${config.outputDir}`));

  // Create world
  console.log(c.dim("[Setup] Creating world..."));
  const world = createArgosWorld("Willowbrook");
  initializePrefabs(world);

  // Create GodAgent with SLICE-OF-LIFE preset for calm, peaceful simulation
  console.log(c.dim("[Setup] Creating GodAgent with SLICE-OF-LIFE preset..."));
  const godState = createGodAgent(world, {
    name: "The Weaver",
    worldName: "Willowbrook",
    narrative: "A peaceful medieval village enjoying a calm autumn day. No drama, just simple pleasures.",
    preset: "slice-of-life",  // Uses PRESET_SLICE_OF_LIFE - low tension, peaceful, minimal interventions
    narrativeVision: {
      genre: "slice-of-life",
      targetTension: 0.1,  // Very low tension
      tensionDirection: "stable",
      focusCharacters: [],
      moodConstraints: {
        allowConflict: false,   // NO CONFLICT
        allowViolence: false,   // NO VIOLENCE
        allowRomance: true,     // Gentle romance ok
        maxDramaLevel: 0.2,     // Keep drama very low
        preferredMood: "peaceful",
      },
      pacing: "slow",
      interestingElements: ["daily routines", "small discoveries", "quiet moments", "gentle humor", "friendly conversations"],
    },
  });

  // Log the global state configuration
  console.log(c.dim(`  Global State: ${getGlobalStateSummary(godState)}`));

  // Register ALL built-in systems (TimeProgression, SocialDynamics, NarrativeEvents,
  // RelationshipEvolution, Movement, StuckAgentRecovery)
  registerAllBuiltinSystems(godState.systemRegistry);
  console.log(c.dim(`  Registered systems: ${getBuiltinSystemNames().join(", ")}`));

  // Register Slice-of-Life prebake systems
  // These handle the full survival loop: hunger decay, eating at taverns, food consumption,
  // rest recovery, health, social dynamics, and goal tracking
  const prebakeResult = createPrebakePreset("slice-of-life", world, godState.systemRegistry);
  if (prebakeResult.success) {
    console.log(c.dim(`  Prebake 'slice-of-life': ${prebakeResult.systems.map(s => s.name).join(", ")}`));
  } else {
    console.log(c.error(`  Warning: Some prebake systems failed: ${prebakeResult.errors.join(", ")}`));
  }

  // Create spirit registry
  const spiritRegistry = createSpiritRegistry(world);
  setGodAgent(spiritRegistry, godState.eid);

  // Create daemon registry (guardian spirits for agents)
  // Use staggered intervals to prevent all daemons from triggering at once
  const daemonRegistry = createDaemonRegistry(
    30000,   // Observe every 30 seconds (staggered by creation time)
    45000,   // Whisper cooldown 45 seconds (allow some breathing room)
    90000    // Report cooldown 90 seconds
  );

  // Create state
  const state: StressTestState = {
    world,
    godState,
    spiritRegistry,
    simulation: null as any,
    config,
    outputs,
    watchers: [],
    architects: [],
    artificers: [],
    narratorSpirit: null,
    daemonRegistry,
    pendingDaemonReports: [],
    startTime: Date.now(),
    lastReportTime: Date.now(),
    lastAgentCognitionTime: 0,
    lastNarratorTime: 0,
    eventLog: [],
    proposalsSubmitted: 0,
    proposalsApproved: 0,
    proposalsRejected: 0,
    systemsCreated: 0,
    systemsFixed: 0,
    systemsDisabled: 0,
    reflectionsTriggered: 0,
    plansGenerated: 0,
    planStepsCompleted: 0,
    narrativeProsesGenerated: 0,
    agentThoughtsGenerated: 0,
    agentActionsPerformed: 0,
    daemonWhispers: 0,
    daemonChallenges: 0,
    godAIInterventions: 0,
  };

  // GodAI builds the world!
  await buildWorldWithGodAI(state);

  // Elaborate if we have time
  if (config.durationMinutes >= 3) {
    await elaborateWorld(state);
  }

  // Create spirits
  if (config.enableSpirits) {
    createSpirits(state);
  }

  // Initialize cognitive systems
  if (config.enableCognition) {
    await initializeCognition(state);
  }

  // Initialize daemons for all agents
  const daemonCount = createDaemonsForAllAgents(state.daemonRegistry, state.world);
  setDaemonSuperior(state.daemonRegistry, godState.eid);
  // Set LOW tension for peaceful simulation - daemons will be gentle
  setSimulationTension(state.daemonRegistry, 0.1);
  console.log(c.spirit(`  👻 Created ${daemonCount} guardian daemons (peaceful mode, low tension)`));

  // Create simulation runtime
  console.log(c.dim("\n[Setup] Creating simulation runtime..."));
  state.simulation = createSimulation(world, godState.systemRegistry, spiritRegistry, {
    ecsTickRate: config.ecsTickRate,
    ecsMaxTickTime: 100,
    aiProcessInterval: 500,
    watcherTickInterval: 180,
    architectTickInterval: 300,
    approvalTickInterval: 250,
    logTickStats: false,
    logInterval: 100,
  });

  // Register systems
  registerSystems(state);
  registerAIOperations(state);

  // Initial narrative
  writeNarrative(state.outputs, "Dawn breaks over Willowbrook. The harvest festival approaches, and the village stirs with anticipation. In every corner, villagers prepare for the celebration that will define their year...\n");

  // Summary
  const agents = query(state.world, [Agent]).length;
  const rooms = query(state.world, [Room]).length;

  console.log(c.success("\n[Setup] Complete!"));
  console.log(c.dim(`  Duration: ${config.durationMinutes} minutes`));
  console.log(c.dim(`  Agents: ${agents} | Rooms: ${rooms}`));
  console.log(c.dim(`  Spirits: ${state.watchers.length} watchers, ${state.architects.length} architects, ${state.artificers.length} artificers`));
  if (state.narratorSpirit) {
    console.log(c.narrator("  Narrator: Active"));
  }

  return state;
}

async function run(state: StressTestState): Promise<void> {
  const durationMs = state.config.durationMinutes * 60 * 1000;
  const reportIntervalMs = state.config.reportIntervalSeconds * 1000;

  console.log("\n" + c.header("═".repeat(70)));
  console.log(c.header(`  SIMULATION RUNNING - ${state.config.durationMinutes} minutes`));
  console.log(c.header("═".repeat(70)));
  console.log(c.dim("\nPress Ctrl+C to stop early.\n"));
  console.log(c.narrator("Watch as Willowbrook comes to life...\n"));

  startSimulation(state.simulation);

  let running = true;
  process.on("SIGINT", () => {
    console.log(c.dim("\n\nStopping gracefully..."));
    running = false;
  });

  const startTime = Date.now();

  let lastGlobalContextUpdate = 0;

  while (running && (Date.now() - startTime) < durationMs) {
    const now = Date.now();
    const deltaMs = now - (lastGlobalContextUpdate || now);

    // Update global simulation time and push context to spirits (every 5 seconds)
    if (now - lastGlobalContextUpdate >= 5000) {
      updateGlobalTime(state.godState, deltaMs);
      setGlobalContext(getSpiritContext(state.godState));
      lastGlobalContextUpdate = now;
    }

    // Agent cognition cycle (every ~8 seconds)
    if (now - state.lastAgentCognitionTime >= state.config.agentCognitionIntervalMs) {
      await runAgentCognitionCycle(state);
    }

    // Narrator cycle (every ~30 seconds)
    if (state.narratorSpirit && now - state.lastNarratorTime >= state.config.narratorIntervalMs) {
      await runNarratorCycle(state);
    }

    // Status report (every ~60 seconds)
    if (now - state.lastReportTime >= reportIntervalMs) {
      printStatusReport(state);
      state.lastReportTime = now;
    }

    // Small sleep to not hammer CPU
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  stopSimulation(state.simulation);
  await new Promise(resolve => setTimeout(resolve, 2000));

  printFinalReport(state);
  closeFileOutputs(state.outputs);
}

async function main(): Promise<void> {
  console.log(c.header("╔═══════════════════════════════════════════════════════════════════════╗"));
  console.log(c.header("║        ARGOS PEACEFUL VILLAGE SIMULATION                              ║"));
  console.log(c.header("║        GodAI + Spirits + Cognition (SLICE-OF-LIFE Preset)             ║"));
  console.log(c.header("║        A Calm Day in Willowbrook - No Drama, Just Peace               ║"));
  console.log(c.header("╚═══════════════════════════════════════════════════════════════════════╝"));

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    console.error(c.error("\n❌ Error: GOOGLE_GENERATIVE_AI_API_KEY not set"));
    process.exit(1);
  }

  const userConfig = parseArgs();
  const config: StressTestConfig = { ...DEFAULT_CONFIG, ...userConfig };

  console.log(c.dim(`\nConfiguration:`));
  console.log(c.dim(`  Duration: ${config.durationMinutes} minutes`));
  console.log(c.dim(`  ECS Rate: ${config.ecsTickRate} Hz`));
  console.log(c.dim(`  Spirits: ${config.enableSpirits ? "enabled" : "disabled"}`));
  console.log(c.dim(`  Cognition: ${config.enableCognition ? "enabled" : "disabled"}`));
  console.log(c.dim(`  Output: ${config.outputDir}`));

  try {
    const state = await setup(config);
    await run(state);
  } catch (error) {
    console.error(c.error("\n❌ Stress test failed:"), error);
    process.exit(1);
  }
}

main().catch(console.error);
