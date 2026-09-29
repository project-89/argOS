/** The optional voice gate: a presence speaker "draws breath" until the line's
 * audio is ready (or a 2.5 s simulated cap), then speaks in step with it. */
import { jest } from "@jest/globals";
import { createArgosWorld } from "../../ecs/world";
import { readSimulationTime } from "../../ecs/simulation-time";
import { advanceSimulationTimeline, clearSimulationTimeline, isSimulationResourceBusy } from "../../runtime/simulation-timeline";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import {
  beginTimedSpeech, clearTimedSpeech, estimateSpeechDurationMs, getSpeakingActivity, getUtteranceScript, interruptTimedSpeech,
  isSpeaking, readLocalSpeechOpportunity, setUtteranceVoiceGate, VOICE_GATE_CAP_MS, type SpeechFragment, type TimedSpeechResult,
  type UtteranceVoiceGate,
} from "../timed-speech";
import { registerAgentWorldCapabilities } from "../world-capabilities";

const LINE = "The tide is turning early tonight, so leave the nets.";
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function fixture(gate?: UtteranceVoiceGate) {
  const world = createArgosWorld(); initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Hall" });
  const actor = (name: string) => createAgentEntity(world, { name, role: "person", systemPrompt: "test", roomId: room });
  const ada = actor("Ada"), bo = actor("Bo");
  if (gate) setUtteranceVoiceGate(world, gate);
  const fragments: SpeechFragment[] = [], finished = jest.fn<(r: TimedSpeechResult) => void>(), abandoned = jest.fn();
  const speak = (id = "line-1", text = LINE) => beginTimedSpeech(world, ada, text, id, finished, abandoned, { fragment: f => { fragments.push(f); } });
  const advance = (ms: number) => advanceSimulationTimeline(world, ms, { integrate: () => {} });
  return { world, ada, bo, fragments, finished, abandoned, speak, advance };
}
const authored = estimateSpeechDurationMs(LINE);

test("a gated utterance holds the voice and floor, then starts when its audio resolves", async () => {
  const audio = deferred<{ durationMs: number } | undefined>(), calls: Array<[number, string, string]> = [];
  const f = fixture((eid, id, text) => { calls.push([eid, id, text]); return audio.promise; });
  expect(f.speak()).toBe(true);
  expect(calls).toEqual([[f.ada, "line-1", LINE]]);
  expect(getUtteranceScript(f.world, f.ada, "line-1")).toBe(LINE);
  expect(isSpeaking(f.world, f.ada)).toBe(true);
  expect(isSimulationResourceBusy(f.world, f.ada, "voice")).toBe(true);
  expect(readLocalSpeechOpportunity(f.world, f.bo).reason).toBe("another_speaker");
  // Provisional window while drawing breath: never looks "mostly over" to a viewer.
  expect(getSpeakingActivity(f.world, f.ada)).toMatchObject({ startedAtSimMs: 0, emittedTokens: 0 });
  expect(getSpeakingActivity(f.world, f.ada)!.expectedEndSimMs).toBeGreaterThan(VOICE_GATE_CAP_MS + authored);
  f.advance(1200);
  expect(f.fragments).toHaveLength(0);
  audio.resolve({ durationMs: authored }); await flush();
  expect(getSpeakingActivity(f.world, f.ada)).toMatchObject({ startedAtSimMs: 1200, expectedEndSimMs: 1200 + authored });
  f.advance(authored - 1);
  expect(f.finished).not.toHaveBeenCalled();
  f.advance(1);
  expect(f.finished).toHaveBeenCalledTimes(1);
  expect(f.finished.mock.calls[0][0]).toMatchObject({ success: true, spokenText: LINE,
    interval: { startedAtSimMs: 1200, expectedEndSimMs: 1200 + authored, completedAtSimMs: 1200 + authored } });
  expect(f.fragments[0].startedAtSimMs).toBe(1200);
  expect(f.fragments.map(x => x.content).join("")).toBe(LINE);
  expect(f.fragments.at(-1)!.heardAtSimMs).toBe(1200 + authored);
});

test("audio that never arrives: the line starts at the simulated cap, unscaled", async () => {
  const audio = deferred<{ durationMs: number } | undefined>();
  const f = fixture(() => audio.promise);
  f.speak();
  f.advance(VOICE_GATE_CAP_MS - 1);
  expect(getSpeakingActivity(f.world, f.ada)!.startedAtSimMs).toBe(0);
  f.advance(1);
  expect(getSpeakingActivity(f.world, f.ada)).toMatchObject({ startedAtSimMs: VOICE_GATE_CAP_MS, expectedEndSimMs: VOICE_GATE_CAP_MS + authored });
  // Late audio neither restarts nor rescales a line already begun.
  audio.resolve({ durationMs: authored * 1.5 }); await flush();
  expect(getSpeakingActivity(f.world, f.ada)!.expectedEndSimMs).toBe(VOICE_GATE_CAP_MS + authored);
  f.advance(authored);
  expect(f.finished.mock.calls[0][0]).toMatchObject({ success: true, interval: { completedAtSimMs: VOICE_GATE_CAP_MS + authored } });
});

