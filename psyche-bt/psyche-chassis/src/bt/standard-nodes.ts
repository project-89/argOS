/**
 * Standard BT Nodes — Canonical node types from the BT literature.
 *
 * These are implemented as plugins using the node registry, so they can be
 * individually enabled/disabled for benchmarking.
 *
 * Node types:
 *   - parallel: Tick all children, succeed when M of N succeed
 *   - decorator_invert: Flip Success ↔ Failure
 *   - decorator_repeat: Run child N times
 *   - decorator_retry: Retry child until success or max attempts
 *   - decorator_force_success: Always return Success
 *   - decorator_force_failure: Always return Failure
 *   - decorator_cooldown: Suppress re-ticking for N ticks
 *   - decorator_guard: Only tick child if guard condition passes
 */

import { registerNodeType } from "./node-registry.js";
import type { NodeEvaluator } from "./node-registry.js";
import type { EvalResult, BehaviorNode, ConditionOp } from "./types.js";

// =============================================================================
// EXTENDED NODE TYPE DEFINITIONS
// =============================================================================

/**
 * Union type for all standard BT extension nodes.
 * Import and add to BehaviorNode union when using these.
 */
export type StandardBTNode =
  | { type: "parallel"; children: BehaviorNode[]; successThreshold: number }
  | { type: "decorator_invert"; child: BehaviorNode }
  | { type: "decorator_repeat"; child: BehaviorNode; count: number }
  | { type: "decorator_retry"; child: BehaviorNode; maxAttempts: number }
  | { type: "decorator_force_success"; child: BehaviorNode }
  | { type: "decorator_force_failure"; child: BehaviorNode }
  | { type: "decorator_cooldown"; child: BehaviorNode; ticksCooldown: number; _lastTick?: number }
  | { type: "decorator_guard"; child: BehaviorNode; guard: ConditionOp };

// =============================================================================
// PARALLEL NODE
// =============================================================================

/**
 * Parallel node — tick all children, succeed when M of N succeed.
 *
 * From the literature: "Parallel nodes will execute all their children
 * in parallel. Returns Success when at least M child nodes have succeeded,
 * and Failure when all child nodes have failed."
 *
 * In our system, "parallel" means we evaluate all children in sequence
 * (same as the standard — it's not true thread parallelism) and count results.
 */
const parallelEvaluator: NodeEvaluator = async (node, model, userMessage, trace, recurse, blackboard) => {
  const { children, successThreshold } = node;
  let successCount = 0;
  let lastSuccess: EvalResult | null = null;
  const childResults: EvalResult[] = [];

  for (let i = 0; i < children.length; i++) {
    const result = await recurse(children[i], model, userMessage, [...trace, `par[${i}]`], blackboard);
    childResults.push(result);
    if (result.kind !== "none") {
      successCount++;
      lastSuccess = result;
    }
  }

  if (successCount >= successThreshold) {
    // Return the last successful child's result
    return lastSuccess || { kind: "none", trace: [...trace, "par:threshold_met_but_no_result"] };
  }

  return { kind: "none", trace: [...trace, `par:${successCount}/${successThreshold}`] };
};

// =============================================================================
// DECORATOR: INVERT
// =============================================================================

/**
 * Invert decorator — flips Success to Failure and vice versa.
 * Essential for negation: "if NOT stressed, do this"
 */
const invertEvaluator: NodeEvaluator = async (node, model, userMessage, trace, recurse, blackboard) => {
  const result = await recurse(node.child, model, userMessage, [...trace, "inv"], blackboard);
  if (result.kind === "none") {
    // Child failed → invert to success (return a marker)
    return { kind: "action", action: { type: "wait" }, trace: [...trace, "inv:fail→success"] };
  }
  // Child succeeded → invert to failure
  return { kind: "none", trace: [...trace, "inv:success→fail"] };
};

// =============================================================================
// DECORATOR: REPEAT
// =============================================================================

/**
 * Repeat decorator — run child N times.
 * Returns the last iteration's result. Stops early on failure.
 */
const repeatEvaluator: NodeEvaluator = async (node, model, userMessage, trace, recurse, blackboard) => {
  const { count } = node;
  let lastResult: EvalResult = { kind: "none", trace };

  for (let i = 0; i < count; i++) {
    const result = await recurse(node.child, model, userMessage, [...trace, `rep[${i}]`], blackboard);
    if (result.kind === "none") {
      return { kind: "none", trace: [...trace, `rep:fail@${i}`] };
    }
    lastResult = result;
  }

  return lastResult;
};

// =============================================================================
// DECORATOR: RETRY
// =============================================================================

/**
 * Retry decorator — retry child until it succeeds or max attempts reached.
 * Useful for flaky operations (tool calls, network requests).
 */
