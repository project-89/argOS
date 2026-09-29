/** Harvest: split learned skills from lived memories at the end of a session.
 * Every resident's procedural memories (own compiled macros, "how I did it"
 * plan records, habits) and learned/compiled behaviour-tree skills are
 * abstracted into library observations; seeded library skills contribute only
 * their run-time outcomes. Episodic memories, beliefs and relationships are
 * never read here and never leave the world. */
import { hasComponent, query } from "bitecs";
import type { World } from "../ecs/world";
import { Agent, Mind, Name } from "../ecs/components";
import { getAgentProceduralSkills, getProcedureOutcomes, type ProcedureOutcome } from "../cognition/procedural-skills";
import { listSkills } from "../cognition/skill-registry";
import type { SkillObservation } from "./library";
import { abstractBehaviorTree, abstractProcedure, buildNameIndex } from "./abstraction";
import { getSkillWorldAdapter } from "./world-adapter";
import { getDecisionLog } from "../cognition/decision-leaves";
import type { SlotChoice } from "./slot-rules";

export type RegistryBaseline = Map<string, { attempts: number; successes: number }>;
export const SEEDED_SKILL_PREFIX = "lib:";

export function snapshotRegistryBaseline(): RegistryBaseline {
  return new Map(listSkills().map(skill => [skill.name, { attempts: skill.attemptCount, successes: skill.successCount }]));
}

export type HarvestSkip = { resident?: string; skill: string; reason: string };
export type HarvestResult = {
  observations: SkillObservation[];
  /** Learned (not seeded) skills that abstracted successfully. */
  learned: number;
  /** Seeded library skills that were used this run. */
  seededUses: number;
  considered: number;
  skipped: HarvestSkip[];
};

const LEARNED_ORIGINS = new Set(["learned", "compiled", "generated"]);

/** The character's own choices (model answers) in this skill's person slots, by step index. */
function personSlotChoices(world: World, signature: string): Record<string, SlotChoice[]> | undefined {
  const prefix = `skill:${signature}:`, out: Record<string, SlotChoice[]> = {};
  for (const row of getDecisionLog(world)) {
    if (row.kind !== "pick" || row.source !== "model" || row.index === undefined || !row.features || !row.slot.startsWith(prefix) || !row.slot.endsWith(":person")) continue;
    const index = row.slot.slice(prefix.length, -":person".length);
    if (!/^\d+$/.test(index)) continue;
    (out[index] ??= []).push({ index: row.index, features: row.features });
  }
  return Object.keys(out).length ? out : undefined;
}

export function harvestWorldSkills(world: World, options: { run: string; scenarioId?: string; registryBaseline?: RegistryBaseline }): HarvestResult {
  const scenario = options.scenarioId ?? getSkillWorldAdapter(world).scenarioId;
  const index = buildNameIndex(world);
  const outcomes = new Map<string, ProcedureOutcome>(getProcedureOutcomes(world).map(row => [`${row.agentEid}\u0000${row.signature}`, row]));
  const result: HarvestResult = { observations: [], learned: 0, seededUses: 0, considered: 0, skipped: [] };

  for (const agent of query(world, [Agent, Name])) {
    if (!hasComponent(world, agent, Mind)) continue;
    const resident = String(Name.value[agent] || ""), role = String(Agent.role[agent] || "").slice(0, 120) || undefined;
    const provenance = { run: options.run, ...(scenario ? { scenario } : {}), ...(role ? { role } : {}), resident };
    // One resident's several records of the same abstract skill (a goal macro
    // and a plan record of the same episode) are one piece of evidence.
    const mine = new Map<string, SkillObservation>();
    for (const { skill } of getAgentProceduralSkills(world, agent)) {
      result.considered++;
      const used = outcomes.get(`${agent}\u0000${skill.signature}`);
      const settledOk = used?.completed ?? 0, settledFail = used?.failed ?? 0;
      if (skill.library) {
        // Plan-step uses of a seeded habit reinforce its stored stats directly.
        const habitOk = Math.max(0, skill.stats.successes - (skill.library.seededSuccesses ?? skill.stats.successes));
        const habitFail = Math.max(0, skill.stats.failures - (skill.library.seededFailures ?? skill.stats.failures));
        if ((!used || used.started === 0) && habitOk + habitFail === 0) continue;
        result.seededUses++;
        const slotChoices = personSlotChoices(world, skill.signature);
        result.observations.push({ entryId: skill.library.entryId, kind: "procedure", name: skill.name, abstractSignature: "", trigger: { type: "skill", description: "" },
          scope: "general", attempts: settledOk + settledFail + habitOk + habitFail, successes: settledOk + habitOk, provenance: { ...provenance, source: "seeded-use" },
          ...(slotChoices ? { slotChoices } : {}) });
        continue;
      }
      const abstracted = abstractProcedure(world, agent, skill, index);
      if (!abstracted.ok) { result.skipped.push({ resident, skill: skill.name, reason: abstracted.reason }); continue; }
      const successes = Math.max(0, skill.stats.successes) + settledOk;
      const attempts = successes + Math.max(0, skill.stats.failures) + settledFail;
      if (successes === 0 && attempts === 0) continue;
      const prior = mine.get(abstracted.skill.abstractSignature);
      if (prior) { prior.successes = Math.max(prior.successes, successes); prior.attempts = Math.max(prior.attempts, attempts); continue; }
      mine.set(abstracted.skill.abstractSignature, { ...abstracted.skill, attempts, successes, provenance: { ...provenance, source: "learned" } });
    }
    result.learned += mine.size;
    result.observations.push(...mine.values());
  }

  // Behaviour-tree skills live in a process-wide registry: count only what
  // changed since this session began (its baseline), never earlier sessions.
  for (const skill of listSkills()) {
    if (skill.origin === "builtin" || !LEARNED_ORIGINS.has(skill.origin)) continue;
    const before = options.registryBaseline?.get(skill.name);
    const attemptsDelta = skill.attemptCount - (before?.attempts ?? 0), successDelta = skill.successCount - (before?.successes ?? 0);
    const provenance = { run: options.run, ...(scenario ? { scenario } : {}) };
    if (skill.name.startsWith(SEEDED_SKILL_PREFIX)) {
      if (attemptsDelta <= 0) continue;
      result.seededUses++;
      result.observations.push({ entryId: skill.name.slice(SEEDED_SKILL_PREFIX.length), kind: "behavior_tree", name: skill.name, abstractSignature: "",
        trigger: { type: "skill", description: "" }, scope: "general", attempts: attemptsDelta, successes: Math.max(0, successDelta), provenance: { ...provenance, source: "seeded-use" } });
      continue;
    }
    if (before && attemptsDelta <= 0 && successDelta <= 0) continue; // an earlier session's skill, unused here
    result.considered++;
    const abstracted = abstractBehaviorTree(world, skill.name, skill.description, skill.tree, index);
    if (!abstracted.ok) { result.skipped.push({ skill: skill.name, reason: abstracted.reason }); continue; }
    // A compiled/learned tree exists because an episode succeeded.
    const successes = before ? Math.max(0, successDelta) : Math.max(skill.origin === "generated" ? 0 : 1, skill.successCount);
    const attempts = Math.max(successes, before ? attemptsDelta : skill.attemptCount);
    if (attempts === 0) continue;
    result.learned++;
    result.observations.push({ ...abstracted.skill, attempts, successes, provenance: { ...provenance, source: "learned" } });
  }
  return result;
}
