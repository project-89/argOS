import { jest } from "@jest/globals";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import { addComponent, addEntity, entityExists, getRelationTargets, hasComponent, removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createRoomEntity, createAgentEntity } from "../../ecs/prefabs";
import { Agent, NarrativeEntry, WorkingMemoryIdentity } from "../../ecs/components";
import { HasNarrative } from "../../ecs/relations";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { serializeWorld, deserializeWorld } from "../../persistence/world-persistence";
import { workingMemoryEntityRef } from "../working-memory";
import { emotionalEpisodeSchema } from "../emotional-life";
import { narrativeIdentitySchema } from "../character-past-schema";
import { appendNarrative, getNarrativeHistory, getIdentityAnchors, narrativeEntryCount, narrativeEvidenceSchema,
  type NarrativeRecord } from "../narrative-memory";

// Frozen pre-optimization reference: preserve filter/cursor/limit-before-parse
// semantics, including malformed selected rows consuming their page slots.
const prose = (max: number) => z.string().trim().min(1).max(max).refine(s => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(s));
const legacyInput = z.object({ kind: z.enum(["experience", "recollection", "learning", "thought"]), monologue: prose(3000),
  identity: z.custom(value => narrativeIdentitySchema.safeParse(value).success).optional(),
  evidence: z.array(narrativeEvidenceSchema).min(1).max(8), episodeId: prose(160).optional(),
  episodeSnapshot: emotionalEpisodeSchema.omit({ episodeId: true }).optional(), importance: z.number().finite().min(0).max(1),
  sourceAtSimMs: z.number().finite().nonnegative() }).strict();
