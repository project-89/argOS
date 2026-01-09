/**
 * Test NPC World Interaction
 *
 * This test demonstrates NPCs:
 * 1. Perceiving the world through TextRenderer
 * 2. Making decisions based on their environment
 * 3. Performing actions on objects
 * 4. Having the world respond to their actions
 */

import "dotenv/config";
import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod/v3";
import { tool } from "ai";
import { createWorld as createBitECSWorld } from "bitecs";
import {
  worldSchema,
  ObjectManager,
  TextRenderer,
  RulesEngine,
} from "./world";
import { Name, Description, Traits } from "../ecs/components";

// Use Gemini 3 Flash for NPC decisions
const model = google("gemini-3-flash-preview");

// Create the world infrastructure
function createNPCWorld() {
  const world = createBitECSWorld();
  const objectManager = new ObjectManager(world);
  const textRenderer = new TextRenderer(world, objectManager);
  const rulesEngine = new RulesEngine(world, objectManager);

  return { world, objectManager, textRenderer, rulesEngine };
}

// Create tools for NPC actions
function createNPCTools(
  npcEid: number,
  roomEid: number,
  objectManager: ObjectManager,
  textRenderer: TextRenderer,
  rulesEngine: RulesEngine,
  tick: { value: number }
) {
  // Track which objects exist for tool schemas
  const objects: Map<number, string> = new Map();
  const contents = objectManager.getContents(roomEid);
  contents.forEach(eid => {
    const info = objectManager.getInfo(eid);
    if (info) {
      objects.set(eid, info.name);
    }
  });

  return {
    look: tool({
      description: "Look around and perceive your surroundings",
      inputSchema: z.object({}),
      execute: async () => {
        const perception = textRenderer.renderPerception(npcEid, roomEid, {
          detailed: true,
          includeAffordances: false,
        });
        return { perception };
      },
    }),

    examine: tool({
      description: "Examine a specific object more closely",
      inputSchema: z.object({
        objectName: z.string().describe("Name of the object to examine"),
      }),
      execute: async ({ objectName }) => {
        // Find the object
        let targetEid: number | undefined;
        for (const [eid, name] of objects) {
          if (name.toLowerCase().includes(objectName.toLowerCase())) {
            targetEid = eid;
            break;
          }
        }

        if (!targetEid) {
          return { success: false, message: `You don't see any ${objectName} here.` };
        }

        const result = rulesEngine.processAction("examine", npcEid, targetEid, tick.value++);
        const info = objectManager.getInfo(targetEid);
        const affordances = objectManager.getAvailableAffordances(targetEid);

        return {
          success: true,
          name: info?.name,
          description: info?.description,
          state: info?.state,
          availableActions: affordances,
        };
      },
    }),

    performAction: tool({
      description: "Perform an action on an object (open, close, sit, take, etc.)",
      inputSchema: z.object({
        action: z.string().describe("The action to perform"),
        objectName: z.string().describe("The target object"),
      }),
      execute: async ({ action, objectName }) => {
        // Find the object
        let targetEid: number | undefined;
        for (const [eid, name] of objects) {
          if (name.toLowerCase().includes(objectName.toLowerCase())) {
            targetEid = eid;
            break;
          }
        }

        if (!targetEid) {
          return { success: false, message: `You don't see any ${objectName} here.` };
        }

        const result = rulesEngine.processAction(action, npcEid, targetEid, tick.value++);
        return result;
      },
    }),

    speak: tool({
      description: "Say something out loud",
      inputSchema: z.object({
        message: z.string().describe("What to say"),
      }),
      execute: async ({ message }) => {
        const npcInfo = objectManager.getInfo(npcEid);
        console.log(`\n💬 ${npcInfo?.name}: "${message}"`);
        return { success: true, spoken: message };
      },
    }),

    think: tool({
      description: "Think about something internally",
      inputSchema: z.object({
        thought: z.string().describe("Your internal thought"),
      }),
      execute: async ({ thought }) => {
        const npcInfo = objectManager.getInfo(npcEid);
        console.log(`\n🧠 ${npcInfo?.name} thinks: "${thought}"`);
        return { thought };
      },
    }),
  };
}

