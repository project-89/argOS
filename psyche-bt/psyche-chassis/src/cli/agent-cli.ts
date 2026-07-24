#!/usr/bin/env node
/**
 * Agent CLI — Interactive REPL and benchmark runner for the Swarm-BT agent.
 *
 * Usage:
 *   npx tsx src/cli/agent-cli.ts                          # Interactive mode
 *   npx tsx src/cli/agent-cli.ts --benchmark              # Full benchmark
 *   npx tsx src/cli/agent-cli.ts --benchmark --category reasoning
 *   npx tsx src/cli/agent-cli.ts --benchmark --agents swarm,flash
 *   npx tsx src/cli/agent-cli.ts --task "solve 2+2"       # Single task
 */

import { runAgent, runFlashBaseline } from "../agent/swarm-agent.js";
import {
  runSwarmBTBenchmark,
  runFlashBaselineBenchmark,
  runSwarmOnlyBenchmark,
  formatComparisonTable,
} from "../agent/benchmark-runner.js";
import { ALL_BENCHMARK_TASKS, getTasksByCategory } from "../agent/benchmark-tasks.js";
import type { BenchmarkTask } from "../agent/benchmark-tasks.js";
import { registerAgentTools } from "../agent/agent-tools.js";
import { registerStandardBTNodes } from "../bt/standard-nodes.js";
import { createInterface } from "readline";

// =============================================================================
// ARGUMENT PARSING
// =============================================================================

const args = process.argv.slice(2);
const isBenchmark = args.includes("--benchmark") || args.includes("-b");
const categoryArg = args.find((_, i) => args[i - 1] === "--category")?.toLowerCase();
const agentsArg = args.find((_, i) => args[i - 1] === "--agents")?.toLowerCase();
const taskArg = args.find((_, i) => args[i - 1] === "--task");
const singleTaskArg = !isBenchmark && args.length > 0 && !args[0].startsWith("--") ? args.join(" ") : null;

// =============================================================================
// BENCHMARK MODE
// =============================================================================

async function runBenchmarkMode() {
  console.log("\n🧪 SWARM-BT AGENT BENCHMARK");
  console.log("═".repeat(60));

  // Select tasks
  let tasks = ALL_BENCHMARK_TASKS;
  if (categoryArg) {
    tasks = getTasksByCategory(categoryArg as any);
    console.log(`Category: ${categoryArg} (${tasks.length} tasks)`);
  } else {
    console.log(`Running all ${tasks.length} tasks`);
  }

  // Select agents
  const agents = agentsArg?.split(",") || ["swarm", "flash", "swarm_only"];
  console.log(`Agents: ${agents.join(", ")}`);
  console.log("═".repeat(60));

  const results = [];

  // Run Swarm-BT
  if (agents.includes("swarm")) {
    console.log("\n🐝 Running Swarm-BT agent...");
    const swarmResult = await runSwarmBTBenchmark(tasks, {}, (task, i, total) => {
      process.stdout.write(`  [${i + 1}/${total}] ${task.id}: ${task.description}...`);
    });
    results.push(swarmResult);
    console.log(`\n  ✅ Swarm-BT: ${swarmResult.aggregate.correctCount}/${swarmResult.aggregate.totalTasks} correct (${(swarmResult.aggregate.correctRate * 100).toFixed(1)}%)`);
  }

  // Run Flash baseline
  if (agents.includes("flash")) {
    console.log("\n⚡ Running Flash baseline...");
    const flashResult = await runFlashBaselineBenchmark(tasks, (task, i, total) => {
      process.stdout.write(`  [${i + 1}/${total}] ${task.id}: ${task.description}...`);
    });
    results.push(flashResult);
    console.log(`\n  ✅ Flash: ${flashResult.aggregate.correctCount}/${flashResult.aggregate.totalTasks} correct (${(flashResult.aggregate.correctRate * 100).toFixed(1)}%)`);
  }

  // Run Swarm-only (no Flash fallback)
  if (agents.includes("swarm_only")) {
    console.log("\n🐝 Running Swarm-only (no Flash fallback)...");
    const swarmOnlyResult = await runSwarmOnlyBenchmark(tasks, (task, i, total) => {
      process.stdout.write(`  [${i + 1}/${total}] ${task.id}: ${task.description}...`);
    });
    results.push(swarmOnlyResult);
    console.log(`\n  ✅ Swarm-only: ${swarmOnlyResult.aggregate.correctCount}/${swarmOnlyResult.aggregate.totalTasks} correct (${(swarmOnlyResult.aggregate.correctRate * 100).toFixed(1)}%)`);
  }

  // Comparison table
  console.log("\n" + formatComparisonTable(results));

  // Save results
  const resultPath = `./data/benchmarks/agent_benchmark_${Date.now()}.json`;
  const { mkdirSync, writeFileSync } = await import("fs");
  mkdirSync("./data/benchmarks", { recursive: true });
  writeFileSync(resultPath, JSON.stringify(results, null, 2));
  console.log(`\n📊 Results saved to: ${resultPath}`);
}

