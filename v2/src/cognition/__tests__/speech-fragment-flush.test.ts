import { jest } from "@jest/globals";
import { hasComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { SocialMemory } from "../../ecs/components";
import { flushHeardSpeechFragments, formatSocialMemoryContext, getSocialDialogue, getSocialExchanges, getSocialSpeechFragments, recordHeardSpeechFragment } from "../social-memory";
import { setLocatedIn } from "../../ecs/location";
import { advanceSimulationTimeline } from "../../runtime/simulation-timeline";
import { beginTimedSpeech, clearTimedSpeech, interruptTimedSpeech } from "../timed-speech";

const cleanups: Array<() => void> = [];
beforeEach(() => { jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline heard-prefix tests")); });
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });
function fixture() {
  const world = createArgosWorld(); initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Hall" });
  const actor = (name: string) => createAgentEntity(world, { name, role: "resident", systemPrompt: "test", roomId: room });
  const ada = actor("Ada"), bo = actor("Bo"), unheard = actor("Unheard");
  const emit = (content: string, tokenIndex: number, executionId = "voice:original", audience = [bo]) =>
    recordHeardSpeechFragment(world, ada, { executionId, content, tokenIndex, totalTokens: 20,
      startedAtSimMs: 0, heardAtSimMs: tokenIndex * 400 + 700, roomId: room, audience: new Set(audience) });
  cleanups.push(() => clearTimedSpeech(world));
  return { world, room, ada, bo, unheard, emit };
}

test("interrupted sub-batch speech wakes only actual listeners with the exact unnotified prefix, once", () => {
  const f = fixture(); f.emit("The ", 0); f.emit("key ", 1);
  expect(SocialMemory.revision[f.bo]).toBe(0);
  expect(flushHeardSpeechFragments(f.world, "voice:original")).toEqual([{ eid: f.bo, content: 'Ada (heard speech excerpt): "The key"', hearing: { executionId: "voice:original", boundary: "end" } }]);
  expect(getSocialSpeechFragments(f.world, f.bo)[0]).toMatchObject({ content: "The key ", notifiedLength: 8, notifiedToken: 1, complete: false });
  expect(SocialMemory.revision[f.bo]).toBe(1);
  expect(getSocialSpeechFragments(f.world, f.ada)[0].notifiedToken).toBe(1);
  expect(getSocialDialogue(f.world, f.bo)).toEqual([]); expect(getSocialExchanges(f.world, f.bo)).toEqual([]);
  expect(hasComponent(f.world, f.unheard, SocialMemory)).toBe(false);
  expect(flushHeardSpeechFragments(f.world, "voice:original")).toEqual([]);
  expect(SocialMemory.revision[f.bo]).toBe(1);
});

test("ordinary comma and five-token progress remains heard without reopening deliberation; a sentence can trigger an interruption decision", () => {
  const f = fixture();
  const notices = ["Well, ", "I ", "was ", "going ", "to ", "say, "].flatMap((word, n) => f.emit(word, n));
  expect(notices).toEqual([]); expect(getSocialSpeechFragments(f.world, f.bo)[0].content).toBe("Well, I was going to say, ");
  expect(SocialMemory.revision[f.bo]).toBe(0);
  expect(f.emit("stop! ", 6)).toEqual([{ eid: f.bo, content: 'Ada (heard speech excerpt): "Well, I was going to say, stop!"', hearing: { executionId: "voice:original", boundary: "sentence" } }]);
  expect(getSocialDialogue(f.world, f.bo)).toEqual([]); // Interruption need not wait for a completed whole turn.
  expect(f.emit("UNFINISHED ", 7)).toEqual([]);
});

test("a long sentence has a bounded listening horizon while every actual word remains available", () => {
  const f = fixture(), notices = Array.from({ length: 18 }, (_, n) => f.emit(`word${n} `, n)).flat();
  expect(notices).toHaveLength(1); // first4s boundary; not every five words
  const partial = getSocialSpeechFragments(f.world, f.bo)[0];
  expect(partial.content).toContain("word17"); expect(partial.notifiedAtSimMs).toBeGreaterThanOrEqual(4000);
  expect(partial.notifiedLength).toBeLessThan(partial.content.length);
});

test("flush is exact-execution scoped and never replays a coherent batch or another voice's pending words", () => {
  const f = fixture();
  ["one ", "two ", "three ", "four ", "five. ", "six "].forEach((word, n) => f.emit(word, n));
  f.emit("OTHER_VOICE ", 0, "voice:other");
  const before = SocialMemory.fragmentsJson[f.bo];
  expect(flushHeardSpeechFragments(f.world, "voice:absent")).toEqual([]);
  expect(SocialMemory.fragmentsJson[f.bo]).toBe(before);
  expect(flushHeardSpeechFragments(f.world, "voice:original")).toEqual([{ eid: f.bo, content: 'Ada (heard speech excerpt): "six"', hearing: { executionId: "voice:original", boundary: "end" } }]);
  expect(getSocialSpeechFragments(f.world, f.bo).find(row => row.executionId === "voice:other")?.notifiedLength).toBe(0);
  expect(flushHeardSpeechFragments(f.world, "voice:other")).toEqual([{ eid: f.bo, content: 'Ada (heard speech excerpt): "OTHER_VOICE"', hearing: { executionId: "voice:other", boundary: "end" } }]);
});

test("a listener who left earshot is not notified twice or given the missed continuation", () => {
  const f = fixture(); f.emit("before ", 0); f.emit("UNHEARD ", 1, "voice:original", []);
  expect(getSocialSpeechFragments(f.world, f.bo)[0].content).toBe("before ");
  expect(SocialMemory.revision[f.bo]).toBe(1);
  expect(flushHeardSpeechFragments(f.world, "voice:original")).toEqual([]);
  expect(getSocialSpeechFragments(f.world, f.bo)[0].content).toBe("before ");
  expect(SocialMemory.revision[f.bo]).toBe(1);
});

test("a real speech interruption flushes emitted words without completing a turn or leaking its scheduled tail", () => {
  const f = fixture(), notifications: Array<{ eid: number; content: string }> = [];
  beginTimedSpeech(f.world, f.ada, "one two UNHEARD secret suffix", "voice:cut", result => {
    expect(result.success).toBe(false);
    notifications.push(...flushHeardSpeechFragments(f.world, result.interval.executionId));
  }, () => {}, { fragment: fragment => recordHeardSpeechFragment(f.world, f.ada, fragment) });
  advanceSimulationTimeline(f.world, 1100, { integrate: () => {} });
  expect(interruptTimedSpeech(f.world, f.ada, "changed_mind", { executionId: "voice:cut" })).toBe(true);
  expect(notifications.filter(row => row.eid === f.bo)).toEqual([{ eid: f.bo, content: 'Ada (heard speech excerpt): "one two"', hearing: { executionId: "voice:cut", boundary: "end" } }]);
  advanceSimulationTimeline(f.world, 20_000, { integrate: () => {} });
  expect(getSocialSpeechFragments(f.world, f.bo)[0].content).toBe("one two ");
  expect(getSocialDialogue(f.world, f.bo)).toEqual([]);
  expect(flushHeardSpeechFragments(f.world, "voice:cut")).toEqual([]);
});

test("incomplete excerpts retain the heard room and lived age after a listener moves, pauses or the wall clock jumps", () => {
  const f = fixture(); f.emit("Here ", 0); f.emit("now ", 1);
  flushHeardSpeechFragments(f.world, "voice:original");
  const kitchen = createRoomEntity(f.world, { name: "Kitchen" }); setLocatedIn(f.world, f.bo, kitchen);
  advanceSimulationTimeline(f.world, 17_100, { integrate: () => {} });
  const before = formatSocialMemoryContext(f.world, f.bo);
  expect(before).toContain('(16s ago, Hall; incomplete excerpt) Ada: "Here now"');
  expect(before).not.toContain("Kitchen");
  jest.spyOn(Date, "now").mockReturnValue(9_999_999_999_999);
  expect(formatSocialMemoryContext(f.world, f.bo)).toBe(before);
  advanceSimulationTimeline(f.world, 0, { integrate: () => {} });
  expect(formatSocialMemoryContext(f.world, f.bo)).toBe(before);
  expect(getSocialDialogue(f.world, f.bo)).toEqual([]);
});
