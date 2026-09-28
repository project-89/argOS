import { afterEach, describe, expect, test } from "@jest/globals";
import { generateText } from "ai";
import { createArgosModel } from "../config";
import { googleProviderFetch } from "../google-transport";

const originalFetch = globalThis.fetch;
const originalKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  else process.env.GOOGLE_GENERATIVE_AI_API_KEY = originalKey;
});

const answer = () => new Response(JSON.stringify({
  candidates: [{ content: { role: "model", parts: [{ text: "fixture answer" }] }, finishReason: "STOP" }],
  usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 },
}), { status: 200, headers: { "content-type": "application/json" } });

describe("Google's scoped transport", () => {
  test("preserves request objects, init fields and the response without mutating callers", async () => {
    const controller = new AbortController();
    const request = new Request("https://generativelanguage.googleapis.com/fixture",
      { method: "POST", body: "fixture" });
    const options = { signal: controller.signal, headers: { "x-fixture": "retained" } };
    const response = answer();
    globalThis.fetch = async (input, init) => {
      expect(input).toBe(request);
      expect(init?.signal).toBe(controller.signal);
      expect(init?.headers).toBe(options.headers);
      expect((init as any).dispatcher.dispatch).toBeInstanceOf(Function);
      return response;
    };
    expect(await googleProviderFetch(request, options)).toBe(response);
    expect(options).not.toHaveProperty("dispatcher");
  });

  test("supplies a reused dispatcher without replacing global fetch or bypassing observers", async () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "offline-fixture";
    const observed: any[] = [];
    const observer: typeof fetch = async (input, init) => {
      observed.push({ input, init });
      return answer();
    };
    globalThis.fetch = observer;
    const model = createArgosModel("gemini-3.8-flash");
    for (let i = 0; i < 2; i++) {
      const result = await generateText({ model, prompt: "fixture", maxRetries: 0 });
      expect(result.text).toBe("fixture answer");
    }
    expect(globalThis.fetch).toBe(observer);
    expect(observed).toHaveLength(2);
    expect(observed[0].init.dispatcher?.dispatch).toBeInstanceOf(Function);
    expect(observed[1].init.dispatcher).toBe(observed[0].init.dispatcher);
    expect(String(observed[0].input)).toMatch(/^https:\/\/generativelanguage\.googleapis\.com\//);
    expect(new Headers(observed[0].init.headers).get("x-goog-api-key")).toBe("offline-fixture");
    expect(JSON.parse(observed[0].init.body).contents[0].parts[0].text).toBe("fixture");
  });

  test("retains per-request cancellation and rejects with its original reason", async () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "offline-fixture";
    const controller = new AbortController();
    const reason = new DOMException("fixture stop", "AbortError");
    let seen: AbortSignal | undefined;
    let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    globalThis.fetch = async (_input, init) => {
      seen = init?.signal ?? undefined;
      entered();
      return new Promise((_resolve, reject) => {
        seen!.addEventListener("abort", () => reject(seen!.reason), { once: true });
      });
    };
    const result = generateText({ model: createArgosModel("gemini-3.8-flash"),
      prompt: "fixture", maxRetries: 0, abortSignal: controller.signal });
    const rejected = expect(result).rejects.toBe(reason);
    await ready;
    controller.abort(reason);
    await rejected;
    expect(seen?.aborted).toBe(true);
  });
});
