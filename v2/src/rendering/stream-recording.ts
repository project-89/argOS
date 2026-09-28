import express, { type Express, type Request, type Response } from "express";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, open, rename, writeFile, type FileHandle } from "node:fs/promises";
import { resolve } from "node:path";

export type StreamRecordingKind = "raw" | "composition";
type MimeType = "video/mp4" | "video/webm";
type Chunk = { index: number; bytes: number; sha256: string };
export type StreamRecordingStatus = {
  kind: StreamRecordingKind; mimeType: MimeType; bytes: number; nextIndex: number; complete: boolean;
  path?: string; url?: string; partialPath?: string; manifestPath?: string; partialBytes?: number; error?: string;
};
export type StreamRecordingOptions = {
  directory: string;
  canStart: () => boolean;
  canWrite: () => boolean;
  rawByteLimit?: number;
  compositionByteLimit?: number;
  onFailure?: (error: Error, kind: StreamRecordingKind) => void | Promise<void>;
};
type Recording = {
  kind: StreamRecordingKind; mimeType: MimeType; limit: number; chunks: Chunk[]; bytes: number; written: number;
  finalPath: string; partialPath: string; manifestPath: string; capability: string; handle?: FileHandle;
  complete: boolean; error?: string; request?: Request;
};
class RequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
const CHUNK_LIMIT = 8 * 1024 * 1024;
const CHUNK_COUNT_LIMIT = 4096;
const QUEUE_LIMIT = 16;

/** Install after authentication. Requests carry small chunks, never a whole session blob.
 * A separate read-only capability permits video.src/range requests without exposing the control token.
 * Incomplete recordings and their checksum manifests are retained for operator recovery.
 */
