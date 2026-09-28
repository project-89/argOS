import type { CommittedRenderSegment } from "./committed-scene-renderer";
import type { SceneSnapshot } from "./scene-director";

type Chunk = { index: number; seconds: number; version: number; sourceRate: number };
export type SourcePlaybackChunk = Chunk & { startSeconds: number; endSeconds: number;
  sourceId: string; sourceStartSimMs: number; sourceEndSimMs: number };
export type SourcePlayhead = { status: "mapped"; chunk: SourcePlaybackChunk; sourceId: string; sourceSimMs: number;
  sourceSequence: number; scene: SceneSnapshot }
  | { status: "buffering" | "unmapped"; reason: "no_chunk" | "missing_prompt" | "duration_mismatch" | "source_discontinuity" | "end_of_tape" };

/** The provider's real chunk indices/durations are transport facts. Source
 * versions are registered from issued immutable intervals, never inferred from
 * the newest snapshot or wall latency. Editorial retiming is explicit only. */
export class SourcePlaybackTimeline {
  private segments = new Map<number, CommittedRenderSegment>();
  private received = new Map<number, Chunk>();
  private closed = false;
  constructor(private readonly limit = 256) { if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2048) throw new Error("Invalid playback retention limit."); }
  register(segment: CommittedRenderSegment): boolean {
    if (this.closed || this.segments.size >= this.limit || this.segments.has(segment.version)
      || !Number.isSafeInteger(segment.version) || segment.version < 1 || !segment.sourceId
      || !Number.isFinite(segment.sourceStartSimMs) || segment.sourceStartSimMs < 0 || !Number.isFinite(segment.sourceEndSimMs)
      || !segment.window.states.length
      || segment.sourceStartSimMs !== segment.window.startSimMs || segment.sourceEndSimMs !== segment.window.endSimMs
      || segment.sourceId !== segment.window.sourceId || segment.sourceEndSimMs <= segment.sourceStartSimMs) return false;
    this.segments.set(segment.version, structuredClone(segment)); return true;
  }
  add(message: { chunk_index?: unknown; playback_seconds?: unknown; prompt_version?: unknown }, options: { sourceRate?: number } = {}): boolean {
    const index = message.chunk_index, seconds = message.playback_seconds, version = message.prompt_version;
    const rate = options.sourceRate ?? 1;
    if (this.closed || typeof index !== "number" || !Number.isSafeInteger(index) || index < 0 || index >= this.limit
      || typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0 || seconds > 60
      || typeof version !== "number" || !Number.isSafeInteger(version) || version < 1 || !Number.isFinite(rate) || rate <= 0 || rate > 100
      || this.received.has(index)) return false;
    this.received.set(index, { index, seconds, version, sourceRate: rate }); return true;
  }
  private resolved(): { chunks: SourcePlaybackChunk[]; failure?: SourcePlayhead & { status: "unmapped" } } {
    const chunks: SourcePlaybackChunk[] = []; let startSeconds = 0;
    for (let index = 0; this.received.has(index); index++) {
      const chunk = this.received.get(index)!, segment = this.segments.get(chunk.version);
      const failed = (reason: "missing_prompt" | "duration_mismatch" | "source_discontinuity") =>
        ({ chunks, failure: { status: "unmapped" as const, reason } });
      if (!segment) return failed("missing_prompt");
      const expectedMs = chunk.seconds * 1000 * chunk.sourceRate;
      if (Math.abs(expectedMs - (segment.sourceEndSimMs - segment.sourceStartSimMs)) > .01) return failed("duration_mismatch");
      const previous = chunks.at(-1);
      if (previous && (previous.sourceId !== segment.sourceId || previous.sourceEndSimMs !== segment.sourceStartSimMs))
        return failed("source_discontinuity");
      chunks.push({ ...chunk, startSeconds, endSeconds: startSeconds + chunk.seconds,
        sourceId: segment.sourceId, sourceStartSimMs: segment.sourceStartSimMs, sourceEndSimMs: segment.sourceEndSimMs });
      startSeconds += chunk.seconds;
    }
    return { chunks };
  }
  chunks(): SourcePlaybackChunk[] { return structuredClone(this.resolved().chunks); }
  at(playbackSeconds: number): SourcePlayhead {
    if (!Number.isFinite(playbackSeconds) || playbackSeconds < 0) return { status: "buffering", reason: "no_chunk" };
    const { chunks, failure } = this.resolved();
    const chunk = chunks.find(c => playbackSeconds >= c.startSeconds && playbackSeconds < c.endSeconds);
    if (!chunk) return failure ?? { status: "buffering", reason: chunks.length ? "end_of_tape" : "no_chunk" };
    const segment = this.segments.get(chunk.version)!;
    const sourceSimMs = chunk.sourceStartSimMs + (playbackSeconds - chunk.startSeconds) * 1000 * chunk.sourceRate;
    const state = [...segment.window.states].reverse().find(s => s.atSimMs <= sourceSimMs) ?? segment.window.states[0];
    return { status: "mapped", chunk: structuredClone(chunk), sourceId: segment.sourceId, sourceSimMs,
      sourceSequence: state.sequence, scene: structuredClone(state.scene) };
  }
  stop(): void { this.closed = true; }
}
