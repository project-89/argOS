import { jest } from "@jest/globals";
import { SitcomLivePacer } from "../sitcom-live-pacing";
import { buildSitcomPerformance } from "../sitcom-performance";
import { ApartmentSitcom } from "../apartment-sitcom";
import { SitcomDirector, type SitcomRenderSegment } from "../sitcom-director";
import { getCommittedEvents } from "../../runtime/committed-events";
import type { SitcomChunk } from "../sitcom-presentation";

const packet = (version: number) => ({ version, sourceId: "source", sourceStartSimMs: (version - 1) * 8500,
  sourceEndSimMs: version * 8500, performance: buildSitcomPerformance([], (version - 1) * 8500, version * 8500, 8500) });
test.each(["direct", "append"])("EJity7 repeated version 7 remains a hard failure with %s transport", transport => {
  const p = new SitcomLivePacer();
  let start = 0, playbackSeconds = 0;
  for (let version = 1; version <= 8; version++) {
    const durationMs = transport === "append" ? 10000 : version === 1 ? 10125 : 8500;
    p.register({ version, sourceId: "EJity7-ordering", sourceStartSimMs: start, sourceEndSimMs: start + durationMs,
      performance: { clock: "realtime", durationMs, sourceMap: [{ mediaMs: 0, sourceMs: start }, { mediaMs: durationMs, sourceMs: start + durationMs }] } });
    if (version <= 7) {
      playbackSeconds += durationMs / 1000;
      p.observe({ playbackSeconds: playbackSeconds - .001, chunks: [{ chunk_index: version - 1, prompt_version: version, playback_seconds: durationMs / 1000 }] });
    }
    start += durationMs;
  }
  p.observe({ playbackSeconds: playbackSeconds - .001, chunks: [{ chunk_index: 7, prompt_version: 7, playback_seconds: transport === "append" ? 10 : 8.5 }] });
  expect(p.sample(start).failure).toEqual({ reason: "provider_repeated_realtime_performance", version: 7 });
  expect(p.canIssue(10000)).toBe(false);
  expect(p.sample(start).displayedSourceMs).toBeCloseTo(start - (transport === "append" ? 10000 : 8500) - 1);
});
test("issued performance capacity is finite, immutable and released by playback, not by application acknowledgement", () => {
  const p = new SitcomLivePacer(); for (let v = 1; v <= 3; v++) p.register(packet(v));
  expect(p.queuedPerformanceMs()).toBe(25500); expect(p.canIssue(8500)).toBe(false);
  expect(() => p.register(packet(4))).toThrow(/queue is full/);
  p.observe({ playbackSeconds: 0, chunks: [{ chunk_index: 0, playback_seconds: 8.5, prompt_version: 1 }] });
  expect(p.canIssue(8500)).toBe(false);
  p.observe({ playbackSeconds: 8.5, chunks: [] }); expect(p.canIssue(8500)).toBe(true);
  p.register(packet(4)); expect(p.queuedPerformanceMs()).toBe(25500);
  expect(() => p.register({ ...packet(4), sourceEndSimMs: 34999 })).toThrow(/conflicting/);
});

test("repeated versions hold source time and do not consume another performance; gaps cannot release future source", () => {
  const p = new SitcomLivePacer(); p.register(packet(1)); p.register(packet(2));
  const chunks = [{ chunk_index: 0, playback_seconds: 8.5, prompt_version: 1 },
    { chunk_index: 1, playback_seconds: 8.5, prompt_version: 1 },
    { chunk_index: 2, playback_seconds: 8.5, prompt_version: 2 }];
  p.observe({ playbackSeconds: 12, chunks });
  expect(p.sample(30000)).toMatchObject({ displayedSourceMs: 8500, queuedPerformanceMs: 8500 });
  p.observe({ playbackSeconds: 12, chunks }); expect(p.sample(30000).receiptCursor).toBe(3);
  expect(() => p.observe({ playbackSeconds: 13, chunks: [chunks[0], { ...chunks[2], prompt_version: 99 }] })).toThrow(/Unissued/);
  expect(p.sample(30000).playbackSeconds).toBe(12);
  const gap = new SitcomLivePacer(); gap.register(packet(1)); gap.register(packet(2));
  gap.observe({ playbackSeconds: 12, chunks: [chunks[2]] });
  expect(gap.sample(30000)).toMatchObject({ displayedSourceMs: 0, queuedPerformanceMs: 17000, receiptCursor: 0 });
});

