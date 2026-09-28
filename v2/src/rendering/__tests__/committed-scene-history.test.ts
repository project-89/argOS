import { CommittedSceneHistory } from "../committed-scene-history";
import { CommittedSceneRenderer } from "../committed-scene-renderer";
import { SourcePlaybackTimeline } from "../source-playback-timeline";
import type { SceneEvent, SceneSnapshot } from "../scene-director";

function scene(ms = 0, events: SceneEvent[] = [], roomId = 10): SceneSnapshot {
  const appearance = { eid: 1, name: "Mara", identity: { height: "tall", build: "lean", hairColor: "black", hairStyle: "bob",
    eyeColor: "brown", skinTone: "olive", age: "adult", distinguishing: "freckles", description: "adult with dark bob" },
    clothing: "mustard cardigan", accessories: "", wornGarments: [], expression: "attentive", posture: "standing", condition: "dry",
    visiblyHolding: "", possessedItems: [], heldItems: [], description: "visible adult" };
  return { sourceId: "source:storm", sourceTick: ms, elapsedMs: ms, capturedWallMs: 1_000_000 + ms,
    room: { id: roomId, name: roomId === 10 ? "Hall" : "Secret room", description: "interior" },
    actors: [1, 2].map(id => ({ id, name: id === 1 ? "Mara" : "Ivo", roomId,
      appearance: { ...appearance, eid: id, name: id === 1 ? "Mara" : "Ivo" } })),
    props: [{ id: 3, roomId, name: "Phone", description: "black phone on desk", state: "on desk" }], events };
}
function event(sequence: number, ms: number, extra: Partial<SceneEvent> = {}): SceneEvent {
  return { id: `e:${sequence}`, sequence, sourceTick: ms, elapsedMs: ms, roomId: 10, actorId: 1,
    kind: "action", action: "interact", status: "pending", ...extra };
}
function capture(history: CommittedSceneHistory, sequence: number, ms: number, events: SceneEvent[] = [], patch: Partial<SceneSnapshot> = {}) {
  history.append({ sequence, scenes: [{ ...scene(ms, events), ...patch }] });
}
function window(history: CommittedSceneHistory, start = 0, end = 8000) {
  const result = history.assemble(start, end, 10); expect(result.status).toBe("ready");
  if (result.status !== "ready") throw new Error("Expected committed history"); return result.window;
}

test("public action target identity survives event-free continuation windows and restore", () => {
  const h = new CommittedSceneHistory();
  const props = [{ ...scene().props[0], identityKey: "original-phone" }];
  capture(h, 0, 0, [event(1, 0, { targetId: 3, targetKey: "original-phone", operation: "reading",
    interval: { executionId: "read-long", startedAtSimMs: 0 } })], { props });
  capture(h, 1, 1000, [], { props }); capture(h, 2, 2000, [], { props });
  const w = window(h, 1000, 2000);
  expect(w.events).toHaveLength(0);
  expect(w.actions[0]).toMatchObject({ targetId: 3, targetKey: "original-phone", operation: "reading",
    visibleStartSimMs: 1000, visibleEndSimMs: 2000, status: "pending", evidenceSequences: [1] });
  expect(window(CommittedSceneHistory.restore(h.checkpoint()), 1000, 2000).actions).toEqual(w.actions);
});

test.each(["pickup", "picking_up"])("protecting %s preserves an atomic action with its public motor label", protectedOperation => {
  const h = new CommittedSceneHistory(), interval = { executionId: "pickup:labeled", startedAtSimMs: 0, expectedEndSimMs: 1000 };
  capture(h, 0, 0, [event(1, 0, { action: "pickup", operation: "picking_up", interval })]);
  capture(h, 1, 2000, [event(2, 2000, { action: "speak", kind: "speech", status: "succeeded", text: "Hello.",
    interval: { executionId: "voice", startedAtSimMs: 1000, completedAtSimMs: 2000 } })]);
  capture(h, 2, 3000);
  // An expected end and a completed sentence cannot cut an unfinished reach.
  expect(h.safeSpeechBoundaries(0, 2500, 8000, [protectedOperation]).candidates).toEqual([]);
  expect(h.safeSpeechPhraseBoundaries(0, 8000, [protectedOperation])).toEqual([]);
  capture(h, 3, 4000, [event(3, 4000, { action: "pickup", operation: "picking_up", status: "succeeded",
    interval: { ...interval, completedAtSimMs: 4000 } })]);
  capture(h, 4, 5000);
  expect(h.safeSpeechBoundaries(0, 2500, 8000, [protectedOperation]).candidates).toEqual([4000.001]);
  expect(h.safeSpeechPhraseBoundaries(0, 8000, [protectedOperation])).toEqual([4000.001]);
});

