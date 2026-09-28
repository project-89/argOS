import { jest } from "@jest/globals";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createRoomEntity, createAgentEntity } from "../../ecs/prefabs";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { startCommittedEvents } from "../../runtime/committed-events";
import { workingMemoryEntityRef } from "../working-memory";
import {
  appendNarrative, formatNarrativeMemory, getNarrativeHistory, selectNarrativeMemories,
  selectNarrativeRecallGroups, type NarrativeInput,
} from "../narrative-memory";

function fixture() {
  const world = createArgosWorld("Recall laboratory"); initializePrefabs(world);
  world.meta.narrativeMind = true;
  const roomId = createRoomEntity(world, { name: "Kitchen" });
  const actor = createAgentEntity(world, { name: "Ada", role: "friend", systemPrompt: "A person with their own memories.", roomId });
  workingMemoryEntityRef(world, actor);
  startCommittedEvents(world); advanceSimulationTime(world, 1, 1000);
  const record = (monologue: string, source = "speech:1", extra: Partial<NarrativeInput> = {}) => appendNarrative(world, actor, {
    kind: "recollection", monologue, importance: .5, sourceAtSimMs: 1000,
    evidence: [{ id: source, kind: "dialogue", role: "primary", content: "Lin has the key; I promised to return it.", atSimMs: 1000 }],
    ...extra,
  })!;
  return { world, actor, record };
}

