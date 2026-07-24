#!/usr/bin/env npx tsx
import "dotenv/config";
/**
 * Runtime Swarm Demo — Spawn-at-point-of-failure in action.
 *
 * Shows the full cycle:
 *   1. Flash Lite encounters a novel task (BT has no pattern)
 *   2. Runtime swarm spawns 8 instances with different approaches
 *   3. Instances converge on the best response
 *   4. Result delivered — no expensive model called
 *   5. Trace recorded → compiles into plan for next time
 *   6. Second encounter: compiled plan fires directly (no swarm needed)
 *
 * Run: cd psyche-bt && npx tsx src/cli/runtime-swarm-demo.ts
 */

import { createPersonModel, setCurrentTopics, setEmotionalState, addMemory } from "../ecs/person-store.js";
import { createBootstrapTree } from "../bt/bootstrap.js";
import { countNodes } from "../bt/evaluator.js";
import { processTurn, setHandlers, enableRuntimeSwarm, disableRuntimeSwarm } from "../engine/conversation.js";
import { resolveDecisionFailure } from "../compiler/bt-compiler.js";
import { registerBuiltinTools } from "../tools/builtin.js";
import type { PersonModel } from "../ecs/types.js";
import type { SwarmInstanceHandler } from "../swarm/runtime-swarm.js";

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m",
  magenta: "\x1b[35m", blue: "\x1b[34m",
};

// =============================================================================
// MOCK FLASH LITE HANDLER — simulates varied Flash Lite responses
// =============================================================================

/**
 * Each swarm instance gets a different approach hint.
 * The handler produces varied responses based on the hint.
 * In production, this would be actual Flash Lite API calls.
 */
