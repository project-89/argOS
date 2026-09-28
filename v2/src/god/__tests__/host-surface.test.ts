import { jest } from "@jest/globals";

// This suite owns its module registry: no provider call, global God-tool mock,
// daemon process or shared simulation is needed to exercise the host boundary.
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<any>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs } = await import("../../ecs/prefabs");
const { startCommittedEvents, stopCommittedEvents } = await import("../../runtime/committed-events");
const { createGodAgent, godThink, godCommandResult } = await import("../god-agent");
type GodCommandOptions = import("../god-agent").GodCommandOptions;

let world: ReturnType<typeof createArgosWorld>;
let god: ReturnType<typeof createGodAgent>;
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
beforeEach(() => {
  generate.mockReset();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("Host-surface tests are offline"));
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  world = createArgosWorld("Bounded host God"); initializePrefabs(world); startCommittedEvents(world);
  god = createGodAgent(world, { name: "God", worldName: "Bounded host God", narrative: "" });
});
afterEach(() => {
  stopCommittedEvents(world);
  expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks();
});

function surface(execute = jest.fn(async () => ({ success: true, result: { count: 1 } }))) {
  const abort = new AbortController();
  const options: GodCommandOptions = { authority: "full", current: () => true, surface: {
    systemPrompt: "Only the host's public inspection is permitted.", signal: abort.signal,
    tools: { inspectPublic: { description: "Public state only", execute } },
  } };
  return { execute, abort, options };
}

test("host tools replace full God authority, private history stays absent, and final text is separate from reasoning", async () => {
  const f = surface();
  god.conversationHistory.push({ role: "user", content: "PRIVATE_GOD_HISTORY" });
  const history = structuredClone(god.conversationHistory);
  generate.mockImplementation(async input => {
    expect(input.system).toBe(f.options.surface!.systemPrompt);
    expect(input.messages).toEqual([{ role: "user", content: "Inspect the public world" }]);
    expect(Object.keys(input.tools)).toEqual(["inspectPublic"]);
    expect(input.tools).not.toHaveProperty("createAgent");
    expect(input.tools).not.toHaveProperty("getComponentValues");
    expect(input.tools).not.toHaveProperty("bakeNewSystem");
    expect(input.abortSignal).toBe(f.abort.signal);
    const output = await input.tools.inspectPublic.execute({}, {});
    return { text: "There is one public object.", reasoningText: "PRIVATE_PROVIDER_REASONING", steps: [{
      toolCalls: [{ toolCallId: "host-inspection", toolName: "inspectPublic", input: {} }],
      toolResults: [{ toolCallId: "host-inspection", output }],
    }] };
  });
  const result = await godThink(god, "Inspect the public world", f.options);
  expect(result.text).toBe("There is one public object.");
  expect(result.text).not.toContain("PRIVATE_");
  expect(result.actions).toEqual([{ success: true, result: { count: 1 } }]);
  expect(god.conversationHistory).toEqual(history);
  expect(f.execute).toHaveBeenCalledTimes(1); expect(generate).toHaveBeenCalledTimes(1);
});

test("a failed host provider attempt is not silently retried with full or reduced God tools", async () => {
  const f = surface(), failure = Error("Offline provider failure");
  generate.mockImplementation(async input => {
    expect(Object.keys(input.tools)).toEqual(["inspectPublic"]); throw failure;
  });
  await expect(godThink(god, "Inspect", f.options)).rejects.toBe(failure);
  expect(generate).toHaveBeenCalledTimes(1); expect(f.execute).not.toHaveBeenCalled();
  expect(god.conversationHistory).toEqual([]);
});

test("malformed host tool-call output cannot trigger an unrestricted retry", async () => {
  const f = surface();
  generate.mockResolvedValue({ text: "", steps: [{ rawFinishReason: "MALFORMED_FUNCTION_CALL", finishReason: "error" }] });
  const result = await godThink(god, "Inspect", f.options);
  expect(result.actions).toEqual([]); expect(generate).toHaveBeenCalledTimes(1);
  expect(Object.keys(generate.mock.calls[0][0].tools)).toEqual(["inspectPublic"]);
  expect(f.execute).not.toHaveBeenCalled();
});

test.each(["cancel", "source-change"])("%s rejects a retained host tool before the native handler runs", async change => {
  const f = surface(); let current = true;
  f.options.current = () => current;
  let captured: any;
  generate.mockImplementation(async input => {
    captured = input.tools.inspectPublic;
    if (change === "cancel") f.abort.abort(); else current = false;
    await expect(captured.execute({}, {})).rejects.toThrow(/expired/);
    return { text: "Late result must not be admitted", steps: [] };
  });
  await expect(godThink(god, "Inspect", f.options)).rejects.toThrow(/expired/);
  await expect(captured.execute({}, {})).rejects.toThrow(/expired/);
  expect(f.execute).not.toHaveBeenCalled(); expect(generate).toHaveBeenCalledTimes(1);
  expect(god.conversationHistory).toEqual([]); expect(god.thinkingLog).toEqual([]);
});

test("expiry during an asynchronous tool cannot turn its late result into an accepted receipt", async () => {
  const f = surface(jest.fn(async () => { f.abort.abort(); return { success: true, result: { count: 1 } }; }));
  generate.mockImplementation(async input => {
    await input.tools.inspectPublic.execute({}, {});
    return { text: "Must not be reached", steps: [] };
  });
  await expect(godThink(god, "Inspect", f.options)).rejects.toThrow(/expired/);
  // Cancellation does not promise rollback of an effect already committed by a
  // native adapter. It prevents a stale provider result from becoming a reply.
  expect(f.execute).toHaveBeenCalledTimes(1); expect(god.thinkingLog).toEqual([]);
});

test("host cancellation settles while an earlier God command still owns the lock, without stealing its slot", async () => {
  const first = surface(), next = surface(); let release!: () => void;
  god._commandLock = new Promise<void>(resolve => { release = resolve; });
  let outcome = "pending", nextOutcome = "pending";
  const cancelled = godCommandResult(god, "Cancel while waiting", first.options).then(
    () => { outcome = "resolved"; }, error => { outcome = error.message; });
  first.abort.abort(); await turn();
  expect(outcome).toMatch(/cancelled while waiting/); expect(generate).not.toHaveBeenCalled();
  generate.mockResolvedValue({ text: "Next request completed", steps: [] });
  const following = godCommandResult(god, "Wait for the original lock", next.options).then(() => { nextOutcome = "resolved"; });
  await turn(); expect(nextOutcome).toBe("pending"); expect(generate).not.toHaveBeenCalled();
  release(); await Promise.all([cancelled, following]);
  expect(nextOutcome).toBe("resolved"); expect(generate).toHaveBeenCalledTimes(1);
  expect(generate.mock.calls[0][0].messages).toEqual([{ role: "user", content: "Wait for the original lock" }]);
});
