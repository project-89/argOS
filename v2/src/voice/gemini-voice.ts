/** Gemini speech: text-to-speech (Gemini 3.8 Flash TTS) and speech-to-text
 * (Gemini 3.8 Flash audio understanding). REST only, no SDK dependency.
 * The API key is sent as a header and never appears in errors or logs. */
import { googleProviderFetch } from "../llm/google-transport";

export const VOICE_MODELS = {
  /** Found via ListModels 2026-09-28: models/gemini-3.8-flash-tts (generateContent + Interactions). */
  tts: process.env.ARGOS_TTS_MODEL || "gemini-3.8-flash-tts",
  /** Audio understanding through generateContent; 3.8 transcribe/live models are bidi-only. */
  stt: process.env.ARGOS_STT_MODEL || "gemini-3.8-flash",
};

export const VOICE_LIMITS = {
  maxLineChars: 600,
  maxStyleChars: 400,
  maxAudioBytes: 8 * 1024 * 1024,
  maxAudioSeconds: 60,
  synthTimeoutMs: 45_000,
  transcribeTimeoutMs: 45_000,
  maxResponseBytes: 24 * 1024 * 1024,
};

const API = "https://generativelanguage.googleapis.com/v1beta";

/** A failure the HTTP layer can map: `status` is the status to return to our client. */
export class VoiceError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfterSeconds?: number) { super(message); this.name = "VoiceError"; }
}

export type SynthesisRequest = { text: string; voiceName: string; style?: string; signal?: AbortSignal };
export type SynthesisResult = { wav: Buffer; sampleRate: number; channels: number; durationMs: number };
export type TranscriptionRequest = { audio: Buffer; mimeType: string; signal?: AbortSignal };
export interface VoiceClient {
  synthesize(request: SynthesisRequest): Promise<SynthesisResult>;
  transcribe(request: TranscriptionRequest): Promise<string>;
}

// ---------------------------------------------------------------- WAV / PCM

/** Wrap signed 16-bit little-endian PCM in a canonical 44-byte RIFF/WAVE header. */
export function pcmToWav(pcm: Buffer, sampleRate = 24_000, channels = 1, bitsPerSample = 16): Buffer {
  const blockAlign = channels * bitsPerSample / 8, header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii"); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii"); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22); header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32); header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii"); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export type WavInfo = { sampleRate: number; channels: number; bitsPerSample: number; format: number; pcm: Buffer; durationMs: number };
/** Parse a RIFF/WAVE buffer (tolerates streaming-style 0/0xFFFFFFFF sizes). Returns undefined if not WAV. */
export function parseWav(buffer: Buffer): WavInfo | undefined {
  if (buffer.length < 12 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") return undefined;
  let offset = 12, fmt: Omit<WavInfo, "pcm" | "durationMs"> | undefined;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4), size = buffer.readUInt32LE(offset + 4), body = offset + 8;
    if (id === "fmt " && body + 16 <= buffer.length) fmt = { format: buffer.readUInt16LE(body), channels: buffer.readUInt16LE(body + 2),
      sampleRate: buffer.readUInt32LE(body + 4), bitsPerSample: buffer.readUInt16LE(body + 14) };
    else if (id === "data") {
      if (!fmt) return undefined;
      const end = size === 0 || size === 0xffffffff || body + size > buffer.length ? buffer.length : body + size;
      const pcm = buffer.subarray(body, end), bytesPerSecond = fmt.sampleRate * fmt.channels * fmt.bitsPerSample / 8;
      return { ...fmt, pcm, durationMs: bytesPerSecond ? Math.round(pcm.length / bytesPerSecond * 1000) : 0 };
    }
    offset = body + size + (size % 2);
  }
  return undefined;
}

