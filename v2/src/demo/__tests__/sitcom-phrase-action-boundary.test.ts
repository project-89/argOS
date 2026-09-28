import { CommittedSceneHistory } from "../../rendering/committed-scene-history";
import type { SceneEvent, SceneSnapshot } from "../../rendering/scene-director";
import { SitcomScreenwriter, type PhoneSound } from "../sitcom-screenplay";

// Public executor tape from axS1ql, reduced to the failing two voices and phone.
// Preserve its exact word receipts, execution spans, and six-second buzz cadence;
// no recording directory, model, live ECS mutation, or H3 service is required.
const cursor = 36220.001, safeCut = 46065.001;
function receipt(sequence: number, at: number, actorId: number, executionId: string,
  start: number, extra: Partial<SceneEvent> = {}): SceneEvent {
  return { id: `axS1ql:${sequence}`, sequence, elapsedMs: at, sourceTick: Math.ceil(at / 500),
    actorId, actorKey: `actor:${actorId}`, roomId: 16, roomKey: "kitchen", kind: "speech",
    action: "speak", status: "succeeded", interval: { executionId, startedAtSimMs: start }, ...extra };
}
function fixture(options: { nextWordAt?: number; pendingTyping?: boolean; secondVoiceAt?: number } = {}) {
  const events: SceneEvent[] = [receipt(52, 35000, 17, "jerry", 35000, { status: "pending" })];
  const jerry = ["A ", "text? ", "Two ", "years ", "and ", "he ", "couldn't ", "even ", "bother ", "with ", "a ", "phone ", "call?"];
  const jerryTimes = [35700, 36220, 36620, 37020, 37420, 37820, 38220, 38620, 39020, 39420, 39820, 40220, 40740];
  const jerrySeqs = [53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 64, 65, 66];
  events.push(...jerry.map((text, i) => receipt(jerrySeqs[i], jerryTimes[i], 17, "jerry", 35000, { text })));
  events.push(receipt(67, 40740, 17, "jerry", 35000, { interval: { executionId: "jerry", startedAtSimMs: 35000, completedAtSimMs: 40740 } }));
  const typing = { executionId: "typing", startedAtSimMs: 39500, expectedEndSimMs: 46065 };
  events.push(receipt(63, 39500, 18, "typing", 39500, { kind: "action", action: "interact", operation: "typing",
    status: "pending", targetId: 22, targetKey: "phone", interval: typing }));
  if (!options.pendingTyping) events.push(receipt(74, 46065, 18, "typing", 39500, { kind: "action", action: "interact",
    operation: "typing", targetId: 22, targetKey: "phone", interval: { ...typing, completedAtSimMs: 46065 } }));
  const elaine = ["Not ", "even ", "a ", "phone ", "call! ", "Fourteen ", "words, ", "Jerry. ", "Fourteen ", "words ", "to ", "end ", "two ", "years!"];
  const elaineTimes = [44200, 44600, 45000, 45400, 45920, options.nextWordAt ?? 46320, 46840, 47360, 47760, 48160, 48560, 48960, 49360, 49880];
  const elaineSeqs = [69, 70, 71, 72, 73, 75, 76, 77, 78, 79, 80, 81, 82, 83];
  events.push(receipt(68, 43500, 18, "elaine", 43500, { status: "pending" }));
  events.push(...elaine.map((text, i) => receipt(elaineSeqs[i], elaineTimes[i], 18, "elaine", 43500, { text })));
  events.push(receipt(84, 49880, 18, "elaine", 43500, { interval: { executionId: "elaine", startedAtSimMs: 43500, completedAtSimMs: 49880 } }));
  if (options.secondVoiceAt !== undefined) events.push(receipt(85, options.secondVoiceAt, 17, "other-voice", 45000, { text: "Wait " }));
  // Re-number only deliberately perturbed negative fixtures so source ordering
  // remains valid; the positive regression retains original evidence numbers.
  events.sort((a, b) => a.elapsedMs - b.elapsedMs || a.sequence! - b.sequence!);
  const ordered = options.nextWordAt !== undefined || options.secondVoiceAt !== undefined
    ? events.map((event, i) => ({ ...event, sequence: i + 1 })) : events;
  const scene = (at: number, newEvents: SceneEvent[] = []): SceneSnapshot => ({
    sourceId: "source:axS1ql", sourceTick: Math.ceil(at / 500), elapsedMs: at, capturedWallMs: at,
    room: { id: 16, identityKey: "kitchen", name: "Kitchen", description: "An interior kitchen." },
    actors: [17, 18].map(id => ({ id, identityKey: `actor:${id}`, name: id === 17 ? "Jerry" : "Elaine", roomId: 16,
      appearance: { eid: id, name: id === 17 ? "Jerry" : "Elaine",
        identity: { height: "average", build: "average", hairColor: "dark", hairStyle: "short", eyeColor: "brown", skinTone: "fair", age: "adult", distinguishing: "", description: "visible adult" },
        clothing: "recorded clothing", accessories: "", expression: "attentive", posture: "standing", condition: "dry",
        visiblyHolding: "", wornGarments: [], heldItems: [], possessedItems: [], description: "visible adult" } })),
    props: [{ id: 22, identityKey: "phone", roomId: 16, name: "Elaine's phone", description: "phone", heldBy: 18 }], events: newEvents });
  const history = new CommittedSceneHistory(); let sequence = 0;
  history.append({ sequence: sequence++, scenes: [scene(34200)] });
  for (const at of [...new Set(ordered.map(e => e.elapsedMs))]) history.append({ sequence: sequence++, scenes: [scene(at, ordered.filter(e => e.elapsedMs === at))] });
  history.append({ sequence: sequence++, scenes: [scene(56500)] });
  const sounds: PhoneSound[] = [34200, 40200, 46200, 52200].map((atSimMs, index) => ({
    sequence: [232, 263, 301, 340][index], atSimMs, roomId: 16, kind: "phone_double_vibration",
    visibleSource: { id: 22, name: "Elaine's phone", heldBy: 18 } }));
  return { history, events: ordered, sounds };
}
const operations = ["reading", "typing", "pickup"];
function compile(history: CommittedSceneHistory, writer: SitcomScreenwriter, sounds: readonly PhoneSound[], start: number, end: number, version: number) {
  const result = history.assemble(start, end, 16);
  if (result.status !== "ready") throw new Error(result.status);
  return writer.compile([result.window], sounds.filter(s => s.atSimMs >= start && s.atSimMs < end), version,
    { mediaDurationMs: 8500, requireWholeUtterances: true, allowSpeechSlices: true, preserveSoundCadence: true });
}

