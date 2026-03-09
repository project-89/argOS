import "dotenv/config";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs } from "../ecs/prefabs";
import { createGodAgent, godCommand } from "../god/god-agent";
import { getDynamicComponentValues } from "../ecs/dynamic-components";
import { ObjectState, ObjectType, Traits } from "../ecs/components";

async function testWorldSchemaTraits() {
  console.log("=== WorldSchema Traits Test ===\n");

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    console.error("Error: GOOGLE_GENERATIVE_AI_API_KEY not set");
    process.exit(1);
  }

  const world = createArgosWorld("Test World");
  initializePrefabs(world);

  const god = createGodAgent(world, {
    name: "TestGod",
    worldName: "Test",
    narrative: "Testing WorldSchema trait system.",
  });

  console.log("1. Creating room and spawning objects via GodAgent...\n");
  await godCommand(god, `
    Create a room called "Storage Room".
    Use spawn to create:
    - A chest named "Old Chest" (type: chest) in the storage room
    - A torch named "Dim Torch" (type: torch, state: unlit) in the storage room
    After spawning, use getObjectTraits on "Old Chest" and "Dim Torch" to show their traits.
    Then use getAvailableActions on "Old Chest" to see what actions are available.
  `);

  console.log("\n2. Verifying canonical ECS state/traits were stored...");

  // Check if ObjectMeta component was created
  const chestEid = god.registry.byName.get("Old Chest");
  const torchEid = god.registry.byName.get("Dim Torch");

  if (chestEid !== undefined) {
    const traits = Traits.active[chestEid];
    console.log(
      `   Old Chest: type=${ObjectType.typeId[chestEid]}, state=${ObjectState.current[chestEid]}, traits=${traits}`
    );

    const chestMeta = getDynamicComponentValues("ObjectMeta", chestEid);
    if (chestMeta) {
      console.log(`   (legacy mirror) ObjectMeta: type=${chestMeta.type}, state=${chestMeta.state}, traits=${chestMeta.traits}`);
    }
  } else {
    console.log("   Old Chest not found in registry");
  }

  if (torchEid !== undefined) {
    const traits = Traits.active[torchEid];
    console.log(
      `   Dim Torch: type=${ObjectType.typeId[torchEid]}, state=${ObjectState.current[torchEid]}, traits=${traits}`
    );

    const torchMeta = getDynamicComponentValues("ObjectMeta", torchEid);
    if (torchMeta) {
      console.log(`   (legacy mirror) ObjectMeta: type=${torchMeta.type}, state=${torchMeta.state}, traits=${torchMeta.traits}`);
    }
  } else {
    console.log("   Dim Torch not found in registry");
  }

  console.log("\n3. Testing state transition...\n");
  await godCommand(god, `
    Use transitionObjectState to change "Old Chest" from closed to open.
    Then use getObjectTraits on "Old Chest" to verify the traits changed.
  `);

  // Verify state change
  if (chestEid !== undefined) {
    console.log(
      `   Old Chest after transition: state=${ObjectState.current[chestEid]}, traits=${Traits.active[chestEid]}`
    );
    const chestMeta = getDynamicComponentValues("ObjectMeta", chestEid);
    if (chestMeta) console.log(`   (legacy mirror) ObjectMeta: state=${chestMeta.state}, traits=${chestMeta.traits}`);
  }

  console.log("\n=== Test Complete ===");
}

testWorldSchemaTraits().catch(console.error);
