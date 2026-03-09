import type { World } from "../ecs/world";
import { addComponent, addEntity, getRelationTargets, hasComponent, removeComponent } from "bitecs";
import { Agent, Goal, Memory, Name, Perception, ProcedureState } from "../ecs/components";
import { HasMemory } from "../ecs/relations";
import { HasPerception } from "../ecs/relations";
import { HasGoal } from "../ecs/relations";
import { getNextPlannedAction } from "./planning-system";
import { getRoomForEntity } from "../ecs/location";
import { ensureGoalSignature, goalSignatureId } from "./goal-contract";

export type AgentActionLike = {
  type: string;
  target?: string;
  content?: string;
};

export type ProceduralSkillV1 = {
  kind: "procedure_v1";
  signature: string;
  name: string;
  trigger: {
    affordance: string;
    requiredTraits?: string[];
    toolId?: string;
  };
  example?: {
    targetName?: string;
    args?: string;
  };
  steps: Array<{
    type: "interact" | "move" | "observe" | "think" | "speak" | "wait" | "await";
    target?: string;
    content?: string;
    waitFor?: {
      perceptionType: string;
      includes?: string;
    };
    onMatchNext?: number;
    onMismatchNext?: number;
    onSuccessNext?: number;
    onFailureNext?: number;
  }>;
  stats: {
    successes: number;
    failures: number;
    createdAt: number;
    lastUsedAt: number;
  };
};

export function parseProceduralSkillV1(content: string): ProceduralSkillV1 | null {
  const raw = String(content || "").trim();
  if (!raw) return null;

  let jsonText = raw;
  if (raw.startsWith("[ProcedureV1]")) {
    jsonText = raw.slice("[ProcedureV1]".length).trim();
  }

  try {
    const obj = JSON.parse(jsonText);
    if (!obj || obj.kind !== "procedure_v1") return null;
    if (typeof obj.signature !== "string" || typeof obj.name !== "string") return null;
    if (!obj.trigger || typeof obj.trigger.affordance !== "string") return null;
    if (!Array.isArray(obj.steps)) return null;
    if (!obj.stats || typeof obj.stats.successes !== "number") return null;
    return obj as ProceduralSkillV1;
  } catch {
    return null;
  }
}

export function serializeProceduralSkillV1(skill: ProceduralSkillV1): string {
  return `[ProcedureV1] ${JSON.stringify(skill)}`;
}

export function proceduralSignature(input: { affordance: string; args?: string; toolId?: string }): string {
  const affordance = input.affordance.trim().toLowerCase();
  const args = (input.args || "").trim();
  return `${affordance}|${args}`;
}

export function getAgentProceduralSkills(world: World, agentEid: number): Array<{ memoryEid: number; skill: ProceduralSkillV1 }> {
  if (!hasComponent(world as any, agentEid, Agent as any)) return [];
  const memoryEids = getRelationTargets(world as any, agentEid, HasMemory as any)
    .filter((eid: number) => hasComponent(world as any, eid, Memory as any))
    .filter((eid: number) => String(Memory.type[eid] || "") === "procedural");

  const skills: Array<{ memoryEid: number; skill: ProceduralSkillV1 }> = [];
  for (const eid of memoryEids) {
    const parsed = parseProceduralSkillV1(String(Memory.content[eid] || ""));
    if (parsed) skills.push({ memoryEid: eid, skill: parsed });
  }
  return skills;
}

export function getProceduralSkillBySignature(
  world: World,
  agentEid: number,
  signature: string
): { memoryEid: number; skill: ProceduralSkillV1 } | undefined {
  const skills = getAgentProceduralSkills(world, agentEid);
  return skills.find((s) => s.skill.signature === signature);
}

function startProcedureExecution(world: World, agentEid: number, signature: string): void {
  addComponent(world as any, agentEid, ProcedureState as any);
  ProcedureState.signature[agentEid] = signature;
  ProcedureState.stepIndex[agentEid] = 0;
  ProcedureState.status[agentEid] = "active";
  const now = Date.now();
  ProcedureState.startedAt[agentEid] = now;
  ProcedureState.lastUpdatedAt[agentEid] = now;
}

function clearProcedureExecution(world: World, agentEid: number): void {
  if (!hasComponent(world as any, agentEid, ProcedureState as any)) return;
  removeComponent(world as any, agentEid, ProcedureState as any);
}

