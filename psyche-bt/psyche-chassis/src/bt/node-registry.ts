/**
 * BT Node Registry — Pluggable node type system for behavior trees.
 *
 * Makes it easy to add new node types (Parallel, Decorators, etc.)
 * without modifying the core evaluator. Each node type registers
 * an evaluator function that handles that node's tick logic.
 *
 * Standard BT node types from the literature:
 *   - Sequence (✅ built-in)
 *   - Selector/Fallback (✅ built-in)
 *   - Parallel (plugin)
 *   - Decorator: Invert, Repeat, RetryUntil, ForceSuccess, Timeout (plugins)
 *
 * Custom node types for our cognitive architecture:
 *   - WeightedRandom (✅ built-in)
 *   - Strategy, Plan, Skill (✅ built-in)
 *   - LLM Escalate (✅ built-in)
 */

import type { EvalResult } from "./types.js";
import type { PersonModel } from "../ecs/types.js";

// =============================================================================
// NODE EVALUATOR INTERFACE
// =============================================================================

/**
 * A node evaluator function. Takes a node, model, message, and trace,
 * returns an EvalResult.
 *
 * The evaluator receives the raw node object (typed as `any` since custom
 * nodes define their own shape) and a `recurse` function to evaluate
 * child nodes.
 */
export type NodeEvaluator = (
  node: any,
  model: PersonModel,
  userMessage: string | undefined,
  trace: string[],
  recurse: RecurseFunction,
  blackboard: Record<string, any>,
) => Promise<EvalResult>;

/**
 * Recurse function — passed to node evaluators so they can evaluate
 * child nodes without importing the evaluator directly.
 */
export type RecurseFunction = (
  node: any,
  model: PersonModel,
  userMessage: string | undefined,
  trace: string[],
  blackboard: Record<string, any>,
) => Promise<EvalResult>;

// =============================================================================
// REGISTRY
// =============================================================================

const nodeRegistry = new Map<string, NodeEvaluator>();

/**
 * Register a custom node type evaluator.
 *
 * @param nodeType The `type` field value of the BehaviorNode
 * @param evaluator Function that evaluates this node type
 */
export function registerNodeType(nodeType: string, evaluator: NodeEvaluator): void {
  nodeRegistry.set(nodeType, evaluator);
}

/**
 * Get the evaluator for a node type. Returns undefined for built-in types
 * (handled directly by the core evaluator).
 */
export function getNodeEvaluator(nodeType: string): NodeEvaluator | undefined {
  return nodeRegistry.get(nodeType);
}

/**
 * Check if a node type has a registered evaluator.
 */
export function hasNodeEvaluator(nodeType: string): boolean {
  return nodeRegistry.has(nodeType);
}

/**
 * List all registered custom node types.
 */
export function listNodeTypes(): string[] {
  return Array.from(nodeRegistry.keys());
}

/**
 * Remove a registered node type (useful for benchmarking with/without features).
 */
export function unregisterNodeType(nodeType: string): boolean {
  return nodeRegistry.delete(nodeType);
}

/**
 * Clear all registered node types (useful for testing).
 */
export function clearNodeRegistry(): void {
  nodeRegistry.clear();
}
