/**
 * BT Compiler — Captures successful LLM decisions as permanent BT branches.
 *
 * When the BT escalates and the larger model handles it successfully,
 * the compiler extracts: what conditions triggered → what action worked
 * → creates a new BT branch so Flash Lite handles it next time.
 *
 * This is the System 2 → System 1 compilation step.
 */

import type { BehaviorNode, ConditionOp, AgentAction, CompiledBranch } from "../bt/types.js";
import type { PersonModel } from "../ecs/types.js";
import { insertBranch, countNodes } from "../bt/evaluator.js";
import {
  evaluateCompilationCandidate,
  isNegativeFeedback,
  type CompilationDecision,
} from "./immune-system.js";

// =============================================================================
// CAPTURED DECISION — snapshot of what the LLM decided and why
// =============================================================================

export interface CapturedDecision {
  /** The user message that triggered escalation */
  userMessage: string;
  /** The LLM's inner reasoning */
  reasoning: string;
  /** The action the LLM chose */
  action: AgentAction;
  /** Detected topics at time of decision */
  topics: string[];
  /** Detected emotional state at time of decision */
  emotionalState: string;
  /** Whether this decision was rated as successful */
  success?: boolean;
}

// =============================================================================
// PENDING CAPTURES — decisions waiting for success/failure signal
// =============================================================================

let pendingCapture: CapturedDecision | null = null;

/** Capture an LLM decision for potential compilation. */
export function captureDecision(decision: CapturedDecision): void {
  pendingCapture = decision;
}

/**
 * Mark the pending decision as successful and compile it into a BT branch.
 * Now with immune system checks: quality gating, negative sentiment guard,
 * and condition specificity requirements.
 *
 * @param userFollowUp The user's follow-up message (for sentiment analysis)
 */
export function resolveDecisionSuccess(model: PersonModel, userFollowUp?: string): CompiledBranch | null {
  if (!pendingCapture) return null;
  const decision = pendingCapture;
  pendingCapture = null;

  // Immune system check: negative feedback guard
  if (userFollowUp && isNegativeFeedback(userFollowUp)) {
    lastCompilationDecision = {
      shouldCompile: false,
      reason: "Negative feedback detected",
    };
    return null;
  }

  // Build the conditions that would be compiled
  const conditions = buildConditions(decision);

  // Immune system: comprehensive compilation check
  const immuneCheck = evaluateCompilationCandidate(
    decision,
    userFollowUp || "",
    conditions.map(c => (c as any).op).filter(Boolean),
  );

  lastCompilationDecision = immuneCheck;

  if (!immuneCheck.shouldCompile) {
    return null;
  }

  decision.success = true;
  return compileToBranch(decision, model);
}

/** Last compilation decision (for debugging/testing) */
let lastCompilationDecision: CompilationDecision | null = null;

export function getLastCompilationDecision(): CompilationDecision | null {
  return lastCompilationDecision;
}

/** Mark the pending decision as failed — don't compile. */
export function resolveDecisionFailure(): void {
  pendingCapture = null;
}

/** Check if there's a pending capture waiting for resolution. */
export function hasPendingCapture(): boolean {
  return pendingCapture !== null;
}

// =============================================================================
// BRANCH COMPILATION
// =============================================================================

/**
 * Compile a successful LLM decision into a BT branch.
 *
 * Extracts conditions from the decision context and creates a
 * sequence node: [conditions...] → action/template.
 */
/** Build conditions from a decision context (extracted for immune system pre-check). */
function buildConditions(decision: CapturedDecision): BehaviorNode[] {
  const conditions: BehaviorNode[] = [];

  for (const topic of decision.topics.slice(0, 2)) {
    conditions.push({ type: "condition", op: { type: "person_topic", topic } });
  }

  if (decision.emotionalState && decision.emotionalState !== "neutral") {
    conditions.push({ type: "condition", op: { type: "person_state", state: decision.emotionalState } });
  }

  // No chance node — ε-greedy exploration handles variety.
  // Compiled branches should fire deterministically when conditions match.

  return conditions;
}

