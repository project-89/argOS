/**
 * Benchmark Runner — Runs tasks across agent configurations and compares results.
 *
 * Supports three agent modes:
 *   1. Swarm-BT: Flash Lite swarm + BT compilation
 *   2. Flash Baseline: Single Flash instance with ReAct loop
 *   3. Swarm-only: Flash Lite swarm, NO Flash fallback
 *
 * Measures: correctness, cost, latency, steps, and learning curve.
 */

import { runAgent, runFlashBaseline } from "./swarm-agent.js";
import type { AgentResult, AgentConfig } from "./swarm-agent.js";
import { ALL_BENCHMARK_TASKS, getTasksByCategory } from "./benchmark-tasks.js";
import type { BenchmarkTask } from "./benchmark-tasks.js";
import { RUNTIME_MODEL, REASONING_MODEL } from "../models/config.js";

// =============================================================================
// TYPES
// =============================================================================

export interface TaskEvaluation {
  taskId: string;
  category: string;
  difficulty: number;
  /** Was the answer correct? */
  correct: boolean;
  /** Correctness score 0-1 (for keyword matching) */
  score: number;
  /** Keywords found / total keywords */
  keywordHits: number;
  keywordTotal: number;
  /** Agent metrics */
  totalLlmCalls: number;
  totalToolCalls: number;
  elapsedMs: number;
  usedFlash: boolean;
  /** Swarm convergence */
  converged: boolean;
  agreementCount: number;
  /** Source of the answer */
  source: string;
  /** The actual answer (truncated) */
  answer: string;
}

export interface BenchmarkRunResult {
  /** Agent type identifier */
  agentType: "swarm_bt" | "flash_baseline" | "swarm_only";
  /** Timestamp */
  timestamp: string;
  /** Per-task results */
  evaluations: TaskEvaluation[];
  /** Aggregate metrics */
  aggregate: {
    totalTasks: number;
    correctCount: number;
    correctRate: number;
    avgScore: number;
    totalLlmCalls: number;
    avgLlmCalls: number;
    totalToolCalls: number;
    totalElapsedMs: number;
    avgLatencyMs: number;
    flashUsageCount: number;
    flashUsageRate: number;
    convergenceRate: number;
  };
  /** Per-category breakdown */
  categories: Record<string, {
    total: number;
    correct: number;
    rate: number;
    avgScore: number;
    avgLlmCalls: number;
    avgLatencyMs: number;
  }>;
}

// =============================================================================
// EVALUATION
// =============================================================================

function evaluateAnswer(task: BenchmarkTask, answer: string): { correct: boolean; score: number; keywordHits: number } {
  const lower = answer.toLowerCase();

  if (task.evalMethod === "exact") {
    const expected = task.expectedAnswer.toLowerCase();
    let correct = lower.includes(expected);

    // Fallback for fraction/decimal equivalents
    if (!correct && expected.includes("/")) {
      try {
        const [num, den] = expected.split("/").map(Number);
        const expectedVal = num / den;
        // Extract numbers from answer and check if any are close to expectedVal
        const numbers = lower.match(/0\.\d+|[1-9]\d*\.\d+|\d+/g);
        if (numbers) {
          correct = numbers.some(n => Math.abs(parseFloat(n) - expectedVal) < 0.01);
        }
      } catch { /* ignore parsing errors */ }
    }

    return { correct, score: correct ? 1.0 : 0.0, keywordHits: correct ? 1 : 0 };
  }

  if (task.evalMethod === "keywords") {
    let hits = 0;
    for (const kw of task.answerKeywords) {
      if (lower.includes(kw.toLowerCase())) hits++;
    }
    const score = task.answerKeywords.length > 0 ? hits / task.answerKeywords.length : 0;
    return { correct: score >= 0.5, score, keywordHits: hits };
  }

  // For "judge" method, we'd need an LLM judge — use keywords as fallback
  let hits = 0;
  for (const kw of task.answerKeywords) {
    if (lower.includes(kw.toLowerCase())) hits++;
  }
  const score = task.answerKeywords.length > 0 ? hits / task.answerKeywords.length : 0;
  return { correct: score >= 0.5, score, keywordHits: hits };
}

// =============================================================================
// BENCHMARK RUNNERS
// =============================================================================

/**
 * Run the Swarm-BT agent on all tasks.
 */
