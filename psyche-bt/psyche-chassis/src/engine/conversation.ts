/**
 * Conversation Engine — The main interaction loop (Psyche Chassis).
 *
 * Extended from reasoning-tree with cognition module integration:
 *   1. Analyze message (topics, entities, emotional state)
 *   2. Run observation patterns (BT-native hypothesis updates)
 *   3. Evaluate behavior tree against person model
 *   4a. If BT handles it → fill template via Flash Lite → respond
 *   4b. If BT escalates → reason via Flash → respond → compile pattern
 *   5. Post-turn cognition: hypothesis update, intention check, reflection
 *   6. Update person model, track branch health
 *   7. Heartbeat activity recording
 */

import type { PersonModel, Message } from "../ecs/types.js";
import type { EvalResult, AgentAction, CompiledPlan, PlanStep, PlanStepCheck, PlanStepAction } from "../bt/types.js";
import { evaluateBT } from "../bt/evaluator.js";
import { fillTemplate } from "../bt/templates.js";
import {
  addMessage, setEmotionalState, setCurrentTopics,
  addEntity, addMemory, searchMemory, getRecentMessages,
  getActiveIntentions, getSkill,
} from "../ecs/person-store.js";
import {
  captureDecision, resolveDecisionSuccess, growTree, hasPendingCapture,
  type CompilerContext,
} from "../compiler/bt-compiler.js";
import {
  beginTrace, recordStep, completeTrace, hasActiveTrace,
  compilePlan, growTreeWithPlan,
  type TraceContext,
} from "../compiler/plan-compiler.js";
import { shouldExplore } from "../compiler/immune-system.js";
import { executeTool, getTool } from "../tools/registry.js";
import { recordBranchExecution, fingerprintBranch } from "../compiler/tree-maintenance.js";
import {
  executeRuntimeSwarm, setSwarmHandler,
  type RuntimeSwarmResult, type SwarmInstanceHandler,
  DEFAULT_RUNTIME_SWARM_CONFIG,
} from "../swarm/runtime-swarm.js";
import { updateHypothesis } from "../cognition/hypothesis-bt.js";
import { generateIntention, type IntentionType } from "../cognition/intention-bt.js";
import { quickReflection, recordPredictionOutcome } from "../cognition/metacognition.js";
import { recordActivity } from "../cognition/heartbeat.js";

// =============================================================================
// TYPES
// =============================================================================

export interface TurnResult {
  response: string;
  source: "bt" | "escalation" | "template" | "tool" | "plan" | "swarm";
  escalated: boolean;
  btTrace: string[];
  compiledBranch: boolean;
  toolUsed?: string;
  toolResult?: { success: boolean; output: string };
  /** Plan execution results (if a plan was triggered) */
  planResult?: { goal: string; stepsCompleted: number; totalSteps: number; success: boolean };
  /** Runtime swarm results (if swarm was used) */
  swarmResult?: { converged: boolean; convergenceSize: number; instanceCount: number; winningApproach: string };
  llmCalls: number;
  latencyMs: number;
  cost: number;  // Estimated cost in dollars
}

/** Function that calls the reasoning model (Flash) for escalation */
export type EscalationHandler = (
  userMessage: string,
  model: PersonModel,
) => Promise<{ response: string; reasoning: string; action: AgentAction }>;

/** Function that calls the runtime model (Flash Lite) for template filling */
export type RuntimeHandler = (
  template: string,
  context: string,
  model: PersonModel,
) => Promise<string>;

/** Function that analyzes a message for topics, entities, emotion */
export type AnalysisHandler = (
  message: string,
  model: PersonModel,
) => Promise<{ topics: string[]; entities: string[]; emotionalState: string }>;

// =============================================================================
// ENGINE STATE
// =============================================================================

let escalationHandler: EscalationHandler | null = null;
let runtimeHandler: RuntimeHandler | null = null;
let analysisHandler: AnalysisHandler | null = null;

export function setHandlers(config: {
  escalation: EscalationHandler;
  runtime: RuntimeHandler;
  analysis: AnalysisHandler;
}): void {
  escalationHandler = config.escalation;
  runtimeHandler = config.runtime;
  analysisHandler = config.analysis;
}

