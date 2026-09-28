/** Private first-person history. Source excerpts remain evidence, while the
 * monologue is explicitly the character's interpretation, never world truth. */
import { randomUUID } from "node:crypto";
import { addComponent, addEntity, entityExists, getRelationTargets, hasComponent } from "bitecs";
import { z } from "zod";
import type { World } from "../ecs/world";
import { Agent, NarrativeEntry, WorkingMemoryIdentity } from "../ecs/components";
import { HasNarrative } from "../ecs/relations";
import { readSimulationTime } from "../ecs/simulation-time";
import { getCommittedEvents } from "../runtime/committed-events";
import { assertSimulationTaskActive } from "../runtime/task-scope";
import { emotionalEpisodeSchema } from "./emotional-life";
import { characterPastSchema, narrativeIdentitySchema, type NarrativeIdentity, type CharacterPast } from "./character-past-schema";
import { workingMemoryEntityRef } from "./working-memory";

const prose = (max: number) => z.string().trim().min(1).max(max).refine(s => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(s));
export const narrativeEvidenceSchema = z.object({ id: prose(200), kind: z.enum(["experience", "dialogue", "memory", "reflection", "thought", "interaction"]),
  content: prose(4000), atSimMs: z.number().finite().nonnegative(),
  role: z.enum(["primary", "context"]).optional(),
  atWallMs: z.number().finite().nonnegative().optional(), timeBasis: z.enum(["simulation", "legacy-estimate"]).optional() }).strict();
const inputSchema = z.object({ kind: z.enum(["experience", "recollection", "learning", "thought"]), monologue: prose(3000),
  identity: z.custom<NarrativeIdentity>(value => narrativeIdentitySchema.safeParse(value).success).optional(),
  evidence: z.array(narrativeEvidenceSchema).min(1).max(8), episodeId: prose(160).optional(),
  episodeSnapshot: emotionalEpisodeSchema.omit({ episodeId: true }).optional(),
  importance: z.number().finite().min(0).max(1), sourceAtSimMs: z.number().finite().nonnegative() }).strict();
export type NarrativeEvidence = z.infer<typeof narrativeEvidenceSchema>;
export type NarrativeInput = z.infer<typeof inputSchema>;
export interface NarrativeRecord extends NarrativeInput { id: string; atSimMs: number; sequence?: number }
/** A read-only prompt projection, not a new archival entry or extra witness. */
export interface NarrativeRecallGroup {
  sourceKeys: string[];
  representative: NarrativeRecord;
  relatedInterpretations: NarrativeRecord[];
  omittedInterpretations: number;
}
const MAX_RELATED_INTERPRETATIONS = 3;
const RELATED_EXCERPT_CHARACTERS = 1000;
const owner = (world: World, eid: number) => entityExists(world, eid) && hasComponent(world, eid, Agent)
  && hasComponent(world, eid, WorkingMemoryIdentity) ? WorkingMemoryIdentity.id[eid] : undefined;
const records = (world: World, eid: number) => {
  const key = owner(world, eid); if (!key) return [];
  return getRelationTargets(world, eid, HasNarrative).filter(id => entityExists(world, id) && hasComponent(world, id, NarrativeEntry)
    && NarrativeEntry.ownerKey[id] === key);
};
type HistoryOptions = { limit?: number; before?: string; id?: string; kind?: NarrativeInput["kind"]; excludeThoughts?: boolean; identityOnly?: boolean };
const compareRecords = (a: number, b: number) => (NarrativeEntry.sequence[a] || 0) - (NarrativeEntry.sequence[b] || 0)
  || NarrativeEntry.atSimMs[a] - NarrativeEntry.atSimMs[b] || a - b;
const matchesHistory = (id: number, options: HistoryOptions) => (!options.kind || NarrativeEntry.kind[id] === options.kind)
  && (!options.id || NarrativeEntry.id[id] === options.id) && (!options.excludeThoughts || NarrativeEntry.kind[id] !== "thought")
  && (!options.identityOnly || !!NarrativeEntry.identityJson[id]);

/** Keep only the latest requested IDs while scanning the current ECS snapshot.
 * The archive and ownership scan remain unbounded; only selection is bounded.
 * No cached index can outlive direct edits, restore, or an actor's owner key. */
