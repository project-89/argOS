#!/usr/bin/env npx tsx
/**
 * Nightly Training CLI — Run overnight batch improvement for a person's assistant.
 *
 * Loads a person's saved model, explores variations of their actual conversations
 * using a swarm, merges the best patterns back, validates no regression, saves.
 *
 * Usage:
 *   npx tsx src/cli/nightly.ts                        # Train "default" person
 *   npx tsx src/cli/nightly.ts --person=alice          # Train specific person
 *   npx tsx src/cli/nightly.ts --dry-run               # Analyze without saving
 *   npx tsx src/cli/nightly.ts --validate-only         # Just benchmark existing model
 *   npx tsx src/cli/nightly.ts --instances=20          # More exploration
 *
 * Cron setup (run at 3am daily):
 *   0 3 * * * cd /path/to/psyche-bt && npx tsx src/cli/nightly.ts --person=alice >> logs/nightly.log 2>&1
 *
 * Environment:
 *   PERSON_ID=alice       Person to train (overridden by --person)
 *   INSTANCES=15          Swarm instances (overridden by --instances)
 *   DATA_DIR=./data       Data directory
 *   DRY_RUN=1             Don't save changes
 */

import "dotenv/config";
import {
  runNightlyTraining,
  DEFAULT_NIGHTLY_CONFIG,
  type NightlyConfig,
  type NightlyResult,
} from "../swarm/nightly-trainer.js";
import { setupSwarmMockHandlers } from "../swarm/swarm-runner.js";
import { setHandlers } from "../engine/conversation.js";
import { registerBuiltinTools } from "../tools/builtin.js";
import { loadPerson } from "../persistence/store.js";
import { runBenchmark } from "../engine/benchmark.js";
import { resolveDecisionFailure } from "../compiler/bt-compiler.js";
import * as fs from "node:fs";

// =============================================================================
// CLI ARGUMENT PARSING
// =============================================================================

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m",
  magenta: "\x1b[35m",
};

