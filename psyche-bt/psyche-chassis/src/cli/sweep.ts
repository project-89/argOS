/**
 * Sweep Script — Runs parameter sweeps across Swarm-BT configurations.
 *
 * Sweeps:
 *   - maxDepth: 1, 2
 *   - planSwarmSize: 3, 5
 *   - nodes: standard (Sequence/Selector only) vs extended (Parallel/Decorators)
 */

import { runSwarmBTBenchmark } from "../agent/benchmark-runner.js";
import { ALL_BENCHMARK_TASKS, getTasksByCategory } from "../agent/benchmark-tasks.js";
import { registerBTNodes, clearNodeRegistry, registerStandardBTNodes } from "../bt/standard-nodes.js";
import { writeFileSync, mkdirSync } from "fs";

async function runSweep() {
  console.log("🧹 STARTING PARAMETER SWEEP");
  console.log("════════════════════════════════════════════════════════════");

  // Use a representative subset of tasks for the sweep to save time/cost
  // 1 from each category
  const sweepTasks = [
    ...getTasksByCategory("reasoning").slice(0, 1),
    ...getTasksByCategory("planning").slice(0, 1),
    ...getTasksByCategory("coding").slice(0, 1),
    ...getTasksByCategory("creative").slice(0, 1),
    ...getTasksByCategory("multi_step").slice(0, 1),
  ];

  console.log(`Running sweep on ${sweepTasks.length} representative tasks.`);

  const results: any[] = [];

  // Baseline: Standard nodes, depth 1, swarm 3
  console.log("\n▶ Running Baseline (Depth 1, Swarm 3, Standard Nodes)...");
  clearNodeRegistry(); // Only built-in Sequence/Selector
  const baseline = await runSwarmBTBenchmark(sweepTasks, {
    maxDepth: 1,
    planSwarmSize: 3,
    execSwarmSize: 3,
  });
  results.push({ name: "Baseline", ...baseline.aggregate });

  // Sweep 1: Depth 2
  console.log("\n▶ Running Sweep: Depth 2...");
  const depth2 = await runSwarmBTBenchmark(sweepTasks, {
    maxDepth: 2,
    planSwarmSize: 3,
    execSwarmSize: 3,
  });
  results.push({ name: "Depth=2", ...depth2.aggregate });

  // Sweep 2: Swarm Size 5
  console.log("\n▶ Running Sweep: Swarm Size 5...");
  const swarm5 = await runSwarmBTBenchmark(sweepTasks, {
    maxDepth: 1,
    planSwarmSize: 5,
    execSwarmSize: 3,
  });
  results.push({ name: "Swarm=5", ...swarm5.aggregate });

  // Sweep 3: Extended Nodes (Parallel + Decorators)
  console.log("\n▶ Running Sweep: Extended BT Nodes...");
  registerStandardBTNodes(); // Enable all plugins
  const extendedNodes = await runSwarmBTBenchmark(sweepTasks, {
    maxDepth: 1,
    planSwarmSize: 3,
    execSwarmSize: 3,
  });
  results.push({ name: "ExtNodes", ...extendedNodes.aggregate });

  // Print Summary Table
  console.log("\n📊 SWEEP RESULTS SUMMARY");
  console.log("════════════════════════════════════════════════════════════");
  console.log("  Config".padEnd(15) + " | Rate  | Score | Calls | Latency");
  console.log("  " + "─".repeat(13) + " | " + "─".repeat(5) + " | " + "─".repeat(5) + " | " + "─".repeat(5) + " | " + "─".repeat(7));

  for (const r of results) {
    console.log(
      `  ${r.name.padEnd(13)} | ` +
      `${(r.correctRate * 100).toFixed(0)}%`.padEnd(5) + " | " +
      `${r.avgScore.toFixed(2)}` + " | " +
      `${r.avgLlmCalls.toFixed(1)}`.padEnd(5) + " | " +
      `${r.avgLatencyMs.toFixed(0)}ms`
    );
  }

  // Save results
  const path = `./data/benchmarks/sweep_${Date.now()}.json`;
  mkdirSync("./data/benchmarks", { recursive: true });
  writeFileSync(path, JSON.stringify(results, null, 2));
  console.log(`\n💾 Results saved to ${path}`);
}

runSweep().catch(console.error);
