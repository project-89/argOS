import { createGeminiVoiceClient, describeAudioMime, parseWav, pcmToWav, toWav, VoiceError } from "../gemini-voice";
import { tone } from "./fixtures";

describe("WAV encoding", () => {
  test("pcmToWav writes a canonical 44-byte PCM header", () => {
    const pcm = tone(250), wav = pcmToWav(pcm, 24_000, 1, 16);
    expect(wav.length).toBe(44 + pcm.length);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.readUInt32LE(4)).toBe(36 + pcm.length);
    expect(wav.toString("ascii", 8, 16)).toBe("WAVEfmt ");
    expect(wav.readUInt32LE(16)).toBe(16);        // fmt chunk size
    expect(wav.readUInt16LE(20)).toBe(1);         // PCM
    expect(wav.readUInt16LE(22)).toBe(1);         // mono
    expect(wav.readUInt32LE(24)).toBe(24_000);    // sample rate
    expect(wav.readUInt32LE(28)).toBe(48_000);    // byte rate
    expect(wav.readUInt16LE(32)).toBe(2);         // block align
    expect(wav.readUInt16LE(34)).toBe(16);        // bits
    expect(wav.toString("ascii", 36, 40)).toBe("data");
    expect(wav.readUInt32LE(40)).toBe(pcm.length);
    expect(wav.subarray(44).equals(pcm)).toBe(true);
    expect(parseWav(wav)).toMatchObject({ sampleRate: 24_000, channels: 1, bitsPerSample: 16, format: 1, durationMs: 250 });
  });

  test("provider L16 and streaming-style WAV normalise to a clean WAV", () => {
    expect(describeAudioMime("audio/L16;codec=pcm;rate=24000")).toEqual({ kind: "pcm", sampleRate: 24_000, channels: 1 });
    expect(describeAudioMime("audio/wav")).toEqual({ kind: "wav" });
    const pcm = tone(500), fromPcm = toWav(Buffer.concat([pcm, Buffer.from([7])]), "audio/L16;codec=pcm;rate=24000");
    expect(fromPcm).toMatchObject({ sampleRate: 24_000, durationMs: 500 });
    expect(fromPcm.wav.subarray(44).equals(pcm)).toBe(true); // odd trailing byte dropped
    const streaming = pcmToWav(pcm, 24_000); streaming.writeUInt32LE(0xffffffff, 40); streaming.writeUInt32LE(0xffffffff, 4);
    const fixed = toWav(streaming, "audio/wav");
    expect(fixed.wav.readUInt32LE(40)).toBe(pcm.length);
    expect(fixed.durationMs).toBe(500);
    expect(() => toWav(Buffer.from("nope"), "audio/mpeg")).toThrow(VoiceError);
  });
});

