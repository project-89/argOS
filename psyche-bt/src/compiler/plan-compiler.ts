/**
 * Plan Compiler — Captures successful multi-step tool sequences as replayable plans.
 *
 * When an agent (expensive model or Flash Lite) executes a sequence of tool calls
 * that successfully accomplishes a goal, this compiler:
 *   1. Captures the trace: which tools were called, in what order, with what params
 *   2. Extracts variable bindings: how outputs flowed between steps
 *   3. Generalizes the trace: replaces specific values with context references
 *   4. Wraps in conditions: when should this plan activate?
 *   5. Produces a CompiledBranch with a plan node
 *
 * The compiled plan is a RECIPE, not a recording. It captures the structure
 * and strategy, not the specific values. Flash Lite fills in specifics each time.
 *
 * Example:
 *   Trace: [read_file("notes.txt") → draft(outline, notes_content) → make_checklist(outline)]
 *   Compiled: plan { steps: [read → draft → checklist], bindings: [1→2, 2→3] }
 *   Replay: Flash Lite fills "{notes_path}" from context, executes same structure
 */

import type {
  BehaviorNode, ConditionOp, CompiledBranch,
  CompiledPlan, PlanStep, PlanStepAction, PlanStepCheck, PlanSuccessCondition,
} from "../bt/types.js";
import type { PersonModel } from "../ecs/types.js";
import { insertBranch, countNodes } from "../bt/evaluator.js";
import { addSkill } from "../ecs/person-store.js";
import { evaluateCompilationCandidate } from "./immune-system.js";

// =============================================================================
// TRACE CAPTURE — record what happened during a multi-step interaction
// =============================================================================

/** A single recorded step from an actual execution. */
export interface TracedStep {
  /** Tool name or action type */
  tool: string;
  /** Parameters that were passed */
  params: Record<string, any>;
  /** What the tool returned */
  output: string;
  /** Did it succeed? */
  success: boolean;
  /** Description of what this step did (from the reasoning model) */
  description?: string;
}

/** A complete trace of a multi-step interaction. */
export interface ExecutionTrace {
  /** The user's original request/goal */
  goal: string;
  /** What topics were active */
  topics: string[];
  /** Emotional context */
  emotionalState: string;
  /** The reasoning that produced this plan */
  reasoning: string;
  /** The steps that were executed */
  steps: TracedStep[];
  /** Did the overall interaction succeed? */
  success: boolean;
  /** User's follow-up (for sentiment check) */
  userFollowUp?: string;
}

// =============================================================================
// TRACE RECORDING — accumulate steps during a conversation
// =============================================================================

let activeTrace: Partial<ExecutionTrace> | null = null;
let traceSteps: TracedStep[] = [];

/**
 * Start recording a new execution trace.
 * Called when an escalation begins a multi-step response.
 */
export function beginTrace(goal: string, reasoning: string, topics: string[], emotionalState: string): void {
  activeTrace = { goal, reasoning, topics, emotionalState };
  traceSteps = [];
}

/**
 * Record a tool call step in the active trace.
 * Called each time a tool executes during the traced interaction.
 */
export function recordStep(step: TracedStep): void {
  if (!activeTrace) return;
  traceSteps.push(step);
}

/**
 * Complete the active trace with a success/failure signal.
 * Returns the full trace for compilation.
 */
export function completeTrace(success: boolean, userFollowUp?: string): ExecutionTrace | null {
  if (!activeTrace || traceSteps.length === 0) {
    activeTrace = null;
    traceSteps = [];
    return null;
  }

  const trace: ExecutionTrace = {
    goal: activeTrace.goal || "unknown goal",
    topics: activeTrace.topics || [],
    emotionalState: activeTrace.emotionalState || "neutral",
    reasoning: activeTrace.reasoning || "",
    steps: [...traceSteps],
    success,
    userFollowUp,
  };

  activeTrace = null;
  traceSteps = [];
  return trace;
}

/**
 * Discard the active trace without compiling.
 */
export function discardTrace(): void {
  activeTrace = null;
  traceSteps = [];
}

/**
 * Check if there's an active trace being recorded.
 */
