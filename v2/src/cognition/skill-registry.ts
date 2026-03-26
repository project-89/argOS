/**
 * Skill Registry — Composable Behavior Sub-Trees
 *
 * Skills are named behavior sub-trees that can be:
 *   - Referenced by name from any agent's BT via { type: "skill", name: "forge_sword" }
 *   - Composed: a skill can reference other skills
 *   - LLM-backed: { type: "llm_skill", purpose: "negotiate" } calls the LLM
 *   - Learned: successful multi-step LLM plans compile into named skills
 *   - Shared: one skill definition, many agents using it with different triggers
 *
 * The agent's main BT becomes a "when to use which skill" layer.
 * Skills handle "how to do it."
 *
 * Built-in skills:
 *   - talk: LLM-backed conversation skill
 *   - plan: LLM planner that generates and executes multi-step plans
 *   - explore: wander + observe + interact with new things
 */

import type { BehaviorNode } from "./behavior-policy";

// =============================================================================
// TYPES
// =============================================================================

export interface SkillDefinition {
  /** Unique skill name */
  name: string;
  /** Human description */
  description: string;
  /** The behavior sub-tree that implements this skill */
  tree: BehaviorNode;
  /** How this skill was created */
  origin: "builtin" | "generated" | "learned" | "compiled";
  /** Number of times this skill has been used successfully */
  successCount: number;
  /** Number of times this skill has been attempted */
  attemptCount: number;
  /** When this skill was created */
  createdAt: number;
}

// =============================================================================
// REGISTRY
// =============================================================================

const skills: Map<string, SkillDefinition> = new Map();

/**
 * Register a new skill. Returns false if name already exists.
 */
export function registerSkill(def: Omit<SkillDefinition, "successCount" | "attemptCount" | "createdAt">): boolean {
  if (skills.has(def.name)) return false;
  skills.set(def.name, {
    ...def,
    successCount: 0,
    attemptCount: 0,
    createdAt: Date.now(),
  });
  return true;
}

/**
 * Get a skill by name.
 */
export function getSkill(name: string): SkillDefinition | undefined {
  return skills.get(name);
}

/**
 * Get the behavior tree for a skill.
 */
export function getSkillTree(name: string): BehaviorNode | undefined {
  return skills.get(name)?.tree;
}

/**
 * List all registered skills.
 */
export function listSkills(): SkillDefinition[] {
  return [...skills.values()];
}

/**
 * Check if a skill exists.
 */
export function hasSkill(name: string): boolean {
  return skills.has(name);
}

/**
 * Record a skill attempt and its outcome.
 */
export function recordSkillOutcome(name: string, success: boolean): void {
  const skill = skills.get(name);
  if (!skill) return;
  skill.attemptCount++;
  if (success) skill.successCount++;
}

/**
 * Get skill success rate.
 */
export function getSkillSuccessRate(name: string): number {
  const skill = skills.get(name);
  if (!skill || skill.attemptCount === 0) return 0;
  return skill.successCount / skill.attemptCount;
}

/**
 * Register or update a skill (for learning — overwrites existing).
 */
export function upsertSkill(def: Omit<SkillDefinition, "successCount" | "attemptCount" | "createdAt">): void {
  const existing = skills.get(def.name);
  skills.set(def.name, {
    ...def,
    successCount: existing?.successCount ?? 0,
    attemptCount: existing?.attemptCount ?? 0,
    createdAt: existing?.createdAt ?? Date.now(),
  });
}

/**
 * Remove a skill.
 */
export function removeSkill(name: string): boolean {
  return skills.delete(name);
}

/**
 * Reset registry (for tests).
 */
export function resetSkillRegistry(): void {
  skills.clear();
  registerBuiltinSkills();
}

// =============================================================================
// BUILT-IN SKILLS
// =============================================================================

function registerBuiltinSkills(): void {
  // Explore: wander, observe, interact with things
  registerSkill({
    name: "explore",
    description: "Explore the world — move to new rooms, observe, interact with objects",
    origin: "builtin",
    tree: {
      type: "weighted_random",
      choices: [
        { weight: 3, child: { type: "wander" } },
        { weight: 3, child: { type: "action", action: { type: "observe" } } },
        { weight: 2, child: { type: "interact_any_affordance", scope: "room" } },
        { weight: 1, child: { type: "action", action: { type: "think", content: "Where should I go next?" } } },
      ],
    },
  });

  // Socialize: talk to people, visit others
  registerSkill({
    name: "socialize",
    description: "Social interaction — speak, visit other agents, observe people",
    origin: "builtin",
    tree: {
      type: "selector",
      children: [
        {
          type: "sequence",
          children: [
            { type: "condition", op: { type: "room_has_other_agents" } },
            { type: "condition", op: { type: "last_n_actions_exclude", n: 3, actionType: "speak" } },
            { type: "action", action: { type: "speak", content: "greeting" } },
          ],
        },
        { type: "social_visit" },
        { type: "action", action: { type: "observe" } },
      ],
    },
  });

  // Rest: sleep, recover energy
  registerSkill({
    name: "rest",
    description: "Rest and recover energy",
    origin: "builtin",
    tree: {
      type: "action",
      action: { type: "rest" },
    },
  });

  // Reflect: think about situation, process memories
  registerSkill({
    name: "reflect",
    description: "Reflect on the situation, process memories and goals",
    origin: "builtin",
    tree: {
      type: "weighted_random",
      choices: [
        { weight: 2, child: { type: "action", action: { type: "think", content: "What matters most right now?" } } },
        { weight: 2, child: { type: "action", action: { type: "reflect" } } },
        { weight: 1, child: { type: "action", action: { type: "observe" } } },
      ],
    },
  });
}

// Initialize on module load
registerBuiltinSkills();

// =============================================================================
// SKILL COMPILATION FROM PLANS
// =============================================================================

/**
 * Compile a successful multi-step action sequence into a named skill.
 *
 * When an agent executes a sequence of actions that achieves a goal,
 * this function converts the sequence into a reusable skill sub-tree.
 *
 * Example: [move→Forge, interact→anvil:forge_weapon, interact→bucket:quench]
 * becomes a skill "forge_and_quench" with a sequence of those actions.
 */
export function compileSequenceToSkill(
  name: string,
  description: string,
  actions: Array<{ type: string; target?: string; content?: string; affordance?: string; trait?: string }>,
): boolean {
  if (actions.length === 0) return false;
  if (skills.has(name)) return false;

  const children: BehaviorNode[] = actions.map(action => {
    // If we have trait + affordance, use interact_with_trait for better matching
    if (action.affordance && action.trait) {
      return {
        type: "interact_with_trait" as const,
        trait: action.trait,
        affordance: action.affordance,
        scope: "room" as const,
      };
    }

    // For move actions, validate target is a room name
    if (action.type === "move" && action.target) {
      return {
        type: "action" as const,
        action: { type: "move" as const, target: action.target },
      };
    }

    // Generic action
    return {
      type: "action" as const,
      action: {
        type: action.type as any,
        target: action.target,
        content: action.content || action.affordance,
      },
    };
  });

  // Wrap in a sequence (all steps must succeed)
  const tree: BehaviorNode = children.length === 1
    ? children[0]
    : { type: "sequence", children };

  return registerSkill({
    name,
    description,
    origin: "compiled",
    tree,
  });
}
