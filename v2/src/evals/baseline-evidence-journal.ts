/** Lossless evaluation storage. Compression changes bytes on disk, never the
 * observed frame, actor memory, trial duration or acceptance criteria. */
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

export const BASELINE_JOURNAL_LIMITS = Object.freeze({
  storedBytes: 72 * 1024 * 1024,
  lifecycleReserveBytes: 64 * 1024,
  recordBytes: 4 * 1024 * 1024,
});
type Limits = typeof BASELINE_JOURNAL_LIMITS;
type Sink = (path: string, value: Buffer) => void;

/** Introspection returns newest-first. Record only the recent window, ordered
 * chronologically so a consumer's last entry is the latest, without mutating it. */
export function recentBaselineThoughts<T>(newestFirst: readonly T[]): T[] {
  return newestFirst.slice(0, 8).reverse();
}

export class BaselineEvidenceJournal {
  private storedBytes = 0;
  private lifecycleBytes = 0;
  private logicalBytes = 0;
  private records = 0;

  constructor(private readonly directory: string,
    private readonly limits: Limits = BASELINE_JOURNAL_LIMITS,
    private readonly sink: Sink = (path, value) => appendFileSync(path, value, { mode: 0o600 })) {
    if (!Object.values(limits).every(n => Number.isSafeInteger(n) && n > 0)
      || limits.lifecycleReserveBytes >= limits.storedBytes) throw new Error("Invalid evidence journal limits");
  }

  append(file: string, value: unknown): void {
    if (!/^[a-z][a-z0-9-]*\.jsonl(?:\.gz)?$/.test(file)) throw new Error("Invalid evidence journal filename");
    const json = JSON.stringify(value);
    if (json === undefined) throw new Error("Evidence record is not JSON");
    const raw = Buffer.from(json + "\n", "utf8");
    if (raw.length > this.limits.recordBytes) throw new Error("Evidence record bound exceeded");
    // One complete gzip member per record: concatenated members are a standard
    // gzip stream and every completed append preserves an independently saved row.
    const bytes = file.endsWith(".gz") ? gzipSync(raw, { level: 1 }) : raw;
    const lifecycle = file === "lifecycle.jsonl";
    if (lifecycle ? this.lifecycleBytes + bytes.length > this.limits.lifecycleReserveBytes
      : this.storedBytes - this.lifecycleBytes + bytes.length > this.limits.storedBytes - this.limits.lifecycleReserveBytes)
      throw new Error("Evidence journal bound exceeded");
    this.sink(join(this.directory, file), bytes);
    this.storedBytes += bytes.length;
    if (lifecycle) this.lifecycleBytes += bytes.length;
    this.logicalBytes += raw.length;
    this.records++;
  }

  snapshot() { return { limits: this.limits, storedBytes: this.storedBytes,
    lifecycleBytes: this.lifecycleBytes, logicalBytes: this.logicalBytes, records: this.records }; }
}

type CleanupFailure = { stage: string; error: string };
/** Await both the actual stopped-world callbacks and the provider's audit, not
 * a guessed grace-period sleep. A timeout is failed/incomplete evidence. */
export async function drainBaselineWork(operationDrain: () => Promise<unknown>, providerDrain: (() => Promise<unknown>) | undefined,
  timeoutMs = 2000): Promise<void> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw new RangeError("Invalid baseline drain bound");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const results = await Promise.race([
      Promise.allSettled([Promise.resolve().then(operationDrain), Promise.resolve().then(() => {
        if (!providerDrain) throw new Error("Provider audit drain unavailable");
        return providerDrain();
      })]),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Baseline work drain timed out")), timeoutMs); }),
    ]);
    if (results.some(row => row.status === "rejected")) throw new Error("Baseline work drain incomplete");
  } finally { if (timer) clearTimeout(timer); }
}

/** An observer failure must neither skip native stop nor erase its failed run.
 * A synchronous stop hang still requires the independent owned-process guard. */
export async function finalizeBaselineObservation(options: {
  checkpoint: () => void;
  lifecycle: (stage: string) => void;
  stop: () => void;
  drain: () => Promise<unknown>;
  disposers: readonly (() => void)[];
}): Promise<CleanupFailure[]> {
  const failures: CleanupFailure[] = [];
  const failed = (stage: string, error: unknown) => failures.push({ stage,
    error: (error instanceof Error ? error.message : "Observer cleanup failed").slice(0,500) });
  const safely = (stage: string, fn: () => void): boolean => {
    try { fn(); return true; } catch (error) { failed(stage, error); return false; }
  };
  safely("checkpoint", options.checkpoint);
  safely("stop_begin", () => options.lifecycle("stop_begin"));
  const stopped = safely("stop", options.stop);
  const terminal = stopped ? "stop_returned" : "stop_failed";
  safely(terminal, () => options.lifecycle(terminal));
  let drained = true;
  try { await options.drain(); } catch (error) { drained = false; failed("drain", error); }
  const drainTerminal = drained ? "drain_returned" : "drain_failed";
  safely(drainTerminal, () => options.lifecycle(drainTerminal));
  options.disposers.forEach((dispose, i) => safely(`dispose:${i}`, dispose));
  return failures;
}
