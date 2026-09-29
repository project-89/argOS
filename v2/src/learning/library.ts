/** The cross-session skill library: what residents learned to DO, kept apart
 * from what they lived through. A versioned, human-readable JSON file of
 * abstracted procedures and behaviour trees with their evidence. Worlds are
 * seeded from its promoted entries (memories stay wiped); each session's
 * harvest merges new evidence in, then selection promotes, retires and prunes.
 *
 * Nothing in the library is a fact about a world. Steps name kinds of things
 * and places (queries), never particular entities; they are bound to whatever
 * the resident can actually perceive at run time. */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { distillPickRule, MAX_SLOT_CHOICES, type SlotChoice } from "./slot-rules";

export const SKILL_LIBRARY_FORMAT = "argos-skill-library";
export const SKILL_LIBRARY_VERSION = 1;
export const DEFAULT_SKILL_LIBRARY_PATH = "skills/library.json";

// ---------------------------------------------------------------------------
// Abstract step vocabulary (shared with the procedure executor)
// ---------------------------------------------------------------------------

/** A kind of thing: bound at run time to a visible entity that matches. */
export type TargetQuery = { objectType?: string; kind?: string; traits?: string[]; affordance?: string };
/** A kind of place: bound at run time to a room the resident can reach. */
export type PlaceQuery =
  | { place: "home" }
  | { place: "workplace" }
  | { place: "current" }
  | { place: "room-with"; objectType?: string; kind?: string }
  /** A kind of public place the world names (a square, a cafe, a garden). */
  | { place: "kind"; kind: string };
/** A kind of person: bound at run time to someone perceptible. */
export type PersonQuery =
  /** `rule`: a plain choice learned from the character's own decisions (see
   * decision-leaves distillPickRule); without it, several candidates are a
   * small decision for the character's mind. */
  | { person: "addressee" | "anyone-present"; rule?: "nearest" | "partner" | "liked" | "sameRole" }
  | { person: "role"; role: string };

export type AbstractStep = {
  type: "interact" | "move" | "observe" | "think" | "speak" | "wait";
  /** Interact/observe object. */
  targetQuery?: TargetQuery;
  /** Move destination (or an observed place). */
  placeQuery?: PlaceQuery;
  /** Interact/speak person. */
  person?: PersonQuery;
  /** Affordance (interact) or words with {addressee}/{person}/{object}/{place} placeholders. */
  content?: string;
};

export type SkillScope = "general" | { scenario: string };
export type SkillStatus = "candidate" | "promoted" | "retired";

export type LibraryTrigger =
  /** A multi-step "how I did it" macro, started when a similar intention is on top. */
  | { type: "goal"; goalPattern: string[]; goalExample: string }
  /** A single remembered affordance use (habit), matched by plan steps. */
  | { type: "affordance"; affordance: string; requiredTraits?: string[]; toolId?: string }
  /** A named behaviour-tree skill. */
  | { type: "skill"; description: string };

export type LibraryProvenance = { run: string; scenario?: string; role?: string; resident?: string; at: string; source: "learned" | "seeded-use" };

export type LibraryStats = {
  attempts: number; successes: number;
  runsSeen: number; runsSucceeded: number;
  firstSeen: string; lastSeen: string;
  /** Run index (library.runIndex at harvest) of the last run that observed / succeeded / used it. */
  lastSeenRun: number; lastSucceededRun: number; lastUsedRun: number;
};

export type LibraryEntry = {
  id: string;
  kind: "procedure" | "behavior_tree";
  name: string;
  abstractSignature: string;
  trigger: LibraryTrigger;
  steps?: AbstractStep[];
  /** Abstract behaviour tree (BehaviorNode JSON) for kind "behavior_tree". */
  tree?: unknown;
  scope: SkillScope;
  stats: LibraryStats;
  status: SkillStatus;
  /** Recorded choices per step index (who to turn to), until a rule hardens the slot. */
  slotChoices?: Record<string, SlotChoice[]>;
  /** Run index at which the entry was retired (for pruning). */
  retiredAtRun?: number;
  provenance: LibraryProvenance[];
};

export type LibraryRunRecord = { run: string; index: number; scenario?: string; at: string;
  harvested: number; newEntries: number; promoted: number; retired: number; pruned: number; size: number };

export type SkillLibrary = {
  format: typeof SKILL_LIBRARY_FORMAT;
  version: typeof SKILL_LIBRARY_VERSION;
  updatedAt: string;
  /** Number of harvests merged so far. */
  runIndex: number;
  runs: LibraryRunRecord[];
  entries: LibraryEntry[];
};

