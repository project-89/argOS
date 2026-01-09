import "dotenv/config";
import * as fs from "fs/promises";
import { existsSync } from "fs";
import * as path from "path";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs } from "../ecs/prefabs";
import { createGodAgent, godCommand, getWorldState, tickWorld } from "../god/god-agent";
import {
  createSimulation,
  loadSimulation,
  listSimulations,
  deleteSimulation,
  getCurrentSimulation,
  setCurrentSimulation,
  SimulationInstance,
  SIMULATIONS_DIR,
} from "../persistence/simulation-manager";

const TEST_SIM_NAME = "test-persistence-sim";

async function cleanup() {
  // Clean up any previous test simulations
  const sims = await listSimulations();
  for (const sim of sims) {
    if (sim.name.startsWith("test-")) {
      try {
        await deleteSimulation(sim.id);
        console.log(`Cleaned up: ${sim.id}`);
      } catch {}
    }
  }
}

async function testCreateSimulation(): Promise<SimulationInstance> {
  console.log("\n=== TEST: Create Simulation ===");

  const sim = await createSimulation({
    name: TEST_SIM_NAME,
    description: "Testing persistence system",
    autosaveInterval: 5, // Save every 5 ticks for testing
    snapshotInterval: 10, // Snapshot every 10 ticks
    maxSnapshots: 3,
  });

  console.log(`✓ Created simulation: ${sim.id}`);
  console.log(`  Name: ${sim.name}`);
  console.log(`  Path: ${sim.basePath}`);

  // Verify folder structure
  const expectedDirs = [
    sim.basePath,
    sim.getSystemsDir(),
    sim.getSnapshotsDir(),
    sim.getLogsDir(),
  ];

  for (const dir of expectedDirs) {
    if (!existsSync(dir)) {
      throw new Error(`Missing directory: ${dir}`);
    }
  }
  console.log(`✓ Folder structure created correctly`);

  // Verify simulation.json exists
  if (!existsSync(sim.getSimulationFilePath())) {
    throw new Error("simulation.json not created");
  }
  console.log(`✓ simulation.json created`);

  return sim;
}

async function testCurrentSimulationTracking(sim: SimulationInstance): Promise<void> {
  console.log("\n=== TEST: Current Simulation Tracking ===");

  setCurrentSimulation(sim);
  const current = getCurrentSimulation();

  if (!current) {
    throw new Error("getCurrentSimulation returned null");
  }
  if (current.id !== sim.id) {
    throw new Error(`Wrong simulation ID: expected ${sim.id}, got ${current.id}`);
  }
  console.log(`✓ Current simulation tracking works`);
}

async function testNarrativeLogging(sim: SimulationInstance): Promise<void> {
  console.log("\n=== TEST: Narrative Logging ===");

  sim.appendNarrative("The story begins...");
  sim.appendNarrative("A hero emerges from the shadows.");
  sim.appendNarrative("The quest is set into motion.");

  await sim.flushLogs();

  const narrativePath = sim.getNarrativeFilePath();
  if (!existsSync(narrativePath)) {
    throw new Error("narrative.txt not created");
  }

  const content = await fs.readFile(narrativePath, "utf-8");
  if (!content.includes("The story begins")) {
    throw new Error("Narrative content not saved correctly");
  }
  console.log(`✓ Narrative logging works`);
  console.log(`  Content preview: ${content.substring(0, 100)}...`);
}

async function testEventLogging(sim: SimulationInstance): Promise<void> {
  console.log("\n=== TEST: Event Logging ===");

  sim.logEvent("agent_action", { agent: "Hero", action: "move", target: "tavern" });
  sim.logEvent("system_run", { system: "WeatherSystem", tick: 1 });
  sim.logEvent("intervention", { type: "mood_shift", target: "Villain" });

  await sim.flushLogs();

  const eventsPath = sim.getEventsFilePath();
  if (!existsSync(eventsPath)) {
    throw new Error("events.jsonl not created");
  }

  const content = await fs.readFile(eventsPath, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);
  if (lines.length !== 3) {
    throw new Error(`Expected 3 events, got ${lines.length}`);
  }

  // Verify JSON lines format
  for (const line of lines) {
    JSON.parse(line); // Should not throw
  }
  console.log(`✓ Event logging works (${lines.length} events)`);
}

