import type { World } from "../ecs/world";
import { addComponent, addEntity, hasComponent, getRelationTargets } from "bitecs";
import { Goal, Memory, Plan, PlanningDecision } from "../ecs/components";
import { HasMemory, HasGoal, HasPlan } from "../ecs/relations";
import { ensureGoalSignature, goalSignatureId } from "./goal-contract";
import {
  getProceduralSkillBySignature,
  serializeProceduralSkillV1,
  type ProceduralSkillV1,
} from "./procedural-skills";
import type { SuccessfulGoalAction } from "./goal-learning";

type PlanStep = {
  description: string;
  actionType: "speak" | "move" | "interact" | "observe" | "think" | "wait";
  target?: string;
  content?: string;
  estimatedDuration?: string;
  prerequisites?: string[];
  resolution?: unknown;
  waitUntil?: unknown;
};

function normalizeGoalKey(goalDesc: string): string {
  return goalDesc.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80);
}

function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    // 32-bit FNV prime
    hash = Math.imul(hash, 0x01000193);
  }
  // Ensure unsigned and compact.
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function buildMacroSignature(goalDesc: string, stepsJson: string): string {
  const goalKey = normalizeGoalKey(goalDesc);
  const hash = fnv1a32(`${goalKey}|${stepsJson}`);
  return `goal:${goalKey}|${hash}`;
}

function buildMacroSignatureForGoal(world: World, goalEid: number, goalDesc: string, stepsJson: string): string {
  const goalSig = ensureGoalSignature(world, goalEid);
  if (goalSig) {
    const id = goalSignatureId(goalSig);
    const hash = fnv1a32(`${id}|${stepsJson}`);
    return `goalid:${id}|${hash}`;
  }
  return buildMacroSignature(goalDesc, stepsJson);
}

function planStepsToProcedureSteps(steps: PlanStep[]): ProceduralSkillV1["steps"] {
  const out: ProceduralSkillV1["steps"] = [];
  for (const step of steps) {
    const actionType = step.actionType;
    if (actionType === "move") {
      if (!step.target) continue;
      out.push({ type: "move", target: step.target });
      continue;
    }
    if (actionType === "interact") {
      if (!step.target) continue;
      const content = String(step.content || "").trim();
      if (!content) continue;
      out.push({ type: "interact", target: step.target, content });
      continue;
    }
    if (actionType === "observe") {
      if (!step.target) continue;
      out.push({ type: "observe", target: step.target });
      continue;
    }
    if (actionType === "speak") {
      const content = String(step.content || "").trim();
      if (!content) continue;
      out.push({ type: "speak", target: step.target, content });
      continue;
    }
    if (actionType === "think") {
      const content = String(step.content || "").trim();
      if (!content) continue;
      out.push({ type: "think", content });
      continue;
    }
    if (actionType === "wait") {
      out.push({ type: "wait" });
      continue;
    }
  }
  return out.slice(0, 40);
}

function successfulActionsToProcedureSteps(actions: SuccessfulGoalAction[]): ProceduralSkillV1["steps"] {
  const out: ProceduralSkillV1["steps"] = [];
  for (const action of actions) {
    const type = String(action.type || "").trim().toLowerCase();
    const target = String(action.target || "").trim() || undefined;
    const content = String(action.content || "").trim() || undefined;
    if (type === "pickup" && target) {
      out.push({ type: "interact", target, content: content || "take" });
    } else if (type === "use" && target && content) {
      out.push({ type: "interact", target, content });
    } else if (type === "examine" && target) {
      out.push({ type: "observe", target });
    } else if (type === "interact" && target && content) {
      out.push({ type: "interact", target, content });
    } else if (type === "move" && target) {
      out.push({ type: "move", target });
    } else if (type === "observe" && target) {
      out.push({ type: "observe", target });
    } else if (type === "speak" && content) {
      out.push({ type: "speak", target, content });
    } else if (type === "think" && content) {
      out.push({ type: "think", content });
    } else if (type === "wait") {
      out.push({ type: "wait" });
    }
  }
  return out.slice(-40);
}

function storeGoalProcedure(
  world: World,
  agentEid: number,
  goalEid: number,
  procedureSteps: ProceduralSkillV1["steps"],
  signatureSource: string,
): { ok: true; signature: string } | { ok: false; reason: string } {
  if (!hasComponent(world as any, goalEid, Goal as any)) return { ok: false, reason: "missing Goal component" };
  if (String(Goal.status[goalEid] || "") !== "completed") return { ok: false, reason: "goal success not verified" };
  if (!getRelationTargets(world, agentEid, HasGoal).includes(goalEid)) return { ok: false, reason: "goal ownership mismatch" };
  if (goalHasEvidenceBoundary(world, agentEid, goalEid)) return { ok: false, reason: "evidence waits require a condition-preserving procedure format" };

  const goalDesc = String(Goal.description[goalEid] || "").trim();
  if (!goalDesc) return { ok: false, reason: "empty goal description" };
  const meaningful = procedureSteps.filter(step => step.type !== "wait").length;
  if (meaningful < 2) return { ok: false, reason: "procedure too small to compile" };

  const signature = buildMacroSignatureForGoal(world, goalEid, goalDesc, signatureSource);
  const now = Date.now();
  const existing = getProceduralSkillBySignature(world, agentEid, signature);
  if (existing) {
    const skill = existing.skill;
    skill.stats.lastUsedAt = now;
    skill.stats.successes += 1;
    skill.steps = procedureSteps;
    Memory.content[existing.memoryEid] = serializeProceduralSkillV1(skill);
    Memory.lastRecalled[existing.memoryEid] = now;
    Memory.recallCount[existing.memoryEid] = (Memory.recallCount[existing.memoryEid] || 0) + 1;
    return { ok: true, signature };
  }

  const newSkill: ProceduralSkillV1 = {
    kind: "procedure_v1",
    signature,
    name: `Macro: ${goalDesc.slice(0, 80)}`,
    trigger: { affordance: "__goal_macro__" },
    steps: procedureSteps,
    stats: { successes: 1, failures: 0, createdAt: now, lastUsedAt: now },
  };
  const memoryEid = addEntity(world as any);
  addComponent(world as any, memoryEid, Memory as any);
  addComponent(world as any, agentEid, HasMemory(memoryEid) as any);
  Memory.type[memoryEid] = "procedural";
  Memory.content[memoryEid] = serializeProceduralSkillV1(newSkill);
  Memory.importance[memoryEid] = 0.85;
  Memory.emotionalValence[memoryEid] = 0.1;
  Memory.timestamp[memoryEid] = now;
  Memory.lastRecalled[memoryEid] = now;
  Memory.recallCount[memoryEid] = 0;
  return { ok: true, signature };
}

