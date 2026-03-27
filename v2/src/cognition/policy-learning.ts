/**
 * Policy Learning — Incremental Behavior Tree Mutation
 *
 * Makes behavior trees ALIVE. Instead of static decision logic that gets
 * replaced wholesale when broken, trees grow and adapt based on experience:
 *
 *   1. Reinforcement: successful actions gain weight, failed ones lose weight
 *   2. Memory-branch creation: important memories spawn new condition→action branches
 *   3. Affordance discovery: new affordances automatically grow exploration branches
 *   4. Social learning: observing others succeed copies branches (future)
 *
 * The tree is mutated in-place via parse → modify → serialize.
 * Mutations are small and incremental — the agent's "personality" (tree structure)
 * evolves gradually rather than being replaced.
 */

import { hasComponent } from "bitecs";
import { BehaviorPolicy } from "../ecs/components";
import type { World } from "../ecs/world";
import {
  type BehaviorNode,
  type PolicyAction,
  validateBehaviorNode,
  setAgentBehaviorPolicy,
  clearPolicyEvalHistory,
} from "./behavior-policy";

// =============================================================================
// TYPES
// =============================================================================

export interface ActionOutcome {
  agentEid: number;
  /** The action that was taken */
  action: PolicyAction;
  /** What affordance was used (if interact) */
  affordance?: string;
  /** Target name */
  target?: string;
  /** Did it succeed? */
  success: boolean;
  /** Optional detail about what happened */
  detail?: string;
}

interface ReinforcementEntry {
  /** Running average success rate (0-1) */
  successRate: number;
  /** Total attempts */
  attempts: number;
  /** Last updated */
  lastUpdated: number;
}

// =============================================================================
// STATE
// =============================================================================

/** Per-agent reinforcement history: action signature → success rate */
const reinforcementState: Map<number, Map<string, ReinforcementEntry>> = new Map();

/** Track which affordances each agent has already grown a branch for */
const knownAffordances: Map<number, Set<string>> = new Map();

/** Track which memory-keywords each agent has already grown a branch for */
const knownMemoryBranches: Map<number, Set<string>> = new Map();

// Tuning constants
const WEIGHT_BOOST = 0.5;         // Weight increase for success
const WEIGHT_PENALTY = 0.3;       // Weight decrease for failure
const MIN_WEIGHT = 0.5;           // Never reduce weight below this
const MAX_WEIGHT = 10;            // Cap weight at this
const MIN_ATTEMPTS_TO_ADJUST = 2; // Need at least N attempts before adjusting
const MAX_TREE_NODES = 120;       // Don't grow the tree beyond this
const EXPLORATION_WEIGHT = 1;     // Weight for newly discovered affordance branches

// =============================================================================
// REINFORCEMENT: adjust weights based on action outcomes
// =============================================================================

/**
 * Record an action outcome and reinforce/penalize the behavior tree.
 *
 * Call this from cognition-system.ts after each action succeeds or fails.
 */
export function recordOutcome(world: World, outcome: ActionOutcome): void {
  const { agentEid, action, success, affordance } = outcome;

  if (!hasComponent(world as any, agentEid, BehaviorPolicy as any)) return;
  if (!BehaviorPolicy.enabled[agentEid]) return;

  // Update reinforcement state
  const sig = actionSignature(action, affordance);
  let agentState = reinforcementState.get(agentEid);
  if (!agentState) {
    agentState = new Map();
    reinforcementState.set(agentEid, agentState);
  }

  const entry = agentState.get(sig) || { successRate: 0.5, attempts: 0, lastUpdated: 0 };
  entry.attempts++;
  // Exponential moving average
  const alpha = Math.min(0.3, 1 / entry.attempts);
  entry.successRate = entry.successRate * (1 - alpha) + (success ? 1 : 0) * alpha;
  entry.lastUpdated = Date.now();
  agentState.set(sig, entry);

  // Only mutate tree after enough evidence
  if (entry.attempts < MIN_ATTEMPTS_TO_ADJUST) return;

  // Parse current tree
  const raw = String(BehaviorPolicy.treeJson[agentEid] || "").trim();
  if (!raw) return;

  try {
    const tree = JSON.parse(raw) as BehaviorNode;
    const mutated = reinforceTree(tree, action, affordance, entry.successRate);

    if (mutated && JSON.stringify(mutated) !== raw) {
      const v = validateBehaviorNode(mutated);
      if (v.ok) {
        BehaviorPolicy.treeJson[agentEid] = JSON.stringify(mutated);
        BehaviorPolicy.version[agentEid] = (BehaviorPolicy.version[agentEid] || 0) + 1;
        clearPolicyEvalHistory(agentEid);
      }
    }
  } catch { /* parse error, skip */ }
}