test("pacing uses hysteresis and never advances simulation or assumes a short video fulfilled its instructions", () => {
  const p = new SitcomLivePacer(); p.register(packet(1));
  expect(p.sample(30000).sourcePausedForVideo).toBe(true);
  p.observe({ playbackSeconds: 1, chunks: [{ chunk_index: 0, playback_seconds: 5, prompt_version: 1 }] });
  expect(p.sample(30000).displayedSourceMs).toBe(0);
  expect(p.sample(30000).sourcePausedForVideo).toBe(true);
  expect(p.sample(30000).failure).toMatchObject({ reason: "provider_chunk_shorter_than_performance", version: 1 });
  expect(p.canIssue(8500)).toBe(false);
});

test("a short first chunk followed by the same or next version reports missing depiction rather than permanent unexplained queue debt", () => {
  const p = new SitcomLivePacer(); p.register(packet(1)); p.register(packet(2));
  p.observe({ playbackSeconds: 1, chunks: [{ chunk_index: 0, playback_seconds: 4, prompt_version: 1 }] });
  p.observe({ playbackSeconds: 6, chunks: [{ chunk_index: 1, playback_seconds: 4.5, prompt_version: 1 }] });
  p.observe({ playbackSeconds: 16, chunks: [{ chunk_index: 2, playback_seconds: 8.5, prompt_version: 2 }] });
  expect(p.sample(30000).failure).toEqual({ reason: "provider_chunk_shorter_than_performance", version: 1, expectedMs: 8500, actualMs: 4000 });
  expect(p.canIssue(8500)).toBe(false);
});

test("skipping an issued performance cannot silently leave its missing speech as permanent queue debt", () => {
  const p = new SitcomLivePacer(); for (let v = 1; v <= 3; v++) p.register(packet(v));
  p.observe({ playbackSeconds: 10, chunks: [{ chunk_index: 0, playback_seconds: 8.5, prompt_version: 1 },
    { chunk_index: 1, playback_seconds: 8.5, prompt_version: 3 }] });
  expect(p.sample(30000).failure).toEqual({ reason: "provider_skipped_issued_performance", version: 2 });
  expect(p.canIssue(8500)).toBe(false);
});

test("a short repeated ending hold is valid after a complete first representation, including reordered metadata", () => {
  const p = new SitcomLivePacer(); p.register(packet(1));
  p.observe({ playbackSeconds: 0, chunks: [{ chunk_index: 1, playback_seconds: 4, prompt_version: 1 }] });
  expect(p.sample(10000).failure).toBeNull();
  p.observe({ playbackSeconds: 10, chunks: [{ chunk_index: 0, playback_seconds: 8.5, prompt_version: 1 }] });
  expect(p.sample(10000)).toMatchObject({ failure: null, displayedSourceMs: 8500, queuedPerformanceMs: 0 });
});

