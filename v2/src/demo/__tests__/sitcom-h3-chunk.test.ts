import { h3ChunkForPlayback, H3_MEDIA_TIMING, validateH3ChunkSeconds, validateH3Memory, isH3SetupAcknowledgement, confirmH3ChunkSeconds, sitcomH3LaunchOptions, sitcomPromptMessage } from "../sitcom-h3-chunk";
import { SitcomPlayback } from "../sitcom-presentation";

const raw = { chunk_index: 1, prompt_version: 1, script_version: 2, script_offset_seconds: 0,
  playback_seconds: 10, generation_seconds: 2.084, scheduling_lead_ms: 4523.492 };
test("only the matching configured receipt establishes setup readiness",()=>{
  for(const type of ["prompt_pending","prompt_applied","chunk","session_info"])
    expect(isH3SetupAcknowledgement({type,prompt_version:1})).toBe(false);
  expect(isH3SetupAcknowledgement({type:"configured",prompt_version:2})).toBe(false);
  expect(isH3SetupAcknowledgement({type:"configured"})).toBe(false);
  expect(isH3SetupAcknowledgement({type:"configured",prompt_version:1})).toBe(true);
});
test("prompt-history experiments are explicit, bounded, and leave the default unchanged", () => {
  expect(sitcomH3LaunchOptions([], {})).toEqual({scriptQueue:true});
  expect(sitcomH3LaunchOptions([], {ARGOS_H3_MEMORY:"1"})).toEqual({scriptQueue:true,h3Memory:1});
  for (const value of [1,12,50]) expect(validateH3Memory(value)).toBe(value);
  for (const value of [0,51,1.5,NaN,Infinity,"1",undefined]) expect(()=>validateH3Memory(value)).toThrow();
  for (const value of ["", "0", "NaN", "51"]) expect(()=>sitcomH3LaunchOptions([], {ARGOS_H3_MEMORY:value})).toThrow();
});
test("a matched duration experiment requires explicit accepted settings, never merely an advertised range", () => {
  for (const n of [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
    expect(validateH3ChunkSeconds(n)).toBe(n);
    expect(() => confirmH3ChunkSeconds({ type: "configured", chunk_duration: n }, n)).not.toThrow();
    expect(h3ChunkForPlayback({ ...raw, playback_seconds: n }, true, [1, 2], n).playback_seconds).toBe(n);
  }
  for (const n of [undefined, 0, 4, 8.5, 16, Infinity, "5", NaN]) expect(() => validateH3ChunkSeconds(n)).toThrow();
  for (const m of [{ type: "configured" }, { type: "configured", chunk_duration: 10 }, { type: "session_info", min_chunk_duration: 5 }])
    expect(() => confirmH3ChunkSeconds(m, 5)).toThrow(/did not confirm/);
  expect(() => h3ChunkForPlayback(raw, true, [1, 2], 5)).toThrow(/5-second/);
});
test("captured rIUQMi chunk retains raw evidence while normalizing the active script namespace", () => {
  const before = JSON.stringify(raw), chunk = h3ChunkForPlayback(raw, true, [1, 2, 3]);
  expect(chunk).toEqual({ chunk_index: 1, prompt_version: 2, playback_seconds: 10 });
  expect(JSON.stringify(raw)).toBe(before); expect(Object.isFrozen(chunk)).toBe(true);
  expect(h3ChunkForPlayback({ ...raw, playback_seconds: 8.5 }, false, [1, 2, 3]).prompt_version).toBe(1);
});
test("GUI queues by default; explicit direct diagnostics remain available", () => {
  expect(sitcomH3LaunchOptions([], {})).toEqual({ scriptQueue: true });
  expect(sitcomH3LaunchOptions([], { ARGOS_H3_SCRIPT_QUEUE: "0" })).toEqual({ scriptQueue: false });
  expect(sitcomH3LaunchOptions(["--h3-direct"], { ARGOS_H3_SCRIPT_QUEUE: "1" })).toEqual({ scriptQueue: false });
  expect(sitcomH3LaunchOptions(["--h3-script"], {})).toEqual({ scriptQueue: true });
  expect(() => sitcomH3LaunchOptions(["--h3-direct", "--h3-script"], {})).toThrow();
  expect(() => sitcomH3LaunchOptions(["--h3-direct"], {ARGOS_H3_CHUNK_SECONDS:"5"})).toThrow(/calibrated/);
  expect(sitcomPromptMessage({version:2,prompt:"One committed line"}, false)).toEqual({type:"prompt",prompt_version:2,prompt:"One committed line",replan:true});
});
test("direct receipts preserve real lengths and fail closed on another duration family", () => {
  expect(h3ChunkForPlayback({chunk_index:0,prompt_version:1,playback_seconds:10.125},false,[1]).playback_seconds).toBe(10.125);
  expect(h3ChunkForPlayback({chunk_index:1,prompt_version:2,playback_seconds:8.5},false,[1,2]).playback_seconds).toBe(8.5);
  for (const m of [{chunk_index:0,prompt_version:1,playback_seconds:5.167},{chunk_index:1,prompt_version:2,playback_seconds:10}])
    expect(()=>h3ChunkForPlayback(m,false,[1,2])).toThrow(/calibration/);
});
test("native scripts cannot fall back to a valid premise when the active script is absent or unissued", () => {
  for (const script_version of [undefined, null, 0, 2.1, "2", 99])
    expect(() => h3ChunkForPlayback({ ...raw, script_version }, true, [1, 2])).toThrow(/script identity/);
  expect(() => h3ChunkForPlayback(raw, true, [1])).toThrow(/script identity/);
});
test("malformed timing remains a failure independent of namespace", () => {
  for (const patch of [{ chunk_index: -1 }, { chunk_index: 1024 }, { playback_seconds: 0 }, { playback_seconds: NaN }])
    expect(() => h3ChunkForPlayback({ ...raw, ...patch }, true, [1, 2])).toThrow(/timing/);
});
test("native timing cannot silently inherit legacy lengths or accumulate an unbudgeted ending hold", () => {
  for (const playback_seconds of [8.5, 10.5, 12])
    expect(() => h3ChunkForPlayback({ ...raw, playback_seconds }, true, [1, 2])).toThrow(/calibration/);
  expect(h3ChunkForPlayback({ ...raw, playback_seconds: 10.125 }, true, [1, 2]).playback_seconds).toBe(10.125);
  expect(h3ChunkForPlayback({ ...raw, playback_seconds: 8.5 }, false, [1, 2]).playback_seconds).toBe(8.5);
});
test("script2 maps to source2, while a real repeat of script1 still holds source1", () => {
  const timeline = new SitcomPlayback();
  for (const version of [1, 2]) timeline.register({ version, sourceId: "recorded", sourceStartSimMs: (version - 1) * 10000, sourceEndSimMs: version * 10000 });
  timeline.add(h3ChunkForPlayback({ ...raw, chunk_index: 0, script_version: 1 }, true, [1, 2]));
  timeline.add(h3ChunkForPlayback(raw, true, [1, 2]));
  expect(timeline.at(11)).toMatchObject({ state: "mapped", version: 2, sourceMs: 11000 });
  timeline.add(h3ChunkForPlayback({ ...raw, chunk_index: 2 }, true, [1, 2]));
  expect(timeline.at(21)).toMatchObject({ state: "held", version: 2, sourceMs: 20000, reason: "provider_repeated_prior_prompt" });
});
test("native immutable performance maps use the full calibrated continuation instead of an extra 1.5s hold", () => {
  const timeline = new SitcomPlayback();
  for (const version of [1, 2]) {
    const start = (version - 1) * 10000, durationMs = version === 1
      ? H3_MEDIA_TIMING.script_append.openingMediaMs : H3_MEDIA_TIMING.script_append.continuationMediaMs;
    expect(timeline.register({ version, sourceId: "native-calibration", sourceStartSimMs: start, sourceEndSimMs: start + 10000,
      performance: { durationMs, sourceMap: [{ mediaMs: 0, sourceMs: start }, { mediaMs: durationMs, sourceMs: start + 10000 }] } })).toBe(true);
    timeline.add(h3ChunkForPlayback({ ...raw, chunk_index: version - 1, script_version: version }, true, [1, 2]));
  }
  expect(timeline.at(19)).toMatchObject({ state: "mapped", version: 2, sourceMs: 19000 });
  expect(timeline.at(19.9)).toMatchObject({ state: "mapped", version: 2, sourceMs: 19900 });
  expect(timeline.issued()[0].performance?.durationMs).toBe(10000);
});
