/**
 * Daemon Mini-Narrator Behavioral Test
 *
 * Tests the enhanced daemon system as a "mini-narrator" for individual NPCs.
 * Each daemon tracks their character's:
 * - Thoughts, memories, and plans
 * - Personal narrative arc (setup -> rising -> crisis -> climax -> resolution)
 * - Self-resolution when arcs stagnate
 *
 * This test runs a small simulation with 3 characters and verifies that
 * daemons properly track and progress their characters' stories.
 */

import "dotenv/config";
import { addEntity, addComponent } from "bitecs";
import { Name, Agent, Mind, Health, Goal } from "../ecs/components";
import { HasGoal, OccupiesRoom } from "../ecs/relations";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../ecs/prefabs";
import {
  createDaemonRegistry,
  createDaemonForAgent,
  runDaemonSystem,
  getDaemonSummary,
  getDaemonDetailedSummary,
  getDaemonByAgentName,
  // Memory functions
  recordThought,
  recordMemory,
  recordPlan,
  updatePlanStatus,
  recordRelationshipChange,
  getMemorySummary,
  // Arc functions
  startNarrativeArc,
  progressNarrativeArc,
  checkArcStagnation,
  attemptSelfResolution,
  getArcSummary,
  increaseTension,
  type DaemonRegistry,
  type DaemonState,
} from "../spirits/agent-daemon";

// Colors for terminal output
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
};

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
}

const results: TestResult[] = [];