// =============================================================================
// MAIN TURN
// =============================================================================

/**
 * Process one user message. The complete pipeline.
 *
 * @param compilerCtx Optional per-instance compiler context for parallel swarm training.
 * @param traceCtx Optional per-instance trace context for parallel plan compilation.
 */
export async function processTurn(
  userMessage: string,
  model: PersonModel,
  compilerCtx?: CompilerContext,
  traceCtx?: TraceContext,
): Promise<TurnResult> {
  // 0. Record the user message and heartbeat activity
  addMessage(model, { role: "user", content: userMessage });
  recordActivity();

  // 1. Lightweight analysis — detect topics, entities, emotional state
  if (analysisHandler) {
    try {
      const analysis = await analysisHandler(userMessage, model);
      setCurrentTopics(model, analysis.topics);
      setEmotionalState(model, analysis.emotionalState);
      for (const entityName of analysis.entities) {
        addEntity(model, {
          name: entityName,
          type: "thing",
          mentionCount: 1,
          lastMentioned: Date.now(),
          context: "",
        });
      }
    } catch {
      // Analysis failure is non-fatal — continue with existing state
      detectTopicsSimple(userMessage, model);
    }
  } else {
    // No LLM analysis available — use simple heuristics
    detectTopicsSimple(userMessage, model);
  }

  // 2. If there's a pending compilation from last turn, evaluate with immune system
  //    Pass the user's current message for negative sentiment checking
  if (hasPendingCapture(compilerCtx)) {
    const branch = resolveDecisionSuccess(model, userMessage, compilerCtx);
    if (branch) {
      growTree(model, branch);
    }
    // If branch is null, immune system rejected it (logged in getLastCompilationDecision)
  }

  // 3. Evaluate behavior tree
  let btResult = await evaluateBT(model.policy.tree!, model, userMessage);

  // 3b. ε-greedy exploration: even when BT matches, sometimes explore
  //     This prevents the bootstrap ceiling and enables personalized learning
  if (btResult.kind !== "escalate" && btResult.kind !== "none") {
    const patternSource = btResult.trace.some(t => t.includes("skill:")) ? "compiled"
      : btResult.trace.some(t => t.includes("strat:")) ? "compiled"
      : "bootstrap";

    if (shouldExplore(patternSource, model.conversation.turnsThisSession)) {
      // Override: escalate for exploration even though BT had a match
      btResult = { kind: "escalate", trace: [...btResult.trace, "explore:ε-greedy"] };
    }
  }

  // 4. Handle the result
  let turnResult: TurnResult;
  const turnStart = Date.now();
  let llmCalls = 0;

  switch (btResult.kind) {
    case "action": {
      if (btResult.action.type === "tool_call" && btResult.action.target) {
        // BT triggered a tool — execute it directly
        const toolResult = await executeTool(btResult.action.target, btResult.action.params || {});
        turnResult = {
          response: toolResult.success
            ? `Done. ${toolResult.output.slice(0, 200)}`
            : `Tool failed: ${toolResult.error}`,
          source: "tool",
          escalated: false,
          btTrace: btResult.trace,
          compiledBranch: false,
          toolUsed: btResult.action.target,
          toolResult: { success: toolResult.success, output: toolResult.output },
          llmCalls: 0,
          latencyMs: 0,
          cost: 0,
        };
        model.totalBTHandled++;
      } else if (btResult.action.type === "respond" && btResult.action.content) {
        turnResult = {
          response: btResult.action.content,
          source: "bt",
          escalated: false,
          btTrace: btResult.trace,
          compiledBranch: false,
          llmCalls: 0,
          latencyMs: 0,
          cost: 0,
        };
        model.totalBTHandled++;
      } else if (btResult.action.type === "wait") {
        turnResult = await handleEscalation(userMessage, model, btResult.trace);
        llmCalls = 1;
      } else {
        turnResult = {
          response: btResult.action.content || "(action executed)",
          source: "bt",
          escalated: false,
          btTrace: btResult.trace,
          compiledBranch: false,
          llmCalls: 0,
          latencyMs: 0,
          cost: 0,
        };
        model.totalBTHandled++;
      }
      break;
    }

    case "template": {
      const templateStart = Date.now();
      const filled = runtimeHandler
        ? await runtimeHandler(btResult.template, buildContextForRuntime(model), model)
        : fillTemplate(btResult.template, btResult.variables, model, userMessage);
      llmCalls = runtimeHandler ? 1 : 0;

      turnResult = {
        response: filled,
        source: "template",
        escalated: false,
        btTrace: btResult.trace,
        compiledBranch: false,
        llmCalls,
        latencyMs: Date.now() - templateStart,
        cost: llmCalls * 0.0001, // Flash Lite estimate
      };
      model.totalBTHandled++;
      break;
    }

    case "strategy": {
      // Strategy: BT knows WHAT to do, Flash Lite generates HOW (fresh each time)
      const stratStart = Date.now();
      const strategy = btResult.strategy;
      const stratContext = buildStrategyContext(strategy, model, userMessage);

      const response = runtimeHandler
        ? await runtimeHandler(stratContext, buildContextForRuntime(model), model)
        : strategy.exampleResponse || "I hear you. Tell me more.";
      llmCalls = runtimeHandler ? 1 : 0;

      turnResult = {
        response,
        source: "bt", // BT-driven (strategy), not escalation
        escalated: false,
        btTrace: btResult.trace,
        compiledBranch: false,
        llmCalls,
        latencyMs: Date.now() - stratStart,
        cost: llmCalls * 0.0001,
      };
      model.totalBTHandled++;
      break;
    }

    case "plan": {
      // Execute a compiled plan — multi-step tool sequence
      const planStart = Date.now();
      const planExec = await executePlan(btResult.plan, model, userMessage);
      llmCalls = planExec.llmCalls;

      turnResult = {
        response: planExec.response,
        source: "plan",
        escalated: false,
        btTrace: btResult.trace,
        compiledBranch: true,
        planResult: {
          goal: btResult.plan.goal,
          stepsCompleted: planExec.stepsCompleted,
          totalSteps: btResult.plan.steps.length,
          success: planExec.success,
        },
        llmCalls,
        latencyMs: Date.now() - planStart,
        cost: llmCalls * 0.0001,
      };
      model.totalBTHandled++;
      break;
    }

    case "skill":
    case "escalate":
    case "none": {
      // Escalation path: try runtime swarm FIRST, fall back to expensive model
      turnResult = await handleEscalationWithSwarm(userMessage, model, btResult.trace, compilerCtx, traceCtx);
      llmCalls = turnResult.llmCalls;
      break;
    }
  }

  // Fill in timing
  turnResult.latencyMs = turnResult.latencyMs || (Date.now() - turnStart);
  turnResult.llmCalls = turnResult.llmCalls || llmCalls;
  turnResult.cost = turnResult.cost || (llmCalls > 0 ? 0.001 : 0); // Flash estimate

  // 5. Record the agent's response
  addMessage(model, { role: "agent", content: turnResult.response });

  // 6. Track branch health (for pruning decisions)
  //    If a compiled branch fired (strategy, plan, or swarm-compiled), record execution.
  //    Success = user didn't give negative feedback on next turn (checked by immune system).
  if (!turnResult.escalated && turnResult.source !== "template") {
    const trace = turnResult.btTrace;
    // Compiled branches leave a trace with "strat:", "plan:", or "swarm:" markers
    const isCompiled = trace.some(t => t.includes("strat:") || t.includes("plan:") || t.includes("swarm:"));
    if (isCompiled && model.policy.tree) {
      const fingerprint = fingerprintBranch(model.policy.tree);
      recordBranchExecution(fingerprint, true); // Success assumed; negative feedback corrects on next turn
    }
  }

  // 7. Store important conversation content as memory
  if (model.conversation.turnsThisSession % 5 === 0) {
    const topics = model.conversation.currentTopics;
    if (topics.length > 0) {
      addMemory(model, {
        type: "summary",
        content: `Discussed: ${topics.join(", ")}. User seemed ${model.conversation.emotionalState}.`,
        importance: 0.5,
        topics,
        connections: [],
        timestamp: Date.now(),
      });
    }
  }

  // =========================================================================
  // COGNITION MODULE HOOKS (Psyche Chassis additions)
  // =========================================================================

  // 8. BT-native hypothesis updates from current observation
  //    Update hypotheses based on detected emotional state + topics
  const emotion = model.conversation.emotionalState;
  const currentTopics = model.conversation.currentTopics;
  if (emotion !== "neutral" && currentTopics.length > 0) {
    const domain = `${emotion}_${currentTopics[0]}`;
    updateHypothesis(
      model, domain, 0.05,
      `${emotion} about ${currentTopics[0]} (turn ${model.conversation.turnsThisSession})`,
    );
  }

  // 9. Periodic metacognitive reflection (every 10 turns)
  if (model.conversation.turnsThisSession % 10 === 0 && model.conversation.turnsThisSession > 0) {
    const reflection = quickReflection(model);
    // If weak domains detected, increase exploration for those areas
    if (reflection.weakDomains.length > 0) {
      addMemory(model, {
        type: "insight",
        content: `Metacognition: weak in ${reflection.weakDomains.join(", ")}. Cognitive health: ${(reflection.cognitiveHealth * 100).toFixed(0)}%`,
        importance: 0.7,
        topics: ["metacognition"],
        connections: [],
        timestamp: Date.now(),
      });
    }
  }

  return turnResult;
}

