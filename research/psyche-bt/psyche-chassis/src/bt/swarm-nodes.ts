/**
 * Swarm BT Nodes — Custom nodes for behavior tree orchestration.
 *
 * These nodes implement the swarm operations (planning, execution)
 * as BT actions that read/write to a shared blackboard.
 */

import { registerNodeType } from "./node-registry.js";
import type { NodeEvaluator } from "./node-registry.js";
import type { EvalResult } from "./types.js";
import { swarmPlan } from "../agent/swarm-planner.js";
import { executePlan } from "../agent/swarm-executor.js";
import { RUNTIME_MODEL } from "../models/config.js";

// =============================================================================
// SWARM PLAN NODE
// =============================================================================

/**
 * Swarm Plan Node — Spawns N instances to generate a plan.
 * Inputs: `task` (on blackboard)
 * Outputs: `plan` (on blackboard)
 */
const swarmPlanEvaluator: NodeEvaluator = async (node, model, userMessage, trace, recurse, blackboard) => {
  const task = blackboard.task || userMessage;
  if (!task) {
    return { kind: "none", trace: [...trace, "swarm_plan:no_task"] };
  }

  const { instanceCount = 5, convergenceThreshold = 3 } = node;

  console.log(`🐝 [BT] SwarmPlanNode: Planning for task: "${task.slice(0, 60)}..."`);

  const result = await swarmPlan(task, "", {
    instanceCount,
    convergenceThreshold,
    model: RUNTIME_MODEL,
  });

  if (result.converged && result.plan) {
    blackboard.plan = result.plan;
    blackboard.convergence = result;
    return { kind: "action", action: { type: "wait" }, trace: [...trace, "swarm_plan:converged"] };
  }

  return { kind: "none", trace: [...trace, `swarm_plan:failed(${result.agreementCount}/${convergenceThreshold})`] };
};

// =============================================================================
// EXECUTE PLAN NODE
// =============================================================================

/**
 * Execute Plan Node — Executes the plan found on the blackboard.
 * Inputs: `plan` (on blackboard)
 * Outputs: `finalAnswer` (on blackboard)
 */
const executePlanEvaluator: NodeEvaluator = async (node, model, userMessage, trace, recurse, blackboard) => {
  const plan = blackboard.plan;
  if (!plan) {
    return { kind: "none", trace: [...trace, "exec_plan:no_plan"] };
  }

  console.log(`🚀 [BT] ExecutePlanNode: Executing plan with ${plan.steps.length} steps...`);

  const result = await executePlan(plan, "", {
    maxDepth: node.maxDepth || 2,
    stepSwarmSize: node.stepSwarmSize || 3,
    model: RUNTIME_MODEL,
  });

  blackboard.finalAnswer = result.finalAnswer;
  blackboard.executionResult = result;

  if (result.success) {
    return { kind: "action", action: { type: "wait" }, trace: [...trace, "exec_plan:success"] };
  }

  return { kind: "none", trace: [...trace, "exec_plan:failed"] };
};

// =============================================================================
// REGISTRATION
// =============================================================================

export function registerSwarmNodes(): void {
  registerNodeType("swarm_plan", swarmPlanEvaluator);
  registerNodeType("execute_plan", executePlanEvaluator);
}
