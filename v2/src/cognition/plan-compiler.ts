import type { World } from "../ecs/world";
import { addComponent, addEntity, hasComponent } from "bitecs";
import { Goal, Memory, Plan } from "../ecs/components";
import { HasMemory } from "../ecs/relations";
import { ensureGoalSignature, goalSignatureId } from "./goal-contract";
import {
  getProceduralSkillBySignature,
  serializeProceduralSkillV1,
  type ProceduralSkillV1,
} from "./procedural-skills";

type PlanStep = {
  description: string;
  actionType: "speak" | "move" | "interact" | "observe" | "think" | "wait";
  target?: string;
  content?: string;
  estimatedDuration?: string;
  prerequisites?: string[];
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

  const goalDesc = String(Goal.description[goalEid] || "").trim();
  if (!goalDesc) return { ok: false, reason: "empty goal description" };

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

  const procedureSteps = planStepsToProcedureSteps(steps);
  const meaningful = procedureSteps.filter((s) => s.type !== "wait").length;
  if (meaningful < 2) return { ok: false, reason: "plan too small to compile" };

  const signature = buildMacroSignatureForGoal(world, goalEid, goalDesc, stepsJson);
  const now = Date.now();

  const existing = getProceduralSkillBySignature(world, agentEid, signature);
  if (existing) {
    const skill = existing.skill;
    skill.stats.lastUsedAt = now;
    skill.stats.successes += 1;
    // Keep the latest compiled steps (plans can drift).
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
    trigger: {
      // Special marker affordance; this is not executed directly, but used for matching/auto-starting.
      affordance: "__goal_macro__",
    },
    steps: procedureSteps,
    stats: {
      successes: 1,
      failures: 0,
      createdAt: now,
      lastUsedAt: now,
    },
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