test("word timing is scaled to the audio duration, clamped to 0.6x-1.8x of the authored duration", async () => {
  for (const [audioMs, expected] of [[authored * 1.3, Math.round(authored * 1.3)], [authored * 3, Math.round(authored * 1.8)],
    [authored * 0.2, Math.round(authored * 0.6)]] as const) {
    const audio = deferred<{ durationMs: number } | undefined>();
    const f = fixture(() => audio.promise);
    f.speak(); audio.resolve({ durationMs: audioMs }); await flush();
    expect(getSpeakingActivity(f.world, f.ada)).toMatchObject({ startedAtSimMs: 0, expectedEndSimMs: expected });
    f.advance(expected);
    const heard = f.fragments.map(x => x.heardAtSimMs);
    expect(heard.every((at, i) => i === 0 || at > heard[i - 1])).toBe(true);
    expect(heard.at(-1)).toBe(expected);
    expect(f.finished.mock.calls[0][0]).toMatchObject({ success: true, spokenText: LINE, interval: { completedAtSimMs: expected } });
  }
});

test("a rejected or undefined audio result starts the line at once with authored timing", async () => {
  const failed = fixture(() => Promise.reject(new Error("tts down")));
  failed.speak(); await flush();
  expect(getSpeakingActivity(failed.world, failed.ada)).toMatchObject({ startedAtSimMs: 0, expectedEndSimMs: authored });
  const empty = fixture(() => Promise.resolve(undefined));
  empty.advance(300); empty.speak(); await flush();
  expect(getSpeakingActivity(empty.world, empty.ada)).toMatchObject({ startedAtSimMs: 300, expectedEndSimMs: 300 + authored });
});

test("cancelled, cleared or replaced during the breath: the line never starts later", async () => {
  // Deliberate interruption.
  const a = deferred<{ durationMs: number } | undefined>(), interrupted = fixture(() => a.promise);
  interrupted.speak();
  expect(interruptTimedSpeech(interrupted.world, interrupted.ada, "changed my mind", { executionId: "line-1" })).toBe(true);
  expect(interrupted.finished.mock.calls[0][0]).toMatchObject({ success: false, emittedTokens: 0, spokenText: "" });
  a.resolve({ durationMs: authored }); await flush(); interrupted.advance(10_000);
  expect(interrupted.fragments).toHaveLength(0);
  expect(interrupted.finished).toHaveBeenCalledTimes(1);
  expect(isSpeaking(interrupted.world, interrupted.ada)).toBe(false);
  // Stop / source replacement.
  for (const clear of [clearTimedSpeech, clearSimulationTimeline]) {
    const b = deferred<{ durationMs: number } | undefined>(), cleared = fixture(() => b.promise);
    cleared.speak(); clear(cleared.world);
    expect(cleared.abandoned).toHaveBeenCalledTimes(1);
    b.resolve({ durationMs: authored }); await flush(); cleared.advance(10_000);
    expect(cleared.fragments).toHaveLength(0);
    expect(cleared.finished).not.toHaveBeenCalled();
    expect(isSpeaking(cleared.world, cleared.ada)).toBe(false);
  }
  // Actor package replaced mid-breath; a new line is admitted; the old audio cannot start the old line.
  const c = deferred<{ durationMs: number } | undefined>(), audios = [c.promise, new Promise<undefined>(() => {})];
  const replaced = fixture(() => audios.shift());
  replaced.speak("old");
  const remove = registerAgentWorldCapabilities(replaced.world, replaced.ada, { context: () => "", ready: () => true, busy: () => false, execute: () => false });
  try {
    expect(replaced.speak("new")).toBe(true);
    expect(replaced.abandoned).toHaveBeenCalledTimes(1);
    c.resolve({ durationMs: authored }); await flush();
    expect(getSpeakingActivity(replaced.world, replaced.ada)).toMatchObject({ executionId: "new", startedAtSimMs: 0, emittedTokens: 0 });
    replaced.advance(VOICE_GATE_CAP_MS + authored);
    expect(replaced.fragments.every(x => x.executionId === "new")).toBe(true);
    expect(replaced.finished).toHaveBeenCalledTimes(1);
    expect(replaced.finished.mock.calls[0][0].interval).toMatchObject({ executionId: "new", startedAtSimMs: VOICE_GATE_CAP_MS });
  } finally { remove(); }
});

test("a gate that declines (undefined) or throws leaves timing byte-for-byte as an ungated world", async () => {
  const runs = [undefined, () => undefined, () => { throw new Error("gate bug"); }].map(gate => {
    const f = fixture(gate as UtteranceVoiceGate | undefined);
    f.advance(700); f.speak(); f.advance(authored);
    return { fragments: f.fragments.map(({ audience: _a, ...rest }) => rest), result: f.finished.mock.calls[0][0].interval };
  });
  expect(runs[1]).toEqual(runs[0]);
  expect(runs[2]).toEqual(runs[0]);
  expect(runs[0].result).toMatchObject({ startedAtSimMs: 700, completedAtSimMs: 700 + authored });
});

test("removing the gate returns the world to ungated speech", async () => {
  const f = fixture(() => new Promise(() => {}));
  setUtteranceVoiceGate(f.world, undefined);
  f.speak();
  expect(getSpeakingActivity(f.world, f.ada)).toMatchObject({ startedAtSimMs: readSimulationTime(f.world), expectedEndSimMs: authored });
});