export function installStreamRecordings(app: Express, options: StreamRecordingOptions) {
  const recordings = new Map<StreamRecordingKind, Recording>();
  const queues = new Map<StreamRecordingKind, { tail: Promise<void>; count: number }>();
  let closing = false;
  const directory = resolve(options.directory);
  const limits = { raw: options.rawByteLimit ?? 1024 ** 3, composition: options.compositionByteLimit ?? 1.5 * 1024 ** 3 };
  for (const limit of Object.values(limits)) {
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error("Recording quotas must be positive integer bytes");
  }
  const publicStatus = (recording: Recording): StreamRecordingStatus => ({
    kind: recording.kind, mimeType: recording.mimeType, bytes: recording.bytes, nextIndex: recording.chunks.length,
    complete: recording.complete,
    ...(recording.complete ? { path: recording.finalPath, url: `/media/${recording.kind}?cap=${recording.capability}` }
      : { partialPath: recording.partialPath, partialBytes: recording.written }),
    manifestPath: recording.manifestPath,
    ...(recording.error ? { error: recording.error } : {}),
  });
  async function manifest(recording: Recording) {
    const path = `${recording.manifestPath}.next`;
    await writeFile(path, JSON.stringify({ ...publicStatus(recording), chunks: recording.chunks }, null, 2), { mode: 0o600 });
    await rename(path, recording.manifestPath);
  }
  async function fail(recording: Recording, error: unknown) {
    if (recording.error) return;
    recording.error = error instanceof Error ? error.message : String(error);
    const handle = recording.handle; recording.handle = undefined;
    if (handle) { try { await handle.sync(); } catch {} try { await handle.close(); } catch {} }
    try { await manifest(recording); } catch { /* The part file remains recoverable even if its filesystem is full. */ }
    // Do not await the owner: stopping a session may call closeIncomplete(),
    // which must be able to wait for this upload's serialized operation.
    try { void Promise.resolve(options.onFailure?.(new Error(recording.error), recording.kind)).catch(() => {}); } catch {}
  }
  function kind(req: Request): StreamRecordingKind {
    if (req.params.kind !== "raw" && req.params.kind !== "composition") throw new RequestError(404, "Unknown recording kind");
    return req.params.kind;
  }
  function serial(req: Request, res: Response, operation: (kind: StreamRecordingKind) => Promise<void>) {
    let selected: StreamRecordingKind;
    try { selected = kind(req); } catch (error) { respondError(res, error); return; }
    const queue = queues.get(selected) ?? { tail: Promise.resolve(), count: 0 };
    queues.set(selected, queue);
    if (queue.count >= QUEUE_LIMIT) { res.status(429).json({ error: "Recording upload queue is full" }); return; }
    queue.count++;
    queue.tail = queue.tail.then(async () => {
      try { await operation(selected); } catch (error) { respondError(res, error); }
    }).finally(() => { queue.count--; });
  }
  function respondError(res: Response, error: unknown) {
    if (res.headersSent || res.destroyed) return;
    res.status(error instanceof RequestError ? error.status : 500).json({
      error: error instanceof RequestError ? error.message : "Recording storage failed; partial data was retained",
    });
  }
  const json = express.json({ limit: "4kb" });
  app.post("/recordings/:kind/start", json, (req, res) => serial(req, res, async selected => {
    const mimeType = req.body?.mimeType;
    if (!req.body || Array.isArray(req.body) || Object.keys(req.body).some(key => key !== "mimeType")
      || (mimeType !== "video/mp4" && mimeType !== "video/webm")) throw new RequestError(400, "Expected video/mp4 or video/webm mimeType");
    const existing = recordings.get(selected);
    if (existing) {
      if (existing.mimeType !== mimeType) throw new RequestError(409, "Recording already started with a different mimeType");
      res.json(publicStatus(existing)); return;
    }
    if (closing || !options.canStart()) throw new RequestError(409, "Recording cannot start now");
    const filename = `${selected}-stream-${randomBytes(12).toString("hex")}.${mimeType === "video/mp4" ? "mp4" : "webm"}`;
    const finalPath = resolve(directory, filename);
    const recording: Recording = { kind: selected, mimeType, limit: limits[selected], chunks: [], bytes: 0, written: 0,
      finalPath, partialPath: `${finalPath}.part`, manifestPath: `${finalPath}.manifest.json`,
      capability: randomBytes(24).toString("hex"), complete: false };
    recordings.set(selected, recording);
    try {
      await mkdir(directory, { recursive: true });
      recording.handle = await open(recording.partialPath, "wx", 0o600);
      await manifest(recording);
      res.json(publicStatus(recording));
    } catch (error) { await fail(recording, error); throw error; }
  }));
  app.post("/recordings/:kind/chunks/:index", (req, res) => serial(req, res, async selected => {
    const recording = recordings.get(selected);
    if (!recording) throw new RequestError(409, "Start the recording first");
    if (closing) throw new RequestError(409, "Recording receiver is closed");
    if (!/^\d{1,5}$/.test(String(req.params.index))) throw new RequestError(400, "Invalid chunk index");
    const index = Number(req.params.index), previous = recording.chunks[index];
    if (index > recording.chunks.length) throw new RequestError(409, "Chunk index is out of sequence");
    if (!req.is("application/octet-stream")) throw new RequestError(415, "Expected application/octet-stream");
    if (!previous && (recording.complete || recording.error || !options.canWrite())) throw new RequestError(409, "Recording is not writable");
    if (!previous && recording.chunks.length >= CHUNK_COUNT_LIMIT) {
      const error = new RequestError(413, "Recording chunk count limit reached"); await fail(recording, error); throw error;
    }
    const declaredBytes = req.headers["content-length"] === undefined ? undefined : Number(req.headers["content-length"]);
    if (declaredBytes !== undefined && (!Number.isSafeInteger(declaredBytes) || declaredBytes <= 0)) throw new RequestError(400, "Empty or invalid chunk");
    if (declaredBytes !== undefined && declaredBytes > CHUNK_LIMIT) throw new RequestError(413, "Chunk exceeds 8 MiB");
    if (!previous && declaredBytes !== undefined && recording.bytes + declaredBytes > recording.limit) {
      const error = new RequestError(413, "Recording byte quota reached"); await fail(recording, error); throw error;
    }
    const hash = createHash("sha256"); let bytes = 0;
    recording.request = req;
    const deadline = setTimeout(() => req.destroy(new Error("Recording upload timed out")), 30_000); deadline.unref();
    try {
      for await (const input of req) {
        const data = Buffer.isBuffer(input) ? input : Buffer.from(input);
        bytes += data.length;
        if (bytes > CHUNK_LIMIT) throw new RequestError(413, "Chunk exceeds 8 MiB");
        if (!previous && recording.bytes + bytes > recording.limit) throw new RequestError(413, "Recording byte quota reached");
        hash.update(data);
        if (!previous) {
          const handle = recording.handle;
          if (!handle) throw new Error("Recording file is closed");
          let offset = 0;
          while (offset < data.length) {
            const result = await handle.write(data, offset, data.length - offset, recording.written);
            if (!result.bytesWritten) throw new Error("Recording disk write made no progress");
            offset += result.bytesWritten; recording.written += result.bytesWritten;
          }
        }
      }
      if (!bytes) throw new RequestError(400, "Empty chunk");
      if (declaredBytes !== undefined && bytes !== declaredBytes) throw new RequestError(400, "Incomplete chunk");
      const sha256 = hash.digest("hex");
      if (previous) {
        if (previous.bytes !== bytes || previous.sha256 !== sha256) throw new RequestError(409, "Retry bytes differ from the accepted chunk");
      } else {
        await recording.handle!.sync();
        recording.chunks.push({ index, bytes, sha256 }); recording.bytes += bytes;
        await manifest(recording);
      }
      res.json({ kind: selected, nextIndex: recording.chunks.length, bytes: recording.bytes });
    } catch (error) {
      // A failed new write can contain an incomplete MediaRecorder chunk. Retain it,
      // but never append to it or promote it to a falsely complete recording.
      if (!previous) await fail(recording, error);
      throw error;
    } finally { clearTimeout(deadline); recording.request = undefined; }
  }));
  app.post("/recordings/:kind/finish", json, (req, res) => serial(req, res, async selected => {
    const recording = recordings.get(selected), count = req.body?.chunks;
    if (!Number.isSafeInteger(count) || count <= 0 || !req.body || Object.keys(req.body).some(key => key !== "chunks")) {
      throw new RequestError(400, "Expected a positive exact chunk count");
    }
    if (!recording) throw new RequestError(409, "Start the recording first");
    if (count !== recording.chunks.length) throw new RequestError(409, "Final chunk count does not match accepted uploads");
    if (recording.complete) { res.json(publicStatus(recording)); return; }
    if (closing || recording.error || !recording.handle) throw new RequestError(409, "Incomplete recording cannot be finalized");
    try {
      await recording.handle.sync(); await recording.handle.close(); recording.handle = undefined;
      await rename(recording.partialPath, recording.finalPath); recording.complete = true;
      await manifest(recording); res.json(publicStatus(recording));
    } catch (error) { await fail(recording, error); throw error; }
  }));
  function mediaAccess(req: Request) {
    if (req.method !== "GET" && req.method !== "HEAD") return false;
    const selected = req.path === "/media/raw" ? "raw" : req.path === "/media/composition" ? "composition" : undefined;
    const recording = selected ? recordings.get(selected) : undefined;
    if (!recording?.complete || typeof req.query.cap !== "string") return false;
    const actual = Buffer.from(req.query.cap), expected = Buffer.from(recording.capability);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
  app.get(["/media/raw", "/media/composition"], (req, res, next) => {
    const selected = req.path === "/media/raw" ? "raw" : "composition", recording = recordings.get(selected);
    if (!recording) { next(); return; } // An older, non-streaming recording may have its own route.
    if (!recording.complete) { res.status(409).json({ error: "Recording is not finalized", ...publicStatus(recording) }); return; }
    res.type(recording.mimeType).set({ "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" });
    res.sendFile(recording.finalPath, { acceptRanges: true, dotfiles: "deny" }, error => {
      if (error && !res.headersSent) res.status((error as { statusCode?: number }).statusCode === 416 ? 416 : 500)
        .json({ error: "Could not read saved recording" });
    });
  });
  return {
    status: (): Partial<Record<StreamRecordingKind, StreamRecordingStatus>> => Object.fromEntries(
      [...recordings].map(([selected, recording]) => [selected, publicStatus(recording)])),
    has: (selected: StreamRecordingKind) => recordings.has(selected),
    mediaAccess,
    async closeIncomplete() {
      closing = true;
      for (const recording of recordings.values()) recording.request?.destroy(new Error("Recording receiver closed"));
      await Promise.all([...queues.values()].map(queue => queue.tail));
      for (const recording of recordings.values()) {
        if (!recording.complete && !recording.error) await fail(recording, new Error("Recording interrupted before finalization"));
      }
    },
  };
}
