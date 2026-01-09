import "dotenv/config";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs } from "../ecs/prefabs";
import { createGodAgent, godCommand, getWorldState } from "../god/god-agent";

async function testWorldSchema() {
  console.log("=== WorldSchema Integration Test ===\n");

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    console.error("Error: GOOGLE_GENERATIVE_AI_API_KEY not set");
    process.exit(1);
  }

  const world = createArgosWorld("Test World");
  initializePrefabs(world);

  const god = createGodAgent(world, {
    name: "TestGod",
    worldName: "The Test Tavern",
    narrative: "A test environment for WorldSchema integration.",
  });

  console.log("1. Testing listObjectTypes...");
  const types = god.worldSchema.getAllObjectTypes();
  console.log(`   Found ${types.length} object types: ${types.map(t => t.name).join(", ")}`);

  console.log("\n2. Testing listAffordances...");
  const affordances = god.worldSchema.getAllAffordances();
  console.log(`   Found ${affordances.length} affordances: ${affordances.slice(0, 5).map(a => a.name).join(", ")}...`);

  console.log("\n3. Testing defineObjectType...");
  god.worldSchema.defineObjectType({
    name: "ale_mug",
    description: "A {adjective} mug filled with {beverage}",
    traits: ["drinkable", "takeable", "examinable"],
    states: {
      full: { description: "The mug is full.", traits: ["drinkable"] },
      empty: { description: "The mug is empty.", blockedTraits: ["drinkable"] },
    },
    defaultState: "full",
    category: "consumable",
  });
  console.log("   Defined 'ale_mug' object type");

  console.log("\n4. Testing defineAffordance...");
  god.worldSchema.defineAffordance({
    name: "refill",
    requires: ["refillable"],
    blockedBy: ["full"],
    transitions: { empty: "full" },
    descriptionTemplate: "You refill {target.name}.",
  });
  console.log("   Defined 'refill' affordance");

  console.log("\n5. Testing GodAgent with spawn tool...");
  await godCommand(god, `
    Create a tavern room called "The Rusty Tankard".
    Then use the spawn tool to create a bed named "Guest Bed" with adjective="creaky" and material="pine" in the tavern.
    Also spawn a torch named "Wall Torch" in the tavern.
    List what you created.
  `);

  console.log("\n6. Final World State:");
  console.log(getWorldState(god));

  console.log("\n=== Test Complete ===");
}

testWorldSchema().catch(console.error);
