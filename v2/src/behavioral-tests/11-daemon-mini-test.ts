/**
 * Mini Daemon Test
 *
 * Small simulation with 2 NPCs to test the daemon system.
 * Daemons watch their agents, whisper guidance, and report growth opportunities.
 */

import "dotenv/config";
import { query, addEntity, addComponent } from "bitecs";
import { Name, Description, Agent, Mind, Health, Goal, Room } from "../ecs/components";
import { HasGoal, OccupiesRoom } from "../ecs/relations";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../ecs/prefabs";
import {
  createDaemonRegistry,
  createDaemonForAgent,
  runDaemonSystem,
  getDaemonSummary,
  type DaemonRegistry,
} from "../spirits/agent-daemon";
import { agentThink, getAgentThoughts } from "../cognition/agent-mind";
import { Thought } from "../ecs/components";

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

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log(`${c.bold}${c.cyan}╔═══════════════════════════════════════════════════════════╗${c.reset}`);
  console.log(`${c.bold}${c.cyan}║           DAEMON MINI TEST - 2 NPCs                       ║${c.reset}`);
  console.log(`${c.bold}${c.cyan}║           Testing Guardian Spirit System                  ║${c.reset}`);
  console.log(`${c.bold}${c.cyan}╚═══════════════════════════════════════════════════════════╝${c.reset}\n`);

  // Create world
  console.log(`${c.dim}Creating world...${c.reset}`);
  const world = createArgosWorld();
  initializePrefabs(world);

  // Create a simple room
  const tavernId = createRoomEntity(world, {
    name: "The Dusty Tavern",
    description: "A dimly lit tavern with creaky floorboards and the smell of stale ale.",
    capacity: 20,
    ambience: "quiet and tense",
  });
  console.log(`${c.green}✓ Created: The Dusty Tavern${c.reset}`);

  // Create 2 NPCs with contrasting personalities
  const aliceId = createAgentEntity(world, {
    name: "Alice the Curious",
    role: "wanderer",
    systemPrompt: "You are Alice, a curious young woman who just arrived in town. You're eager to explore and make friends, but you're also cautious of strangers.",
    description: "A bright-eyed young woman with dusty traveling clothes",
    roomId: tavernId,
  });
  Mind.arousal[aliceId] = 0.6;  // Alert and engaged
  Mind.focus[aliceId] = "exploring the tavern";
  Health.current[aliceId] = 90;
  Health.max[aliceId] = 100;
  console.log(`${c.green}✓ Created: Alice the Curious${c.reset}`);

  const bobId = createAgentEntity(world, {
    name: "Bob the Brooding",
    role: "local",
    systemPrompt: "You are Bob, a sullen local who has seen too much. You sit in your corner, nursing your drink, suspicious of newcomers.",
    description: "A grizzled man with tired eyes, hunched over a mug",
    roomId: tavernId,
  });
  Mind.arousal[bobId] = 0.2;  // Low arousal - disengaged
  Mind.focus[bobId] = "";
  Health.current[bobId] = 60;
  Health.max[bobId] = 100;
  console.log(`${c.green}✓ Created: Bob the Brooding${c.reset}`);

  // Give Alice a goal, Bob has none (to trigger daemon concern)
  const goalId = addEntity(world);
  addComponent(world, goalId, Goal);
  addComponent(world, aliceId, HasGoal(goalId));
  Goal.description[goalId] = "Find out about the mysterious disappearances in town";
  Goal.priority[goalId] = 7;
  Goal.status[goalId] = "active";
  console.log(`${c.green}✓ Alice has a goal: Find out about disappearances${c.reset}`);
  console.log(`${c.yellow}! Bob has no goals (daemon should notice)${c.reset}\n`);

  // Create daemon registry with faster intervals for testing
  const daemonRegistry: DaemonRegistry = createDaemonRegistry(
    5000,   // Observe every 5 seconds
    10000,  // Whisper cooldown 10 seconds
    20000   // Report cooldown 20 seconds
  );

  // Create daemons for both agents
  const aliceDaemon = createDaemonForAgent(daemonRegistry, world, aliceId);
  const bobDaemon = createDaemonForAgent(daemonRegistry, world, bobId);

  console.log(`${c.magenta}👻 Daemons created for both agents${c.reset}\n`);

  // Run simulation loop
  const CYCLES = 5;
  const CYCLE_DELAY_MS = 6000;

  console.log(`${c.bold}═══════════════════════════════════════════════════════════${c.reset}`);
  console.log(`${c.bold}  SIMULATION START - ${CYCLES} cycles${c.reset}`);
  console.log(`${c.bold}═══════════════════════════════════════════════════════════${c.reset}\n`);

  for (let cycle = 1; cycle <= CYCLES; cycle++) {
    console.log(`${c.bold}${c.blue}──── Cycle ${cycle}/${CYCLES} ────${c.reset}\n`);

    // Run agent cognition
    console.log(`${c.cyan}🧠 Agent Cognition:${c.reset}`);

    try {
      const aliceAction = await agentThink(world, aliceId);
      const aliceThoughts = getAgentThoughts(world, aliceId);
      const latestAliceThought = aliceThoughts.length > 0 ? Thought.content[aliceThoughts[aliceThoughts.length - 1]] : null;

      console.log(`${c.white}  Alice thinks: "${latestAliceThought?.slice(0, 60) || 'nothing'}..."${c.reset}`);
      console.log(`${c.green}  Alice action: ${aliceAction.type}${aliceAction.content ? ` - ${aliceAction.content.slice(0, 40)}...` : ''}${c.reset}`);
    } catch (e) {
      console.log(`${c.dim}  Alice: (cognition skipped)${c.reset}`);
    }

    try {
      const bobAction = await agentThink(world, bobId);
      const bobThoughts = getAgentThoughts(world, bobId);
      const latestBobThought = bobThoughts.length > 0 ? Thought.content[bobThoughts[bobThoughts.length - 1]] : null;

      console.log(`${c.white}  Bob thinks: "${latestBobThought?.slice(0, 60) || 'nothing'}..."${c.reset}`);
      console.log(`${c.green}  Bob action: ${bobAction.type}${bobAction.content ? ` - ${bobAction.content.slice(0, 40)}...` : ''}${c.reset}`);
    } catch (e) {
      console.log(`${c.dim}  Bob: (cognition skipped)${c.reset}`);
    }

    // Run daemon system
    console.log(`\n${c.magenta}👻 Daemon System:${c.reset}`);
    const daemonResult = await runDaemonSystem(world, daemonRegistry);

    console.log(`${c.dim}  Observations: ${daemonResult.observations}${c.reset}`);
    console.log(`${c.dim}  Whispers: ${daemonResult.whispers}${c.reset}`);
    console.log(`${c.dim}  Challenges: ${daemonResult.challenges}${c.reset}`);
    console.log(`${c.dim}  Reports: ${daemonResult.reports}${c.reset}`);

    // Show current agent states
    console.log(`\n${c.yellow}📊 Agent States:${c.reset}`);
    console.log(`${c.dim}  Alice: arousal=${Mind.arousal[aliceId].toFixed(2)}, health=${Health.current[aliceId]}, focus="${Mind.focus[aliceId]}"${c.reset}`);
    console.log(`${c.dim}  Bob: arousal=${Mind.arousal[bobId].toFixed(2)}, health=${Health.current[bobId]}, focus="${Mind.focus[bobId] || 'none'}"${c.reset}`);

    // Simulate some state changes for variety
    if (cycle === 2) {
      // Bob's health drops - daemon should notice danger
      Health.current[bobId] = 25;
      console.log(`\n${c.red}⚠️  Bob's health dropped to 25!${c.reset}`);
    }
    if (cycle === 3) {
      // Alice gets stuck (same focus)
      Mind.arousal[aliceId] = 0.45;
      console.log(`\n${c.yellow}📍 Alice seems stuck in her comfort zone...${c.reset}`);
    }
    if (cycle === 4) {
      // Bob becomes more engaged
      Mind.arousal[bobId] = 0.5;
      Mind.focus[bobId] = "watching Alice";
      console.log(`\n${c.green}👀 Bob perks up and starts watching Alice${c.reset}`);
    }

    if (cycle < CYCLES) {
      console.log(`\n${c.dim}Waiting ${CYCLE_DELAY_MS/1000}s...${c.reset}\n`);
      await sleep(CYCLE_DELAY_MS);
    }
  }

  // Final summary
  console.log(`\n${c.bold}═══════════════════════════════════════════════════════════${c.reset}`);
  console.log(`${c.bold}  FINAL DAEMON SUMMARY${c.reset}`);
  console.log(`${c.bold}═══════════════════════════════════════════════════════════${c.reset}\n`);

  console.log(getDaemonSummary(daemonRegistry));

  console.log(`\n${c.bold}${c.green}✅ Daemon mini test complete!${c.reset}\n`);
}

main().catch(console.error);