function parseArgs(): {
  personId: string;
  instances: number;
  dataDir: string;
  dryRun: boolean;
  validateOnly: boolean;
  help: boolean;
} {
  const args = process.argv.slice(2);
  let personId = process.env.PERSON_ID || "default";
  let instances = parseInt(process.env.INSTANCES || "15", 10);
  let dataDir = process.env.DATA_DIR || "./data";
  let dryRun = process.env.DRY_RUN === "1";
  let validateOnly = false;
  let help = false;

  for (const arg of args) {
    if (arg.startsWith("--person=")) personId = arg.slice(9);
    else if (arg.startsWith("--instances=")) instances = parseInt(arg.slice(12), 10);
    else if (arg.startsWith("--data-dir=")) dataDir = arg.slice(11);
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--validate-only") validateOnly = true;
    else if (arg === "--help" || arg === "-h") help = true;
  }

  return { personId, instances, dataDir, dryRun, validateOnly, help };
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const args = parseArgs();

  if (args.help) {
    console.log(`
Nightly Training — Overnight batch improvement for a person's assistant.

Usage:
  npx tsx src/cli/nightly.ts [options]

Options:
  --person=ID          Person to train (default: "default")
  --instances=N        Swarm instances (default: 15)
  --data-dir=PATH      Data directory (default: ./data)
  --dry-run            Analyze and report, but don't save
  --validate-only      Just benchmark the existing model
  --help               Show this help
`);
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  console.log(`\n${C.bold}${C.magenta}╔══════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.magenta}║         Psyche-BT Nightly Training — ${args.personId.padEnd(19)}    ║${C.reset}`);
  console.log(`${C.bold}${C.magenta}╚══════════════════════════════════════════════════════════════╝${C.reset}`);
  console.log(`${C.dim}${new Date().toISOString()}${C.reset}\n`);

  registerBuiltinTools();

  // Set up handlers — use real LLM if API key available, otherwise mock
  const hasKey = Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
  if (hasKey) {
    const { escalationHandler, runtimeHandler, analysisHandler } = await import("../models/handlers.js");
    setHandlers({ escalation: escalationHandler, runtime: runtimeHandler, analysis: analysisHandler });
    console.log(`${C.green}Using real Gemini models.${C.reset}\n`);
  } else {
    setupSwarmMockHandlers();
    console.log(`${C.yellow}No API key — using mock handlers.${C.reset}\n`);
  }

  // Validate-only mode: just benchmark and exit
  if (args.validateOnly) {
    await runValidation(args.personId, args.dataDir);
    return;
  }

  // Full training pipeline
  const config: NightlyConfig = {
    ...DEFAULT_NIGHTLY_CONFIG,
    personId: args.personId,
    dataDir: args.dataDir,
    instanceCount: args.instances,
    dryRun: args.dryRun,
  };

  const result = await runNightlyTraining(config, (msg) => {
    console.log(`  ${msg}`);
  });

  // Report
  console.log(`\n${C.bold}${C.cyan}═══ Training Report ═══${C.reset}\n`);
  printResult(result);

  // Save log
  const logDir = `${args.dataDir}/nightly-logs`;
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = `${logDir}/${args.personId}_${timestamp}.json`;
  fs.writeFileSync(logPath, JSON.stringify(result, null, 2));
  console.log(`\n${C.dim}Log saved to ${logPath}${C.reset}`);
}

// =============================================================================
// VALIDATE-ONLY MODE
// =============================================================================

async function runValidation(personId: string, dataDir: string) {
  console.log(`${C.bold}Validation mode — benchmarking ${personId}${C.reset}\n`);

  const model = loadPerson(personId, dataDir);
  if (!model) {
    console.log(`${C.red}No saved model for "${personId}".${C.reset}`);
    return;
  }

  console.log(`Model: ${model.policy.totalNodes} nodes, ${model.policy.compiledBranches} compiled, v${model.policy.version}`);
  console.log(`Total interactions: ${model.totalMessages}`);
  console.log(`Escalation history: ${model.totalEscalations}/${model.totalEscalations + model.totalBTHandled} (${((model.totalEscalations / Math.max(1, model.totalEscalations + model.totalBTHandled)) * 100).toFixed(0)}%)`);

  console.log(`\nRunning benchmark (3 runs)...`);
  let totalEsc = 0;
  for (let i = 0; i < 3; i++) {
    const benchModel = JSON.parse(JSON.stringify(model));
    benchModel.personId = `bench_${i}`;
    benchModel.conversation = { recentMessages: [], currentTopics: [], emotionalState: "neutral", sessionStart: Date.now(), turnsThisSession: 0 };
    const run = await runBenchmark(benchModel);
    resolveDecisionFailure();
    const rate = run.results.filter(r => r.escalated).length / run.results.length;
    totalEsc += rate;
    console.log(`  Run ${i + 1}: ${(rate * 100).toFixed(0)}% escalation`);
  }
  console.log(`\n${C.bold}Average: ${((totalEsc / 3) * 100).toFixed(0)}% escalation${C.reset}`);
}

// =============================================================================
// REPORTING
// =============================================================================

function printResult(r: NightlyResult) {
  // Tree changes
  console.log(`${C.bold}Tree:${C.reset}`);
  console.log(`  Nodes:    ${r.beforeNodes} → ${r.afterNodes} (+${r.nodesAdded})`);
  console.log(`  Branches: ${r.beforeBranches} → ${r.afterBranches} (+${r.branchesAdded})`);

  // Swarm stats
  console.log(`\n${C.bold}Swarm:${C.reset}`);
  console.log(`  Instances:       ${r.instancesRun}`);
  console.log(`  Harvested:       ${r.branchesHarvested} branches`);
  console.log(`  Clusters:        ${r.clustersFormed} (${r.convergentClusters} convergent)`);

  // Training focus
  console.log(`\n${C.bold}Focus:${C.reset}`);
  console.log(`  Weak spots targeted: ${r.weakTopicsTargeted.join(", ") || "(none)"}`);
  console.log(`  Topics covered:      ${r.topicsCovered.join(", ") || "(none)"}`);

  // Validation
  console.log(`\n${C.bold}Validation:${C.reset}`);
  const escArrow = r.escalationDelta < 0 ? `${C.green}improved` : r.escalationDelta > 0 ? `${C.red}regressed` : "unchanged";
  console.log(`  Escalation: ${(r.beforeEscalationRate * 100).toFixed(0)}% → ${(r.afterEscalationRate * 100).toFixed(0)}% (${escArrow}${C.reset} ${Math.abs(r.escalationDelta * 100).toFixed(1)}pp)`);

  if (r.regressionDetected) {
    console.log(`  ${C.red}${C.bold}REGRESSION — changes rejected${C.reset}`);
  }

  // Status
  console.log(`\n${C.bold}Status:${C.reset}`);
  if (r.saved) {
    console.log(`  ${C.green}Model saved successfully.${C.reset}`);
  } else if (r.regressionDetected) {
    console.log(`  ${C.red}Changes rejected due to regression.${C.reset}`);
  } else if (r.branchesAdded === 0) {
    console.log(`  ${C.yellow}No new patterns found — model is well-trained.${C.reset}`);
  } else {
    console.log(`  ${C.yellow}Dry run — changes not saved.${C.reset}`);
  }

  console.log(`\n  ${C.dim}Completed in ${(r.elapsedMs / 1000).toFixed(1)}s${C.reset}`);
}

// =============================================================================
// RUN
// =============================================================================

main().catch(err => { console.error(err); process.exit(1); });
