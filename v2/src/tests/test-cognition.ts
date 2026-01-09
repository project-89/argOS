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
import { query, getRelationTargets } from "bitecs";
import { Agent, Name } from "../ecs/components";
import { OccupiesRoom } from "../ecs/relations";

async function main() {
  console.log("=== ArgOS v2 - Agent Cognition Test ===\n");

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    console.error("Error: GOOGLE_GENERATIVE_AI_API_KEY not set");
    process.exit(1);
  }

  const world = createArgosWorld("The Tavern");
  initializePrefabs(world);

  const god = createGodAgent(world, {
    name: "Demiurge",
    worldName: "The Rusty Anchor Tavern",
    narrative: `A medieval fantasy tavern on a stormy night. Create interesting characters with distinct personalities.`,
  });

  console.log("Creating world...\n");

  await godCommand(god, `
    Create a cozy tavern room called "The Rusty Anchor Tavern".
    
    Create two agents:
    1. A mysterious hooded stranger named "Shadowmere" - they are secretive, speak cryptically, and are searching for something or someone
    2. A friendly barkeeper named "Old Tom" - jovial, loves gossip, always polishing a mug
    
    Place both in the tavern.
  `);

  console.log("\n=== WORLD CREATED ===");
  console.log(getWorldState(god));

  console.log("\n=== STARTING COGNITION LOOP ===\n");

  const agents = Array.from(query(world, [Agent]));
  let tavernEid: number | undefined;
  
  for (const eid of agents) {
    const rooms = getRelationTargets(world, eid, OccupiesRoom);
    if (rooms.length > 0) {
      tavernEid = rooms[0];
      break;
    }
  }

  if (tavernEid !== undefined) {
    broadcastToRoom(world, tavernEid, {
      type: "environmental",
      content: "The door creaks open as a gust of wind blows rain into the tavern. Lightning flashes outside.",
      source: "environment",
    });
  }

  for (let cycle = 1; cycle <= 3; cycle++) {
    console.log(`\n--- Cognition Cycle ${cycle} ---\n`);

    tickWorld(god, 2000);

    const actions = await runCognitionCycle(world, god.systemRegistry);
    
    executeActions(world, actions, god.systemRegistry);

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log("\n=== Injecting a conversation starter ===\n");

  for (const eid of agents) {
    if (Name.value[eid] === "Old Tom") {
      queueStimulus({
        targetEid: eid,
        type: "observation",
        content: "Shadowmere's hood shifts slightly, revealing a glint of something metallic beneath - perhaps a pendant or a weapon.",
        source: "environment",
      });
    }
    if (Name.value[eid] === "Shadowmere") {
      queueStimulus({
        targetEid: eid,
        type: "observation",
        content: "Old Tom keeps glancing your way while polishing that same mug for the third time. He seems curious.",
        source: "environment",
      });
    }
  }

  for (let cycle = 4; cycle <= 6; cycle++) {
    console.log(`\n--- Cognition Cycle ${cycle} ---\n`);

    const actions = await runCognitionCycle(world, god.systemRegistry);
    executeActions(world, actions, god.systemRegistry);

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log("\n=== FINAL STATE ===");
  console.log(getWorldState(god));
  console.log("\n=== Test Complete ===");
}

main().catch(console.error);
