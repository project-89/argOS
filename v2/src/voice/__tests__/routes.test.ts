import express from "express";
import type { Server } from "node:http";
import { parseWav, pcmToWav, VoiceError } from "../gemini-voice";
import { GOD_VOICE } from "../casting";
import { mountVoiceRoutes, type VoiceRouteOptions } from "../routes";
import { VoiceService } from "../voice-service";
import { fakeClient, saltmereDemo, tone } from "./fixtures";

const token = "a".repeat(48);
const servers: Server[] = [];
afterEach(async () => { for (const s of servers.splice(0)) { s.closeAllConnections(); await new Promise(r => s.close(r)); } });

async function serve(options: Partial<VoiceRouteOptions> = {}) {
  const app = express();
  const mounted = mountVoiceRoutes(app, { demo: saltmereDemo(), token, apiKey: "", ...options });
  const server = app.listen(0, "127.0.0.1"); servers.push(server);
  await new Promise<void>(r => server.once("listening", () => r()));
  const { port } = server.address() as { port: number };
  const call = (path: string, init: { method?: string; body?: unknown; raw?: Buffer; type?: string; auth?: boolean } = {}) =>
    fetch(`http://127.0.0.1:${port}${path}`, { method: init.method ?? (init.body || init.raw ? "POST" : "GET"),
      headers: { ...(init.auth === false ? {} : { authorization: `Bearer ${token}` }),
        ...(init.body ? { "content-type": "application/json" } : init.raw ? { "content-type": init.type ?? "audio/wav" } : {}) },
      body: init.raw ?? (init.body ? JSON.stringify(init.body) : undefined) }) as Promise<Omit<Response, "json"> & { json(): Promise<any> }>;
  return { call, mounted };
}

test("every voice route requires the session bearer token", async () => {
  const { call } = await serve({ client: fakeClient().client });
  for (const [path, init] of [["/api/voice/cast", {}], ["/api/voice/speak", { body: { text: "hi", voice: "god" } }], ["/api/voice/transcribe", { raw: pcmToWav(tone(10)) }]] as const) {
    const res = await call(path, { ...init, auth: false });
    expect(res.status).toBe(403);
  }
});

test("without a Gemini key speech and transcription answer 503; the cast still lists voices", async () => {
  const { call } = await serve();
  const speak = await call("/api/voice/speak", { body: { text: "hi", voice: "god" } });
  expect(speak.status).toBe(503); expect((await speak.json()).error).toMatch(/GOOGLE_GENERATIVE_AI_API_KEY/);
  expect((await call("/api/voice/transcribe", { raw: pcmToWav(tone(10)) })).status).toBe(503);
  const cast = await (await call("/api/voice/cast")).json();
  expect(cast.enabled).toBe(false);
  expect(Object.keys(cast.voices)).toHaveLength(10);
  expect(cast.god).toEqual(GOD_VOICE);
  expect(cast.format).toMatchObject({ mimeType: "audio/wav", sampleRate: 24_000, channels: 1 });
});

test("speak resolves residents by actor key and God by voice:'god', returning WAV with metadata headers", async () => {
  const { client, calls } = fakeClient();
  const { call } = await serve({ client });
  const cast = await (await call("/api/voice/cast")).json();
  expect(cast.voices["actor:leon"]).toMatchObject({ name: "Leon", voice: expect.any(String) });
  const res = await call("/api/voice/speak", { body: { text: "The sea takes what it's given.", speakerKey: "actor:leon" } });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("audio/wav");
  expect(res.headers.get("x-voice")).toBe(cast.voices["actor:leon"].voice);
  expect(res.headers.get("x-voice-cache")).toBe("miss");
  expect(parseWav(Buffer.from(await res.arrayBuffer()))).toMatchObject({ sampleRate: 24_000, durationMs: 100 });
  expect(calls.synthesize[0]).toMatchObject({ voiceName: cast.voices["actor:leon"].voice, style: expect.stringContaining("lyrical") });
  const again = await call("/api/voice/speak", { body: { text: "The sea takes what it's given.", speakerKey: "actor:leon" } });
  expect(again.headers.get("x-voice-cache")).toBe("hit");
  const god = await call("/api/voice/speak", { body: { text: "Hello, little world.", voice: "god" } });
  expect(god.status).toBe(200); expect(god.headers.get("x-voice")).toBe(GOD_VOICE.voice);
  expect(calls.synthesize).toHaveLength(2);
});