function compileToBranch(decision: CapturedDecision, model: PersonModel): CompiledBranch {
  const conditions = buildConditions(decision);

  // Create the action node — compile as STRATEGY, not template.
  // The strategy captures WHAT to do. Flash Lite generates HOW fresh each time.
  let actionNode: BehaviorNode;
  if (decision.action.type === "respond" && decision.action.content) {
    // Extract the intent and approach from the LLM's reasoning
    const intent = extractIntent(decision.reasoning, decision.topics);
    const tone = decision.emotionalState === "stressed" ? "supportive, practical"
               : decision.emotionalState === "excited" ? "enthusiastic, matching their energy"
               : decision.emotionalState === "frustrated" ? "validating, then problem-solving"
               : "warm, attentive";

    actionNode = {
      type: "strategy",
      strategy: {
        intent,
        approach: decision.reasoning.slice(0, 150) || "respond helpfully to their message",
        contextKeys: [
          ...decision.topics.map(t => `topic:${t}`),
          "recent_messages",
          "emotional_state",
        ],
        tone,
        exampleResponse: decision.action.content,
      },
    };
  } else if (decision.action.type === "tool_call") {
    // Tool calls compile as direct actions (deterministic, no LLM needed)
    actionNode = { type: "action", action: decision.action };
  } else {
    actionNode = { type: "action", action: decision.action };
  }

  // 5. Build the branch: sequence of conditions → action
  const branch: BehaviorNode = conditions.length > 0
    ? { type: "sequence", children: [...conditions, actionNode] }
    : actionNode;

  const compiled: CompiledBranch = {
    id: `branch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    node: branch,
    compiledAt: Date.now(),
    lastUsed: Date.now(),
    successCount: 1,
    failCount: 0,
    source: "compiler",
  };

  return compiled;
}

// =============================================================================
// TREE GROWTH — insert compiled branches into the behavior tree
// =============================================================================

/**
 * Insert a compiled branch into the person's behavior tree.
 * Updates the policy state.
 */
export function growTree(model: PersonModel, branch: CompiledBranch): void {
  if (!model.policy.tree) return;

  model.policy.tree = insertBranch(model.policy.tree, branch.node);
  model.policy.compiledBranches++;
  model.policy.totalNodes = countNodes(model.policy.tree);
  model.policy.lastCompiled = Date.now();
  model.policy.version++;
}

// =============================================================================
// STATS
// =============================================================================

export interface CompilerStats {
  compiledBranches: number;
  totalNodes: number;
  version: number;
  escalationRate: number;
}

/**
 * Extract the intent from LLM reasoning.
 * Turns "User is anxious about their gallery deadline, they need reassurance"
 * into "acknowledge_stress_and_offer_specific_help"
 */
function extractIntent(reasoning: string, topics: string[]): string {
  const r = reasoning.toLowerCase();
  const parts: string[] = [];

  // Detect intent components
  if (r.includes("stress") || r.includes("anxious") || r.includes("worried")) parts.push("acknowledge_stress");
  else if (r.includes("excit") || r.includes("happy") || r.includes("great")) parts.push("match_excitement");
  else if (r.includes("frustrat") || r.includes("angry")) parts.push("validate_frustration");
  else if (r.includes("help") || r.includes("assist") || r.includes("support")) parts.push("offer_help");
  else if (r.includes("question") || r.includes("ask") || r.includes("curious")) parts.push("answer_question");
  else parts.push("respond");

  if (r.includes("specific") || r.includes("concrete") || r.includes("practical")) parts.push("with_specifics");
  if (r.includes("deadline") || r.includes("timeline") || r.includes("schedule")) parts.push("re_deadline");
  if (topics.length > 0) parts.push(`about_${topics[0]}`);

  return parts.join("_");
}

export function getCompilerStats(model: PersonModel): CompilerStats {
  const total = model.totalEscalations + model.totalBTHandled;
  return {
    compiledBranches: model.policy.compiledBranches,
    totalNodes: model.policy.totalNodes,
    version: model.policy.version,
    escalationRate: total > 0 ? model.totalEscalations / total : 1.0,
  };
}
