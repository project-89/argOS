#!/usr/bin/env npx tsx
/**
 * Paper Evaluation Suite — Generates the empirical evidence for the paper.
 *
 * Runs all experiments N times, computes statistics, outputs tables
 * ready for paper inclusion.
 *
 * Experiments:
 *   1. Escalation Curve — escalation rate over turns (N runs)
 *   2. Tree Growth — BT node count over turns (N runs)
 *   3. Cost Curve — estimated cost per turn over time (N runs)
 *   4. Benchmark Learning — successive benchmark comparisons (N runs)
 *   5. Bootstrap Ablation — with vs without bootstrap tree
 *   6. Strategy vs Template — repetition rate and variety measurement
 *   7. Offline Operation — BT-only execution quality
 *
 * Run: cd psyche-bt && npx tsx src/cli/paper-eval.ts
 * Options:
 *   RUNS=10 — number of independent runs per experiment (default 5)
 *   TURNS=30 — conversation length per run (default 20)
 */

import "dotenv/config";
import { createPersonModel } from "../ecs/person-store.js";
import { createBootstrapTree } from "../bt/bootstrap.js";
import { countNodes, evaluateBT } from "../bt/evaluator.js";
import { getCompilerStats } from "../compiler/bt-compiler.js";
import { processTurn, setHandlers, type TurnResult } from "../engine/conversation.js";
import {
  runBenchmark, compareBenchmarks, saveBenchmarkRun,
  DEFAULT_BENCHMARK, type BenchmarkRun,
} from "../engine/benchmark.js";
import { registerBuiltinTools } from "../tools/builtin.js";
import { fillTemplate } from "../bt/templates.js";
import type { AgentAction } from "../bt/types.js";
import type { PersonModel } from "../ecs/types.js";
import * as fs from "node:fs";

// =============================================================================
// CONFIG
// =============================================================================

const N_RUNS = parseInt(process.env.RUNS || "5", 10);
const N_TURNS = parseInt(process.env.TURNS || "20", 10);
const HAS_API_KEY = Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY);

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m",
};

// =============================================================================
// CONVERSATION SCRIPTS
// =============================================================================

const CONVERSATION_POOL = [
  // Greeting / warmup
  "Hey, how are you?",
  "Hi there, just checking in.",
  "Morning! What's up?",
  // Work stress (should compile after first escalation)
  "I'm really stressed about this project deadline.",
  "Work is killing me today. Too many meetings.",
  "My boss just added three more items to my plate.",
  "The client wants changes again. I'm exhausted.",
  // Gallery / creative (specific topic — should compile)
  "The gallery show is coming up and I'm not ready.",
  "I need to finish curating the pieces for the exhibition.",
  "The artist statements still need editing. Ugh.",
  "I'm worried the framing won't be done in time.",
  // Positive / excited
  "Great news — I got the grant!",
  "The show went really well last night!",
  "My colleague loved the presentation I made.",
  // Questions
  "What should I focus on today?",
  "Do you remember what we talked about last time?",
  "What's the status on that thing you were working on?",
  // Emotional depth
  "Sometimes I wonder if I'm even good enough for this.",
  "I feel like an imposter in my own career.",
  "Everyone else seems to have it figured out.",
  // Novel topics (should escalate — fresh domain)
  "I'm thinking about learning pottery. Random, I know.",
  "Have you heard of the Bauhaus movement?",
  "I want to start a podcast about contemporary art.",
  "Do you know anything about grant writing?",
  // Returning
  "It's been a while. What did I miss?",
  "Sorry I was gone — busy week.",
  // Task requests
  "Can you make me a checklist for the show prep?",
  "Draft an email to the gallery director about the timeline.",
  "Help me brainstorm topics for the podcast.",
];

function getConversationScript(seed: number): string[] {
  // Deterministic shuffle based on seed
  const shuffled = [...CONVERSATION_POOL];
  let s = seed;
  for (let i = shuffled.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, N_TURNS);
}

