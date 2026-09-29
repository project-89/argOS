import { pcmToWav, VoiceError, type SynthesisResult } from "../gemini-voice";
import { LruCache, VoiceService, voiceCacheKey } from "../voice-service";
import { fakeClient, tone } from "./fixtures";

test("identical lines are served from cache without spending budget", async () => {
  const { client, calls } = fakeClient(), service = new VoiceService({ client, synthesisBudget: 5 });
  const a = await service.speak({ text: "Hello, love.", voice: "Kore", style: "brisk" });
  const b = await service.speak({ text: "  Hello, love. ", voice: "Kore", style: "brisk" });
  expect(a.cached).toBe(false); expect(b.cached).toBe(true);
  expect(calls.synthesize).toHaveLength(1);
  await service.speak({ text: "Hello, love.", voice: "Kore", style: "softer" }); // style is part of the key
  expect(calls.synthesize).toHaveLength(2);
  expect(service.usage().synthesis).toEqual({ used: 2, budget: 5, remaining: 3 });
  expect(voiceCacheKey("Kore", "s", "hi")).not.toBe(voiceCacheKey("Puck", "s", "hi"));
});

test("the model is part of the cache key and reaches the client only when chosen", async () => {
  const { client, calls } = fakeClient(), service = new VoiceService({ client });
  await service.speak({ text: "Hello, love.", voice: "Kore", style: "brisk", model: "gemini-3.8-flash-lite-tts" });
  expect((await service.speak({ text: "Hello, love.", voice: "Kore", style: "brisk" })).cached).toBe(false);
  expect(calls.synthesize.map(c => c.model)).toEqual(["gemini-3.8-flash-lite-tts", undefined]);
  expect(voiceCacheKey("Kore", "s", "hi", "m")).not.toBe(voiceCacheKey("Kore", "s", "hi"));
});

test("the session budget refuses new lines once spent but keeps cached ones; failures are refunded", async () => {
  let fail = true;
  const { client } = fakeClient({ synthesize: async () => { if (fail) throw new VoiceError("rate", 429, 3); return { wav: pcmToWav(tone(10)), sampleRate: 24_000, channels: 1, durationMs: 10 }; } });
  const service = new VoiceService({ client, synthesisBudget: 2 });
  await expect(service.speak({ text: "one", voice: "Kore", style: "" })).rejects.toMatchObject({ status: 429, retryAfterSeconds: 3 });
  expect(service.usage().synthesis.used).toBe(0);
  fail = false;
  await service.speak({ text: "one", voice: "Kore", style: "" });
  await service.speak({ text: "two", voice: "Kore", style: "" });
  await expect(service.speak({ text: "three", voice: "Kore", style: "" })).rejects.toMatchObject({ status: 429 });
  expect((await service.speak({ text: "one", voice: "Kore", style: "" })).cached).toBe(true);
});

test("at most three syntheses are in flight; concurrent identical lines share one call", async () => {
  let active = 0, peak = 0;
  const release: Array<() => void> = [];
  const { client, calls } = fakeClient();
  const slow = { ...client, synthesize: async (request: Parameters<typeof client.synthesize>[0]) => {
    active++; peak = Math.max(peak, active);
    await new Promise<void>(resolve => release.push(resolve));
    active--; return client.synthesize(request);
  } };
  const service = new VoiceService({ client: slow, synthesisBudget: 50, maxConcurrent: 3 });
  const lines = Array.from({ length: 6 }, (_, i) => service.speak({ text: `line ${i}`, voice: "Kore", style: "" }));
  const duplicate = service.speak({ text: "line 0", voice: "Kore", style: "" });
  while (release.length < 3) await new Promise(r => setImmediate(r));
  expect(active).toBe(3);
  while (release.length) { release.shift()!(); await new Promise(r => setImmediate(r)); }
  await Promise.all([...lines, duplicate]);
  expect(peak).toBe(3);
  expect(calls.synthesize).toHaveLength(6);
  expect((await duplicate).cached).toBe(true);
});

test("a full wait queue is refused with a retry hint, and cancelled waiters are released", async () => {
  const hold: Array<() => void> = [];
  const { client } = fakeClient();
  const service = new VoiceService({ client: { ...client, synthesize: r => new Promise<SynthesisResult>(res => hold.push(() => res(client.synthesize(r)))) }, maxConcurrent: 1, maxQueued: 1, synthesisBudget: 10 });
  const first = service.speak({ text: "a", voice: "Kore", style: "" });
  const controller = new AbortController();
  const queued = service.speak({ text: "b", voice: "Kore", style: "", signal: controller.signal });
  await expect(service.speak({ text: "c", voice: "Kore", style: "" })).rejects.toMatchObject({ status: 429, retryAfterSeconds: 2 });
  controller.abort();
  await expect(queued).rejects.toMatchObject({ status: 499 });
  while (!hold.length) await new Promise(r => setImmediate(r));
  hold.shift()!(); await first;
  expect(service.usage().synthesis.used).toBe(1);
});

test("LRU evicts least-recently-used entries by count and bytes", () => {
  const entry = (bytes: number) => ({ wav: Buffer.alloc(bytes) });
  const cache = new LruCache<{ wav: Buffer }>(2, 100);
  cache.set("a", entry(10)); cache.set("b", entry(10)); cache.get("a"); cache.set("c", entry(10));
  expect(cache.get("b")).toBeUndefined(); expect(cache.get("a")).toBeDefined();
  cache.set("d", entry(95));
  expect(cache.size).toBe(1); expect(cache.totalBytes).toBe(95);
  cache.set("huge", entry(101)); expect(cache.get("huge")).toBeUndefined();
});

test("transcription has its own budget", async () => {
  const { client, calls } = fakeClient(), service = new VoiceService({ client, transcriptionBudget: 1 });
  expect(await service.transcribe({ audio: Buffer.from([1]), mimeType: "audio/webm" })).toBe("the sea takes what it's given");
  await expect(service.transcribe({ audio: Buffer.from([1]), mimeType: "audio/webm" })).rejects.toMatchObject({ status: 429 });
  expect(calls.transcribe).toBe(1);
});
