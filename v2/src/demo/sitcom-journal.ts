import { open, type FileHandle } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import { renderSitcomReplay } from "./sitcom-report";

export type SitcomJournalOptions = {
  maxPendingBytes?: number; maxBytes?: number; maxFrames?: number; maxRecordBytes?: number; maxPageBytes?: number;
};
type StreamName = "frames" | "events" | "publicEvents";
type FrameIndex = { offset: number; bytes: number };
const filenames = { frames: "audience-frames.jsonl", events: "sitcom-events.jsonl", publicEvents: "public-events.jsonl" };

/** The operator/audience journal is private. It is never an input to the public
 * visual projection. Each append takes its own serialized snapshot immediately,
 * then writes in order with bounded queued bytes. No full replay is held in RAM.
 * Files are exclusive-created: a new source cannot overwrite an earlier run. */
export class SitcomJournal<Frame = unknown> {
  private readonly frameIndex: FrameIndex[] = [];
  private readonly offsets = { frames: 0, events: 0, publicEvents: 0 };
  private readonly counts = { frames: 0, events: 0, publicEvents: 0 };
  private readonly limits: Required<SitcomJournalOptions>;
  private tail: Promise<void> = Promise.resolve();
  private pendingBytes = 0;
  private reservedBytes = 0;
  private reservedFrames = 0;
  private failure: Error | null = null;
  private closing: Promise<void> | null = null;

