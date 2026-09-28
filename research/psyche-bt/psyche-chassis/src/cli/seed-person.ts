#!/usr/bin/env npx tsx
import "dotenv/config";
/**
 * Quick script to seed a person model with some conversation history.
 * Creates a model for testing the nightly trainer.
 */

import { createPersonModel, addMessage, setEmotionalState, setCurrentTopics, addHypothesis, addEntity, addMemory } from "../ecs/person-store.js";
import { createBootstrapTree } from "../bt/bootstrap.js";
import { countNodes } from "../bt/evaluator.js";
import { processTurn, setHandlers } from "../engine/conversation.js";
import { resolveDecisionFailure } from "../compiler/bt-compiler.js";
import { savePerson } from "../persistence/store.js";
import { setupSwarmMockHandlers } from "../swarm/swarm-runner.js";
import { registerBuiltinTools } from "../tools/builtin.js";

async function main() {
  const personId = process.argv[2] || "alice";
  console.log(`Seeding person model: ${personId}`);

  registerBuiltinTools();
  setupSwarmMockHandlers();

  const model = createPersonModel(personId);
  model.policy.tree = createBootstrapTree();
  model.policy.totalNodes = countNodes(model.policy.tree);

  // Add some background knowledge
  addHypothesis(model, {
    domain: "work",
    content: "Works in product design, manages a small team",
    confidence: 0.8,
    evidence: ["mentioned team meetings", "talked about design reviews"],
    source: "observation",
    lastUpdated: Date.now(),
  });

  addHypothesis(model, {
    domain: "creative",
    content: "Paints watercolors as a hobby, has occasional gallery shows",
    confidence: 0.7,
    evidence: ["mentioned gallery deadline", "discussed painting techniques"],
    source: "observation",
    lastUpdated: Date.now(),
  });

  addEntity(model, {
    name: "Sarah",
    type: "person",
    mentionCount: 5,
    lastMentioned: Date.now(),
    context: "Coworker on the design team",
  });

  addEntity(model, {
    name: "Gallery Show",
    type: "event",
    mentionCount: 3,
    lastMentioned: Date.now(),
    context: "Upcoming watercolor exhibition",
  });

  addMemory(model, {
    type: "fact",
    content: "Alice works in product design and manages a small team",
    importance: 0.8,
    topics: ["work"],
    connections: [],
    timestamp: Date.now(),
  });

  addMemory(model, {
    type: "event",
    content: "Gallery show deadline is coming up next month",
    importance: 0.7,
    topics: ["creative"],
    connections: [],
    timestamp: Date.now(),
  });

  // Simulate 15 turns of conversation to build history
  const conversations = [
    "Hey, I'm really stressed about the project deadline",
    "Sarah keeps missing her deliverables and it's putting pressure on me",
    "Thanks, that helps. I think I need to have a conversation with her about it.",
    "On a different note, my gallery show is coming up and I'm excited!",
    "I need to finish 3 more paintings by next month",
    "Yeah, the creative pressure plus work stress is a lot",
    "Can you help me make a plan for the gallery prep?",
    "That's great, thanks! I feel more organized now.",
    "I'm worried about the quarterly review next week",
    "Sarah actually stepped up today though, which was nice",
    "I think work is going to be fine actually",
    "The painting I'm working on right now is going really well",
    "Do you think I should submit to the juried show too?",
    "Good point. I'll focus on the current gallery first.",
    "Thanks for always being helpful with this stuff!",
  ];

  for (const msg of conversations) {
    await processTurn(msg, model);
  }
  resolveDecisionFailure();

  savePerson(model, "./data");
  console.log(`Saved: ${model.policy.totalNodes} nodes, ${model.policy.compiledBranches} compiled, ${model.totalMessages} messages`);
  console.log(`Topics: ${Array.from(new Set(model.memory.flatMap(m => m.topics))).join(", ")}`);
  console.log(`Entities: ${model.entities.map(e => e.name).join(", ")}`);
}

main().catch(console.error);
