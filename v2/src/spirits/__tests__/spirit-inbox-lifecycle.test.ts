import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs } = await import("../../ecs/prefabs");
const { createEntityRegistry } = await import("../../ecs/tools");
const { createSpiritRegistry, createSpirit, sendMessage } = await import("../spirit-registry");
const { runSpiritCognition } = await import("../spirit-cognition");
const { drainPendingStimuli } = await import("../../cognition/stimulus-queue");
const { withSimulationTask } = await import("../../runtime/task-scope");

function fixture() {
  const world = createArgosWorld("Spirit inbox lifecycle"); initializePrefabs(world);
  const entities = createEntityRegistry(), spirits = createSpiritRegistry(world);
  const definition = { domain: "narrative" as const, rank: "archangel" as const, model: "flash" as const, systemPrompt: "Observe actual state.", observationInterval: 1000 };
  const sender = createSpirit(spirits, { ...definition, name: "Reporter" });
  const observer = createSpirit(spirits, { ...definition, name: "Observer" });
  const send = (subject: string) => sendMessage(spirits, sender.eid, observer.eid, "report", subject, `Evidence: ${subject}`);
  const cycle = () => runSpiritCognition(observer, world, entities, spirits);
  return { observer, send, cycle };
}

beforeEach(() => {
  generate.mockReset(); drainPendingStimuli();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No live inference in inbox regressions"));
});
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli(); });

test.each(["success", "provider failure", "invalid JSON", "partial parse failure"])("%s never drops messages arriving during inference", async outcome => {
  const f = fixture(); f.send("First report");
  let resolve!: (value: { text: string }) => void, reject!: (error: Error) => void;
  generate.mockImplementationOnce(() => new Promise((yes, no) => { resolve = yes; reject = no; }));
  const pending = f.cycle();
  expect(generate).toHaveBeenCalledTimes(1);
  expect(generate.mock.calls[0][0].prompt).toContain("First report");
  f.send("Arrived while thinking");
  expect(generate.mock.calls[0][0].prompt).not.toContain("Arrived while thinking");
  if (outcome === "provider failure") reject(new Error("Temporary provider failure"));
  else resolve({ text: outcome === "invalid JSON" ? "not JSON" : outcome === "partial parse failure"
    ? JSON.stringify({ observations: [{ content: "Must not partially apply" }], narrativeUpdate: { newPlotThread: { name: "unused" } }, narrativeDirectives: [null] })
    : JSON.stringify({ thoughts: "No intervention needed.", observations: [] }) });
  const output = await pending;
  expect(f.observer.inbox.map(message => message.subject)).toEqual(outcome === "success"
    ? ["Arrived while thinking"] : ["First report", "Arrived while thinking"]);
  if (outcome !== "success") expect(output.observations).toEqual([]);
  generate.mockResolvedValueOnce({ text: JSON.stringify({ thoughts: "Reviewed remaining reports.", observations: [] }) });
  await f.cycle();
  expect(generate.mock.calls[1][0].prompt).toContain("Arrived while thinking");
  expect(f.observer.inbox).toEqual([]);
});

test("a report amended while inference is pending remains unread", async () => {
  const f = fixture(); f.send("Initial state");
  const message = f.observer.inbox[0];
  let resolve!: (value: { text: string }) => void;
  generate.mockImplementationOnce(() => new Promise(yes => { resolve = yes; }));
  const pending = f.cycle(); message.content = "Correction: the mechanism is now closed.";
  resolve({ text: "{}" }); await pending;
  expect(f.observer.inbox).toEqual([message]);
  expect(generate.mock.calls[0][0].prompt).not.toContain("Correction:");
});

test.each(["null", "[]", "42"])("non-object response %s cannot acknowledge reports", async text => {
  const f = fixture(); f.send("Needs review");
  generate.mockResolvedValueOnce({ text }); await f.cycle();
  expect(f.observer.inbox.map(message => message.subject)).toEqual(["Needs review"]);
});

test("a cancelled cycle cannot acknowledge reports or publish observations", async () => {
  const f = fixture(); f.send("Before cancellation");
  let resolve!: (value: { text: string }) => void;
  generate.mockImplementationOnce(() => new Promise(yes => { resolve = yes; }));
  const controller = new AbortController();
  const pending = withSimulationTask(controller.signal, f.cycle);
  controller.abort(new Error("World stopped")); f.send("Later report");
  const rejected = expect(pending).rejects.toThrow("World stopped");
  resolve({ text: JSON.stringify({ observations: [{ content: "Obsolete observation" }] }) });
  await rejected;
  expect(f.observer.inbox.map(message => message.subject)).toEqual(["Before cancellation", "Later report"]);
  expect(f.observer.observations).toEqual([]);
});

test("replacing a receipt with the same ID does not acknowledge unobserved input", async () => {
  const f = fixture(); f.send("Same text, new receipt");
  let resolve!: (value: { text: string }) => void;
  generate.mockImplementationOnce(() => new Promise(yes => { resolve = yes; }));
  const pending = f.cycle(), replacement = { ...f.observer.inbox[0] };
  f.observer.inbox = [replacement]; resolve({ text: "{}" }); await pending;
  expect(f.observer.inbox).toEqual([replacement]);
});