test("ten-minute jittery and duplicate-chunk provider stays bounded through real committed director, performance and playback interfaces", async () => {
  const quiet = jest.spyOn(console, "log").mockImplementation(() => {});
  const fetch = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Virtual provider test must not use a model"));
  const t = await ApartmentSitcom.create({ live: false, outsideTextAtMs: null, scenario: "duet" });
  const d = new SitcomDirector(t, { scheduling: "performance" }), p = new SitcomLivePacer();
  const issued: SitcomRenderSegment[] = [], chunks: SitcomChunk[] = [];
  let settled = 0, pending: { at: number; segment: SitcomRenderSegment } | undefined;
  let played = 0, availableMedia = 0, nextSpeech = 1500, pausedWallMs = 0;
  const fingerprints = new Map<number, string>();
  try {
    await t.start();
    for (let wall = 0; wall < 600000; wall += 250) {
      const pacing = p.sample(t.elapsedMs);
      if (!pacing.sourcePausedForVideo) {
        if (t.elapsedMs >= nextSpeech) {
          t.dispatch(Math.floor(nextSpeech / 10000) % 2 ? "Elaine" : "Jerry", { type: "speak", content: `We are discussing item ${Math.floor(nextSpeech / 10000)} now.` });
          nextSpeech += 10000;
        }
        t.advance(250);
      } else pausedWallMs += 250;
      if (pending && wall >= pending.at) {
        const version = pending.segment.version;
        // Slow generation sometimes reuses the old prompt for a whole chunk.
        if (version > 1 && version % 7 === 0) { chunks.push({ chunk_index: chunks.length, prompt_version: version - 1, playback_seconds: 8.5 }); availableMedia += 8.5; }
        const seconds = pending.segment.performance!.durationMs / 1000;
        chunks.push({ chunk_index: chunks.length, prompt_version: version, playback_seconds: seconds }); availableMedia += seconds;
        settled = version; pending = undefined;
      }
      played = Math.min(availableMedia, played + .25);
      p.observe({ playbackSeconds: played, chunks: chunks.slice(-Math.min(4, chunks.length)) });
      if (!pending && p.canIssue(issued.length ? 8500 : 10125)) {
        const next = d.next(settled);
        if ("segment" in next && next.segment.version > settled) {
          p.register(next.segment); issued.push(next.segment); fingerprints.set(next.segment.version, next.segment.prompt);
          pending = { segment: next.segment, at: wall + 7500 + (next.segment.version % 4) * 750 + (next.segment.version % 11 === 0 ? 6500 : 0) };
        } else if ("ended" in next) throw new Error(`Unexpected virtual source end: ${JSON.stringify(next)}`);
      }
    }
    const status = p.sample(t.elapsedMs);
    expect(issued.length).toBeGreaterThan(35); expect(status.peakSourceLeadMs).toBeLessThanOrEqual(30250);
    expect(status.peakQueuedPerformanceMs).toBeLessThanOrEqual(28000); expect(pausedWallMs).toBeGreaterThan(10000);
    expect(t.elapsedMs).toBeGreaterThan(300000); expect(t.elapsedMs).toBeLessThan(600000);
    for (const s of issued) expect(s.prompt).toBe(fingerprints.get(s.version));
    const spoken = issued.flatMap(s => s.script.beats.filter(b => b.kind === "speech").flatMap(b => [...b.evidence]));
    expect(new Set(spoken).size).toBe(spoken.length);
    const last = issued.at(-1)!;
    const committed = getCommittedEvents(t.sim.world).events.filter(e => e.kind === "speech" && e.status === "succeeded" && e.text && e.atSimMs < last.sourceEndSimMs);
    expect(spoken.sort((a, b) => a - b)).toEqual(committed.map(e => e.sequence!).sort((a, b) => a - b));
    expect(fetch).not.toHaveBeenCalled();
    console.info("VIRTUAL_BROADCAST_RESULT", JSON.stringify({ wallMs: 600000, sourceMs: t.elapsedMs, issuedVersions: issued.length,
      providerChunks: chunks.length, playedMediaSeconds: played, pausedWallMs, coveredSpeechWords: spoken.length,
      peakSourceLeadMs: status.peakSourceLeadMs, peakQueuedPerformanceMs: status.peakQueuedPerformanceMs,
      failure: status.failure, provider: "deterministic virtual provider; no H3" }));
  } finally { d.stop(); t.stop(); quiet.mockRestore(); fetch.mockRestore(); }
});