test("bad bodies, unknown speakers and provider failures map to clear errors", async () => {
  let mode: "ok" | "429" | "502" | "crash" = "429";
  const { client } = fakeClient({ synthesize: async () => {
    if (mode === "429") throw new VoiceError("Voice provider rate limit", 429, 12);
    if (mode === "502") throw new VoiceError("Voice provider error 503", 502, 5);
    throw new Error("boom");
  } });
  const { call } = await serve({ client });
  expect((await call("/api/voice/speak", { body: { text: "" , voice: "god" } })).status).toBe(400);
  expect((await call("/api/voice/speak", { body: { text: "x".repeat(601), voice: "god" } })).status).toBe(400);
  expect((await call("/api/voice/speak", { body: { text: "hi" } })).status).toBe(400);
  expect((await call("/api/voice/speak", { body: { text: "hi", voice: "god", speakerKey: "actor:leon" } })).status).toBe(400);
  expect((await call("/api/voice/speak", { body: { text: "hi", voice: "god", extra: 1 } })).status).toBe(400);
  expect((await call("/api/voice/speak", { body: { text: "hi", speakerKey: "actor:nobody" } })).status).toBe(404);
  const limited = await call("/api/voice/speak", { body: { text: "hi", voice: "god" } });
  expect(limited.status).toBe(429); expect(limited.headers.get("retry-after")).toBe("12");
  expect(await limited.json()).toEqual({ error: "Voice provider rate limit", retryAfterSeconds: 12 });
  mode = "502";
  const down = await call("/api/voice/speak", { body: { text: "hi", voice: "god" } });
  expect(down.status).toBe(502); expect((await down.json()).retryAfterSeconds).toBe(5);
  mode = "crash";
  const crash = await call("/api/voice/speak", { body: { text: "hi", voice: "god" } });
  expect(crash.status).toBe(500); expect(await crash.json()).toEqual({ error: "Voice failed" });
});

test("budget exhaustion is a 429 while cached lines keep playing", async () => {
  const { client } = fakeClient();
  const { call } = await serve({ service: new VoiceService({ client, synthesisBudget: 1 }) });
  expect((await call("/api/voice/speak", { body: { text: "one", voice: "god" } })).status).toBe(200);
  const spent = await call("/api/voice/speak", { body: { text: "two", voice: "god" } });
  expect(spent.status).toBe(429); expect((await spent.json()).error).toMatch(/budget/);
  expect((await call("/api/voice/speak", { body: { text: "one", voice: "god" } })).status).toBe(200);
});

test("transcribe accepts raw audio, checks type, WAV length and size", async () => {
  const { client, calls } = fakeClient();
  const { call } = await serve({ client });
  const ok = await call("/api/voice/transcribe", { raw: pcmToWav(tone(200)) });
  expect(ok.status).toBe(200); expect(await ok.json()).toEqual({ text: "the sea takes what it's given" });
  expect((await call("/api/voice/transcribe", { raw: Buffer.from([1, 2, 3]), type: "audio/webm;codecs=opus" })).status).toBe(200);
  expect((await call("/api/voice/transcribe", { raw: Buffer.from("hello"), type: "text/plain" })).status).toBe(415);
  expect((await call("/api/voice/transcribe", { raw: Buffer.from("not a wav") })).status).toBe(400);
  expect((await call("/api/voice/transcribe", { raw: pcmToWav(tone(61_000, 8_000), 8_000) })).status).toBe(413);
  expect((await call("/api/voice/transcribe", { raw: Buffer.alloc(8 * 1024 * 1024 + 1), type: "audio/webm" })).status).toBe(413);
  expect(calls.transcribe).toBe(2);
});