const retryEvaluator: NodeEvaluator = async (node, model, userMessage, trace, recurse, blackboard) => {
  const { maxAttempts } = node;

  for (let i = 0; i < maxAttempts; i++) {
    const result = await recurse(node.child, model, userMessage, [...trace, `retry[${i}]`], blackboard);
    if (result.kind !== "none") {
      return result; // Success!
    }
  }

  return { kind: "none", trace: [...trace, `retry:exhausted@${maxAttempts}`] };
};

// =============================================================================
// DECORATOR: FORCE SUCCESS
// =============================================================================

/**
 * Force Success — always return success regardless of child result.
 * Makes a subtree "optional" (it runs but can't block the sequence).
 */
const forceSuccessEvaluator: NodeEvaluator = async (node, model, userMessage, trace, recurse, blackboard) => {
  const result = await recurse(node.child, model, userMessage, [...trace, "force_s"], blackboard);
  if (result.kind !== "none") return result;
  // Child failed, but we force success
  return { kind: "action", action: { type: "wait" }, trace: [...trace, "force_s:forced"] };
};

// =============================================================================
// DECORATOR: FORCE FAILURE
// =============================================================================

/**
 * Force Failure — always return failure regardless of child result.
 * Useful for "check but don't act" patterns.
 */
const forceFailureEvaluator: NodeEvaluator = async (node, model, userMessage, trace, recurse, blackboard) => {
  // Evaluate child (for side effects) but always return failure
  await recurse(node.child, model, userMessage, [...trace, "force_f"], blackboard);
  return { kind: "none", trace: [...trace, "force_f:forced"] };
};

// =============================================================================
// DECORATOR: COOLDOWN
// =============================================================================

/**
 * Cooldown decorator — after the child succeeds, suppress it for N ticks.
 * Prevents behaviors from firing too frequently.
 *
 * Uses a mutable `_lastTick` field on the node (stateful decorator).
 */
let globalTick = 0;

export function advanceTick(): void { globalTick++; }
export function getCurrentTick(): number { return globalTick; }
export function resetTick(): void { globalTick = 0; }

const cooldownEvaluator: NodeEvaluator = async (node, model, userMessage, trace, recurse, blackboard) => {
  const lastTick = node._lastTick ?? -Infinity;
  const elapsed = globalTick - lastTick;

  if (elapsed < node.ticksCooldown) {
    return { kind: "none", trace: [...trace, `cd:cooling(${elapsed}/${node.ticksCooldown})`] };
  }

  const result = await recurse(node.child, model, userMessage, [...trace, "cd"], blackboard);
  if (result.kind !== "none") {
    // Child succeeded — start cooldown
    node._lastTick = globalTick;
  }
  return result;
};

// =============================================================================
// DECORATOR: GUARD
// =============================================================================

/**
 * Guard decorator — only tick child if a guard condition passes.
 * Unlike sequence with a condition, the guard is evaluated inline.
 */
const guardEvaluator: NodeEvaluator = async (node, model, userMessage, trace, recurse, blackboard) => {
  // Evaluate the guard condition by creating a temporary condition node
  const guardNode = { type: "condition" as const, op: node.guard };
  const guardResult = await recurse(guardNode, model, userMessage, [...trace, "guard"], blackboard);

  if (guardResult.kind === "none") {
    return { kind: "none", trace: [...trace, "guard:blocked"] };
  }

  return await recurse(node.child, model, userMessage, [...trace, "guard:pass"], blackboard);
};

// =============================================================================
// REGISTRATION
// =============================================================================

/**
 * Register all standard BT node types.
 * Call this at startup to enable the full canonical BT spec.
 */
export function registerStandardBTNodes(): void {
  registerNodeType("parallel", parallelEvaluator);
  registerNodeType("decorator_invert", invertEvaluator);
  registerNodeType("decorator_repeat", repeatEvaluator);
  registerNodeType("decorator_retry", retryEvaluator);
  registerNodeType("decorator_force_success", forceSuccessEvaluator);
  registerNodeType("decorator_force_failure", forceFailureEvaluator);
  registerNodeType("decorator_cooldown", cooldownEvaluator);
  registerNodeType("decorator_guard", guardEvaluator);
}

/**
 * Register only specific node types (for benchmarking).
 */
export function registerBTNodes(nodeTypes: string[]): void {
  const evaluators: Record<string, NodeEvaluator> = {
    parallel: parallelEvaluator,
    decorator_invert: invertEvaluator,
    decorator_repeat: repeatEvaluator,
    decorator_retry: retryEvaluator,
    decorator_force_success: forceSuccessEvaluator,
    decorator_force_failure: forceFailureEvaluator,
    decorator_cooldown: cooldownEvaluator,
    decorator_guard: guardEvaluator,
  };

  for (const type of nodeTypes) {
    const evaluator = evaluators[type];
    if (evaluator) registerNodeType(type, evaluator);
  }
}
