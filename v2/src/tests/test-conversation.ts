import "dotenv/config";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs } from "../ecs/prefabs";
import { createGodAgent, godCommand, getWorldState, tickWorld } from "../god/god-agent";
import { 
  runCognitionCycle, 
  executeActions, 
  queueStimulus,
  broadcastToRoom 
} from "../cognition/cognition-system";
import { getAgentMemory } from "../cognition/agent-mind";
import { query, getRelationTargets } from "bitecs";
import { Agent, Name, Mind } from "../ecs/components";
import { OccupiesRoom } from "../ecs/relations";

async function main() {
  console.log("=== ArgOS v2 - Agent Conversation Test ===\n");

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    console.error("Error: GOOGLE_GENERATIVE_AI_API_KEY not set");
    process.exit(1);
  }

  const world = createArgosWorld("The Tavern");
  initializePrefabs(world);

  const god = createGodAgent(world, {
    name: "Demiurge",
    worldName: "The Rusty Anchor Tavern",
    narrative: `A medieval fantasy tavern. Characters should be talkative and engage in conversation.`,
  });

  console.log("Creating world...\n");

  await godCommand(god, `
    Create a tavern room called "The Rusty Anchor".
    
    Create two agents:
    1. "Mira the Bard" - a cheerful traveling musician who loves stories and always tries to strike up conversation
    2. "Grim" - a gruff but good-hearted mercenary who pretends to be tough but secretly enjoys company
    
    Place both in the tavern.
  `);

  console.log("\n=== WORLD CREATED ===");
  console.log(getWorldState(god));

  const agents = Array.from(query(world, [Agent]));
  let tavernEid: number | undefined;
  let miraEid: number | undefined;
  let grimEid: number | undefined;
  
  for (const eid of agents) {
    const name = Name.value[eid];
    if (name.includes("Mira")) miraEid = eid;
    if (name.includes("Grim")) grimEid = eid;
    const rooms = getRelationTargets(world, eid, OccupiesRoom);
    if (rooms.length > 0) tavernEid = rooms[0];
  }

  console.log("\n=== SCENE: Mira notices Grim sitting alone ===\n");

  if (miraEid !== undefined) {
    Mind.arousal[miraEid] = 0.8;
    queueStimulus({
      targetEid: miraEid,
      type: "observation",
      content: "A gruff-looking mercenary sits alone at a corner table, nursing an ale. He looks like he has interesting stories. You feel the urge to introduce yourself.",
      source: "environment",
    });
  }

  if (grimEid !== undefined) {
    Mind.arousal[grimEid] = 0.6;
    queueStimulus({
      targetEid: grimEid,
      type: "observation", 
      content: "A bard with a lute is looking your way with a friendly smile. She seems about to come over.",
      source: "environment",
    });
  }

  for (let cycle = 1; cycle <= 8; cycle++) {
    console.log(`\n--- Cycle ${cycle} ---\n`);

    const actions = await runCognitionCycle(world, god.systemRegistry);
    executeActions(world, actions, god.systemRegistry);

    await new Promise(resolve => setTimeout(resolve, 300));
  }

  console.log("\n=== AGENT MEMORIES ===\n");
  
  for (const eid of agents) {
    const name = Name.value[eid];
    const memory = getAgentMemory(world, eid);
    console.log(`\n[${name}]`);
    console.log("Recent thoughts:", memory.thoughts.slice(-3).map(t => t.content.slice(0, 60) + "..."));
    console.log("Recent actions:", memory.recentActions.slice(-3).map(a => `${a.type}: ${a.content?.slice(0, 40) || a.target || ""}`));
  }

  console.log("\n=== Test Complete ===");
}

main().catch(console.error);
