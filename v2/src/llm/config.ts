/**
 * LLM Model Configuration
 *
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️  CRITICAL: DO NOT CHANGE THESE MODEL SETTINGS  ⚠️                        ║
 * ║                                                                              ║
 * ║  These models are specifically chosen for optimal quality and performance.   ║
 * ║  Changing them WILL SERIOUSLY DEGRADE the simulation quality.               ║
 * ║                                                                              ║
 * ║  - gemini-3-pro-preview: Deep reasoning, planning, world design             ║
 * ║  - gemini-3-flash-preview: Fast execution, agent cognition, daemons         ║
 * ║                                                                              ║
 * ║  If you need to change models for testing, create a separate test file.     ║
 * ║  NEVER commit changes to this file that modify the model versions.          ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 */

import { google } from "@ai-sdk/google";

// =============================================================================
// LOCKED MODEL DEFINITIONS - DO NOT MODIFY
// =============================================================================

/**
 * Pro model for deep reasoning tasks:
 * - World design and architecture
 * - Complex planning
 * - System design review
 * - GodAI high-level decisions
 *
 * @readonly DO NOT CHANGE THIS MODEL
 */
export const proModel = google("gemini-3-pro-preview");

/**
 * Flash model for fast execution tasks:
 * - Agent cognition and decision-making
 * - Spirit observations
 * - Daemon whispers
 * - Quick responses
 *
 * @readonly DO NOT CHANGE THIS MODEL
 */
export const flashModel = google("gemini-3-flash-preview");

// =============================================================================
// SEMANTIC ALIASES - Use these in your code
// =============================================================================

/** For GodAI planning and world design - uses Pro */
export const plannerModel = proModel;

/** For GodAI execution and implementation - uses Flash */
export const executorModel = flashModel;

/** For agent thinking and decision-making - uses Flash */
export const agentModel = flashModel;

/** For spirit observations and reports - uses Flash */
export const spiritModel = flashModel;

/** For daemon whispers and monitoring - uses Flash */
export const daemonModel = flashModel;

/** For narrative generation - uses Flash */
export const narrativeModel = flashModel;

/** For system code generation - uses Flash */
export const systemBakerModel = flashModel;

/** Default model for general use - uses Flash */
export const defaultModel = flashModel;

/** Reasoning model for complex analysis - uses Pro */
export const reasoningModel = proModel;

// =============================================================================
// THINKING LEVELS FOR GEMINI 3 MODELS
// =============================================================================

/**
 * Thinking levels control how much internal reasoning the model does.
 * Pro supports: 'low', 'high'
 * Flash supports: 'minimal', 'low', 'medium', 'high'
 */
export const THINKING_LEVELS = {
  /** For main design/planning phases */
  PLANNER: 'high' as const,
  /** For review phases */
  REVIEW: 'low' as const,
  /** For code generation */
  EXECUTOR: 'medium' as const,
  /** For agent cognition */
  AGENT: 'low' as const,
  /** For daemon observations */
  DAEMON: 'minimal' as const,
  /** For spirit analysis */
  SPIRIT: 'low' as const,
} as const;

// =============================================================================
// MODEL INFO FOR LOGGING
// =============================================================================

export const MODEL_INFO = {
  pro: {
    name: "gemini-3-pro-preview",
    purpose: "Deep reasoning, planning, world design",
    cost: "high",
  },
  flash: {
    name: "gemini-3-flash-preview",
    purpose: "Fast execution, agent cognition, daemons",
    cost: "low",
  },
} as const;

/**
 * Log the current model configuration
 */
export function logModelConfig(): void {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  LLM MODEL CONFIGURATION (LOCKED)                            ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log(`║  Pro Model:   ${MODEL_INFO.pro.name.padEnd(35)}        ║`);
  console.log(`║  Flash Model: ${MODEL_INFO.flash.name.padEnd(35)}      ║`);
  console.log("╚══════════════════════════════════════════════════════════════╝");
}
