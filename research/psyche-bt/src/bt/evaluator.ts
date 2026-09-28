/**
 * BT Evaluator — Walks the behavior tree and produces an action.
 *
 * This is the core runtime. It evaluates nodes top-down, left-to-right.
 * Conditions check the ECS person model (O(1) lookups).
 * Templates produce response patterns for Flash Lite to fill.
 * llm_escalate signals that no compiled pattern matches — call the bigger model.
 *
 * The evaluator is completely deterministic (except for chance nodes and weighted_random).
 * No LLM calls. No network. Pure data processing.
 */

import type { BehaviorNode, EvalResult } from "./types.js";
import type { PersonModel } from "../ecs/types.js";
import { evalCondition } from "./conditions.js";
import { getSkill } from "../ecs/person-store.js";

/**
 * Evaluate a behavior tree against a person model.
 * Returns the first successful action, template, or escalation signal.
 */
export function evaluateBT(
  node: BehaviorNode,
  model: PersonModel,
  userMessage?: string,
): EvalResult {
  return evalNode(node, model, userMessage, []);
}

function evalNode(
  node: BehaviorNode,
  model: PersonModel,
  userMessage: string | undefined,
  trace: string[],
): EvalResult {
  switch (node.type) {
    // ─── CONTROL FLOW ──────────────────────────────────────

    case "selector": {
      // Try children in order. Return first success.
      for (let i = 0; i < node.children.length; i++) {
        const result = evalNode(node.children[i], model, userMessage, [...trace, `sel[${i}]`]);
        if (result.kind !== "none") return result;
      }
      return { kind: "none", trace: [...trace, "sel:exhausted"] };
    }

    case "sequence": {
      // Run children in order. All must succeed (conditions pass).
      // Return the LAST child's result (the action at the end of the sequence).
      let lastResult: EvalResult = { kind: "none", trace };
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        const result = evalNode(child, model, userMessage, [...trace, `seq[${i}]`]);

        if (child.type === "condition") {
          // Condition must succeed for sequence to continue
          if (result.kind === "none") {
            return { kind: "none", trace: [...trace, `seq:fail@${i}`] };
          }
          // Condition succeeded — continue to next child
          continue;
        }

        // Non-condition child — this is the action
        if (result.kind !== "none") return result;
        return { kind: "none", trace: [...trace, `seq:fail@${i}`] };
      }
      return lastResult;
    }

    case "weighted_random": {
      // Random selection based on weights — provides variety
      const totalWeight = node.choices.reduce((sum, c) => sum + c.weight, 0);
      let r = Math.random() * totalWeight;
      for (const choice of node.choices) {
        r -= choice.weight;
        if (r <= 0) {
          return evalNode(choice.child, model, userMessage, [...trace, `wrnd`]);
        }
      }
      // Fallback to last choice
      const last = node.choices[node.choices.length - 1];
      return evalNode(last.child, model, userMessage, [...trace, `wrnd:last`]);
    }

    // ─── CONDITIONS ────────────────────────────────────────

    case "condition": {
      const result = evalCondition(model, node.op, userMessage);
      if (result) {
        // Condition passes — return a marker so the sequence knows to continue
        return { kind: "action", action: { type: "wait" }, trace: [...trace, `cond:${node.op.type}=true`] };
      }
      return { kind: "none", trace: [...trace, `cond:${node.op.type}=false`] };
    }

    // ─── ACTIONS ───────────────────────────────────────────

    case "action": {
      return { kind: "action", action: node.action, trace: [...trace, `act:${node.action.type}`] };
    }

    case "template_response": {
      return {
        kind: "template",
        template: node.template,
        variables: node.variables,
        trace: [...trace, `tpl`],
      };
    }

    case "strategy": {
      return {
        kind: "strategy",
        strategy: node.strategy,
        trace: [...trace, `strat:${node.strategy.intent}`],
      };
    }

    case "skill": {
      const skill = getSkill(model, node.name);
      if (skill) {
        // Expand the skill sub-tree and evaluate it
        return evalNode(skill.tree, model, userMessage, [...trace, `skill:${node.name}`]);
      }
      // Unknown skill — fall through
      return { kind: "none", trace: [...trace, `skill:${node.name}:notfound`] };
    }

    // ─── ESCALATION ────────────────────────────────────────

    case "plan": {
      return {
        kind: "plan",
        plan: node.plan,
        trace: [...trace, `plan:${node.plan.goal.slice(0, 30)}`],
      };
    }

    case "llm_escalate": {
      return { kind: "escalate", trace: [...trace, "escalate"] };
    }

    // ─── NO-OP ─────────────────────────────────────────────

    case "noop": {
      return { kind: "none", trace: [...trace, "noop"] };
    }

    default:
      return { kind: "none", trace: [...trace, `unknown:${(node as any).type}`] };
  }
}

// =============================================================================
// TREE UTILITIES
// =============================================================================

/** Count total nodes in a behavior tree */
export function countNodes(node: BehaviorNode): number {
  switch (node.type) {
    case "selector":
    case "sequence":
      return 1 + node.children.reduce((sum, c) => sum + countNodes(c), 0);
    case "weighted_random":
      return 1 + node.choices.reduce((sum, c) => sum + countNodes(c.child), 0);
    default:
      return 1;
  }
}

/** Insert a new branch into a selector node (before the llm_escalate fallback) */
export function insertBranch(tree: BehaviorNode, branch: BehaviorNode): BehaviorNode {
  if (tree.type !== "selector") return tree;

  // Find the llm_escalate node — insert before it
  const escalateIdx = tree.children.findIndex(c => c.type === "llm_escalate");
  const insertIdx = escalateIdx >= 0 ? escalateIdx : tree.children.length;

  const newChildren = [...tree.children];
  newChildren.splice(insertIdx, 0, branch);

  return { ...tree, children: newChildren };
}
