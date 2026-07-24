/**
 * Context Builder — Budget-aware context assembly.
 *
 * Assembles the most relevant context for the current interaction
 * from the person model, weighted by attention (active hypotheses,
 * current topics, and active intentions).
 *
 * Budget limits prevent context overflow:
 *   - Max tokens: configurable (default 2000)
 *   - Priority: soul > active intentions > recent messages > hypotheses > memory
 */

import type { PersonModel } from "../ecs/types.js";
import { getRecentMessages, getActiveIntentions, searchMemory } from "../ecs/person-store.js";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

export interface ContextBudget {
  maxTokens: number;
  soulTokens: number;
  intentionTokens: number;
  hypothesisTokens: number;
  memoryTokens: number;
  conversationTokens: number;
}

export const DEFAULT_BUDGET: ContextBudget = {
  maxTokens: 2000,
  soulTokens: 400,
  intentionTokens: 300,
  hypothesisTokens: 400,
  memoryTokens: 500,
  conversationTokens: 400,
};

/**
 * Build the full context window for an LLM call.
 * Assembles from soul, intentions, hypotheses, memory, and conversation.
 */
export function buildContext(
  model: PersonModel,
  soulDir: string = "./soul",
  budget: ContextBudget = DEFAULT_BUDGET,
): string {
  const sections: string[] = [];
  let tokensUsed = 0;

  // 1. Soul (identity — highest priority)
  const soulPath = join(soulDir, "SOUL.md");
  if (existsSync(soulPath)) {
    const soul = readFileSync(soulPath, "utf-8");
    const trimmed = truncateToTokens(soul, budget.soulTokens);
    sections.push(trimmed);
    tokensUsed += estimateTokens(trimmed);
  }

  // 2. Soul overlay (evolved personality)
  const overlayPath = join(soulDir, "overlay.md");
  if (existsSync(overlayPath)) {
    const overlay = readFileSync(overlayPath, "utf-8");
    const trimmed = truncateToTokens(overlay, 200);
    sections.push(`\n---\n${trimmed}`);
    tokensUsed += estimateTokens(trimmed);
  }

  // 3. Active intentions (what I'm doing for this person)
  const intentions = getActiveIntentions(model);
  if (intentions.length > 0 && tokensUsed < budget.maxTokens) {
    const intentionLines = intentions
      .slice(0, 5)
      .map(i => `- ${i.claim} (${i.status})`);
    const section = `\nI'm currently working on:\n${intentionLines.join("\n")}`;
    sections.push(truncateToTokens(section, budget.intentionTokens));
    tokensUsed += estimateTokens(section);
  }

  // 4. Top hypotheses (what I believe about this person)
  const topHyps = model.hypotheses
    .filter(h => h.confidence > 0.3)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 8);
  if (topHyps.length > 0 && tokensUsed < budget.maxTokens) {
    const hypLines = topHyps.map(h => `- [${(h.confidence * 100).toFixed(0)}%] ${h.content}`);
    const section = `\nWhat I know about this person:\n${hypLines.join("\n")}`;
    sections.push(truncateToTokens(section, budget.hypothesisTokens));
    tokensUsed += estimateTokens(section);
  }

  // 5. Relevant memories (attention-weighted)
  const topics = model.conversation.currentTopics;
  if (topics.length > 0 && tokensUsed < budget.maxTokens) {
    const memories = topics.flatMap(t => searchMemory(model, t, 3));
    const unique = [...new Map(memories.map(m => [m.id, m])).values()]
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 5);
    if (unique.length > 0) {
      const memLines = unique.map(m => `- ${m.content}`);
      const section = `\nRelevant memories:\n${memLines.join("\n")}`;
      sections.push(truncateToTokens(section, budget.memoryTokens));
      tokensUsed += estimateTokens(section);
    }
  }

  // 6. Recent conversation (for continuity)
  const recent = getRecentMessages(model, 6);
  if (recent.length > 0 && tokensUsed < budget.maxTokens) {
    const msgLines = recent.map(m => `${m.role}: ${m.content}`);
    const section = `\nRecent conversation:\n${msgLines.join("\n")}`;
    sections.push(truncateToTokens(section, budget.conversationTokens));
  }

  // 7. Current emotional state
  if (model.conversation.emotionalState !== "neutral") {
    sections.push(`\nThey currently seem: ${model.conversation.emotionalState}`);
  }

  return sections.join("\n");
}

// =============================================================================
// TOKEN ESTIMATION
// =============================================================================

/** Rough token estimate: ~4 chars per token */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Truncate text to fit within a token budget */
function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "...";
}