function tryCompleteGoalFromMacro(world: World, agentEid: number, signature: string): void {
  const sig = String(signature || "");
  if (!sig.startsWith("goal:") && !sig.startsWith("goalid:")) return;

  const bar = sig.indexOf("|");
  if (bar <= 0) return;
  const prefix = sig.startsWith("goalid:") ? "goalid:" : "goal:";
  if (bar <= prefix.length) return;
  const token = sig.slice(prefix.length, bar).trim().toLowerCase();
  if (!token) return;

  const goalEids = getRelationTargets(world as any, agentEid, HasGoal as any)
    .filter((eid: number) => hasComponent(world as any, eid, Goal as any))
    .filter((eid: number) => String(Goal.status[eid] || "") === "active")
    .sort((a: number, b: number) => (Goal.priority[b] || 0) - (Goal.priority[a] || 0));

  for (const gid of goalEids) {
    if (prefix === "goalid:") {
      const goalSig = ensureGoalSignature(world, gid);
      if (!goalSig) continue;
      const id = goalSignatureId(goalSig);
      if (id.toLowerCase() !== token) continue;
    } else {
      const desc = String(Goal.description[gid] || "").trim();
      if (!desc) continue;
      if (normalizeGoalKey(desc) !== token) continue;
    }
    // If the goal has a deterministically-evaluable success contract, do NOT mark it complete here.
    // Completion should be driven by GoalEvaluationSystem based on world state evidence.
    const rawSuccess = String(Goal.successJson?.[gid] || "").trim();
    if (rawSuccess) {
      try {
        const parsed = JSON.parse(rawSuccess);
        const t = String(parsed?.type || "");
        if (t && t !== "custom") {
          Goal.progress[gid] = Math.max(Goal.progress[gid] || 0, 95);
          return;
        }
      } catch {
        // Ignore and fall through.
      }
    }

    Goal.status[gid] = "completed";
    Goal.progress[gid] = 100;
    return;
  }
}

function finishProcedureExecution(world: World, agentEid: number, signature: string, status: "completed" | "failed"): void {
  if (!hasComponent(world as any, agentEid, ProcedureState as any)) return;
  ProcedureState.status[agentEid] = status;
  ProcedureState.lastUpdatedAt[agentEid] = Date.now();
  if (status === "completed") {
    tryCompleteGoalFromMacro(world, agentEid, signature);
  }
  clearProcedureExecution(world, agentEid);
}

export function tryStartProcedureExecution(
  world: World,
  agentEid: number,
  signature: string,
  opts?: { minSuccesses?: number }
): boolean {
  if (!hasComponent(world as any, agentEid, Agent as any)) return false;
  const sig = String(signature || "").trim();
  if (!sig) return false;

  const minSuccesses = Number.isFinite(Number(opts?.minSuccesses)) ? Math.max(0, Math.min(100, Number(opts?.minSuccesses))) : 2;
  const found = getProceduralSkillBySignature(world, agentEid, sig);
  if (!found) return false;
  if ((found.skill.stats?.successes || 0) < minSuccesses) return false;

  startProcedureExecution(world, agentEid, sig);
  return true;
}

export function onProcedureActionResult(
  world: World,
  agentEid: number,
  action: AgentActionLike,
  outcome: { success: boolean }
): void {
  if (!hasComponent(world as any, agentEid, ProcedureState as any)) return;
  if (String(ProcedureState.status[agentEid] || "") !== "active") {
    clearProcedureExecution(world, agentEid);
    return;
  }

  const signature = String(ProcedureState.signature[agentEid] || "");
  if (!signature) {
    clearProcedureExecution(world, agentEid);
    return;
  }

  const found = getProceduralSkillBySignature(world, agentEid, signature);
  if (!found) {
    clearProcedureExecution(world, agentEid);
    return;
  }

  const stepIndex = ProcedureState.stepIndex[agentEid] || 0;
  const step = found.skill.steps[stepIndex];
  if (!step) {
    clearProcedureExecution(world, agentEid);
    return;
  }

  // "move" steps are advanced by checking location inside the selector (not via action result).
  if (step.type === "move") return;
  // "await" steps are advanced inside the selector (based on Perceptions).
  if (step.type === "await") return;

  const typeMatches = String(action.type || "").toLowerCase() === String(step.type || "").toLowerCase();
  if (!typeMatches) return;

  const contentMatches =
    !step.content ||
    String(action.content || "").trim().toLowerCase() === String(step.content || "").trim().toLowerCase();
  if (!contentMatches) return;

  const targetMatches =
    !step.target || String(action.target || "").trim().toLowerCase() === String(step.target || "").trim().toLowerCase();
  if (!targetMatches) return;

  if (!outcome.success) {
    if (typeof step.onFailureNext === "number") {
      ProcedureState.stepIndex[agentEid] = step.onFailureNext;
      ProcedureState.lastUpdatedAt[agentEid] = Date.now();
      return;
    }
    ProcedureState.status[agentEid] = "failed";
    ProcedureState.lastUpdatedAt[agentEid] = Date.now();
    clearProcedureExecution(world, agentEid);
    return;
  }

  const nextIndex = typeof step.onSuccessNext === "number" ? step.onSuccessNext : (stepIndex + 1);
  ProcedureState.stepIndex[agentEid] = nextIndex;
  ProcedureState.lastUpdatedAt[agentEid] = Date.now();
  if (nextIndex >= found.skill.steps.length) {
    finishProcedureExecution(world, agentEid, signature, "completed");
  }
}

