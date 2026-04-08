/**
 * Prompt Evolution — The system iterates on its own instructions.
 *
 * This is the Smith pattern, made cheap:
 *   Smith: Opus rewrites its own prompts → judges them → keeps the best → expensive
 *   Psyche-BT: Flash Lite swarm generates prompt variants → benchmark judges → keeps the best → cheap
 *
 * What evolves:
 *   1. The SYSTEM INSTRUCTION that Flash Lite receives for each handler
 *   2. The STRATEGY TEMPLATES that guide how compiled strategies are presented
 *   3. The ANALYSIS PROMPT that extracts topics/entities/emotion
 *
 * How it evolves:
 *   1. Generate N variants of the current prompt (Flash Lite with different approach hints)
 *   2. Benchmark each variant against the same tasks
 *   3. Keep the variant with the best escalation rate / response quality
 *   4. Record the change for rollback if it regresses over time
 *
 * This runs as part of the nightly cycle, AFTER tree maintenance.
 * It's the system applying itself to its own meta-configuration.
 *
 * ============================================================================
 * THE KEY INSIGHT
 * ============================================================================
 *
 * The BT is a structured system instruction: "when X, do Y."
 * The prompts are UNstructured system instructions: "you are helpful, be concise."
 * Both should evolve. The BT evolves through compilation. The prompts evolve
 * through this module. Together, they cover the full instruction space.
 *
 * The BT handles WHAT to do.
 * The prompts handle HOW to do it (tone, style, persona, framing).
 *
 * Smith had this right — it just did it with Opus. We do it with a swarm.
 */

import type { PersonModel } from "../ecs/types.js";

// =============================================================================
// PROMPT REGISTRY — the system's own instructions, versioned and evolvable
// =============================================================================

export interface PromptVersion {
  id: string;
  content: string;
  /** What was changed from the previous version */
  changeSummary: string;
  /** Benchmark score when this version was active */
  benchmarkScore?: number;
  /** When this version was created */
  createdAt: number;
  /** How many interactions used this version */
  interactions: number;
}

export interface EvolvablePrompt {
  /** Which prompt this is (escalation_system, runtime_system, analysis_system, strategy_template) */
  name: string;
  /** The currently active version */
  current: PromptVersion;
  /** History of all versions (for rollback) */
  history: PromptVersion[];
  /** Best score ever achieved */
  bestScore: number;
}

/** Registry of all evolvable prompts. */
const prompts = new Map<string, EvolvablePrompt>();

// =============================================================================
// INITIALIZATION — seed with the current hardcoded prompts
// =============================================================================

/**
 * Register a prompt for evolution tracking.
 * Call once at startup with the initial prompt content.
 */
export function registerPrompt(name: string, content: string): void {
  if (prompts.has(name)) return;

  const initial: PromptVersion = {
    id: `${name}_v0`,
    content,
    changeSummary: "Initial version",
    createdAt: Date.now(),
    interactions: 0,
  };

  prompts.set(name, {
    name,
    current: initial,
    history: [initial],
    bestScore: 0,
  });
}

/**
 * Get the current version of a prompt.
 */
export function getPrompt(name: string): string {
  return prompts.get(name)?.current.content || "";
}

/**
 * Record that a prompt was used (for interaction counting).
 */
export function recordPromptUse(name: string): void {
  const prompt = prompts.get(name);
  if (prompt) prompt.current.interactions++;
}

// =============================================================================
// EVOLUTION — generate variants, judge, keep the best
// =============================================================================

/** A proposed prompt modification. */
export interface PromptVariant {
  content: string;
  changeSummary: string;
  /** Score from benchmarking (filled after evaluation) */
  score?: number;
}

/**
 * Generate N variants of a prompt by applying modification strategies.
 * These are deterministic transformations — no LLM needed for generation.
 * The LLM (or swarm) is used for EVALUATION, not generation.
 */
export function generatePromptVariants(
  name: string,
  count: number,
  model: PersonModel,
): PromptVariant[] {
  const current = getPrompt(name);
  if (!current) return [];

  const variants: PromptVariant[] = [];
  const strategies = getModificationStrategies(model);

  for (let i = 0; i < Math.min(count, strategies.length); i++) {
    const strategy = strategies[i];
    const modified = strategy.apply(current);
    if (modified !== current) {
      variants.push({
        content: modified,
        changeSummary: strategy.description,
      });
    }
  }

  return variants;
}

/**
 * Modification strategies — deterministic prompt transformations.
 * Each strategy mutates the prompt in a specific, reversible way.
 */