function goalHasEvidenceBoundary(world: World, agentEid: number, goalEid: number): boolean {
  return getRelationTargets(world, agentEid, HasPlan).some(id => {
    if (!hasComponent(world, id, Plan) || Plan.goalEid[id] !== goalEid) return false;
    if (hasComponent(world, id, PlanningDecision)) return true;
    try {
      const steps = JSON.parse(Plan.steps[id] || "[]");
      return !Array.isArray(steps) || steps.some((step: PlanStep) => !step || step.actionType === "wait" || step.waitUntil !== undefined);
    } catch { return true; }
  });
}

/** Compile the successful physical episode that actually earned typed goal
 * proof. This is preferred when replanning means no single Plan represents the
 * whole causal sequence. */
export function compileSuccessfulGoalActionsToProceduralMacro(
  world: World,
  agentEid: number,
  goalEid: number,
  actions: SuccessfulGoalAction[],
): { ok: true; signature: string } | { ok: false; reason: string } {
  // Flat procedure_v1 cannot represent actor-evidence barriers. Learning only
  // the surrounding successful actions would silently erase the condition.
  if (goalHasEvidenceBoundary(world, agentEid, goalEid)) return { ok: false, reason: "evidence waits require a condition-preserving procedure format" };
  const steps = successfulActionsToProcedureSteps(actions);
  return storeGoalProcedure(world, agentEid, goalEid, steps, JSON.stringify(steps));
}

/**
 * Compile a completed plan into a reusable procedural macro.
 *
 * This is intentionally conservative:
 * - Only compiles completed plans
 * - Requires at least 2 meaningful steps (move/interact/observe/speak/think)
 * - Stores as a ProceduralSkillV1 with a goal-derived signature
 *
 * These macros are later auto-started (deterministically) when the same goal appears again.
 */
export function compileCompletedPlanToProceduralMacro(
  world: World,
  agentEid: number,
  goalEid: number,
  planEid: number
): { ok: true; signature: string } | { ok: false; reason: string } {
  if (!hasComponent(world as any, planEid, Plan as any)) return { ok: false, reason: "missing Plan component" };
  if (!hasComponent(world as any, goalEid, Goal as any)) return { ok: false, reason: "missing Goal component" };
  if (String(Plan.status[planEid] || "") !== "completed") return { ok: false, reason: "plan not completed" };
  if (String(Goal.status[goalEid] || "") !== "completed") return { ok: false, reason: "goal success not verified" };
  if (Plan.goalEid[planEid] !== goalEid || !getRelationTargets(world, agentEid, HasGoal).includes(goalEid) ||
      !getRelationTargets(world, agentEid, HasPlan).includes(planEid)) {
    return { ok: false, reason: "plan/goal ownership mismatch" };
  }

  const stepsJson = String(Plan.steps[planEid] || "").trim();
  if (!stepsJson) return { ok: false, reason: "empty plan steps" };

  let steps: PlanStep[];
  try {
    const parsed = JSON.parse(stepsJson);
    if (!Array.isArray(parsed)) return { ok: false, reason: "plan steps not an array" };
    steps = parsed as PlanStep[];
  } catch {
    return { ok: false, reason: "invalid plan steps JSON" };
  }

  // Reconciliation can satisfy an arrival/inspection intention from existing
  // evidence, but it is not an executed demonstration to imitate as a macro.
  if (steps.some(step => step.resolution)) return { ok: false, reason: "plan includes reconciled rather than executed steps" };
  if (steps.some(step => step.actionType === "wait" || step.waitUntil !== undefined)) return { ok: false, reason: "evidence waits require a condition-preserving procedure format" };

  const procedureSteps = planStepsToProcedureSteps(steps);
  // Episode-local dialogue/evidence IDs describe when a plan was safe to issue,
  // not which reusable behavior was learned. Hash only executable actions so
  // another successful episode reinforces the same actor-owned skill.
  const compiled = storeGoalProcedure(world, agentEid, goalEid, procedureSteps, JSON.stringify(procedureSteps));
  return !compiled.ok && compiled.reason === "procedure too small to compile"
    ? { ok: false, reason: "plan too small to compile" }
    : compiled;
}
