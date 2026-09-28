import { buildSitcomPerformance, PerformanceBudgetError } from "../sitcom-performance";
import type { ScreenBeat } from "../sitcom-screenplay";
import { SitcomPlayback } from "../sitcom-presentation";

const line = (atSimMs: number, endSimMs: number, text: string, actorId = 1, evidence = [1]): ScreenBeat => ({
  kind: "speech", atSimMs, endSimMs, text, actorId, direction: text, evidence });
const action = (atSimMs: number, endSimMs: number, operation: string, evidence = [3]): ScreenBeat => ({
  kind: "action", atSimMs, endSimMs, operation, actorId: 2, direction: operation, evidence });

test("the recorded OJ5IGi two-second blank opening cannot be sold as ten seconds of performance", () => {
  expect(() => buildSitcomPerformance([], 0, 2000, 10125, true)).toThrow(PerformanceBudgetError);
  const p = buildSitcomPerformance([], 0, 10125, 10125, true);
  expect(p.durationMs).toBe(10125); expect(p.sourceMap.at(-1)).toEqual({ mediaMs: 10125, sourceMs: 10125 });
});
test("recorded OJ5IGi v17 cannot stuff 27 spoken words and13.58 source seconds into8.5 media seconds", () => {
  const beats = [line(126500, 133160, "Just admit it, George! You took one look at that cookie and couldn't help yourself!"),
    line(133500, 138960, "You're fighting a two-front war here, George: Elaine's rage and Kramer's crumbs.", 2, [2])];
  expect(() => buildSitcomPerformance(beats, 125380.001, 138960.001, 8500)).toThrow(/exceeding the8500|exceeding the 8500/);
  for (const [index, b] of beats.entries()) {
    const p = buildSitcomPerformance([b], index ? 133500 : 125380.001, b.endSimMs! + .001, 8500);
    expect(p.cues[0].endMs).toBeLessThanOrEqual(8000); expect(p.cues[0].evidence).toEqual(b.evidence);
  }
});
test("phone checking gets a focal hands insert even while another character speaks offscreen", () => {
  const beats = [line(0, 5000, "Would you like me to stay?", 1, [1, 2]), action(1200, 2400, "reading")];
  const p = buildSitcomPerformance(beats, 0, 8500, 8500);
  const read = p.cues[1]; expect(read.endMs - read.startMs).toBeGreaterThanOrEqual(1800);
  expect(p.shots.some(s => s.actorId === 2 && s.kind === "interaction_insert" && s.beat === 1)).toBe(true);
  expect(p.cues.flatMap(c => c.evidence)).toEqual([1, 2, 3]);
  expect(p.endingSilenceMs).toBeGreaterThanOrEqual(500 - .001);
  expect(p.cues.every(c => c.startMs >= 0 && c.endMs <= p.durationMs - 500 + .001)).toBe(true);
});
test("indivisible long dialogue and conflicting focal phone gestures fail explicitly", () => {
  expect(() => buildSitcomPerformance([line(0, 16000, Array(32).fill("word").join(" "))], 0, 17000, 8500)).toThrow(/media budget/);
  expect(() => buildSitcomPerformance([action(0, 1200, "reading"), { ...action(0, 1200, "typing"), actorId: 4 }], 0, 8500, 8500)).toThrow(/Overlapping essential/);
  expect(() => buildSitcomPerformance([line(0, 3000, "Hello there"), line(1000, 3500, "Hello again", 2)], 0, 8500, 8500)).toThrow(/Overlapping committed utterances/);
});
test("pickup, read, and typed send each get evidence-backed media coverage without changing source time", () => {
  const beats = [action(1000, 1800, "pickup", [1]), action(2200, 3400, "reading", [2]), action(4000, 5600, "typing", [3]),
    { kind: "action", atSimMs: 5600, actorId: 2, operation: "typing", direction: "finishes typing", evidence: [4] } as ScreenBeat];
  const before = JSON.stringify(beats), p = buildSitcomPerformance(beats, 0, 8500, 8500);
  expect(JSON.stringify(beats)).toBe(before); expect(p.cues).toHaveLength(4);
  for (let i = 0; i < 3; i++) expect(p.shots.some(s => s.beat === i)).toBe(true);
  const t = new SitcomPlayback();
  expect(t.register({ version: 1, sourceId: "source", sourceStartSimMs: 0, sourceEndSimMs: 8500, performance: p })).toBe(true);
  t.add({ chunk_index: 0, playback_seconds: 8.5, prompt_version: 1 });
  const receipt = p.cues[3].startMs;
  const beforeRead = t.at((p.cues[1].endMs - 1) / 1000), afterSend = t.at((receipt + 1) / 1000);
  expect(beforeRead.state === "mapped" && beforeRead.sourceMs < 3400).toBe(true);
  expect(afterSend.state === "mapped" && afterSend.sourceMs >= 5600).toBe(true);
  expect(Object.isFrozen(p.sourceMap[0])).toBe(true);
});
test("playback does not retime the issued prompt after an unexpectedly short provider chunk", () => {
  const p = buildSitcomPerformance([line(0, 5000, "A complete short line.")], 0, 8500, 8500);
  const t = new SitcomPlayback(); t.register({ version: 1, sourceId: "source", sourceStartSimMs: 0, sourceEndSimMs: 8500, performance: p });
  t.add({ chunk_index: 0, playback_seconds: 5, prompt_version: 1 });
  expect(t.at(2)).toEqual({ state: "unmapped", reason: "provider_chunk_shorter_than_performance" });
  const long = new SitcomPlayback(); long.register({ version: 1, sourceId: "source", sourceStartSimMs: 0, sourceEndSimMs: 8500, performance: p });
  long.add({ chunk_index: 0, playback_seconds: 10.125, prompt_version: 1 });
  expect(long.at(9)).toMatchObject({ state: "held", sourceMs: 8500, reason: "performance_ending_hold" });
});