async function testListSimulations(): Promise<void> {
  console.log("\n=== TEST: List Simulations ===");

  const sims = await listSimulations();
  const testSim = sims.find((s) => s.name === TEST_SIM_NAME);

  if (!testSim) {
    throw new Error("Test simulation not found in list");
  }
  console.log(`✓ Simulation appears in list`);
  console.log(`  Total simulations: ${sims.length}`);
}

async function testLoadSimulation(originalId: string): Promise<SimulationInstance> {
  console.log("\n=== TEST: Load Simulation ===");

  // Clear current
  setCurrentSimulation(null);

  const loaded = await loadSimulation(originalId);

  if (loaded.id !== originalId) {
    throw new Error(`ID mismatch: expected ${originalId}, got ${loaded.id}`);
  }
  if (loaded.name !== TEST_SIM_NAME) {
    throw new Error(`Name mismatch: expected ${TEST_SIM_NAME}, got ${loaded.name}`);
  }
  console.log(`✓ Simulation loaded correctly`);
  console.log(`  Current tick: ${loaded.currentTick}`);

  return loaded;
}

async function testDeleteSimulation(id: string): Promise<void> {
  console.log("\n=== TEST: Delete Simulation ===");

  const simPath = path.join(SIMULATIONS_DIR, id);

  // Verify it exists first
  if (!existsSync(simPath)) {
    throw new Error("Simulation folder doesn't exist before deletion");
  }

  await deleteSimulation(id);

  if (existsSync(simPath)) {
    throw new Error("Simulation folder still exists after deletion");
  }
  console.log(`✓ Simulation deleted correctly`);
}

async function testSnapshotCycle(): Promise<void> {
  console.log("\n=== TEST: Snapshot Cycle ===");

  // Create a new sim for snapshot testing
  const sim = await createSimulation({
    name: "test-snapshots",
    snapshotInterval: 0, // Disable auto-snapshot, we'll do it manually
    maxSnapshots: 2, // Keep only 2
  });

  // Create some snapshots manually
  const world = createArgosWorld("SnapshotTest");
  initializePrefabs(world);
  const { systemRegistry } = createGodAgent(world, {
    name: "Tester",
    worldName: "SnapshotTest",
    narrative: "Testing snapshots",
  });

  // Create 3 snapshots, should keep only 2 (maxSnapshots)
  sim.updateTick(100);
  await sim.saveSnapshot(world, systemRegistry);

  sim.updateTick(200);
  await sim.saveSnapshot(world, systemRegistry);

  sim.updateTick(300);
  await sim.saveSnapshot(world, systemRegistry);

  const snapshots = await sim.listSnapshots();

  if (snapshots.length !== 2) {
    throw new Error(`Expected 2 snapshots after cleanup, got ${snapshots.length}`);
  }

  // Should have kept ticks 200 and 300 (newest)
  const ticks = snapshots.map((s) => s.tick).sort((a, b) => a - b);
  if (ticks[0] !== 200 || ticks[1] !== 300) {
    throw new Error(`Wrong snapshots kept: ${ticks.join(", ")}`);
  }

  console.log(`✓ Snapshot rotation works (kept ticks: ${ticks.join(", ")})`);

  // Cleanup
  await deleteSimulation(sim.id);
}

async function main() {
  console.log("=== ArgOS v2 - Persistence System Tests ===\n");

  try {
    await cleanup();

    // Run tests
    const sim = await testCreateSimulation();
    await testCurrentSimulationTracking(sim);
    await testNarrativeLogging(sim);
    await testEventLogging(sim);
    await testListSimulations();

    const loaded = await testLoadSimulation(sim.id);
    await testSnapshotCycle();

    // Final cleanup
    await testDeleteSimulation(loaded.id);

    console.log("\n=== ALL TESTS PASSED ===");
  } catch (error) {
    console.error("\n=== TEST FAILED ===");
    console.error(error);
    process.exit(1);
  }
}

main().catch(console.error);