// =============================================================================
// SINGLE TASK MODE
// =============================================================================

async function runSingleTask(task: string) {
  console.log(`\n🐝 Swarm-BT Agent: "${task}"\n`);
  registerAgentTools();

  const start = Date.now();
  const result = await runAgent(task);

  console.log("─".repeat(60));
  console.log(`📝 Answer:\n${result.answer}`);
  console.log("─".repeat(60));
  console.log(`  Source: ${result.source}`);
  console.log(`  LLM calls: ${result.totalLlmCalls}`);
  console.log(`  Tool calls: ${result.totalToolCalls}`);
  console.log(`  Flash used: ${result.usedFlash ? "Yes" : "No"}`);
  console.log(`  Converged: ${result.convergence.converged ? `Yes (${result.convergence.agreementCount}/${result.convergence.totalInstances})` : "No"}`);
  console.log(`  Time: ${result.elapsedMs}ms`);

  if (result.plan) {
    console.log(`\n  Plan (${result.plan.steps.length} steps):`);
    for (const step of result.plan.steps) {
      console.log(`    ${step.stepNumber}. ${step.description}${step.tool ? ` [${step.tool}]` : ""}`);
    }
  }
}

// =============================================================================
// INTERACTIVE REPL
// =============================================================================

async function runInteractiveMode() {
  console.log("\n🐝 Swarm-BT Agent — Interactive Mode");
  console.log("  Type a task and press Enter. Type 'quit' to exit.");
  console.log("  Prefix with 'flash:' to compare against Flash baseline.");
  console.log("═".repeat(60));

  registerAgentTools();

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "\n🐝 > ",
  });

  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input || input === "quit" || input === "exit") {
      rl.close();
      return;
    }

    const compareFlash = input.startsWith("flash:");
    const task = compareFlash ? input.slice(6).trim() : input;

    // Run Swarm-BT
    console.log("\n🐝 Swarm-BT thinking...");
    const swarmStart = Date.now();
    const swarmResult = await runAgent(task);

    console.log(`\n📝 Swarm-BT (${Date.now() - swarmStart}ms, ${swarmResult.totalLlmCalls} LLM calls):`);
    console.log(swarmResult.answer);
    console.log(`  [source: ${swarmResult.source}, converged: ${swarmResult.convergence.converged}, flash: ${swarmResult.usedFlash}]`);

    // Compare with Flash if requested
    if (compareFlash) {
      console.log("\n⚡ Flash baseline thinking...");
      const flashStart = Date.now();
      const flashResult = await runFlashBaseline(task);

      console.log(`\n📝 Flash (${Date.now() - flashStart}ms, ${flashResult.totalLlmCalls} LLM calls):`);
      console.log(flashResult.answer);
    }

    rl.prompt();
  });

  rl.on("close", () => {
    console.log("\n👋 Goodbye!");
    process.exit(0);
  });
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  // Importing config triggers .env loading
  await import("../models/config.js");

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY && !process.env.GEMINI_API_KEY) {
    console.error("❌ No API key found. Set GEMINI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY, or add a .env file.");
    process.exit(1);
  }

  // Register modular BT nodes
  registerStandardBTNodes();

  if (isBenchmark) {
    await runBenchmarkMode();
  } else if (taskArg || singleTaskArg) {
    await runSingleTask(taskArg || singleTaskArg!);
  } else {
    await runInteractiveMode();
  }
}

main().catch(console.error);
