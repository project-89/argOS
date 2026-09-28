/**
 * Behavior Tree Types — The decision structure that makes cheap models smart.
 */

// =============================================================================
// NODE TYPES
// =============================================================================

export type BehaviorNode =
  // Control flow
  | { type: "selector"; children: BehaviorNode[] }
  | { type: "sequence"; children: BehaviorNode[] }
  | { type: "weighted_random"; choices: Array<{ weight: number; child: BehaviorNode }> }

  // Conditions (check ECS person model)
  | { type: "condition"; op: ConditionOp }

  // Actions
  | { type: "action"; action: AgentAction }
  | { type: "template_response"; template: string; variables: string[] }
  | { type: "strategy"; strategy: ResponseStrategy }
  | { type: "skill"; name: string }

  // Plans (multi-step tool sequences with variable binding)
  | { type: "plan"; plan: CompiledPlan }

  // Escalation
  | { type: "llm_escalate" }

  // No-op
  | { type: "noop" };

// =============================================================================
// CONDITIONS — all resolve against the ECS person model
// =============================================================================

export type ConditionOp =
  // Hypothesis checks
  | { type: "hypothesis_above"; domain: string; confidence: number }
  | { type: "hypothesis_below"; domain: string; confidence: number }
  | { type: "has_hypothesis"; includes: string }

  // Conversation state
  | { type: "person_topic"; topic: string }
  | { type: "person_state"; state: string }
  | { type: "message_is_question" }
  | { type: "message_includes"; includes: string }
  | { type: "last_n_messages_include"; n: number; includes: string }
  | { type: "conversation_depth_above"; turns: number }

  // Memory
  | { type: "memory_contains"; query: string }
  | { type: "entity_known"; name: string }
  | { type: "entity_mentioned" }

  // Intentions
  | { type: "intention_active"; domain: string }
  | { type: "intention_blocked" }

  // Predictions
  | { type: "prediction_pending"; domain: string }
  | { type: "prediction_accuracy_above"; domain: string; threshold: number }

  // Style
  | { type: "style_is"; style: string }

  // Temporal
  | { type: "time_is"; period: string }
  | { type: "days_since_last_contact"; min: number }
  | { type: "session_length_above"; minutes: number }

  // Meta
  | { type: "always" }
  | { type: "chance"; p: number };

// =============================================================================
// ACTIONS — what the agent does
// =============================================================================

export interface AgentAction {
  type: "respond" | "ask" | "remember" | "tool_call" | "set_topic" | "set_emotion" | "wait";
  content?: string;
  target?: string;
  params?: Record<string, any>;
}

// =============================================================================
// EVALUATION RESULT
// =============================================================================

/**
 * Response Strategy — compiled from big model reasoning.
 * NOT a fixed template — a DIRECTION that Flash Lite generates from fresh each time.
 * The strategy captures WHAT to do. Flash Lite varies HOW.
 */
export interface ResponseStrategy {
  /** What the response should accomplish */
  intent: string;
  /** How to approach it */
  approach: string;
  /** ECS data to include in the context */
  contextKeys: string[];
  /** Tone guidance */
  tone: string;
  /** The original response (for reference, NOT for copying) */
  exampleResponse?: string;
}

// =============================================================================
// COMPILED PLANS — multi-step tool sequences with variable binding
// =============================================================================

/**
 * A compiled plan — a replayable multi-step procedure.
 *
 * Compiled from a successful sequence of tool calls. Each step can reference
 * outputs from previous steps via variable binding ({step_N_output}).
 * Flash Lite fills in step-level details from context; the structure is fixed.
 *
 * Example: "prepare a presentation"
 *   Step 1: read_file({notes_path}) → {notes}
 *   Step 2: draft(type: "outline", context: {notes}) → {outline}
 *   Step 3: make_checklist(items: {outline}) → {checklist}
 *   Success: checklist created
 */
export interface CompiledPlan {
  /** Human-readable goal this plan accomplishes */
  goal: string;
  /** The steps to execute in order */
  steps: PlanStep[];
  /** What "success" looks like — checked after all steps complete */
  successCondition: PlanSuccessCondition;
  /** Strategy guidance for Flash Lite when filling step details */
  strategy: string;
  /** Original context that produced this plan (for reference) */
  sourceContext?: string;
}

/** A single step in a compiled plan. */
export interface PlanStep {
  /** Step ID (for variable binding references) */
  id: string;
  /** What this step does (human-readable, for Flash Lite context) */
  description: string;
  /** The action to execute */
  action: PlanStepAction;
  /** Variable bindings: output of this step stored as {step_id.field} */
  outputBinding?: string;
  /** Condition to check after execution (optional — skips to next if absent) */
  successCheck?: PlanStepCheck;
  /** What to do if this step fails */
  onFailure: "skip" | "abort" | "retry" | "escalate";
}

/** What a plan step actually does. */
export type PlanStepAction =
  | {
      /** Call a registered tool */
      type: "tool_call";
      tool: string;
      /** Params can reference prior step outputs: "{step_1.output}" */
      params: Record<string, string>;
    }
  | {
      /** Generate content via Flash Lite using a strategy prompt */
      type: "generate";
      prompt: string;
      /** Context keys from ECS to include */
      contextKeys: string[];
    }
  | {
      /** Send a message to the user (progress update, question, delivery) */
      type: "respond";
      template: string;
    }
  | {
      /** Invoke another compiled plan by name (composition) */
      type: "sub_plan";
      planName: string;
      /** Params passed to the sub-plan (can reference prior step outputs) */
      params: Record<string, string>;
    };

/** Check whether a plan step succeeded. */
export interface PlanStepCheck {
  type: "output_contains" | "output_not_empty" | "tool_success" | "always_pass";
  value?: string;
}

/** Check whether the overall plan succeeded. */
export interface PlanSuccessCondition {
  type: "all_steps_pass" | "last_step_pass" | "output_exists";
  /** Which step's output to check (for output_exists) */
  stepId?: string;
}

// =============================================================================
// EVALUATION RESULTS
// =============================================================================

export type EvalResult =
  | { kind: "action"; action: AgentAction; trace: string[] }
  | { kind: "template"; template: string; variables: string[]; trace: string[] }
  | { kind: "strategy"; strategy: ResponseStrategy; trace: string[] }
  | { kind: "plan"; plan: CompiledPlan; trace: string[] }
  | { kind: "skill"; name: string; trace: string[] }
  | { kind: "escalate"; trace: string[] }
  | { kind: "none"; trace: string[] };

// =============================================================================
// COMPILED BRANCH METADATA
// =============================================================================

export interface CompiledBranch {
  id: string;
  node: BehaviorNode;
  compiledAt: number;
  lastUsed: number;
  successCount: number;
  failCount: number;
  source: "compiler" | "teacher" | "species";
}