export async function runSwarmBTBenchmark(
  tasks: BenchmarkTask[] = ALL_BENCHMARK_TASKS,
  config: Partial<AgentConfig> = {},
  onProgress?: (task: BenchmarkTask, index: number, total: number) => void,
): Promise<BenchmarkRunResult> {
  const evaluations: TaskEvaluation[] = [];

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    onProgress?.(task, i, tasks.length);

    const result = await runAgent(task.prompt, "", {
      ...config,
      allowFlashFallback: true,
    });
    const eval_ = evaluateAnswer(task, result.answer);

    evaluations.push({
      taskId: task.id,
      category: task.category,
      difficulty: task.difficulty,
      correct: eval_.correct,
      score: eval_.score,
      keywordHits: eval_.keywordHits,
      keywordTotal: task.answerKeywords.length,
      totalLlmCalls: result.totalLlmCalls,
      totalToolCalls: result.totalToolCalls,
      elapsedMs: result.elapsedMs,
      usedFlash: result.usedFlash,
      converged: result.convergence.converged,
      agreementCount: result.convergence.agreementCount,
      source: result.source,
      answer: result.answer.slice(0, 200),
    });
  }

  return buildRunResult("swarm_bt", evaluations);
}

/**
 * Run the Flash baseline (single model) on all tasks.
 */
export async function runFlashBaselineBenchmark(
  tasks: BenchmarkTask[] = ALL_BENCHMARK_TASKS,
  onProgress?: (task: BenchmarkTask, index: number, total: number) => void,
): Promise<BenchmarkRunResult> {
  const evaluations: TaskEvaluation[] = [];

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    onProgress?.(task, i, tasks.length);

    const result = await runFlashBaseline(task.prompt);
    const eval_ = evaluateAnswer(task, result.answer);

    evaluations.push({
      taskId: task.id,
      category: task.category,
      difficulty: task.difficulty,
      correct: eval_.correct,
      score: eval_.score,
      keywordHits: eval_.keywordHits,
      keywordTotal: task.answerKeywords.length,
      totalLlmCalls: result.totalLlmCalls,
      totalToolCalls: result.totalToolCalls,
      elapsedMs: result.elapsedMs,
      usedFlash: true,
      converged: false,
      agreementCount: 0,
      source: "flash_baseline",
      answer: result.answer.slice(0, 200),
    });
  }

  return buildRunResult("flash_baseline", evaluations);
}

/**
 * Run the Swarm-only agent (no Flash fallback) on all tasks.
 */
export async function runSwarmOnlyBenchmark(
  tasks: BenchmarkTask[] = ALL_BENCHMARK_TASKS,
  onProgress?: (task: BenchmarkTask, index: number, total: number) => void,
): Promise<BenchmarkRunResult> {
  const evaluations: TaskEvaluation[] = [];

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    onProgress?.(task, i, tasks.length);

    const result = await runAgent(task.prompt, "", {
      allowFlashFallback: false,
    });
    const eval_ = evaluateAnswer(task, result.answer);

    evaluations.push({
      taskId: task.id,
      category: task.category,
      difficulty: task.difficulty,
      correct: eval_.correct,
      score: eval_.score,
      keywordHits: eval_.keywordHits,
      keywordTotal: task.answerKeywords.length,
      totalLlmCalls: result.totalLlmCalls,
      totalToolCalls: result.totalToolCalls,
      elapsedMs: result.elapsedMs,
      usedFlash: false,
      converged: result.convergence.converged,
      agreementCount: result.convergence.agreementCount,
      source: result.source,
      answer: result.answer.slice(0, 200),
    });
  }

  return buildRunResult("swarm_only", evaluations);
}

// =============================================================================
// AGGREGATE RESULTS
// =============================================================================

