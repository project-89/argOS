import "dotenv/config";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs } from "../ecs/prefabs";
import { createGodAgent, godCommand, getWorldState, tickWorld } from "../god/god-agent";
import {
  createSimulation,
  deleteSimulation,
  listSimulations,
  getCurrentSimulation,
  setCurrentSimulation,
} from "../persistence/simulation-manager";

const NUM_TICKS = 15;
const TICK_DELAY_MS = 500;

async function cleanup() {
  const sims = await listSimulations();
  for (const sim of sims) {
    if (sim.name.startsWith("stress-test-")) {
      try {
        await deleteSimulation(sim.id);
        console.log(`Cleaned up: ${sim.id}`);
      } catch {}
    }
  }
}

async function main() {
  console.log("=== ArgOS v2 - GodAI + Persistence Stress Test ===\n");

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    console.error("Error: GOOGLE_GENERATIVE_AI_API_KEY not set");
    process.exit(1);
  }

  await cleanup();

  // Create a simulation for this run
  const simulation = await createSimulation({
    name: `stress-test-${Date.now()}`,
    description: "GodAI stress test with persistence",
    storyTemplate: "classic_three_act",
    autosaveInterval: 5,  // Save every 5 ticks
    snapshotInterval: 10, // Snapshot every 10 ticks
    maxSnapshots: 5,
  });

  setCurrentSimulation(simulation);
  console.log(`Created simulation: ${simulation.name} (${simulation.id})`);
  console.log(`Path: ${simulation.basePath}\n`);

  // Create world
  const world = createArgosWorld("The Crossroads Inn");
  initializePrefabs(world);

  const god = createGodAgent(world, {
    name: "Demiurge",
    worldName: "The Crossroads Inn",
    narrative: `A mysterious inn at a crossroads where travelers from all walks of life gather.
Tonight, a storm has forced several unusual guests to seek shelter.
Create drama, secrets, and unexpected connections between the characters.`,
  });

  console.log("=== PHASE 1: World Setup ===\n");

  await godCommand(god, `
    Create the world:
    1. Create the main tavern room - "The Common Room" - warm but tense atmosphere
    2. Create a brooding knight who has lost his honor
    3. Create a mysterious fortune teller with unsettling predictions
    4. Create an innkeeper who sees everything but says nothing
    5. Place all characters in the tavern

    Also use the simulation persistence - append to narrative that the story is beginning.
  `);

  console.log("\n=== INITIAL WORLD STATE ===");
  console.log(getWorldState(god));

  console.log("\n=== PHASE 2: Create Dynamic Systems ===\n");

  await godCommand(god, `
    Create systems to bring the world alive:

    1. Create a "TensionBuildupSystem" that gradually increases tension in rooms
       where multiple agents with different temperaments are present

    2. Activate all systems

    3. Set the story template to classic_three_act if not already set

    4. Log a simulation event for "phase_complete" with phase "setup"
  `);

  console.log("\n=== WORLD STATE WITH SYSTEMS ===");
  console.log(getWorldState(god));

  console.log("\n=== PHASE 3: Running Simulation Ticks ===\n");

  const startTime = Date.now();
  let totalEvents = 0;

  for (let i = 0; i < NUM_TICKS; i++) {
    const tickNum = i + 1;
    console.log(`\n--- Tick ${tickNum}/${NUM_TICKS} ---`);

    // Update simulation tick
    simulation.updateTick(tickNum);

    // Run world tick
    const events = tickWorld(god, 1000);
    totalEvents += events.length;

    if (events.length > 0) {
      console.log(`  Events: ${events.length}`);
      for (const event of events.slice(0, 3)) {
        console.log(`    [${event.type}] ${JSON.stringify(event.data).substring(0, 60)}...`);
      }
      if (events.length > 3) {
        console.log(`    ... and ${events.length - 3} more`);
      }
    }

    // Log narrative progress every few ticks
    if (tickNum % 3 === 0) {
      simulation.appendNarrative(`Tick ${tickNum}: The tension continues to build...`);
      simulation.logEvent("tick_milestone", { tick: tickNum, events: events.length });
    }

    // Check autosave/snapshot triggers
    if (tickNum % simulation.getMetadata().autosaveInterval === 0) {
      console.log(`  [Auto-save triggered at tick ${tickNum}]`);
      await simulation.saveMetadata();
      await simulation.flushLogs();
    }

    await new Promise((resolve) => setTimeout(resolve, TICK_DELAY_MS));
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log("\n=== PHASE 4: Final State ===\n");
  console.log(getWorldState(god));

  // Save final state
  await simulation.saveMetadata();
  await simulation.flushLogs();

  console.log("\n=== SIMULATION SUMMARY ===");
  console.log(`  Simulation ID: ${simulation.id}`);
  console.log(`  Total ticks: ${NUM_TICKS}`);
  console.log(`  Total events: ${totalEvents}`);
  console.log(`  Elapsed time: ${elapsed}s`);
  console.log(`  Data path: ${simulation.basePath}`);

  // List what was saved
  const snapshots = await simulation.listSnapshots();
  console.log(`  Snapshots: ${snapshots.length}`);
  for (const s of snapshots) {
    console.log(`    - tick ${s.tick} (${s.savedAt.toISOString()})`);
  }

  // Read narrative log
  const narrative = await simulation.readNarrativeLog();
  if (narrative) {
    console.log(`\n=== NARRATIVE LOG (preview) ===`);
    console.log(narrative.substring(0, 500));
    if (narrative.length > 500) {
      console.log(`... (${narrative.length} chars total)`);
    }
  }

  console.log("\n=== STRESS TEST COMPLETE ===");

  // Don't delete - let user inspect
  console.log(`\nSimulation data preserved at: ${simulation.basePath}`);
  console.log("Run 'rm -rf simulations/stress-test-*' to clean up");
}

main().catch(console.error);
