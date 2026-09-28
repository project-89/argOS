/** Session voice service: per-session budgets, an LRU cache of synthesized
 * lines keyed by (voice, style, text), in-flight de-duplication and a small
 * concurrency limit in front of the provider. */
import { createHash } from "node:crypto";
import { VoiceError, type SynthesisResult, type VoiceClient } from "./gemini-voice";

export type VoiceServiceOptions = {
  client: VoiceClient;
  /** Provider synthesis calls allowed this session (cache hits are free). */
  synthesisBudget?: number;
  /** Provider transcription calls allowed this session. */
  transcriptionBudget?: number;
  cacheEntries?: number;
  cacheBytes?: number;
  maxConcurrent?: number;
  /** Requests allowed to wait for a slot before new ones are refused. */
  maxQueued?: number;
};

export type SpeakResult = SynthesisResult & { cached: boolean };

const envInt = (name: string, fallback: number) => {
  const value = Number(process.env[name]); return Number.isInteger(value) && value >= 0 ? value : fallback;
};

export function voiceCacheKey(voice: string, style: string, text: string) {
  return createHash("sha256").update(JSON.stringify([voice, style, text.trim()])).digest("hex");
}

/** Bounded by entry count and total bytes; Map iteration order is recency. */
export class LruCache<V extends { wav: Buffer }> {
  private readonly map = new Map<string, V>();
  private bytes = 0;
  constructor(private readonly maxEntries: number, private readonly maxBytes: number) {}
  get size() { return this.map.size; }
  get totalBytes() { return this.bytes; }
  get(key: string) {
    const value = this.map.get(key); if (!value) return undefined;
    this.map.delete(key); this.map.set(key, value); return value;
  }
  set(key: string, value: V) {
    if (value.wav.length > this.maxBytes) return;
    const prior = this.map.get(key); if (prior) { this.bytes -= prior.wav.length; this.map.delete(key); }
    this.map.set(key, value); this.bytes += value.wav.length;
    for (const [oldest, entry] of this.map) {
      if (this.map.size <= this.maxEntries && this.bytes <= this.maxBytes) break;
      this.map.delete(oldest); this.bytes -= entry.wav.length;
    }
  }
}

class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  constructor(private readonly limit: number, private readonly maxQueued: number) {}
  get inFlight() { return this.active; }
  async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.active >= this.limit) {
      if (this.waiting.length >= this.maxQueued) throw new VoiceError("Voice is busy; try again shortly", 429, 2);
      await new Promise<void>((resolve, reject) => {
        const go = () => { signal?.removeEventListener("abort", cancel); resolve(); };
        const cancel = () => { const i = this.waiting.indexOf(go); if (i >= 0) this.waiting.splice(i, 1); reject(new VoiceError("Voice request cancelled", 499)); };
        if (signal?.aborted) return cancel();
        signal?.addEventListener("abort", cancel, { once: true });
        this.waiting.push(go);
      });
    }
    this.active++;
    try { return await task(); }
    finally { this.active--; this.waiting.shift()?.(); }
  }
}

export class VoiceService {
  readonly synthesisBudget: number;
  readonly transcriptionBudget: number;
  private synthesisUsed = 0;
  private transcriptionUsed = 0;
  private readonly cache: LruCache<SynthesisResult>;
  private readonly pending = new Map<string, Promise<SynthesisResult>>();
  private readonly slots: Semaphore;
  constructor(private readonly options: VoiceServiceOptions) {
    this.synthesisBudget = options.synthesisBudget ?? envInt("ARGOS_VOICE_BUDGET", 300);
    this.transcriptionBudget = options.transcriptionBudget ?? envInt("ARGOS_VOICE_STT_BUDGET", 100);
    this.cache = new LruCache(options.cacheEntries ?? 160, options.cacheBytes ?? 64 * 1024 * 1024);
    this.slots = new Semaphore(Math.max(1, Math.min(options.maxConcurrent ?? 3, 3)), options.maxQueued ?? 12);
  }
  usage() {
    return { synthesis: { used: this.synthesisUsed, budget: this.synthesisBudget, remaining: Math.max(0, this.synthesisBudget - this.synthesisUsed) },
      transcription: { used: this.transcriptionUsed, budget: this.transcriptionBudget, remaining: Math.max(0, this.transcriptionBudget - this.transcriptionUsed) },
      cache: { entries: this.cache.size, bytes: this.cache.totalBytes }, inFlight: this.slots.inFlight };
  }

  async speak(request: { text: string; voice: string; style: string; signal?: AbortSignal }): Promise<SpeakResult> {
    const key = voiceCacheKey(request.voice, request.style, request.text);
    const hit = this.cache.get(key);
    if (hit) return { ...hit, cached: true };
    const shared = this.pending.get(key);
    if (shared) return { ...(await shared), cached: true };
    if (this.synthesisUsed >= this.synthesisBudget) throw new VoiceError(`This session's voice budget (${this.synthesisBudget} lines) is spent`, 429);
    // Reserve before queueing so concurrent callers cannot overspend; a failed
    // or cancelled call (no audio produced) releases its reservation.
    this.synthesisUsed++;
    const work = this.slots.run(() => this.options.client.synthesize({ text: request.text, voiceName: request.voice, style: request.style }), request.signal)
      .catch(error => { this.synthesisUsed--; throw error; });
    this.pending.set(key, work);
    try {
      const result = await work;
      this.cache.set(key, result);
      return { ...result, cached: false };
    } finally { this.pending.delete(key); }
  }

  async transcribe(request: { audio: Buffer; mimeType: string; signal?: AbortSignal }): Promise<string> {
    if (this.transcriptionUsed >= this.transcriptionBudget) throw new VoiceError(`This session's transcription budget (${this.transcriptionBudget}) is spent`, 429);
    this.transcriptionUsed++;
    try { return await this.slots.run(() => this.options.client.transcribe(request), request.signal); }
    catch (error) { this.transcriptionUsed--; throw error; }
  }
}
