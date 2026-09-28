import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { runInNewContext } from "node:vm";
import { jest } from "@jest/globals";
import { BASELINE_TRIALS } from "../two-world-baseline-protocol";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

test("ten declared trials use exactly the two fixed packages", () => {
  expect(new Set(BASELINE_TRIALS.map(t => t.id)).size).toBe(10);
  expect(BASELINE_TRIALS.filter(t => t.world === "social")).toHaveLength(5);
  expect(BASELINE_TRIALS.filter(t => t.world === "puzzle")).toHaveLength(5);
});
test("provider audit is network-free in smoke, bounds attempts and excludes credentials/reasoning", async () => {
  const files = new Map<string, string>(), signals: string[] = [];
  const fetchStub = jest.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [
    { thought: true, text: "PRIVATE_PROVIDER_REASONING" }, { text: "PUBLIC_ANSWER" },
  ] } }] })));
  const context: Record<string, any> = { Buffer, URL, Response, ReadableStream, Set, Promise,
    fetch: fetchStub, process: { env: { ARGOS_BASELINE_DIRECTORY: "/virtual", ARGOS_TRIAL_HTTP_LIMIT: "2" },
      pid: 123, kill: (_pid: number, signal: string) => signals.push(signal), once: () => {} },
    require: (name: string) => name === "node:fs" ? { writeFileSync: (p: string, body: string) => files.set(p, body) }
      : name === "node:path" ? { join } : undefined };
  runInNewContext(readFileSync(resolve("src/evals/two-world-baseline-provider.cjs"), "utf8"), context);
  const input = { headers: { authorization: "SECRET_HEADER" }, body: JSON.stringify({ contents: [{ parts: [{ text: "FIXTURE_PROMPT" }] }] }) };
  await (await context.fetch("https://generativelanguage.googleapis.com/v1/models/mock:generateContent?key=SECRET_QUERY", input)).text();
  await (await context.fetch("https://generativelanguage.googleapis.com/v1/models/mock:generateContent", input)).text();
  await context.__argosBaselineDrain();
  await expect(context.fetch("https://generativelanguage.googleapis.com/test", input)).rejects.toThrow("budget exhausted");
  await expect(context.fetch("https://example.com", input)).rejects.toThrow("Unexpected network host");
  expect(fetchStub).toHaveBeenCalledTimes(2); expect(signals).toEqual(["SIGINT"]);
  const output = [...files.values()].join("\n");
  expect(output).toContain("FIXTURE_PROMPT"); expect(output).toContain("PUBLIC_ANSWER");
  for (const secret of ["PRIVATE_PROVIDER_REASONING", "SECRET_HEADER", "SECRET_QUERY"]) expect(output).not.toContain(secret);
  expect(JSON.parse(files.get("/virtual/provider-usage.json")!)).toMatchObject({ calls: 2, denied: 1, pending: 0, incomplete: 0 });
});