test("windows contain immutable local history and actual sequence, not the latest scene", () => {
  const h = new CommittedSceneHistory(), initial: any = scene(); capture(h, 0, 0, [], initial);
  initial.actors[0].appearance.clothing = "FUTURE_COAT";
  capture(h, 1, 3000, [event(20, 3000, { status: "succeeded" })], { props: [{ ...scene().props[0], state: "in hand", heldBy: 1 }] });
  capture(h, 2, 8000); const w = window(h);
  expect(w.states[0].scene.actors[0].appearance.clothing).toBe("mustard cardigan");
  expect(w.events.map(e => e.event.sequence)).toEqual([20]);
  expect(w.startSequence).toBe(0); expect(w.endSequence).toBe(2);
  expect(Object.isFrozen(w.states[0].scene.actors[0].appearance)).toBe(true);
  expect(() => { (w.states[0].scene.room as any).name = "rewritten"; }).toThrow();
  expect(h.assemble(0, 8001, 10).status).toBe("buffering");
});
test("out-of-order, duplicate and cross-run captures cannot rewrite committed history", () => {
  const h = new CommittedSceneHistory(); capture(h, 1, 1000);
  for (const [sequence, ms] of [[1, 1000], [0, 2000], [2, 999]]) expect(() => capture(h, sequence, ms)).toThrow();
  expect(() => capture(h, 2, 2000, [], { sourceId: "restored-world" })).toThrow(/source runs/);
  expect(h.bounds().captures).toBe(1);
});
test("source event identities are immutable and missing event sequence is rejected", () => {
  const h = new CommittedSceneHistory(); capture(h, 0, 0, [event(1, 0)]);
  expect(() => capture(h, 1, 1000, [event(1, 0, { status: "succeeded" })])).toThrow(/rewritten/);
  expect(() => capture(h, 1, 1000, [event(2, 1000, { sequence: undefined })])).toThrow(/actual source/);
  expect(() => capture(h, 1, 1000, [event(2, 0)])).not.toThrow(); // same-time initial physical boundary
  expect(() => capture(h, 2, 2000, [event(3, 500)])).toThrow(/Late events/);
});
test("no private text, remote occupants, concealed inventory or forecast success enter a window prompt", () => {
  const h = new CommittedSceneHistory(); const source: any = scene();
  source.actors[0].thought = "PRIVATE_THOUGHT"; source.actors[0].appearance.possessedItems = [{ eid: 9, name: "SECRET_KEY" }];
  source.actors.push({ ...source.actors[0], id: 4, roomId: 20, name: "REMOTE_ACTOR" });
  source.events = [event(1, 0, { kind: "thought", text: "PRIVATE_THOUGHT" }), event(2, 0, { action: "read_message", text: "SECRET_MESSAGE" }),
    event(3, 9000, { kind: "speech", action: "speak", status: "succeeded", text: "FUTURE_REPLY" }),
    event(4, 0, { interval: { executionId: "pump", startedAtSimMs: 0, expectedEndSimMs: 1000 } })];
  h.append({ sequence: 0, scenes: [source, { ...scene(0, [], 20), actors: [], props: [] }] });
  capture(h, 1, 8000);
  const renderer = new CommittedSceneRenderer({ roomId: 10 }, h), result = renderer.next();
  expect(result.status).toBe("ready"); if (result.status !== "ready") return;
  for (const secret of ["PRIVATE_THOUGHT", "SECRET_KEY", "SECRET_MESSAGE", "REMOTE_ACTOR", "FUTURE_REPLY", "expectedEndSimMs"])
    expect(result.segment.prompt).not.toContain(secret);
  expect(result.segment.window.actions[0]).toMatchObject({ executionId: "pump", status: "pending", visibleEndSimMs: 8000 });
  expect(result.segment.window.actions[0]).not.toHaveProperty("completedAtSimMs");
  expect(result.segment.prompt).toContain("Ivo"); expect(result.segment.prompt).toContain("Mara");
});
test("long speech spans windows; only newly committed slices are rendered in each", () => {
  const h = new CommittedSceneHistory();
  const interval = { executionId: "voice:1", startedAtSimMs: 0, expectedEndSimMs: 20_000 };
  capture(h, 0, 0, [event(1, 0, { action: "speak", interval })]);
  capture(h, 1, 4000, [event(2, 4000, { kind: "speech", action: "speak", status: "succeeded", text: "First spoken slice.", interval })]);
  capture(h, 2, 8000);
  capture(h, 3, 12000, [event(3, 12000, { kind: "speech", action: "speak", status: "succeeded", text: "Second spoken slice.", interval })]);
  capture(h, 4, 16000);
  capture(h, 5, 20000, [event(4, 20000, { action: "speak", status: "succeeded", interval: { ...interval, completedAtSimMs: 20000 } })]);
  capture(h, 6, 24000);
  expect(window(h, 0, 8000).events.flatMap(e => e.event.text ?? [])).toEqual(["First spoken slice."]);
  expect(window(h, 8000, 16000).events.flatMap(e => e.event.text ?? [])).toEqual(["Second spoken slice."]);
  expect(window(h, 8000, 16000).actions[0]).toMatchObject({ status: "pending", visibleStartSimMs: 8000, visibleEndSimMs: 16000 });
  expect(window(h, 16000, 24000).actions[0]).toMatchObject({ status: "succeeded", completedAtSimMs: 20000, visibleEndSimMs: 20000 });
});
test("speech-aware boundaries use actual completion, include the final word once, and do not trust expected deadlines", () => {
  const h = new CommittedSceneHistory(), interval = { executionId: "voice:boundary", startedAtSimMs: 0, expectedEndSimMs: 6000 };
  capture(h, 0, 0, [event(1, 0, { action: "speak", interval })]);
  capture(h, 1, 8000, [event(2, 8000, { action: "speak", kind: "speech", status: "succeeded", text: "Still speaking ", interval })]);
  expect(h.speechBoundary(0, 8500, 15000)).toEqual({ endSimMs: 8500, buffering: true });
  capture(h, 2, 10000, [event(3, 10000, { action: "speak", kind: "speech", status: "succeeded", text: "now.", interval: { ...interval, completedAtSimMs: 10000 } })]);
  capture(h, 3, 10500);
  const boundary = h.speechBoundary(0, 8500, 15000);
  expect(boundary).toEqual({ endSimMs: 10000.001, buffering: false });
  expect(window(h, 0, boundary.endSimMs).events.flatMap(e => e.event.text ?? []).join("")).toBe("Still speaking now.");
  capture(h, 4, 20000);
  expect(window(h, boundary.endSimMs, 19000).events).toHaveLength(0);
  expect(h.speechBoundary(boundary.endSimMs, 18500, 25000)).toEqual({ endSimMs: 18500, buffering: false });
});
test("a late utterance can move wholly into the next interval; an overlong utterance cannot block the camera forever", () => {
  const h = new CommittedSceneHistory(), interval = { executionId: "voice:late", startedAtSimMs: 7000, expectedEndSimMs: 9000 };
  capture(h, 0, 0); capture(h, 1, 7000, [event(1, 7000, { action: "speak", interval })]); capture(h, 2, 8500);
  expect(h.speechBoundary(0, 8500, 15000)).toEqual({ endSimMs: 7000, buffering: false });
  expect(window(h, 0, 7000).events).toHaveLength(0);
  expect(h.speechBoundary(7000, 15500, 22000)).toEqual({ endSimMs: 15500, buffering: true });
  capture(h, 3, 22000);
  expect(h.speechBoundary(7000, 15500, 22000)).toEqual({ endSimMs: 15500, buffering: false });
  h.stop();
  expect(h.speechBoundary(7000, 15500, 30000).buffering).toBe(false);
  expect(() => h.speechBoundary(7000, 6500, 22000)).toThrow(/ordered/);
});
test("retention expiration is explicit and issued intervals survive independent retention", () => {
  const h = new CommittedSceneHistory({ maxCaptures: 2 }), renderer = new CommittedSceneRenderer({ roomId: 10 }, h);
  capture(h, 0, 0); capture(h, 1, 8000); const first = renderer.next();
  capture(h, 2, 16000); expect(h.assemble(0, 8000, 10).status).toBe("expired");
  expect(renderer.next()).toEqual(first);
  expect(renderer.settle(99, true)).toBe(false); expect(renderer.settle(1, true)).toBe(true);
  const next = renderer.next(); expect(next.status).toBe("ready");
  if (next.status === "ready") expect(next.segment.sourceStartSimMs).toBe(8000);
});
test("an action completed before a window cannot survive as an earlier pending interval", () => {
  const h = new CommittedSceneHistory(), interval = { executionId: "pickup:1", startedAtSimMs: 0, expectedEndSimMs: 1000 };
  capture(h, 0, 0, [event(1, 0, { action: "pickup", interval })]);
  capture(h, 1, 1000, [event(2, 1000, { action: "pickup", status: "succeeded", interval: { ...interval, completedAtSimMs: 1000 } })]);
  capture(h, 2, 3000);
  expect(window(h, 2000, 3000).actions).toHaveLength(0);
  const retained = new CommittedSceneHistory({ maxCaptures: 2 });
  capture(retained, 0, 0, [event(1, 0, { action: "pickup", interval })]);
  capture(retained, 1, 500);
  capture(retained, 2, 1000, [event(2, 1000, { action: "pickup", status: "succeeded", interval: { ...interval, completedAtSimMs: 1000 } })]);
  expect(window(retained, 500, 1000).actions[0]).toMatchObject({ startedAtSimMs: 0, completedAtSimMs: 1000, status: "succeeded" });
});
test("arrival in another room terminates local motion without importing remote outcome or speech", () => {
  const h = new CommittedSceneHistory(), interval = { executionId: "walk:1", startedAtSimMs: 0, expectedEndSimMs: 3000 };
  h.append({ sequence: 0, scenes: [scene(0, [event(1, 0, { action: "move", interval })]), { ...scene(0, [], 20), actors: [] }] });
  const arrived = event(2, 3000, { roomId: 20, action: "move", status: "succeeded", interval: { ...interval, completedAtSimMs: 3000 } });
  h.append({ sequence: 1, scenes: [{ ...scene(3000), actors: [] }, scene(3000, [arrived,
    event(3, 3000, { roomId: 20, kind: "speech", action: "speak", status: "succeeded", text: "SECRET_REMOTE_REPLY" })], 20)] });
  h.append({ sequence: 2, scenes: [{ ...scene(8000), actors: [] }, scene(8000, [], 20)] });
  const w = window(h);
  expect(w.actions[0]).toMatchObject({ executionId: "walk:1", completedAtSimMs: 3000, visibleEndSimMs: 3000, status: "out_of_view" });
  expect(JSON.stringify(w)).not.toContain("SECRET_REMOTE_REPLY");
  expect(JSON.stringify(w)).not.toContain("Secret room");
  expect(window(h, 4000, 8000).actions).toHaveLength(0);
});
test("event capacity loss invalidates affected intervals, never silently renders incomplete evidence", () => {
  const h = new CommittedSceneHistory({ maxEvents: 1 }); capture(h, 0, 0);
  capture(h, 1, 1000, [event(1, 1000)]); capture(h, 2, 2000, [event(2, 2000)]);
  expect(h.assemble(0, 2000, 10).status).toBe("expired");
  expect(h.bounds().events).toBe(1);
});
test("bounded event-local admission witnesses survive snapshot retention without resurrecting completed work", () => {
  const h = new CommittedSceneHistory({ maxCaptures: 2 });
  const pending = event(1, 0, { interval: { executionId: "long-work", startedAtSimMs: 0, expectedEndSimMs: 9000 } });
  capture(h, 0, 0);
  h.append({ sequence: 1, scenes: [scene(1000)], eventWitnesses: [{ event: pending, scene: scene(0) }] });
  capture(h, 2, 2000); capture(h, 3, 3000);
  expect(window(h, 2000, 3000).actions[0]).toMatchObject({ executionId: "long-work", startedAtSimMs: 0, status: "pending" });
  const restored = CommittedSceneHistory.restore(h.checkpoint());
  expect(window(restored, 2000, 3000).actions).toEqual(window(h, 2000, 3000).actions);
  capture(h, 4, 4000, [event(2, 4000, { status: "failed", interval: { executionId: "long-work", startedAtSimMs: 0, completedAtSimMs: 4000 } })]);
  capture(h, 5, 5000);
  expect(window(h, 4000, 5000).actions).toHaveLength(0);
});
test("stop and restored tape are historical-only, reject new live runs, and preserve local scene data", () => {
  const h = new CommittedSceneHistory(); capture(h, 0, 0); capture(h, 1, 1000, [event(1, 1000)]); capture(h, 2, 8000);
  h.stop(); expect(h.assemble(0, 9000, 10).status).toBe("ended"); expect(() => capture(h, 3, 9000)).toThrow(/stopped/);
  const restored = CommittedSceneHistory.restore(h.checkpoint());
  expect(window(restored)).toEqual(window(h)); expect(() => capture(restored, 3, 9000)).toThrow(/stopped/);
  const corrupt = h.checkpoint(); corrupt.sourceId = "different"; expect(() => CommittedSceneHistory.restore(corrupt)).toThrow(/identity/);
});
test("renderer buffering never fabricates a prompt; provider rejection retries the same source with a fresh version", () => {
  const renderer = new CommittedSceneRenderer({ roomId: 10 }); capture(renderer.history, 0, 0);
  expect(renderer.configure().status).toBe("buffering"); capture(renderer.history, 1, 8000);
  const first = renderer.configure(); expect(first.status).toBe("ready"); if (first.status !== "ready") return;
  expect(first.configure.prompt_version).toBe(1);
  renderer.settle(1, false); const retry = renderer.next(); expect(retry.status).toBe("ready");
  if (retry.status === "ready") { expect(retry.segment.version).toBe(2); expect(retry.segment.window).toEqual(first.segment.window); }
  renderer.stop(); expect(renderer.next().status).toBe("stopped");
});
test("actual chunk versions map the playhead to source states, including out-of-order transport and seeks", () => {
  const h = new CommittedSceneHistory(); capture(h, 0, 0); capture(h, 1, 4000, [], { props: [{ ...scene().props[0], state: "held" }] });
  capture(h, 2, 8000); capture(h, 3, 16000);
  const renderer = new CommittedSceneRenderer({ roomId: 10 }, h), first = renderer.next(); if (first.status !== "ready") throw new Error();
  renderer.settle(first.segment.version, true); const second = renderer.next(); if (second.status !== "ready") throw new Error();
  const timeline = new SourcePlaybackTimeline(); timeline.register(first.segment); timeline.register(second.segment);
  expect(timeline.add({ chunk_index: 1, playback_seconds: 8, prompt_version: 2 })).toBe(true);
  expect(timeline.at(9).status).toBe("buffering");
  timeline.add({ chunk_index: 0, playback_seconds: 8, prompt_version: 1 });
  expect(timeline.at(3)).toMatchObject({ status: "mapped", sourceSimMs: 3000, sourceSequence: 0, scene: { props: [{ state: "on desk" }] } });
  expect(timeline.at(5)).toMatchObject({ status: "mapped", sourceSimMs: 5000, sourceSequence: 1, scene: { props: [{ state: "held" }] } });
  expect(timeline.at(9)).toMatchObject({ status: "mapped", sourceSimMs: 9000, chunk: { version: 2 } });
  expect(timeline.at(3)).toMatchObject({ sourceSimMs: 3000 });
  expect(timeline.add({ chunk_index: 0, playback_seconds: 20, prompt_version: 2 })).toBe(false);
  expect(timeline.at(16)).toEqual({ status: "buffering", reason: "end_of_tape" });
});
test("duration mismatch and repeated source versions rebuffer instead of silently compressing time", () => {
  const h = new CommittedSceneHistory(); capture(h, 0, 0); capture(h, 1, 8000);
  const result = new CommittedSceneRenderer({ roomId: 10 }, h).next(); if (result.status !== "ready") throw new Error();
  const bad = new SourcePlaybackTimeline(); bad.register(result.segment); bad.add({ chunk_index: 0, playback_seconds: 6.375, prompt_version: 1 });
  expect(bad.at(1)).toEqual({ status: "unmapped", reason: "duration_mismatch" });
  const edited = new SourcePlaybackTimeline(); edited.register(result.segment);
  edited.add({ chunk_index: 0, playback_seconds: 4, prompt_version: 1 }, { sourceRate: 2 });
  expect(edited.at(1)).toMatchObject({ status: "mapped", sourceSimMs: 2000 });
  const repeat = new SourcePlaybackTimeline(); repeat.register(result.segment);
  repeat.add({ chunk_index: 0, playback_seconds: 8, prompt_version: 1 }); repeat.add({ chunk_index: 1, playback_seconds: 8, prompt_version: 1 });
  expect(repeat.at(9)).toEqual({ status: "unmapped", reason: "source_discontinuity" });
  repeat.stop(); expect(repeat.add({ chunk_index: 2, playback_seconds: 8, prompt_version: 1 })).toBe(false);
});