async function runNPCWorldInteraction() {
  console.log("╔════════════════════════════════════════╗");
  console.log("║   NPC WORLD INTERACTION TEST           ║");
  console.log("╚════════════════════════════════════════╝\n");

  const { world, objectManager, textRenderer, rulesEngine } = createNPCWorld();

  // Build the tavern scene
  console.log("Setting up the tavern scene...\n");

  const roomEid = objectManager.spawnCustom({
    name: "The Rusty Tankard",
    description: "A warm and cozy tavern with a low ceiling and smoky air. The smell of ale and roasting meat fills the room.",
    traits: ["container", "location"],
  });

  // Add furniture
  const tableEid = objectManager.spawn("table", {
    name: "oak table",
    containedIn: roomEid,
    properties: { adjective: "worn", material: "oak" },
  });

  const chairEid = objectManager.spawn("chair", {
    name: "wooden chair",
    containedIn: roomEid,
    properties: { adjective: "sturdy", material: "wooden" },
  });

  // Add a chest
  const chestEid = objectManager.spawn("chest", {
    name: "old chest",
    containedIn: roomEid,
    properties: { adjective: "old", material: "iron-bound" },
  });

  // Add lighting
  const torchEid = objectManager.spawn("torch", {
    containedIn: roomEid,
  });

  // Create the NPC
  const npcEid = objectManager.spawn("npc", {
    name: "Gareth the Wanderer",
    containedIn: roomEid,
    properties: { adjective: "weary", role: "traveler" },
  });

  console.log("Scene created. Starting NPC simulation...\n");
  console.log("=".repeat(60));

  // Show initial scene
  const initialScene = textRenderer.renderRoom(roomEid, { detailed: true });
  console.log(initialScene.fullText);
  console.log("=".repeat(60) + "\n");

  // Create tick counter
  const tick = { value: 1 };

  // Create NPC tools
  const npcTools = createNPCTools(
    npcEid!,
    roomEid,
    objectManager,
    textRenderer,
    rulesEngine,
    tick
  );

  // NPC system prompt
  const systemPrompt = `You are ${Name.value[npcEid!]}, a weary traveler who has just entered a tavern.

You can:
- look: Survey your surroundings
- examine <object>: Look at something more closely to see what actions are available
- performAction: Do something with an object (like 'open', 'sit', 'close', etc.)
- speak: Say something out loud
- think: Have an internal thought

Behave naturally as your character would. Explore the tavern, interact with objects, and roleplay the experience.
Always examine objects first to learn what actions you can take with them.`;

  const userPrompt = `You've just entered The Rusty Tankard tavern after a long journey.
You're tired and looking for a place to rest. Explore the tavern and interact with what you find.

You MUST:
1. First use "look" to see what's around you
2. Use "examine" on the chair to see what you can do with it
3. Use "performAction" to sit on the chair
4. Use "examine" on the chest to see what you can do
5. Use "performAction" to open the chest
6. Use "speak" to comment on what you found

Complete all these steps using the tools.`;

  try {
    console.log("Starting NPC AI...\n");
    const result = await generateText({
      model,
      system: systemPrompt,
      prompt: userPrompt,
      tools: npcTools,
      maxSteps: 20,
      maxTokens: 4096,
      onStepFinish: ({ text, toolCalls, toolResults, finishReason }) => {
        console.log(`[Step finished - reason: ${finishReason}]`);
        if (toolCalls && toolCalls.length > 0) {
          toolCalls.forEach((call) => {
            console.log(`\n🔧 Action: ${call.toolName}`);
            if (call.args && Object.keys(call.args).length > 0) {
              console.log(`   Args: ${JSON.stringify(call.args)}`);
            }
          });
        }
        if (toolResults && toolResults.length > 0) {
          toolResults.forEach((result) => {
            if (typeof result.result === 'object' && result.result !== null) {
              const r = result.result as Record<string, unknown>;
              if (r.perception) {
                console.log(`\n📖 Perception:\n${r.perception}`);
              } else if (r.message) {
                console.log(`   Result: ${r.message}`);
              } else if (r.description) {
                console.log(`   ${r.name}: ${r.description}`);
                if (r.availableActions) {
                  console.log(`   Available actions: ${(r.availableActions as string[]).join(", ")}`);
                }
              }
            }
          });
        }
      },
    });

    console.log("\n" + "=".repeat(60));
    console.log("NPC SESSION COMPLETE");
    console.log("=".repeat(60));

    if (result.text) {
      console.log("\nFinal thoughts:", result.text);
    }

    // Show final state of objects
    console.log("\n" + "=".repeat(60));
    console.log("FINAL WORLD STATE:");
    console.log("=".repeat(60));

    const finalScene = textRenderer.renderRoom(roomEid, { detailed: true });
    console.log(finalScene.fullText);

    console.log("\n✓ NPC world interaction test completed!");
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    throw error;
  }
}

// Run the test
runNPCWorldInteraction().catch(console.error);