export type SelectionPolicy = {
  /** Promotion: at least this many successes ... */
  promoteMinSuccesses: number;
  /** ... in at least this many distinct runs ... */
  promoteMinRuns: number;
  /** ... with at least this success rate. */
  promoteMinRate: number;
  /** A promoted entry whose rate falls below this (after demoteMinAttempts) is retired. */
  retireBelowRate: number;
  demoteMinAttempts: number;
  /** Candidates not observed for this many runs are retired. */
  retireUnseenRuns: number;
  /** Retired entries are removed after this many further runs. */
  pruneRetiredAfterRuns: number;
  /** Hard cap on library size; the weakest entries go first. */
  maxEntries: number;
};

export const DEFAULT_SELECTION_POLICY: SelectionPolicy = Object.freeze({
  promoteMinSuccesses: 2, promoteMinRuns: 2, promoteMinRate: 0.6,
  retireBelowRate: 0.3, demoteMinAttempts: 5,
  retireUnseenRuns: 8, pruneRetiredAfterRuns: 20, maxEntries: 500,
});

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

export function emptySkillLibrary(): SkillLibrary {
  return { format: SKILL_LIBRARY_FORMAT, version: SKILL_LIBRARY_VERSION, updatedAt: new Date(0).toISOString(), runIndex: 0, runs: [], entries: [] };
}

export function resolveLibraryPath(path?: string): string {
  return resolve(path?.trim() || process.env.ARGOS_SKILL_LIBRARY?.trim() || DEFAULT_SKILL_LIBRARY_PATH);
}

/** Missing file: an empty library. A malformed file is an error, never silently replaced. */
export function loadSkillLibrary(path: string): SkillLibrary {
  const file = resolve(path);
  if (!existsSync(file)) return emptySkillLibrary();
  const raw = JSON.parse(readFileSync(file, "utf8"));
  return validateSkillLibrary(raw);
}

export function validateSkillLibrary(raw: unknown): SkillLibrary {
  const value = raw as Partial<SkillLibrary> | null;
  if (!value || typeof value !== "object" || value.format !== SKILL_LIBRARY_FORMAT)
    throw new Error("Not an Argos skill library (format mismatch)");
  if (value.version !== SKILL_LIBRARY_VERSION) throw new Error(`Unsupported skill library version ${String(value.version)}`);
  if (!Array.isArray(value.entries) || !Number.isSafeInteger(value.runIndex) || !Array.isArray(value.runs))
    throw new Error("Malformed skill library");
  for (const entry of value.entries) {
    if (!entry || typeof entry.id !== "string" || typeof entry.abstractSignature !== "string"
      || !["procedure", "behavior_tree"].includes(entry.kind) || !["candidate", "promoted", "retired"].includes(entry.status)
      || !entry.stats || typeof entry.stats.attempts !== "number" || !entry.trigger || !Array.isArray(entry.provenance))
      throw new Error(`Malformed skill library entry ${String(entry?.id)}`);
    if (entry.kind === "procedure" && (!Array.isArray(entry.steps) || !entry.steps.length))
      throw new Error(`Procedure entry ${entry.id} has no steps`);
  }
  return value as SkillLibrary;
}

/** Atomic: write a sibling temp file, then rename over the target. */
export function saveSkillLibrary(path: string, library: SkillLibrary): void {
  const file = resolve(path);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify(library, null, 2) + "\n", "utf8");
  renameSync(tmp, file);
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

/** One harvested piece of evidence about an abstract skill in one run. */
export type SkillObservation = {
  /** Seeded use: the character's choices in this skill's person slots, by step index. */
  slotChoices?: Record<string, SlotChoice[]>;
  kind: LibraryEntry["kind"];
  name: string;
  abstractSignature: string;
  trigger: LibraryTrigger;
  steps?: AbstractStep[];
  tree?: unknown;
  scope: SkillScope;
  attempts: number;
  successes: number;
  provenance: Omit<LibraryProvenance, "at">;
  /** Runtime use of a seeded entry (known id); never creates a new entry. */
  entryId?: string;
};

export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index++) { hash ^= input.charCodeAt(index); hash = Math.imul(hash, 0x01000193); }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
export function libraryEntryId(abstractSignature: string): string {
  return `sk-${fnv1a(abstractSignature)}${fnv1a(`~${abstractSignature}`).slice(0, 4)}`;
}

const MAX_PROVENANCE = 20;

export type MergeReport = { observed: number; newEntries: string[]; updated: string[]; ignored: number;
  /** Observations folded into an existing macro with the same steps and a similar intention. */
  generalized: string[];
  /** Person slots that became a plain rule ("entry#step:rule"). */
  hardened: string[] };

