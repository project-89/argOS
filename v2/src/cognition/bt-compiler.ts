/**
 * LLM-to-BT Compiler — System 2 trains System 1
 *
 * Every time the LLM makes a decision (System 2, slow, expensive), the compiler
 * captures the decision context and, if the action succeeds, compiles it into a
 * new behavior tree branch (System 1, fast, free). Over time, the BT absorbs
 * more patterns and the agent needs the LLM less.
 *
 * Pipeline:
 *   1. captureLLMDecision() — called when LLM picks an action (agent-mind.ts)
 *   2. resolveDecision()    — called when the action outcome is known (cognition-system.ts)
 *   3. On success: compile conditions + action into a BT branch and insert
 *   4. On failure: record as negative evidence (don't compile)
 *   5. pruneStaleBranches() — periodically remove branches that never fire
 *
 * The compiled branches use the agent's state at decision time as conditions:
 *   - Room: in_room("Tavern")
 *   - Needs: need_above("hunger", 60)
 *   - Social: room_has_other_agents / room_is_empty
 *   - Memory: has_memory("keyword") if the reasoning mentions a memory
 *   - Anti-repetition: last_n_actions_exclude for the action type
 */

import { hasComponent } from "bitecs";
import { Agent, BehaviorPolicy, Name, Needs, Room } from "../ecs/components";
import { getRoomForEntity, listDirectContents } from "../ecs/location";
import type { World } from "../ecs/world";
import {
  type BehaviorNode,
  type PolicyAction,
  validateBehaviorNode,
  clearPolicyEvalHistory,
} from "./behavior-policy";
import { growMemoryBranch } from "./policy-learning";
import { compileSequenceToSkill, hasSkill } from "./skill-registry";

// =============================================================================
// TYPES
// =============================================================================

/** Snapshot of agent state at the time the LLM made a decision */
interface DecisionContext {
  agentEid: number;
  /** The LLM's inner reasoning */
  reasoning: string;
  /** The action the LLM chose */
  action: PolicyAction;
  /** Affordance if interact */
  affordance?: string;
  /** Agent's room at decision time */
  roomName: string;
  /** Needs at decision time */
  needs: { hunger: number; energy: number; social: number; comfort: number };
  /** Were other agents in the room? */
  othersPresent: boolean;
  /** Timestamp */
  timestamp: number;
}

/** A pending decision waiting for outcome */
interface PendingDecision extends DecisionContext {
  /** Unique ID for matching */
  id: string;
}

// =============================================================================
// STATE
// =============================================================================

/** Pending decisions awaiting outcomes, keyed by agent EID */
const pendingDecisions: Map<number, PendingDecision> = new Map();

/** Track which compiled branches exist per agent to avoid duplicates */
const compiledSignatures: Map<number, Set<string>> = new Map();

/** Track when each compiled branch last fired (for pruning) */
const branchLastFired: Map<number, Map<string, number>> = new Map();

/** Counter for unique decision IDs */
let decisionCounter = 0;

/** Multi-step action sequences for skill compilation */
const actionSequences: Map<number, Array<{
  action: PolicyAction;
  affordance?: string;
  trait?: string;
  success: boolean;
  timestamp: number;
}>> = new Map();

// Tuning
const MAX_COMPILED_BRANCHES = 15;       // Max compiled branches per agent
const COMPILE_CHANCE_THRESHOLD = 0.8;   // Only compile if action type is underrepresented
const MIN_NEED_THRESHOLD = 30;          // Only add need conditions if need > this
const PRUNE_AGE_MS = 10 * 60 * 1000;   // Prune branches not fired in 10 min
const MAX_PENDING_AGE_MS = 30 * 1000;   // Discard pending decisions older than 30s

// =============================================================================
// CAPTURE: record LLM decision + context
// =============================================================================

/**
 * Capture an LLM decision for potential compilation into the BT.
 * Called from agent-mind.ts when the LLM generates an action.
 */
export function captureLLMDecision(
  world: World,
  agentEid: number,
  reasoning: string,
  action: PolicyAction,
  affordance?: string,
): void {
  // Snapshot agent state
  const roomEid = getRoomForEntity(world, agentEid);
  const roomName = roomEid !== undefined ? String(Name.value[roomEid] || "") : "";

  const needs = {
    hunger: Needs.hunger?.[agentEid] ?? 0,
    energy: Needs.energy?.[agentEid] ?? 100,
    social: Needs.social?.[agentEid] ?? 50,
    comfort: Needs.comfort?.[agentEid] ?? 100,
  };

  let othersPresent = false;
  if (roomEid !== undefined) {
    for (const eid of listDirectContents(world, roomEid)) {
      if (eid !== agentEid && hasComponent(world as any, eid, Agent as any)) {
        othersPresent = true;
        break;
      }
    }
  }

  const decision: PendingDecision = {
    id: `d${++decisionCounter}`,
    agentEid,
    reasoning,
    action,
    affordance,
    roomName,
    needs,
    othersPresent,
    timestamp: Date.now(),
  };

  // Only keep the most recent pending decision per agent
  pendingDecisions.set(agentEid, decision);
}