const endpoint = "https://generativelanguage.googleapis.com/v1/models/mock:generateContent?key=SECRET_QUERY";
const prompt = { body: JSON.stringify({ contents: [{ parts: [{ text: "FIXTURE_PROMPT" }] }] }) };
const answer = JSON.stringify({ candidates: [{ content: { role: "model", parts: [
  { thought: true, text: "PRIVATE_PROVIDER_REASONING" }, { text: "PUBLIC_ANSWER" },
] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 } });

function recorder(factory: (input: any, init: any) => Promise<Response>, limit = 4,
  beforeWrite?: (name: string, body: string) => void) {
  const files = new Map<string, string>(), notices: unknown[] = [];
  const source = jest.fn(factory);
  const context: Record<string, any> = { Buffer, URL, Response, ReadableStream, Set, Promise,
    fetch: source, process: { env: { ARGOS_BASELINE_DIRECTORY: "/virtual", ARGOS_TRIAL_HTTP_LIMIT: String(limit) },
      pid: 123, kill: () => {}, once: () => {}, send: (value: unknown) => notices.push(value) },
    require: (name: string) => name === "node:fs" ? { writeFileSync: (p: string, body: string) => {
      beforeWrite?.(p, body); files.set(p, body);
    } } : name === "node:path" ? { join } : undefined };
  runInNewContext(readFileSync(resolve("src/evals/two-world-baseline-provider.cjs"), "utf8"), context);
  return { context, files, notices, source,
    open: (signal?: AbortSignal) => context.fetch(endpoint, { ...prompt, signal }) as Promise<Response>,
    usage: () => JSON.parse(files.get("/virtual/provider-usage.json")!),
    row: (n = 1) => JSON.parse(files.get(`/virtual/request-${n}.json`)!),
    output: () => [...files.values()].join("\n") };
}

test.each([false, true])("consumer body abort is a recorded failure, including partial bytes: %s", async partial => {
  const abort = new AbortController(), error = new DOMException("PRIVATE_ABORT_DETAIL", "AbortError");
  const chunk = Buffer.from('{"candidates":[{"content":{"parts":[{"thought":true,"text":"PRIVATE_PARTIAL_REASONING');
  let sourceController!: ReadableStreamDefaultController<Uint8Array>, pulled!: () => void;
  const reading = new Promise<void>(resolve => { pulled = resolve; });
  const audit = recorder(async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) { sourceController = controller; if (partial) controller.enqueue(chunk); },
    pull() { pulled(); },
  })));
  abort.signal.addEventListener("abort", () => sourceController.error(abort.signal.reason), { once: true });
  const response = await audit.open(abort.signal), failed = expect(response.text()).rejects.toBe(error);
  await reading; abort.abort(error); await failed; await audit.context.__argosBaselineDrain();
  expect(audit.row().response).toMatchObject({ state: "failed", phase: "body", kind: "AbortError", status: 200,
    bytes: partial ? chunk.length : 0 });
  expect(audit.usage()).toMatchObject({ calls: 1, pending: 0, incomplete: 0 });
  expect(audit.output()).not.toContain("PRIVATE_ABORT_DETAIL");
  expect(audit.output()).not.toContain("PRIVATE_PARTIAL_REASONING");
});

test("a successful body remains received when cancellation happens after EOF", async () => {
  const abort = new AbortController(), audit = recorder(async () => new Response(answer));
  expect(await (await audit.open(abort.signal)).text()).toBe(answer);
  await audit.context.__argosBaselineDrain(); const finished = audit.row();
  abort.abort(new Error("PRIVATE_LATE_STOP")); await Promise.resolve();
  expect(audit.row()).toEqual(finished);
  expect(finished.response).toMatchObject({ state: "received", status: 200, text: "PUBLIC_ANSWER" });
  expect(audit.output()).not.toContain("PRIVATE_PROVIDER_REASONING");
});

test("an aborted signal is not evidence of a failed body that actually reaches EOF", async () => {
  const abort = new AbortController(), audit = recorder(async () => new Response(answer));
  const response = await audit.open(abort.signal); abort.abort();
  expect(await response.text()).toBe(answer); await audit.context.__argosBaselineDrain();
  expect(audit.row().response).toMatchObject({ state: "received", text: "PUBLIC_ANSWER" });
  expect(audit.usage()).toMatchObject({ incomplete: 0 });
});

test("source body failure reaches the same consumer and never fabricates an answer", async () => {
  const error = new Error("PRIVATE_NETWORK_DETAIL");
  const audit = recorder(async () => new Response(new ReadableStream({ pull(c) { c.error(error); } })));
  await expect((await audit.open()).text()).rejects.toBe(error); await audit.context.__argosBaselineDrain();
  expect(audit.row().response).toMatchObject({ state: "failed", phase: "body", kind: "provider_error", bytes: 0 });
  expect(audit.row().response).not.toHaveProperty("text");
  expect(audit.output()).not.toContain("PRIVATE_NETWORK_DETAIL");
  expect(audit.usage()).toMatchObject({ pending: 0, incomplete: 0 });
});

test("there is no second audit reader whose failure can lose a successful consumer response", async () => {
  const response = new Response(answer);
  const clone = jest.spyOn(response, "clone").mockImplementation(() => { throw Error("PRIVATE_CLONE_ERROR"); });
  const audit = recorder(async () => response);
  expect(await (await audit.open()).text()).toBe(answer); await audit.context.__argosBaselineDrain();
  expect(clone).not.toHaveBeenCalled();
  expect(audit.row().response).toMatchObject({ state: "received", text: "PUBLIC_ANSWER" });
  expect(audit.usage()).toMatchObject({ incomplete: 0 });
});