// =============================================================================
// ESCALATION WITH RUNTIME SWARM
// =============================================================================

/** Whether runtime swarm is enabled (disabled by default for backward compat) */
let runtimeSwarmEnabled = false;

/** Enable the runtime swarm as the first escalation strategy. */
export function enableRuntimeSwarm(handler: SwarmInstanceHandler): void {
  runtimeSwarmEnabled = true;
  setSwarmHandler(handler);
}

/** Disable the runtime swarm (fall back to direct escalation). */
export function disableRuntimeSwarm(): void {
  runtimeSwarmEnabled = false;
}

/**
 * Escalation with runtime swarm: try N Flash Lite instances first.
 * Only fall back to expensive model if swarm doesn't converge.
 */
async function handleEscalationWithSwarm(
  userMessage: string,
  model: PersonModel,
  btTrace: string[],
  compilerCtx?: CompilerContext,
  traceCtx?: TraceContext,
): Promise<TurnResult> {
  // If runtime swarm is enabled, try it first
  if (runtimeSwarmEnabled) {
    const swarmResult = await executeRuntimeSwarm(userMessage, model);

    if (swarmResult.converged) {
      // Swarm converged — use the result, record trace for compilation
      model.totalBTHandled++; // Swarm handled it, no expensive model needed

      // Capture for single-action compilation
      captureDecision({
        userMessage,
        reasoning: swarmResult.reasoning,
        action: swarmResult.action,
        topics: model.conversation.currentTopics,
        emotionalState: model.conversation.emotionalState,
      }, compilerCtx);

      // Begin trace for potential plan compilation (if tool calls were made)
      if (swarmResult.toolCalls.length > 0) {
        beginTrace(
          userMessage,
          swarmResult.reasoning,
          model.conversation.currentTopics,
          model.conversation.emotionalState,
          traceCtx,
        );
        for (const step of swarmResult.toolCalls) {
          recordStep(step, traceCtx);
        }
      }

      return {
        response: swarmResult.response,
        source: "swarm",
        escalated: false, // Swarm handled it — NOT escalated to expensive model
        btTrace: [...btTrace, `swarm:converged:${swarmResult.winningApproach}:${swarmResult.convergenceSize}/${swarmResult.instanceCount}`],
        compiledBranch: true,
        swarmResult: {
          converged: true,
          convergenceSize: swarmResult.convergenceSize,
          instanceCount: swarmResult.instanceCount,
          winningApproach: swarmResult.winningApproach,
        },
        llmCalls: swarmResult.instanceCount, // Each instance = 1 Flash Lite call
        latencyMs: swarmResult.elapsedMs,
        cost: swarmResult.instanceCount * 0.0001, // Flash Lite cost
      };
    }

    // Swarm didn't converge — fall through to expensive model
  }

  // Fall back to expensive model escalation
  return handleEscalation(userMessage, model, btTrace, compilerCtx, traceCtx);
}

