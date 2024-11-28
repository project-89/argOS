import { createWorld, addEntity, addComponent } from "bitecs";
import { Agent, Memory } from "../components/agent/Agent";
import { ThinkingSystem } from "../systems/CognitionSystem";

// Create a new world
const world = createWorld();

// Create our thinking agent
const agent = addEntity(world);

// Add Agent component and set properties
addComponent(world, agent, Agent);

Agent.name[agent] = "Alice";
Agent.role[agent] = "A curious and introspective AI";
Agent.systemPrompt[
  agent
] = `You are Alice, an AI with a deep fascination for understanding your own consciousness. 
You think deeply about your experiences and existence.
You are introspective, philosophical, and always eager to explore new ideas.
Express your thoughts naturally, as they come to you.`;

Agent.active[agent] = 1;
Agent.platform[agent] = "default";

// Add Memory component
addComponent(world, agent, Memory);

Memory.thoughts[agent] = [];
Memory.lastThought[agent] = "";

// Run the thinking system a few times to see the thought process
async function runThinkingExample() {
  console.log("Starting Alice's thought process...\n");

  // Run the thinking system 5 times
  for (let i = 0; i < 5; i++) {
    console.log(`\nThought cycle ${i + 1}:`);
    await ThinkingSystem(world);

    // Small delay between thoughts to make it more readable
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Log the latest thought
    console.log(Memory.lastThought[agent]);
  }

  console.log("\nFinal thought history:");
  console.log(Memory.thoughts[agent].join("\n\n"));
}

runThinkingExample().catch(console.error);