function buildRunResult(
  agentType: BenchmarkRunResult["agentType"],
  evaluations: TaskEvaluation[],
): BenchmarkRunResult {
  const total = evaluations.length;
  const correct = evaluations.filter(e => e.correct).length;
  const totalLlm = evaluations.reduce((s, e) => s + e.totalLlmCalls, 0);
  const totalTools = evaluations.reduce((s, e) => s + e.totalToolCalls, 0);
  const totalMs = evaluations.reduce((s, e) => s + e.elapsedMs, 0);
  const flashCount = evaluations.filter(e => e.usedFlash).length;
  const convergedCount = evaluations.filter(e => e.converged).length;

  // Per-category breakdown
  const categories: BenchmarkRunResult["categories"] = {};
  for (const e of evaluations) {
    if (!categories[e.category]) {
      categories[e.category] = { total: 0, correct: 0, rate: 0, avgScore: 0, avgLlmCalls: 0, avgLatencyMs: 0 };
    }
    const c = categories[e.category];
    c.total++;
    if (e.correct) c.correct++;
    c.avgScore += e.score;
    c.avgLlmCalls += e.totalLlmCalls;
    c.avgLatencyMs += e.elapsedMs;
  }
  for (const cat of Object.values(categories)) {
    cat.rate = cat.total > 0 ? cat.correct / cat.total : 0;
    cat.avgScore = cat.total > 0 ? cat.avgScore / cat.total : 0;
    cat.avgLlmCalls = cat.total > 0 ? cat.avgLlmCalls / cat.total : 0;
    cat.avgLatencyMs = cat.total > 0 ? cat.avgLatencyMs / cat.total : 0;
  }

  return {
    agentType,
    timestamp: new Date().toISOString(),
    evaluations,
    aggregate: {
      totalTasks: total,
      correctCount: correct,
      correctRate: total > 0 ? correct / total : 0,
      avgScore: total > 0 ? evaluations.reduce((s, e) => s + e.score, 0) / total : 0,
      totalLlmCalls: totalLlm,
      avgLlmCalls: total > 0 ? totalLlm / total : 0,
      totalToolCalls: totalTools,
      totalElapsedMs: totalMs,
      avgLatencyMs: total > 0 ? totalMs / total : 0,
      flashUsageCount: flashCount,
      flashUsageRate: total > 0 ? flashCount / total : 0,
      convergenceRate: total > 0 ? convergedCount / total : 0,
    },
    categories,
  };
}

// =============================================================================
// COMPARISON TABLE
// =============================================================================

export function formatComparisonTable(runs: BenchmarkRunResult[]): string {
  const lines: string[] = [];
  lines.push("╔══════════════════════════════════════════════════════════════════════╗");
  lines.push("║              SWARM-BT AGENT BENCHMARK COMPARISON                   ║");
  lines.push("╠══════════════════════════════════════════════════════════════════════╣");
  lines.push("");

  // Header
  const agents = runs.map(r => r.agentType.padEnd(15));
  lines.push(`  Metric              ${agents.join("  ")}`);
  lines.push(`  ${"─".repeat(20)}  ${agents.map(() => "─".repeat(15)).join("  ")}`);

  // Aggregate metrics
  const metrics = [
    ["Correct Rate", (r: BenchmarkRunResult) => `${(r.aggregate.correctRate * 100).toFixed(1)}%`],
    ["Avg Score", (r: BenchmarkRunResult) => r.aggregate.avgScore.toFixed(2)],
    ["Avg LLM Calls", (r: BenchmarkRunResult) => r.aggregate.avgLlmCalls.toFixed(1)],
    ["Total Tool Calls", (r: BenchmarkRunResult) => String(r.aggregate.totalToolCalls)],
    ["Avg Latency (ms)", (r: BenchmarkRunResult) => r.aggregate.avgLatencyMs.toFixed(0)],
    ["Flash Usage", (r: BenchmarkRunResult) => `${(r.aggregate.flashUsageRate * 100).toFixed(0)}%`],
    ["Convergence Rate", (r: BenchmarkRunResult) => `${(r.aggregate.convergenceRate * 100).toFixed(0)}%`],
  ] as const;

  for (const [name, fn] of metrics) {
    const values = runs.map(r => (fn as (r: BenchmarkRunResult) => string)(r).padEnd(15));
    lines.push(`  ${(name as string).padEnd(20)}  ${values.join("  ")}`);
  }

  // Per-category breakdown
  lines.push("");
  lines.push("  Per-Category Correct Rate:");
  lines.push(`  ${"─".repeat(20)}  ${agents.map(() => "─".repeat(15)).join("  ")}`);

  const allCategories = new Set(runs.flatMap(r => Object.keys(r.categories)));
  for (const cat of allCategories) {
    const values = runs.map(r => {
      const c = r.categories[cat];
      return c ? `${(c.rate * 100).toFixed(0)}% (${c.correct}/${c.total})` : "N/A";
    }).map(v => v.padEnd(15));
    lines.push(`  ${cat.padEnd(20)}  ${values.join("  ")}`);
  }

  lines.push("");
  lines.push("╚══════════════════════════════════════════════════════════════════════╝");
  return lines.join("\n");
}
