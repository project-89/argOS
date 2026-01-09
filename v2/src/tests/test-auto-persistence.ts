import "dotenv/config";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs } from "../ecs/prefabs";
import {
  createGodAgentWithPersistence,
  godCommand,
  tickWorldAsync,
  getWorldState,
} from "../god/god-agent";
import { listSimulations, deleteSimulation } from "../persistence/simulation-manager";

async function cleanup() {
  const sims = await listSimulations();
  for (const sim of sims) {
    if (sim.name?.startsWith("auto-persist-test")) {
      await deleteSimulation(sim.id);
    }
  }
}

async function main() {
  console.log("=== Auto-Persistence Test ===\n");

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    console.error("Error: GOOGLE_GENERATIVE_AI_API_KEY not set");
    process.exit(1);
  }

  await cleanup();

  // Create world
  const world = createArgosWorld("Test World");
  initializePrefabs(world);

  // Create GodAgent WITH persistence enabled - this is the key!
  const god = await createGodAgentWithPersistence(world, {
    name: "TestGod",
    worldName: "auto-persist-test",
    narrative: "A test simulation with automatic persistence",
    persistence: {
      autosaveInterval: 3,  // Save every 3 ticks
      snapshotInterval: 6,  // Snapshot every 6 ticks
      maxSnapshots: 2,
    },
  });

  console.log(`Simulation: ${god.simulation?.id}`);
  console.log(`Path: ${god.simulation?.basePath}\n`);

  // Setup a simple world
  await godCommand(god, `
    Create a simple test room called "Test Chamber" and
    add one agent named "TestBot" who is a curious robot.
    Place TestBot in the Test Chamber.
  `);

  console.log("=== Running 10 ticks with auto-persistence ===\n");

  for (let i = 0; i < 10; i++) {
    const result = await tickWorldAsync(god, 1000);

    let status = `Tick ${god.tick}`;
    if (result.snapshot) {
      status += " [SNAPSHOT]";
    } else if (result.saved) {
      status += " [SAVED]";
    }
    if (result.events.length > 0) {
      status += ` (${result.events.length} events)`;
    }
    console.log(status);

    await new Promise((r) => setTimeout(r, 100));
  }

  // List snapshots
  const snapshots = await god.simulation!.listSnapshots();
  console.log(`\n=== Snapshots Created: ${snapshots.length} ===`);
  for (const s of snapshots) {
    console.log(`  - tick ${s.tick}`);
  }

  // Check simulation metadata
  const meta = god.simulation!.getMetadata();
  console.log(`\n=== Final State ===`);
  console.log(`  Current tick: ${meta.currentTick}`);
  console.log(`  Last saved: ${new Date(meta.lastSavedAt).toISOString()}`);

  console.log(`\nData saved at: ${god.simulation!.basePath}`);
  console.log("\n=== Test Complete ===");

  // Cleanup
  await deleteSimulation(god.simulation!.id);
  console.log("(Test simulation cleaned up)");
}

main().catch(console.error);