// =============================================================================
// DIRECT ESCALATION (expensive model fallback)
// =============================================================================

async function handleEscalation(
  userMessage: string,
  model: PersonModel,
  btTrace: string[],
  compilerCtx?: CompilerContext,
  traceCtx?: TraceContext,
): Promise<TurnResult> {
  model.totalEscalations++;

  if (!escalationHandler) {
    return {
      response: "I'm not sure how to help with that yet. Can you tell me more?",
      source: "escalation",
      escalated: true,
      btTrace: [...btTrace, "escalate:no_handler"],
      compiledBranch: false,
      llmCalls: 0, latencyMs: 0, cost: 0,
    };
  }

  try {
    const result = await escalationHandler(userMessage, model);

    // Capture the decision for potential compilation (single-action)
    captureDecision({
      userMessage,
      reasoning: result.reasoning,
      action: result.action,
      topics: model.conversation.currentTopics,
      emotionalState: model.conversation.emotionalState,
    }, compilerCtx);

    // Also begin a trace for potential multi-step compilation
    // If the escalation triggered tool calls, recordStep was called during execution
    // The trace completes on the next turn's positive follow-up
    if (!hasActiveTrace(traceCtx)) {
      beginTrace(
        userMessage,
        result.reasoning,
        model.conversation.currentTopics,
        model.conversation.emotionalState,
        traceCtx,
      );
      // Record the response itself as a step
      recordStep({
        tool: "__respond__",
        params: { message: userMessage },
        output: result.response,
        success: true,
        description: `Responded: ${result.response.slice(0, 60)}`,
      }, traceCtx);
    }

    return {
      response: result.response,
      source: "escalation",
      escalated: true,
      btTrace: [...btTrace, "escalate:handled"],
      compiledBranch: true,
      llmCalls: 1, latencyMs: 0, cost: 0.001,
    };
  } catch (err) {
    return {
      response: "Let me think about that. What else is on your mind?",
      source: "escalation",
      escalated: true,
      btTrace: [...btTrace, `escalate:error:${(err as Error).message}`],
      compiledBranch: false,
      llmCalls: 0, latencyMs: 0, cost: 0,
    };
  }
}