// =============================================================================
// RESOLVE: compile on success, discard on failure
// =============================================================================

/**
 * Resolve a pending LLM decision after the action outcome is known.
 * On success: compile into BT branch. On failure: discard.
 *
 * Called from cognition-system.ts after action execution.
 */
export function resolveDecision(
  world: World,
  agentEid: number,
  success: boolean,
): void {
  const decision = pendingDecisions.get(agentEid);
  if (!decision) return;

  // Discard stale decisions
  if (Date.now() - decision.timestamp > MAX_PENDING_AGE_MS) {
    pendingDecisions.delete(agentEid);
    return;
  }

  pendingDecisions.delete(agentEid);

  if (!success) return; // Don't compile failed actions

  // Compile the successful decision into a BT branch
  compileToBranch(world, decision);
}

// =============================================================================
// COMPILE: turn LLM decision into BT branch
// =============================================================================

function compileToBranch(world: World, decision: DecisionContext): void {
  if (!hasComponent(world as any, decision.agentEid, BehaviorPolicy as any)) return;
  if (!BehaviorPolicy.enabled[decision.agentEid]) return;

  // Check if we've already compiled too many branches
  let sigs = compiledSignatures.get(decision.agentEid);
  if (!sigs) {
    sigs = new Set();
    compiledSignatures.set(decision.agentEid, sigs);
  }
  if (sigs.size >= MAX_COMPILED_BRANCHES) return;

  // Generate a signature to avoid duplicate branches
  const sig = branchSignature(decision);
  if (sigs.has(sig)) return;

  // Build conditions from the decision context
  const conditions = buildConditions(decision);
  if (conditions.length === 0) return; // No meaningful conditions to compile

  // Build the action node
  const actionNode = buildActionNode(decision);
  if (!actionNode) return;

  // Anti-repetition guard
  conditions.push({
    type: "condition",
    op: { type: "last_n_actions_exclude", n: 3, actionType: decision.action.type },
  } as BehaviorNode);

  // Assemble the branch
  const branch: BehaviorNode = {
    type: "sequence",
    children: [...conditions, actionNode],
  };

  // Parse the current tree
  const raw = String(BehaviorPolicy.treeJson[decision.agentEid] || "").trim();
  if (!raw) return;

  try {
    const tree = JSON.parse(raw) as BehaviorNode;

    // Count existing nodes
    const nodeCount = countNodes(tree);
    const branchSize = countNodes(branch);
    if (nodeCount + branchSize > 120) return; // Tree too large

    // Insert as a medium-priority branch (after survival, before fallback)
    if (tree.type !== "selector" || !Array.isArray((tree as any).children)) return;

    const children = (tree as any).children as BehaviorNode[];
    // Tag the branch so pruner can identify it
    (branch as any)._compiled = sig;

    // Insert before the last 2 children (typically social + weighted_random)
    const insertIdx = Math.max(1, children.length - 2);
    children.splice(insertIdx, 0, branch);

    // Validate
    const v = validateBehaviorNode(tree);
    if (!v.ok) return;

    // Persist
    BehaviorPolicy.treeJson[decision.agentEid] = JSON.stringify(tree);
    BehaviorPolicy.version[decision.agentEid] = (BehaviorPolicy.version[decision.agentEid] || 0) + 1;
    clearPolicyEvalHistory(decision.agentEid);

    sigs.add(sig);

    const agentName = Name.value[decision.agentEid] || decision.agentEid;
    console.log(`[BT-Compiler] ${agentName} learned: ${sig} (${branchSize} nodes, tree now ${nodeCount + branchSize})`);

    // Also check if the reasoning mentions memory-worthy keywords
    extractAndGrowMemoryBranches(world, decision);
  } catch { /* parse error */ }
}

/**
 * Build condition nodes from the decision context.
 * Only adds conditions that were meaningfully relevant to the decision.
 */
