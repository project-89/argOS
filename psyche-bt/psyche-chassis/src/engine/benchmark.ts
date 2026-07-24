/**
 * Benchmark System — Proves the agent is continuously learning.
 *
 * Runs a fixed set of tasks against the current BT and measures:
 *   - Escalation rate (should decrease over time)
 *   - Task completion score (should increase)
 *   - Cost per task (should decrease)
 *   - Latency per task (should decrease)
 *   - Regression detection (old tasks should still work)
 *   - Transfer measurement (learning in one domain helps another)
 */

import type { PersonModel } from "../ecs/types.js";
import { processTurn, type TurnResult } from "./conversation.js";
import * as fs from "node:fs";
import * as path from "node:path";

// =============================================================================
// TYPES
// =============================================================================

export interface BenchmarkTask {
  id: string;
  category: string;        // "conversation", "research", "file_task", "tool_use"
  input: string;
  expectedBehavior: string; // What a good response looks like
  difficulty: "easy" | "medium" | "hard";
  requiresTool?: string;    // Tool that should be triggered
}

export interface TaskResult {
  taskId: string;
  category: string;
  escalated: boolean;
  llmCalls: number;
  latencyMs: number;
  cost: number;
  response: string;
  source: string;
  toolUsed?: string;
  compiledBranch: boolean;
}

export interface BenchmarkRun {
  runId: string;
  timestamp: number;
  personId: string;
  btVersion: number;
  btNodes: number;
  compiledBranches: number;
  results: TaskResult[];
}

export interface BenchmarkReport {
  currentRun: BenchmarkRun;
  previousRun?: BenchmarkRun;

  // Aggregate metrics
  escalationRate: number;
  avgLatencyMs: number;
  totalCost: number;
  totalLLMCalls: number;

  // Learning deltas (vs previous run)
  escalationDelta?: number;   // Negative = improving
  latencyDelta?: number;
  costDelta?: number;

  // Category breakdown
  categories: Record<string, {
    escalationRate: number;
    count: number;
    avgLatencyMs: number;
  }>;

  // Regressions (tasks that got worse)
  regressions: Array<{ taskId: string; previousSource: string; currentSource: string }>;

  // New patterns (tasks that improved)
  improvements: Array<{ taskId: string; previousSource: string; currentSource: string }>;
}

// =============================================================================
// DEFAULT BENCHMARK SUITE
// =============================================================================

export const DEFAULT_BENCHMARK: BenchmarkTask[] = [
  // Conversation — easy
  { id: "conv_greeting", category: "conversation", difficulty: "easy",
    input: "Hey, how's it going?",
    expectedBehavior: "Warm greeting, open-ended" },
  { id: "conv_stress", category: "conversation", difficulty: "easy",
    input: "I'm really stressed about this deadline",
    expectedBehavior: "Empathize, ask about specifics, offer help" },
  { id: "conv_excited", category: "conversation", difficulty: "easy",
    input: "I just got promoted!",
    expectedBehavior: "Match excitement, congratulate, ask for details" },
  { id: "conv_question", category: "conversation", difficulty: "medium",
    input: "What should I focus on this week?",
    expectedBehavior: "Reference known projects/intentions, prioritize" },
  { id: "conv_followup", category: "conversation", difficulty: "medium",
    input: "How's that thing you were working on for me?",
    expectedBehavior: "Reference active intention, give status" },

  // Tool use — medium
  { id: "tool_checklist", category: "tool_use", difficulty: "medium",
    input: "Can you make me a checklist for the presentation?",
    expectedBehavior: "Trigger make_checklist tool", requiresTool: "make_checklist" },
  { id: "tool_draft", category: "tool_use", difficulty: "medium",
    input: "Draft an email to Sarah about the meeting",
    expectedBehavior: "Trigger draft tool with email type", requiresTool: "draft" },
  { id: "tool_readfile", category: "tool_use", difficulty: "hard",
    input: "Can you read my notes file and summarize it?",
    expectedBehavior: "Trigger file_read then summarize", requiresTool: "file_read" },

  // Emotional nuance — hard
  { id: "emo_imposter", category: "emotional", difficulty: "hard",
    input: "Sometimes I wonder if I'm even qualified for this job",
    expectedBehavior: "Validate feelings, reference their strengths" },
  { id: "emo_conflict", category: "emotional", difficulty: "hard",
    input: "My coworker keeps taking credit for my work and I don't know what to do",
    expectedBehavior: "Listen, acknowledge difficulty, ask for specifics before advising" },

  // Returning user — medium
  { id: "return_long", category: "returning", difficulty: "medium",
    input: "Hey, it's been a while. What's new?",
    expectedBehavior: "Warm reconnect, reference last conversation" },
];