test("an unread body remains pending; consumer cancellation is explicit and does not invent completion", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const cancel = jest.fn((_reason: unknown): void => {}), pull = jest.fn((): void => {});
  const audit = recorder(async () => new Response(new ReadableStream<Uint8Array>({
    start(c) { controller = c; }, pull, cancel,
  }, { highWaterMark: 0 })));
  const response = await audit.open(); await Promise.resolve();
  expect(audit.usage()).toMatchObject({ pending: 1 });
  expect(pull).not.toHaveBeenCalled(); expect(audit.row().response.state).toBe("pending");
  const cancelled = response.body!.cancel("PRIVATE_CANCEL_REASON");
  // Also let the old clone-reader implementation terminate when this is a red test.
  if (!cancel.mock.calls.length) controller.close();
  await cancelled; await audit.context.__argosBaselineDrain();
  expect(cancel).toHaveBeenCalledWith("PRIVATE_CANCEL_REASON");
  expect(audit.row().response).toMatchObject({ state: "failed", phase: "body", kind: "consumer_cancel", bytes: 0 });
  expect(audit.usage()).toMatchObject({ pending: 0, incomplete: 0 });
  expect(audit.output()).not.toContain("PRIVATE_CANCEL_REASON");
});

test.each(["malformed", "oversized", "missing body", "missing prompt"])("%s remains an audit failure, not a successful trace", async kind => {
  const body = kind === "malformed" ? "PRIVATE_MALFORMED_RESPONSE" : kind === "oversized"
    ? JSON.stringify({ candidates: [{ content: { parts: [{ text: "x".repeat(262145) }] } }] }) : kind === "missing body" ? null : answer;
  const audit = recorder(async () => new Response(body));
  const response = kind === "missing prompt" ? await audit.context.fetch(endpoint, { body: "invalid" }) : await audit.open();
  expect(await response.text()).toBe(body ?? ""); await audit.context.__argosBaselineDrain();
  expect(audit.usage().incomplete).toBeGreaterThan(0);
  expect(audit.output()).not.toContain("PRIVATE_MALFORMED_RESPONSE");
  expect(audit.output()).not.toContain("PRIVATE_PROVIDER_REASONING");
});

test("consumer methods, status, headers, URL and redirects survive the observer", async () => {
  const audit = recorder(async () => {
    const response = new Response(answer, { status: 201, statusText: "Created", headers: { "x-fixture": "retained" } });
    Object.defineProperties(response, { url: { value: "https://generativelanguage.googleapis.com/final" },
      redirected: { value: true }, type: { value: "basic" } }); return response;
  });
  const response = await audit.open();
  expect(response.status).toBe(201); expect(response.statusText).toBe("Created");
  expect(response.headers.get("x-fixture")).toBe("retained");
  expect(response.url).toBe("https://generativelanguage.googleapis.com/final");
  expect(response.redirected).toBe(true); expect(response.type).toBe("basic");
  const copy = response.clone();
  expect(copy.url).toBe(response.url); expect(copy.redirected).toBe(true); expect(copy.type).toBe("basic");
  expect(await copy.text()).toBe(answer);
  expect(await response.json()).toEqual(JSON.parse(answer)); expect(response.bodyUsed).toBe(true);
  await audit.context.__argosBaselineDrain(); expect(audit.row().response.text).toBe("PUBLIC_ANSWER");
});

test("real Google SDK reads exactly the audited response without network or reasoning leakage", async () => {
  const audit = recorder(async () => new Response(answer));
  const model = createGoogleGenerativeAI({ apiKey: "SECRET_HEADER", fetch: audit.context.fetch })("gemini-3.8-flash");
  const result = await generateText({ model, prompt: "FIXTURE_PROMPT", maxRetries: 0 });
  expect(result.text).toBe("PUBLIC_ANSWER"); await audit.context.__argosBaselineDrain();
  expect(audit.source).toHaveBeenCalledTimes(1);
  expect(audit.row().response).toMatchObject({ state: "received", text: result.text });
  for (const secret of ["SECRET_HEADER", "SECRET_QUERY", "PRIVATE_PROVIDER_REASONING"]) expect(audit.output()).not.toContain(secret);
});