function buildConditions(decision: DecisionContext): BehaviorNode[] {
  const conditions: BehaviorNode[] = [];

  // Room condition — if the action was room-specific
  if (decision.roomName && (decision.action.type === "interact" || decision.action.type === "move")) {
    if (decision.action.type !== "move") {
      // "I did this interaction in this room" → in_room condition
      conditions.push({
        type: "condition",
        op: { type: "in_room", roomName: decision.roomName },
      } as BehaviorNode);
    }
  }

  // Need conditions — only if a need was notably high/low
  if (decision.needs.hunger > MIN_NEED_THRESHOLD * 2) {
    conditions.push({
      type: "condition",
      op: { type: "need_above", need: "hunger" as const, value: Math.floor(decision.needs.hunger * 0.7) },
    } as BehaviorNode);
  }
  if (decision.needs.energy < MIN_NEED_THRESHOLD) {
    conditions.push({
      type: "condition",
      op: { type: "need_below", need: "energy" as const, value: Math.floor(decision.needs.energy * 1.3 + 5) },
    } as BehaviorNode);
  }
  if (decision.needs.social < MIN_NEED_THRESHOLD && decision.action.type === "speak") {
    conditions.push({
      type: "condition",
      op: { type: "need_below", need: "social" as const, value: MIN_NEED_THRESHOLD },
    } as BehaviorNode);
  }

  // Social context
  if (decision.othersPresent && (decision.action.type === "speak" || decision.action.type === "interact")) {
    conditions.push({
      type: "condition",
      op: { type: "room_has_other_agents" },
    } as BehaviorNode);
  }

  // Add a chance gate so compiled branches don't dominate
  // Probability increases with more compilations of the same type
  conditions.push({
    type: "condition",
    op: { type: "chance", p: 0.4 },
  } as BehaviorNode);

  return conditions;
}

/**
 * Build the action node from the decision.
 */
function buildActionNode(decision: DecisionContext): BehaviorNode | null {
  const { action, affordance } = decision;

  switch (action.type) {
    case "move":
      if (!action.target) return null;
      return { type: "action", action: { type: "move", target: action.target } };

    case "interact":
      if (affordance && action.target) {
        // Try to build an interact_with_trait if we know the affordance
        return {
          type: "interact_with_trait",
          trait: affordance, // Best guess — the affordance name often matches the trait
          affordance,
          scope: "room" as const,
        };
      }
      if (action.target) {
        return { type: "action", action: { type: "interact", target: action.target, content: action.content } };
      }
      return null;

    case "speak":
      return { type: "action", action: { type: "speak", content: action.content || "greeting" } };

    case "observe":
      return { type: "action", action: { type: "observe" } };

    case "think":
      return { type: "action", action: { type: "think", content: action.content } };

    case "rest":
      return { type: "action", action: { type: "rest" } };

    default:
      return { type: "action", action: { type: action.type, target: action.target, content: action.content } };
  }
}

/**
 * Extract memory-worthy keywords from the LLM's reasoning and grow branches.
 */
function extractAndGrowMemoryBranches(world: World, decision: DecisionContext): void {
  const reasoning = decision.reasoning.toLowerCase();

  // Look for memory references in the reasoning
  const memoryPatterns = [
    { pattern: /remember|recall|memory|last time/i, keyword: null },
    { pattern: /danger|threat|attack|hostile/i, keyword: "danger" },
    { pattern: /friend|ally|trust|like/i, keyword: "friend" },
    { pattern: /hungry|starving|food|eat/i, keyword: "hunger" },
    { pattern: /tired|exhausted|sleep|rest/i, keyword: "exhaustion" },
    { pattern: /suspicious|shady|thief|steal/i, keyword: "suspicion" },
    { pattern: /opportunity|chance|discover|find/i, keyword: "opportunity" },
  ];

  for (const { pattern, keyword } of memoryPatterns) {
    if (pattern.test(reasoning) && keyword) {
      growMemoryBranch(world, decision.agentEid, keyword, decision.action);
    }
  }
}

// =============================================================================
// PRUNING: remove stale branches
// =============================================================================

/**
 * Record that a compiled branch fired (for pruning tracking).
 * Called from evaluateBehaviorPolicy when a branch matches.
 */
export function recordBranchFired(agentEid: number, branchSig: string): void {
  let agentBranches = branchLastFired.get(agentEid);
  if (!agentBranches) {
    agentBranches = new Map();
    branchLastFired.set(agentEid, agentBranches);
  }
  agentBranches.set(branchSig, Date.now());
}

/**
 * Remove compiled branches that haven't fired in PRUNE_AGE_MS.
 * Call periodically (e.g., every Watcher cycle).
 */