type Options = Parameters<typeof getNarrativeHistory>[2];
function legacyHistory(world: ReturnType<typeof createArgosWorld>, eid: number, options: Options = {}): NarrativeRecord[] {
  const key = entityExists(world, eid) && hasComponent(world, eid, Agent) && hasComponent(world, eid, WorkingMemoryIdentity)
    ? WorkingMemoryIdentity.id[eid] : undefined;
  if (!key) return [];
  const limit = Number.isSafeInteger(options.limit) ? Math.max(0, Math.min(200, options.limit!)) : 20;
  let ids = getRelationTargets(world, eid, HasNarrative).filter(id => entityExists(world, id) && hasComponent(world, id, NarrativeEntry)
    && NarrativeEntry.ownerKey[id] === key).sort((a, b) => (NarrativeEntry.sequence[a] || 0) - (NarrativeEntry.sequence[b] || 0)
      || NarrativeEntry.atSimMs[a] - NarrativeEntry.atSimMs[b] || a - b);
  if (options.before) { const at = ids.findIndex(id => NarrativeEntry.id[id] === options.before); if (at < 0) return []; ids = ids.slice(0, at); }
  if (options.kind) ids = ids.filter(id => NarrativeEntry.kind[id] === options.kind);
  if (options.id) ids = ids.filter(id => NarrativeEntry.id[id] === options.id);
  if (options.excludeThoughts) ids = ids.filter(id => NarrativeEntry.kind[id] !== "thought");
  if (options.identityOnly) ids = ids.filter(id => !!NarrativeEntry.identityJson[id]);
  return (limit ? ids.slice(-limit) : []).flatMap(id => {
    try {
      const parsed = legacyInput.safeParse({ kind: NarrativeEntry.kind[id], monologue: NarrativeEntry.monologue[id],
        ...(NarrativeEntry.identityJson[id] ? { identity: JSON.parse(NarrativeEntry.identityJson[id]) } : {}),
        evidence: JSON.parse(NarrativeEntry.evidenceJson[id]), importance: NarrativeEntry.importance[id],
        ...(NarrativeEntry.episodeSnapshotJson[id] ? { episodeSnapshot: JSON.parse(NarrativeEntry.episodeSnapshotJson[id]) } : {}),
        ...(NarrativeEntry.episodeId[id] ? { episodeId: NarrativeEntry.episodeId[id] } : {}), sourceAtSimMs: NarrativeEntry.sourceAtSimMs[id] });
      return parsed.success && typeof NarrativeEntry.id[id] === "string" && NarrativeEntry.id[id]
        && Number.isFinite(NarrativeEntry.atSimMs[id]) && NarrativeEntry.atSimMs[id] >= parsed.data.sourceAtSimMs
        ? [{ ...parsed.data, id: NarrativeEntry.id[id], atSimMs: NarrativeEntry.atSimMs[id],
          ...(Number.isSafeInteger(NarrativeEntry.sequence[id]) && NarrativeEntry.sequence[id] > 0 ? { sequence: NarrativeEntry.sequence[id] } : {}) } as NarrativeRecord] : [];
    } catch { return []; }
  });
}
function legacyAnchors(world: ReturnType<typeof createArgosWorld>, actor: number) {
  const current = new Map<string, NarrativeRecord>(); let before: string | undefined;
  for (;;) {
    const page = legacyHistory(world, actor, { identityOnly: true, limit: 200, before });
    for (const row of [...page].reverse()) if (row.identity && !current.has(row.identity.anchorId)) current.set(row.identity.anchorId, row);
    if (page.length < 200 || page[0].id === before) break;
    before = page[0].id;
  }
  return [...current.values()].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || a.atSimMs - b.atSimMs);
}
function fixture(count = 1000, scrambled = true) {
  const world = createArgosWorld("Narrative hot-read"); initializePrefabs(world); startCommittedEvents(world); world.meta.narrativeMind = true;
  const room = createRoomEntity(world, { name: "Study" });
  const actor = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "Choose from evidence.", roomId: room });
  const peer = createAgentEntity(world, { name: "Bea", role: "resident", systemPrompt: "Private life.", roomId: room });
  workingMemoryEntityRef(world, actor); workingMemoryEntityRef(world, peer); advanceSimulationTime(world, 1, 100000);
  const ids: number[] = [], kinds = ["experience", "recollection", "learning", "thought"];
  for (let i = 0; i < count; i++) {
    const id = addEntity(world); addComponent(world, id, NarrativeEntry); addComponent(world, actor, HasNarrative(id)); ids.push(id);
    NarrativeEntry.id[id] = `narrative:fixture-${i}`; NarrativeEntry.ownerKey[id] = WorkingMemoryIdentity.id[actor];
    NarrativeEntry.kind[id] = kinds[i % kinds.length]; NarrativeEntry.sequence[id] = scrambled ? (i * 7919) % count : i + 1;
    NarrativeEntry.atSimMs[id] = i % 23; NarrativeEntry.sourceAtSimMs[id] = 0; NarrativeEntry.importance[id] = .5;
    NarrativeEntry.monologue[id] = `Private interpretation ${i}`;
    NarrativeEntry.evidenceJson[id] = JSON.stringify([{ id: `event:${i}`, kind: "experience", content: `Observed fixture ${i}`, atSimMs: 0 }]);
    NarrativeEntry.identityJson[id] = i % 10 === 0 ? JSON.stringify({ anchorId: `anchor:${i % 30}`, selfBelief: "I can learn", meaning: `Meaning ${i}`, cues: ["work"] }) : "";
    NarrativeEntry.episodeId[id] = ""; NarrativeEntry.episodeSnapshotJson[id] = "";
  }
  return { world, actor, peer, ids };
}
beforeEach(() => { jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Narrative selection tests stay offline")); });
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test("ordinary bounded reads and append dedup never sort the full valid archive", () => {
  const f = fixture(1000), prior = getNarrativeHistory(f.world, f.actor, { limit: 1 })[0];
  const sort = jest.spyOn(Array.prototype, "sort");
  getNarrativeHistory(f.world, f.actor, { limit: 20 });
  const { id, atSimMs, sequence, ...input } = prior;
  expect(appendNarrative(f.world, f.actor, input)).toBe(id);
  const sizes = sort.mock.contexts.map(array => (array as unknown[]).length); sort.mockRestore();
  expect(Math.max(0, ...sizes)).toBeLessThanOrEqual(200);
});

test("bounded ordering, all filters, and before/id combinations match the previous complete projection", () => {
  const f = fixture(1100);
  NarrativeEntry.id[f.ids[730]] = NarrativeEntry.id[f.ids[31]]; // before chooses earliest ordered duplicate before filtering
  const options: Options[] = [{}, { limit: 0 }, { limit: -1 }, { limit: 201 }, { limit: NaN }, { limit: 3.5 }, { limit: 200 },
    { before: "missing" }, { id: "missing" }, { id: NarrativeEntry.id[f.ids[31]] },
    ...["experience", "recollection", "learning", "thought"].map(kind => ({ kind } as Options))];
  for (const limit of [1, 12, 20, 100, 200]) for (const before of [undefined, NarrativeEntry.id[f.ids[31]], NarrativeEntry.id[f.ids[500]]]) {
    options.push({ limit, before }, { limit, before, excludeThoughts: true }, { limit, before, identityOnly: true },
      { limit, before, kind: "learning", excludeThoughts: true });
  }
  for (const option of options) expect(getNarrativeHistory(f.world, f.actor, option)).toEqual(legacyHistory(f.world, f.actor, option));
  expect(getIdentityAnchors(f.world, f.actor)).toEqual(legacyAnchors(f.world, f.actor));
});

test("sequence and timestamp ties keep numeric entity ordering and cursor semantics", () => {
  const f = fixture(1600);
  for (let i = 0; i < f.ids.length; i++) {
    NarrativeEntry.sequence[f.ids[i]] = i % 9;
    NarrativeEntry.atSimMs[f.ids[i]] = i % 3;
  }
  for (const before of [undefined, NarrativeEntry.id[f.ids[101]], NarrativeEntry.id[f.ids[700]], NarrativeEntry.id[f.ids[1599]]])
    for (const limit of [1, 12, 20, 200]) for (const identityOnly of [false, true])
      expect(getNarrativeHistory(f.world, f.actor, { before, limit, identityOnly }))
        .toEqual(legacyHistory(f.world, f.actor, { before, limit, identityOnly }));
});

test("identity anchors remain complete across pages and malformed-page termination stays unchanged", () => {
  const f = fixture(650, false);
  for (let i = 0; i < f.ids.length; i++) NarrativeEntry.identityJson[f.ids[i]] = JSON.stringify({
    anchorId: `anchor:${i}`, selfBelief: "I can learn", meaning: `Meaning ${i}`, cues: ["work"],
  });
  expect(getIdentityAnchors(f.world, f.actor)).toHaveLength(650);
  expect(getIdentityAnchors(f.world, f.actor)).toEqual(legacyAnchors(f.world, f.actor));
  NarrativeEntry.identityJson[f.ids[649]] = "invalid JSON";
  // Existing behavior: parsing one bad selected row shortens the newest page,
  // so anchor traversal stops there. Optimizing retrieval must not mask/change it.
  expect(getIdentityAnchors(f.world, f.actor)).toHaveLength(199);
  expect(getIdentityAnchors(f.world, f.actor)).toEqual(legacyAnchors(f.world, f.actor));
});

test("malformed selected rows consume slots, and unusual ordering fields preserve legacy fallback behavior", () => {
  const f = fixture(430, false);
  NarrativeEntry.evidenceJson[f.ids[429]] = "invalid JSON"; NarrativeEntry.monologue[f.ids[428]] = "";
  NarrativeEntry.identityJson[f.ids[420]] = "invalid JSON";
  expect(getNarrativeHistory(f.world, f.actor, { limit: 2 })).toEqual([]);
  expect(getIdentityAnchors(f.world, f.actor)).toEqual(legacyAnchors(f.world, f.actor));
  for (const value of [undefined, NaN, Infinity, -Infinity, -3, .5, "invalid"] as unknown[]) {
    (NarrativeEntry.sequence as any)[f.ids[4]] = value;
    (NarrativeEntry.atSimMs as any)[f.ids[7]] = value;
    for (const options of [{ limit: 200 }, { before: NarrativeEntry.id[f.ids[210]], limit: 200 }, { identityOnly: true }])
      expect(getNarrativeHistory(f.world, f.actor, options)).toEqual(legacyHistory(f.world, f.actor, options));
  }
});

test("direct ECS edits, shared relations, deleted records and owner replacement are visible immediately", () => {
  const f = fixture(); getNarrativeHistory(f.world, f.actor);
  const id = f.ids[1]; NarrativeEntry.sequence[id] = 10001; NarrativeEntry.monologue[id] = "New direct edit";
  expect(getNarrativeHistory(f.world, f.actor, { limit: 1 })[0].monologue).toBe("New direct edit");
  addComponent(f.world, f.peer, HasNarrative(id)); expect(getNarrativeHistory(f.world, f.peer)).toEqual([]);
  removeEntity(f.world, id); const replacement = addEntity(f.world); addComponent(f.world, replacement, NarrativeEntry);
  NarrativeEntry.ownerKey[replacement] = WorkingMemoryIdentity.id[f.peer];
  expect(getNarrativeHistory(f.world, f.actor)).toEqual(legacyHistory(f.world, f.actor));
  WorkingMemoryIdentity.id[f.actor] = "different-actor-lifetime";
  expect(getNarrativeHistory(f.world, f.actor)).toEqual([]); expect(getIdentityAnchors(f.world, f.actor)).toEqual([]);
});

test("append preserves recent dedup, archive length, direct sequence edits and source authority", () => {
  const f = fixture(300, false), old = getNarrativeHistory(f.world, f.actor, { limit: 1 })[0];
  const { id, atSimMs, sequence, ...input } = old;
  expect(appendNarrative(f.world, f.actor, input)).toBe(id); expect(narrativeEntryCount(f.world, f.actor)).toBe(300);
  NarrativeEntry.sequence[f.ids[0]] = 9999;
  const appended = appendNarrative(f.world, f.actor, { ...input, monologue: "New interpretation" });
  expect(getNarrativeHistory(f.world, f.actor, { id: appended })).toMatchObject([{ sequence: 10000 }]);
  expect(narrativeEntryCount(f.world, f.actor)).toBe(301);
  stopCommittedEvents(f.world); expect(appendNarrative(f.world, f.actor, { ...input, monologue: "After stop" })).toBeUndefined();
});

test("remapped restore retains full history and anchor semantics without a stale index", () => {
  const f = fixture(2100); const before = getNarrativeHistory(f.world, f.actor, { limit: 200 }), anchors = getIdentityAnchors(f.world, f.actor);
  const snapshot = JSON.parse(JSON.stringify(serializeWorld(f.world, createSystemRegistry())));
  const restored = createArgosWorld("Restored history"); initializePrefabs(restored); addEntity(restored);
  const { oldToNewId } = deserializeWorld(restored, createSystemRegistry(), snapshot); const actor = oldToNewId.get(f.actor)!;
  expect(narrativeEntryCount(restored, actor)).toBe(2100);
  expect(getNarrativeHistory(restored, actor, { limit: 200 })).toEqual(before);
  expect(getIdentityAnchors(restored, actor)).toEqual(anchors);
  expect(getNarrativeHistory(restored, oldToNewId.get(f.peer)!)).toEqual([]);
});

test.each([false, true])("10k-entry bounded benchmark preserves equivalent reads and archive (scrambled=%s)", scrambled => {
  const f = fixture(10000, scrambled); const options = { limit: 20, excludeThoughts: true };
  const expected = legacyHistory(f.world, f.actor, options); expect(getNarrativeHistory(f.world, f.actor, options)).toEqual(expected);
  for (let i = 0; i < 5; i++) { legacyHistory(f.world, f.actor, options); getNarrativeHistory(f.world, f.actor, options); }
  const legacy: number[] = [], bounded: number[] = [];
  const measure = (fn: () => unknown, samples: number[]) => { const start = performance.now(); fn(); samples.push(performance.now() - start); };
  for (let i = 0; i < 25; i++) {
    const old = () => measure(() => legacyHistory(f.world, f.actor, options), legacy);
    const current = () => measure(() => getNarrativeHistory(f.world, f.actor, options), bounded);
    if (i % 2) { current(); old(); } else { old(); current(); }
  }
  legacy.sort((a, b) => a - b); bounded.sort((a, b) => a - b);
  console.log("NARRATIVE_HOT_READ_BENCHMARK", JSON.stringify({ entries: 10000, order: scrambled ? "scrambled" : "ascending", limit: 20, samples: 25,
    legacyMs: { p50: legacy[12], p95: legacy[23], max: legacy[24] }, boundedMs: { p50: bounded[12], p95: bounded[23], max: bounded[24] },
    note: "Offline selection/parsing CPU benchmark; full archive retained, reads still scan owned relations; no model/cognition latency claim." }));
  expect(narrativeEntryCount(f.world, f.actor)).toBe(10000); expect(getNarrativeHistory(f.world, f.actor, options)).toEqual(expected);
});