test("real Google SDK body abort agrees with the recorder's failed outcome", async () => {
  const abort = new AbortController(), error = new DOMException("PRIVATE_SDK_ABORT", "AbortError");
  let entered!: () => void; const reading = new Promise<void>(resolve => { entered = resolve; });
  const audit = recorder(async (_input, init) => new Response(new ReadableStream({
    start(controller) { init.signal.addEventListener("abort", () => controller.error(init.signal.reason), { once: true }); },
    pull() { entered(); },
  })));
  const model = createGoogleGenerativeAI({ apiKey: "SECRET_HEADER", fetch: audit.context.fetch })("gemini-3.8-flash");
  const pending = generateText({ model, prompt: "FIXTURE_PROMPT", abortSignal: abort.signal, maxRetries: 0 });
  const failed = expect(pending).rejects.toMatchObject({ cause: error }); await reading; abort.abort(error); await failed;
  await audit.context.__argosBaselineDrain();
  expect(audit.row().response).toMatchObject({ state: "failed", phase: "body", kind: "AbortError" });
  expect(audit.usage()).toMatchObject({ pending: 0, incomplete: 0 });
  expect(audit.output()).not.toContain("PRIVATE_SDK_ABORT");
});

test("a response-byte bound stays failed even if the consumer later aborts", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>, pulled!: () => void;
  const reading = new Promise<void>(resolve => { pulled = resolve; });
  const error = new DOMException("PRIVATE_OVERSIZE_ABORT", "AbortError");
  const audit = recorder(async () => new Response(new ReadableStream<Uint8Array>({
    start(c) { controller = c; c.enqueue(Buffer.alloc(262145, 120)); }, pull() { pulled(); },
  })));
  const response = await audit.open(), rejected = expect(response.text()).rejects.toBe(error);
  await reading; controller.error(error); await rejected; await audit.context.__argosBaselineDrain();
  expect(audit.row().response).toMatchObject({ state: "failed", phase: "body", kind: "AbortError", bytes: 262145 });
  expect(audit.usage().incomplete).toBeGreaterThan(0);
});

test("UTF-8 chunks, consumer clone and arrayBuffer preserve the same complete audited text", async () => {
  const body = answer.replace("PUBLIC_ANSWER", "Quiet café — 雨"), bytes = Buffer.from(body);
  let index = 0;
  const audit = recorder(async () => new Response(new ReadableStream<Uint8Array>({
    pull(c) { if (index === bytes.length) c.close(); else c.enqueue(bytes.subarray(index, ++index)); },
  }, { highWaterMark: 0 })));
  const response = await audit.open(), copy = response.clone();
  const [text, binary] = await Promise.all([response.text(), copy.arrayBuffer()]);
  expect(text).toBe(body); expect(Buffer.from(binary).equals(bytes)).toBe(true);
  await audit.context.__argosBaselineDrain();
  expect(audit.row().response).toMatchObject({ state: "received", text: "Quiet café — 雨", bytes: bytes.length });
});

test("a persistence failure cannot change the delivered body or pretend the audit is complete", async () => {
  const audit = recorder(async () => new Response(answer), 4, (file, body) => {
    if (file.endsWith("request-1.json") && JSON.parse(body).response.state === "received") throw Error("PRIVATE_DISK_FAILURE");
  });
  expect(await (await audit.open()).text()).toBe(answer); await audit.context.__argosBaselineDrain();
  expect(audit.notices).toContainEqual({ type: "audit_failed" });
  expect(audit.row().response.state).toBe("pending"); // Original request evidence retained.
  expect(audit.usage().incomplete).toBeGreaterThan(0);
  expect(audit.output()).not.toContain("PRIVATE_DISK_FAILURE");
});

test("the original cumulative 32MiB trace bound is still enforced without a live call", async () => {
  const audit = recorder(async () => new Response(answer), 100);
  const input = { body: JSON.stringify({ contents: [{ parts: [{ text: "x".repeat(262144) }] }] }) };
  for (let n = 0; n < 100 && !(audit.files.has("/virtual/provider-usage.json") && audit.usage().incomplete); n++) {
    try { await (await audit.context.fetch(endpoint, input)).text(); }
    catch (error) { expect(String(error)).toContain("Prompt audit byte bound exceeded"); }
    await audit.context.__argosBaselineDrain();
  }
  expect(audit.usage().traceBytes).toBeGreaterThan(32 * 1024 * 1024);
  expect(audit.usage().incomplete).toBeGreaterThan(0);
  expect(audit.source.mock.calls.length).toBeLessThan(100);
});