/**
 * Walk the tree and adjust weights for nodes matching this action.
 */
function reinforceTree(
  node: BehaviorNode,
  action: PolicyAction,
  affordance: string | undefined,
  successRate: number,
): BehaviorNode {
  // Deep clone to avoid mutating the original
  const clone = JSON.parse(JSON.stringify(node)) as BehaviorNode;
  adjustWeights(clone, action, affordance, successRate);
  return clone;
}

function adjustWeights(node: any, action: PolicyAction, affordance: string | undefined, successRate: number): void {
  if (!node || typeof node !== "object") return;

  // Recurse into children
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      adjustWeights(child, action, affordance, successRate);
    }
  }

  // Adjust weights in weighted_random choices
  if (node.type === "weighted_random" && Array.isArray(node.choices)) {
    for (const choice of node.choices) {
      if (matchesAction(choice.child, action, affordance)) {
        if (successRate > 0.6) {
          // Reinforce: increase weight
          choice.weight = Math.min(MAX_WEIGHT, choice.weight + WEIGHT_BOOST);
        } else if (successRate < 0.3) {
          // Penalize: decrease weight
          choice.weight = Math.max(MIN_WEIGHT, choice.weight - WEIGHT_PENALTY);
        }
      }
      adjustWeights(choice.child, action, affordance, successRate);
    }
  }
}

/**
 * Check if a node (or its leaf action) matches the given action/affordance.
 */
function matchesAction(node: any, action: PolicyAction, affordance: string | undefined): boolean {
  if (!node || typeof node !== "object") return false;

  if (node.type === "action" && node.action) {
    if (node.action.type === action.type) {
      if (action.target && node.action.target && node.action.target !== action.target) return false;
      return true;
    }
  }

  if (node.type === "interact_with_trait" && affordance) {
    return node.affordance?.toLowerCase() === affordance.toLowerCase();
  }

  if (node.type === "interact_any_affordance" && action.type === "interact") return true;

  // Check sequence: if the last child is an action that matches
  if (node.type === "sequence" && Array.isArray(node.children) && node.children.length > 0) {
    return matchesAction(node.children[node.children.length - 1], action, affordance);
  }

  return false;
}

// =============================================================================
// MEMORY-BRANCH CREATION: grow new branches from important memories
// =============================================================================

/**
 * When an agent gains an important memory, grow a new branch in their tree
 * that reacts to it.
 *
 * Call this from memory-consolidation or knowledge-graph when a significant
 * memory is stored.
 */