describe("Gemini voice client (mock fetch)", () => {
  const response = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

  test("synthesize posts an Interactions TTS request with style metadata and never puts the key in the URL", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const wav = pcmToWav(tone(200));
    const client = createGeminiVoiceClient({ apiKey: "test-key-not-real", ttsModel: "gemini-3.8-flash-tts", fetch: async (url, init) => {
      seen.push({ url: String(url), init: init! });
      return response(200, { steps: [{ type: "model_output", content: [{ type: "audio", mime_type: "audio/wav", data: wav.toString("base64") }] }] });
    } });
    const result = await client.synthesize({ text: "The sea takes what it's given.", voiceName: "Sadaltager", style: "Old and lyrical." });
    expect(result).toMatchObject({ sampleRate: 24_000, channels: 1, durationMs: 200 });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    expect(seen[0].url).not.toContain("test-key");
    expect((seen[0].init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key-not-real");
    const body = JSON.parse(String(seen[0].init.body));
    expect(body).toMatchObject({ model: "gemini-3.8-flash-tts", store: false, response_format: { type: "audio" },
      generation_config: { speech_config: [{ voice: "Sadaltager" }] } });
    expect(body.input[0].content[0]).toEqual({ type: "text", text: "The sea takes what it's given.",
      annotations: [{ type: "speech_metadata", style: "Old and lyrical." }] });
  });

  test("a line can name its own TTS model (dialogue model); malformed model ids are refused offline", async () => {
    const models: string[] = [], wav = pcmToWav(tone(50));
    const client = createGeminiVoiceClient({ apiKey: "k", ttsModel: "gemini-3.8-flash-tts", fetch: async (_url, init) => {
      models.push(JSON.parse(String(init!.body)).model);
      return response(200, { steps: [{ type: "model_output", content: [{ type: "audio", mime_type: "audio/wav", data: wav.toString("base64") }] }] });
    } });
    await client.synthesize({ text: "Hi", voiceName: "Kore", model: "gemini-3.8-flash-lite-tts" });
    await client.synthesize({ text: "Hi", voiceName: "Kore" });
    expect(models).toEqual(["gemini-3.8-flash-lite-tts", "gemini-3.8-flash-tts"]);
    await expect(client.synthesize({ text: "Hi", voiceName: "Kore", model: "../x?y" })).rejects.toMatchObject({ status: 400 });
    expect(models).toHaveLength(2);
  });

  test("also accepts generateContent-style inline PCM", async () => {
    const pcm = tone(300);
    const client = createGeminiVoiceClient({ apiKey: "k", fetch: async () => response(200,
      { candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: pcm.toString("base64") } }] } }] }) });
    expect((await client.synthesize({ text: "Hi", voiceName: "Kore" })).durationMs).toBe(300);
  });

  test("maps 429 with retry hints, 5xx and rejections to VoiceErrors without leaking the key", async () => {
    const limited = createGeminiVoiceClient({ apiKey: "secret-key", fetch: async () => response(429,
      { error: { code: 429, message: "Quota exceeded", details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "17s" }] } }) });
    await expect(limited.synthesize({ text: "Hi", voiceName: "Kore" })).rejects.toMatchObject({ status: 429, retryAfterSeconds: 17 });
    const header = createGeminiVoiceClient({ apiKey: "k", fetch: async () => response(429, "{}", { "retry-after": "9" }) });
    await expect(header.synthesize({ text: "Hi", voiceName: "Kore" })).rejects.toMatchObject({ status: 429, retryAfterSeconds: 9 });
    const down = createGeminiVoiceClient({ apiKey: "k", fetch: async () => response(503, "{}") });
    await expect(down.synthesize({ text: "Hi", voiceName: "Kore" })).rejects.toMatchObject({ status: 502, retryAfterSeconds: 5 });
    const rejected = createGeminiVoiceClient({ apiKey: "secret-key", fetch: async () => response(400, { error: { message: "bad key=secret-key" } }) });
    const error = await rejected.synthesize({ text: "Hi", voiceName: "Kore" }).catch(e => e);
    expect(error).toBeInstanceOf(VoiceError); expect(error.status).toBe(502); expect(error.message).not.toContain("secret-key");
    const offline = createGeminiVoiceClient({ apiKey: "k", fetch: async () => { throw new TypeError("fetch failed"); } });
    await expect(offline.synthesize({ text: "Hi", voiceName: "Kore" })).rejects.toMatchObject({ status: 502 });
    const noAudio = createGeminiVoiceClient({ apiKey: "k", fetch: async () => response(200, { steps: [] }) });
    await expect(noAudio.synthesize({ text: "Hi", voiceName: "Kore" })).rejects.toMatchObject({ status: 502 });
  });

  test("validates lines and voices before any network call; times out slow providers", async () => {
    let calls = 0;
    const client = createGeminiVoiceClient({ apiKey: "k", synthTimeoutMs: 20, fetch: async (_url, init) => { calls++;
      return new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new Error("aborted")))); } });
    await expect(client.synthesize({ text: "x".repeat(601), voiceName: "Kore" })).rejects.toMatchObject({ status: 400 });
    await expect(client.synthesize({ text: "Hi", voiceName: "Kore; drop" })).rejects.toMatchObject({ status: 400 });
    expect(calls).toBe(0);
    await expect(client.synthesize({ text: "Hi", voiceName: "Kore" })).rejects.toMatchObject({ status: 504 });
  });

  test("transcribe sends inline audio to generateContent and returns only the transcript text", async () => {
    let body: any, url = "";
    const client = createGeminiVoiceClient({ apiKey: "k", sttModel: "gemini-3.8-flash", fetch: async (u, init) => { url = String(u); body = JSON.parse(String(init!.body));
      return response(200, { candidates: [{ content: { parts: [{ text: "thinking", thought: true }, { text: " The sea takes what it's given. " }] } }] }); } });
    const audio = pcmToWav(tone(100));
    expect(await client.transcribe({ audio, mimeType: "audio/wav" })).toBe("The sea takes what it's given.");
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
    expect(body.contents[0].parts[0]).toEqual({ inlineData: { mimeType: "audio/wav", data: audio.toString("base64") } });
    expect(body.contents[0].parts[1].text).toMatch(/verbatim/i);
    await expect(client.transcribe({ audio: Buffer.alloc(0), mimeType: "audio/wav" })).rejects.toMatchObject({ status: 400 });
  });
});
