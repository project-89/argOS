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
import { Agent, BehaviorPolicy, Name, Needs, Room, Traits } from "../ecs/components";
import { getRoomForEntity, listDirectContents } from "../ecs/location";
import type { World } from "../ecs/world";
import { isDocumentOperation } from "../world/productive-work";
import { requiresFreshAffordanceDecision } from "../world/affordance-availability";
import {
  type BehaviorNode,
  type PolicyAction,
  validateBehaviorNode,
  clearPolicyEvalHistory,
} from "./behavior-policy";
import { growMemoryBranch } from "./policy-learning";
// skill compilation happens in goal-learning.ts, not here
import { chronicle } from "./simulation-chronicle";
import { worldSchema } from "../world/schema";

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

interface CompilerWorldState {
  /** Pending decisions awaiting outcomes, keyed by agent EID in this world. */
  pendingDecisions: Map<number, PendingDecision>;
}

let compilerStateByWorld = new WeakMap<World, CompilerWorldState>();
// Compatibility for the historical getCompilationStats(agentEid) API. The
// actual mutable state remains world-scoped; weak references do not retain dead worlds.
const latestWorldByAgent = new Map<number, WeakRef<World>>();

function stateFor(world: World): CompilerWorldState {
  let state = compilerStateByWorld.get(world);
  if (!state) {
    state = { pendingDecisions: new Map() };
    compilerStateByWorld.set(world, state);
  }
  return state;
}

function rememberWorld(world: World, agentEid: number): void {
  latestWorldByAgent.set(agentEid, new WeakRef(world));
}

/** Counter for unique decision IDs */
let decisionCounter = 0;


