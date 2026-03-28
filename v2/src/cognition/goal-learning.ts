/**
 * Goal Learning — Intent-Aware Skill Compilation
 *
 * When a goal completes, this module:
 *   1. Extracts the action sequence that achieved it
 *   2. Compiles it into a named BT skill (via skill-registry)
 *   3. Inserts a goal-triggered branch into the agent's BT
 *   4. Next time the same situation arises, the BT handles it (no LLM)
 *
 * This connects the planning system to the learning system.
 * Instead of compiling arbitrary action sequences (noise),
 * we compile INTENTIONAL sequences (plans that achieved goals).
 *
 * Also handles:
 *   - Aspiration tracking: long-term wants that drive goal creation
 *   - Failure learning: goals that fail create avoidance branches
 */

import { hasComponent, getRelationTargets } from "bitecs";
import { Agent, BehaviorPolicy, Goal, Plan, Name, Needs, LastAction } from "../ecs/components";
import { HasGoal, HasPlan } from "../ecs/relations";
import type { World } from "../ecs/world";
import {
  type BehaviorNode,
  validateBehaviorNode,
  clearPolicyEvalHistory,
} from "./behavior-policy";
import { compileSequenceToSkill, hasSkill, registerSkill, composeSkills, listSkills } from "./skill-registry";
import { chronicle } from "./simulation-chronicle";
import { getRoomForEntity } from "../ecs/location";

// =============================================================================
// TYPES
// =============================================================================

export interface GoalCompletionEvent {
  agentEid: number;
  goalEid: number;
  goalDescription: string;
  goalKind: string;
  /** Actions the agent took while pursuing this goal */
  actionsTaken: Array<{ type: string; target?: string; content?: string; affordance?: string }>;
  /** Room when the goal was created */
  originRoom: string;
  /** Room when the goal was completed */
  completionRoom: string;
}

// =============================================================================
// STATE
// =============================================================================

/** Track goals per agent and the actions taken during pursuit */
const goalActionLog: Map<number, Map<number, Array<{
  type: string; target?: string; content?: string; affordance?: string; tick: number;
}>>> = new Map();

/** Track which goal-skills have been compiled per agent */
const compiledGoalSkills: Map<number, Set<string>> = new Map();

/** Agent aspirations — long-term wants */
const aspirations: Map<number, string[]> = new Map();

let tickCounter = 0;

// =============================================================================
// ACTION TRACKING (call from cognition-system after each action)
// =============================================================================

/**
 * Record an action taken by an agent while they have active goals.
 * This builds the action log that gets compiled into a skill on goal completion.
 */
export function trackGoalAction(
  world: World,
  agentEid: number,
  action: { type: string; target?: string; content?: string; affordance?: string },
): void {
  tickCounter++;

  // Get active goals for this agent
  const goalEids = getRelationTargets(world as any, agentEid, HasGoal as any)
    .filter((gid: number) => hasComponent(world as any, gid, Goal as any))
    .filter((gid: number) => String(Goal.status[gid] || "") === "active");

  if (goalEids.length === 0) return;

  let agentLog = goalActionLog.get(agentEid);
  if (!agentLog) {
    agentLog = new Map();
    goalActionLog.set(agentEid, agentLog);
  }

  // Record this action against all active goals
  for (const goalEid of goalEids) {
    let actions = agentLog.get(goalEid);
    if (!actions) {
      actions = [];
      agentLog.set(goalEid, actions);
    }
    actions.push({ ...action, tick: tickCounter });
    // Cap at 20 steps per goal
    if (actions.length > 20) actions.shift();
  }
}

// =============================================================================
// GOAL COMPLETION → SKILL COMPILATION
// =============================================================================

/**
 * Called when a goal completes. Compiles the action sequence into a BT skill
 * and inserts a goal-triggered branch into the agent's tree.
 */