// =============================================================================
// MOCK HANDLERS (consistent across runs for reproducibility)
// =============================================================================

function setupMockHandlers(): void {
  setHandlers({
    escalation: async (msg, model) => {
      const topics = model.conversation.currentTopics;
      const state = model.conversation.emotionalState;
      const response = state === "stressed"
        ? `I hear that. ${topics[0] ? `The ${topics[0]} pressure sounds real.` : "What's weighing on you most?"} Want me to help?`
        : msg.includes("?")
          ? `Good question. ${topics[0] ? `Based on what I know about your ${topics[0]},` : ""} let me think about that.`
          : `Thanks for sharing. ${topics[0] ? `Your ${topics[0]} work sounds important.` : "Tell me more."}`
      ;
      return {
        response,
        reasoning: `Person is ${state} about ${topics.join(", ")}. Need to ${state === "stressed" ? "acknowledge and offer help" : "engage and follow up"}.`,
        action: { type: "respond" as const, content: response },
      };
    },
    runtime: async (template, context, model) => {
      // Simulate Flash Lite filling — use template filler + slight variation
      const base = template.replace(/\{[^}]+\}/g, "...");
      return base.length > 10 ? base : "I'm here. What's on your mind?";
    },
    analysis: async (msg) => {
      const lower = msg.toLowerCase();
      const topics: string[] = [];
      if (/gallery|show|exhibit|curat/i.test(lower)) topics.push("creative");
      if (/work|project|deadline|boss|client|meeting/i.test(lower)) topics.push("work");
      if (/grant|fund|budget/i.test(lower)) topics.push("funding");
      if (/podcast|blog|content/i.test(lower)) topics.push("media");
      if (/pottery|bauhaus|art/i.test(lower)) topics.push("art");

      const emotionalState =
        /stress|overwhelm|exhaust|kill|ugh/i.test(lower) ? "stressed" :
        /great|love|well|grant/i.test(lower) ? "excited" :
        /wonder|imposter|enough|figured/i.test(lower) ? "vulnerable" :
        "neutral";

      const entities: string[] = [];
      if (/gallery/i.test(lower)) entities.push("Gallery");
      if (/bauhaus/i.test(lower)) entities.push("Bauhaus");

      return { topics, entities, emotionalState };
    },
  });
}

// =============================================================================
// STATISTICS
// =============================================================================

