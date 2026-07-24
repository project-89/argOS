#!/usr/bin/env npx tsx
/**
 * Psyche-BT CLI — Interactive chat that demonstrates the learning loop.
 *
 * Watch the behavior tree grow as you talk. See escalation rate drop.
 * Observe patterns compile from LLM decisions into deterministic branches.
 *
 * Commands:
 *   /stats  — Show learning metrics (tree size, escalation rate, etc.)
 *   /tree   — Show the current behavior tree structure
 *   /teach  — Force a teacher cycle (Pro model refines the BT)
 *   /reset  — Start fresh with a new person model
 *   /save   — Save person model to disk
 *   /quit   — Exit
 *
 * Run: cd psyche-bt && npx tsx src/cli/chat.ts
 */

import "dotenv/config";
import * as readline from "node:readline";
import { createPersonModel } from "../ecs/person-store.js";
import { createBootstrapTree } from "../bt/bootstrap.js";
import { countNodes } from "../bt/evaluator.js";
import { getCompilerStats } from "../compiler/bt-compiler.js";
import { processTurn, setHandlers } from "../engine/conversation.js";
import { escalationHandler, runtimeHandler, analysisHandler } from "../models/handlers.js";
import { savePerson, loadPerson } from "../persistence/store.js";
import type { BehaviorNode } from "../bt/types.js";

// =============================================================================
// COLORS
// =============================================================================

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", italic: "\x1b[3m",
  cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m",
  magenta: "\x1b[35m", white: "\x1b[37m", gray: "\x1b[90m",
};

