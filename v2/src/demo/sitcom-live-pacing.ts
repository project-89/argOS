import { SitcomPlayback, type SitcomChunk, type SitcomSegment } from "./sitcom-presentation";

export interface SitcomPresentationReceipt { playbackSeconds: number; chunks: readonly SitcomChunk[] }
export interface SitcomLivePacingPolicy {
  maxSourceLeadMs: number; resumeSourceLeadMs: number;
  maxQueuedPerformanceMs: number; resumeQueuedPerformanceMs: number;
}
export const LIVE_PACING_POLICY: Readonly<SitcomLivePacingPolicy> = Object.freeze({
  maxSourceLeadMs: 30_000, resumeSourceLeadMs: 16_000,
  maxQueuedPerformanceMs: 28_000, resumeQueuedPerformanceMs: 14_000,
});

/** A bounded broadcast buffer, not a simulation clock. Only the host explicitly
 * pauses/resumes its source. Issued scripts stay immutable; provider application
 * acknowledgements are not proof of depiction. Audience receipts map the actual
 * playback head through registered prompt/chunk metadata, never a client-supplied
 * future source timestamp. This is intended timing, not audiovisual recognition. */
export class SitcomLivePacer {
  readonly policy: Readonly<SitcomLivePacingPolicy>;
  private readonly timeline = new SitcomPlayback();
  private readonly segments = new Map<number, SitcomSegment>();
  private readonly chunks = new Map<number, SitcomChunk>();
  private playbackSeconds = 0;
  private displayedSourceMs = 0;
  private paused = false;
  private peakSourceLeadMs = 0;
  private peakQueuedPerformanceMs = 0;
  private failure: Readonly<{ reason: "provider_chunk_shorter_than_performance" | "provider_skipped_issued_performance" | "realtime_chunk_duration_mismatch" | "provider_repeated_realtime_performance";
    version: number; expectedMs?: number; actualMs?: number }> | null = null;
  constructor(policy: Readonly<SitcomLivePacingPolicy> = LIVE_PACING_POLICY) {
    if (Object.values(policy).some(n => !Number.isFinite(n) || n < 0)
      || policy.maxSourceLeadMs <= policy.resumeSourceLeadMs
      || policy.maxQueuedPerformanceMs <= policy.resumeQueuedPerformanceMs
      || policy.maxQueuedPerformanceMs < 10_125) throw new Error("Invalid bounded broadcast pacing policy");
    this.policy = Object.freeze({ ...policy });
  }
  register(segment: SitcomSegment): void {
    const existing = this.segments.get(segment.version), previous = [...this.segments.values()].at(-1);
    if (!existing && previous && (segment.version !== previous.version + 1 || segment.sourceId !== previous.sourceId
      || segment.sourceStartSimMs !== previous.sourceEndSimMs)) throw new Error("Noncontiguous issued performance");
    if (!existing && !this.canIssue(segment.performance?.durationMs ?? segment.sourceEndSimMs - segment.sourceStartSimMs))
      throw new Error("Bounded performance queue is full");
    if (!this.timeline.register(segment)) throw new Error("Invalid or conflicting issued performance");
    if (!existing) this.segments.set(segment.version, Object.freeze({ ...segment, ...(segment.performance ? {
      performance: Object.freeze({ ...segment.performance, sourceMap: Object.freeze(segment.performance.sourceMap.map(p => Object.freeze({ ...p }))) }),
    } : {}) }));
  }
  observe(receipt: SitcomPresentationReceipt): void {
    if (!Number.isFinite(receipt.playbackSeconds) || receipt.playbackSeconds < this.playbackSeconds
      || receipt.playbackSeconds > 2000 || receipt.chunks.length > 32) throw new Error("Invalid live playback receipt");
    // Validate the entire delta before admitting any metadata. A malformed last
    // row must not partially release an earlier performance from backpressure.
    const pending = new Map<number, SitcomChunk>();
    for (const chunk of receipt.chunks) {
      if (!Number.isInteger(chunk.chunk_index) || chunk.chunk_index < 0 || chunk.chunk_index >= 1024
        || !Number.isInteger(chunk.prompt_version) || !Number.isFinite(chunk.playback_seconds)
        || chunk.playback_seconds <= 0 || chunk.playback_seconds > 30) throw new Error("Invalid provider chunk metadata");
      const old = pending.get(chunk.chunk_index) ?? this.chunks.get(chunk.chunk_index);
      if (!this.segments.has(chunk.prompt_version)) throw new Error("Unissued prompt in playback receipt");
      if (old) {
        if (old.prompt_version !== chunk.prompt_version || old.playback_seconds !== chunk.playback_seconds)
          throw new Error("Conflicting provider chunk metadata");
        continue;
      }
      pending.set(chunk.chunk_index, chunk);
    }
    for (const chunk of pending.values()) {
      if (!this.timeline.add(chunk)) throw new Error("Invalid provider chunk metadata");
      this.chunks.set(chunk.chunk_index, Object.freeze({ ...chunk }));
    }
    let priorVersion: number | undefined;
    const firstIssued = this.segments.keys().next().value;
    for (let index = 0; index < 1024; index++) {
      const chunk = this.chunks.get(index); if (!chunk) break;
      if (priorVersion === undefined ? chunk.prompt_version !== firstIssued
        : chunk.prompt_version !== priorVersion && chunk.prompt_version !== priorVersion + 1)
        this.failure ??= Object.freeze({ reason: "provider_skipped_issued_performance", version: priorVersion === undefined ? firstIssued! : priorVersion + 1 });
      const duration = this.segments.get(chunk.prompt_version)!.performance?.durationMs;
      // Only a version's first contiguous representation owes a whole
      // performance. A repeated chunk is an ending hold and may be shorter.
      // Wait for metadata gaps before deciding which chunk came first.
      if (chunk.prompt_version !== priorVersion && duration !== undefined && chunk.playback_seconds * 1000 + 250 < duration)
        this.failure ??= Object.freeze({ reason: "provider_chunk_shorter_than_performance", version: chunk.prompt_version,
          expectedMs: duration, actualMs: chunk.playback_seconds * 1000 });
      if(this.segments.get(chunk.prompt_version)!.performance?.clock==="realtime") {
        if(chunk.prompt_version===priorVersion)this.failure??=Object.freeze({reason:"provider_repeated_realtime_performance",version:chunk.prompt_version});
        if(duration!==undefined&&Math.abs(chunk.playback_seconds*1000-duration)>1)
          this.failure??=Object.freeze({reason:"realtime_chunk_duration_mismatch",version:chunk.prompt_version,expectedMs:duration,actualMs:chunk.playback_seconds*1000});
      }
      priorVersion = chunk.prompt_version;
    }
    this.playbackSeconds = receipt.playbackSeconds;
    const head = this.timeline.at(receipt.playbackSeconds);
    if (head.state === "mapped" || head.state === "held") this.displayedSourceMs = Math.max(this.displayedSourceMs, head.sourceMs);
  }
  private consumedPerformanceMs(): number {
    let mediaStart = 0, consumed = 0;
    const seen = new Set<number>();
    for (let index = 0; index < 1024; index++) {
      const chunk = this.chunks.get(index); if (!chunk) break;
      const duration = chunk.playback_seconds * 1000, segment = this.segments.get(chunk.prompt_version)!;
      const budget = segment.performance?.durationMs ?? duration;
      if (!seen.has(chunk.prompt_version)) consumed += Math.min(budget, Math.max(0, this.playbackSeconds * 1000 - mediaStart), duration);
      seen.add(chunk.prompt_version); mediaStart += duration;
    }
    return consumed;
  }
  queuedPerformanceMs(): number {
    return Math.max(0, [...this.segments.values()].reduce((n, s) => n + (s.performance?.durationMs ?? s.sourceEndSimMs - s.sourceStartSimMs), 0) - this.consumedPerformanceMs());
  }
  canIssue(durationMs: number): boolean {
    return !this.failure && Number.isFinite(durationMs) && durationMs > 0 && this.queuedPerformanceMs() + durationMs <= this.policy.maxQueuedPerformanceMs;
  }
  sample(sourceNowMs: number) {
    if (!Number.isFinite(sourceNowMs) || sourceNowMs < this.displayedSourceMs) throw new Error("Invalid authoritative source frontier");
    const sourceLeadMs = sourceNowMs - this.displayedSourceMs, queuedPerformanceMs = this.queuedPerformanceMs();
    this.peakSourceLeadMs = Math.max(this.peakSourceLeadMs, sourceLeadMs);
    this.peakQueuedPerformanceMs = Math.max(this.peakQueuedPerformanceMs, queuedPerformanceMs);
    if (this.failure) this.paused = true;
    else if (!this.paused && (sourceLeadMs >= this.policy.maxSourceLeadMs || queuedPerformanceMs >= this.policy.maxQueuedPerformanceMs)) this.paused = true;
    else if (this.paused && sourceLeadMs <= this.policy.resumeSourceLeadMs && queuedPerformanceMs <= this.policy.resumeQueuedPerformanceMs) this.paused = false;
    let receiptCursor = 0; while (this.chunks.has(receiptCursor)) receiptCursor++;
    return { mode: "bounded-live" as const, sourcePausedForVideo: this.paused, sourceLeadMs, queuedPerformanceMs,
      displayedSourceMs: this.displayedSourceMs, playbackSeconds: this.playbackSeconds,
      peakSourceLeadMs: this.peakSourceLeadMs, peakQueuedPerformanceMs: this.peakQueuedPerformanceMs,
      receiptCursor, policy: this.policy, failure: this.failure, synchronization: "issued choreography; not verified pixel/audio timing" };
  }
}