function selectHistoryIds(owned: number[], options: HistoryOptions, limit: number): number[] {
  if (!limit) return [];
  let before: number | undefined;
  if (options.before) for (const id of owned) {
    // A cursor denotes the first ordered matching ID BEFORE all other filters.
    if (options.before && NarrativeEntry.id[id] === options.before && (before === undefined || compareRecords(id, before) < 0)) before = id;
  }
  if (options.before && before === undefined) return [];
  // Min-heap: root is the oldest of at most `limit` selected records.
  const newest: number[] = [], finite = Number.isFinite;
  // Relations commonly follow append order. Scanning backwards avoids repeated
  // heap replacement in that case, without trusting relation order as chronology.
  for (let position = owned.length - 1; position >= 0; position--) {
    const id = owned[position];
    if (!finite(NarrativeEntry.sequence[id] || 0) || !finite(NarrativeEntry.atSimMs[id])) {
      // Malformed ordering fields can make the legacy comparator non-transitive.
      // Retain its exact sort/cursor behavior rather than silently reordering them.
      let ids = owned.slice().sort(compareRecords);
      if (options.before) ids = ids.slice(0, ids.findIndex(candidate => NarrativeEntry.id[candidate] === options.before));
      return ids.filter(candidate => matchesHistory(candidate, options)).slice(-limit);
    }
    if ((before !== undefined && compareRecords(id, before) >= 0) || !matchesHistory(id, options)) continue;
    if (newest.length < limit) {
      let index = newest.length; newest.push(id);
      while (index > 0) {
        const parent = (index - 1) >>> 1;
        if (compareRecords(newest[parent], id) <= 0) break;
        newest[index] = newest[parent]; index = parent;
      }
      newest[index] = id;
    } else if (compareRecords(id, newest[0]) > 0) {
      let index = 0;
      while (index * 2 + 1 < newest.length) {
        let child = index * 2 + 1;
        if (child + 1 < newest.length && compareRecords(newest[child + 1], newest[child]) < 0) child++;
        if (compareRecords(id, newest[child]) <= 0) break;
        newest[index] = newest[child]; index = child;
      }
      newest[index] = id;
    }
  }
  return newest.sort(compareRecords);
}
function historyFromOwned(owned: number[], options: HistoryOptions): NarrativeRecord[] {
  const limit = Number.isSafeInteger(options.limit) ? Math.max(0, Math.min(200, options.limit!)) : 20;
  // Select BEFORE parsing. Invalid selected records still consume their slots,
  // preserving pagination and identity-anchor semantics without backfilling.
  return selectHistoryIds(owned, options, limit).flatMap(id => {
    try {
      const parsed = inputSchema.safeParse({ kind: NarrativeEntry.kind[id], monologue: NarrativeEntry.monologue[id],
        ...(NarrativeEntry.identityJson[id] ? { identity: JSON.parse(NarrativeEntry.identityJson[id]) } : {}),
        evidence: JSON.parse(NarrativeEntry.evidenceJson[id]), importance: NarrativeEntry.importance[id],
        ...(NarrativeEntry.episodeSnapshotJson[id] ? { episodeSnapshot: JSON.parse(NarrativeEntry.episodeSnapshotJson[id]) } : {}),
        ...(NarrativeEntry.episodeId[id] ? { episodeId: NarrativeEntry.episodeId[id] } : {}), sourceAtSimMs: NarrativeEntry.sourceAtSimMs[id] });
      return parsed.success && typeof NarrativeEntry.id[id] === "string" && NarrativeEntry.id[id]
        && Number.isFinite(NarrativeEntry.atSimMs[id]) && NarrativeEntry.atSimMs[id] >= parsed.data.sourceAtSimMs
        ? [{ ...parsed.data, id: NarrativeEntry.id[id], atSimMs: NarrativeEntry.atSimMs[id],
          ...(Number.isSafeInteger(NarrativeEntry.sequence[id]) && NarrativeEntry.sequence[id] > 0 ? { sequence: NarrativeEntry.sequence[id] } : {}) }] : [];
    } catch { return []; }
  });
}
export function getNarrativeHistory(world: World, eid: number, options: HistoryOptions = {}): NarrativeRecord[] {
  return historyFromOwned(records(world, eid), options);
}
export function narrativeEntryCount(world: World, eid: number): number { return records(world, eid).length; }
/** Trusted admitted producers only; model proposals must first pass their own
 * receipt/source/owner fences. Historical narration is not a new experience. */