function assert(condition: boolean, testName: string, message: string): void {
  if (condition) {
    results.push({ name: testName, passed: true, message: `${c.green}PASS${c.reset}: ${message}` });
  } else {
    results.push({ name: testName, passed: false, message: `${c.red}FAIL${c.reset}: ${message}` });
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log(`${c.bold}${c.cyan}╔═══════════════════════════════════════════════════════════╗${c.reset}`);
  console.log(`${c.bold}${c.cyan}║     DAEMON MINI-NARRATOR BEHAVIORAL TEST                  ║${c.reset}`);
  console.log(`${c.bold}${c.cyan}║     Testing Memory, Arc Tracking, Self-Resolution         ║${c.reset}`);
  console.log(`${c.bold}${c.cyan}╚═══════════════════════════════════════════════════════════╝${c.reset}\n`);

  // =========================================================================
  // SETUP
  // =========================================================================
  console.log(`${c.bold}=== SETUP ===${c.reset}\n`);

  const world = createArgosWorld();
  initializePrefabs(world);

  // Create a village setting
  const marketId = createRoomEntity(world, {
    name: "Village Market",
    description: "A bustling market square with vendors and villagers",
    capacity: 30,
    ambience: "busy and lively",
  });
  console.log(`${c.green}✓ Created: Village Market${c.reset}`);

  // Create 3 characters with distinct situations
  const emmaId = createAgentEntity(world, {
    name: "Emma",
    role: "merchant",
    systemPrompt: "You are Emma, a jewelry merchant whose prized necklace was stolen.",
    description: "A worried merchant wringing her hands",
    roomId: marketId,
  });
  Mind.arousal[emmaId] = 0.7;
  Mind.focus[emmaId] = "the stolen necklace";
  Health.current[emmaId] = 100;
  console.log(`${c.green}✓ Created: Emma (investigating theft)${c.reset}`);

  const willemId = createAgentEntity(world, {
    name: "Willem",
    role: "guard",
    systemPrompt: "You are Willem, a guard who suspects the new traveler of the theft.",
    description: "A suspicious guard watching everyone",
    roomId: marketId,
  });
  Mind.arousal[willemId] = 0.6;
  Mind.focus[willemId] = "watching the stranger";
  Health.current[willemId] = 100;
  console.log(`${c.green}✓ Created: Willem (suspicious guard)${c.reset}`);

  const finnId = createAgentEntity(world, {
    name: "Finn",
    role: "traveler",
    systemPrompt: "You are Finn, a traveler wrongly accused of theft.",
    description: "A nervous traveler trying to clear his name",
    roomId: marketId,
  });
  Mind.arousal[finnId] = 0.8;
  Mind.focus[finnId] = "proving innocence";
  Health.current[finnId] = 100;
  console.log(`${c.green}✓ Created: Finn (wrongly accused)${c.reset}`);

  // Create daemon registry with fast intervals for testing
  const registry: DaemonRegistry = createDaemonRegistry(
    2000,   // Observe every 2 seconds
    5000,   // Whisper cooldown 5 seconds
    10000,  // Challenge cooldown 10 seconds
    5000    // Report cooldown 5 seconds
  );

  // Create daemons
  const emmaDaemon = createDaemonForAgent(registry, world, emmaId)!;
  const willemDaemon = createDaemonForAgent(registry, world, willemId)!;
  const finnDaemon = createDaemonForAgent(registry, world, finnId)!;

  console.log(`${c.magenta}👻 Daemons created for all characters${c.reset}\n`);

  // =========================================================================
  // TEST 1: Memory Recording
  // =========================================================================
  console.log(`${c.bold}=== TEST 1: Memory Recording ===${c.reset}\n`);

  // Record thoughts for Emma
  recordThought(emmaDaemon, "the theft", "Who could have taken my grandmother's necklace?", "distressed", 0.8);
  recordThought(emmaDaemon, "suspects", "That new traveler arrived right before it went missing...", "suspicious", 0.7);

  assert(
    emmaDaemon.memory.recentThoughts.length === 2,
    "Memory Recording",
    "Emma has 2 thoughts recorded"
  );

  // Record a memory
  const emmaMemory = recordMemory(
    emmaDaemon,
    "event",
    "Necklace discovered missing from locked display case",
    ["Emma"],
    "Village Market",
    -0.8,
    0.9
  );

  assert(
    emmaDaemon.memory.keyMemories.length === 1,
    "Memory Recording",
    "Emma has 1 key memory recorded"
  );

  assert(
    emmaMemory.narrativeWeight === 0.9,
    "Memory Recording",
    "High narrative weight memory recorded correctly"
  );

  // Record a plan for Willem
  const willemPlan = recordPlan(
    willemDaemon,
    "Interrogate the traveler",
    ["Corner him in the market", "Ask about his whereabouts", "Search his belongings"],
    0.8
  );

  assert(
    willemDaemon.memory.activePlans.length === 1,
    "Memory Recording",
    "Willem has 1 active plan"
  );

  assert(
    willemPlan.steps.length === 3,
    "Memory Recording",
    "Plan has 3 steps"
  );

  console.log(`${c.dim}Emma's memory summary:${c.reset}`);
  console.log(getMemorySummary(emmaDaemon));
  console.log();

  // =========================================================================
  // TEST 2: Narrative Arc Initialization
  // =========================================================================
  console.log(`${c.bold}=== TEST 2: Narrative Arc Initialization ===${c.reset}\n`);

  // Start arcs for each character
  startNarrativeArc(
    emmaDaemon,
    "investigation",
    "Recover my grandmother's necklace",
    "Find the thief and get the necklace back",
    { toGain: "family heirloom", toLose: "trust in people" }
  );

  startNarrativeArc(
    willemDaemon,
    "justice",
    "Catch the thief and prove my worth",
    "Arrest the criminal and earn a promotion",
    { toGain: "recognition", toLose: "respect if wrong" }
  );

  startNarrativeArc(
    finnDaemon,
    "survival",
    "Clear my name before I'm arrested",
    "Prove innocence and find the real thief",
    { toGain: "freedom", toLose: "everything" }
  );

  assert(
    emmaDaemon.narrativeArc.status === "setup",
    "Arc Initialization",
    "Emma's arc is in setup"
  );

  assert(
    willemDaemon.narrativeArc.theme === "justice",
    "Arc Initialization",
    "Willem's arc theme is 'justice'"
  );

  assert(
    finnDaemon.narrativeArc.stakes.toLose === "everything",
    "Arc Initialization",
    "Finn's stakes are set correctly"
  );

  console.log(`${c.dim}Emma's arc summary:${c.reset}`);
  console.log(getArcSummary(emmaDaemon));
  console.log();

  // =========================================================================
  // TEST 3: Arc Progression
  // =========================================================================
  console.log(`${c.bold}=== TEST 3: Arc Progression ===${c.reset}\n`);

  // Progress Emma's arc through several beats
  progressNarrativeArc(emmaDaemon, "Discovered the lock was picked, not broken");
  progressNarrativeArc(emmaDaemon, "Found witnesses who saw a cloaked figure");

  // Emma has beats from: initial high-weight memory (1) + 2 progressNarrativeArc calls
  assert(
    emmaDaemon.narrativeArc.completedBeats.length >= 2,
    "Arc Progression",
    `Emma has ${emmaDaemon.narrativeArc.completedBeats.length} completed beats (expected >= 2)`
  );

  assert(
    emmaDaemon.narrativeArc.status === "rising",
    "Arc Progression",
    "Emma's arc progressed to rising action"
  );

  // Progress Willem's arc
  progressNarrativeArc(willemDaemon, "Confronted Finn in the market");
  increaseTension(willemDaemon, 0.3);

  assert(
    willemDaemon.narrativeArc.tension > 0.5,
    "Arc Progression",
    "Willem's tension increased"
  );

  // Progress Finn's arc with high tension
  progressNarrativeArc(finnDaemon, "Denied accusations but no one believes me");
  finnDaemon.narrativeArc.tension = 0.8;
  progressNarrativeArc(finnDaemon, "Found a witness who can vouch for me");

  assert(
    finnDaemon.narrativeArc.status === "crisis" || finnDaemon.narrativeArc.status === "rising",
    "Arc Progression",
    "Finn's arc reached crisis or rising with high tension"
  );

  console.log(`${c.dim}Arc statuses:${c.reset}`);
  console.log(`  Emma: ${emmaDaemon.narrativeArc.status} (${(emmaDaemon.narrativeArc.tension * 100).toFixed(0)}% tension)`);
  console.log(`  Willem: ${willemDaemon.narrativeArc.status} (${(willemDaemon.narrativeArc.tension * 100).toFixed(0)}% tension)`);
  console.log(`  Finn: ${finnDaemon.narrativeArc.status} (${(finnDaemon.narrativeArc.tension * 100).toFixed(0)}% tension)`);
  console.log();

  // =========================================================================
  // TEST 4: Stagnation Detection and Self-Resolution
  // =========================================================================
  console.log(`${c.bold}=== TEST 4: Stagnation Detection and Self-Resolution ===${c.reset}\n`);

  // Set Emma's stagnation threshold low for testing
  emmaDaemon.narrativeArc.stagnationThreshold = 3;

  // Simulate time passing without progress
  let isStagnating = false;
  for (let i = 0; i < 4; i++) {
    isStagnating = checkArcStagnation(emmaDaemon);
  }

  assert(
    isStagnating,
    "Stagnation Detection",
    "Emma's arc detected as stagnating after threshold"
  );

  assert(
    emmaDaemon.narrativeArc.needsSelfResolution,
    "Stagnation Detection",
    "Emma's arc marked as needing self-resolution"
  );

  // Attempt self-resolution
  const nudge = attemptSelfResolution(emmaDaemon);

  assert(
    nudge !== null,
    "Self-Resolution",
    "Self-resolution generated a nudge"
  );

  assert(
    nudge!.priority === "high",
    "Self-Resolution",
    "Self-resolution nudge has high priority"
  );

  console.log(`${c.dim}Self-resolution nudge for Emma:${c.reset}`);
  console.log(`  Type: ${nudge!.type}`);
  console.log(`  Action: ${nudge!.action}`);
  console.log(`  Reason: ${nudge!.reason}`);
  console.log();

  // Progress to clear stagnation
  progressNarrativeArc(emmaDaemon, "Made a breakthrough - found a hidden clue");

  assert(
    !emmaDaemon.narrativeArc.needsSelfResolution,
    "Self-Resolution",
    "Progress clears self-resolution flag"
  );

  // =========================================================================
  // TEST 5: Relationship and Character Moment Tracking
  // =========================================================================
  console.log(`${c.bold}=== TEST 5: Relationship and Character Moment Tracking ===${c.reset}\n`);

  // Record relationship changes
  recordRelationshipChange(
    emmaDaemon,
    "Finn",
    "stranger",
    "suspicious_of",
    "He arrived right before the theft",
    0.6
  );

  recordRelationshipChange(
    finnDaemon,
    "Willem",
    "neutral",
    "adversary",
    "He's trying to arrest me for something I didn't do",
    0.8
  );

  assert(
    emmaDaemon.memory.relationshipHistory.length === 1,
    "Relationship Tracking",
    "Emma's relationship history updated"
  );

  assert(
    finnDaemon.memory.characterMoments.length > 0,
    "Character Moments",
    "Significant relationship change created character moment"
  );

  console.log(`${c.dim}Finn's character moments:${c.reset}`);
  for (const moment of finnDaemon.memory.characterMoments) {
    console.log(`  [${moment.type}] ${moment.description}`);
  }
  console.log();

  // =========================================================================
  // TEST 6: Plan Status Updates
  // =========================================================================
  console.log(`${c.bold}=== TEST 6: Plan Status Updates ===${c.reset}\n`);

  // Update Willem's plan
  updatePlanStatus(willemDaemon, willemPlan.id, "active");

  assert(
    willemDaemon.memory.activePlans[0].status === "active",
    "Plan Updates",
    "Plan status updated to active"
  );

  // Finn makes a counter-plan
  const finnPlan = recordPlan(
    finnDaemon,
    "Find the real thief",
    ["Search for the cloaked figure", "Find more witnesses", "Present evidence"],
    0.9
  );

  // Finn completes his plan
  updatePlanStatus(finnDaemon, finnPlan.id, "completed");

  assert(
    finnDaemon.memory.characterMoments.some(m => m.type === "growth"),
    "Plan Completion",
    "Completing plan creates growth moment"
  );

  // =========================================================================
  // TEST 7: Run Daemon System Integration
  // =========================================================================
  console.log(`${c.bold}=== TEST 7: Daemon System Integration ===${c.reset}\n`);

  // Run the daemon system a few times
  console.log(`${c.dim}Running daemon observation cycles...${c.reset}`);

  for (let i = 0; i < 3; i++) {
    // Set observation time to past to trigger observation
    emmaDaemon.lastObservation = 0;
    willemDaemon.lastObservation = 0;
    finnDaemon.lastObservation = 0;

    const result = await runDaemonSystem(world, registry);
    console.log(`  Cycle ${i + 1}: ${result.observations} observations`);
    await sleep(100);
  }

  assert(
    emmaDaemon.observationCount > 0,
    "Daemon Integration",
    "Daemon observation count increased"
  );

  // =========================================================================
  // TEST 8: Detailed Summary Output
  // =========================================================================
  console.log(`${c.bold}=== TEST 8: Detailed Summary Output ===${c.reset}\n`);

  const emmaSummary = getDaemonDetailedSummary(emmaDaemon);

  assert(
    emmaSummary.includes("Narrative Arc"),
    "Summary Output",
    "Detailed summary includes narrative arc"
  );

  assert(
    emmaSummary.includes("Memory"),
    "Summary Output",
    "Detailed summary includes memory"
  );

  console.log(`${c.dim}Emma's detailed daemon summary:${c.reset}`);
  console.log(emmaSummary);
  console.log();

  // =========================================================================
  // TEST 9: Registry Summary with Mini-Narrator Info
  // =========================================================================
  console.log(`${c.bold}=== TEST 9: Registry Summary ===${c.reset}\n`);

  const registrySummary = getDaemonSummary(registry);

  assert(
    registrySummary.includes("Arc:"),
    "Registry Summary",
    "Registry summary includes arc info for each daemon"
  );

  assert(
    registrySummary.includes("Memory:"),
    "Registry Summary",
    "Registry summary includes memory counts"
  );

  console.log(registrySummary);
  console.log();

  // =========================================================================
  // RESULTS
  // =========================================================================
  console.log(`${c.bold}═══════════════════════════════════════════════════════════${c.reset}`);
  console.log(`${c.bold}  TEST RESULTS${c.reset}`);
  console.log(`${c.bold}═══════════════════════════════════════════════════════════${c.reset}\n`);

  let passed = 0;
  let failed = 0;

  for (const result of results) {
    console.log(`  ${result.message}`);
    if (result.passed) passed++;
    else failed++;
  }

  console.log();
  console.log(`${c.bold}Total: ${passed + failed} tests${c.reset}`);
  console.log(`${c.green}Passed: ${passed}${c.reset}`);
  if (failed > 0) {
    console.log(`${c.red}Failed: ${failed}${c.reset}`);
  }
  console.log();

  if (failed === 0) {
    console.log(`${c.bold}${c.green}✅ All tests passed!${c.reset}\n`);
    process.exit(0);
  } else {
    console.log(`${c.bold}${c.red}❌ Some tests failed${c.reset}\n`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`${c.red}Error:${c.reset}`, err);
  process.exit(1);
});
