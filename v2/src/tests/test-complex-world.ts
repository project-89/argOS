import "dotenv/config";
import * as path from "path";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, resetRoomPositionCounter } from "../ecs/prefabs";
import { createGodAgent, godCommand, getWorldState, tickWorld, type GodAgentState } from "../god/god-agent";
import {
  runCognitionCycle,
  executeActions,
} from "../cognition/cognition-system";
import {
  createTimeProgressionSystem,
  createSocialDynamicsSystem,
  createNarrativeEventSystem,
  createRelationshipEvolutionSystem
} from "../systems/builtin-systems";
import { consumeLogs } from "../ecs/dynamic-systems";
import { query } from "bitecs";
import { Agent, Name, Room, GridPosition, Needs } from "../ecs/components";
import { loadCharacterAnimations } from "../rendering/animation-loader";
import { loadAllSystems } from "../systems/system-loader";
import type { World } from "../ecs/world";

interface SimulationInstance {
  world: World;
  god: GodAgentState;
  cycle: number;
}

function createSimulation(): SimulationInstance {
  const world = createArgosWorld("Test World");
  initializePrefabs(world);
  resetRoomPositionCounter();

  const god = createGodAgent(world, {
    name: "Test Architect",
    worldName: "Complex Farm Test",
    narrative: `A complex farm simulation with multiple interacting systems.`,
  });

  god.systemRegistry.systems.set("TimeProgression", createTimeProgressionSystem());
  god.systemRegistry.systems.set("SocialDynamics", createSocialDynamicsSystem());
  god.systemRegistry.systems.set("NarrativeEvents", createNarrativeEventSystem());
  god.systemRegistry.systems.set("RelationshipEvolution", createRelationshipEvolutionSystem());

  return { world, god, cycle: 0 };
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║         ArgOS v2 - Complex World Test                         ║");
  console.log("║         Testing automated world building                      ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    console.error("Error: GOOGLE_GENERATIVE_AI_API_KEY not set");
    process.exit(1);
  }

  // Load character animations
  console.log("🎨 Loading character sprite atlases...");
  const charactersDir = path.join(process.cwd(), "public/32x32/Characters_32x32");
  try {
    await loadCharacterAnimations(charactersDir, "Farmer_1");
    await loadCharacterAnimations(charactersDir, "Farmer_2");
    console.log("✅ Character atlases loaded");
  } catch (e) {
    console.warn("⚠️ Could not load character atlases:", e);
  }

  const sim = createSimulation();

  // Load file-based systems
  console.log("⚙️  Loading behavior systems...");
  const fileSystems = await loadAllSystems();
  sim.god.fileSystems = fileSystems;
  console.log(`✅ Loaded ${fileSystems.length} systems: ${fileSystems.map(s => s.name).join(", ")}`);

  // ========== WORLD BUILDING PHASE ==========
  console.log("\n" + "=".repeat(60));
  console.log("PHASE 1: Building the World");
  console.log("=".repeat(60) + "\n");

  // Create the world map
  console.log("Creating world map...");
  await godCommand(sim.god, `
    Create a large farm world with:
    1. A 25x20 grass tilemap called "MacDonald Farm"
    2. Add some variation - maybe a small pond area using water tiles (~)
    3. Add a dirt path (.) running through the middle
  `);

  // Create multiple NPCs with different roles
  console.log("\nCreating farm workers...");
  await godCommand(sim.god, `
    Create 4 different farm workers on the farm:
    1. "Old MacDonald" - the farmer owner at position (5, 5), wise and experienced
    2. "Young Billy" - an energetic farmhand at (15, 8), eager to learn
    3. "Martha" - the cook who manages food at (10, 15), caring personality
    4. "Grumpy Pete" - an older worker at (20, 10), cynical but hardworking

    Give each of them farmer_1 or farmer_2 character rigs with idle animations.
    Place them all on the grid at their specified positions.
  `);

  // Create food and resource entities
  console.log("\nCreating farm resources...");
  await godCommand(sim.god, `
    Create interactive objects on the farm:
    1. A "Food Barrel" at position (10, 14) - contains food, can satisfy hunger
    2. A "Water Well" at position (12, 5) - provides water
    3. A "Hay Bale" at position (8, 8) - a resting spot
    4. A "Tool Shed" marker at position (2, 2)

    These should be entities with GridPosition components so they appear on the map.
  `);

  // Set up needs for NPCs
  console.log("\nSetting up NPC needs...");
  await godCommand(sim.god, `
    Make sure all the farm workers have Needs components:
    - Set hunger to random values between 40-80
    - Set energy to random values between 30-70
    This will make them seek food and rest over time.
  `);

  // ========== VERIFICATION PHASE ==========
  console.log("\n" + "=".repeat(60));
  console.log("PHASE 2: Verifying World State");
  console.log("=".repeat(60) + "\n");

  const worldState = getWorldState(sim.god);
  console.log("World State:", worldState);

  // Count entities
  const agents = Array.from(query(sim.world, [Agent]));
  const rooms = Array.from(query(sim.world, [Room]));
  const withPositions = Array.from(query(sim.world, [GridPosition]));

  console.log(`\n📊 Entity Summary:`);
  console.log(`   Agents: ${agents.length}`);
  console.log(`   Rooms: ${rooms.length}`);
  console.log(`   Entities with grid positions: ${withPositions.length}`);

  // Show each agent's details
  console.log("\n👤 Agent Details:");
  for (const eid of agents) {
    const name = Name.value[eid];
    const x = GridPosition.x[eid];
    const y = GridPosition.y[eid];
    const hunger = Needs.hunger?.[eid] ?? "N/A";
    const energy = Needs.energy?.[eid] ?? "N/A";
    console.log(`   ${name}: pos(${x ?? "?"}, ${y ?? "?"}) hunger=${hunger} energy=${energy}`);
  }

  // ========== SIMULATION PHASE ==========
  console.log("\n" + "=".repeat(60));
  console.log("PHASE 3: Running Simulation Cycles");
  console.log("=".repeat(60) + "\n");

  const CYCLES = 5;
  for (let i = 0; i < CYCLES; i++) {
    sim.cycle++;
    console.log(`\n--- Cycle ${sim.cycle} ---`);

    // Run world tick (processes file-based systems)
    const events = tickWorld(sim.god, 5000);
    for (const event of events) {
      console.log(`  [Event] ${event.type}: ${JSON.stringify(event.data).slice(0, 80)}`);
    }

    // Run cognition for agents
    if (agents.length > 0) {
      const actions = await runCognitionCycle(sim.world, sim.god.systemRegistry);

      for (const { eid, action } of actions) {
        const name = Name.value[eid];
        console.log(`  [${name}] ${action.type}: ${action.target || action.content || ""}`);
      }

      executeActions(sim.world, actions, sim.god.systemRegistry);
    }

    // Consume and display logs
    const logs = consumeLogs(sim.god.systemRegistry);
    for (const log of logs) {
      if (log.includes("moved") || log.includes("RandomWander")) {
        console.log(`  ${log}`);
      }
    }

    // Show position updates
    console.log("\n  Position Updates:");
    for (const eid of agents) {
      const name = Name.value[eid];
      const x = GridPosition.x[eid];
      const y = GridPosition.y[eid];
      console.log(`    ${name}: (${x}, ${y})`);
    }

    // Small delay between cycles
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // ========== FINAL STATE ==========
  console.log("\n" + "=".repeat(60));
  console.log("PHASE 4: Final World State");
  console.log("=".repeat(60) + "\n");

  console.log("Final entity positions:");
  for (const eid of withPositions) {
    const name = Name.value[eid] || `Entity ${eid}`;
    const x = GridPosition.x[eid];
    const y = GridPosition.y[eid];
    console.log(`  ${name}: (${x}, ${y})`);
  }

  console.log("\n✅ Complex world test complete!");
  console.log("The world has been created with:");
  console.log(`  - ${agents.length} NPCs with cognition`);
  console.log(`  - ${withPositions.length} positioned entities`);
  console.log(`  - ${fileSystems.length} behavior systems running`);
}

main().catch(console.error);