// =============================================================================
// PLAN EXECUTION — run compiled multi-step procedures
// =============================================================================

interface PlanExecResult {
  response: string;
  stepsCompleted: number;
  success: boolean;
  llmCalls: number;
}

/**
 * Execute a compiled plan — run each step in order, bind variables, check outcomes.
 * Flash Lite fills in step-level details from context; the structure is deterministic.
 */
async function executePlan(
  plan: CompiledPlan,
  model: PersonModel,
  userMessage: string,
): Promise<PlanExecResult> {
  const bindings = new Map<string, string>();
  const responses: string[] = [];
  let stepsCompleted = 0;
  let llmCalls = 0;
  let success = true;

  for (const step of plan.steps) {
    try {
      const result = await executeStep(step, bindings, model, userMessage);

      if (result.output) {
        bindings.set(step.id, result.output);
      }

      if (result.response) {
        responses.push(result.response);
      }

      llmCalls += result.llmCalls;
      stepsCompleted++;

      // Check step success
      if (step.successCheck && !checkStepSuccess(step.successCheck, result.output)) {
        if (step.onFailure === "abort") {
          success = false;
          responses.push(`Step "${step.description}" didn't succeed as expected.`);
          break;
        }
        // "skip" continues to next step, "escalate" would need handler
      }
    } catch (err) {
      if (step.onFailure === "abort") {
        success = false;
        responses.push(`Step "${step.description}" failed: ${(err as Error).message}`);
        break;
      }
      stepsCompleted++;
    }
  }

  // Build final response from step outputs
  const response = responses.length > 0
    ? responses.join("\n\n")
    : success
      ? `Done. Completed ${stepsCompleted}/${plan.steps.length} steps for: ${plan.goal}`
      : `Partially completed ${stepsCompleted}/${plan.steps.length} steps for: ${plan.goal}`;

  return { response, stepsCompleted, success, llmCalls };
}