export function pruneStaleBranches(world: World, agentEid: number): number {
  if (!hasComponent(world as any, agentEid, BehaviorPolicy as any)) return 0;

  const sigs = compiledSignatures.get(agentEid);
  const fired = branchLastFired.get(agentEid);
  if (!sigs || sigs.size === 0) return 0;

  const now = Date.now();
  const toRemove: string[] = [];

  for (const sig of sigs) {
    const lastFiredAt = fired?.get(sig) ?? 0;
    if (lastFiredAt === 0 || now - lastFiredAt > PRUNE_AGE_MS) {
      toRemove.push(sig);
    }
  }

  if (toRemove.length === 0) return 0;

  const raw = String(BehaviorPolicy.treeJson[agentEid] || "").trim();
  if (!raw) return 0;

  try {
    const tree = JSON.parse(raw) as BehaviorNode;
    let removed = 0;

    // Remove compiled branches whose signature matches a stale one
    if (tree.type === "selector" && Array.isArray((tree as any).children)) {
      const children = (tree as any).children as any[];
      for (let i = children.length - 1; i >= 0; i--) {
        const tag = children[i]?._compiled;
        if (tag && toRemove.includes(tag)) {
          children.splice(i, 1);
          sigs.delete(tag);
          fired?.delete(tag);
          removed++;
        }
      }
    }

    if (removed > 0) {
      const v = validateBehaviorNode(tree);
      if (v.ok) {
        BehaviorPolicy.treeJson[agentEid] = JSON.stringify(tree);
        BehaviorPolicy.version[agentEid] = (BehaviorPolicy.version[agentEid] || 0) + 1;
        clearPolicyEvalHistory(agentEid);
        const agentName = Name.value[agentEid] || agentEid;
        console.log(`[BT-Compiler] ${agentName} pruned ${removed} stale branches`);
      }
    }

    return removed;
  } catch {
    return 0;
  }
}

// =============================================================================
// HELPERS
// =============================================================================

function branchSignature(decision: DecisionContext): string {
  const parts: string[] = [decision.action.type];
  if (decision.affordance) parts.push(decision.affordance);
  if (decision.action.target) parts.push(decision.action.target);
  if (decision.roomName) parts.push(`@${decision.roomName}`);
  if (decision.needs.hunger > 60) parts.push("hungry");
  if (decision.needs.energy < 30) parts.push("tired");
  return parts.join(":");
}

function extractBranchSignature(node: any): string | null {
  // A compiled branch is a sequence with conditions + action
  if (node?.type !== "sequence" || !Array.isArray(node.children)) return null;

  const parts: string[] = [];
  for (const child of node.children) {
    if (child.type === "action" && child.action) {
      parts.push(child.action.type);
      if (child.action.target) parts.push(child.action.target);
    }
    if (child.type === "interact_with_trait") {
      parts.push("interact");
      parts.push(child.affordance || "");
    }
    if (child.type === "condition" && child.op?.type === "in_room") {
      parts.push(`@${child.op.roomName}`);
    }
  }

  return parts.length > 0 ? parts.join(":") : null;
}

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

// =============================================================================
// INTROSPECTION
// =============================================================================

/** Get compilation stats for an agent */
export function getCompilationStats(agentEid: number): {
  compiledBranches: number;
  pendingDecision: boolean;
  activeBranches: string[];
} {
  return {
    compiledBranches: compiledSignatures.get(agentEid)?.size ?? 0,
    pendingDecision: pendingDecisions.has(agentEid),
    activeBranches: [...(compiledSignatures.get(agentEid) ?? [])],
  };
}

/**
 * Track an action in the agent's sequence for potential skill compilation.
 * When 3+ consecutive successful actions form a coherent sequence,
 * compile them into a named skill.
 */
export function trackActionForSkill(
  agentEid: number,
  action: PolicyAction,
  success: boolean,
  affordance?: string,
  trait?: string,
): void {
  let seq = actionSequences.get(agentEid);
  if (!seq) {
    seq = [];
    actionSequences.set(agentEid, seq);
  }

  seq.push({ action, affordance, trait, success, timestamp: Date.now() });

  // Keep only last 10 actions
  if (seq.length > 10) seq.shift();

  // If the last action failed, reset the successful streak
  if (!success) return;

  // Find the longest recent streak of consecutive successes
  let streakStart = seq.length - 1;
  while (streakStart > 0 && seq[streakStart - 1].success) {
    streakStart--;
  }

  const streak = seq.slice(streakStart);
  if (streak.length < 3) return; // Need at least 3 steps

  // Check if this sequence has variety (not just repeating the same action)
  const types = new Set(streak.map(s => s.action.type));
  if (types.size < 2) return; // All same type, not a plan

  // Generate a skill name from the sequence
  const sig = streak.map(s => s.affordance || s.action.type).join("→");
  const skillName = `learned:${sig}`.slice(0, 60);

  if (hasSkill(skillName)) return;

  const compiled = compileSequenceToSkill(
    skillName,
    `Learned sequence: ${sig}`,
    streak.map(s => ({
      type: s.action.type,
      target: s.action.target,
      content: s.action.content,
      affordance: s.affordance,
      trait: s.trait,
    })),
  );

  if (compiled) {
    console.log(`[BT-Compiler] Agent ${agentEid} learned skill: "${skillName}" (${streak.length} steps)`);
  }
}

/** Reset all compiler state (for tests) */
export function resetCompilerState(): void {
  pendingDecisions.clear();
  compiledSignatures.clear();
  branchLastFired.clear();
  actionSequences.clear();
  decisionCounter = 0;
}