function print(text: string) { console.log(text); }

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  print(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════════════════════════╗${C.reset}`);
  print(`${C.bold}${C.cyan}║           Psyche-BT — Continuous Learning Agent              ║${C.reset}`);
  print(`${C.bold}${C.cyan}╚══════════════════════════════════════════════════════════════╝${C.reset}\n`);

  if (!apiKey) {
    print(`${C.yellow}No GOOGLE_GENERATIVE_AI_API_KEY — running in offline mode (mock responses).${C.reset}`);
    print(`${C.dim}Set the env var for real LLM-powered conversations.${C.reset}\n`);
  }

  // Set up handlers (real LLM or mock)
  if (apiKey) {
    setHandlers({
      escalation: escalationHandler,
      runtime: runtimeHandler,
      analysis: analysisHandler,
    });
  } else {
    // Mock handlers for offline testing
    setHandlers({
      escalation: async (msg) => ({
        response: `I hear you. ${msg.length > 30 ? "That sounds important." : "Tell me more."}`,
        reasoning: "Mock escalation — no API key",
        action: { type: "respond" as const, content: `I hear you. Tell me more.` },
      }),
      runtime: async (template) => template.replace(/\{[^}]+\}/g, "..."),
      analysis: async (msg) => ({
        topics: [],
        entities: [],
        emotionalState: /stress|overwhelm/i.test(msg) ? "stressed" : "neutral",
      }),
    });
  }

  // Load or create person model
  const personId = process.env.PERSON_ID || "default";
  let model = loadPerson(personId, "./data");
  if (model) {
    print(`${C.green}Loaded existing model for "${personId}" (${model.totalMessages} messages, ${model.policy.compiledBranches} compiled branches).${C.reset}`);
    model.conversation.sessionStart = Date.now();
    model.conversation.turnsThisSession = 0;
    model.totalConversations++;
  } else {
    model = createPersonModel(personId);
    model.policy.tree = createBootstrapTree();
    model.policy.totalNodes = countNodes(model.policy.tree);
    print(`${C.green}Created new model for "${personId}".${C.reset}`);
  }

  printStats(model);
  print(`\n${C.dim}Type a message, or /help for commands.${C.reset}`);

  // REPL
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `\n${C.green}you> ${C.reset}`,
  });

  rl.prompt();

  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) { rl.prompt(); return; }

    // Commands
    if (trimmed.startsWith("/")) {
      handleCommand(trimmed, model!);
      rl.prompt();
      return;
    }

    // Process turn
    print(`${C.dim}...${C.reset}`);
    try {
      const result = await processTurn(trimmed, model!);

      // Show response with source indicator
      const sourceTag = result.escalated
        ? `${C.yellow}[escalated → Flash]${C.reset}`
        : result.source === "template"
          ? `${C.green}[BT → template]${C.reset}`
          : `${C.green}[BT]${C.reset}`;

      print(`\n${C.cyan}agent>${C.reset} ${result.response}`);
      print(`${C.dim}       ${sourceTag} tree: ${model!.policy.totalNodes} nodes, ${model!.policy.compiledBranches} compiled${result.compiledBranch ? ` ${C.yellow}(+1 pending)${C.reset}` : ""}${C.reset}`);
    } catch (err) {
      print(`${C.red}Error: ${(err as Error).message}${C.reset}`);
    }

    rl.prompt();
  });

  rl.on("close", () => {
    savePerson(model!, "./data");
    print(`\n${C.dim}Model saved. Goodbye.${C.reset}`);
    process.exit(0);
  });
}

// =============================================================================
// COMMANDS
// =============================================================================

function handleCommand(cmd: string, model: any): void {
  const c = cmd.slice(1).toLowerCase().trim();

  if (c === "stats") {
    printStats(model);
  } else if (c === "tree") {
    printTree(model.policy.tree, 0);
  } else if (c === "save") {
    savePerson(model, "./data");
    print(`${C.green}Model saved.${C.reset}`);
  } else if (c === "reset") {
    const newModel = createPersonModel(model.personId);
    newModel.policy.tree = createBootstrapTree();
    newModel.policy.totalNodes = countNodes(newModel.policy.tree);
    Object.assign(model, newModel);
    print(`${C.yellow}Model reset to default.${C.reset}`);
  } else if (c === "help" || c === "?") {
    print(`\n${C.bold}Commands:${C.reset}`);
    print(`  ${C.bold}/stats${C.reset}  — Learning metrics`);
    print(`  ${C.bold}/tree${C.reset}   — Behavior tree structure`);
    print(`  ${C.bold}/save${C.reset}   — Save to disk`);
    print(`  ${C.bold}/reset${C.reset}  — Start fresh`);
    print(`  ${C.bold}/quit${C.reset}   — Exit (auto-saves)`);
  } else if (c === "quit" || c === "q") {
    savePerson(model, "./data");
    print(`${C.dim}Saved. Goodbye.${C.reset}`);
    process.exit(0);
  } else {
    print(`${C.red}Unknown command. Type /help.${C.reset}`);
  }
}

// =============================================================================
// DISPLAY
// =============================================================================

function printStats(model: any): void {
  const stats = getCompilerStats(model);
  const bar = (val: number, max: number) => {
    const filled = Math.round((val / max) * 20);
    return `${C.green}${"█".repeat(filled)}${C.dim}${"░".repeat(20 - filled)}${C.reset}`;
  };

  print(`\n${C.bold}Learning Stats:${C.reset}`);
  print(`  Tree size:        ${bar(stats.totalNodes, 200)} ${stats.totalNodes} nodes`);
  print(`  Compiled branches: ${stats.compiledBranches}`);
  print(`  BT version:       v${stats.version}`);
  print(`  Escalation rate:  ${bar(1 - stats.escalationRate, 1)} ${((1 - stats.escalationRate) * 100).toFixed(0)}% handled by BT`);
  print(`  Total messages:   ${model.totalMessages}`);
  print(`  Hypotheses:       ${model.hypotheses.length}`);
  print(`  Memories:         ${model.memory.length}`);
  print(`  Skills:           ${model.skills.length}`);
}

function printTree(node: BehaviorNode, depth: number): void {
  const indent = "  ".repeat(depth);
  const prefix = depth === 0 ? "" : "├─ ";

  switch (node.type) {
    case "selector":
      print(`${indent}${prefix}${C.cyan}selector${C.reset} (${node.children.length} children)`);
      for (const child of node.children) printTree(child, depth + 1);
      break;
    case "sequence":
      print(`${indent}${prefix}${C.magenta}sequence${C.reset}`);
      for (const child of node.children) printTree(child, depth + 1);
      break;
    case "condition":
      print(`${indent}${prefix}${C.dim}if ${node.op.type}${C.reset}`);
      break;
    case "action":
      print(`${indent}${prefix}${C.green}→ ${node.action.type}${node.action.content ? `: "${node.action.content.slice(0, 40)}..."` : ""}${C.reset}`);
      break;
    case "template_response":
      print(`${indent}${prefix}${C.yellow}→ template: "${node.template.slice(0, 40)}..."${C.reset}`);
      break;
    case "skill":
      print(`${indent}${prefix}${C.bold}skill: ${node.name}${C.reset}`);
      break;
    case "weighted_random":
      print(`${indent}${prefix}${C.cyan}random${C.reset} (${node.choices.length} choices)`);
      for (const c of node.choices) printTree(c.child, depth + 1);
      break;
    case "llm_escalate":
      print(`${indent}${prefix}${C.red}↗ escalate to LLM${C.reset}`);
      break;
    default:
      print(`${indent}${prefix}${(node as any).type}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