/**
 * Execute a single plan step.
 */
async function executeStep(
  step: PlanStep,
  bindings: Map<string, string>,
  model: PersonModel,
  userMessage: string,
): Promise<{ output: string; response?: string; llmCalls: number }> {
  const action = step.action;

  switch (action.type) {
    case "tool_call": {
      // Resolve variable references in params
      const resolvedParams: Record<string, any> = {};
      for (const [key, value] of Object.entries(action.params)) {
        resolvedParams[key] = resolveBindings(value, bindings, model);
      }

      const result = await executeTool(action.tool, resolvedParams);
      return {
        output: result.success ? result.output : `Error: ${result.error}`,
        response: result.success
          ? undefined  // Don't message user for intermediate steps
          : `Note: ${step.description} encountered an issue.`,
        llmCalls: 0,
      };
    }

    case "generate": {
      // Flash Lite generates content from strategy prompt
      const resolvedPrompt = resolveBindings(action.prompt, bindings, model);
      if (runtimeHandler) {
        const generated = await runtimeHandler(
          resolvedPrompt,
          buildContextForRuntime(model),
          model,
        );
        return { output: generated, response: generated, llmCalls: 1 };
      }
      return { output: resolvedPrompt, response: resolvedPrompt, llmCalls: 0 };
    }

    case "respond": {
      // Direct message to user
      const resolved = resolveBindings(action.template, bindings, model);
      return { output: resolved, response: resolved, llmCalls: 0 };
    }

    case "sub_plan": {
      // Invoke another compiled plan by name (COMPOSITION)
      const skill = getSkill(model, action.planName);
      if (!skill || !skill.tree || skill.tree.type !== "plan") {
        return {
          output: `Sub-plan "${action.planName}" not found`,
          response: undefined,
          llmCalls: 0,
        };
      }

      // Resolve params and inject into sub-plan bindings
      const subBindings = new Map<string, string>();
      for (const [key, value] of Object.entries(action.params)) {
        subBindings.set(key, resolveBindings(value, bindings, model));
      }

      // Execute the sub-plan recursively
      const subResult = await executePlan(skill.tree.plan, model, userMessage);
      return {
        output: subResult.response,
        response: subResult.response,
        llmCalls: subResult.llmCalls,
      };
    }
  }
}

/**
 * Resolve variable references in a string: {step_0} → actual output, {topic:work} → topic data.
 */
function resolveBindings(
  template: string,
  bindings: Map<string, string>,
  model: PersonModel,
): string {
  return template.replace(/\{([^}]+)\}/g, (match, key) => {
    // Step output reference
    if (bindings.has(key)) return bindings.get(key)!;

    // Topic reference
    if (key.startsWith("topic:")) {
      const topic = key.slice(6);
      const memories = searchMemory(model, topic, 1);
      return memories.length > 0 ? memories[0].content : topic;
    }

    // Context reference
    if (key.startsWith("context:")) return match; // Leave for Flash Lite

    // ECS data
    if (key === "emotional_state") return model.conversation.emotionalState;
    if (key === "person_id") return model.personId;

    return match; // Unresolved — leave as-is
  });
}

/**
 * Check if a plan step's success condition is met.
 */
function checkStepSuccess(check: PlanStepCheck, output: string): boolean {
  switch (check.type) {
    case "always_pass": return true;
    case "tool_success": return !output.startsWith("Error:");
    case "output_not_empty": return output.length > 0;
    case "output_contains": return check.value ? output.includes(check.value) : true;
    default: return true;
  }
}

// =============================================================================
// SIMPLE ANALYSIS (no LLM)
// =============================================================================