export function hasActiveTrace(): boolean {
  return activeTrace !== null && traceSteps.length > 0;
}

// =============================================================================
// PLAN COMPILATION — convert a trace into a replayable plan
// =============================================================================

/**
 * Compile a successful execution trace into a plan branch.
 *
 * Returns null if:
 *   - Trace didn't succeed
 *   - Trace has < 2 steps (single tool calls compile as regular actions)
 *   - Immune system rejects it (quality/specificity)
 */
export function compilePlan(trace: ExecutionTrace, model: PersonModel): CompiledBranch | null {
  if (!trace.success) return null;
  if (trace.steps.length < 2) return null;

  // Build conditions from trace context
  const conditions = buildPlanConditions(trace);
  const conditionOps = conditions.map(c => (c as any).op).filter(Boolean);

  // Immune system check (reuse existing quality infrastructure)
  const immuneCheck = evaluateCompilationCandidate(
    {
      userMessage: trace.goal,
      reasoning: trace.reasoning,
      action: { type: "respond", content: trace.steps.map(s => s.description || s.tool).join(" → ") },
      topics: trace.topics,
      emotionalState: trace.emotionalState,
    },
    trace.userFollowUp || "",
    conditionOps,
  );

  if (!immuneCheck.shouldCompile) return null;

  // Compile the plan
  const plan = traceToPlan(trace);
  const planNode: BehaviorNode = { type: "plan", plan };

  // Wrap in conditions
  const branch: BehaviorNode = conditions.length > 0
    ? { type: "sequence", children: [...conditions, planNode] }
    : planNode;

  return {
    id: `plan_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    node: branch,
    compiledAt: Date.now(),
    lastUsed: Date.now(),
    successCount: 1,
    failCount: 0,
    source: "compiler",
  };
}

/**
 * Convert a trace into a CompiledPlan.
 * Generalizes specific values into variable references.
 */
function traceToPlan(trace: ExecutionTrace): CompiledPlan {
  const steps: PlanStep[] = [];

  for (let i = 0; i < trace.steps.length; i++) {
    const traced = trace.steps[i];
    const stepId = `step_${i}`;

    // Generalize params: replace specific outputs with variable references
    const generalizedParams = generalizeParams(traced.params, steps, trace);

    let action: PlanStepAction;
    if (traced.tool === "__generate__") {
      // Generation step (Flash Lite fills content)
      action = {
        type: "generate",
        prompt: traced.description || `Generate content for: ${trace.goal}`,
        contextKeys: trace.topics.map(t => `topic:${t}`),
      };
    } else if (traced.tool === "__respond__") {
      // Response step (message to user)
      action = {
        type: "respond",
        template: traced.output || traced.description || "Here's what I found.",
      };
    } else {
      // Tool call step
      action = {
        type: "tool_call",
        tool: traced.tool,
        params: generalizedParams,
      };
    }

    const step: PlanStep = {
      id: stepId,
      description: traced.description || `${traced.tool}(${Object.keys(traced.params).join(", ")})`,
      action,
      outputBinding: traced.output ? stepId : undefined,
      successCheck: traced.success
        ? { type: "tool_success" }
        : { type: "always_pass" },
      onFailure: i === trace.steps.length - 1 ? "abort" : "skip",
    };

    steps.push(step);
  }

  return {
    goal: trace.goal,
    steps,
    successCondition: { type: "last_step_pass" },
    strategy: trace.reasoning.slice(0, 200),
    sourceContext: trace.topics.join(", "),
  };
}

/**
 * Generalize specific parameter values into variable references.
 *
 * If a param value matches a previous step's output, replace with {step_N}.
 * If a param value matches a topic or entity, replace with {topic} or {entity}.
 */
function generalizeParams(
  params: Record<string, any>,
  priorSteps: PlanStep[],
  trace: ExecutionTrace,
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(params)) {
    const strValue = String(value);

    // Check if this value came from a prior step's output
    let bound = false;
    for (const prior of priorSteps) {
      if (prior.outputBinding && strValue.includes(prior.id)) {
        result[key] = `{${prior.id}}`;
        bound = true;
        break;
      }
    }

    if (!bound) {
      // Check if it's a topic reference
      for (const topic of trace.topics) {
        if (strValue.toLowerCase().includes(topic.toLowerCase())) {
          result[key] = `{topic:${topic}}`;
          bound = true;
          break;
        }
      }
    }

    if (!bound) {
      // Keep as a strategy hint (Flash Lite will fill from context)
      result[key] = strValue.length > 50 ? `{context:${key}}` : strValue;
    }
  }

  return result;
}

/**
 * Build BT conditions for when this plan should activate.
 */
function buildPlanConditions(trace: ExecutionTrace): BehaviorNode[] {
  const conditions: BehaviorNode[] = [];

  // Topic conditions
  for (const topic of trace.topics.slice(0, 2)) {
    conditions.push({ type: "condition", op: { type: "person_topic", topic } });
  }

  // Emotional state (if not neutral)
  if (trace.emotionalState && trace.emotionalState !== "neutral") {
    conditions.push({
      type: "condition",
      op: { type: "person_state", state: trace.emotionalState },
    });
  }

  // Goal-like patterns in the message
  if (/help|make|create|draft|prepare|plan|organize/i.test(trace.goal)) {
    conditions.push({
      type: "condition",
      op: { type: "message_includes", includes: extractGoalKeyword(trace.goal) },
    });
  }

  return conditions;
}

/**
 * Extract the key action verb from a goal statement.
 */
function extractGoalKeyword(goal: string): string {
  const match = goal.match(/\b(help|make|create|draft|prepare|plan|organize|write|read|summarize|checklist|email|schedule)\b/i);
  return match ? match[1].toLowerCase() : "help";
}

// =============================================================================
// TREE GROWTH — insert compiled plans into the person's BT
// =============================================================================

/**
 * Insert a compiled plan branch into the person's behavior tree.
 * Plans are inserted at the FRONT of the selector (before bootstrap),
 * because they have the most specific conditions and should take priority.
 */
export function growTreeWithPlan(model: PersonModel, branch: CompiledBranch): void {
  if (!model.policy.tree || model.policy.tree.type !== "selector") return;

  // Insert at position 0 — plans are highest priority
  const newChildren = [branch.node, ...model.policy.tree.children];
  model.policy.tree = { ...model.policy.tree, children: newChildren };

  model.policy.compiledBranches++;
  model.policy.totalNodes = countNodes(model.policy.tree);
  model.policy.lastCompiled = Date.now();
  model.policy.version++;
}

/**
 * Register a compiled plan as a named skill so other plans can compose with it.
 * This is the COMPOSITION mechanism: plans reference other plans by name.
 *
 * Level 1: gather_notes = [file_read → summarize]
 * Level 2: prepare_presentation = [sub_plan("gather_notes") → draft → checklist]
 */
export function registerPlanAsSkill(
  model: PersonModel,
  name: string,
  plan: CompiledPlan,
  description: string,
): void {
  addSkill(model, {
    name,
    description,
    tree: { type: "plan", plan },
    origin: "compiled",
    successRate: 1.0,
    uses: 1,
    compiledAt: Date.now(),
    lastUsed: Date.now(),
  });
}

/**
 * Compose multiple named plans into a higher-level plan.
 * The composed plan executes sub-plans in sequence, binding outputs between them.
 *
 * @param name Name for the composed plan
 * @param goal What this composed plan accomplishes
 * @param subPlanNames Names of plans to compose (in execution order)
 * @param strategy High-level description of the approach
 */
export function composePlans(
  name: string,
  goal: string,
  subPlanNames: string[],
  strategy: string,
): CompiledPlan {
  const steps: import("../bt/types.js").PlanStep[] = subPlanNames.map((planName, i) => ({
    id: `composed_${i}`,
    description: `Execute sub-plan: ${planName}`,
    action: {
      type: "sub_plan" as const,
      planName,
      params: i > 0 ? { context: `{composed_${i - 1}}` } : {} as Record<string, string>,
    },
    outputBinding: `composed_${i}`,
    successCheck: { type: "output_not_empty" as const },
    onFailure: "abort" as const,
  }));

  return {
    goal,
    steps,
    successCondition: { type: "last_step_pass" },
    strategy,
  };
}