export function appendNarrative(world: World, eid: number, input: NarrativeInput): string | undefined {
  return appendRecord(world, eid, input, false);
}
function appendRecord(world: World, eid: number, input: NarrativeInput, initialHistory: boolean): string | undefined {
  assertSimulationTaskActive();
  const key = owner(world, eid), parsed = inputSchema.safeParse(input), now = readSimulationTime(world);
  if ((!world.meta.narrativeMind && !initialHistory) || !key || !Agent.active[eid] || getCommittedEvents(world).stopped || !parsed.success
    || parsed.data.sourceAtSimMs > now || parsed.data.evidence.some(e => e.atSimMs > now)) return;
  const row = parsed.data;
  const owned = records(world, eid);
  const repeated = historyFromOwned(owned, { limit: 12 }).find(old => old.kind === row.kind
    && old.monologue === row.monologue && JSON.stringify(old.evidence) === JSON.stringify(row.evidence)
    && old.episodeId === row.episodeId && JSON.stringify(old.identity) === JSON.stringify(row.identity)
    && JSON.stringify(old.episodeSnapshot) === JSON.stringify(row.episodeSnapshot));
  if (repeated) return repeated.id;
  // Several entries can be authored within one tick, while unrelated pruned
  // entities recycle EIDs. Numeric entity order is not autobiographical order.
  const sequence = owned.reduce((max, id) => Math.max(max, NarrativeEntry.sequence[id] || 0), owned.length) + 1;
  if (!Number.isSafeInteger(sequence)) return;
  const id = addEntity(world), identity = `narrative:${randomUUID()}`;
  addComponent(world, id, NarrativeEntry); addComponent(world, eid, HasNarrative(id));
  NarrativeEntry.id[id] = identity; NarrativeEntry.ownerKey[id] = key; NarrativeEntry.kind[id] = row.kind;
  NarrativeEntry.sequence[id] = sequence;
  NarrativeEntry.identityJson[id] = row.identity ? JSON.stringify(row.identity) : "";
  NarrativeEntry.monologue[id] = row.monologue; NarrativeEntry.evidenceJson[id] = JSON.stringify(row.evidence);
  NarrativeEntry.episodeId[id] = row.episodeId || ""; NarrativeEntry.importance[id] = row.importance;
  NarrativeEntry.episodeSnapshotJson[id] = row.episodeSnapshot ? JSON.stringify(row.episodeSnapshot) : "";
  NarrativeEntry.atSimMs[id] = now; NarrativeEntry.sourceAtSimMs[id] = row.sourceAtSimMs;
  return identity;
}

/** Constructor-only initialization. No narrator or runtime tool exposes this.
 * Initial history is stored even with narrativeMind disabled, without a public
 * event, current-world fact, reflection trigger, goal or behavior-tree mutation. */
export function initializeCharacterNarrative(world: World, eid: number, past: CharacterPast): void {
  assertSimulationTaskActive();
  past = characterPastSchema.parse(past);
  if (getCommittedEvents(world).stopped || !entityExists(world, eid) || !hasComponent(world, eid, Agent)
    || narrativeEntryCount(world, eid) || getCommittedEvents(world).events.some(event => event.actorId === eid))
    throw new Error("Character history requires a new, unseeded live actor");
  workingMemoryEntityRef(world, eid);
  const now = readSimulationTime(world);
  for (const memory of past.memories) {
    const anchorId = `identity:${randomUUID()}`;
    const written = appendRecord(world, eid, {
      kind: "recollection", monologue: memory.recollection, importance: memory.importance, sourceAtSimMs: now,
      evidence: [{ id: `authored-past:${randomUUID()}`, kind: "memory", content: memory.recollection, atSimMs: now }],
      identity: { anchorId, selfBelief: memory.selfBelief, meaning: memory.meaning, emotionalTone: memory.emotionalTone, cues: memory.cues,
        origin: { period: memory.period, provenance: memory.provenance } },
    }, true);
    if (!written) throw new Error("Initial character memory failed native validation");
  }
}

