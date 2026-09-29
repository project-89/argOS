/** /api/voice/* on the spatial server: speak (audio/wav), transcribe ({ text })
 * and the session's voice cast. Read-only with respect to the world. */
import express from "express";
import { timingSafeEqual } from "node:crypto";
import { hasComponent } from "bitecs";
import { z } from "zod";
import { Agent, Appearance, Name } from "../ecs/components";
import type { UtteranceVoiceGate } from "../cognition/timed-speech";
import { readAttention } from "../runtime/attention";
import { GOD_VOICE, VoiceCastBook, type PersonaInput, type VoiceCast } from "./casting";
import { createGeminiVoiceClient, parseWav, VOICE_LIMITS, VOICE_MODELS, VoiceError, type VoiceClient } from "./gemini-voice";
import { VoiceService, type SpeakResult } from "./voice-service";

/** The read-only slice of SpatialDemo the voice module uses. */
export type VoiceDemoView = {
  readonly actors: readonly number[];
  readonly visuals: ReadonlyMap<number, { key: string }>;
  readonly sim: { readonly world: any };
  snapshot?: () => { scenario?: { theme?: string; title?: string } };
  /** Script of an utterance the operator's body can hear right now (earshot-gated). */
  audibleUtterance?: (executionId: string) => { text: string; speakerKey: string } | undefined;
  /** Called when a line starts within the body's earshot, so its voice can be rendered early. */
  onUtteranceInEarshot?: (executionId: string, speakerKey: string) => void;
  /** Present when the demo lets voice hold a presence speaker's first word until its audio is ready. */
  setUtteranceVoiceGate?: (gate: UtteranceVoiceGate | undefined) => void;
};

export type VoiceRouteOptions = {
  demo: VoiceDemoView;
  /** Session bearer token; checked again here so the routes are safe wherever mounted. */
  token?: string;
  /** Defaults to process.env.GOOGLE_GENERATIVE_AI_API_KEY. */
  apiKey?: string;
  client?: VoiceClient;
  service?: VoiceService;
  /** Place/accent cue for resident styles; derived from the scenario when omitted. */
  setting?: string;
};

/** How long after a client last asked for line audio the server keeps rendering ahead. */
export const LISTENING_WINDOW_MS = 20_000;
export const VOICE_AUDIO_FORMAT = { mimeType: "audio/wav", encoding: "pcm_s16le", sampleRate: 24_000, channels: 1, bitsPerSample: 16 } as const;

const TRANSCRIBE_TYPES: Record<string, string> = {
  "audio/webm": "audio/webm", "video/webm": "audio/webm", "audio/ogg": "audio/ogg", "audio/wav": "audio/wav", "audio/x-wav": "audio/wav",
  "audio/wave": "audio/wav", "audio/mpeg": "audio/mpeg", "audio/mp3": "audio/mpeg", "audio/mp4": "audio/mp4", "audio/aac": "audio/aac",
  "audio/flac": "audio/flac", "audio/x-flac": "audio/flac", "audio/aiff": "audio/aiff", "audio/x-aiff": "audio/aiff",
};

/** Persona from a resident's native prompt: role, the public-facing head of
 * the prompt, and its "HOW YOU TALK" notes. Private history is not read. */
export function personaFromPrompt(input: { key: string; name: string; role?: string; systemPrompt?: string; age?: string; setting?: string }): PersonaInput {
  const prompt = input.systemPrompt ?? "";
  const head = prompt.split(/\n(?:PRIVATE LIFE BEFORE THIS SCENE|HOW YOU TALK|WHAT YOU HIDE):/)[0].trim();
  const voiceNotes = /\nHOW YOU TALK: ([^\n]+)/.exec(prompt)?.[1]?.trim();
  return { key: input.key, name: input.name, role: input.role, personality: head, voiceNotes, age: input.age, setting: input.setting };
}

export function settingForDemo(demo: VoiceDemoView): string | undefined {
  try { return demo.snapshot?.().scenario?.theme === "lovecraft" ? "Saltmere, a small English coastal town" : undefined; }
  catch { return undefined; }
}

const speakBody = z.object({
  text: z.string().trim().min(1).max(VOICE_LIMITS.maxLineChars).refine(s => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(s)),
  speakerKey: z.string().min(1).max(180).optional(),
  voice: z.literal("god").optional(),
}).strict().refine(b => !!b.speakerKey !== !!b.voice, "Give exactly one of speakerKey or voice:\"god\"");

