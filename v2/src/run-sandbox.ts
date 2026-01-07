import "dotenv/config";
import * as path from "path";
import { createArgosWorld } from "./ecs/world";
import { initializePrefabs, resetRoomPositionCounter } from "./ecs/prefabs";
import { createGodAgent, godCommand, getWorldState, tickWorld, type GodAgentState } from "./god/god-agent";
import {
  runCognitionCycle,
  executeActions,
  broadcastToRoom,
} from "./cognition/cognition-system";
import {
  createTimeProgressionSystem,
  createSocialDynamicsSystem,
  createNarrativeEventSystem,
  createRelationshipEvolutionSystem
} from "./systems/builtin-systems";
import { consumeLogs } from "./ecs/dynamic-systems";
import { createSimulationServer } from "./server/simulation-server";
import { query, getRelationTargets } from "bitecs";
import { Agent, Name, Room } from "./ecs/components";
import { OccupiesRoom } from "./ecs/relations";
import { clearAllAgentMemory } from "./cognition/agent-mind";
import { autoSave, hasAutoSave, loadAutoSave } from "./persistence/world-persistence";
import { loadCharacterAnimations } from "./rendering/animation-loader";
import type { World } from "./ecs/world";

interface SimulationInstance {
  world: World;
  god: GodAgentState;
  cycle: number;
}

function createSimulation(): SimulationInstance {
  const world = createArgosWorld("The Void");
  initializePrefabs(world);
  resetRoomPositionCounter();

  const god = createGodAgent(world, {
    name: "The Architect",
    worldName: "Sandbox",
    narrative: `You are an omnipotent creator. The user will describe what kind of world, simulation, 
or environment they want to create. You can create anything:
- Biological simulations (cells, organisms, ecosystems)
- Social simulations (villages, cities, civilizations)
- Game worlds (puzzles, adventures)
- Scientific models (physics, chemistry, astronomy)
- Abstract systems (economies, networks, games)

Create entities, rooms/spaces, agents with behaviors, stimulus sources, and dynamic systems.
Be creative and responsive to what the user wants to explore.`,
  });

  god.systemRegistry.systems.set("TimeProgression", createTimeProgressionSystem());
  god.systemRegistry.systems.set("SocialDynamics", createSocialDynamicsSystem());
  god.systemRegistry.systems.set("NarrativeEvents", createNarrativeEventSystem());
  god.systemRegistry.systems.set("RelationshipEvolution", createRelationshipEvolutionSystem());

  return { world, god, cycle: 0 };
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║         ArgOS v2 - Sandbox Mode                              ║");
  console.log("║         Use the God Console to create your world!            ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    console.error("Error: GOOGLE_GENERATIVE_AI_API_KEY not set");
    process.exit(1);
  }

  // Pre-load character sprite atlases for rendering
  console.log("🎨 Loading character sprite atlases...");
  const charactersDir = path.join(process.cwd(), "public/32x32/Characters_32x32");
  try {
    await loadCharacterAnimations(charactersDir, "Farmer_1");
    await loadCharacterAnimations(charactersDir, "Farmer_2");
    console.log("✅ Character atlases loaded");
  } catch (e) {
    console.warn("⚠️ Could not load character atlases:", e);
  }

  const server = createSimulationServer(3000);
  let sim = createSimulation();
  let lastRoomCount = 0;
  let lastAutoSave = Date.now();
  const AUTO_SAVE_INTERVAL = 30000;
  
  if (await hasAutoSave()) {
    console.log("📂 Found autosave, restoring...");
    const loaded = await loadAutoSave(sim.world, sim.god.systemRegistry);
    if (loaded) {
      console.log("✅ World restored from autosave");
    }
  }

  function updateServerState() {
    server.setSimulationState({
      world: sim.world,
      registry: sim.god.systemRegistry,
      tick: sim.cycle,
      events: sim.god.systemRegistry.events.slice(-50),
      logs: sim.god.systemRegistry.logs.slice(-50),
    });
    server.setGodAgent(sim.god);
  }

  server.onReset(() => {
    console.log("\n🔄 Resetting world...\n");
    clearAllAgentMemory(sim.world);
    sim = createSimulation();
    lastRoomCount = 0;
    updateServerState();
    server.updateState();
    console.log("🌌 World reset complete. Ready for new creation.\n");
  });

  console.log("🌌 Empty world created. Use the God Console at http://localhost:3000\n");
  console.log("Example prompts:");
  console.log("  • Create a living cell with organelles that interact");
  console.log("  • Build an apartment with a person who needs food and sleep");
  console.log("  • Simulate a solar system with planets orbiting a star");
  console.log("  • Create an office with employees and deadlines");
  console.log("  • Model an ant colony with workers, soldiers, and a queen\n");

  updateServerState();
  server.start();

  async function simulationLoop() {
    if (server.isPaused()) {
      setTimeout(simulationLoop, 1000);
      return;
    }

    const rooms = Array.from(query(sim.world, [Room]));
    const agents = Array.from(query(sim.world, [Agent]));
    
    if (rooms.length === 0 && agents.length === 0) {
      setTimeout(simulationLoop, 1000);
      return;
    }

    sim.cycle++;
    
    if (sim.cycle % 10 === 1 || rooms.length !== lastRoomCount) {
      console.log(`\n--- Cycle ${sim.cycle} | ${agents.length} agents, ${rooms.length} rooms ---`);
      lastRoomCount = rooms.length;
    }

    const events = tickWorld(sim.god, 5000);
    
    for (const event of events) {
      server.pushEvent(event.type, event.data);
    }
    
    const logs = consumeLogs(sim.god.systemRegistry);
    for (const log of logs) {
      server.pushLog(log);
    }

    if (agents.length > 0) {
      const actions = await runCognitionCycle(sim.world, sim.god.systemRegistry);
      
      for (const { eid, action } of actions) {
        const name = Name.value[eid];
        server.pushAgentAction(name, action);
      }
      
      executeActions(sim.world, actions, sim.god.systemRegistry);
    }

    updateServerState();
    server.updateState();

    const now = Date.now();
    if (now - lastAutoSave > AUTO_SAVE_INTERVAL && (rooms.length > 0 || agents.length > 0)) {
      lastAutoSave = now;
      autoSave(sim.world, sim.god.systemRegistry).catch(err => {
        console.error("[AutoSave] Failed:", err);
      });
    }

    setTimeout(simulationLoop, 3000);
  }

  setTimeout(simulationLoop, 1000);

  process.on("SIGINT", () => {
    console.log("\n\n🛑 Sandbox stopped.");
    process.exit(0);
  });
}

main().catch(console.error);