function getModificationStrategies(model: PersonModel): Array<{
  description: string;
  apply: (prompt: string) => string;
}> {
  const style = model.style;
  const strategies = [];

  // Strategy 1: Adjust formality based on person's style
  if (style.formality < 0.3) {
    strategies.push({
      description: "Make more casual (person prefers informal)",
      apply: (p: string) => p
        .replace(/Please /g, "")
        .replace(/I would suggest/g, "I'd say")
        .replace(/It would be beneficial/g, "It'd help"),
    });
  } else if (style.formality > 0.7) {
    strategies.push({
      description: "Make more formal (person prefers professional tone)",
      apply: (p: string) => p
        .replace(/don't/g, "do not")
        .replace(/can't/g, "cannot")
        .replace(/I'd/g, "I would"),
    });
  }

  // Strategy 2: Adjust verbosity based on message length preference
  if (style.messageLength === "terse") {
    strategies.push({
      description: "Make more concise (person prefers short messages)",
      apply: (p: string) => p + "\n\nIMPORTANT: Keep responses very brief — 1-2 sentences max.",
    });
  } else if (style.messageLength === "verbose") {
    strategies.push({
      description: "Allow longer responses (person prefers detailed messages)",
      apply: (p: string) => p + "\n\nYou can be thorough — this person appreciates detailed responses.",
    });
  }

  // Strategy 3: Add person-specific context
  if (model.hypotheses.length > 0) {
    const topHypothesis = model.hypotheses
      .sort((a, b) => b.confidence - a.confidence)[0];
    if (topHypothesis && topHypothesis.confidence > 0.7) {
      strategies.push({
        description: `Embed key knowledge: ${topHypothesis.content.slice(0, 50)}`,
        apply: (p: string) => p + `\n\nKey context about this person: ${topHypothesis.content}`,
      });
    }
  }

  // Strategy 4: Emphasize emotional awareness if person is often stressed
  const stressMemories = model.memory.filter(m =>
    m.content.toLowerCase().includes("stress") || m.topics.includes("stress")
  );
  if (stressMemories.length >= 3) {
    strategies.push({
      description: "Emphasize emotional awareness (person frequently stressed)",
      apply: (p: string) => p + "\n\nThis person is frequently under stress. Always acknowledge their emotional state before offering practical help.",
    });
  }

  // Strategy 5: Add topic expertise hints
  const topTopics = model.memory
    .flatMap(m => m.topics)
    .reduce((acc, t) => { acc.set(t, (acc.get(t) || 0) + 1); return acc; }, new Map<string, number>());

  const frequentTopics = Array.from(topTopics.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t]) => t);

  if (frequentTopics.length > 0) {
    strategies.push({
      description: `Add topic expertise for: ${frequentTopics.join(", ")}`,
      apply: (p: string) => p + `\n\nThis person frequently discusses: ${frequentTopics.join(", ")}. You should be knowledgeable and specific about these topics.`,
    });
  }

  // Strategy 6: Remove stale instructions
  strategies.push({
    description: "Strip redundant phrasing for cleaner instruction",
    apply: (p: string) => p
      .replace(/\n\n+/g, "\n\n")
      .replace(/IMPORTANT:.*?\n/g, "")
      .trim(),
  });

  return strategies;
}

// =============================================================================
// EVOLUTION CYCLE
// =============================================================================

/**
 * Evolve a prompt: generate variants, score them, keep the best.
 *
 * @param name The prompt to evolve
 * @param model The person model (used for personalization strategies)
 * @param scorer Function that benchmarks a prompt variant and returns a score (lower = better escalation)
 * @returns The best variant (or null if current is still best)
 */
export async function evolvePrompt(
  name: string,
  model: PersonModel,
  scorer: (promptContent: string) => Promise<number>,
): Promise<PromptVariant | null> {
  const evolvable = prompts.get(name);
  if (!evolvable) return null;

  // Score the current prompt
  const currentScore = await scorer(evolvable.current.content);
  evolvable.current.benchmarkScore = currentScore;

  // Generate variants
  const variants = generatePromptVariants(name, 5, model);
  if (variants.length === 0) return null;

  // Score each variant
  let bestVariant: PromptVariant | null = null;
  let bestScore = currentScore;

  for (const variant of variants) {
    const score = await scorer(variant.content);
    variant.score = score;

    if (score < bestScore) { // Lower escalation = better
      bestScore = score;
      bestVariant = variant;
    }
  }

  // If a variant is better, adopt it
  if (bestVariant) {
    const newVersion: PromptVersion = {
      id: `${name}_v${evolvable.history.length}`,
      content: bestVariant.content,
      changeSummary: bestVariant.changeSummary,
      benchmarkScore: bestVariant.score,
      createdAt: Date.now(),
      interactions: 0,
    };

    evolvable.history.push(newVersion);
    evolvable.current = newVersion;
    if (bestScore < evolvable.bestScore || evolvable.bestScore === 0) {
      evolvable.bestScore = bestScore;
    }

    return bestVariant;
  }

  return null;
}

/**
 * Rollback a prompt to its previous version (if current is regressing).
 */
export function rollbackPrompt(name: string): boolean {
  const evolvable = prompts.get(name);
  if (!evolvable || evolvable.history.length < 2) return false;

  // Remove current, revert to previous
  evolvable.history.pop();
  evolvable.current = evolvable.history[evolvable.history.length - 1];
  return true;
}

/**
 * Get evolution stats for all prompts.
 */
export function getEvolutionStats(): Array<{
  name: string;
  version: number;
  interactions: number;
  bestScore: number;
  currentScore: number | undefined;
}> {
  return Array.from(prompts.values()).map(p => ({
    name: p.name,
    version: p.history.length - 1,
    interactions: p.current.interactions,
    bestScore: p.bestScore,
    currentScore: p.current.benchmarkScore,
  }));
}
