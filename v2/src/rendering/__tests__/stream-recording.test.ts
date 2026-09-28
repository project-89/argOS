import express from "express";
import { jest } from "@jest/globals";
import { request as httpRequest, type Server } from "node:http";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { installStreamRecordings, type StreamRecordingOptions } from "../stream-recording";

const token = "operator-control-token";
type Receiver = ReturnType<typeof installStreamRecordings>;
const active: Array<{ server: Server; receiver: Receiver }> = [];
async function fixture(overrides: Partial<StreamRecordingOptions> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "argos-stream-recording-"));
  const app = express(); let receiver: Receiver;
  app.use((req, res, next) => {
    if (req.headers["x-argos-token"] === token || receiver?.mediaAccess(req)) next();
    else res.sendStatus(403);
  });
  const failure = jest.fn<NonNullable<StreamRecordingOptions["onFailure"]>>();
  receiver = installStreamRecordings(app, { directory, canStart: () => true, canWrite: () => true, onFailure: failure, ...overrides });
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
  active.push({ server, receiver }); return { directory, receiver, server, failure };
}
function request(server: Server, path: string, options: {
  body?: unknown; binary?: Buffer; method?: string; auth?: boolean; headers?: Record<string, string>;
} = {}) {
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing server");
  const body = options.binary ?? (options.body === undefined ? undefined : Buffer.from(JSON.stringify(options.body)));
  return new Promise<{ status: number; bytes: Buffer; json: () => any; headers: Record<string, any> }>((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port: address.port, path, method: options.method ?? (body ? "POST" : "GET"),
      headers: { ...(options.auth === false ? {} : { "x-argos-token": token }),
        ...(body ? { "content-length": body.length, "content-type": options.binary ? "application/octet-stream" : "application/json" } : {}),
        ...options.headers } }, response => {
      const chunks: Buffer[] = []; response.on("data", bytes => chunks.push(bytes)); response.on("end", () => {
        const bytes = Buffer.concat(chunks); resolve({ status: response.statusCode!, bytes, json: () => JSON.parse(bytes.toString()), headers: response.headers });
      });
    }); req.on("error", reject); req.end(body);
  });
}
const start = (server: Server, kind = "raw", mimeType = "video/webm") => request(server, `/recordings/${kind}/start`, { body: { mimeType } });
const chunk = (server: Server, index: number, value: string, kind = "raw") => request(server, `/recordings/${kind}/chunks/${index}`, { binary: Buffer.from(value) });
const finish = (server: Server, chunks: number, kind = "raw") => request(server, `/recordings/${kind}/finish`, { body: { chunks } });
afterEach(async () => {
  for (const { server, receiver } of active.splice(0)) {
    await receiver.closeIncomplete(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("chunks are serialized on disk, retries verify hashes, and finalize is idempotent", async () => {
  const { server, receiver } = await fixture();
  const initial = await start(server); expect(initial.status).toBe(200);
  expect((await start(server)).json()).toEqual(initial.json());
  expect((await start(server, "raw", "video/mp4")).status).toBe(409);
  expect((await chunk(server, 1, "future")).status).toBe(409);
  const [first, retry, second] = await Promise.all([chunk(server, 0, "first"), chunk(server, 0, "first"), chunk(server, 1, "second")]);
  expect([first.status, retry.status, second.status]).toEqual([200, 200, 200]);
  expect(receiver.status().raw).toMatchObject({ bytes: 11, nextIndex: 2, complete: false, partialBytes: 11 });
  expect((await chunk(server, 0, "other")).status).toBe(409);
  expect((await finish(server, 1)).status).toBe(409);
  const complete = await finish(server, 2); expect(complete.status).toBe(200);
  expect(complete.json()).toMatchObject({ bytes: 11, nextIndex: 2, complete: true, kind: "raw", mimeType: "video/webm" });
  expect(await readFile(complete.json().path, "utf8")).toBe("firstsecond");
  expect((await finish(server, 2)).json()).toEqual(complete.json());
  expect((await chunk(server, 0, "first")).status).toBe(200);
  expect((await chunk(server, 2, "late")).status).toBe(409);
  const manifest = JSON.parse(await readFile(complete.json().manifestPath, "utf8"));
  expect(manifest.chunks).toHaveLength(2); expect(manifest.chunks[0].sha256).toHaveLength(64);
  expect(complete.json().url).not.toContain(token);
});

test("media capabilities are read-only, kind-specific and support ranges and HEAD", async () => {
  const { server } = await fixture();
  await start(server); await chunk(server, 0, "0123456789"); const raw = (await finish(server, 1)).json();
  await start(server, "composition", "video/mp4"); await chunk(server, 0, "movie", "composition");
  const composition = (await finish(server, 1, "composition")).json();
  expect(raw.path).not.toBe(composition.path); expect(raw.url).not.toBe(composition.url);
  expect((await request(server, "/media/raw", { auth: false })).status).toBe(403);
  expect((await request(server, `${raw.url}x`, { auth: false })).status).toBe(403);
  const range = await request(server, raw.url, { auth: false, headers: { range: "bytes=2-5" } });
  expect(range.status).toBe(206); expect(range.bytes.toString()).toBe("2345");
  expect(range.headers["content-range"]).toBe("bytes 2-5/10");
  const head = await request(server, composition.url, { auth: false, method: "HEAD" });
  expect(head.status).toBe(200); expect(head.bytes.length).toBe(0); expect(head.headers["content-length"]).toBe("5");
  expect((await request(server, raw.url.replace("/media/raw", "/media/composition"), { auth: false })).status).toBe(403);
  expect((await request(server, raw.url, { auth: false, method: "POST", body: {} })).status).toBe(403);
  expect((await request(server, raw.url.replace("/media/raw", "/recordings/raw/start"), { auth: false, body: { mimeType: "video/webm" } })).status).toBe(403);
});

test("aggregate quotas preserve the accepted prefix and report a recording failure", async () => {
  const { server, receiver, failure } = await fixture({ rawByteLimit: 8, compositionByteLimit: 16 });
  await start(server); await chunk(server, 0, "12345");
  expect((await chunk(server, 1, "6789")).status).toBe(413);
  expect(receiver.status().raw).toMatchObject({ bytes: 5, nextIndex: 1, complete: false, error: "Recording byte quota reached" });
  expect(await readFile(receiver.status().raw!.partialPath!, "utf8")).toBe("12345");
  expect(failure).toHaveBeenCalledTimes(1);
  expect((await finish(server, 1)).status).toBe(409);
  expect((await chunk(server, 1, "6")).status).toBe(409);
  await start(server, "composition"); expect((await chunk(server, 0, "123456789", "composition")).status).toBe(200);
  expect((await finish(server, 1, "composition")).status).toBe(200);
});

test("oversize, malformed and unauthorized requests never allocate or append", async () => {
  const { server, receiver } = await fixture();
  expect((await request(server, "/recordings/raw/start", { auth: false, body: { mimeType: "video/webm" } })).status).toBe(403);
  expect(receiver.has("raw")).toBe(false);
  expect((await start(server, "other")).status).toBe(404);
  expect((await start(server, "raw", "text/html")).status).toBe(400);
  await start(server);
  expect((await request(server, "/recordings/raw/chunks/0", { binary: Buffer.alloc(8 * 1024 * 1024 + 1) })).status).toBe(413);
  expect((await request(server, "/recordings/raw/chunks/-1", { binary: Buffer.from("x") })).status).toBe(400);
  expect((await request(server, "/recordings/raw/chunks/0", { body: { data: "x" } })).status).toBe(415);
  expect((await chunk(server, 0, "")).status).toBe(400);
  expect(receiver.status().raw).toMatchObject({ bytes: 0, nextIndex: 0 });
  expect((await finish(server, 0)).status).toBe(400);
  expect((await chunk(server, 0, "valid")).status).toBe(200);
});

test("start and write gates apply to new work without rejecting an accepted retry", async () => {
  let canStart = false, canWrite = false;
  const { server } = await fixture({ canStart: () => canStart, canWrite: () => canWrite });
  expect((await start(server)).status).toBe(409); canStart = true;
  expect((await start(server)).status).toBe(200); canStart = false;
  expect((await start(server)).status).toBe(200);
  expect((await chunk(server, 0, "hello")).status).toBe(409); canWrite = true;
  expect((await chunk(server, 0, "hello")).status).toBe(200); canWrite = false;
  expect((await chunk(server, 0, "hello")).status).toBe(200);
  expect((await chunk(server, 1, "later")).status).toBe(409);
  expect((await finish(server, 1)).status).toBe(200);
});

test("closing retains recovery files and a complete checksum manifest", async () => {
  const { server, receiver } = await fixture();
  await start(server); await chunk(server, 0, "prefix"); await receiver.closeIncomplete();
  const state = receiver.status().raw!;
  expect(state).toMatchObject({ complete: false, bytes: 6, partialBytes: 6, error: "Recording interrupted before finalization" });
  expect(await readFile(state.partialPath!, "utf8")).toBe("prefix");
  expect(JSON.parse(await readFile(state.manifestPath!, "utf8")).chunks).toHaveLength(1);
  expect((await finish(server, 1)).status).toBe(409);
  expect((await request(server, "/media/raw")).status).toBe(409);
  expect((await start(server, "composition")).status).toBe(409);
});

test("disconnect preserves partial bytes and refuses to claim an incomplete chunk", async () => {
  const { server, receiver, failure } = await fixture(); await start(server);
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No address");
  const req = httpRequest({ host: "127.0.0.1", port: address.port, path: "/recordings/raw/chunks/0", method: "POST",
    headers: { "x-argos-token": token, "content-type": "application/octet-stream", "content-length": "100" } });
  req.on("error", () => {}); req.write("partial");
  for (let i = 0; i < 100; i++) {
    if ((await stat(receiver.status().raw!.partialPath!)).size === 7) break;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  req.destroy();
  for (let i = 0; i < 100 && !failure.mock.calls.length; i++) await new Promise(resolve => setTimeout(resolve, 5));
  expect(receiver.status().raw).toMatchObject({ complete: false, bytes: 0, nextIndex: 0, partialBytes: 7 });
  expect(receiver.status().raw!.error).toBeDefined(); expect(failure).toHaveBeenCalledTimes(1);
  expect(await readFile(receiver.status().raw!.partialPath!, "utf8")).toBe("partial");
  expect((await chunk(server, 0, "retry")).status).toBe(409);
});

test("filesystem failure is surfaced and failure callbacks may close the receiver without deadlock", async () => {
  const temp = await mkdtemp(join(tmpdir(), "argos-stream-full-")), path = join(temp, "not-a-directory");
  await writeFile(path, "existing file"); let close: Promise<void> | undefined, receiver: Receiver | undefined;
  const failure = jest.fn(() => { close = receiver?.closeIncomplete(); return close; });
  const result = await fixture({ directory: path, onFailure: failure }); receiver = result.receiver;
  expect((await start(result.server)).status).toBe(500); await close;
  expect(failure).toHaveBeenCalledTimes(1);
  expect(receiver.status().raw?.error).toBeDefined(); expect(receiver.status().raw?.complete).toBe(false);
  expect(await readFile(path, "utf8")).toBe("existing file");
});

const mediaToolsAvailable = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0
  && spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;
(mediaToolsAvailable ? test : test.skip)("fragmented MP4 chunks append into a decodable audio/video recording", async () => {
  const { server, directory } = await fixture();
  const source = join(directory, "synthetic-source.mp4");
  const generated = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=size=160x90:rate=12",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=24000", "-t", "1", "-threads", "1",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "frag_keyframe+empty_moov+default_base_moof", source],
  { encoding: "utf8", timeout: 15_000 });
  expect({ status: generated.status, stderr: generated.stderr }).toEqual({ status: 0, stderr: "" });
  const bytes = await readFile(source); await start(server, "raw", "video/mp4");
  let count = 0;
  for (let offset = 0; offset < bytes.length; offset += 2048) {
    expect((await request(server, `/recordings/raw/chunks/${count++}`, { binary: bytes.subarray(offset, offset + 2048) })).status).toBe(200);
  }
  const saved = (await finish(server, count)).json(); expect(saved.bytes).toBe(bytes.length);
  const decoded = spawnSync("ffmpeg", ["-v", "error", "-i", saved.path, "-f", "null", "-"], { encoding: "utf8", timeout: 15_000 });
  expect({ status: decoded.status, stderr: decoded.stderr }).toEqual({ status: 0, stderr: "" });
  const inspected = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type", "-show_entries", "format=duration",
    "-of", "json", saved.path], { encoding: "utf8", timeout: 15_000 });
  const result = JSON.parse(inspected.stdout);
  expect(result.streams.map((stream: { codec_type: string }) => stream.codec_type).sort()).toEqual(["audio", "video"]);
  expect(Number(result.format.duration)).toBeGreaterThanOrEqual(1);
}, 30_000);
