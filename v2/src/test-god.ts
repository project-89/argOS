import "dotenv/config";
import { createArgosWorld } from "./ecs/world";
import { initializePrefabs } from "./ecs/prefabs";
import { createGodAgent, godCommand, getWorldState, tickWorld } from "./god/god-agent";

async function main() {
  console.log("=== ArgOS v2 - GodAgent + System Baking Test ===\n");

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    console.error("Error: GOOGLE_GENERATIVE_AI_API_KEY not set");
    process.exit(1);
  }

  const world = createArgosWorld("The Tavern");
  initializePrefabs(world);

  const god = createGodAgent(world, {
    name: "Demiurge",
    worldName: "The Rusty Anchor Tavern",
    narrative: `This is a medieval fantasy tavern on a stormy night. 
The tavern is a refuge for travelers, a meeting place for adventurers, and home to many stories.
Create a living, breathing world with interesting characters who have their own motivations and secrets.
The world should feel ALIVE - with dynamic systems that evolve the environment and characters over time.`,
  });

  console.log("GodAgent created. Initializing world...\n");

  await godCommand(god, `
    Create the initial world setup:
    1. Create the main tavern room - warm and inviting despite the storm outside
    2. Create a mysterious hooded stranger who sits in the corner, watching everyone
    3. Create a friendly barkeeper who knows everyone's secrets
    4. Add atmosphere - a crackling fireplace that periodically emits sounds
    
    Place all characters in the tavern.
  `);

  console.log("\n=== INITIAL WORLD STATE ===");
  console.log(getWorldState(god));

  console.log("\n=== BAKING DYNAMIC SYSTEMS ===\n");

  await godCommand(god, `
    The world feels static. Create systems to make it come alive:
    
    1. Create a system that makes the storm intensity vary over time - sometimes it gets worse, 
       sometimes it calms down. This should affect the ambience and perhaps make characters react.
    
    2. Activate all the systems including the new ones.
    
    3. List all systems to confirm they're ready.
  `);

  console.log("\n=== WORLD STATE WITH SYSTEMS ===");
  console.log(getWorldState(god));

  console.log("\n=== RUNNING WORLD TICKS ===\n");
  for (let i = 0; i < 3; i++) {
    console.log(`\n--- Tick ${i + 1} ---`);
    const events = tickWorld(god, 2000);
    if (events.length > 0) {
      console.log("Events emitted:");
      for (const event of events) {
        console.log(`  [${event.type}] ${JSON.stringify(event.data)}`);
      }
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log("\n=== FINAL WORLD STATE ===");
  console.log(getWorldState(god));

  console.log("\n=== Test Complete ===");
}

main().catch(console.error);
