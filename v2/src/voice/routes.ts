/** /api/voice/* on the spatial server: speak (audio/wav), transcribe ({ text })
 * and the session's voice cast. Read-only with respect to the world. */
import express from "express";
import { timingSafeEqual } from "node:crypto";
import { hasComponent } from "bitecs";
import { z } from "zod";
import { Agent, Appearance, Name } from "../ecs/components";
import { GOD_VOICE, VoiceCastBook, type PersonaInput, type VoiceCast } from "./casting";
import { createGeminiVoiceClient, parseWav, VOICE_LIMITS, VOICE_MODELS, VoiceError, type VoiceClient } from "./gemini-voice";
import { VoiceService } from "./voice-service";

/** The read-only slice of SpatialDemo the voice module uses. */
export type VoiceDemoView = {
  readonly actors: readonly number[];
  readonly visuals: ReadonlyMap<number, { key: string }>;
  readonly sim: { readonly world: any };
  snapshot?: () => { scenario?: { theme?: string; title?: string } };
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