test("30 minutes of committed ticks plus event boundaries remain immutable while a renderer lags at the opening", () => {
  const h = new CommittedSceneHistory({ retentionMs: 2_000_000, maxCaptures: 20_000, maxEvents: 65_536, maxBytes: 128 * 1024 * 1024 });
  let sequence = 0, eventSequence = 0;
  for (let tick = 0; tick <= 3600; tick++) {
    const ms = tick * 500;
    capture(h, sequence++, ms, tick % 30 === 0 ? [event(++eventSequence, ms, { kind: "speech", action: "speak", status: "succeeded", text: `actually spoken at ${ms}` })] : []);
    if (tick < 3600) capture(h, sequence++, ms + 250);
  }
  expect(h.bounds()).toMatchObject({ captures: 7201, availableStartSimMs: 0, availableEndSimMs: 1_800_000 });
  const first = window(h, 0, 8500);
  expect(first.events.map(event => event.event.text)).toEqual(["actually spoken at 0"]);
  expect(JSON.stringify(first)).not.toContain("actually spoken at 1800000");
  expect(window(h, 1_791_500, 1_800_000).states.at(-1)!.atSimMs).toBe(1_800_000);
  expect(h.bounds().retainedBytes).toBeLessThan(128 * 1024 * 1024);
  h.stop(); expect(h.assemble(1_800_000, 1_808_500, 10).status).toBe("ended");
});

test("long-run history still expires explicitly beyond its configured retention, without leaping to a later source", () => {
  const h = new CommittedSceneHistory({ retentionMs: 1_800_000, maxCaptures: 20_000 });
  capture(h, 0, 0); capture(h, 1, 500); capture(h, 2, 1_800_500);
  expect(h.assemble(0, 8500, 10)).toMatchObject({ status: "expired", availableStartSimMs: 500 });
});

test("a payload byte ceiling fails before appending or changing historical evidence", () => {
  const probe = new CommittedSceneHistory(); capture(probe, 0, 0);
  const h = new CommittedSceneHistory({ maxBytes: probe.bounds().retainedBytes + 100 }); capture(h, 0, 0);
  const before = h.checkpoint();
  expect(() => capture(h, 1, 500, [event(1, 500)])).toThrow(/byte limit/);
  expect(h.checkpoint()).toEqual(before); expect(h.assemble(0, 500, 10).status).toBe("buffering");
});