export function onGoalCompleted(world: World, agentEid: number, goalEid: number): void {
  if (!hasComponent(world as any, agentEid, BehaviorPolicy as any)) return;
  if (!BehaviorPolicy.enabled[agentEid]) return;

  const goalDesc = String(Goal.description[goalEid] || "").trim();
  const goalKind = String(Goal.kind[goalEid] || "").trim();
  if (!goalDesc) return;

  // Get the action log for this goal
  const agentLog = goalActionLog.get(agentEid);
  const actions = agentLog?.get(goalEid);
  if (!actions || actions.length < 2) return; // Need at least 2 steps

  // Filter out wait/think actions — keep meaningful steps
  const meaningful = actions.filter(a =>
    a.type !== "wait" && a.type !== "think" && a.type !== "reflect");
  if (meaningful.length < 2) return;

  // Generate skill name from goal
  const skillName = `goal:${goalDesc.slice(0, 50).replace(/\s+/g, "_").toLowerCase()}`;
  if (hasSkill(skillName)) return; // Already compiled

  // Check per-agent dedup
  let agentSkills = compiledGoalSkills.get(agentEid);
  if (!agentSkills) {
    agentSkills = new Set();
    compiledGoalSkills.set(agentEid, agentSkills);
  }
  if (agentSkills.has(skillName)) return;

  // Compile the action sequence into a skill
  const compiled = compileSequenceToSkill(
    skillName,
    `Learned from goal: ${goalDesc}`,
    meaningful.map(a => ({
      type: a.type,
      target: a.target,
      content: a.content,
      affordance: a.affordance,
    })),
  );

  if (!compiled) return;

  agentSkills.add(skillName);

  // Now insert a branch into the agent's BT that triggers this skill
  // when similar conditions arise
  insertGoalSkillBranch(world, agentEid, goalDesc, goalKind, skillName);

  const agentName = String(Name.value[agentEid] || agentEid);
  console.log(`[GoalLearning] ${agentName} learned skill "${skillName}" from completing: "${goalDesc}" (${meaningful.length} steps)`);

  chronicle.record("goal_skill_compiled", {
    agent: agentName,
    goal: goalDesc,
    skillName,
    steps: meaningful.length,
    actions: meaningful.map(a => a.affordance || a.type).join("→"),
  });

  // Check if this goal was achieved using existing skills as substeps.
  // If so, create a composed higher-order skill.
  tryComposeHigherOrderSkill(agentName, skillName, goalDesc, meaningful);

  // Clean up the action log for this goal
  agentLog?.delete(goalEid);
}

/**
 * Called when a goal fails. Creates an avoidance memory so the agent
 * doesn't repeat the same failing approach.
 */
export function onGoalFailed(world: World, agentEid: number, goalEid: number): void {
  const goalDesc = String(Goal.description[goalEid] || "").trim();
  if (!goalDesc) return;

  // Record failure as a negative memory for the learning system
  try {
    const { growMemoryBranch } = require("./policy-learning");
    // Extract a keyword from the goal
    const keyword = goalDesc.split(/\s+/).find(w => w.length > 4)?.toLowerCase();
    if (keyword) {
      // Grow a cautious branch: when remembering this failure → observe instead of act
      growMemoryBranch(world, agentEid, `failed:${keyword}`, { type: "observe" });
    }
  } catch { /* ok */ }

  // Clean up the action log
  goalActionLog.get(agentEid)?.delete(goalEid);
}

// =============================================================================
// SKILL COMPOSITION — Voyager pattern: compose simple skills into complex ones
// =============================================================================

/**
 * After compiling a new skill from a goal, check if the action sequence
 * contains steps that match existing skills. If so, create a composed
 * higher-order skill that references the component skills by name.
 *
 * Example: Goal "prepare for battle" → actions [move→Forge, forge_weapon, move→Market, haggle]
 * If "go_to_forge" and "forge_weapon" skills exist, compose:
 *   "prepare_for_battle" = skill:go_to_forge → skill:forge_weapon → move→Market → haggle
 */
function tryComposeHigherOrderSkill(
  agentName: string,
  newSkillName: string,
  goalDesc: string,
  actions: Array<{ type: string; target?: string; affordance?: string }>,
): void {
  const existingSkills = listSkills().filter(s =>
    s.origin === "compiled" && s.name !== newSkillName);

  if (existingSkills.length < 2) return;

  // Check if any pair of existing skills covers a subsequence of actions
  // This is a simplified composition check — looks for two skills that
  // together describe the action sequence
  const actionSig = actions.map(a => a.affordance || a.type).join("→");

  for (const skillA of existingSkills) {
    for (const skillB of existingSkills) {
      if (skillA.name === skillB.name) continue;

      const composedName = `composed:${skillA.name}+${skillB.name}`;
      if (hasSkill(composedName)) continue;

      // Check if skillA's description + skillB's description relates to the goal
      const combined = `${skillA.description} then ${skillB.description}`;
      if (goalDesc.length > 10 && combined.length > 20) {
        // Only compose if both component skills have been used successfully
        if (skillA.successCount > 0 && skillB.successCount > 0) {
          const composed = composeSkills(
            composedName,
            `${goalDesc} (${skillA.name} → ${skillB.name})`,
            [skillA.name, skillB.name],
          );
          if (composed) {
            console.log(`[GoalLearning] ${agentName} composed: "${composedName}" = ${skillA.name} → ${skillB.name}`);
            chronicle.record("skill_learned", {
              agent: agentName,
              skillName: composedName,
              steps: 2,
              sequence: `${skillA.name}→${skillB.name}`,
              composed: true,
            });
            return; // One composition per goal completion
          }
        }
      }
    }
  }
}

// =============================================================================
// BT BRANCH INSERTION
// =============================================================================