function detectTopicsSimple(message: string, model: PersonModel): void {
  const lower = message.toLowerCase();

  // Simple topic detection
  const topics: string[] = [];
  const topicKeywords: Record<string, string[]> = {
    work: ["work", "job", "project", "meeting", "deadline", "boss", "office", "client"],
    health: ["health", "sick", "doctor", "exercise", "sleep", "tired", "energy"],
    social: ["friend", "family", "partner", "dinner", "party", "hangout", "date"],
    creative: ["art", "music", "writing", "gallery", "paint", "design", "creative"],
    tech: ["code", "app", "bug", "deploy", "api", "server", "database"],
    money: ["money", "budget", "salary", "cost", "expensive", "save", "invest"],
  };

  for (const [topic, keywords] of Object.entries(topicKeywords)) {
    if (keywords.some(k => lower.includes(k))) topics.push(topic);
  }
  if (topics.length > 0) setCurrentTopics(model, topics);

  // Simple emotional state detection
  if (/stress|overwhelm|anxious|worried|nervous/i.test(lower)) setEmotionalState(model, "stressed");
  else if (/excit|happy|great|awesome|amazing|fantastic/i.test(lower)) setEmotionalState(model, "excited");
  else if (/frustrat|angry|annoyed|pissed|furious/i.test(lower)) setEmotionalState(model, "frustrated");
  else if (/sad|down|depress|lonely|miss/i.test(lower)) setEmotionalState(model, "sad");
  else setEmotionalState(model, "neutral");

  // Simple entity detection from known entities
  for (const entity of model.entities) {
    if (lower.includes(entity.name.toLowerCase())) {
      entity.mentionCount++;
      entity.lastMentioned = Date.now();
    }
  }
}

// =============================================================================
// CONTEXT BUILDER (for Flash Lite template filling)
// =============================================================================

import type { ResponseStrategy } from "../bt/types.js";

/**
 * Build a generation prompt for Flash Lite from a compiled strategy.
 * The strategy says WHAT to do. This prompt tells Flash Lite HOW to say it freshly.
 */
function buildStrategyContext(strategy: ResponseStrategy, model: PersonModel, userMessage: string): string {
  const recent = getRecentMessages(model, 4)
    .map(m => `${m.role}: ${m.content}`)
    .join("\n");

  // Gather relevant context from ECS based on strategy's contextKeys
  const contextParts: string[] = [];
  for (const key of strategy.contextKeys) {
    if (key.startsWith("topic:")) {
      const topic = key.slice(6);
      const memories = searchMemory(model, topic, 2);
      if (memories.length > 0) contextParts.push(`About ${topic}: ${memories[0].content}`);
    }
    if (key === "recent_messages") contextParts.push(`Recent:\n${recent}`);
    if (key === "emotional_state") contextParts.push(`They seem: ${model.conversation.emotionalState}`);
  }

  // Find previous responses with similar strategy to avoid repetition
  const previousResponses = model.conversation.recentMessages
    .filter(m => m.role === "agent")
    .slice(-3)
    .map(m => m.content);

  return `Generate a response following this strategy:

INTENT: ${strategy.intent}
APPROACH: ${strategy.approach}
TONE: ${strategy.tone}

CONTEXT:
${contextParts.join("\n")}

They just said: "${userMessage}"

DO NOT repeat or paraphrase any of these previous responses:
${previousResponses.map(r => `- "${r.slice(0, 80)}"`).join("\n")}

${strategy.exampleResponse ? `EXAMPLE (for reference — do NOT copy, generate something fresh and natural):\n"${strategy.exampleResponse}"` : ""}

Generate a concise, natural response (1-3 sentences):`;
}

function buildContextForRuntime(model: PersonModel): string {
  const lines: string[] = [];
  lines.push(`Person: ${model.personId}`);
  lines.push(`Style: ${model.style.formality > 0.6 ? "formal" : "casual"}, ${model.style.humor > 0.5 ? "humorous" : "straightforward"}`);

  const topics = model.conversation.currentTopics;
  if (topics.length > 0) lines.push(`Topics: ${topics.join(", ")}`);

  const state = model.conversation.emotionalState;
  if (state !== "neutral") lines.push(`Mood: ${state}`);

  const intentions = model.intentions.filter(i => i.status === "active");
  if (intentions.length > 0) lines.push(`Working on: ${intentions.map(i => i.claim).join(", ")}`);

  return lines.join("\n");
}