function fail(res: any, error: unknown) {
  if (res.headersSent) return void res.end();
  if (error instanceof VoiceError) {
    if (error.retryAfterSeconds) res.setHeader("Retry-After", String(error.retryAfterSeconds));
    return void res.status(error.status === 499 ? 499 : error.status).json({ error: error.message,
      ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}) });
  }
  if (error instanceof z.ZodError) return void res.status(400).json({ error: error.issues[0]?.message && error.issues[0].code === "custom" ? error.issues[0].message : "Invalid request" });
  console.error("[Voice] Unexpected failure", error instanceof Error ? error.message : error);
  res.status(500).json({ error: "Voice failed" });
}

/** The timed-speech gate for a listening client: audio duration for presence
 * speakers the controlled body can hear, undefined (ungated) otherwise. */
export function voiceGateFor(demo: VoiceDemoView, listening: () => boolean,
  render: (executionId: string, text: string, speakerKey: string) => Promise<SpeakResult> | undefined): UtteranceVoiceGate {
  return (speakerEid, executionId, text) => {
    if (!listening() || readAttention(demo.sim.world, speakerEid).tier !== "presence") return undefined;
    const speakerKey = demo.visuals.get(speakerEid)?.key;
    if (!speakerKey || demo.audibleUtterance?.(executionId)?.speakerKey !== speakerKey) return undefined;
    return render(executionId, text, speakerKey)?.then(audio => ({ durationMs: audio.durationMs }), () => undefined);
  };
}