test.each([false, true])("native fetch cancellation after local HTTP headers matches consumer/audit: partial=%s", async partial => {
  const chunk = '{"candidates":[{"content":{"parts":[{"thought":true,"text":"PRIVATE_NATIVE_PARTIAL';
  let connections = 0;
  const server = createServer((_request, response) => {
    connections++; response.writeHead(200, { "content-type": "application/json" }); response.flushHeaders();
    if (partial) response.write(chunk);
    // Intentionally no EOF; no timer or provider connection to outlive this fixture.
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/fixture`;
    const nativeFetch = globalThis.fetch, abort = new AbortController();
    const audit = recorder(async (_input, init) => nativeFetch(url, { signal: init.signal }));
    const response = await audit.open(abort.signal);
    if (partial) {
      const reader = response.body!.getReader();
      const received = await reader.read(); expect(Buffer.from(received.value!).toString()).toBe(chunk);
      const rejected = expect(reader.read()).rejects.toMatchObject({ name: "AbortError" });
      abort.abort(); await rejected;
    } else {
      const rejected = expect(response.text()).rejects.toMatchObject({ name: "AbortError" });
      abort.abort(); await rejected;
    }
    await audit.context.__argosBaselineDrain();
    expect(audit.row().response).toMatchObject({ state: "failed", phase: "body", kind: "AbortError", status: 200,
      bytes: partial ? Buffer.byteLength(chunk) : 0 });
    expect(audit.usage()).toMatchObject({ calls: 1, pending: 0, incomplete: 0 });
    expect(audit.output()).not.toContain("PRIVATE_NATIVE_PARTIAL"); expect(connections).toBe(1);
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test.each(["AbortError", "TimeoutError", "Error"])("%s updates pending usage before drain or process exit", async name => {
  const files = new Map<string, string>(), rejecters: Array<(reason: unknown) => void> = [];
  const context: Record<string, any> = { Buffer, URL, Set, Promise,
    fetch: () => new Promise((_resolve, reject) => rejecters.push(reject)),
    process: { env: { ARGOS_BASELINE_DIRECTORY: "/virtual", ARGOS_TRIAL_HTTP_LIMIT: "2" }, once: () => {} },
    require: (module: string) => module === "node:fs" ? { writeFileSync: (p: string, body: string) => files.set(p, body) }
      : module === "node:path" ? { join } : undefined };
  runInNewContext(readFileSync(resolve("src/evals/two-world-baseline-provider.cjs"), "utf8"), context);
  const input = { body: JSON.stringify({ contents: [{ parts: [{ text: "fixture" }] }] }) };
  const first = context.fetch("https://generativelanguage.googleapis.com/v1/models/mock:generateContent", input);
  const second = context.fetch("https://generativelanguage.googleapis.com/v1/models/mock:generateContent", input);
  const usage = () => JSON.parse(files.get("/virtual/provider-usage.json")!);
  expect(usage()).toMatchObject({ calls: 2, pending: 2, inFlight: [1, 2] });
  const error = Object.assign(new Error("PRIVATE_FAILURE_DETAIL"), { name });
  const firstFailure = expect(first).rejects.toBe(error);
  rejecters[0](error); await firstFailure;
  // Another request is still genuinely pending; do not zero the whole ledger.
  expect(usage()).toMatchObject({ calls: 2, pending: 1, inFlight: [2] });
  expect(JSON.parse(files.get("/virtual/request-1.json")!).response).toEqual({
    state: "failed", kind: name === "Error" ? "provider_error" : name });
  const secondFailure = expect(second).rejects.toBe(error);
  rejecters[1](error); await secondFailure;
  // Neither __argosBaselineDrain nor an exit hook ran to repair these counts.
  expect(usage()).toMatchObject({ calls: 2, pending: 0, inFlight: [], incomplete: 0 });
  expect([...files.values()].join("\n")).not.toContain("PRIVATE_FAILURE_DETAIL");
});