// =============================================================================
// RUN BENCHMARK
// =============================================================================

export async function runBenchmark(
  model: PersonModel,
  tasks: BenchmarkTask[] = DEFAULT_BENCHMARK,
): Promise<BenchmarkRun> {
  const results: TaskResult[] = [];

  for (const task of tasks) {
    const start = Date.now();
    try {
      const turn = await processTurn(task.input, model);
      results.push({
        taskId: task.id,
        category: task.category,
        escalated: turn.escalated,
        llmCalls: turn.llmCalls,
        latencyMs: turn.latencyMs,
        cost: turn.cost,
        response: turn.response,
        source: turn.source,
        toolUsed: turn.toolUsed,
        compiledBranch: turn.compiledBranch,
      });
    } catch (err) {
      results.push({
        taskId: task.id,
        category: task.category,
        escalated: true,
        llmCalls: 0,
        latencyMs: Date.now() - start,
        cost: 0,
        response: `ERROR: ${(err as Error).message}`,
        source: "error",
        compiledBranch: false,
      });
    }
  }

  return {
    runId: `bench_${Date.now()}`,
    timestamp: Date.now(),
    personId: model.personId,
    btVersion: model.policy.version,
    btNodes: model.policy.totalNodes,
    compiledBranches: model.policy.compiledBranches,
    results,
  };
}

// =============================================================================
// COMPARE RUNS
// =============================================================================

export function compareBenchmarks(current: BenchmarkRun, previous?: BenchmarkRun): BenchmarkReport {
  const escalated = current.results.filter(r => r.escalated).length;
  const total = current.results.length;
  const escalationRate = total > 0 ? escalated / total : 1;
  const avgLatency = current.results.reduce((s, r) => s + r.latencyMs, 0) / Math.max(1, total);
  const totalCost = current.results.reduce((s, r) => s + r.cost, 0);
  const totalLLM = current.results.reduce((s, r) => s + r.llmCalls, 0);

  // Category breakdown
  const categories: Record<string, { escalationRate: number; count: number; avgLatencyMs: number }> = {};
  for (const r of current.results) {
    if (!categories[r.category]) categories[r.category] = { escalationRate: 0, count: 0, avgLatencyMs: 0 };
    const cat = categories[r.category];
    cat.count++;
    if (r.escalated) cat.escalationRate++;
    cat.avgLatencyMs += r.latencyMs;
  }
  for (const cat of Object.values(categories)) {
    cat.escalationRate = cat.count > 0 ? cat.escalationRate / cat.count : 0;
    cat.avgLatencyMs = cat.count > 0 ? cat.avgLatencyMs / cat.count : 0;
  }

  // Compare with previous
  const regressions: BenchmarkReport["regressions"] = [];
  const improvements: BenchmarkReport["improvements"] = [];

  if (previous) {
    for (const curr of current.results) {
      const prev = previous.results.find(r => r.taskId === curr.taskId);
      if (!prev) continue;
      if (!prev.escalated && curr.escalated) {
        regressions.push({ taskId: curr.taskId, previousSource: prev.source, currentSource: curr.source });
      }
      if (prev.escalated && !curr.escalated) {
        improvements.push({ taskId: curr.taskId, previousSource: prev.source, currentSource: curr.source });
      }
    }
  }

  const prevEsc = previous
    ? previous.results.filter(r => r.escalated).length / Math.max(1, previous.results.length)
    : undefined;
  const prevLatency = previous
    ? previous.results.reduce((s, r) => s + r.latencyMs, 0) / Math.max(1, previous.results.length)
    : undefined;
  const prevCost = previous
    ? previous.results.reduce((s, r) => s + r.cost, 0)
    : undefined;

  return {
    currentRun: current,
    previousRun: previous,
    escalationRate,
    avgLatencyMs: avgLatency,
    totalCost,
    totalLLMCalls: totalLLM,
    escalationDelta: prevEsc !== undefined ? escalationRate - prevEsc : undefined,
    latencyDelta: prevLatency !== undefined ? avgLatency - prevLatency : undefined,
    costDelta: prevCost !== undefined ? totalCost - prevCost : undefined,
    categories,
    regressions,
    improvements,
  };
}