test("TzVeWO recurring double vibrations keep audible duration and six-second cadence instead of a150ms burst", () => {
  const buzz = (atSimMs: number, sequence: number): ScreenBeat => ({ kind: "sound", atSimMs,
    soundKey: "phone:elaine", audibleDurationMs: 800, direction: "One double phone vibration", evidence: [sequence] });
  const p = buildSitcomPerformance([buzz(52200, 284), buzz(58200, 313)], 51040.001, 59540.001, 8500);
  expect(p.cues[0].endMs - p.cues[0].startMs).toBeGreaterThanOrEqual(800 - .001);
  expect(p.cues[1].endMs - p.cues[1].startMs).toBeGreaterThanOrEqual(800 - .001);
  expect(p.cues[1].startMs - p.cues[0].startMs).toBeGreaterThanOrEqual(6000 - .001);
  expect(p.endingSilenceMs).toBeLessThan(2000);
  expect(() => buildSitcomPerformance([buzz(0, 1), buzz(10000, 2)], 0, 11000, 8500)).toThrow(/media budget/);
});

test("a cadence guard can preserve a prior packet's sound spacing, including a source-held leading pause", () => {
  const b: ScreenBeat = { kind: "sound", atSimMs: 13000, soundKey: "phone", audibleDurationMs: 800,
    notBeforeMediaMs: 4500, direction: "double vibration", evidence: [1] };
  const p = buildSitcomPerformance([b], 8500, 17000, 8500);
  expect(p.cues[0].startMs).toBeGreaterThanOrEqual(4500);
  const leading = buildSitcomPerformance([{ ...b, atSimMs: 8500, notBeforeMediaMs: 1200 }], 8500, 17000, 8500);
  expect(leading.sourceMap.slice(0, 2)).toEqual([{ mediaMs: 0, sourceMs: 8500 }, { mediaMs: 1200, sourceMs: 8500 }]);
  expect(leading.cues[0].startMs).toBe(1200);
});
