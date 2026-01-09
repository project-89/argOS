/**
 * Test GodAI World Building
 *
 * This test has GodAI autonomously create a world using the new world tools.
 * The AI will:
 * 1. Define custom object types
 * 2. Create a room/location
 * 3. Spawn objects in the room
 * 4. Set up state transitions
 * 5. Generate a description of the world
 */

import "dotenv/config";
import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { createWorld as createBitECSWorld } from "bitecs";
import {
  worldSchema,
  ObjectManager,
  TextRenderer,
  RulesEngine,
  createWorldTools,
  initializeWorldToolsState,
} from "./world";
import { createEntityRegistry, type EntityRegistry } from "../ecs/tools";

// Use Gemini 3 Flash for tool use (same as the main GodAI)
const model = google("gemini-3-flash-preview");

async function testGodAIWorldBuilding() {
  console.log("╔════════════════════════════════════════╗");
  console.log("║   GODAI WORLD BUILDING TEST            ║");
  console.log("╚════════════════════════════════════════╝\n");

  // Create the world infrastructure
  const world = createBitECSWorld();
  const registry = createEntityRegistry();

  // Initialize world tools state
  const worldToolsState = initializeWorldToolsState(world, registry);

  // Create the world tools for GodAI
  const worldTools = createWorldTools(worldToolsState);

  console.log("World tools initialized. Asking GodAI to build a world...\n");

  // Give GodAI a prompt to build a world
  const systemPrompt = `You are a world-building AI for a MUD-style simulation game. You have tools to:
- Define new object types (prefabs) with states and traits
- Spawn objects from prefabs
- Create custom objects
- Transition object states
- Describe rooms

Your task is to create an interesting medieval tavern scene. You should:
1. First create a "room" as a container for the scene
2. Define any custom object types you need (e.g., fireplace, ale_mug, etc.)
3. Spawn several objects to populate the tavern
4. Make the scene feel alive by setting appropriate states

Be creative! Make it atmospheric and interesting. Use the tools to build out the scene step by step.

IMPORTANT: You must call multiple tools in sequence. After each tool call, continue to the next step until you have completed all steps. Do not stop until you have used describeRoom to show the final scene.`;

  const userPrompt = `Create a cozy medieval tavern called "The Rusty Tankard" with atmosphere and character.

You MUST complete ALL of these steps using the tools:
1. First use spawnCustomObject to create the room "The Rusty Tankard" with traits ["container", "location"]
2. Use defineObjectType to create a "fireplace" type with states: unlit, burning, embers
3. Spawn at least 5 objects in the room using spawnObject (tables, chairs, torches, etc)
4. Spawn your custom fireplace using spawnObject
5. Finally use describeRoom to show me the complete scene

Start now and use the tools to build the complete tavern.`;

  try {
    const result = await generateText({
      model,
      system: systemPrompt,
      prompt: userPrompt,
      tools: worldTools,
      maxSteps: 30,
      onStepFinish: ({ text, toolCalls, toolResults }) => {
        if (toolCalls && toolCalls.length > 0) {
          toolCalls.forEach((call) => {
            console.log(`🔧 Tool: ${call.toolName}`);
          });
        }
        if (text) {
          console.log(`💬 ${text.substring(0, 100)}...`);
        }
      },
    });

    console.log("\n" + "=".repeat(60));
    console.log("GODAI RESPONSE:");
    console.log("=".repeat(60));
    console.log(result.text);

    // Print final statistics
    console.log("\n" + "=".repeat(60));
    console.log("WORLD STATISTICS:");
    console.log("=".repeat(60));
    console.log(`Object types defined: ${worldSchema.getAllObjectTypes().length}`);
    console.log(`Traits in use: ${worldSchema.getAllTraits().length}`);
    console.log(`Affordances available: ${worldSchema.getAllAffordances().length}`);
    console.log(`Entities in registry: ${registry.byName.size}`);

    // List all entities
    console.log("\nEntities created:");
    registry.byName.forEach((eid, name) => {
      const info = worldToolsState.objectManager.getInfo(eid);
      if (info) {
        console.log(`  - ${name} (${info.typeId}): ${info.state}`);
      }
    });

    console.log("\n✓ GodAI world building test completed!");
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    throw error;
  }
}

// Run the test
testGodAIWorldBuilding().catch(console.error);