const stepsPart = (signature: string) => signature.split("|").slice(2).join("|");
/** Same steps, same scope, an intention with the same core words: one skill.
 * Its pattern narrows to the shared core, so it matches future rewordings. */
function findNearDuplicate(entries: LibraryEntry[], obs: SkillObservation): LibraryEntry | undefined {
  if (obs.trigger.type !== "goal" || obs.kind !== "procedure") return undefined;
  const pattern = new Set(obs.trigger.goalPattern), steps = stepsPart(obs.abstractSignature), scope = JSON.stringify(obs.scope);
  let best: LibraryEntry | undefined, bestShared = 0;
  for (const entry of entries) {
    if (entry.kind !== "procedure" || entry.trigger.type !== "goal" || stepsPart(entry.abstractSignature) !== steps
      || JSON.stringify(entry.scope) !== scope) continue;
    const shared = entry.trigger.goalPattern.filter(word => pattern.has(word)).length;
    if (shared >= 2 && shared / Math.min(pattern.size, entry.trigger.goalPattern.length) >= 0.5 && shared > bestShared) { best = entry; bestShared = shared; }
  }
  return best;
}

/** Keep this run's person-slot choices; a slot whose choices all follow one
 * plain rule becomes that rule (the character is no longer asked there). */
function hardenSlots(entry: LibraryEntry, choices: Record<string, SlotChoice[]>, report: MergeReport): void {
  for (const [index, rows] of Object.entries(choices)) {
    const step = entry.steps?.[Number(index)];
    if (!step?.person || step.person.person === "role" || step.person.rule || !rows.length) continue;
    entry.slotChoices ??= {};
    const kept = [...(entry.slotChoices[index] ?? []), ...rows].slice(-MAX_SLOT_CHOICES);
    entry.slotChoices[index] = kept;
    const rule = distillPickRule(kept);
    if (!rule) continue;
    step.person = { ...step.person, rule };
    delete entry.slotChoices[index];
    report.hardened.push(`${entry.id}#${index}:${rule}`);
  }
  if (entry.slotChoices && !Object.keys(entry.slotChoices).length) delete entry.slotChoices;
}

/** Merge one run's observations. Call beginLibraryRun first so runIndex names this run. */
export function mergeObservations(library: SkillLibrary, observations: SkillObservation[], now = new Date()): MergeReport {
  const report: MergeReport = { observed: observations.length, newEntries: [], updated: [], ignored: 0, generalized: [], hardened: [] };
  const byId = new Map(library.entries.map(entry => [entry.id, entry]));
  const at = now.toISOString(), run = library.runIndex;
  for (const obs of observations) {
    const id = obs.entryId ?? libraryEntryId(obs.abstractSignature);
    let entry = byId.get(id);
    if (!entry && !obs.entryId) {
      const near = findNearDuplicate(library.entries, obs);
      if (near && near.trigger.type === "goal" && obs.trigger.type === "goal") {
        const core = near.trigger.goalPattern.filter(word => (obs.trigger as { goalPattern: string[] }).goalPattern.includes(word));
        if (core.length >= 2 && core.length < near.trigger.goalPattern.length) {
          near.trigger = { ...near.trigger, goalPattern: core };
          const [kind] = near.abstractSignature.split("|");
          near.abstractSignature = `${kind}|goal:${[...core].sort().join(",")}|${stepsPart(near.abstractSignature)}`;
        }
        entry = near; report.generalized.push(near.id); // the entry id stays stable for seeded memories
      }
    }
    if (!entry) {
      if (obs.entryId) { report.ignored++; continue; } // a seeded entry since pruned
      entry = { id, kind: obs.kind, name: obs.name, abstractSignature: obs.abstractSignature, trigger: obs.trigger,
        ...(obs.steps ? { steps: obs.steps } : {}), ...(obs.tree !== undefined ? { tree: obs.tree } : {}),
        scope: obs.scope, status: "candidate", provenance: [],
        stats: { attempts: 0, successes: 0, runsSeen: 0, runsSucceeded: 0, firstSeen: at, lastSeen: at,
          lastSeenRun: -1, lastSucceededRun: -1, lastUsedRun: -1 } };
      library.entries.push(entry); byId.set(id, entry); report.newEntries.push(id);
    } else if (!report.updated.includes(id) && !report.newEntries.includes(id)) report.updated.push(id);
    const stats = entry.stats;
    stats.attempts += Math.max(0, Math.round(obs.attempts));
    stats.successes += Math.max(0, Math.min(Math.round(obs.successes), Math.round(obs.attempts)));
    if (stats.lastSeenRun !== run) { stats.runsSeen++; stats.lastSeenRun = run; }
    if (obs.successes > 0 && stats.lastSucceededRun !== run) { stats.runsSucceeded++; stats.lastSucceededRun = run; }
    if (obs.provenance.source === "seeded-use") stats.lastUsedRun = run;
    stats.lastSeen = at;
    // Narrowing scope is always safe: evidence from a story-bound use keeps it scoped.
    if (entry.scope === "general" && obs.scope !== "general") entry.scope = obs.scope;
    // A retired skill that works again earns its way back as a candidate.
    if (entry.status === "retired" && obs.successes > 0) { entry.status = "candidate"; delete entry.retiredAtRun; }
    if (obs.slotChoices) hardenSlots(entry, obs.slotChoices, report);
    entry.provenance.push({ ...obs.provenance, at });
    if (entry.provenance.length > MAX_PROVENANCE) entry.provenance.splice(0, entry.provenance.length - MAX_PROVENANCE);
  }
  return report;
}