// Tuning
const MAX_COMPILED_BRANCHES = 15;       // Max compiled branches per agent
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
  const state = stateFor(world);
  rememberWorld(world, agentEid);
  if (requiresFreshAffordanceDecision(world, agentEid, action)) {
    // Exact private wording is not a skill. Do not retain it even as a pending
    // learning example; a later capability change cannot make it replayable.
    state.pendingDecisions.delete(agentEid);
    return;
  }
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
  state.pendingDecisions.set(agentEid, decision);
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
  expectedAction?: { type: string; target?: string; content?: string },
): void {
  const state = stateFor(world);
  rememberWorld(world, agentEid);
  const decision = state.pendingDecisions.get(agentEid);
  if (!decision) return;

  // Discard stale decisions
  if (Date.now() - decision.timestamp > MAX_PENDING_AGE_MS) {
    state.pendingDecisions.delete(agentEid);
    return;
  }

  // Async completion may arrive after a newer decision replaced this slot. A
  // result for command A must not train command B (nor consume B's pending proof).
  if (expectedAction) {
    const type = (value: string) => value.trim().toLowerCase();
    const target = (value?: string) => String(value || "").trim().toLowerCase();
    const content = (action: { type: string; content?: string }) => {
      const raw = String(action.content || "").trim();
      if (type(action.type) !== "interact") return raw;
      const match = raw.match(/^(\S+)([\s\S]*)$/);
      if (!match) return "";
      const verb = match[1].toLowerCase().replace(/^["'`]+|["'`]+$/g, "").replace(/[^\p{L}\p{N}_-]+$/gu, "");
      return `${verb}\n${match[2].trim()}`;
    };
    if (type(decision.action.type) !== type(expectedAction.type) || target(decision.action.target) !== target(expectedAction.target) ||
        content(decision.action) !== content(expectedAction)) return;
  }

  state.pendingDecisions.delete(agentEid);

  if (!success) return; // Don't compile failed actions

  // Compile the successful decision into a BT branch
  compileToBranch(world, decision);
}

// =============================================================================
// COMPILE: turn LLM decision into BT branch
// =============================================================================

function compileToBranch(world: World, decision: DecisionContext): void {
  // A successful utterance proves delivery, not that these exact words are a
  // reusable response. Learning dialogue needs semantic slots and fresh listener
  // context; broad room/need predicates cannot safely replay it.
  if (decision.action.type === "speak" || isDocumentOperation(decision.action)
    || requiresFreshAffordanceDecision(world, decision.agentEid, decision.action)) return;
  // Document commands bind particular content/revisions. Reusing them requires
  // parameterized skills, not a broad room/need-triggered literal replay.
  rememberWorld(world, decision.agentEid);
  if (!hasComponent(world as any, decision.agentEid, BehaviorPolicy as any)) return;
  if (!BehaviorPolicy.enabled[decision.agentEid]) return;

  // Generate a signature to avoid duplicate branches
  const sig = branchSignature(decision);

  // Build conditions from the decision context
  const conditions = buildConditions(decision);
  if (conditions.length === 0) return; // No meaningful conditions to compile

  // Build the action node
  const actionNode = buildActionNode(world, decision);
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
    // Reconstruct compiler book-keeping from the durable tree. This makes
    // duplicate suppression work after restore and avoids cross-world EID leaks.
    const compiled = collectCompiledBranches(tree);
    if (compiled.size >= MAX_COMPILED_BRANCHES || compiled.has(sig)) return;

    // Count existing nodes
    const nodeCount = countNodes(tree);
    const branchSize = countNodes(branch);
    if (nodeCount + branchSize > 120) return; // Tree too large

    // Insert as a medium-priority branch (after survival, before fallback)
    if (tree.type !== "selector" || !Array.isArray((tree as any).children)) return;

    const children = (tree as any).children as BehaviorNode[];
    // Tag the branch so pruner can identify it
    (branch as any)._compiled = sig;
    (branch as any)._compiledAt = Date.now();

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

    const agentName = Name.value[decision.agentEid] || decision.agentEid;
    console.log(`[BT-Compiler] ${agentName} learned: ${sig} (${branchSize} nodes, tree now ${nodeCount + branchSize})`);

    chronicle.record("bt_compiled", {
      agent: agentName,
      branch: sig,
      treeSize: nodeCount + branchSize,
      reasoning: decision.reasoning.slice(0, 120),
      action: decision.action.type,
      affordance: decision.affordance,
      roomName: decision.roomName,
    });

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

  // Room condition — only for actions that are genuinely room-specific.
  // interact_with_trait actions are NOT room-specific (the agent should forge
  // anywhere there's a forgeable object, not just in the room where they first learned).
  // Only add in_room for: speak (social context matters), move (always room-specific by definition).
  if (decision.roomName && decision.action.type === "speak") {
    conditions.push({
      type: "condition",
      op: { type: "in_room", roomName: decision.roomName },
    } as BehaviorNode);
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
function interactionTrait(world: World, decision: DecisionContext, affordance: string): string | undefined {
  const definition = worldSchema.getAffordance(affordance);
  if (!definition?.requires?.length || !decision.action.target) return undefined;
  const roomEid = getRoomForEntity(world, decision.agentEid);
  const candidates = [
    ...(roomEid === undefined ? [] : listDirectContents(world, roomEid)),
    ...listDirectContents(world, decision.agentEid),
  ];
  const wanted = decision.action.target.trim().toLowerCase();
  const targetEid = candidates.find((eid) => String(Name.value[eid] || "").trim().toLowerCase() === wanted);
  if (targetEid === undefined || !hasComponent(world as any, targetEid, Traits as any)) return undefined;
  let activeTraits: string[] = [];
  try {
    const parsed = JSON.parse(String(Traits.active[targetEid] || "[]"));
    if (Array.isArray(parsed)) activeTraits = parsed.map(String);
  } catch { return undefined; }
  const normalized = new Map(activeTraits.map((trait) => [trait.trim().toLowerCase(), trait]));
  return definition.requires.map(String).map((trait) => normalized.get(trait.trim().toLowerCase())).find(Boolean);
}

function affordanceArgs(action: PolicyAction, affordance: string): string | undefined {
  const raw = String(action.content || "").trim();
  if (!raw) return undefined;
  const match = raw.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  if (!match || match[1].toLowerCase() !== affordance.trim().toLowerCase()) return undefined;
  return String(match[2] || "").trim() || undefined;
}

function buildActionNode(world: World, decision: DecisionContext): BehaviorNode | null {
  const { action, affordance } = decision;

  switch (action.type) {
    case "move":
      if (!action.target) return null;
      return { type: "action", action: { type: "move", target: action.target } };

    case "interact":
      if (affordance && action.target) {
        // Generalize only through an actual schema requirement proven on the
        // successful target. Affordance names are verbs and are not reliable traits.
        const trait = interactionTrait(world, decision, affordance);
        if (trait) return {
          type: "interact_with_trait",
          trait,
          affordance,
          args: affordanceArgs(action, affordance),
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

type CompiledBranchRecord = { node: any; compiledAt: number; lastFiredAt: number };

function collectCompiledBranches(node: any, out = new Map<string, CompiledBranchRecord>()): Map<string, CompiledBranchRecord> {
  if (!node || typeof node !== "object") return out;
  const signature = String(node._compiled || "").trim();
  if (signature) out.set(signature, {
    node,
    compiledAt: Number(node._compiledAt || 0),
    lastFiredAt: Number(node._lastFiredAt || 0),
  });
  if (Array.isArray(node.children)) for (const child of node.children) collectCompiledBranches(child, out);
  if (Array.isArray(node.choices)) for (const choice of node.choices) collectCompiledBranches(choice?.child, out);
  return out;
}

function worldForStats(agentEid: number, explicit?: World): World | undefined {
  return explicit ?? latestWorldByAgent.get(agentEid)?.deref();
}

/** Persist a branch firing watermark. Normal evaluation does this inline; this
 * compatibility API is useful to external policy executors. */
export function recordBranchFired(agentEid: number, branchSig: string, world?: World): void {
  const scopedWorld = worldForStats(agentEid, world);
  if (!scopedWorld || !hasComponent(scopedWorld as any, agentEid, BehaviorPolicy as any)) return;
  const raw = String(BehaviorPolicy.treeJson[agentEid] || "").trim();
  if (!raw) return;
  try {
    const tree = JSON.parse(raw) as BehaviorNode;
    const branch = collectCompiledBranches(tree).get(branchSig);
    if (!branch) return;
    branch.node._lastFiredAt = Date.now();
    BehaviorPolicy.treeJson[agentEid] = JSON.stringify(tree);
    rememberWorld(scopedWorld, agentEid);
  } catch { /* invalid policy stays untouched */ }
}

/**
 * Remove compiled branches that haven't fired in PRUNE_AGE_MS.
 * Call periodically (e.g., every Watcher cycle).
 */
export function pruneStaleBranches(world: World, agentEid: number): number {
  rememberWorld(world, agentEid);
  if (!hasComponent(world as any, agentEid, BehaviorPolicy as any)) return 0;

  const raw = String(BehaviorPolicy.treeJson[agentEid] || "").trim();
  if (!raw) return 0;

  try {
    const tree = JSON.parse(raw) as BehaviorNode;
    const compiled = collectCompiledBranches(tree);
    if (compiled.size === 0) return 0;
    const now = Date.now();
    const toRemove = new Set([...compiled.entries()]
      .filter(([, record]) => now - Math.max(record.lastFiredAt, record.compiledAt) > PRUNE_AGE_MS)
      .map(([signature]) => signature));
    if (toRemove.size === 0) return 0;

    const removeFrom = (node: any): number => {
      if (!node || typeof node !== "object") return 0;
      let removed = 0;
      if (Array.isArray(node.children)) {
        for (let i = node.children.length - 1; i >= 0; i--) {
          const tag = String(node.children[i]?._compiled || "").trim();
          if (tag && toRemove.has(tag)) { node.children.splice(i, 1); removed++; }
          else removed += removeFrom(node.children[i]);
        }
      }
      if (Array.isArray(node.choices)) {
        for (let i = node.choices.length - 1; i >= 0; i--) {
          const tag = String(node.choices[i]?.child?._compiled || "").trim();
          if (tag && toRemove.has(tag)) { node.choices.splice(i, 1); removed++; }
          else removed += removeFrom(node.choices[i]?.child);
        }
      }
      return removed;
    };
    const removed = removeFrom(tree);

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
  // Only include room for room-specific actions (move, speak) — not interact
  if (decision.roomName && (decision.action.type === "move" || decision.action.type === "speak")) {
    parts.push(`@${decision.roomName}`);
  }
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
export function getCompilationStats(agentEid: number, explicitWorld?: World): {
  compiledBranches: number;
  pendingDecision: boolean;
  activeBranches: string[];
} {
  const world = worldForStats(agentEid, explicitWorld);
  const state = world ? compilerStateByWorld.get(world) : undefined;
  let activeBranches: string[] = [];
  if (world && hasComponent(world as any, agentEid, BehaviorPolicy as any)) {
    try { activeBranches = [...collectCompiledBranches(JSON.parse(String(BehaviorPolicy.treeJson[agentEid] || "{}"))).keys()]; }
    catch { activeBranches = []; }
  }
  return {
    compiledBranches: activeBranches.length,
    pendingDecision: state?.pendingDecisions.has(agentEid) ?? false,
    activeBranches,
  };
}

// trackActionForSkill removed — arbitrary sequence compilation produced noise.
// Skill compilation now happens ONLY through goal-learning.ts (onGoalCompleted)
// where skills are tied to intentional plans that achieved verified goals.

/** Reset all compiler state (for tests) */
export function resetCompilerState(): void {
  compilerStateByWorld = new WeakMap<World, CompilerWorldState>();
  latestWorldByAgent.clear();
  decisionCounter = 0;
}
