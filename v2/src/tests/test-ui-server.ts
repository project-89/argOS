import "dotenv/config";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs } from "../ecs/prefabs";
import { createSimulationServer } from "../server/simulation-server";
import {
  createGodAgentWithPersistence,
  godCommand,
  tickWorldAsync,
} from "../god/god-agent";
import { createSpiritRegistry, createSpirit, setGodAgent } from "../spirits/spirit-registry";
import type { SpiritDefinition } from "../spirits/types";

async function main() {
  console.log("=== UI Server Test ===\n");

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    console.error("Error: GOOGLE_GENERATIVE_AI_API_KEY not set");
    process.exit(1);
  }

  // Create world
  const world = createArgosWorld("Test World");
  initializePrefabs(world);

  // Create GodAgent with persistence
  const god = await createGodAgentWithPersistence(world, {
    name: "TestGod",
    worldName: "ui-test",
    narrative: "A test simulation for the UI",
    persistence: {
      autosaveInterval: 10,
      snapshotInterval: 30,
      maxSnapshots: 3,
    },
  });

  // Create spirit registry with some spirits
  const spiritRegistry = createSpiritRegistry(world);
  setGodAgent(spiritRegistry, god.godAgentEid);

  // Create some spirits
  const narratorDef: SpiritDefinition = {
    name: "NarratorSpirit",
    description: "Guides the story and manages narrative tension",
    domain: "narrative",
    rank: "archangel",
    observationInterval: 5000,
    responsibilities: ["story progression", "tension management"],
    capabilities: ["narrative analysis", "plot threading"],
  };

  const socialDef: SpiritDefinition = {
    name: "SocialSpirit",
    description: "Manages relationships and social dynamics",
    domain: "social",
    rank: "archangel",
    observationInterval: 8000,
    responsibilities: ["relationship tracking", "conflict mediation"],
    capabilities: ["social analysis", "faction management"],
  };

  const narrator = createSpirit(spiritRegistry, narratorDef);
  const social = createSpirit(spiritRegistry, socialDef);

  // Add some mock narrative state
  narrator.narrativeState = {
    currentAct: 1,
    currentPhase: "rising_action",
    tension: 0.35,
    plotThreads: [],
    activeThreads: ["main_conflict", "romance_subplot"],
    characterArcs: [],
    protagonists: [],
    antagonists: [],
    sceneHistory: [],
    plannedBeats: [],
    completedBeats: [],
  };

  social.socialState = {
    relationships: [
      { from: "Alice", to: "Bob", type: "friend" as any, strength: 0.8 },
      { from: "Bob", to: "Carol", type: "rival" as any, strength: -0.3 },
    ],
    factions: [{ name: "Merchants Guild" }, { name: "Thieves Guild" }] as any,
    factionRelations: [],
    activeConflicts: [{ parties: ["Alice", "Carol"], type: "resource" as any }] as any,
    resolvedConflicts: [],
    influencers: [],
    isolates: [],
    cliques: [],
  };

  // Create server
  const server = createSimulationServer(3456);

  // Set up simulation state
  server.setSimulationState({
    world,
    registry: god.systemRegistry,
    tick: 0,
    events: [],
    logs: [],
    spiritRegistry,
  });
  server.setGodAgent(god);
  server.setSpiritRegistry(spiritRegistry);

  // Start server
  server.start();

  // Create a simple world setup
  console.log("\nSetting up test world...");
  await godCommand(god, `
    Create a medieval tavern called "The Rusty Tankard" with a cozy, dimly-lit ambience.
    Add two agents:
    1. "Greta" - a cheerful innkeeper who loves to chat with customers
    2. "Marcus" - a mysterious traveler who speaks in riddles
    Place both in The Rusty Tankard.
  `);

  console.log("\nRunning simulation ticks...");

  // Run simulation loop
  const runSimulation = async () => {
    for (let i = 0; i < 100; i++) {
      await tickWorldAsync(god, 2000);

      // Update server state
      server.setSimulationState({
        world,
        registry: god.systemRegistry,
        tick: god.tick,
        events: [],
        logs: [],
        spiritRegistry,
      });
      server.updateState();

      console.log(`Tick ${god.tick}`);

      // Add small delay
      await new Promise(r => setTimeout(r, 3000));
    }
  };

  runSimulation().catch(console.error);

  console.log("\n===========================================");
  console.log("UI Server running at http://localhost:3456");
  console.log("Open in browser to view the simulation");
  console.log("Press Ctrl+C to stop");
  console.log("===========================================\n");
}

main().catch(console.error);
