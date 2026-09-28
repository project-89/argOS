import { jest } from "@jest/globals";
import { request as httpRequest, type Server } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApartmentSitcom } from "../apartment-sitcom";
import { createSitcomDemoApp } from "../sitcom-server";
import { sitcomPromptMessage } from "../sitcom-h3-chunk";

const token = "offline-sitcom-token-with-enough-entropy-for-test";
const active: Array<{ server: Server; receiver: Awaited<ReturnType<typeof createSitcomDemoApp>> }> = [];
function request(server: Server, path: string, body?: unknown, options: { authenticated?: boolean; headers?: Record<string, string>; binary?: Buffer } = {}) {
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No local test server");
  return new Promise<{ status: number; text: string; json: () => any }>((resolve, reject) => {
    const bytes = options.binary ?? (body === undefined ? undefined : Buffer.from(JSON.stringify(body)));
    const req = httpRequest({ host: "127.0.0.1", port: address.port, path, method: bytes ? "POST" : "GET",
      headers: { ...(options.authenticated === false ? {} : { "x-argos-token": token }),
        ...(bytes ? { "content-type": "application/json", "content-length": String(bytes.length) } : {}), ...options.headers } }, res => {
      const chunks: Buffer[] = []; res.on("data", data => chunks.push(data)); res.on("end", () => {
        const text = Buffer.concat(chunks).toString(); resolve({ status: res.statusCode!, text, json: () => JSON.parse(text) }); });
    }); req.on("error", reject); req.end(bytes);
  });
}
async function fixture(seconds: number | undefined = 10, newEpisode?: () => Promise<{ url: string }>, scenario: "cookie" | "duet" = "cookie", scriptQueue = false, h3ChunkSeconds?: number, h3Resolution?: "480p" | "768p" | "1080p", h3Memory?: number) {
  const t = await ApartmentSitcom.create({ live: false, outsideTextAtMs: null, scenario });
  const directory = await mkdtemp(join(tmpdir(), "argos-sitcom-server-test-"));
  const receiver = await createSitcomDemoApp({ testbed: t, directory, token, seconds, allowVideo: true, newEpisode, scriptQueue, h3ChunkSeconds, h3Resolution, h3Memory });
  const server = receiver.app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve)); active.push({ server, receiver });
  return { t, server, receiver, directory };
}
beforeEach(() => jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No external calls in server tests")));
afterEach(async () => {
  for (const { receiver, server } of active.splice(0)) { await receiver.stop(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  jest.restoreAllMocks();
});

test.each([false,true])("history depth reaches the exact immutable configure and its audit journal (append=%s)",async(scriptQueue)=>{
  const {t,server}=await fixture(600,undefined,"duet",scriptQueue,undefined,undefined,1);
  const starting=request(server,"/start",{render:true});
  for(let i=0;!t.running&&i<50;i++)await new Promise(resolve=>setTimeout(resolve,10));
  t.advance(11000);const initial=(await starting).json();
  expect(initial.configure.memory).toBe(1);expect(initial.configure.chunk_duration).toBe(10);
  expect((await request(server,"/prompts",{id:1,atMs:10000,message:initial.configure})).status).toBe(204);
  expect((await request(server,"/prompts",{id:2,atMs:10001,message:{...initial.configure,memory:12}})).status).toBe(400);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

test("prompt logs preserve exact sends, duplicates and script receipts behind session authentication", async () => {
  const { t, server, directory } = await fixture(600, undefined, "duet", true);
  expect((await request(server, "/prompts", undefined, { authenticated: false })).status).toBe(403);
  const starting = request(server, "/start", { render: true });
  for (let count = 0; !t.running && count < 50; count++) await new Promise(resolve => setTimeout(resolve, 10));
  t.advance(10000); const initial = (await starting).json();
  const prepared = (await request(server, "/prompts")).json().entries;
  expect(prepared[0].sends).toEqual([]);
  const configure = { ...initial.configure, chunk_duration: initial.requestedChunkSeconds };
  const first = { id: 1, atMs: 10000, message: configure };
  expect((await request(server, "/prompts", first, { authenticated: false })).status).toBe(403);
  expect((await request(server, "/prompts", { ...first, message: { ...configure, key: "private" } })).status).toBe(400);
  expect((await request(server, "/prompts", { ...first, message: { ...configure, script: [{ offset: 0, prompt: "invented private thought" }] } })).status).toBe(400);
  expect((await request(server, "/prompts", first)).status).toBe(204);
  expect((await request(server, "/prompts", first)).status).toBe(204); // retry is idempotent
  expect((await request(server, "/prompts", { ...first, atMs: 11000 })).status).toBe(409);
  expect((await request(server, "/prompts", { ...first, id: 2, atMs: 11000 })).status).toBe(204); // a real second send remains evidence
  t.advance(10000);
  const second = (await request(server, "/next", { settledVersion: 0, admittedVersion: 1 })).json().segment;
  const append = { id: 3, atMs: 20000, message: sitcomPromptMessage(second, true) };
  expect((await request(server, "/prompts", append)).status).toBe(204);
  await request(server, "/telemetry", { type: "chunk", prompt_version: 1, script_version: 2, chunk_index: 1, playback_seconds: 10 });
  const log = (await request(server, "/prompts")).json();
  expect(log.entries[0].sends).toHaveLength(2);
  expect(log.entries[0].receipts).toHaveLength(0);
  expect(log.entries[1].receipts[0].script_version).toBe(2);
  expect(log.entries[1].sends[0]).toEqual(append);
  const saved = (await readFile(join(directory, "h3-outgoing.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
  expect(saved).toHaveLength(3); expect(saved[0]).toEqual(first);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
test("the focused duet serves its actual two actors and scenario without allocating or starting a world", async () => {
  const { server, t } = await fixture(600, undefined, "duet");
  const page = await request(server, "/", undefined, { authenticated: false });
  expect(page.status).toBe(200); expect(page.text).toContain("Before Tonight");
  expect(page.text).toContain("TWO MINDS. ONE OPEN EVENING.");
  expect(page.text).toContain("<option>Elaine</option>"); expect(page.text).toContain("<option>Jerry</option>");
  expect(page.text).not.toContain("<option>George</option>"); expect(page.text).not.toContain("<option>Kramer</option>");
  const state = (await request(server, "/state")).json();
  expect(state.latest.scenario.characters).toEqual(["Elaine", "Jerry"]);
  expect(state.latest.actors.map((actor: { name: string }) => actor.name)).toEqual(["Elaine", "Jerry"]);
  expect(t.running).toBe(false); expect(globalThis.fetch).not.toHaveBeenCalled();
});

test.each(["768p", "1080p"] as const)("receiver forwards explicit %s without altering committed timing", async resolution => {
  const { t, server, receiver } = await fixture(60, undefined, "cookie", false, undefined, resolution);
  const starting = request(server, "/start", { render: true });
  for (let count = 0; !t.running && count < 50; count++) await new Promise(resolve => setTimeout(resolve, 10));
  t.advance(10125); const initial = (await starting).json();
  expect(initial.configure.resolution).toBe(resolution);
  expect(initial.handoff).toBe("chunk_ack");
  expect(receiver.state().renderer.requestedResolution).toBe(resolution);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

test("video presentation backpressure explicitly pauses and resumes the shared source while messages remain queued", async () => {
  const { t, server, receiver } = await fixture(600);
  const starting = request(server, "/start", { render: true });
  for (let count = 0; !t.running && count < 50; count++) await new Promise(resolve => setTimeout(resolve, 10));
  t.advance(10125); const first = (await starting).json().initialSegment;
  t.advance(30000 - t.elapsedMs);
  await new Promise(resolve => setTimeout(resolve, 300));
  expect(t.sim.paused).toBe(true); expect(receiver.state().pacing?.sourcePausedForVideo).toBe(true);
  const atPause = t.elapsedMs;
  expect((await request(server, "/control", { type: "message", text: "This arrived while video caught up." })).status).toBe(200);
  await new Promise(resolve => setTimeout(resolve, 300)); expect(t.elapsedMs).toBe(atPause);
  expect((await request(server, "/presentation", { playbackSeconds: 1, chunks: [] }, { authenticated: false })).status).toBe(403);
  expect((await request(server, "/presentation", { playbackSeconds: 1, chunks: [{ chunk_index: 0, playback_seconds: 10.125, prompt_version: 99 }] })).status).toBe(400);
  const second = (await request(server, "/next", { settledVersion: first.version })).json().segment;
  expect(second.version).toBe(2);
  const receipt = await request(server, "/presentation", { playbackSeconds: 18, chunks: [
    { chunk_index: 0, playback_seconds: 10.125, prompt_version: 1 }, { chunk_index: 1, playback_seconds: 8.5, prompt_version: 2 },
  ] });
  expect(receipt.status).toBe(200); expect(receipt.json().sourcePausedForVideo).toBe(false);
  expect(t.sim.paused).toBe(false);
  await new Promise(resolve => setTimeout(resolve, 300)); expect(t.elapsedMs).toBeGreaterThan(atPause);
});

test("an undersized first video chunk stops and saves with an explicit coverage fault instead of hanging the source", async () => {
  const { t, server, receiver } = await fixture(600);
  const starting = request(server, "/start", { render: true });
  for (let count = 0; !t.running && count < 50; count++) await new Promise(resolve => setTimeout(resolve, 10));
  t.advance(10125); await starting;
  const receipt = await request(server, "/presentation", { playbackSeconds: 1,
    chunks: [{ chunk_index: 0, playback_seconds: 4, prompt_version: 1 }] });
  expect(receipt.status).toBe(200); expect(receipt.json().failure).toMatchObject({ reason: "provider_chunk_shorter_than_performance", expectedMs: 10125, actualMs: 4000 });
  await receiver.stop(); expect(receiver.state().stopReason).toBe("provider-performance-mismatch"); expect(t.running).toBe(false);
});
test("real-time short-tail completion survives the HTTP handoff and persists bounded coverage telemetry", async () => {
  const { t, server, receiver, directory } = await fixture(600);
  const starting = request(server, "/start", { render: true });
  for (let count = 0; !t.running && count < 50; count++) await new Promise(resolve => setTimeout(resolve, 10));
  t.advance(10125); const first = (await starting).json().initialSegment;
  t.advance(18000 - t.elapsedMs); t.stop();
  const ended = (await request(server,"/next",{settledVersion:first.version})).json();
  expect(ended).toMatchObject({ended:true,unfilmedTail:{reason:"incomplete_realtime_tail",sourceStartSimMs:10125,sourceEndSimMs:18000}});
  expect(ended).not.toHaveProperty("reason");
  expect(receiver.state().stopped).toBe(false); // Media receiver is still draining.
  expect(receiver.state().renderer.sourceCursorSimMs).toBe(10125);
  const playback = {chunks:[{index:0,start:0,end:10.125,version:1}],recordingStart:0,recordingEnd:10.125,
    telemetry:[{type:"source_tail_unfilmed",atMs:12000,sourceMs:10125,unfilmedEndMs:18000,reason:"incomplete_realtime_tail"}]};
  expect((await request(server,"/stop",{reason:"committed-source-drained"})).status).toBe(204);
  expect((await request(server,"/playback",{...playback,telemetry:[{...playback.telemetry[0],unfilmedEndMs:Infinity}]})).status).toBe(400);
  expect((await request(server,"/playback",playback)).status).toBe(204);
  const saved = JSON.parse(await readFile(join(directory,"playback.json"),"utf8"));
  expect(saved.telemetry).toEqual(playback.telemetry);
  const renderer = JSON.parse(await readFile(join(directory,"renderer.json"),"utf8"));
  expect(renderer.unfilmedTail).toEqual(ended.unfilmedTail);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
test("duration selection accepts extended sessions and rejects invalid budgets before starting", async () => {
  const { t, server, receiver } = await fixture(600);
  const initial = (await request(server, "/state")).json();
  expect(initial.durationLimits).toEqual({ min: 10, max: 1800, default: 600 });
  expect(initial.maxSessionSeconds).toBe(600); expect(initial.providerMaxSessionSeconds).toBeNull();
  for (const seconds of [0, 9, 1801, 300.5, "600"]) expect((await request(server, "/start", { render: false, seconds })).status).toBe(400);
  expect(t.running).toBe(false);
  expect((await request(server, "/start", { render: false, seconds: 1800 })).json().maxSessionSeconds).toBe(1800);
  t.advance(125000);
  await new Promise(resolve => setTimeout(resolve, 300));
  expect(t.running).toBe(true); expect(receiver.state().stopped).toBe(false);
  expect((await request(server, "/heartbeat", {})).status).toBe(204);
  await receiver.stop(); expect((await request(server, "/heartbeat", {})).status).toBe(409);
});
test("reset is authenticated, stopped-only, idempotent and preserves the previous world and contact", async () => {
  const newEpisode = jest.fn(async () => ({ url: `http://127.0.0.1:3470/#${"b".repeat(48)}` }));
  const { server, directory } = await fixture(600, newEpisode);
  expect((await request(server, "/state")).json().resetAvailable).toBe(true);
  expect((await request(server, "/reset", {}, { authenticated: false })).status).toBe(403);
  expect((await request(server, "/reset", {})).status).toBe(409);
  await request(server, "/start", { render: false });
  expect((await request(server, "/reset", {})).status).toBe(409);
  expect(newEpisode).not.toHaveBeenCalled();
  await request(server, "/contact", { name: "David", relationship: "boyfriend", context: "Dinner" });
  await request(server, "/stop", {});
  const saved = await readFile(join(directory, "world.json"), "utf8");
  expect((await request(server, "/reset", { render: true })).status).toBe(400);
  const responses = await Promise.all([request(server, "/reset", {}), request(server, "/reset", {})]);
  expect(responses.map(r => r.status)).toEqual([200, 200]); expect(responses[0].json()).toEqual(responses[1].json());
  expect((await request(server, "/reset", {})).json()).toEqual(responses[0].json());
  expect(newEpisode).toHaveBeenCalledTimes(1);
  expect(await readFile(join(directory, "world.json"), "utf8")).toBe(saved);
  const old = (await request(server, "/state")).json();
  expect(old.stopped).toBe(true); expect(old.latest.contact.name).toBe("David");
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
test("failed new-episode preparation can be retried without changing the saved receiver", async () => {
  const newEpisode = jest.fn<() => Promise<{ url: string }>>()
    .mockRejectedValueOnce(new Error("Fixture startup failure"))
    .mockResolvedValue({ url: `http://127.0.0.1:3470/#${"c".repeat(48)}` });
  const { server } = await fixture(600, newEpisode); await request(server, "/stop", {});
  expect((await request(server, "/reset", {})).status).toBe(503);
  expect((await request(server, "/state")).json().stopped).toBe(true);
  expect((await request(server, "/reset", {})).status).toBe(200); expect(newEpisode).toHaveBeenCalledTimes(2);
});
test("state pages are stable deltas and historical frames remain readable after stop", async () => {
  const { server, receiver, directory } = await fixture();
  expect((await request(server, "/state?afterFrame=-1")).status).toBe(400);
  expect((await request(server, "/state?afterFrame=99999")).status).toBe(400);
  expect((await request(server, "/state?limit=201")).status).toBe(400);
  const first = (await request(server, "/state?afterFrame=0&limit=1")).json();
  expect(first.frames).toHaveLength(1); expect(first.cursor).toBe(1);
  const next = (await request(server, "/state?afterFrame=1")).json(); expect(next.frames).toHaveLength(0); expect(next.cursor).toBe(1);
  await request(server, "/contact", { name: "Marion", relationship: "boss", context: "Deadline" });
  const changed = (await request(server, "/state?afterFrame=1")).json();
  expect(changed.frames).toHaveLength(1); expect(changed.cursor).toBe(2); expect(changed.frames[0].contact.name).toBe("Marion");
  await receiver.stop();
  const replay = (await request(server, "/state?afterFrame=0&limit=1")).json();
  expect(replay.frames[0]).toEqual(first.frames[0]); expect(replay.hasMore).toBe(true);
  expect((await readFile(join(directory, "audience-frames.jsonl"), "utf8")).trim().split("\n")).toHaveLength(3);
});
test("a renderer capture failure is explicit, stops the world and persists exact issued prompts and diagnostics", async () => {
  const { t, server, receiver, directory } = await fixture(600);
  const starting = request(server, "/start", { render: true });
  for (let count = 0; !t.running && count < 50; count++) await new Promise(resolve => setTimeout(resolve, 10));
  t.advance(10125); const first = (await starting).json().initialSegment;
  jest.spyOn(t, "scenes").mockImplementation(() => { throw new Error("Fixture scene boundary failure"); });
  t.advance(500);
  const response = (await request(server, "/next", { settledVersion: first.version })).json();
  expect(response).toEqual({ ended: true, reason: "capture_failed", detail: "Fixture scene boundary failure" });
  await receiver.stop(); expect(t.running).toBe(false);
  const diagnostics = JSON.parse(await readFile(join(directory, "renderer.json"), "utf8"));
  expect(diagnostics).toMatchObject({ reason: "capture_failed", detail: "Fixture scene boundary failure" });
  const scripts = JSON.parse(await readFile(join(directory, "screenplay.json"), "utf8"));
  expect(scripts).toHaveLength(1); expect(scripts[0].prompt).toBe(first.prompt);
  const segments = JSON.parse(await readFile(join(directory, "segments.json"), "utf8"));
  expect(segments[0].performance).toEqual(first.performance);
  expect(scripts[0].performance.sourceMap).toEqual(segments[0].performance.sourceMap);
  const saved = JSON.parse(await readFile(join(directory, "result.json"), "utf8"));
  expect(saved.stopReason).toBe("renderer-source-failure");
  expect(receiver.state().engine.roomOverviewError).toBe("Fixture scene boundary failure");
});
test("a live receiver observes downward provider limits without adding unsupported configure fields", async () => {
  const { t, server } = await fixture(600);
  const starting = request(server, "/start", { render: true, seconds: 1800 });
  for (let count = 0; !t.running && count < 50; count++) await new Promise(resolve => setTimeout(resolve, 10));
  t.advance(10125);
  const initial = (await starting).json(); expect(initial.maxSessionSeconds).toBe(1800);
  expect(initial.configure).not.toHaveProperty("duration"); expect(initial.configure).not.toHaveProperty("max_session_seconds");
  expect((await request(server, "/session-info", { maxSessionSeconds: null })).json().maxSessionSeconds).toBe(1800);
  expect((await request(server, "/session-info", { maxSessionSeconds: 300 })).json()).toMatchObject({
    requestedSessionSeconds: 1800, maxSessionSeconds: 300, providerMaxSessionSeconds: 300 });
  expect((await request(server, "/session-info", { maxSessionSeconds: 1800 })).json().maxSessionSeconds).toBe(300);
  expect((await request(server, "/session-info", { maxSessionSeconds: null })).json().maxSessionSeconds).toBe(300);
  expect((await request(server, "/session-info", { maxSessionSeconds: -1 })).status).toBe(400);
  expect((await request(server, "/stop", { reason: "provider-session-limit" })).status).toBe(204);
  expect((await request(server, "/state")).json().stopReason).toBe("provider-session-limit");
});
test("receiver heartbeats extend the viewer lease, not the episode budget", async () => {
  const { server, receiver } = await fixture(600);
  let now = Date.now(); jest.spyOn(Date, "now").mockImplementation(() => now);
  await request(server, "/start", { render: false });
  now += 29000; await request(server, "/heartbeat", {});
  now += 29000; await new Promise(resolve => setTimeout(resolve, 300));
  expect(receiver.state().stopped).toBe(false); expect(receiver.state().maxSessionSeconds).toBe(600);
  now += 2000; await new Promise(resolve => setTimeout(resolve, 300));
  await receiver.stop(); expect(receiver.state().stopReason).toBe("client_disconnected");
});
test("streaming media writes before stop and finalizes afterward without a whole-file legacy overwrite", async () => {
  const { t, server, receiver } = await fixture();
  const starting = request(server, "/start", { render: true });
  for (let count = 0; !t.running && count < 50; count++) await new Promise(resolve => setTimeout(resolve, 10));
  t.advance(10125); expect((await starting).status).toBe(200);
  expect((await request(server, "/recordings/raw/start", { mimeType: "video/webm" })).status).toBe(200);
  const binary = Buffer.from("saved incrementally"), headers = { "content-type": "application/octet-stream" };
  expect((await request(server, "/recordings/raw/chunks/0", undefined, { binary, headers })).status).toBe(200);
  expect((await request(server, "/recordings/status")).json().raw.bytes).toBe(binary.length);
  await receiver.stop();
  expect((await request(server, "/recording", undefined, { binary, headers: { "content-type": "video/webm" } })).status).toBe(409);
  const saved = (await request(server, "/recordings/raw/finish", { chunks: 1 })).json();
  expect(saved.complete).toBe(true);
  const media = await request(server, saved.url, undefined, { authenticated: false, headers: { range: "bytes=0-4" } });
  expect(media.status).toBe(206); expect(media.text).toBe("saved");
  expect((await request(server, saved.url.replace("/media/raw", "/state"), undefined, { authenticated: false })).status).toBe(403);
});
test("auth protects state, controls, recordings and paid proxy; no key in audience payload", async () => {
  const { server } = await fixture();
  expect((await request(server, "/state", undefined, { authenticated: false })).status).toBe(403);
  expect((await request(server, "/control", { type: "message", text: "Hi" }, { authenticated: false })).status).toBe(403);
  expect((await request(server, "/contact", { name: "Sam", relationship: "boss", context: "" }, { authenticated: false })).status).toBe(403);
  expect((await request(server, "/recording", {}, { authenticated: false })).status).toBe(403);
  expect((await request(server, "/proxy", {}, { headers: { "x-fal-target-url": "https://wma.fal.run/session" } })).status).toBe(403);
  const state = await request(server, "/state"); expect(state.status).toBe(200);
  expect(state.text).not.toContain(token); expect(state.text).not.toContain("FAL_KEY");
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
test("contact setup is authenticated, bounded and preserves each message's sender across edits", async () => {
  const { server, receiver } = await fixture();
  const boss = { name: "Marion", relationship: "boss", context: "Her editor at work; they have a deadline tomorrow." };
  expect((await request(server, "/contact", boss)).json()).toEqual({ contact: boss });
  expect((await request(server, "/state")).json().latest.contact).toEqual(boss);
  for (const value of [null, [], { ...boss, name: "" }, { ...boss, name: "x".repeat(61) },
    { ...boss, relationship: "x".repeat(41) }, { ...boss, context: "x".repeat(301) }, { ...boss, context: 7 },
    { ...boss, name: "invisible\u0000name" }, { ...boss, execute: "read_phone" }]) {
    expect((await request(server, "/contact", value)).status).toBe(400);
  }
  expect((await request(server, "/state")).json().latest.contact).toEqual(boss);
  expect((await request(server, "/start", { render: false })).status).toBe(200);
  expect((await request(server, "/control", { type: "message", text: "Can you call me when you get a minute?" })).status).toBe(200);
  const partner = { name: "David", relationship: "boyfriend", context: "They made dinner plans tonight." };
  expect((await request(server, "/contact", partner)).json()).toEqual({ contact: partner });
  expect((await request(server, "/control", { type: "message", text: "Are we still on for dinner?" })).status).toBe(200);
  const messages = (await request(server, "/state")).json().latest.phone;
  expect(messages).toHaveLength(2);
  expect(messages[0].contact).toEqual(boss); expect(messages[1].contact).toEqual(partner);
  await receiver.stop();
  expect((await request(server, "/contact", boss)).status).toBe(409);
  expect((await request(server, "/state")).json().latest.contact).toEqual(partner);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
test("simulation-only start is single-use and controls cannot dispatch arbitrary ECS actions", async () => {
  const { server, receiver, directory } = await fixture();
  expect((await request(server, "/start", { render: false })).status).toBe(200);
  expect((await request(server, "/start", { render: true })).status).toBe(409);
  expect((await request(server, "/control", { type: "dispatch", action: { type: "pickup" } })).status).toBe(400);
  expect((await request(server, "/control", { type: "message", text: "Can you hear me?" })).status).toBe(200);
  expect((await request(server, "/next", { settledVersion: 0 })).status).toBe(409);
  await receiver.stop();
  expect((await request(server, "/control", { type: "message", text: "Too late" })).status).toBe(409);
  expect(JSON.parse(await readFile(join(directory, "result.json"), "utf8")).renderRequested).toBe(false);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
test("video startup uses only lived intervals, limits one uncertain allocation and saves distinct media", async () => {
  const { t, server, receiver, directory } = await fixture();
  const starting = request(server, "/start", { render: true });
  for (let count = 0; !t.running && count < 20; count++) await new Promise(resolve => setTimeout(resolve, 10));
  t.advance(10125);
  const response = await starting; expect(response.status).toBe(200);
  const initial = response.json(); expect(initial.initialSegment.sourceEndSimMs).toBe(10125);
  expect(initial.initialSegment.performance.durationMs).toBe(10125);
  expect(initial.configure.chunk_duration).toBe(10);
  expect(initial.requestedChunkSeconds).toBe(10);
  expect(initial.configure).not.toHaveProperty("script");
  expect(initial.handoff).toBe("chunk_ack");
  expect(initial.initialSegment.script.promptStyle).toBe("direct");
  expect(initial.initialSegment.performance.clock).toBe("realtime");
  expect(initial.initialSegment.sourceEndSimMs-initial.initialSegment.sourceStartSimMs).toBe(initial.initialSegment.performance.durationMs);
  expect(initial.initialSegment.prompt).not.toMatch(/VOICE V\d+C|Use the timed shot list/);
  const state = (await request(server, "/state")).json();
  expect(state.latest.sourceId).toBe(initial.initialSegment.sourceId);
  expect(state.segments[0].performance).toEqual(initial.initialSegment.performance);
  expect((await request(server, "/next", { settledVersion: 99 })).status).toBe(400);
  expect((await request(server, "/next", { settledVersion: 0, admittedVersion: 1 })).status).toBe(400);
  expect((await request(server, "/proxy", {}, { headers: { "x-fal-target-url": "https://example.com/" } })).status).toBe(403);
  const allocation = { app_id: "minimax/h3-max/director" }, headers = { "x-fal-target-url": "https://wma.fal.run/session" };
  expect((await request(server, "/proxy", allocation, { headers })).status).toBe(502);
  expect((await request(server, "/proxy", allocation, { headers })).status).toBe(409);
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  await receiver.stop();
  const mediaHeaders = { "content-type": "video/webm" }, binary = Buffer.from("fixture media transport bytes");
  const raw = await request(server, "/recording", undefined, { headers: mediaHeaders, binary }); expect(raw.status).toBe(200);
  const composition = await request(server, "/composition", undefined, { headers: mediaHeaders, binary }); expect(composition.status).toBe(200);
  expect(raw.json().path).not.toBe(composition.json().path);
  expect(composition.json().path).toBe(join(directory, "ui-composition.webm"));
  expect((await request(server, "/composition", undefined, { headers: mediaHeaders, binary })).status).toBe(409);
  expect((await request(server, "/playback", { chunks: [{ index: 0, start: 0, end: 10.125, version: 1 }], recordingStart: 0, recordingEnd: 9 })).status).toBe(204);
  expect((await request(server, "/state")).json().replay).toBe(true);
});
test.each([5, 7, 10] as const)("explicit %is setting budgets the opening and continuation before sending", async duration => {
  const { t, server } = await fixture(300, undefined, "duet", true, duration);
  const starting = request(server, "/start", { render: true });
  for (let count = 0; !t.running && count < 50; count++) await new Promise(resolve => setTimeout(resolve, 10));
  t.advance(duration * 1000); const initial = (await starting).json();
  expect(initial.requestedChunkSeconds).toBe(duration);
  expect(initial.initialSegment.performance.durationMs).toBe(duration * 1000);
  t.advance(duration * 1000);
  const second = (await request(server, "/next", { settledVersion: 0, admittedVersion: 1 })).json().segment;
  expect(second.performance.durationMs).toBe(duration * 1000);
  expect(second.sourceStartSimMs).toBe(initial.initialSegment.sourceEndSimMs);
});
test("opt-in native append reserves one successor but only playback releases its performance debt", async () => {
  const { t, server, receiver } = await fixture(600, undefined, "duet", true);
  const starting = request(server, "/start", { render: true });
  for (let count = 0; !t.running && count < 50; count++) await new Promise(resolve => setTimeout(resolve, 10));
  t.advance(10000); const initial = (await starting).json();
  expect(initial.handoff).toBe("script_append");
  expect(initial.initialSegment.performance.durationMs).toBe(10000);
  expect(initial.initialSegment.performance.clock).toBe("realtime");
  expect(initial.initialSegment.prompt).toContain("Perform each quoted dialogue line once in its named character's voice.");
  expect(initial.initialSegment.prompt).not.toContain("Use the timed shot list");
  expect(initial.requestedChunkSeconds).toBe(10);
  expect(initial.initialSegment.sourceEndSimMs).toBe(10000);
  expect(initial.configure.script).toEqual([{ offset: 0, prompt: initial.initialSegment.prompt }]);
  t.advance(15000);
  expect((await request(server, "/next", { settledVersion: 0, admittedVersion: 99 })).status).toBe(400);
  const second = (await request(server, "/next", { settledVersion: 0, admittedVersion: 1 })).json().segment;
  expect(second.version).toBe(2); expect(second.sourceStartSimMs).toBe(initial.initialSegment.sourceEndSimMs);
  expect(second.performance.durationMs).toBe(10000);
  expect(second.performance.sourceMap).toEqual([{ mediaMs: 0, sourceMs: 10000 }, { mediaMs: 10000, sourceMs: 20000 }]);
  expect((await request(server, "/next", { settledVersion: 0, admittedVersion: 1 })).json().segment).toEqual(second);
  expect((await request(server, "/next", { settledVersion: 0, admittedVersion: 2 })).json()).toEqual({ buffering: true });
  expect(receiver.state().pacing).toMatchObject({ displayedSourceMs: 0, queuedPerformanceMs: 20000 });
  expect((await request(server, "/next", { settledVersion: 2, admittedVersion: 1 })).status).toBe(400);
  t.advance(5000); // Commit the third source window before requesting it.
  // A settled metadata version is not proof of playback. Three native packets
  // would owe 30s, beyond the unchanged 28s bound (legacy three fit at 27.125s).
  expect((await request(server, "/next", { settledVersion: 1, admittedVersion: 2 })).json()).toEqual({ buffering: true });
  expect(receiver.state().segments).toHaveLength(2);
  expect((await request(server, "/presentation", { playbackSeconds: 3,
    chunks: [{ chunk_index: 0, prompt_version: 1, playback_seconds: 10 }] })).status).toBe(200);
  const third = (await request(server, "/next", { settledVersion: 1, admittedVersion: 2 })).json().segment;
  expect(third.version).toBe(3);
  expect(third.performance.durationMs).toBe(10000);
  expect(receiver.state().pacing).toMatchObject({ queuedPerformanceMs: 27000 });
});