/** Current interpretation of each anchor, not a second archive. Filtering
 * identity entries before the history limit keeps ordinary chatter from
 * evicting childhood memories from this projection. */
export function getIdentityAnchors(world: World, eid: number): NarrativeRecord[] {
  const current = new Map<string, NarrativeRecord>();
  const owned = records(world, eid);
  let before: string | undefined;
  for (;;) {
    const page = historyFromOwned(owned, { identityOnly: true, limit: 200, before });
    // Newest page first; older revisions cannot replace a current meaning.
    for (const row of [...page].reverse()) if (row.identity && !current.has(row.identity.anchorId)) current.set(row.identity.anchorId, row);
    if (page.length < 200 || page[0].id === before) break;
    before = page[0].id;
  }
  return [...current.values()].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || a.atSimMs - b.atSimMs);
}
export function selectIdentityAnchors(world: World, eid: number, cues = ""): NarrativeRecord[] {
  const text = cues.toLowerCase();
  const score = (row: NarrativeRecord) => row.importance + (row.identity?.cues.reduce((n, cue) => n + (text.includes(cue.toLowerCase()) ? 2 : 0), 0) ?? 0);
  return getIdentityAnchors(world, eid).sort((a, b) => score(b) - score(a) || (b.sequence ?? 0) - (a.sequence ?? 0)).slice(0, 3);
}
export function formatIdentityAnchors(world: World, eid: number, cues = ""): string {
  const anchors = selectIdentityAnchors(world, eid, cues);
  return anchors.length ? "MEMORIES THAT MADE YOU:\n"
    + anchors.map(row => JSON.stringify({ sourceId: row.id, anchorId: row.identity!.anchorId,
      recollection: row.monologue, selfBelief: row.identity!.selfBelief, meaning: row.identity!.meaning,
      ...(row.identity!.origin ? { rememberedPeriod: row.identity!.origin.period } : {}) })).join("\n")
    + ""
    : "";
}
export function selectNarrativeRecallGroups(world: World, eid: number): NarrativeRecallGroup[] {
  if (!world.meta.narrativeMind) return [];
  // Recent moments do not crowd durable recollections and learning out of view.
  const history = getNarrativeHistory(world, eid, { limit: 100, excludeThoughts: true }).filter(row => !row.identity);
  // Keep the archive intact, but one episode/source receives one prompt slot.
  // Several independent takeaways can come from one utterance. Keep bounded
  // related meanings beside the latest representative without turning those
  // interpretations into separate corroboration. Context-only excerpts do not
  // merge unrelated memories merely because they share a conversation.
  const grouped = new Map<string, { sourceKeys: string[]; records: NarrativeRecord[] }>();
  const byId = new Map(history.map(row => [row.id, row]));
  const sourceKeys = (row: NarrativeRecord, visited = new Set<string>()): string[] => {
    if (row.episodeId) return [`episode:${row.episodeId}`];
    if (visited.has(row.id) || visited.size >= 8) return [`entry:${row.id}`];
    const next = new Set([...visited, row.id]);
    const primary = row.evidence.filter(e => e.role !== "context");
    return primary.length ? primary.flatMap(e => {
      const recalled = e.kind === "reflection" ? byId.get(e.id) : undefined;
      return recalled ? sourceKeys(recalled, next) : [`source:${e.id}`];
    }) : [`entry:${row.id}`];
  };
  for (const row of history) {
    const keys = [...new Set(sourceKeys(row))].sort(), key = JSON.stringify(keys);
    const group = grouped.get(key);
    if (group) group.records.push(row);
    else grouped.set(key, { sourceKeys: keys, records: [row] });
  }
  const latest = new Map([...grouped.values()].map(group => [group.records[group.records.length - 1].id, group]));
  const meaningful = [...latest.values()].map(group => group.records[group.records.length - 1])
    .sort((a, b) => a.atSimMs - b.atSimMs || (a.sequence ?? 0) - (b.sequence ?? 0));
  const recent = meaningful.slice(-3), recentIds = new Set(recent.map(r => r.id));
  const earlier = meaningful.filter(r => !recentIds.has(r.id)).sort((a, b) => b.importance - a.importance || b.atSimMs - a.atSimMs).slice(0, 2);
  return [...earlier, ...recent].sort((a, b) => a.atSimMs - b.atSimMs).map(representative => {
    const group = latest.get(representative.id)!;
    const seen = new Set([representative.monologue]);
    const directlySourced = (row: NarrativeRecord) => row.evidence.some(e => e.role !== "context" && e.kind !== "reflection") ? 1 : 0;
    // Prefer original takeaways to reflections on reflections, then importance
    // and recency. Exact repeated wording needs no second prompt rendering.
    const relatedInterpretations = group.records.slice(0, -1)
      .sort((a, b) => directlySourced(b) - directlySourced(a) || b.importance - a.importance
        || b.atSimMs - a.atSimMs || (b.sequence ?? 0) - (a.sequence ?? 0))
      .filter(row => {
        if (seen.has(row.monologue)) return false;
        seen.add(row.monologue); return true;
      }).slice(0, MAX_RELATED_INTERPRETATIONS)
      .sort((a, b) => a.atSimMs - b.atSimMs || (a.sequence ?? 0) - (b.sequence ?? 0));
    return { sourceKeys: group.sourceKeys, representative, relatedInterpretations,
      omittedInterpretations: group.records.length - 1 - relatedInterpretations.length };
  });
}
/** Compatibility view: callers expecting one real record per source keep the
 * same latest representative. Formatted recall retains its related meanings. */