/** `audio/L16;codec=pcm;rate=24000` → PCM at 24 kHz; `audio/wav` → WAV. */
export function describeAudioMime(mime: string): { kind: "wav" | "pcm" | "other"; sampleRate?: number; channels?: number } {
  const [base, ...params] = mime.toLowerCase().split(";").map(s => s.trim());
  const param = (name: string) => params.find(p => p.startsWith(`${name}=`))?.slice(name.length + 1);
  if (["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"].includes(base)) return { kind: "wav" };
  if (base === "audio/l16" || base === "audio/pcm" || param("codec") === "pcm")
    return { kind: "pcm", sampleRate: Number(param("rate")) || 24_000, channels: Number(param("channels")) || 1 };
  return { kind: "other" };
}

/** Normalise provider audio to a clean 16-bit PCM WAV. */
export function toWav(bytes: Buffer, mimeType: string): SynthesisResult {
  const described = describeAudioMime(mimeType), wav = parseWav(bytes);
  if (wav) {
    if (wav.format !== 1 || wav.bitsPerSample !== 16) throw new VoiceError(`Unsupported voice audio encoding (format ${wav.format}, ${wav.bitsPerSample}-bit)`, 502);
    return { wav: pcmToWav(wav.pcm, wav.sampleRate, wav.channels), sampleRate: wav.sampleRate, channels: wav.channels, durationMs: wav.durationMs };
  }
  if (described.kind === "pcm") {
    const sampleRate = described.sampleRate!, channels = described.channels!, pcm = bytes.subarray(0, bytes.length - bytes.length % (2 * channels));
    return { wav: pcmToWav(pcm, sampleRate, channels), sampleRate, channels, durationMs: Math.round(pcm.length / (sampleRate * channels * 2) * 1000) };
  }
  throw new VoiceError(`Unsupported voice audio format ${mimeType.slice(0, 60)}`, 502);
}

// ---------------------------------------------------------------- provider

type Fetch = typeof globalThis.fetch;
export type GeminiVoiceOptions = { apiKey: string; fetch?: Fetch; ttsModel?: string; sttModel?: string; synthTimeoutMs?: number; transcribeTimeoutMs?: number };

function retryAfter(response: Response, body: string): number | undefined {
  const header = Number(response.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return Math.ceil(header);
  const delay = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body)?.[1];
  return delay ? Math.ceil(Number(delay)) : undefined;
}

function providerMessage(body: string): string {
  try { const message = JSON.parse(body)?.error?.message; if (typeof message === "string") return message.replace(/key=[\w-]+/g, "key=…").slice(0, 200); } catch { /* not JSON */ }
  return "";
}

async function readCapped(response: Response, cap: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (declared > cap) throw new VoiceError("Voice provider response too large", 502);
  const text = await response.text();
  if (text.length > cap) throw new VoiceError("Voice provider response too large", 502);
  return text;
}

/** Collect every audio payload in either an Interactions or a generateContent response. */
export function findAudioPayloads(value: unknown, out: Array<{ data: string; mimeType: string }> = []) {
  if (Array.isArray(value)) { for (const item of value) findAudioPayloads(item, out); return out; }
  if (!value || typeof value !== "object") return out;
  const record = value as Record<string, unknown>;
  const inline = (record.inlineData ?? record.inline_data) as Record<string, unknown> | undefined;
  if (inline && typeof inline.data === "string") {
    const mime = String(inline.mimeType ?? inline.mime_type ?? "");
    if (mime.startsWith("audio/")) out.push({ data: inline.data, mimeType: mime });
    return out;
  }
  if (record.type === "audio" && typeof record.data === "string") {
    out.push({ data: record.data, mimeType: String(record.mime_type ?? record.mimeType ?? "audio/wav") }); return out;
  }
  for (const child of Object.values(record)) if (child && typeof child === "object") findAudioPayloads(child, out);
  return out;
}

