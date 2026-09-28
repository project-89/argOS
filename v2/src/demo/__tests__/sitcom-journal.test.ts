import { jest } from "@jest/globals";
import { mkdtemp, readFile, stat, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SitcomJournal, type SitcomJournalOptions } from "../sitcom-journal";

const journals: SitcomJournal<any>[] = [];
async function fixture(options: SitcomJournalOptions = {}) {
  const directory = await mkdtemp(join(tmpdir(), "argos-sitcom-journal-"));
  const journal = await SitcomJournal.open<any>(directory, options); journals.push(journal);
  return { directory, journal };
}
afterEach(async () => { for (const journal of journals.splice(0)) await journal.close().catch(() => {}); jest.restoreAllMocks(); });

test("30 accelerated minutes retain every audience frame and event past the old 1,600/6,000-frame boundaries", async () => {
  const { journal, directory } = await fixture();
  const pending: Promise<void>[] = [];
  for (let tick = 0; tick <= 3600; tick++) {
    const frame = { sourceId: "one-real-source", tick, elapsedMs: tick * 500, thought: `authored-${tick}` };
    pending.push(journal.appendFrame(frame));
    frame.thought = "LATER_MUTATION_MUST_NOT_REWRITE_HISTORY";
    if (tick < 3600) pending.push(journal.appendFrame({ sourceId: frame.sourceId, tick, elapsedMs: tick * 500 + 250, thought: `mid-${tick}` }));
    if (tick % 10 === 0) {
      pending.push(journal.appendEvent({ sequence: tick, visibility: "private", text: "PRIVATE_THOUGHT" }));
      pending.push(journal.appendPublicEvent({ sequence: tick, kind: "speech", text: `actual-${tick}` }));
    }
    if (pending.length >= 200) { await Promise.all(pending.splice(0)); }
  }
  await Promise.all(pending); await journal.flush();
  expect(journal.snapshot()).toMatchObject({ frames: 7201, events: 361, publicEvents: 361, failed: null, pendingBytes: 0 });
  for (const after of [0, 1599, 5999, 7199]) {
    const page = await journal.framesPage(after);
    expect(page.frames[0].elapsedMs).toBe(after * 250);
    expect(page.cursor).toBe(Math.min(after + 200, 7201));
    expect(page.hasMore).toBe(page.cursor < 7201);
    expect(JSON.stringify(page)).not.toContain("LATER_MUTATION");
  }
  const events = await readFile(join(directory, "sitcom-events.jsonl"), "utf8");
  const publicEvents = await readFile(join(directory, "public-events.jsonl"), "utf8");
  expect(events.trim().split("\n")).toHaveLength(361); expect(events).toContain("PRIVATE_THOUGHT");
  expect(publicEvents.trim().split("\n")).toHaveLength(361); expect(publicEvents).not.toContain("PRIVATE_THOUGHT");
  expect((await stat(join(directory, "audience-frames.jsonl"))).mode & 0o777).toBe(0o600);
});

test("paging covers the complete closed journal independently without loading or mutating prior pages", async () => {
  const { journal } = await fixture({ maxPageBytes: 100, maxRecordBytes: 100 });
  for (let i = 0; i < 20; i++) await journal.appendFrame({ id: i, text: "a small frame" });
  await journal.close();
  const seen: number[] = []; let cursor = 0;
  do {
    const page = await journal.framesPage(cursor, 200);
    expect(page.frames.length).toBeGreaterThan(0); expect(page.frames.length).toBeLessThanOrEqual(3);
    seen.push(...page.frames.map(frame => frame.id)); cursor = page.cursor;
    page.frames[0].id = -1;
    if (!page.hasMore) break;
  } while (true);
  expect(seen).toEqual(Array.from({ length: 20 }, (_, i) => i));
  expect((await journal.framesPage(0, 1)).frames[0].id).toBe(0);
  expect(await journal.framesPage(20)).toEqual({ frames: [], cursor: 20, hasMore: false });
  await expect(journal.appendFrame({ id: 21 })).rejects.toThrow(/closed/);
});

test("invalid or ahead cursors are explicit errors, not silent jumps to latest state", async () => {
  const { journal } = await fixture(); await journal.appendFrame({ id: 0 });
  for (const cursor of [-1, 0.1, Infinity, NaN, 2]) await expect(journal.framesPage(cursor)).rejects.toThrow(/cursor/);
  for (const limit of [0, -1, 201, 0.5]) await expect(journal.framesPage(0, limit)).rejects.toThrow(/limit/);
  expect((await journal.framesPage()).frames).toEqual([{ id: 0 }]);
});