beforeEach(() => { jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network in recall tests")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test("independent takeaways from one utterance share a slot without losing either meaning", () => {
  const f = fixture(), key = f.record("Lin has the key.");
  advanceSimulationTime(f.world, 2, 1000);
  const promise = f.record("I promised to return it.");
  const archive = getNarrativeHistory(f.world, f.actor);
  const groups = selectNarrativeRecallGroups(f.world, f.actor);
  expect(groups).toHaveLength(1);
  expect(groups[0]).toMatchObject({ sourceKeys: ["source:speech:1"],
    representative: { id: promise, sourceAtSimMs: 1000, atSimMs: 2000 },
    relatedInterpretations: [{ id: key, sourceAtSimMs: 1000, atSimMs: 1000 }], omittedInterpretations: 0 });
  expect(selectNarrativeMemories(f.world, f.actor).map(row => row.id)).toEqual([promise]);
  const text = formatNarrativeMemory(f.world, f.actor);
  expect(text).toContain("Lin has the key."); expect(text).toContain("I promised to return it.");
  expect(text).toContain(key); expect(text).toContain(promise);
  expect(text).toContain("sourceAtSimMs=1000; authoredAtSimMs=2000");
  expect(text.match(/\[recall-group /g)).toHaveLength(1);
  expect(text).toContain("not independent corroboration");
  expect(getNarrativeHistory(f.world, f.actor)).toEqual(archive);
});

test("all four independently extracted takeaways fit in one interaction group", () => {
  const f = fixture(), meanings = ["Lin has the key.", "The switch must stay off.", "I promised to return the key.", "The spare fuse is in the cupboard."];
  const ids = meanings.map(text => f.record(text));
  const group = selectNarrativeRecallGroups(f.world, f.actor)[0];
  expect(group.representative.id).toBe(ids[3]);
  expect(group.relatedInterpretations.map(row => row.id)).toEqual(ids.slice(0, 3));
  for (const text of meanings) expect(formatNarrativeMemory(f.world, f.actor)).toContain(text);
});

test("recall keeps one bounded attributed source per receipt alongside its interpretations", () => {
  const f = fixture(); f.record("I believe Lin has the key."); f.record("I can ask Lin for it.");
  const archive = getNarrativeHistory(f.world, f.actor), text = formatNarrativeMemory(f.world, f.actor);
  expect(text).toContain("ATTRIBUTED WORDS");
  expect(text.match(/Lin has the key; I promised to return it\./g)).toHaveLength(1);
  expect(text).toContain("not observed physical facts");
  expect(getNarrativeHistory(f.world, f.actor)).toEqual(archive);
});

test("revised and reflected meanings stay correlated with their original episode", () => {
  const f = fixture();
  const original = f.record("I thought Lin trusted me.", "speech:1", { kind: "experience", episodeId: "trust" });
  const revised = f.record("I may have mistaken politeness for trust.", "speech:2", { episodeId: "trust" });
  advanceSimulationTime(f.world, 2, 1000);
  const reflected = f.record("I should ask rather than assume.", "unused", { kind: "learning",
    evidence: [{ id: revised, kind: "reflection", content: "I may have mistaken politeness for trust.", atSimMs: 1000 }] });
  const groups = selectNarrativeRecallGroups(f.world, f.actor);
  expect(groups).toHaveLength(1); expect(groups[0].sourceKeys).toEqual(["episode:trust"]);
  expect(groups[0].representative.id).toBe(reflected);
  expect(groups[0].relatedInterpretations.map(row => row.id)).toEqual([original, revised]);
  expect(selectNarrativeMemories(f.world, f.actor).map(row => row.id)).toEqual([reflected]);
  const text = formatNarrativeMemory(f.world, f.actor);
  expect(text.match(/\[recall-group /g)).toHaveLength(1);
  expect(text).toContain("not independent corroboration");
  expect(text).toContain("may have been revised, not another event");
  expect(getNarrativeHistory(f.world, f.actor)).toHaveLength(3);
});

test("shared conversational context does not merge different primary evidence", () => {
  const f = fixture();
  for (const id of ["speech:1", "speech:2"]) f.record(`Meaning of ${id}`, id, { evidence: [
    { id, kind: "dialogue", role: "primary", content: "A new utterance.", atSimMs: 1000 },
    { id: "shared", kind: "dialogue", role: "context", content: "Earlier conversation.", atSimMs: 1000 },
  ] });
  expect(selectNarrativeRecallGroups(f.world, f.actor).map(group => group.sourceKeys)).toEqual([["source:speech:1"], ["source:speech:2"]]);
});

test("group and related-meaning bounds report omitted archive entries and excerpts", () => {
  const f = fixture();
  for (let group = 0; group < 8; group++) {
    for (let meaning = 0; meaning < 6; meaning++) f.record(`Group ${group} meaning ${meaning}: ${"x".repeat(1100)}`, `speech:${group}`);
  }
  const archive = getNarrativeHistory(f.world, f.actor, { limit: 100 });
  const groups = selectNarrativeRecallGroups(f.world, f.actor);
  expect(groups).toHaveLength(5);
  expect(groups.every(group => group.relatedInterpretations.length === 3 && group.omittedInterpretations === 2)).toBe(true);
  const text = formatNarrativeMemory(f.world, f.actor);
  expect(text.match(/\[recall-group /g)).toHaveLength(5);
  expect(text.match(/additional archived interpretation\(s\) omitted/g)).toHaveLength(5);
  expect(text.match(/\[excerpt; full original remains in archive\]/g)).toHaveLength(15);
  expect(getNarrativeHistory(f.world, f.actor, { limit: 100 })).toEqual(archive);
  expect(archive).toHaveLength(48);
});

test("original takeaways are not displaced by multiple reflections on those meanings", () => {
  const f = fixture();
  const key = f.record("Lin has the key."), promise = f.record("I promised to return it.");
  let source = promise;
  for (let i = 0; i < 5; i++) source = f.record(`Reflection ${i}`, "unused", {
    kind: "learning", importance: 1,
    evidence: [{ id: source, kind: "reflection", content: "A prior interpretation.", atSimMs: 1000 }],
  });
  const groups = selectNarrativeRecallGroups(f.world, f.actor);
  expect(groups).toHaveLength(1); expect(groups[0].representative.id).toBe(source);
  expect(groups[0].relatedInterpretations.map(row => row.id)).toEqual(expect.arrayContaining([key, promise]));
  expect(formatNarrativeMemory(f.world, f.actor)).toContain("Lin has the key.");
  expect(formatNarrativeMemory(f.world, f.actor)).toContain("I promised to return it.");
});