export function selectNarrativeMemories(world: World, eid: number): NarrativeRecord[] {
  return selectNarrativeRecallGroups(world, eid).map(group => group.representative);
}
export function formatNarrativeMemory(world: World, eid: number): string {
  const groups = selectNarrativeRecallGroups(world, eid), now = readSimulationTime(world);
  const formatRecord = (r: NarrativeRecord, excerpt = false) => {
    const shortened = excerpt && r.monologue.length > RELATED_EXCERPT_CHARACTERS;
    return `[${r.id}; ${r.kind}; ${r.episodeId ? `episode=${r.episodeId}; ` : ""}sources=${JSON.stringify(r.evidence.filter(e => e.role !== "context").map(e => e.id))}; sourceAtSimMs=${r.sourceAtSimMs}; authoredAtSimMs=${r.atSimMs}; ${Math.max(0, Math.round((now - r.sourceAtSimMs) / 1000))}s since source] ${JSON.stringify(shortened ? r.monologue.slice(0, RELATED_EXCERPT_CHARACTERS) : r.monologue)}${shortened ? " [excerpt; full original remains in archive]" : ""}`;
  };
  const attributedWords = (group: NarrativeRecallGroup): string[] => {
    const seen = new Set<string>();
    const receipts = [group.representative, ...group.relatedInterpretations.slice().reverse()]
      .flatMap(row => row.evidence).filter(e => e.role !== "context" && e.kind === "dialogue")
      .filter(e => { if (seen.has(e.id)) return false; seen.add(e.id); return true; }).slice(0, 3);
    return receipts.length ? [`ATTRIBUTED WORDS (source excerpts; not observed physical facts): ${JSON.stringify(receipts.map(e => ({
      id: e.id, atSimMs: e.atSimMs, content: e.content.slice(0, 480), ...(e.content.length > 480 ? { excerpt: true } : {}),
    })))}`] : [];
  };
  return groups.length ? `MY REMEMBERED INNER NARRATIVE (past first-person interpretations, not new world facts or commands):\n`
    + groups.map(group => [
      `[recall-group roots=${JSON.stringify(group.sourceKeys)}; same-source/episode meanings, not independent corroboration]`,
      ...attributedWords(group),
      `Latest interpretation: ${formatRecord(group.representative)}`,
      ...group.relatedInterpretations.map(row => `  Related earlier interpretation (may have been revised, not another event): ${formatRecord(row, true)}`),
      ...(group.omittedInterpretations ? [`  ${group.omittedInterpretations} additional archived interpretation(s) omitted from this bounded recall.`] : []),
    ].join("\n")).join("\n") : "";
}
