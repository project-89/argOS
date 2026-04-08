#!/usr/bin/env npx tsx
/**
 * Psyche-BT Eval — Automated learning measurement.
 *
 * Runs a scripted 20-turn conversation and measures:
 *   - Escalation rate over time (should decrease)
 *   - BT growth (should increase)
 *   - Pattern compilation (should accumulate)
 *   - Response quality markers
 *
 * Run: cd psyche-bt && npx tsx src/cli/eval.ts
 */

import "dotenv/config";
import { createPersonModel } from "../ecs/person-store.js";
import { createBootstrapTree } from "../bt/bootstrap.js";
import { countNodes } from "../bt/evaluator.js";
import { getCompilerStats } from "../compiler/bt-compiler.js";
import { processTurn, setHandlers } from "../engine/conversation.js";
import { escalationHandler, runtimeHandler, analysisHandler } from "../models/handlers.js";
import type { TurnResult } from "../engine/conversation.js";

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m",
};

// =============================================================================
// SCRIPTED CONVERSATION
// =============================================================================

const SCRIPT = [
  // Warmup (should escalate — no patterns yet)
  "Hey, I'm Alex. Just getting started with a new project.",
  "It's a gallery show — I'm curating contemporary art for a local space.",
  "Yeah, I'm pretty stressed about it honestly. The deadline is in two weeks.",

  // Topic recurrence (should compile pattern after first escalation)
  "The curation is the hardest part. Choosing which pieces work together.",
  "I'm also worried about the artist statements — they need editing.",
  "Thanks for asking. The gallery is called 'Threshold' — it's on Alberta Street.",

  // Emotional shift (should trigger BT stress handler after learning)
  "I'm overwhelmed with the logistics. Printing, framing, lighting...",
  "Actually can you help me make a checklist of everything I need to do?",
  "That would be amazing. I also need to send invites this week.",

  // Return to known topics (should be handled by BT now)
  "How's the checklist coming along?",
  "What about the artist statements — any progress?",
  "I'm feeling better about things now. The hard part is the unknown unknowns.",

  // New topic (should escalate — novel domain)
  "Completely different topic — do you know anything about grant writing?",
  "I want to apply for an arts council grant for next year's programming.",
  "The deadline is in March. I need a project narrative and a budget.",

  // Emotional complexity (tests nuanced response)
  "Sometimes I wonder if I'm even good enough to be doing this.",
  "Like, who am I to curate art? I'm not even an artist myself.",
  "You're right, maybe perspective is its own form of creativity.",

  // Closing (tests graceful conversation end)
  "Anyway, I should get back to work. Thanks for the chat.",
  "Talk soon!",
];

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const hasKey = Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY);

  console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║        Psyche-BT Eval — Learning Measurement                ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════════════════════════════╝${C.reset}\n`);

  if (hasKey) {
    console.log(`${C.green}Using real Gemini models (Flash Lite + Flash).${C.reset}\n`);
    setHandlers({ escalation: escalationHandler, runtime: runtimeHandler, analysis: analysisHandler });
  } else {
    console.log(`${C.yellow}No API key — using mock handlers.${C.reset}\n`);
    setHandlers({
      escalation: async (msg) => ({
        response: `I understand. ${msg.includes("stress") ? "That sounds tough." : "Tell me more about that."}`,
        reasoning: "Mock",
        action: { type: "respond" as const, content: "Mock response" },
      }),
      runtime: async (template) => template.replace(/\{[^}]+\}/g, "..."),
      analysis: async (msg) => ({
        topics: msg.includes("gallery") ? ["creative"] : msg.includes("grant") ? ["money"] : [],
        entities: msg.includes("Threshold") ? ["Threshold"] : msg.includes("Alex") ? ["Alex"] : [],
        emotionalState: /stress|overwhelm|wonder|worried/i.test(msg) ? "stressed" :
                       /better|amazing|great/i.test(msg) ? "excited" : "neutral",
      }),
    });
  }

  // Create fresh model
  const model = createPersonModel("eval-user");
  model.policy.tree = createBootstrapTree();
  model.policy.totalNodes = countNodes(model.policy.tree);

  // Run the conversation
  const results: Array<{ turn: number; input: string; result: TurnResult; treeSize: number; escalationRate: number }> = [];

  for (let i = 0; i < SCRIPT.length; i++) {
    const input = SCRIPT[i];
    console.log(`${C.dim}Turn ${i + 1}/${SCRIPT.length}: "${input.slice(0, 50)}${input.length > 50 ? "..." : ""}"${C.reset}`);

    try {
      const result = await processTurn(input, model);
      const stats = getCompilerStats(model);

      results.push({
        turn: i + 1,
        input,
        result,
        treeSize: stats.totalNodes,
        escalationRate: stats.escalationRate,
      });

      const tag = result.escalated ? `${C.yellow}ESC${C.reset}` : `${C.green}BT${C.reset}`;
      console.log(`  ${tag} → "${result.response.slice(0, 60)}${result.response.length > 60 ? "..." : ""}"`);
      console.log(`  ${C.dim}tree: ${stats.totalNodes} | compiled: ${stats.compiledBranches} | esc rate: ${(stats.escalationRate * 100).toFixed(0)}%${C.reset}`);
    } catch (err) {
      console.log(`  ${C.red}ERROR: ${(err as Error).message}${C.reset}`);
    }
  }

  // =============================================================================
  // SCORECARD
  // =============================================================================

  console.log(`\n${"═".repeat(60)}`);
  console.log(`${C.bold}  LEARNING SCORECARD${C.reset}`);
  console.log("═".repeat(60));

  const finalStats = getCompilerStats(model);

  // Escalation curve
  console.log(`\n${C.bold}Escalation Curve:${C.reset}`);
  const firstHalf = results.slice(0, 10);
  const secondHalf = results.slice(10);
  const firstHalfEsc = firstHalf.filter(r => r.result.escalated).length / firstHalf.length;
  const secondHalfEsc = secondHalf.length > 0 ? secondHalf.filter(r => r.result.escalated).length / secondHalf.length : 0;
  console.log(`  First 10 turns:  ${(firstHalfEsc * 100).toFixed(0)}% escalated`);
  console.log(`  Last 10 turns:   ${(secondHalfEsc * 100).toFixed(0)}% escalated`);
  console.log(`  Improvement:     ${firstHalfEsc > secondHalfEsc ? C.green + "↓" : C.red + "↑"}${C.reset} ${((firstHalfEsc - secondHalfEsc) * 100).toFixed(0)} percentage points`);

  // Tree growth
  console.log(`\n${C.bold}Tree Growth:${C.reset}`);
  const initialSize = countNodes(createBootstrapTree());
  console.log(`  Bootstrap:  ${initialSize} nodes`);
  console.log(`  Final:      ${finalStats.totalNodes} nodes`);
  console.log(`  Growth:     ${finalStats.totalNodes - initialSize} nodes (+${((finalStats.totalNodes / initialSize - 1) * 100).toFixed(0)}%)`);
  console.log(`  Compiled:   ${finalStats.compiledBranches} branches from LLM decisions`);

  // Per-turn visualization
  console.log(`\n${C.bold}Turn-by-Turn:${C.reset}`);
  for (const r of results) {
    const esc = r.result.escalated;
    const marker = esc ? `${C.yellow}■${C.reset}` : `${C.green}□${C.reset}`;
    const sizeBar = "█".repeat(Math.min(30, Math.round(r.treeSize / 5)));
    console.log(`  ${String(r.turn).padStart(2)} ${marker} tree:${C.dim}${sizeBar}${C.reset} ${r.treeSize}n`);
  }
  console.log(`  ${C.dim}${C.yellow}■${C.reset}${C.dim} = escalated   ${C.green}□${C.reset}${C.dim} = handled by BT${C.reset}`);

  // Scoring
  console.log(`\n${C.bold}Score:${C.reset}`);
  let score = 0;
  const maxScore = 50;

  const checks = [
    { name: "Tree grew", pass: finalStats.totalNodes > initialSize, points: 10 },
    { name: "Branches compiled", pass: finalStats.compiledBranches >= 3, points: 10 },
    { name: "Escalation decreased", pass: secondHalfEsc < firstHalfEsc, points: 10 },
    { name: "BT handled stress", pass: results.some(r => !r.result.escalated && r.input.includes("stress")), points: 10 },
    { name: "Final esc rate < 60%", pass: finalStats.escalationRate < 0.6, points: 10 },
  ];

  for (const c of checks) {
    if (c.pass) score += c.points;
    console.log(`  ${c.pass ? C.green + "✅" : C.red + "❌"} [${c.points}pts] ${c.name}${C.reset}`);
  }

  console.log(`\n  ${C.bold}TOTAL: ${score}/${maxScore} (${((score / maxScore) * 100).toFixed(0)}%)${C.reset}`);
  const grade = score >= 45 ? "A+" : score >= 40 ? "A" : score >= 35 ? "B+" : score >= 30 ? "B" : score >= 25 ? "C" : "F";
  console.log(`  ${C.bold}GRADE: ${grade}${C.reset}\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
