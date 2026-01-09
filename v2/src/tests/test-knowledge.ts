import "dotenv/config";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs } from "../ecs/prefabs";
import { createGodAgent, godCommand, getWorldState } from "../god/god-agent";
import { 
  runCognitionCycle, 
  executeActions, 
  queueStimulus,
  broadcastToRoom 
} from "../cognition/cognition-system";
import { getAgentKnowledge, getKnowledgeSummary } from "../cognition/knowledge-graph";
import { query, getRelationTargets } from "bitecs";
import { Agent, Name, Mind } from "../ecs/components";
import { OccupiesRoom } from "../ecs/relations";

async function main() {
  console.log("=== ArgOS v2 - Knowledge Graph Test ===\n");

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    console.error("Error: GOOGLE_GENERATIVE_AI_API_KEY not set");
    process.exit(1);
  }

  const world = createArgosWorld("The Tavern");
  initializePrefabs(world);

  const god = createGodAgent(world, {
    name: "Demiurge",
    worldName: "The Rusty Anchor",
    narrative: `A medieval tavern where travelers share stories.`,
  });

  console.log("Creating world...\n");

  await godCommand(god, `
    Create a tavern room called "The Rusty Anchor".
    
    Create two agents:
    1. "Elena" - a traveling merchant with many tales, friendly and curious
    2. "Marcus" - a retired soldier, gruff exterior but wise, values honesty
    
    Place both in the tavern.
  `);

  console.log("\n=== WORLD CREATED ===\n");

  const agents = Array.from(query(world, [Agent]));
  let tavernEid: number | undefined;
  let elenaEid: number | undefined;
  let marcusEid: number | undefined;
  
  for (const eid of agents) {
    const name = Name.value[eid];
    if (name.includes("Elena")) elenaEid = eid;
    if (name.includes("Marcus")) marcusEid = eid;
    const rooms = getRelationTargets(world, eid, OccupiesRoom);
    if (rooms.length > 0) tavernEid = rooms[0];
  }

  console.log("=== SCENE: First Meeting ===\n");

  if (elenaEid !== undefined) {
    Mind.arousal[elenaEid] = 0.8;
    queueStimulus({
      targetEid: elenaEid,
      type: "observation",
      content: "A weathered soldier sits alone, his scarred hands wrapped around a mug. His eyes hold stories of distant battles.",
      source: "environment",
    });
  }

  if (marcusEid !== undefined) {
    Mind.arousal[marcusEid] = 0.7;
    queueStimulus({
      targetEid: marcusEid,
      type: "observation", 
      content: "A merchant woman enters with colorful wares. She has the look of someone who's traveled far and seen much.",
      source: "environment",
    });
  }

  for (let cycle = 1; cycle <= 5; cycle++) {
    console.log(`\n--- Cycle ${cycle} ---\n`);
    const actions = await runCognitionCycle(world, god.systemRegistry);
    executeActions(world, actions, god.systemRegistry);
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log("\n=== SCENE: A Revelation ===\n");

  if (tavernEid !== undefined) {
    broadcastToRoom(world, tavernEid, {
      type: "environmental",
      content: "A cloaked figure bursts through the door, shouting 'The northern pass has been overrun by bandits! The merchant caravan is trapped!'",
      source: "mysterious stranger",
    });
  }

  for (let cycle = 6; cycle <= 8; cycle++) {
    console.log(`\n--- Cycle ${cycle} ---\n`);
    const actions = await runCognitionCycle(world, god.systemRegistry);
    executeActions(world, actions, god.systemRegistry);
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log("\n" + "=".repeat(60));
  console.log("=== KNOWLEDGE GRAPH STATE ===");
  console.log("=".repeat(60) + "\n");

  for (const eid of agents) {
    const name = Name.value[eid];
    console.log(`\n[${name}]'s Knowledge:\n`);
    
    const summary = getKnowledgeSummary(world, eid);
    if (summary) {
      console.log(summary);
    } else {
      console.log("  No long-term knowledge formed yet.");
    }
    
    const knowledge = getAgentKnowledge(world, eid);
    console.log(`\n  Stats: ${knowledge.memories.length} memories, ${knowledge.beliefs.length} beliefs, ${knowledge.impressions.size} impressions`);
  }

  console.log("\n=== Test Complete ===");
}

main().catch(console.error);
