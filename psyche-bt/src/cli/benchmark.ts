#!/usr/bin/env npx tsx
/**
 * Benchmark CLI — Run the benchmark suite and show learning progress.
 *
 * Compares against the previous run to show improvement deltas.
 *
 * Run: cd psyche-bt && npx tsx src/cli/benchmark.ts
 */

import "dotenv/config";
import { createPersonModel } from "../ecs/person-store.js";
import { createBootstrapTree } from "../bt/bootstrap.js";
import { countNodes } from "../bt/evaluator.js";
import { setHandlers } from "../engine/conversation.js";
import { escalationHandler, runtimeHandler, analysisHandler } from "../models/handlers.js";
import { loadPerson } from "../persistence/store.js";
import {
  runBenchmark, compareBenchmarks, formatBenchmarkReport,
  saveBenchmarkRun, loadLatestBenchmark, DEFAULT_BENCHMARK,
} from "../engine/benchmark.js";
import { registerBuiltinTools } from "../tools/builtin.js";

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m",
};

async function main() {
  console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║           Psyche-BT Benchmark — Learning Measurement         ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════════════════════════════╝${C.reset}\n`);

  // Register tools
  registerBuiltinTools();

  // Set up handlers
  const hasKey = Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
  if (hasKey) {
    setHandlers({ escalation: escalationHandler, runtime: runtimeHandler, analysis: analysisHandler });
    console.log(`${C.green}Using real Gemini models.${C.reset}`);
  } else {
    console.log(`${C.yellow}No API key — mock mode.${C.reset}`);
    setHandlers({
      escalation: async (msg) => ({
        response: `I'll help with that. ${msg.includes("stress") ? "Sounds tough." : "Tell me more."}`,
        reasoning: "Mock",
        action: { type: "respond" as const, content: "Mock response" },
      }),
      runtime: async (template) => template.replace(/\{[^}]+\}/g, "..."),
      analysis: async (msg) => ({
        topics: [],
        entities: [],
        emotionalState: /stress|overwhelm/i.test(msg) ? "stressed" : "neutral",
      }),
    });
  }

  // Load or create model
  const personId = process.env.PERSON_ID || "benchmark";
  let model = loadPerson(personId, "./data");
  if (model) {
    console.log(`${C.green}Loaded model: ${model.policy.totalNodes} nodes, ${model.policy.compiledBranches} compiled.${C.reset}`);
  } else {
    model = createPersonModel(personId);
    model.policy.tree = createBootstrapTree();
    model.policy.totalNodes = countNodes(model.policy.tree);
    console.log(`${C.yellow}Fresh model — bootstrap tree only.${C.reset}`);
  }

  // Load previous benchmark for comparison
  const previousRun = loadLatestBenchmark(personId);
  if (previousRun) {
    console.log(`${C.dim}Previous benchmark: ${new Date(previousRun.timestamp).toLocaleDateString()} (v${previousRun.btVersion})${C.reset}`);
  }

  // Run benchmark
  console.log(`\n${C.dim}Running ${DEFAULT_BENCHMARK.length} benchmark tasks...${C.reset}\n`);

  const run = await runBenchmark(model, DEFAULT_BENCHMARK);

  // Compare and report
  const report = compareBenchmarks(run, previousRun || undefined);
  console.log(formatBenchmarkReport(report));

  // Save run
  saveBenchmarkRun(run);
  console.log(`\n${C.dim}Benchmark saved. Run again after training to see improvement.${C.reset}`);

  // Learning score
  console.log(`\n${C.bold}Learning Score:${C.reset}`);
  let score = 0;
  const checks = [
    { name: "Escalation < 80%", pass: report.escalationRate < 0.8, points: 10 },
    { name: "Escalation < 50%", pass: report.escalationRate < 0.5, points: 10 },
    { name: "Escalation < 30%", pass: report.escalationRate < 0.3, points: 10 },
    { name: "No regressions", pass: report.regressions.length === 0, points: 10 },
    { name: "Improvements found", pass: report.improvements.length > 0, points: 10 },
    { name: "BT handles conversation", pass: (report.categories["conversation"]?.escalationRate ?? 1) < 0.5, points: 10 },
    { name: "Cost < $0.01", pass: report.totalCost < 0.01, points: 10 },
  ];

  for (const c of checks) {
    if (c.pass) score += c.points;
    console.log(`  ${c.pass ? C.green + "✅" : C.red + "❌"} [${c.points}pts] ${c.name}${C.reset}`);
  }
  console.log(`\n  ${C.bold}SCORE: ${score}/70${C.reset}\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