// ---------------------------------------------------------------------------
// Select
// ---------------------------------------------------------------------------

export type SelectionReport = { promoted: string[]; retired: string[]; pruned: string[]; capped: string[] };

export const successRate = (entry: LibraryEntry) => entry.stats.attempts > 0 ? entry.stats.successes / entry.stats.attempts : 0;
function strength(entry: LibraryEntry, run: number): number {
  const statusWeight = entry.status === "promoted" ? 1000 : entry.status === "candidate" ? 0 : -1000;
  return statusWeight + successRate(entry) * Math.log2(2 + entry.stats.successes) * 10 + entry.stats.runsSucceeded
    - Math.max(0, run - entry.stats.lastSeenRun) * 0.25;
}

export function selectSkills(library: SkillLibrary, policy: SelectionPolicy = DEFAULT_SELECTION_POLICY): SelectionReport {
  const report: SelectionReport = { promoted: [], retired: [], pruned: [], capped: [] };
  const run = library.runIndex;
  for (const entry of library.entries) {
    const rate = successRate(entry), s = entry.stats;
    if (entry.status === "candidate") {
      if (s.successes >= policy.promoteMinSuccesses && s.runsSucceeded >= policy.promoteMinRuns && rate >= policy.promoteMinRate) {
        entry.status = "promoted"; report.promoted.push(entry.id);
      } else if (run - Math.max(s.lastSeenRun, s.lastUsedRun) >= policy.retireUnseenRuns) {
        entry.status = "retired"; entry.retiredAtRun = run; report.retired.push(entry.id);
      }
    } else if (entry.status === "promoted") {
      if (s.attempts >= policy.demoteMinAttempts && rate < policy.retireBelowRate) {
        entry.status = "retired"; entry.retiredAtRun = run; report.retired.push(entry.id);
      }
    }
  }
  library.entries = library.entries.filter(entry => {
    const prune = entry.status === "retired" && run - (entry.retiredAtRun ?? run) >= policy.pruneRetiredAfterRuns;
    if (prune) report.pruned.push(entry.id);
    return !prune;
  });
  if (library.entries.length > policy.maxEntries) {
    const ranked = [...library.entries].sort((a, b) => strength(b, run) - strength(a, run) || a.id.localeCompare(b.id));
    const keep = new Set(ranked.slice(0, policy.maxEntries).map(entry => entry.id));
    library.entries = library.entries.filter(entry => {
      if (keep.has(entry.id)) return true;
      report.capped.push(entry.id); return false;
    });
  }
  return report;
}

/** Advance the run counter before merging a new run's observations. */
export function beginLibraryRun(library: SkillLibrary): number {
  library.runIndex += 1;
  return library.runIndex;
}

export function recordLibraryRun(library: SkillLibrary, row: Omit<LibraryRunRecord, "index" | "size">): LibraryRunRecord {
  const record = { ...row, index: library.runIndex, size: library.entries.length };
  library.runs.push(record);
  if (library.runs.length > 50) library.runs.splice(0, library.runs.length - 50);
  library.updatedAt = row.at;
  return record;
}

/** Entries a new world may be seeded with. */
export function seedableEntries(library: SkillLibrary, options: { scenarioId?: string; includeCandidates?: boolean }): LibraryEntry[] {
  return library.entries.filter(entry => (entry.status === "promoted" || options.includeCandidates && entry.status === "candidate" && entry.stats.successes > 0)
    && (entry.scope === "general" || !!options.scenarioId && entry.scope.scenario === options.scenarioId));
}