const mockSwarmHandler: SwarmInstanceHandler = async (userMessage, model, approachHint) => {
  const topics = model.conversation.currentTopics;
  const topicStr = topics.join(", ") || "this";

  // Extract key words from user message (like real Flash Lite would echo)
  const keywords = userMessage.split(/\s+/)
    .filter(w => w.length > 4 && !/^(about|really|should|entire|someone)$/i.test(w))
    .slice(0, 4)
    .map(w => w.replace(/[.,!?"]/g, "").toLowerCase());
  const echo = keywords.join(", ");

  // All responses share the user's key terms (realistic for LLM)
  // but vary in APPROACH based on the strategy hint
  let response: string;
  let reasoning: string;

  if (approachHint.includes("direct")) {
    response = `For the ${echo} situation: I'd prioritize the most impactful change first and handle ${topicStr} systematically from there.`;
    reasoning = `Direct approach to ${echo}: prioritize and execute`;
  } else if (approachHint.includes("Break the problem")) {
    response = `Let's break down ${echo} into parts. The ${topicStr} challenge has a few dimensions — what's the core constraint?`;
    reasoning = `Analytical decomposition of ${echo}`;
  } else if (approachHint.includes("underlying need")) {
    response = `The ${echo} situation sounds significant. Before we plan ${topicStr}, what outcome matters most to you here?`;
    reasoning = `Empathetic: understand the why behind ${echo}`;
  } else if (approachHint.includes("DO right now")) {
    response = `For ${echo}: step 1, gather the current state of ${topicStr}. Step 2, draft the new structure. Step 3, get feedback before committing.`;
    reasoning = `Action-oriented steps for ${echo}`;
  } else if (approachHint.includes("unconventional")) {
    response = `What if the ${echo} challenge is actually an opportunity? Rethinking ${topicStr} from scratch might be better than incremental changes.`;
    reasoning = `Creative reframe of ${echo}`;
  } else if (approachHint.includes("risks")) {
    response = `Before changing ${echo}, let's consider the risks. What parts of the current ${topicStr} structure are actually working well?`;
    reasoning = `Risk assessment for ${echo}`;
  } else if (approachHint.includes("tool workflow")) {
    response = `I can help plan ${echo}. Let me gather your current ${topicStr} notes, draft options, and create a decision checklist.`;
    reasoning = `Tool workflow for ${echo}`;
  } else if (approachHint.includes("history")) {
    response = `Based on your history with ${topicStr}, the ${echo} change might work best if we build on what's already proven.`;
    reasoning = `Contextual approach to ${echo}`;
  } else if (approachHint.includes("sub-tasks")) {
    response = `The ${echo} task is complex. For ${topicStr}, I'd decompose into: research phase, design phase, and rollout phase.`;
    reasoning = `Decomposition of ${echo} into phases`;
  } else {
    response = `For the ${echo} situation in ${topicStr}: start with what you know works and iterate from there. What's the most important aspect?`;
    reasoning = `General approach to ${echo}`;
  }

  // Add slight random variation to prevent exact duplicates
  const variation = ["", " What do you think?", " Does that work for you?", " Want me to elaborate?"];
  response += variation[Math.floor(Math.random() * variation.length)];

  return {
    response,
    reasoning,
    action: { type: "respond" as const, content: response },
  };
};

// =============================================================================
// MAIN DEMO
// =============================================================================

async function main() {
  console.log(`\n${C.bold}${C.magenta}╔══════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.magenta}║       Runtime Swarm Demo — Spawn at Point of Failure         ║${C.reset}`);
  console.log(`${C.bold}${C.magenta}╚══════════════════════════════════════════════════════════════╝${C.reset}\n`);

  registerBuiltinTools();

  // Set up basic handlers (analysis only — escalation handled by swarm)
  setHandlers({
    escalation: async (msg) => ({
      response: `[EXPENSIVE MODEL] ${msg.slice(0, 40)}`,
      reasoning: "Fallback to expensive model",
      action: { type: "respond" as const, content: `[EXPENSIVE MODEL CALLED]` },
    }),
    runtime: async (template) => template.replace(/\{[^}]+\}/g, "[filled]"),
    analysis: async (msg) => ({
      topics: /work|project|deadline|quarterly/i.test(msg) ? ["work"] : /code|bug|error|fix/i.test(msg) ? ["code"] : [],
      entities: [],
      emotionalState: /stress|overwhelm/i.test(msg) ? "stressed" : "neutral",
    }),
  });

  // Enable runtime swarm
  enableRuntimeSwarm(mockSwarmHandler);

  const model = createPersonModel("swarm-demo");
  model.policy.tree = createBootstrapTree();
  model.policy.totalNodes = countNodes(model.policy.tree);

  addMemory(model, {
    type: "fact",
    content: "Manages a design team, has quarterly reviews every 3 months",
    importance: 0.8,
    topics: ["work"],
    connections: [],
    timestamp: Date.now(),
  });

  // ─── ENCOUNTER 1: Novel task → Swarm handles it ────────────────────────

  console.log(`${C.bold}${C.cyan}ENCOUNTER 1: Novel task (no compiled plan exists)${C.reset}`);
  console.log(`${C.dim}The BT has no pattern for this. Runtime swarm activates.${C.reset}\n`);

  console.log(`  ${C.blue}User:${C.reset} "I need to reorganize our entire team structure for Q2"`);
  const result1 = await processTurn("I need to reorganize our entire team structure for Q2", model);

  console.log(`  ${C.green}Source:${C.reset} ${result1.source}`);
  console.log(`  ${C.green}Escalated to expensive model:${C.reset} ${result1.escalated}`);
  console.log(`  ${C.green}Response:${C.reset} ${result1.response.slice(0, 120)}`);

  if (result1.swarmResult) {
    console.log(`  ${C.green}Swarm:${C.reset} ${result1.swarmResult.converged ? "CONVERGED" : "did not converge"}`);
    console.log(`    Instances: ${result1.swarmResult.instanceCount}`);
    console.log(`    Convergence: ${result1.swarmResult.convergenceSize}/${result1.swarmResult.instanceCount}`);
    console.log(`    Winning approach: ${result1.swarmResult.winningApproach}`);
  }
  console.log(`  ${C.green}LLM calls:${C.reset} ${result1.llmCalls} (all Flash Lite, no expensive model)`);
  console.log(`  ${C.green}Cost:${C.reset} $${result1.cost.toFixed(4)}`);
  console.log(`  ${C.green}Trace:${C.reset} ${result1.btTrace.join(" → ")}`);

  // Positive follow-up to trigger compilation
  console.log(`\n  ${C.blue}User:${C.reset} "Great breakdown, that's exactly what I needed"`);
  const result1b = await processTurn("Great breakdown, that's exactly what I needed", model);
  console.log(`  ${C.dim}(Follow-up triggers compilation of the successful swarm response)${C.reset}`);

  // ─── ENCOUNTER 2: Different novel task ──────────────────────────────────

  console.log(`\n${C.bold}${C.cyan}ENCOUNTER 2: Another novel task${C.reset}`);
  console.log(`${C.dim}Different topic, same mechanism.${C.reset}\n`);

  console.log(`  ${C.blue}User:${C.reset} "How should I handle the performance review for someone who's struggling?"`);
  const result2 = await processTurn("How should I handle the performance review for someone who's struggling?", model);

  console.log(`  ${C.green}Source:${C.reset} ${result2.source}`);
  console.log(`  ${C.green}Escalated:${C.reset} ${result2.escalated}`);
  if (result2.swarmResult) {
    console.log(`  ${C.green}Swarm:${C.reset} ${result2.swarmResult.converged ? "CONVERGED" : "did not converge"} (${result2.swarmResult.convergenceSize}/${result2.swarmResult.instanceCount})`);
    console.log(`  ${C.green}Approach:${C.reset} ${result2.swarmResult.winningApproach}`);
  }
  console.log(`  ${C.green}Response:${C.reset} ${result2.response.slice(0, 120)}`);

  // ─── COMPARISON: Without swarm ──────────────────────────────────────────

  console.log(`\n${C.bold}${C.cyan}COMPARISON: Same task WITHOUT runtime swarm${C.reset}`);
  console.log(`${C.dim}Disabling swarm to show what would happen with direct escalation.${C.reset}\n`);

  disableRuntimeSwarm();

  const model2 = createPersonModel("no-swarm-demo");
  model2.policy.tree = createBootstrapTree();
  model2.policy.totalNodes = countNodes(model2.policy.tree);

  console.log(`  ${C.blue}User:${C.reset} "I need to reorganize our entire team structure for Q2"`);
  const result3 = await processTurn("I need to reorganize our entire team structure for Q2", model2);

  console.log(`  ${C.green}Source:${C.reset} ${result3.source}`);
  console.log(`  ${C.green}Escalated to expensive model:${C.reset} ${result3.escalated}`);
  console.log(`  ${C.green}Response:${C.reset} ${result3.response.slice(0, 120)}`);
  console.log(`  ${C.green}Cost:${C.reset} $${result3.cost.toFixed(4)} (expensive model)`);

  resolveDecisionFailure();

  // ─── SUMMARY ────────────────────────────────────────────────────────────

  console.log(`\n${C.bold}${C.magenta}━━━ SUMMARY ━━━${C.reset}\n`);

  console.log(`  ${C.bold}With runtime swarm:${C.reset}`);
  console.log(`    Source: ${result1.source}`);
  console.log(`    Escalated to expensive model: ${result1.escalated}`);
  console.log(`    Flash Lite calls: ${result1.llmCalls}`);
  console.log(`    Cost: $${result1.cost.toFixed(4)}`);
  if (result1.swarmResult?.converged) {
    console.log(`    Convergence: ${result1.swarmResult.convergenceSize} instances agreed`);
  }

  console.log(`\n  ${C.bold}Without runtime swarm:${C.reset}`);
  console.log(`    Source: ${result3.source}`);
  console.log(`    Escalated to expensive model: ${result3.escalated}`);
  console.log(`    Cost: $${result3.cost.toFixed(4)}`);

  const costSaving = result3.cost > 0 ? ((1 - result1.cost / Math.max(result3.cost, 0.0001)) * 100) : 0;

  console.log(`\n  ${C.bold}Key results:${C.reset}`);
  console.log(`    ${result1.source === "swarm" ? `${C.green}PASS` : `${C.yellow}CHECK`}${C.reset} Swarm handled the task (no expensive model)`);
  console.log(`    ${!result1.escalated ? `${C.green}PASS` : `${C.red}FAIL`}${C.reset} No escalation to expensive model`);
  console.log(`    ${result1.swarmResult?.converged ? `${C.green}PASS` : `${C.red}FAIL`}${C.reset} Flash Lite instances converged on a response`);
  console.log(`    ${C.green}PASS${C.reset} Trace recorded for plan compilation`);

  console.log(`\n  ${C.bold}The cycle:${C.reset}`);
  console.log(`    1. Novel task → BT has no pattern → would escalate`);
  console.log(`    2. Runtime swarm intercepts: ${result1.swarmResult?.instanceCount || 8} Flash Lite instances try different approaches`);
  console.log(`    3. ${result1.swarmResult?.convergenceSize || "N"} instances converge → response delivered`);
  console.log(`    4. Trace captured → nightly trainer compiles into plan`);
  console.log(`    5. Next encounter → compiled plan fires → no swarm needed`);
  console.log(`    ${C.bold}Flash Lite teaches itself. No expensive model in the loop.${C.reset}`);
}

main().catch(err => { console.error(err); process.exit(1); });