test("axS1ql offers actual typing completion inside a delivered sentence pause, preserving every word and gesture", () => {
  const { history, events, sounds } = fixture(), writer = new SitcomScreenwriter();
  const first = compile(history, writer, sounds, 34200, cursor, 5); first.commit();
  const immutableFirst = JSON.stringify(first.script), before = history.checkpoint();
  expect(first.script.beats.find(b => b.kind === "speech")?.text).toBe("A text?");
  expect(() => compile(history, writer, sounds, cursor, 45920.001, 6)).toThrow(/essential phone gesture/);
  expect(() => compile(history, writer, sounds, cursor, 46840.001, 6)).toThrow(/require 11360ms/);
  expect(history.safeSpeechBoundaries(cursor, cursor + 8500, cursor + 20000, operations).candidates).not.toContain(safeCut);
  expect(history.safeSpeechPhraseBoundaries(cursor, cursor + 20000, operations)).toContain(safeCut);
  const second = compile(history, writer, sounds, cursor, safeCut, 6); second.commit();
  expect(second.script.beats.filter(b => b.kind === "speech").map(b => b.text)).toEqual([
    "Two years and he couldn't even bother with a phone call?", "Not even a phone call!" ]);
  expect(second.script.performance.endingSilenceMs).toBeGreaterThanOrEqual(500 - .001);
  const gesture = second.script.beats.find(b => b.operation === "typing" && b.endSimMs !== undefined)!;
  expect(gesture).toMatchObject({ atSimMs: 39500, endSimMs: 46065, evidence: [63, 74] });
  const gestureCue = second.script.performance.cues[second.script.beats.indexOf(gesture)];
  expect(gestureCue.endMs - gestureCue.startMs).toBeGreaterThanOrEqual(1800);
  const third = compile(history, writer, sounds, safeCut, 49880.001, 7); third.commit();
  const scripts = [first.script, second.script, third.script];
  const speech = scripts.flatMap(s => s.beats.filter(b => b.kind === "speech"));
  expect(speech.map(b => b.text).join(" ")).toBe("A text? Two years and he couldn't even bother with a phone call? Not even a phone call! Fourteen words, Jerry. Fourteen words to end two years!");
  expect(speech.at(-1)?.speechSlice).toMatchObject({ starts: "resumes_utterance", ends: "utterance_complete" });
  const words = speech.flatMap(b => [...b.evidence]);
  expect(words).toEqual(events.filter(e => e.text).map(e => e.sequence));
  expect(new Set(words).size).toBe(words.length);
  expect(scripts.flatMap(s => s.beats.filter(b => b.operation === "typing" && b.endSimMs !== undefined))).toHaveLength(1);
  const soundCues = scripts.flatMap((s, i) => s.performance.cues.filter(c => s.beats[c.beat].kind === "sound")
    .map(c => ({ at: i * 8500 + c.startMs, duration: c.endMs - c.startMs, evidence: c.evidence })));
  expect(soundCues.flatMap(c => [...c.evidence])).toEqual([232, 263, 301]);
  expect(soundCues.every(c => c.duration >= 800 - .001)).toBe(true);
  expect(soundCues.slice(1).every((c, i) => c.at - soundCues[i].at >= 6000 - .001)).toBe(true);
  expect(JSON.stringify(first.script)).toBe(immutableFirst); expect(history.checkpoint()).toEqual(before);
});

test.each(["next word", "expected-only end", "another voice"])("a nearby %s cannot masquerade as a safe sentence pause", variant => {
  const options = variant === "next word" ? { nextWordAt: 46000 }
    : variant === "expected-only end" ? { pendingTyping: true } : { secondVoiceAt: 46000 };
  const { history, sounds } = fixture(options);
  const candidates = history.safeSpeechPhraseBoundaries(cursor, cursor + 20000, operations);
  expect(candidates).not.toContain(safeCut);
  // With no valid post-clause gap, every offered candidate still fails closed.
  for (const end of candidates) expect(() => compile(history, new SitcomScreenwriter(), sounds, cursor, end, 6)).toThrow();
});

test("actual completion beyond the available horizon never offers an early or backdated cut", () => {
  const { history } = fixture();
  expect(history.safeSpeechPhraseBoundaries(cursor, 46065, operations)).not.toContain(safeCut);
  expect(history.safeSpeechPhraseBoundaries(cursor, 46065.001, operations)).toContain(safeCut);
});