export function growMemoryBranch(
  world: World,
  agentEid: number,
  memoryKeyword: string,
  responseAction: PolicyAction,
): boolean {
  if (!hasComponent(world as any, agentEid, BehaviorPolicy as any)) return false;
  if (!BehaviorPolicy.enabled[agentEid]) return false;

  // Don't grow duplicate branches for the same memory keyword
  let known = knownMemoryBranches.get(agentEid);
  if (!known) {
    known = new Set();
    knownMemoryBranches.set(agentEid, known);
  }
  if (known.has(memoryKeyword.toLowerCase())) return false;

  const raw = String(BehaviorPolicy.treeJson[agentEid] || "").trim();
  if (!raw) return false;

  try {
    const tree = JSON.parse(raw) as BehaviorNode;
    if (countNodes(tree) >= MAX_TREE_NODES) return false;

    // Create a new branch: if has_memory(keyword) → do responseAction
    const newBranch: BehaviorNode = {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "has_memory", includes: memoryKeyword } },
        { type: "condition", op: { type: "last_n_actions_exclude", n: 3, actionType: responseAction.type } },
        { type: "action", action: responseAction },
      ],
    };

    // Insert as a medium-priority child (after survival, before fallback)
    const mutated = insertBranch(tree, newBranch, "middle");
    if (!mutated) return false;

    const v = validateBehaviorNode(mutated);
    if (!v.ok) return false;

    BehaviorPolicy.treeJson[agentEid] = JSON.stringify(mutated);
    BehaviorPolicy.version[agentEid] = (BehaviorPolicy.version[agentEid] || 0) + 1;
    clearPolicyEvalHistory(agentEid);

    known.add(memoryKeyword.toLowerCase());
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// AFFORDANCE DISCOVERY: grow exploration branches for new affordances
// =============================================================================

/**
 * When a new affordance becomes available (registered by spirits/god),
 * grow an exploration branch in agents' trees.
 *
 * Call this from the affordance registry after registerAffordance().
 */