function mean(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function std(arr: number[]): number {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}

function ci95(arr: number[]): [number, number] {
  const m = mean(arr);
  const se = std(arr) / Math.sqrt(arr.length);
  return [m - 1.96 * se, m + 1.96 * se];
}

function formatStat(arr: number[], decimals = 1): string {
  return `${mean(arr).toFixed(decimals)} ± ${std(arr).toFixed(decimals)}`;
}

// =============================================================================
// EXPERIMENT 1: ESCALATION CURVE
// =============================================================================

interface CurvePoint { turn: number; escalationRate: number; treeSize: number; cost: number }

async function runEscalationCurve(seed: number): Promise<CurvePoint[]> {
  const model = createPersonModel(`eval-${seed}`);
  model.policy.tree = createBootstrapTree();
  model.policy.totalNodes = countNodes(model.policy.tree);

  const script = getConversationScript(seed);
  const points: CurvePoint[] = [];
  let totalEscalated = 0;
  let totalHandled = 0;
  let totalCost = 0;

  for (let i = 0; i < script.length; i++) {
    const result = await processTurn(script[i], model);
    if (result.escalated) totalEscalated++;
    else totalHandled++;
    totalCost += result.cost;

    points.push({
      turn: i + 1,
      escalationRate: totalEscalated / (totalEscalated + totalHandled),
      treeSize: model.policy.totalNodes,
      cost: totalCost / (i + 1),
    });
  }

  return points;
}

// =============================================================================
// EXPERIMENT 5: BOOTSTRAP ABLATION
// =============================================================================

async function runAblation(seed: number, withBootstrap: boolean): Promise<{ escalationRate: number; treeSize: number }> {
  const model = createPersonModel(`ablation-${seed}`);
  if (withBootstrap) {
    model.policy.tree = createBootstrapTree();
  } else {
    // Minimal tree — only escalation
    model.policy.tree = { type: "llm_escalate" as const };
  }
  model.policy.totalNodes = countNodes(model.policy.tree);

  const script = getConversationScript(seed);
  for (const msg of script) {
    await processTurn(msg, model);
  }

  const stats = getCompilerStats(model);
  return { escalationRate: stats.escalationRate, treeSize: stats.totalNodes };
}

// =============================================================================
// EXPERIMENT 6: STRATEGY VS TEMPLATE VARIETY
// =============================================================================

async function measureRepetition(seed: number): Promise<{ uniqueResponses: number; totalResponses: number }> {
  const model = createPersonModel(`variety-${seed}`);
  model.policy.tree = createBootstrapTree();
  model.policy.totalNodes = countNodes(model.policy.tree);

  // Send the same message 5 times
  const responses: string[] = [];
  for (let i = 0; i < 5; i++) {
    const result = await processTurn("I'm stressed about the gallery deadline", model);
    responses.push(result.response);
  }

  const unique = new Set(responses).size;
  return { uniqueResponses: unique, totalResponses: responses.length };
}

// =============================================================================
// EXPERIMENT 7: OFFLINE OPERATION
// =============================================================================

async function runOfflineTest(seed: number): Promise<{ handled: number; total: number }> {
  // First: train the model
  const model = createPersonModel(`offline-${seed}`);
  model.policy.tree = createBootstrapTree();
  model.policy.totalNodes = countNodes(model.policy.tree);

  const script = getConversationScript(seed);
  for (const msg of script) {
    await processTurn(msg, model);
  }

  // Now: run the benchmark with NO escalation handler (BT only)
  setHandlers({
    escalation: async () => { throw new Error("OFFLINE — no LLM available"); },
    runtime: async (template) => template.replace(/\{[^}]+\}/g, "..."),
    analysis: async () => ({ topics: [], entities: [], emotionalState: "neutral" }),
  });

  let handled = 0;
  let total = 0;
  for (const task of DEFAULT_BENCHMARK) {
    total++;
    try {
      const result = await processTurn(task.input, model);
      if (!result.escalated) handled++;
    } catch {
      // Escalation attempted but handler threw — task not handled
    }
  }

  // Restore handlers
  if (HAS_API_KEY) {
    const { escalationHandler: eh, runtimeHandler: rh, analysisHandler: ah } = await import("../models/handlers.js");
    setHandlers({ escalation: eh, runtime: rh, analysis: ah });
  } else {
    setupMockHandlers();
  }

  return { handled, total };
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║         Psyche-BT Paper Evaluation Suite                     ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════════════════════════════╝${C.reset}\n`);
  console.log(`${C.dim}Runs per experiment: ${N_RUNS} | Turns per conversation: ${N_TURNS}${C.reset}\n`);

  registerBuiltinTools();

  if (HAS_API_KEY) {
    const { escalationHandler, runtimeHandler, analysisHandler } = await import("../models/handlers.js");
    setHandlers({ escalation: escalationHandler, runtime: runtimeHandler, analysis: analysisHandler });
    console.log(`${C.green}Using REAL Gemini models (Flash Lite + Flash).${C.reset}\n`);
  } else {
    setupMockHandlers();
    console.log(`${C.yellow}No API key — using mock handlers. Set GOOGLE_GENERATIVE_AI_API_KEY for real models.${C.reset}\n`);
  }

  const allResults: Record<string, any> = {};

  // ─── EXPERIMENT 1: ESCALATION CURVE ──────────────────────────────
  console.log(`${C.bold}Experiment 1: Escalation Curve${C.reset}`);
  const curves: CurvePoint[][] = [];
  for (let run = 0; run < N_RUNS; run++) {
    process.stdout.write(`  Run ${run + 1}/${N_RUNS}...`);
    const points = await runEscalationCurve(run * 1000 + 42);
    curves.push(points);
    console.log(` esc=${(points[points.length - 1].escalationRate * 100).toFixed(0)}% tree=${points[points.length - 1].treeSize}`);
  }

  // Aggregate by turn
  console.log(`\n  ${C.bold}Turn | Escalation Rate    | Tree Size          | Cost/Turn${C.reset}`);
  console.log(`  ${"─".repeat(65)}`);
  for (let t = 0; t < N_TURNS; t += Math.max(1, Math.floor(N_TURNS / 10))) {
    const escRates = curves.map(c => c[t]?.escalationRate ?? 0);
    const treeSizes = curves.map(c => c[t]?.treeSize ?? 0);
    const costs = curves.map(c => c[t]?.cost ?? 0);
    console.log(`  ${String(t + 1).padStart(4)} | ${formatStat(escRates).padEnd(18)} | ${formatStat(treeSizes, 0).padEnd(18)} | $${formatStat(costs, 4)}`);
  }

  allResults.escalationCurve = {
    finalEscalationRates: curves.map(c => c[c.length - 1].escalationRate),
    finalTreeSizes: curves.map(c => c[c.length - 1].treeSize),
  };

  // ─── EXPERIMENT 2: BENCHMARK LEARNING ───────────────────────────
  console.log(`\n${C.bold}Experiment 2: Benchmark Learning (2 successive runs)${C.reset}`);
  const benchResults: Array<{ run1Esc: number; run2Esc: number; delta: number; improvements: number }> = [];

  for (let run = 0; run < N_RUNS; run++) {
    process.stdout.write(`  Run ${run + 1}/${N_RUNS}...`);
    const model = createPersonModel(`bench-${run}`);
    model.policy.tree = createBootstrapTree();
    model.policy.totalNodes = countNodes(model.policy.tree);

    const run1 = await runBenchmark(model, DEFAULT_BENCHMARK);
    const run2 = await runBenchmark(model, DEFAULT_BENCHMARK);
    const report = compareBenchmarks(run2, run1);

    benchResults.push({
      run1Esc: run1.results.filter(r => r.escalated).length / run1.results.length,
      run2Esc: report.escalationRate,
      delta: report.escalationDelta ?? 0,
      improvements: report.improvements.length,
    });
    console.log(` run1=${(benchResults[run].run1Esc * 100).toFixed(0)}% → run2=${(benchResults[run].run2Esc * 100).toFixed(0)}% (Δ${(benchResults[run].delta * 100).toFixed(0)}pp, ${benchResults[run].improvements} improvements)`);
  }

  allResults.benchmarkLearning = benchResults;

  // ─── EXPERIMENT 5: BOOTSTRAP ABLATION ───────────────────────────
  console.log(`\n${C.bold}Experiment 3: Bootstrap Ablation${C.reset}`);
  const withBoot: number[] = [];
  const withoutBoot: number[] = [];

  for (let run = 0; run < N_RUNS; run++) {
    process.stdout.write(`  Run ${run + 1}/${N_RUNS}...`);
    const wb = await runAblation(run * 100 + 7, true);
    const nb = await runAblation(run * 100 + 7, false);
    withBoot.push(wb.escalationRate);
    withoutBoot.push(nb.escalationRate);
    console.log(` with=${(wb.escalationRate * 100).toFixed(0)}% without=${(nb.escalationRate * 100).toFixed(0)}%`);
  }

  console.log(`\n  With bootstrap:    ${formatStat(withBoot.map(v => v * 100), 1)}% escalation`);
  console.log(`  Without bootstrap: ${formatStat(withoutBoot.map(v => v * 100), 1)}% escalation`);
  console.log(`  Δ: ${(mean(withoutBoot) - mean(withBoot)).toFixed(2) } (bootstrap reduces escalation by ${((mean(withoutBoot) - mean(withBoot)) * 100).toFixed(0)}pp)`);

  allResults.ablation = { withBoot, withoutBoot };

  // ─── EXPERIMENT 6: VARIETY MEASUREMENT ──────────────────────────
  console.log(`\n${C.bold}Experiment 4: Response Variety (same input 5x)${C.reset}`);
  const varieties: number[] = [];

  for (let run = 0; run < N_RUNS; run++) {
    process.stdout.write(`  Run ${run + 1}/${N_RUNS}...`);
    const v = await measureRepetition(run * 50 + 13);
    varieties.push(v.uniqueResponses / v.totalResponses);
    console.log(` ${v.uniqueResponses}/${v.totalResponses} unique (${(v.uniqueResponses / v.totalResponses * 100).toFixed(0)}%)`);
  }

  console.log(`\n  Variety rate: ${formatStat(varieties.map(v => v * 100), 1)}%`);

  allResults.variety = varieties;

  // ─── EXPERIMENT 7: OFFLINE OPERATION ────────────────────────────
  console.log(`\n${C.bold}Experiment 5: Offline Operation (BT-only, no LLM)${C.reset}`);
  const offlineRates: number[] = [];

  for (let run = 0; run < N_RUNS; run++) {
    process.stdout.write(`  Run ${run + 1}/${N_RUNS}...`);
    const o = await runOfflineTest(run * 200 + 31);
    offlineRates.push(o.handled / o.total);
    console.log(` ${o.handled}/${o.total} handled (${(o.handled / o.total * 100).toFixed(0)}%)`);
  }

  console.log(`\n  Offline handling rate: ${formatStat(offlineRates.map(v => v * 100), 1)}%`);

  allResults.offline = offlineRates;

  // ─── SUMMARY TABLE ──────────────────────────────────────────────
  console.log(`\n${"═".repeat(60)}`);
  console.log(`${C.bold}  PAPER RESULTS SUMMARY (N=${N_RUNS} runs)${C.reset}`);
  console.log("═".repeat(60));

  const finalEsc = allResults.escalationCurve.finalEscalationRates;
  const finalTree = allResults.escalationCurve.finalTreeSizes;
  const benchDeltas = benchResults.map(b => b.delta);
  const benchImprovements = benchResults.map(b => b.improvements);

  console.log(`\n${C.bold}Table 1: Core Learning Metrics${C.reset}`);
  console.log(`  Final escalation rate:       ${formatStat(finalEsc.map((v: number) => v * 100))}%`);
  console.log(`  Final tree size:             ${formatStat(finalTree, 0)} nodes`);
  console.log(`  Benchmark Δ (run1→run2):     ${formatStat(benchDeltas.map((v: number) => v * 100))}pp`);
  console.log(`  Benchmark improvements:      ${formatStat(benchImprovements, 1)} per run`);
  console.log(`  Bootstrap ablation effect:   ${((mean(withoutBoot) - mean(withBoot)) * 100).toFixed(1)}pp reduction`);
  console.log(`  Response variety:            ${formatStat(varieties.map(v => v * 100))}%`);
  console.log(`  Offline handling rate:       ${formatStat(offlineRates.map(v => v * 100))}%`);

  const [escLo, escHi] = ci95(finalEsc.map((v: number) => v * 100));
  const [treeLo, treeHi] = ci95(finalTree);
  console.log(`\n${C.bold}95% Confidence Intervals:${C.reset}`);
  console.log(`  Escalation rate: [${escLo.toFixed(1)}%, ${escHi.toFixed(1)}%]`);
  console.log(`  Tree size: [${treeLo.toFixed(0)}, ${treeHi.toFixed(0)}] nodes`);

  // Save raw results
  const outputDir = "./data/paper-eval";
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = `${outputDir}/results_${Date.now()}.json`;
  fs.writeFileSync(outputPath, JSON.stringify(allResults, null, 2));
  console.log(`\n${C.dim}Raw results saved to ${outputPath}${C.reset}\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