  private constructor(private readonly directory: string, private readonly files: Record<StreamName, FileHandle>, options: SitcomJournalOptions) {
    this.limits = { maxPendingBytes: options.maxPendingBytes ?? 8 * 1024 * 1024,
      maxBytes: options.maxBytes ?? 256 * 1024 * 1024, maxFrames: options.maxFrames ?? 100_000,
      maxRecordBytes: options.maxRecordBytes ?? 1024 * 1024, maxPageBytes: options.maxPageBytes ?? 2 * 1024 * 1024 };
  }
  static async open<Frame = unknown>(directory: string, options: SitcomJournalOptions = {}): Promise<SitcomJournal<Frame>> {
    const ceilings: Required<SitcomJournalOptions> = { maxPendingBytes: 64 * 1024 * 1024, maxBytes: 1024 * 1024 * 1024,
      maxFrames: 200_000, maxRecordBytes: 4 * 1024 * 1024, maxPageBytes: 8 * 1024 * 1024 };
    for (const [key, value] of Object.entries(options)) {
      if (!(key in ceilings) || !Number.isSafeInteger(value) || value <= 0 || value > ceilings[key as keyof SitcomJournalOptions])
        throw new Error("Invalid bounded sitcom journal policy.");
    }
    if ((options.maxRecordBytes ?? 1024 * 1024) > (options.maxPageBytes ?? 2 * 1024 * 1024))
      throw new Error("Journal page capacity must fit one complete record.");
    const files: Partial<Record<StreamName, FileHandle>> = {};
    try {
      for (const [kind, name] of Object.entries(filenames))
        files[kind as StreamName] = await open(join(directory, name), "wx+", 0o600);
      return new SitcomJournal<Frame>(directory, files as Record<StreamName, FileHandle>, options);
    } catch (error) {
      // Keep any newly created prefix for diagnosis; never remove user files.
      await Promise.all(Object.values(files).map(file => file.close()));
      throw error;
    }
  }
  private fail(error: unknown): Error {
    this.failure ??= error instanceof Error ? error : new Error("Sitcom journal storage failed.");
    return this.failure;
  }
  private append(stream: StreamName, value: unknown): Promise<void> {
    if (this.closing) return Promise.reject(new Error("Sitcom journal is closed."));
    if (this.failure) return Promise.reject(this.failure);
    let bytes: Buffer;
    try {
      const json = JSON.stringify(value);
      if (json === undefined) throw new Error("Journal records must be JSON values.");
      bytes = Buffer.from(json + "\n");
      if (bytes.length > this.limits.maxRecordBytes) throw new Error("Sitcom journal record byte limit exceeded.");
      if (this.pendingBytes + bytes.length > this.limits.maxPendingBytes) throw new Error("Sitcom journal pending-write byte limit exceeded.");
      if (this.reservedBytes + bytes.length > this.limits.maxBytes) throw new Error("Sitcom journal disk byte limit exceeded.");
      if (stream === "frames" && this.reservedFrames >= this.limits.maxFrames) throw new Error("Sitcom journal frame index limit exceeded.");
    } catch (error) { return Promise.reject(this.fail(error)); }
    this.pendingBytes += bytes.length; this.reservedBytes += bytes.length;
    if (stream === "frames") this.reservedFrames++;
    const result = this.tail.then(async () => {
      if (this.failure) throw this.failure;
      const offset = this.offsets[stream];
      let written = 0;
      while (written < bytes.length) {
        const part = await this.files[stream].write(bytes, written, bytes.length - written, offset + written);
        if (!part.bytesWritten) throw new Error("Sitcom journal write made no progress.");
        written += part.bytesWritten;
      }
      this.offsets[stream] += bytes.length; this.counts[stream]++;
      if (stream === "frames") this.frameIndex.push({ offset, bytes: bytes.length });
    }).catch(error => { throw this.fail(error); }).finally(() => { this.pendingBytes -= bytes.length; });
    // The internal tail always settles. The caller receives the rejection and
    // must stop the source; flush/page/close also report the same latched error.
    this.tail = result.catch(() => {});
    return result;
  }
  appendFrame(frame: Frame): Promise<void> { return this.append("frames", frame); }
  appendEvent(event: unknown): Promise<void> { return this.append("events", event); }
  appendPublicEvent(event: unknown): Promise<void> { return this.append("publicEvents", event); }
  snapshot() {
    return { ...this.counts, bytes: Object.values(this.offsets).reduce((sum, bytes) => sum + bytes, 0),
      reservedBytes: this.reservedBytes, pendingBytes: this.pendingBytes, failed: this.failure?.message ?? null,
      closed: this.closing !== null, limits: { ...this.limits } };
  }
  /** Cursor counts already consumed frames. Paging reads only this bounded page
   * from disk and returns independent values. An invalid cursor is not skipped. */
  async framesPage(after = 0, limit = 200): Promise<{ frames: Frame[]; cursor: number; hasMore: boolean }> {
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200)
      throw new Error("Invalid sitcom journal frame cursor or page limit.");
    await this.tail;
    if (this.failure) throw this.failure;
    if (after > this.frameIndex.length) throw new Error("Sitcom journal frame cursor is ahead of persisted history.");
    let cursor = after, length = 0;
    while (cursor < this.frameIndex.length && cursor - after < limit
      && length + this.frameIndex[cursor].bytes <= this.limits.maxPageBytes) length += this.frameIndex[cursor++].bytes;
    if (!length) return { frames: [], cursor, hasMore: cursor < this.frameIndex.length };
    const data = Buffer.alloc(length), offset = this.frameIndex[after].offset;
    const file = await open(join(this.directory, "audience-frames.jsonl"), "r");
    try {
      let read = 0;
      while (read < length) {
        const part = await file.read(data, read, length - read, offset + read);
        if (!part.bytesRead) throw new Error("Sitcom journal has a missing or truncated frame page.");
        read += part.bytesRead;
      }
    } catch (error) { throw this.fail(error); }
    finally { await file.close(); }
    try {
      const records = data.toString("utf8").split("\n");
      if (records.pop() !== "" || records.length !== cursor - after) throw new Error("Invalid frame page boundaries.");
      return { frames: records.map(record => JSON.parse(record) as Frame), cursor, hasMore: cursor < this.frameIndex.length };
    } catch { throw this.fail(new Error("Sitcom journal has a corrupt frame page.")); }
  }
  async flush(): Promise<void> {
    await this.tail;
    if (this.failure) throw this.failure;
    try { await Promise.all(Object.values(this.files).map(file => file.sync())); }
    catch (error) { throw this.fail(error); }
  }
  private async *records(stream: StreamName): AsyncGenerator<unknown> {
    await this.tail;
    if (this.failure) throw this.failure;
    const length = this.offsets[stream];
    if (!length) return;
    const input = createReadStream(join(this.directory, filenames[stream]), { start: 0, end: length - 1, highWaterMark: 64 * 1024 });
    let pending = Buffer.alloc(0), read = 0, count = 0;
    const expectedCount = this.counts[stream];
    try {
      for await (const chunk of input) {
        read += chunk.length; pending = Buffer.concat([pending, chunk]);
        let newline: number;
        while ((newline = pending.indexOf(10)) !== -1) {
          if (newline + 1 > this.limits.maxRecordBytes) throw new Error("Oversized persisted journal record.");
          const line = pending.subarray(0, newline); pending = pending.subarray(newline + 1); count++;
          yield JSON.parse(line.toString("utf8"));
        }
        if (pending.length > this.limits.maxRecordBytes) throw new Error("Oversized persisted journal record.");
      }
      if (pending.length || read !== length || count !== expectedCount) throw new Error("Missing or truncated journal export records.");
    } catch (error) { throw this.fail(error); }
    finally { input.destroy(); }
  }
  private async exportFile(path: string, build: (write: (text: string) => Promise<void>) => Promise<void>): Promise<void> {
    const file = await open(path, "wx", 0o600);
    try {
      let position = 0;
      const write = async (text: string) => {
        const bytes = Buffer.from(text); let written = 0;
        while (written < bytes.length) {
          const part = await file.write(bytes, written, bytes.length - written, position + written);
          if (!part.bytesWritten) throw new Error("Sitcom journal export made no progress.");
          written += part.bytesWritten;
        }
        position += written;
      };
      await build(write); await file.sync();
    } finally { await file.close(); }
  }
  /** Compatibility artifact, streamed from the complete persisted prefix. */
  async exportJsonArray(stream: StreamName, path: string): Promise<void> {
    if (!(stream in filenames)) throw new Error("Unknown sitcom journal stream.");
    await this.exportFile(path, async write => {
      await write("["); let first = true;
      for await (const record of this.records(stream)) { await write((first ? "" : ",") + JSON.stringify(record)); first = false; }
      await write("]");
    });
  }
  /** Standalone replay has all historical frames and actual speech, not the
   * bounded live UI cache. Script-data escaping matches the short-run report. */
  async exportReplay(path: string): Promise<void> {
    const shell = renderSitcomReplay([], [], []), marker = '{"frames":[],"speech":[],"events":[]}';
    const pieces = shell.split(marker);
    if (pieces.length !== 2) throw new Error("Sitcom replay template data boundary changed.");
    const escape = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
    await this.exportFile(path, async write => {
      await write(pieces[0] + '{"frames":[');
      let first = true;
      for await (const record of this.records("frames")) { await write((first ? "" : ",") + escape(record)); first = false; }
      await write('],"speech":['); first = true;
      for await (const record of this.records("publicEvents")) {
        const event = record as { kind?: string; text?: string };
        if (event.kind !== "speech" || !event.text) continue;
        await write((first ? "" : ",") + escape(record)); first = false;
      }
      await write('],"events":['); first = true;
      for await (const record of this.records("events")) {
        if (!["operator_text", "phone_read", "reply_typed", "reply_delivered"].includes((record as { kind: string }).kind)) continue;
        await write((first ? "" : ",") + escape(record)); first = false;
      }
      await write("]}" + pieces[1]);
    });
  }
  close(): Promise<void> {
    if (!this.closing) this.closing = (async () => {
      try { await this.flush(); }
      finally { await Promise.all(Object.values(this.files).map(file => file.close())); }
    })();
    return this.closing;
  }
}