export function growAffordanceBranch(
  world: World,
  agentEid: number,
  affordanceName: string,
  requiredTrait: string,
): boolean {
  if (!hasComponent(world as any, agentEid, BehaviorPolicy as any)) return false;
  if (!BehaviorPolicy.enabled[agentEid]) return false;

  // Don't grow duplicate branches for the same affordance
  let known = knownAffordances.get(agentEid);
  if (!known) {
    known = new Set();
    knownAffordances.set(agentEid, known);
  }
  if (known.has(affordanceName.toLowerCase())) return false;

  const raw = String(BehaviorPolicy.treeJson[agentEid] || "").trim();
  if (!raw) return false;

  try {
    const tree = JSON.parse(raw) as BehaviorNode;
    if (countNodes(tree) >= MAX_TREE_NODES) return false;

    // Create an exploration branch with low probability
    const newBranch: BehaviorNode = {
      type: "sequence",
      children: [
        { type: "condition", op: { type: "chance", p: 0.15 } },
        { type: "condition", op: { type: "last_n_actions_exclude", n: 4, actionType: "interact" } },
        { type: "interact_with_trait", trait: requiredTrait, affordance: affordanceName, scope: "room" },
      ],
    };

    // Insert into weighted_random fallback if it exists, otherwise add as low-priority child
    const mutated = insertIntoFallback(tree, newBranch, EXPLORATION_WEIGHT) || insertBranch(tree, newBranch, "low");
    if (!mutated) return false;

    const v = validateBehaviorNode(mutated);
    if (!v.ok) return false;

    BehaviorPolicy.treeJson[agentEid] = JSON.stringify(mutated);
    BehaviorPolicy.version[agentEid] = (BehaviorPolicy.version[agentEid] || 0) + 1;
    clearPolicyEvalHistory(agentEid);

    known.add(affordanceName.toLowerCase());
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// TREE SURGERY HELPERS
// =============================================================================

/**
 * Insert a branch into a selector tree at the specified priority level.
 * "high" = after first child (survival), "middle" = middle, "low" = before last child (fallback)
 */
function insertBranch(tree: BehaviorNode, branch: BehaviorNode, priority: "high" | "middle" | "low"): BehaviorNode | null {
  if (tree.type !== "selector" || !Array.isArray((tree as any).children)) return null;

  const clone = JSON.parse(JSON.stringify(tree));
  const children = clone.children as BehaviorNode[];

  switch (priority) {
    case "high":
      // After the first child (typically survival needs)
      children.splice(Math.min(1, children.length), 0, branch);
      break;
    case "middle": {
      // In the middle of the array
      const mid = Math.floor(children.length / 2);
      children.splice(mid, 0, branch);
      break;
    }
    case "low":
      // Before the last child (typically weighted_random fallback)
      children.splice(Math.max(0, children.length - 1), 0, branch);
      break;
  }

  return clone;
}

/**
 * Insert a branch into the tree's weighted_random fallback node (if one exists).
 */
function insertIntoFallback(tree: BehaviorNode, branch: BehaviorNode, weight: number): BehaviorNode | null {
  if (tree.type !== "selector" || !Array.isArray((tree as any).children)) return null;

  const clone = JSON.parse(JSON.stringify(tree));
  const children = clone.children as any[];

  // Find the last weighted_random child
  for (let i = children.length - 1; i >= 0; i--) {
    if (children[i].type === "weighted_random" && Array.isArray(children[i].choices)) {
      children[i].choices.push({ weight, child: branch });
      return clone;
    }
  }

  return null; // No weighted_random found
}

/** Count total nodes in a tree */
function countNodes(node: any): number {
  if (!node || typeof node !== "object") return 0;
  let count = 1;
  if (Array.isArray(node.children)) {
    for (const c of node.children) count += countNodes(c);
  }
  if (Array.isArray(node.choices)) {
    for (const c of node.choices) count += countNodes(c.child);
  }
  return count;
}

/** Create a signature for an action (for reinforcement tracking) */
function actionSignature(action: PolicyAction, affordance?: string): string {
  if (affordance) return `interact:${affordance}`;
  return `${action.type}:${action.target || "*"}`;
}

// =============================================================================
// INTROSPECTION
// =============================================================================

/** Get the reinforcement state for an agent (for debugging/UI) */
export function getReinforcementState(agentEid: number): Map<string, ReinforcementEntry> | undefined {
  return reinforcementState.get(agentEid);
}

/** Get the number of nodes in an agent's current tree */
export function getTreeSize(world: World, agentEid: number): number {
  if (!hasComponent(world as any, agentEid, BehaviorPolicy as any)) return 0;
  const raw = String(BehaviorPolicy.treeJson[agentEid] || "").trim();
  if (!raw) return 0;
  try {
    return countNodes(JSON.parse(raw));
  } catch {
    return 0;
  }
}

/** Get growth history for an agent */
export function getGrowthSummary(agentEid: number): {
  knownAffordanceCount: number;
  knownMemoryBranchCount: number;
  reinforcementEntries: number;
} {
  return {
    knownAffordanceCount: knownAffordances.get(agentEid)?.size ?? 0,
    knownMemoryBranchCount: knownMemoryBranches.get(agentEid)?.size ?? 0,
    reinforcementEntries: reinforcementState.get(agentEid)?.size ?? 0,
  };
}

// =============================================================================
// AUTO-DISCOVERY: hook into affordance registration
// =============================================================================

let discoveryInitialized = false;

/**
 * Initialize auto-discovery: when a new affordance is registered by the
 * God AI or spirits, automatically grow exploration branches in all
 * agents with behavior policies.
 *
 * Call once during simulation startup.
 */
export function initializeAffordanceDiscovery(world: World): void {
  if (discoveryInitialized) return;
  discoveryInitialized = true;

  const { onAffordanceRegistered } = require("../world/schema");
  const { Agent, BehaviorPolicy } = require("../ecs/components");
  const { query } = require("bitecs");

  onAffordanceRegistered((def: any) => {
    // Skip base affordances (registered at startup before agents exist)
    if (!def.requires || def.requires.length === 0) return;
    const trait = def.requires[0];

    // Grow exploration branches in all active agents
    const agents = Array.from(query(world, [Agent, BehaviorPolicy])) as number[];
    let grewCount = 0;
    for (const agentEid of agents) {
      if (!BehaviorPolicy.enabled[agentEid as number]) continue;
      if (growAffordanceBranch(world, agentEid as number, def.name, trait)) {
        grewCount++;
      }
    }
    if (grewCount > 0) {
      console.log(`[Discovery] ${grewCount} agents learned about new affordance: ${def.name}`);
    }
  });
}

/** Reset all learning state (for tests) */
export function resetLearningState(): void {
  reinforcementState.clear();
  knownAffordances.clear();
  knownMemoryBranches.clear();
  discoveryInitialized = false;
}
