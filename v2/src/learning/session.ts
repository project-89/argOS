/** One world's connection to the skill library: seed at start, harvest once at
 * the end. Memories are never carried over; only abstract skills are. */
import { addComponent, addEntity, hasComponent, query } from "bitecs";
import { randomBytes } from "node:crypto";
import type { World } from "../ecs/world";
import { Agent, Memory, Mind } from "../ecs/components";
import { HasMemory } from "../ecs/relations";
import { getAgentProceduralSkills, proceduralSignature, serializeProceduralSkillV1, type ProceduralSkillV1 } from "../cognition/procedural-skills";
import { upsertSkill } from "../cognition/skill-registry";
import type { BehaviorNode } from "../cognition/behavior-policy";
import {
  beginLibraryRun, DEFAULT_SELECTION_POLICY, loadSkillLibrary, mergeObservations, recordLibraryRun, resolveLibraryPath, saveSkillLibrary,
  seedableEntries, selectSkills, type LibraryEntry, type SelectionPolicy, type SkillLibrary,
} from "./library";
import { harvestWorldSkills, SEEDED_SKILL_PREFIX, snapshotRegistryBaseline, type HarvestSkip, type RegistryBaseline } from "./harvest";
import { hasPlaceholder } from "./binding";

export interface SkillLibraryConfig {
  /** Library file (versioned JSON). Default ARGOS_SKILL_LIBRARY or skills/library.json. */
  path?: string;
  /** Give residents the library's promoted skills at world start (default true). */
  seed?: boolean;
  /** Harvest learned skills into the library when the world stops (default true). */
  harvest?: boolean;
  /** Authored scenario id: story-bound skills are scoped to it. */
  scenarioId?: string;
  /** Run label recorded in provenance. */
  run?: string;
  /** Training exploration: also seed candidates with at least one success, so
   * later runs can test them (default false; ordinary play seeds promoted only). */
  seedCandidates?: boolean;
  /** Selection overrides. */
  policy?: Partial<SelectionPolicy>;
}

export type SkillSeedReport = { path: string; entries: number; promoted: number; trial: number; residents: number; memories: number; behaviorTrees: number; skipped: number };
export type SkillHarvestReport = {
  path: string; run: string; runIndex: number;
  harvested: number; seededUses: number; considered: number;
  newEntries: Array<{ id: string; name: string; scope: LibraryEntry["scope"] }>;
  updated: number;
  /** Reworded repeats folded into an existing skill (its intention pattern narrowed). */
  generalized: number;
  promoted: Array<{ id: string; name: string }>; retired: Array<{ id: string; name: string }>;
  pruned: number; capped: number; size: number; statusCounts: Record<string, number>;
  skipped: HarvestSkip[];
};

export interface SkillLibrarySession {
  readonly path: string;
  readonly run: string;
  seed(): SkillSeedReport;
  /** Idempotent: the first call harvests and writes; later calls return the same report. */
  harvest(): SkillHarvestReport | undefined;
  readonly seedReport?: SkillSeedReport;
  readonly harvestReport?: SkillHarvestReport;
}

function toProcedure(entry: LibraryEntry, run: string): ProceduralSkillV1 | undefined {
  const steps = (entry.steps ?? []).map(step => ({
    type: step.type,
    ...(step.targetQuery ? { targetQuery: step.targetQuery } : {}),
    ...(step.placeQuery ? { placeQuery: step.placeQuery } : {}),
    ...(step.person ? { person: step.person } : {}),
    ...(step.content ? { content: step.content } : step.type === "interact" && step.targetQuery?.affordance ? { content: step.targetQuery.affordance } : {}),
  })) as ProceduralSkillV1["steps"];
  if (!steps.length) return undefined;
  const now = Date.now();
  const stats = { successes: Math.max(1, entry.stats.successes), failures: Math.max(0, entry.stats.attempts - entry.stats.successes), createdAt: now, lastUsedAt: 0 };
  const library = { entryId: entry.id, status: entry.status === "promoted" ? "promoted" as const : "candidate" as const, run,
    seededSuccesses: stats.successes, seededFailures: stats.failures };
  if (entry.trigger.type === "goal") {
    return { kind: "procedure_v1", signature: `${SEEDED_SKILL_PREFIX}${entry.id}`, name: entry.name,
      trigger: { affordance: "__goal_macro__", goalPattern: [...entry.trigger.goalPattern] }, steps, stats, library };
  }
  if (entry.trigger.type === "affordance") {
    const content = steps[0]?.content ?? entry.trigger.affordance;
    if (hasPlaceholder(content)) return undefined; // a habit's words must be literal to match plan steps
    const args = content.split(/\s+/).slice(1).join(" ");
    return { kind: "procedure_v1", signature: proceduralSignature({ affordance: entry.trigger.affordance, args }), name: entry.name,
      trigger: { affordance: entry.trigger.affordance, ...(entry.trigger.requiredTraits ? { requiredTraits: entry.trigger.requiredTraits } : {}),
        ...(entry.trigger.toolId ? { toolId: entry.trigger.toolId } : {}) }, steps, stats, library };
  }
  return undefined;
}

function residents(world: World): number[] {
  return [...query(world, [Agent, Mind])].filter(eid => !!Agent.active[eid]);
}