export function createGeminiVoiceClient(options: GeminiVoiceOptions): VoiceClient {
  if (!options.apiKey) throw new Error("A Gemini API key is required for voice");
  const fetcher = options.fetch ?? googleProviderFetch;
  const ttsModel = options.ttsModel ?? VOICE_MODELS.tts, sttModel = options.sttModel ?? VOICE_MODELS.stt;

  async function post(path: string, payload: unknown, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
    const timeout = AbortSignal.timeout(timeoutMs), combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await fetcher(`${API}/${path}`, { method: "POST", signal: combined,
        headers: { "content-type": "application/json", "x-goog-api-key": options.apiKey }, body: JSON.stringify(payload) });
    } catch (error) {
      if (signal?.aborted) throw new VoiceError("Voice request cancelled", 499);
      if (timeout.aborted) throw new VoiceError("Voice provider timed out", 504, 5);
      throw new VoiceError(`Voice provider unreachable${error instanceof Error ? `: ${error.message.slice(0, 120)}` : ""}`, 502, 5);
    }
    const body = await readCapped(response, VOICE_LIMITS.maxResponseBytes);
    if (response.status === 429) throw new VoiceError(`Voice provider rate limit${providerMessage(body) ? `: ${providerMessage(body)}` : ""}`, 429, retryAfter(response, body) ?? 20);
    if (response.status >= 500) throw new VoiceError(`Voice provider error ${response.status}`, 502, retryAfter(response, body) ?? 5);
    if (!response.ok) throw new VoiceError(`Voice provider rejected the request (${response.status})${providerMessage(body) ? `: ${providerMessage(body)}` : ""}`, 502);
    try { return JSON.parse(body); } catch { throw new VoiceError("Voice provider returned malformed JSON", 502); }
  }

  return {
    async synthesize({ text, voiceName, style, signal }) {
      const line = text.trim();
      if (!line || line.length > VOICE_LIMITS.maxLineChars) throw new VoiceError(`A spoken line must have 1–${VOICE_LIMITS.maxLineChars} characters`, 400);
      if (!/^[A-Za-z]{2,32}$/.test(voiceName)) throw new VoiceError("Invalid voice name", 400);
      const direction = style?.trim().slice(0, VOICE_LIMITS.maxStyleChars);
      // Gemini 3.8 TTS treats text as a verbatim transcript; delivery goes in
      // speech_metadata.style. store:false keeps lines out of server-side history.
      const json = await post("interactions", {
        model: ttsModel, store: false,
        input: [{ type: "user_input", content: [{ type: "text", text: line,
          ...(direction ? { annotations: [{ type: "speech_metadata", style: direction }] } : {}) }] }],
        response_format: { type: "audio", mime_type: "audio/wav" },
        generation_config: { speech_config: [{ voice: voiceName }] },
      }, options.synthTimeoutMs ?? VOICE_LIMITS.synthTimeoutMs, signal);
      const audio = findAudioPayloads(json).at(-1);
      if (!audio) throw new VoiceError("Voice provider returned no audio", 502, 2);
      return toWav(Buffer.from(audio.data, "base64"), audio.mimeType);
    },
    async transcribe({ audio, mimeType, signal }) {
      if (!audio.length) throw new VoiceError("Empty audio", 400);
      if (audio.length > VOICE_LIMITS.maxAudioBytes) throw new VoiceError("Audio too large (max 8 MB)", 413);
      const json = await post(`models/${encodeURIComponent(sttModel)}:generateContent`, {
        contents: [{ role: "user", parts: [
          { inlineData: { mimeType, data: audio.toString("base64") } },
          { text: "Transcribe this recording verbatim. Return only the words spoken, with normal punctuation and no commentary, labels, quotes or timestamps. If nothing intelligible is spoken, return an empty response." },
        ] }],
        generationConfig: { thinkingConfig: { thinkingLevel: "low" }, maxOutputTokens: 2048 },
      }, options.transcribeTimeoutMs ?? VOICE_LIMITS.transcribeTimeoutMs, signal) as any;
      const candidate = json?.candidates?.[0];
      if (!candidate && json?.promptFeedback?.blockReason) throw new VoiceError(`Transcription blocked (${json.promptFeedback.blockReason})`, 422);
      const parts: any[] = candidate?.content?.parts ?? [];
      return parts.filter(p => typeof p?.text === "string" && !p.thought).map(p => p.text).join("").trim();
    },
  };
}