test("new journals cannot overwrite another run", async () => {
  const { journal, directory } = await fixture(); await journal.appendFrame({ original: true }); await journal.flush();
  await expect(SitcomJournal.open(directory)).rejects.toMatchObject({ code: "EEXIST" });
  expect((await journal.framesPage()).frames).toEqual([{ original: true }]);
});

test("pending write overload fails closed without creating an unbounded queue", async () => {
  const { journal } = await fixture({ maxPendingBytes: 64 });
  const one = journal.appendFrame({ text: "x".repeat(30) });
  const two = journal.appendFrame({ text: "x".repeat(30) });
  const outcomes = await Promise.allSettled([one, two]);
  expect(outcomes[1].status).toBe("rejected");
  expect(journal.snapshot().reservedBytes).toBeLessThanOrEqual(64);
  expect(journal.snapshot().pendingBytes).toBe(0);
  await expect(journal.flush()).rejects.toThrow(/pending-write/);
  await expect(journal.appendEvent({ later: true })).rejects.toThrow(/pending-write/);
});

test.each([
  [{ maxBytes: 30 }, "disk byte"], [{ maxFrames: 1 }, "frame index"], [{ maxRecordBytes: 30 }, "record byte"],
] as const)("bounded storage/index/record policy %o latches and reports its first failure", async (options, reason) => {
  const { journal } = await fixture(options); await journal.appendFrame({ id: 1 });
  await expect(journal.appendFrame({ large: "x".repeat(40) })).rejects.toThrow(reason);
  await expect(journal.framesPage()).rejects.toThrow(reason);
  expect(journal.snapshot().frames).toBe(1);
});

test("a real file write error stops later appends and is observable through flush and close", async () => {
  const { journal } = await fixture();
  jest.spyOn((journal as any).files.events, "write").mockRejectedValueOnce(Object.assign(new Error("disk full"), { code: "ENOSPC" }));
  await expect(journal.appendEvent({ text: "actual event" })).rejects.toThrow(/disk full/);
  await expect(journal.appendPublicEvent({ text: "later" })).rejects.toThrow(/disk full/);
  await expect(journal.flush()).rejects.toThrow(/disk full/);
  await expect(journal.close()).rejects.toThrow(/disk full/);
});

test("truncated persisted pages report an explicit gap", async () => {
  const { journal, directory } = await fixture(); await journal.appendFrame({ id: 1 }); await journal.flush();
  await truncate(join(directory, "audience-frames.jsonl"), 0);
  await expect(journal.framesPage()).rejects.toThrow(/missing or truncated/);
});

test("compatibility and standalone replay exports stream complete private/public histories with safe script data", async () => {
  const { journal, directory } = await fixture();
  for (let i = 0; i < 6500; i++) await journal.appendFrame({ atSimMs: i, thought: i === 0 ? "</script>\u2028PRIVATE" : `thought-${i}` });
  await journal.appendEvent({ kind: "thought", text: "private-event-not-a-replay-cue" });
  await journal.appendEvent({ kind: "phone_read", text: "actually read" });
  await journal.appendPublicEvent({ kind: "action", text: "not speech" });
  await journal.appendPublicEvent({ kind: "speech", text: "actually said </script>" });
  await journal.close();
  const jsonPath = join(directory, "frames.json"), htmlPath = join(directory, "replay.html");
  await journal.exportJsonArray("frames", jsonPath); await journal.exportReplay(htmlPath);
  const frames = JSON.parse(await readFile(jsonPath, "utf8")); expect(frames).toHaveLength(6500); expect(frames[6499].atSimMs).toBe(6499);
  const html = await readFile(htmlPath, "utf8");
  const encoded = html.split('<script type="application/json" id="data">')[1].split("</script>")[0];
  const data = JSON.parse(encoded);
  expect(data.frames).toEqual(frames); expect(data.speech).toEqual([{ kind: "speech", text: "actually said </script>" }]);
  expect(data.events).toEqual([{ kind: "phone_read", text: "actually read" }]);
  expect(encoded).not.toContain("</script>"); expect(encoded).not.toContain("\u2028");
  await expect(journal.exportJsonArray("frames", jsonPath)).rejects.toMatchObject({ code: "EEXIST" });
});

test("invalid journal policies fail before opening files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "argos-sitcom-journal-policy-"));
  for (const options of [{ maxFrames: 0 }, { maxFrames: 200_001 }, { maxBytes: Infinity }, { maxPendingBytes: -1 },
    { maxRecordBytes: 1024, maxPageBytes: 100 }, { unexpected: 10 }])
    await expect(SitcomJournal.open(directory, options)).rejects.toThrow(/policy|capacity/);
});