/** Give each resident the library's seedable procedures as procedural memories. */
export function seedWorldFromLibrary(world: World, library: SkillLibrary, options: { scenarioId?: string; seedCandidates?: boolean; run: string; path: string }): SkillSeedReport {
  const entries = seedableEntries(library, { scenarioId: options.scenarioId, includeCandidates: options.seedCandidates });
  const report: SkillSeedReport = { path: options.path, entries: entries.length, promoted: entries.filter(e => e.status === "promoted").length,
    trial: entries.filter(e => e.status === "candidate").length, residents: 0, memories: 0, behaviorTrees: 0, skipped: 0 };
  const procedures = entries.filter(e => e.kind === "procedure").map(e => toProcedure(e, options.run));
  report.skipped += procedures.filter(p => !p).length;
  const now = Date.now();
  for (const eid of residents(world)) {
    report.residents++;
    const existing = new Set(getAgentProceduralSkills(world, eid).map(s => s.skill.signature));
    for (const skill of procedures) {
      if (!skill || existing.has(skill.signature)) continue;
      const memory = addEntity(world);
      addComponent(world, memory, Memory);
      addComponent(world, eid, HasMemory(memory));
      Memory.type[memory] = "procedural";
      Memory.content[memory] = serializeProceduralSkillV1(structuredClone(skill));
      Memory.importance[memory] = 0.6;
      Memory.emotionalValence[memory] = 0;
      Memory.timestamp[memory] = now;
      Memory.lastRecalled[memory] = now;
      Memory.recallCount[memory] = 0;
      existing.add(skill.signature);
      report.memories++;
    }
  }
  for (const entry of entries.filter(e => e.kind === "behavior_tree" && e.tree)) {
    upsertSkill({ name: `${SEEDED_SKILL_PREFIX}${entry.id}`, description: entry.trigger.type === "skill" ? entry.trigger.description || entry.name : entry.name,
      origin: "learned", tree: entry.tree as BehaviorNode });
    report.behaviorTrees++;
  }
  return report;
}

export function attachSkillLibrary(world: World, config: SkillLibraryConfig): SkillLibrarySession {
  const path = resolveLibraryPath(config.path);
  const run = config.run?.trim() || `run-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}`;
  const policy: SelectionPolicy = { ...DEFAULT_SELECTION_POLICY, ...config.policy };
  let baseline: RegistryBaseline = snapshotRegistryBaseline();
  let seedReport: SkillSeedReport | undefined, harvestReport: SkillHarvestReport | undefined, harvested = false;
  const session: SkillLibrarySession = {
    path, run,
    get seedReport() { return seedReport; },
    get harvestReport() { return harvestReport; },
    seed() {
      const library = loadSkillLibrary(path);
      seedReport = seedWorldFromLibrary(world, library, { scenarioId: config.scenarioId, seedCandidates: config.seedCandidates, run, path });
      baseline = snapshotRegistryBaseline();
      console.log(`[Skills] seeded ${seedReport.entries} skills (${seedReport.promoted} promoted, ${seedReport.trial} on trial) into ${seedReport.residents} residents from ${path}`);
      return seedReport;
    },
    harvest() {
      if (harvested) return harvestReport;
      harvested = true;
      const library = loadSkillLibrary(path); // re-read: another session may have written since seeding
      const runIndex = beginLibraryRun(library);
      const result = harvestWorldSkills(world, { run, scenarioId: config.scenarioId, registryBaseline: baseline });
      const merged = mergeObservations(library, result.observations);
      const selected = selectSkills(library, policy);
      const at = new Date().toISOString();
      const byId = new Map(library.entries.map(e => [e.id, e]));
      const label = (id: string) => ({ id, name: byId.get(id)?.name ?? id });
      recordLibraryRun(library, { run, scenario: config.scenarioId, at, harvested: result.learned, newEntries: merged.newEntries.length,
        promoted: selected.promoted.length, retired: selected.retired.length, pruned: selected.pruned.length + selected.capped.length });
      saveSkillLibrary(path, library);
      const statusCounts: Record<string, number> = { candidate: 0, promoted: 0, retired: 0 };
      for (const entry of library.entries) statusCounts[entry.status]++;
      harvestReport = { path, run, runIndex, harvested: result.learned, seededUses: result.seededUses, considered: result.considered,
        newEntries: merged.newEntries.map(id => ({ id, name: byId.get(id)?.name ?? id, scope: byId.get(id)?.scope ?? "general" })),
        updated: merged.updated.length, generalized: merged.generalized.length, promoted: selected.promoted.map(label), retired: selected.retired.map(label),
        pruned: selected.pruned.length, capped: selected.capped.length, size: library.entries.length, statusCounts, skipped: result.skipped };
      console.log(`[Skills] harvested ${result.learned} (${merged.newEntries.length} new, ${result.seededUses} seeded in use), promoted ${selected.promoted.length}, retired ${selected.retired.length}; library ${library.entries.length} entries → ${path}`);
      return harvestReport;
    },
  };
  return session;
}

/** For hosts that check whether a resident carries any library skill. */
export function countSeededSkills(world: World, eid: number): number {
  if (!hasComponent(world, eid, Agent)) return 0;
  return getAgentProceduralSkills(world, eid).filter(s => !!s.skill.library).length;
}