export function upsertProceduralSkillFromInteraction(
  world: World,
  agentEid: number,
  data: {
    affordance: string;
    args?: string;
    toolId?: string;
    requiredTraits?: string[];
    targetName?: string;
    success: boolean;
  }
): void {
  if (!hasComponent(world as any, agentEid, Agent as any)) return;

  const affordance = data.affordance.trim();
  if (!affordance) return;

  const signature = proceduralSignature({ affordance, args: data.args, toolId: data.toolId });
  const now = Date.now();

  const existing = getAgentProceduralSkills(world, agentEid).find((s) => s.skill.signature === signature);
  if (existing) {
    const skill = existing.skill;
    skill.stats.lastUsedAt = now;
    if (data.success) skill.stats.successes += 1;
    else skill.stats.failures += 1;

    if (data.targetName) skill.example = { ...(skill.example || {}), targetName: data.targetName };
    if (typeof data.args === "string") skill.example = { ...(skill.example || {}), args: data.args };

    Memory.content[existing.memoryEid] = serializeProceduralSkillV1(skill);
    Memory.lastRecalled[existing.memoryEid] = now;
    Memory.recallCount[existing.memoryEid] = (Memory.recallCount[existing.memoryEid] || 0) + 1;
    return;
  }

  const newSkill: ProceduralSkillV1 = {
    kind: "procedure_v1",
    signature,
    name: data.toolId
      ? `Use ${affordance} (${data.toolId})`
      : `Use ${affordance}`,
    trigger: {
      affordance,
      requiredTraits: data.requiredTraits?.slice(0, 6),
      toolId: data.toolId,
    },
    example: {
      targetName: data.targetName,
      args: (data.args || "").trim() || undefined,
    },
    steps: [
      {
        type: "interact",
        target: data.targetName,
        content: `${affordance}${data.args && data.args.trim() ? ` ${data.args.trim()}` : ""}`,
      },
    ],
    stats: {
      successes: data.success ? 1 : 0,
      failures: data.success ? 0 : 1,
      createdAt: now,
      lastUsedAt: now,
    },
  };

  const memoryEid = addEntity(world as any);
  addComponent(world as any, memoryEid, Memory as any);
  addComponent(world as any, agentEid, HasMemory(memoryEid) as any);

  Memory.type[memoryEid] = "procedural";
  Memory.content[memoryEid] = serializeProceduralSkillV1(newSkill);
  Memory.importance[memoryEid] = 0.65;
  Memory.emotionalValence[memoryEid] = 0;
  Memory.timestamp[memoryEid] = now;
  Memory.lastRecalled[memoryEid] = now;
  Memory.recallCount[memoryEid] = 0;
}

export function formatProceduralSkillsForContext(world: World, agentEid: number, limit: number = 6): string {
  const skills = getAgentProceduralSkills(world, agentEid)
    .map((s) => s.skill)
    .sort((a, b) => (b.stats.successes - a.stats.successes) || (b.stats.lastUsedAt - a.stats.lastUsedAt))
    .slice(0, limit);

  if (skills.length === 0) return "";

  const lines: string[] = [];
  lines.push("SKILLS (PROCEDURAL):");
  for (const s of skills) {
    const req = s.trigger.requiredTraits?.length ? ` requires: ${s.trigger.requiredTraits.join(", ")}` : "";
    const stats = `(${s.stats.successes}✓/${s.stats.failures}✗)`;
    const exampleArgs = s.example?.args ? ` ${s.example.args}` : "";
    lines.push(`  - ${s.name} ${stats}${req} :: interact "${s.example?.targetName || "<target>"}" "${s.trigger.affordance}${exampleArgs}"`);
  }
  return lines.join("\n");
}

