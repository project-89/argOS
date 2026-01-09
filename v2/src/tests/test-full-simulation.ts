import "dotenv/config";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs } from "../ecs/prefabs";
import { createGodAgent, godCommand, getWorldState, tickWorld } from "../god/god-agent";
import { 
  runCognitionCycle, 
  executeActions, 
  broadcastToRoom 
} from "../cognition/cognition-system";
import { getAgentKnowledge, getKnowledgeSummary } from "../cognition/knowledge-graph";
import { 
  createTimeProgressionSystem,
  createSocialDynamicsSystem,
  createNarrativeEventSystem,
  createRelationshipEvolutionSystem 
} from "../systems/builtin-systems";
import { query, getRelationTargets } from "bitecs";
import { Agent, Name, Mind } from "../ecs/components";
import { OccupiesRoom } from "../ecs/relations";

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║         ArgOS v2 - Full Simulation Test                      ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    console.error("Error: GOOGLE_GENERATIVE_AI_API_KEY not set");
    process.exit(1);
  }

  const world = createArgosWorld("The Realm");
  initializePrefabs(world);

  const god = createGodAgent(world, {
    name: "The Weaver",
    worldName: "The Crossroads Inn",
    narrative: `An ancient inn at a mystical crossroads where travelers from different walks of life meet. Strange things happen here - time feels different, and connections form quickly.`,
  });

  god.systemRegistry.systems.set("TimeProgression", createTimeProgressionSystem());
  god.systemRegistry.systems.set("SocialDynamics", createSocialDynamicsSystem());
  god.systemRegistry.systems.set("NarrativeEvents", createNarrativeEventSystem());
  god.systemRegistry.systems.set("RelationshipEvolution", createRelationshipEvolutionSystem());

  console.log("⚡ Creating world...\n");

  await godCommand(god, `
    Create "The Crossroads Inn" - a mystical tavern where paths converge.
    
    Create three agents:
    1. "Vera" - an elderly fortune teller with genuine sight, speaks in riddles but kind
    2. "Kael" - a young runaway noble seeking adventure, naive but brave
    3. "Iron Jack" - a weathered bounty hunter, few words, strong moral code
    
    Create a stimulus source "Mystic Hearth" - a fireplace that whispers secrets.
    
    Place everyone in the inn.
  `);

  console.log("\n" + "─".repeat(60));
  console.log("INITIAL WORLD STATE");
  console.log("─".repeat(60));
  console.log(getWorldState(god));

  const agents = Array.from(query(world, [Agent]));
  let innEid: number | undefined;
  const agentEids: Map<string, number> = new Map();
  
  for (const eid of agents) {
    const name = Name.value[eid];
    agentEids.set(name, eid);
    const rooms = getRelationTargets(world, eid, OccupiesRoom);
    if (rooms.length > 0) innEid = rooms[0];
  }

  console.log("\n" + "═".repeat(60));
  console.log("  ACT I: THE MEETING");
  console.log("═".repeat(60) + "\n");

  if (innEid !== undefined) {
    broadcastToRoom(world, innEid, {
      type: "environmental",
      content: "The door swings open. A storm rages outside. Three travelers find themselves drawn to the warmth of the hearth.",
      source: "narrator",
    });
  }

  for (const [name, eid] of agentEids) {
    Mind.arousal[eid] = 0.7 + Math.random() * 0.2;
  }

  for (let cycle = 1; cycle <= 4; cycle++) {
    console.log(`\n--- Scene ${cycle} ---\n`);
    
    tickWorld(god, 5000);
    
    const actions = await runCognitionCycle(world, god.systemRegistry);
    executeActions(world, actions, god.systemRegistry);
    
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  console.log("\n" + "═".repeat(60));
  console.log("  ACT II: THE REVELATION");
  console.log("═".repeat(60) + "\n");

  const veraEid = agentEids.get("Vera");
  if (veraEid !== undefined) {
    Mind.arousal[veraEid] = 0.95;
  }

  if (innEid !== undefined) {
    broadcastToRoom(world, innEid, {
      type: "mystical",
      content: "Vera's eyes suddenly go white. She gasps and clutches the table. 'I see... I see a great danger approaching. One of you carries a secret that will change everything.'",
      source: "mystic vision",
    });
  }

  for (let cycle = 5; cycle <= 7; cycle++) {
    console.log(`\n--- Scene ${cycle} ---\n`);
    
    tickWorld(god, 5000);
    
    const actions = await runCognitionCycle(world, god.systemRegistry);
    executeActions(world, actions, god.systemRegistry);
    
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  console.log("\n" + "═".repeat(60));
  console.log("  ACT III: THE CHOICE");
  console.log("═".repeat(60) + "\n");

  if (innEid !== undefined) {
    broadcastToRoom(world, innEid, {
      type: "environmental",
      content: "The inn door bursts open! A wounded messenger staggers in, clutching a royal seal. 'The prince... the real prince... is here among you. Assassins are coming!'",
      source: "wounded messenger",
    });
  }

  for (const [name, eid] of agentEids) {
    Mind.arousal[eid] = 0.9;
  }

  for (let cycle = 8; cycle <= 10; cycle++) {
    console.log(`\n--- Scene ${cycle} ---\n`);
    
    tickWorld(god, 5000);
    
    const actions = await runCognitionCycle(world, god.systemRegistry);
    executeActions(world, actions, god.systemRegistry);
    
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  console.log("\n" + "═".repeat(60));
  console.log("  EPILOGUE: KNOWLEDGE & RELATIONSHIPS");
  console.log("═".repeat(60) + "\n");

  for (const [name, eid] of agentEids) {
    console.log(`\n┌─ ${name} ─────────────────────────────────────────┐\n`);
    
    const summary = getKnowledgeSummary(world, eid);
    if (summary) {
      console.log(summary);
    } else {
      console.log("  No long-term knowledge formed yet.");
    }
    
    const knowledge = getAgentKnowledge(world, eid);
    console.log(`\n  📊 Stats: ${knowledge.memories.length} memories, ${knowledge.beliefs.length} beliefs, ${knowledge.impressions.size} impressions`);
    console.log(`\n└${"─".repeat(50)}┘`);
  }

  console.log("\n" + "═".repeat(60));
  console.log("  FINAL WORLD STATE");
  console.log("═".repeat(60));
  console.log(getWorldState(god));

  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║                    Simulation Complete                        ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");
}

main().catch(console.error);
