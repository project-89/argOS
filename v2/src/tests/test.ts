import "dotenv/config";
import { createArgosWorld, createAgent } from "../core/ecs";
import { createStimulus, deliverStimulus } from "../systems/stimulus";
import { startCognitiveLoops, stopCognitiveLoops } from "../systems/loop";
import { addNode } from "../systems/knowledge";

async function main() {
  console.log("=== ArgOS v2 Test ===\n");

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    console.error("Error: GOOGLE_GENERATIVE_AI_API_KEY not set");
    process.exit(1);
  }

  const world = createArgosWorld();

  const alice = createAgent(world, {
    name: "Alice",
    role: "A curious philosopher who loves to explore ideas and question assumptions",
    systemPrompt: `You are Alice, a thoughtful philosopher. You approach the world with curiosity and a desire to understand. You ask questions, make connections between ideas, and aren't afraid to admit what you don't know. You value genuine dialogue and seek truth through conversation.`,
  });

  const bob = createAgent(world, {
    name: "Bob",
    role: "A pragmatic engineer who values practical solutions and clear thinking",
    systemPrompt: `You are Bob, a practical engineer. You focus on what works and how things can be improved. You appreciate clarity and concrete examples. While you respect abstract thinking, you like to ground discussions in real-world applications.`,
  });

  console.log(`Created agents: Alice (${alice}), Bob (${bob})`);

  addNode(world, alice, {
    type: "belief",
    content: { subject: "I", predicate: "value", object: "deep understanding" },
    source: "core value",
  });

  addNode(world, alice, {
    type: "goal",
    content: { description: "Engage in meaningful dialogue", priority: 0.8, status: "active" },
    source: "ongoing goal",
  });

  addNode(world, bob, {
    type: "belief",
    content: { subject: "I", predicate: "value", object: "practical solutions" },
    source: "core value",
  });

  addNode(world, bob, {
    type: "goal",
    content: { description: "Solve real problems", priority: 0.9, status: "active" },
    source: "ongoing goal",
  });

  console.log("Seeded initial knowledge...\n");

  const envStimulus = createStimulus({
    type: "environmental",
    source: "system",
    content: "You find yourself in a quiet room with another person. The atmosphere is calm and conducive to conversation.",
    salience: 0.6,
    urgency: 0.3,
    novelty: 0.7,
  });

  deliverStimulus(world, alice, { ...envStimulus });
  deliverStimulus(world, bob, { ...envStimulus });

  const greetingStimulus = createStimulus({
    type: "social",
    source: "system",
    content: "There's an opportunity to introduce yourself and start a conversation.",
    salience: 0.7,
    urgency: 0.4,
    novelty: 0.6,
  });

  deliverStimulus(world, alice, { ...greetingStimulus });

  console.log("Delivered initial stimuli...\n");
  console.log("Starting cognitive loops...\n");
  console.log("(Press Ctrl+C to stop)\n");

  startCognitiveLoops(world);

  process.on("SIGINT", () => {
    console.log("\n\nStopping simulation...");
    stopCognitiveLoops();
    process.exit(0);
  });

  await new Promise(() => {});
}

main().catch(console.error);