function hasRecentCriticalFailure(world: World, agentEid: number): boolean {
  const perceptionEids = getRelationTargets(world as any, agentEid, HasPerception as any)
    .filter((eid: number) => hasComponent(world as any, eid, Perception as any))
    .sort((a: number, b: number) => (Perception.timestamp[b] || 0) - (Perception.timestamp[a] || 0))
    .slice(0, 3);
  for (const peid of perceptionEids) {
    if (String(Perception.type[peid] || "") !== "action_failed") continue;
    const c = String(Perception.content[peid] || "");
    if (c.includes("FAILED") || c.includes("🚨 CRITICAL")) return true;
  }
  return false;
}

function findEntityByName(world: World, name: string): number | undefined {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return undefined;
  for (let eid = 0; eid < (Name.value as any).length; eid++) {
    const n = Name.value[eid];
    if (typeof n === "string" && n.trim().toLowerCase() === wanted) return eid;
  }
  return undefined;
}

function getLatestPerception(world: World, agentEid: number, type: string): string | undefined {
  const wanted = type.trim();
  if (!wanted) return undefined;
  const perceptionEids = getRelationTargets(world as any, agentEid, HasPerception as any)
    .filter((eid: number) => hasComponent(world as any, eid, Perception as any))
    .filter((eid: number) => String(Perception.type[eid] || "") === wanted)
    .sort((a: number, b: number) => (Perception.timestamp[b] || 0) - (Perception.timestamp[a] || 0))
    .slice(0, 1);
  const peid = perceptionEids[0];
  if (typeof peid !== "number") return undefined;
  return String(Perception.content[peid] || "");
}

function normalizeGoalKey(goalDesc: string): string {
  return goalDesc.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80);
}

function getTopActiveGoalDescription(world: World, agentEid: number): string | null {
  const goalEids = getRelationTargets(world as any, agentEid, HasGoal as any)
    .filter((eid: number) => hasComponent(world as any, eid, Goal as any))
    .filter((eid: number) => String(Goal.status[eid] || "") === "active")
    .sort((a: number, b: number) => (Goal.priority[b] || 0) - (Goal.priority[a] || 0));
  const top = goalEids[0];
  if (typeof top !== "number") return null;
  const desc = String(Goal.description[top] || "").trim();
  return desc || null;
}

function getTopActiveGoalMacroPrefix(world: World, agentEid: number): string | null {
  const goalEids = getRelationTargets(world as any, agentEid, HasGoal as any)
    .filter((eid: number) => hasComponent(world as any, eid, Goal as any))
    .filter((eid: number) => String(Goal.status[eid] || "") === "active")
    .sort((a: number, b: number) => (Goal.priority[b] || 0) - (Goal.priority[a] || 0));
  const top = goalEids[0];
  if (typeof top !== "number") return null;

  const sig = ensureGoalSignature(world, top);
  if (sig) {
    const id = goalSignatureId(sig);
    return `goalid:${id}|`;
  }

  const desc = String(Goal.description[top] || "").trim();
  if (!desc) return null;
  const goalKey = normalizeGoalKey(desc);
  return `goal:${goalKey}|`;
}