/**
 * Insert a goal-triggered skill branch into the agent's BT.
 *
 * The branch structure depends on the goal kind:
 *   - move_to_room: condition = not_in_room(target) → skill
 *   - use_affordance: condition = in_room with matching objects → skill
 *   - custom: condition based on goal description keywords → skill
 */
function insertGoalSkillBranch(
  world: World,
  agentEid: number,
  goalDesc: string,
  goalKind: string,
  skillName: string,
): void {
  const raw = String(BehaviorPolicy.treeJson[agentEid] || "").trim();
  if (!raw) return;

  try {
    const tree = JSON.parse(raw) as BehaviorNode;
    if (tree.type !== "selector" || !Array.isArray((tree as any).children)) return;

    // Count nodes — don't grow too large
    const nodeCount = countNodes(tree);
    if (nodeCount >= 100) return;

    // Build the trigger condition based on goal kind
    const conditions: BehaviorNode[] = [];

    if (goalKind === "move_to_room") {
      // Parse target room from goal description
      const match = goalDesc.match(/(?:go to|move to|travel to|head to)\s+(.+)/i);
      if (match) {
        conditions.push({
          type: "condition",
          op: { type: "not_in_room", roomName: match[1].trim() },
        } as BehaviorNode);
      }
    }

    // Add a need-based condition if the goal mentions needs
    if (/hungry|starving|food|eat/i.test(goalDesc)) {
      conditions.push({
        type: "condition",
        op: { type: "need_above", need: "hunger" as const, value: 50 },
      } as BehaviorNode);
    }
    if (/tired|exhausted|rest|sleep/i.test(goalDesc)) {
      conditions.push({
        type: "condition",
        op: { type: "need_below", need: "energy" as const, value: 30 },
      } as BehaviorNode);
    }
    if (/lonely|social|friend|talk/i.test(goalDesc)) {
      conditions.push({
        type: "condition",
        op: { type: "need_below", need: "social" as const, value: 30 },
      } as BehaviorNode);
    }

    // Add a chance gate to prevent over-triggering
    conditions.push({
      type: "condition",
      op: { type: "chance", p: 0.5 },
    } as BehaviorNode);

    // Build the branch
    const branch: BehaviorNode = {
      type: "sequence",
      children: [
        ...conditions,
        { type: "skill", name: skillName },
      ],
    };

    // Tag it for identification
    (branch as any)._goalSkill = skillName;

    // Insert before the last child (fallback)
    const children = (tree as any).children as BehaviorNode[];
    const insertIdx = Math.max(1, children.length - 1);
    children.splice(insertIdx, 0, branch);

    // Validate
    const v = validateBehaviorNode(tree);
    if (!v.ok) return;

    // Persist
    BehaviorPolicy.treeJson[agentEid] = JSON.stringify(tree);
    BehaviorPolicy.version[agentEid] = (BehaviorPolicy.version[agentEid] || 0) + 1;
    clearPolicyEvalHistory(agentEid);
  } catch { /* parse error */ }
}

// =============================================================================
// ASPIRATIONS — Long-term wants that drive goal creation
// =============================================================================

/**
 * Set aspirations for an agent. These are long-term wants like
 * "build a house", "become master blacksmith", "find a wife".
 *
 * Aspirations are injected into the agent's LLM context so the LLM
 * creates goals aligned with them.
 */
export function setAspirations(agentEid: number, wants: string[]): void {
  aspirations.set(agentEid, wants);
}

/**
 * Get agent's aspirations for LLM context injection.
 */
export function getAspirations(agentEid: number): string[] {
  return aspirations.get(agentEid) || [];
}

/**
 * Format aspirations for inclusion in agent LLM prompt.
 */
export function formatAspirationsForContext(agentEid: number): string {
  const wants = aspirations.get(agentEid);
  if (!wants || wants.length === 0) return "";
  return `\nLONG-TERM ASPIRATIONS (what you dream of achieving):\n${wants.map(w => `  - ${w}`).join("\n")}\n`;
}

// =============================================================================
// HELPERS
// =============================================================================

function countNodes(node: any): number {
  if (!node || typeof node !== "object") return 0;
  let count = 1;
  if (Array.isArray(node.children)) for (const c of node.children) count += countNodes(c);
  if (Array.isArray(node.choices)) for (const c of node.choices) count += countNodes(c.child);
  return count;
}

// =============================================================================
// INTROSPECTION
// =============================================================================

export function getGoalLearningStats(agentEid: number): {
  compiledGoalSkills: number;
  activeGoalActions: number;
  aspirations: string[];
} {
  return {
    compiledGoalSkills: compiledGoalSkills.get(agentEid)?.size ?? 0,
    activeGoalActions: goalActionLog.get(agentEid)?.size ?? 0,
    aspirations: aspirations.get(agentEid) || [],
  };
}

export function resetGoalLearning(): void {
  goalActionLog.clear();
  compiledGoalSkills.clear();
  aspirations.clear();
  tickCounter = 0;
}