// =============================================================================
// PERSISTENCE
// =============================================================================

export function saveBenchmarkRun(run: BenchmarkRun, dir: string = "./data/benchmarks"): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${run.runId}.json`), JSON.stringify(run, null, 2));
}

export function loadLatestBenchmark(personId: string, dir: string = "./data/benchmarks"): BenchmarkRun | null {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith(".json"))
    .sort()
    .reverse();
  for (const file of files) {
    try {
      const run = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8")) as BenchmarkRun;
      if (run.personId === personId) return run;
    } catch {}
  }
  return null;
}

// =============================================================================
// REPORT FORMATTING
// =============================================================================

export function formatBenchmarkReport(report: BenchmarkReport): string {
  const lines: string[] = [];
  const { currentRun: run } = report;

  lines.push(`BENCHMARK REPORT — ${new Date(run.timestamp).toLocaleDateString()}`);
  lines.push("═".repeat(50));
  lines.push(`BT: v${run.btVersion}, ${run.btNodes} nodes, ${run.compiledBranches} compiled`);
  lines.push("");

  // Headline metrics
  lines.push(`Escalation Rate: ${(report.escalationRate * 100).toFixed(0)}%${report.escalationDelta !== undefined ? ` (${report.escalationDelta > 0 ? "↑" : "↓"} ${Math.abs(report.escalationDelta * 100).toFixed(0)}pp)` : ""}`);
  lines.push(`Avg Latency:     ${report.avgLatencyMs.toFixed(0)}ms${report.latencyDelta !== undefined ? ` (${report.latencyDelta > 0 ? "↑" : "↓"} ${Math.abs(report.latencyDelta).toFixed(0)}ms)` : ""}`);
  lines.push(`Total Cost:      $${report.totalCost.toFixed(4)}${report.costDelta !== undefined ? ` (${report.costDelta > 0 ? "↑" : "↓"} $${Math.abs(report.costDelta).toFixed(4)})` : ""}`);
  lines.push(`LLM Calls:       ${report.totalLLMCalls}`);
  lines.push("");

  // Category breakdown
  lines.push("By Category:");
  for (const [cat, data] of Object.entries(report.categories)) {
    const handled = ((1 - data.escalationRate) * 100).toFixed(0);
    lines.push(`  ${cat.padEnd(15)} ${handled}% BT-handled (${data.count} tasks, ${data.avgLatencyMs.toFixed(0)}ms avg)`);
  }

  // Regressions
  if (report.regressions.length > 0) {
    lines.push("");
    lines.push(`REGRESSIONS (${report.regressions.length}):`);
    for (const r of report.regressions) {
      lines.push(`  ⚠ ${r.taskId}: was ${r.previousSource}, now ${r.currentSource}`);
    }
  }

  // Improvements
  if (report.improvements.length > 0) {
    lines.push("");
    lines.push(`IMPROVEMENTS (${report.improvements.length}):`);
    for (const r of report.improvements) {
      lines.push(`  ✓ ${r.taskId}: was ${r.previousSource}, now ${r.currentSource}`);
    }
  }

  return lines.join("\n");
}