export function selectProceduralAction(world: World, agentEid: number): AgentActionLike | null {
  if (!hasComponent(world as any, agentEid, Agent as any)) return null;
  if (hasRecentCriticalFailure(world, agentEid)) return null;

  // Continue an active procedure, if any.
  if (hasComponent(world as any, agentEid, ProcedureState as any)) {
    const signature = String(ProcedureState.signature[agentEid] || "");
    if (!signature) {
      finishProcedureExecution(world, agentEid, signature, "failed");
      return null;
    }
    const found = getProceduralSkillBySignature(world, agentEid, signature);
    if (!found) {
      finishProcedureExecution(world, agentEid, signature, "failed");
      return null;
    }

    // Move step auto-advancement: if a move step's target room is already reached, advance without emitting an action.
    while (true) {
      const idx = ProcedureState.stepIndex[agentEid] || 0;
      const step = found.skill.steps[idx];
      if (!step) {
        finishProcedureExecution(world, agentEid, signature, "failed");
        return null;
      }
      if (step.type !== "move") break;

      const dest = String(step.target || "").trim();
      if (!dest) {
        finishProcedureExecution(world, agentEid, signature, "failed");
        return null;
      }
      const roomEid = getRoomForEntity(world, agentEid);
      const currentRoomName = roomEid !== undefined ? String(Name.value[roomEid] || "") : "";
      if (currentRoomName && currentRoomName.toLowerCase() === dest.toLowerCase()) {
        ProcedureState.stepIndex[agentEid] = idx + 1;
        ProcedureState.lastUpdatedAt[agentEid] = Date.now();
        if (ProcedureState.stepIndex[agentEid] >= found.skill.steps.length) {
          finishProcedureExecution(world, agentEid, signature, "completed");
          return null;
        }
        continue;
      }
      return { type: "move", target: dest };
    }

    // Await step: wait for a perception, then branch/advance.
    while (true) {
      const idx = ProcedureState.stepIndex[agentEid] || 0;
      const step = found.skill.steps[idx];
      if (!step) {
        finishProcedureExecution(world, agentEid, signature, "failed");
        return null;
      }
      if (step.type !== "await") break;

      const waitFor = step.waitFor;
      if (!waitFor || !waitFor.perceptionType) {
        finishProcedureExecution(world, agentEid, signature, "failed");
        return null;
      }

      const latest = getLatestPerception(world, agentEid, waitFor.perceptionType);
      if (!latest) return { type: "wait" };

      const includes = (waitFor.includes || "").trim();
      const match = includes ? latest.toLowerCase().includes(includes.toLowerCase()) : true;
      if (match) {
        ProcedureState.stepIndex[agentEid] = typeof step.onMatchNext === "number" ? step.onMatchNext : idx + 1;
        ProcedureState.lastUpdatedAt[agentEid] = Date.now();
        if (ProcedureState.stepIndex[agentEid] >= found.skill.steps.length) {
          finishProcedureExecution(world, agentEid, signature, "completed");
          return null;
        }
        continue;
      }

      if (typeof step.onMismatchNext === "number") {
        ProcedureState.stepIndex[agentEid] = step.onMismatchNext;
        ProcedureState.lastUpdatedAt[agentEid] = Date.now();
        if (ProcedureState.stepIndex[agentEid] >= found.skill.steps.length) {
          finishProcedureExecution(world, agentEid, signature, "completed");
          return null;
        }
        continue;
      }

      return { type: "wait" };
    }

    const idx = ProcedureState.stepIndex[agentEid] || 0;
    const step = found.skill.steps[idx];
    if (!step) {
      finishProcedureExecution(world, agentEid, signature, "failed");
      return null;
    }

    // Interact precondition: if the step target exists and is in another room, move there first.
    if (step.type === "interact" && step.target) {
      const targetEid = findEntityByName(world, step.target);
      const agentRoomEid = getRoomForEntity(world, agentEid);
      const targetRoomEid = targetEid !== undefined ? getRoomForEntity(world, targetEid) : undefined;
      if (
        agentRoomEid !== undefined &&
        targetRoomEid !== undefined &&
        agentRoomEid !== targetRoomEid
      ) {
        const destName = Name.value[targetRoomEid];
        if (destName) return { type: "move", target: destName };
      }
    }
    return { type: step.type, target: step.target, content: step.content };
  }

  // Goal-macro auto-start: if there is an active goal but no explicit plan step,
  // and we have a compiled macro for that goal, start executing it deterministically.
  const next = getNextPlannedAction(world, agentEid);
  if (!next) {
    const prefix = getTopActiveGoalMacroPrefix(world, agentEid);
    if (prefix) {
      const skills = getAgentProceduralSkills(world, agentEid)
        .map((s) => s.skill)
        .filter((s) => String(s.trigger?.affordance || "") === "__goal_macro__")
        .filter((s) => String(s.signature || "").startsWith(prefix))
        .sort((a, b) => (b.stats.successes - a.stats.successes) || (b.stats.lastUsedAt - a.stats.lastUsedAt));

      const macro = skills[0];
      if (macro && macro.stats.successes >= 1) {
        startProcedureExecution(world, agentEid, macro.signature);
        return selectProceduralAction(world, agentEid);
      }
    }
  }
  if (!next) return null;

  if (next.actionType !== "interact") return null;
  if (!next.target) return null;

  const content = String(next.content || "").trim();
  if (!content) return null;

  const [affordance, ...rest] = content.split(/\s+/);
  const args = rest.join(" ").trim();
  const sig = proceduralSignature({ affordance, args });

  const skills = getAgentProceduralSkills(world, agentEid);
  const skill = skills.find((s) => s.skill.signature === sig)?.skill;
  if (!skill) return null;
  if (skill.stats.successes < 2) return null; // require repetition before auto-executing

  if (skill.steps.length > 1) {
    startProcedureExecution(world, agentEid, skill.signature);
    // Re-enter selection in "active procedure" mode so preconditions/await/move-handling apply
    // to the very first emitted step.
    return selectProceduralAction(world, agentEid);
  }

  return { type: "interact", target: next.target, content };
}