export function mountVoiceRoutes(app: Pick<express.Express, "get" | "post">, options: VoiceRouteOptions) {
  const apiKey = options.apiKey ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? "";
  const service = options.service ?? (options.client || apiKey
    ? new VoiceService({ client: options.client ?? createGeminiVoiceClient({ apiKey }) }) : undefined);
  const book = new VoiceCastBook();
  let setting: string | undefined | null = options.setting ?? null;
  const { demo } = options;

  const residents = () => {
    const world = demo.sim.world, ids = new Set<number>(demo.actors);
    // Bodies spawned later (visitors) appear in visuals, not the original actor list.
    for (const id of demo.visuals.keys()) if (hasComponent(world, id, Agent)) ids.add(id);
    if (setting === null) setting = settingForDemo(demo);
    return [...ids].flatMap(id => {
      const key = demo.visuals.get(id)?.key;
      if (!key || !hasComponent(world, id, Agent) || !Agent.active[id]) return [];
      return [personaFromPrompt({ key, name: Name.value[id] ?? key, role: Agent.role[id], systemPrompt: Agent.systemPrompt[id],
        age: Appearance.age?.[id], setting: setting ?? undefined })];
    });
  };
  const castFor = (key: string): VoiceCast | undefined => {
    if (book.get(key)) return book.get(key);
    book.ensure(residents());
    return book.get(key);
  };

  const guard = (req: any, res: any, next: any) => {
    if (options.token) {
      const supplied = Buffer.from(String(req.headers.authorization ?? "")), expected = Buffer.from(`Bearer ${options.token}`);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return res.status(403).json({ error: "Open the full private session link, including its #token." });
    }
    next();
  };
  const enabled = (_req: any, res: any, next: any) => service ? next()
    : res.status(503).json({ error: "Voice is not configured on this server: set GOOGLE_GENERATIVE_AI_API_KEY and restart." });
  const abortOnClose = (res: any) => {
    const controller = new AbortController();
    res.on("close", () => { if (!res.writableFinished) controller.abort(); });
    return controller.signal;
  };
  const json = express.json({ limit: "8kb", strict: true });
  const raw = express.raw({ type: () => true, limit: VOICE_LIMITS.maxAudioBytes });
  const audioBody = (req: any, res: any, next: any) => raw(req, res, (error?: any) => error
    ? res.status(error.status === 413 ? 413 : 400).json({ error: error.status === 413 ? "Audio too large (max 8 MB, 60 s)" : "Unreadable audio body" }) : next());

  app.get("/api/voice/cast", guard, (_req: any, res: any) => {
    try {
      book.ensure(residents());
      const names = new Map(residents().map(p => [p.key, p.name]));
      const voices = Object.fromEntries(Object.entries(book.entries()).map(([key, cast]) => [key, { ...cast, name: names.get(key) }]));
      res.json({ enabled: !!service, models: VOICE_MODELS, format: VOICE_AUDIO_FORMAT, voices, god: GOD_VOICE, ...(service ? { usage: service.usage() } : {}) });
    } catch (error) { fail(res, error); }
  });

  app.post("/api/voice/speak", guard, enabled, json, async (req: any, res: any) => {
    try {
      const body = speakBody.parse(req.body);
      const cast = body.voice === "god" ? GOD_VOICE : castFor(body.speakerKey!);
      if (!cast) return void res.status(404).json({ error: "No resident with that speakerKey is present" });
      const started = Date.now();
      const result = await service!.speak({ text: body.text, voice: cast.voice, style: cast.style, signal: abortOnClose(res) });
      const usage = service!.usage();
      res.status(200).set({ "Content-Type": "audio/wav", "Content-Length": String(result.wav.length), "X-Voice": cast.voice,
        "X-Voice-Cache": result.cached ? "hit" : "miss", "X-Voice-Budget-Remaining": String(usage.synthesis.remaining),
        "X-Audio-Duration-Ms": String(result.durationMs), "X-Audio-Sample-Rate": String(result.sampleRate), "X-Voice-Latency-Ms": String(Date.now() - started) })
        .end(result.wav);
    } catch (error) { fail(res, error); }
  });

  // Lines within earshot start synthesizing as they begin; the client's request
  // joins that work, so a listener hears a line as it is spoken, not after.
  const inFlight = new Map<string, Promise<SpeakResult>>();
  // In-world lines use the (faster) dialogue model; God and interviews use /speak.
  const render = (executionId: string, text?: string, speakerKey?: string) => {
    const existing = inFlight.get(executionId); if (existing) return existing;
    const line = text !== undefined && speakerKey !== undefined ? { text, speakerKey } : demo.audibleUtterance?.(executionId);
    const cast = line && castFor(line.speakerKey);
    if (!line || !cast || !service) return undefined;
    const job = service.speak({ text: line.text.slice(0, VOICE_LIMITS.maxLineChars), voice: cast.voice, style: cast.style, model: VOICE_MODELS.dialogue });
    inFlight.set(executionId, job);
    job.catch(() => {}).finally(() => setTimeout(() => inFlight.delete(executionId), 60_000).unref?.());
    while (inFlight.size > 48) inFlight.delete(inFlight.keys().next().value!);
    return job;
  };
  // Render ahead only while someone is actually listening (a client asked for line
  // audio recently); Watch mode, a muted tab or a closed one spends nothing.
  let listeningUntil = 0;
  if (service && demo.audibleUtterance) {
    (demo as { onUtteranceInEarshot?: (id: string, key: string) => void }).onUtteranceInEarshot = id => {
      if (Date.now() < listeningUntil) void render(id)?.catch(() => {});
    };
    // Voice and speech together: while someone is listening, a resident in the
    // observer's presence draws breath until their line's audio is ready (timed
    // speech caps the wait), so the viewer can play it as the words begin. The
    // observer's own body and lines the body cannot hear are never held.
    demo.setUtteranceVoiceGate?.(voiceGateFor(demo, () => Date.now() < listeningUntil, render));
  }
  app.post("/api/voice/utterance", guard, enabled, json, async (req: any, res: any) => {
    try {
      const executionId = typeof req.body?.executionId === "string" ? req.body.executionId.slice(0, 200) : "";
      listeningUntil = Date.now() + LISTENING_WINDOW_MS;
      const job = executionId ? render(executionId) : undefined;
      if (!job) return void res.status(403).json({ error: "That line is not within earshot of your body" });
      const result = await job;
      res.status(200).set({ "Content-Type": "audio/wav", "Content-Length": String(result.wav.length),
        "X-Audio-Duration-Ms": String(result.durationMs), "X-Audio-Sample-Rate": String(result.sampleRate) }).end(result.wav);
    } catch (error) { fail(res, error); }
  });

  app.post("/api/voice/transcribe", guard, enabled, audioBody, async (req: any, res: any) => {
    try {
      const declared = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      const mimeType = TRANSCRIBE_TYPES[declared];
      if (!mimeType) return void res.status(415).json({ error: "Send audio/webm, audio/ogg, audio/wav, audio/mp4 or audio/mpeg" });
      const audio: unknown = req.body;
      if (!Buffer.isBuffer(audio) || !audio.length) return void res.status(400).json({ error: "Empty audio" });
      if (mimeType === "audio/wav") {
        const wav = parseWav(audio);
        if (!wav) return void res.status(400).json({ error: "Unreadable WAV" });
        if (wav.durationMs > VOICE_LIMITS.maxAudioSeconds * 1000) return void res.status(413).json({ error: "Audio longer than 60 s" });
      }
      res.json({ text: await service!.transcribe({ audio, mimeType, signal: abortOnClose(res) }) });
    } catch (error) { fail(res, error); }
  });

  return { service, cast: book };
}
