/**
 * LLM Model Configuration
 *
 * Two-tier model hierarchy — quality over cost:
 * - gemini-3.1-pro-preview: Code generation, system design, structured output, all engineering tasks
 * - gemini-3-flash-preview: Agent cognition, daemon whispers, fast reactive tasks
 *
 * Everything that matters (design, code, review, planning) runs on 3.1 Pro.
 * Flash is only for high-frequency low-stakes tasks (agent tick cognition, daemon monitoring).
 */

import { google } from "@ai-sdk/google";

// =============================================================================
// MODEL DEFINITIONS
// =============================================================================

/**
 * Gemini 3.1 Pro Preview — primary workhorse model.
 * Better thinking, improved token efficiency, grounded factual output.
 * Optimized for software engineering and agentic workflows.
 * Used for: planning, design, code generation, system baking, review, spirits.
 */
export const codeModel = google("gemini-3.1-pro-preview");

/**
 * Gemini 3 Flash Preview — fast reactive model.
 * Used for: agent cognition ticks, daemon whispers, autonomous goals.
 */
export const flashModel = google("gemini-3-flash-preview");

/**
 * Gemini 3.1 Flash-Lite — ultra-fast, ultra-cheap rendering model.
 * $0.25/1M input, $1.50/1M output. 2.5x faster than Flash.
 * Used for: LIL world rendering, intent parsing, ambient narration,
 * speech impact analysis — any high-frequency text-in/text-out task.
 */
export const flashLiteModel = google("gemini-3.1-flash-lite-preview");

// Keep proModel as alias to codeModel — 3.1 Pro supersedes 3.0 Pro
export const proModel = codeModel;

// =============================================================================
// SEMANTIC ALIASES
// =============================================================================

/** For GodAI planning and world design - uses 3.1 Pro */
export const plannerModel = codeModel;

/** For GodAI execution and implementation - uses 3.1 Pro */
export const executorModel = codeModel;

/** For agent thinking and decision-making - uses Flash */
export const agentModel = flashModel;

/** For spirit observations and reports - uses 3.1 Pro */
export const spiritModel = codeModel;

/** For daemon whispers and monitoring - uses Flash */
export const daemonModel = flashModel;

/** For LIL rendering layer — world snapshots to prose, high frequency */
export const renderModel = flashLiteModel;

/** For LIL intent parsing — player input to actions, high frequency */
export const intentModel = flashLiteModel;

/** For speech impact analysis — tone/gossip detection, high frequency */
export const speechAnalysisModel = flashLiteModel;

/** For narrative generation - uses 3.1 Pro */
export const narrativeModel = codeModel;

/** For system code generation - uses 3.1 Pro */
export const systemBakerModel = codeModel;

/** Default model for general use - uses 3.1 Pro */
export const defaultModel = codeModel;

/** Reasoning model for complex analysis - uses 3.1 Pro */
export const reasoningModel = codeModel;

// =============================================================================
// THINKING LEVELS
// =============================================================================

/**
 * Thinking levels control how much internal reasoning the model does.
 * 3.1 Pro supports: 'low', 'high'
 * Flash supports: 'minimal', 'low', 'medium', 'high'
 *
 * For R&D: run everything at high thinking. Quality over speed.
 */
export const THINKING_LEVELS = {
  /** For main design/planning phases */
  PLANNER: 'high' as const,
  /** For review phases */
  REVIEW: 'high' as const,
  /** For code generation */
  EXECUTOR: 'high' as const,
  /** For agent cognition */
  AGENT: 'medium' as const,
  /** For daemon observations */
  DAEMON: 'low' as const,
  /** For spirit analysis */
  SPIRIT: 'high' as const,
  /** For LIL rendering (speed is king) */
  RENDER: 'low' as const,
  /** For intent parsing (speed + accuracy) */
  INTENT: 'low' as const,
} as const;

// =============================================================================
// MODEL INFO FOR LOGGING
// =============================================================================

export const MODEL_INFO = {
  code: {
    name: "gemini-3.1-pro-preview",
    purpose: "Primary — planning, design, code generation, spirits, review, story scaffold",
  },
  flash: {
    name: "gemini-3-flash-preview",
    purpose: "Reactive — agent cognition, daemon monitoring, autonomous goals",
  },
  flashLite: {
    name: "gemini-3.1-flash-lite-preview",
    purpose: "Rendering — LIL world renderer, intent parser, speech analysis, ambient narration",
  },
} as const;

/**
 * Log the current model configuration
 */
export function logModelConfig(): void {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  LLM MODEL CONFIGURATION                                     ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log(`║  Primary:  ${MODEL_INFO.code.name.padEnd(38)}        ║`);
  console.log(`║  Fast:     ${MODEL_INFO.flash.name.padEnd(38)}      ║`);
  console.log("╚══════════════════════════════════════════════════════════════╝");
}
