import { jest } from "@jest/globals";
const ai = await import("ai"), generate = jest.fn<(...args: any[]) => Promise<any>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createGodAgentEntity } = await import("../../ecs/prefabs");
const { createSystemRegistry, registerSystem } = await import("../../ecs/dynamic-systems");
const { startCommittedEvents, stopCommittedEvents } = await import("../../runtime/committed-events");
const { withSimulationTask } = await import("../../runtime/task-scope");
const { advanceSimulationTimeline } = await import("../../runtime/simulation-timeline");
const { WorkingMemoryIdentity } = await import("../../ecs/components");
const { removeEntity } = await import("bitecs");
const { createSpiritRegistry, setGodAgent, getMessagesForGodAI, deactivateSpirit } = await import("../spirit-registry");
const { createDynamicSpirit, resetFactoryState } = await import("../spirit-factory");
const { setSpiritRegistryActive } = await import("../spirit-cycle-scope");
const { captureGodMessageDelivery } = await import("../spirit-message-delivery");
const { createArtificerTools } = await import("../spirit-tools");
const { runArtificerWithTools } = await import("../artificer-spirit");

const input = { systemName: "FixtureCounter", issue: "A native failure needs review", recommendation: "Review the failure before considering a repair", severity: "high" };
const worlds: ReturnType<typeof createArgosWorld>[] = [];
function fixture() {
  const world = createArgosWorld("Actual Artificer reports"); worlds.push(world); initializePrefabs(world); startCommittedEvents(world);
  const systems = createSystemRegistry(), spirits = createSpiritRegistry(world), abort = new AbortController();
  const god = createGodAgentEntity(world, { name: "God", worldName: "Actual Artificer reports" }); setGodAgent(spirits, god);
  registerSystem(systems, { name: input.systemName, description: "Public counter", pseudocode: "Count", code: "version-one",
    frequency: 1000, active: true, lastRun: 0, compiledFn: () => {} });
  const system = systems.systems.get(input.systemName)!;
  const spirit = createDynamicSpirit(spirits, { name: "The Tinker", type: "artificer", rank: "archangel", domain: "guardian" })!;
  return { world, systems, spirits, spirit, god, system, abort };
}
type Fixture = ReturnType<typeof fixture>;
const scopedTools = (f: Fixture) => withSimulationTask(f.abort.signal, async () => createArtificerTools(f.world, f.systems,
  { reporting: { registry: f.spirits, spirit: f.spirit } }));
const report = (tools: ReturnType<typeof createArtificerTools>, value = input): Promise<any> => (tools.reportToGodAI.execute as any)(value, {});
beforeEach(() => {
  resetFactoryState(); generate.mockReset();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("No network in Artificer reporting tests"));
  jest.spyOn(console, "log").mockImplementation(() => {}); jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { worlds.splice(0).forEach(stopCommittedEvents); expect(fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test("standalone reporting is unavailable, not a console-log delivery receipt", async () => {
  const f = fixture(), result = await report(createArtificerTools(f.world, f.systems));
  expect(result).toMatchObject({ success: false }); expect(result.error).toMatch(/unavailable/i);
  expect(getMessagesForGodAI(f.spirits)).toEqual([]); expect(generate).not.toHaveBeenCalled();
});

test("runArtificerWithTools queues an actual scoped report for the same-world God, not a repair or review", async () => {
  const f = fixture(); let receipt: any;
  generate.mockImplementation(async modelInput => {
    receipt = await report(modelInput.tools);
    return { text: "", steps: [{ toolResults: [{ toolName: "reportToGodAI", output: receipt }] }] };
  });
  const summary = await runArtificerWithTools(f.world, f.systems, f.spirits, f.spirit);
  expect(receipt).toMatchObject({ success: true, status: "queued", messageId: expect.stringMatching(/^scoped-spirit-message:/) });
  expect(receipt.message).toMatch(/queued/i);
  const messages = getMessagesForGodAI(f.spirits); expect(messages).toHaveLength(1);
  expect(messages[0]).toMatchObject({ id: receipt.messageId, from: f.spirit.eid, to: f.god, type: "report", priority: "high",
    data: { systemName: input.systemName, issue: input.issue, recommendation: input.recommendation, severity: "high" } });
  expect(captureGodMessageDelivery(f.world, f.god, messages[0])?.current()).toBe(true);
  expect(getMessagesForGodAI(f.spirits)).toEqual([]); expect(summary.recommendations).toEqual([receipt.message]);
  expect(summary.repairsAttempted).toEqual([]); expect(f.system.code).toBe("version-one");
});

const changes = ["stop", "restart", "registry-restart", "sender-replaced", "sender-removed", "sender-inactive", "sender-definition",
  "god-replaced", "god-identity", "system-replaced", "system-code", "system-function", "system-deleted", "task-cancel", "expiry"] as const;
function invalidate(f: Fixture, change: typeof changes[number]) {
  if (change === "stop" || change === "restart") { stopCommittedEvents(f.world); if (change === "restart") startCommittedEvents(f.world); }
  if (change === "registry-restart") { setSpiritRegistryActive(f.spirits, false); setSpiritRegistryActive(f.spirits, true); }
  if (change === "sender-replaced") f.spirits.spirits.set(f.spirit.eid, { ...f.spirit });
  if (change === "sender-removed") removeEntity(f.world, f.spirit.eid);
  if (change === "sender-inactive") deactivateSpirit(f.spirits, f.spirit.eid);
  if (change === "sender-definition") f.spirit.definition.systemPrompt += " Changed.";
  if (change === "god-replaced") setGodAgent(f.spirits, createGodAgentEntity(f.world, { name: "God", worldName: "Replacement" }));
  if (change === "god-identity") WorkingMemoryIdentity.id[f.god] = "replacement-god-identity";
  if (change === "system-replaced") registerSystem(f.systems, { ...f.system });
  if (change === "system-code") f.system.code = "version-two";
  if (change === "system-function") f.system.compiledFn = () => {};
  if (change === "system-deleted") f.systems.systems.delete(f.system.name);
  if (change === "task-cancel") f.abort.abort();
  if (change === "expiry") advanceSimulationTimeline(f.world, 120001, { integrate: () => {} });
}

test.each(changes)("%s prevents late reporting and expires an already queued report", async change => {
  const f = fixture(), tools = await scopedTools(f), accepted = await report(tools);
  expect(accepted.success).toBe(true);
  const native = f.spirits.messageQueue[0], binding = captureGodMessageDelivery(f.world, f.god, native)!;
  expect(binding.current()).toBe(true); invalidate(f, change);
  expect((await report(tools)).success).toBe(false);
  expect(binding.current()).toBe(false); expect(getMessagesForGodAI(f.spirits)).toEqual([]);
  expect(f.spirit.outbox).toHaveLength(1); // No second report was accepted.
});

test("report lifetime starts at observation, is not renewed by later submission, and survives a newer valid inspection", async () => {
  const f = fixture(); advanceSimulationTimeline(f.world, 1000, { integrate: () => {} });
  const tools = await scopedTools(f);
  advanceSimulationTimeline(f.world, 50000, { integrate: () => {} }); await report(tools);
  const message = f.spirits.messageQueue[0], binding = captureGodMessageDelivery(f.world, f.god, message)!;
  expect(binding.expiresAtSimMs).toBe(121000);
  await scopedTools(f); expect(binding.current()).toBe(true);
  expect((await report(tools)).success).toBe(false); // Superseded producer cycle.
  advanceSimulationTimeline(f.world, 70000, { integrate: () => {} }); expect(binding.current()).toBe(true);
  advanceSimulationTimeline(f.world, 1, { integrate: () => {} }); expect(binding.current()).toBe(false);
});

test.each(["missing-god", "cross-world", "non-god-superior", "spirit-as-god", "unobserved-system", "ignored-system"])("%s cannot claim God delivery", async boundary => {
  const f = fixture(); let registry = f.spirits, value = input;
  if (boundary === "missing-god") f.spirits.godAgentEid = undefined;
  if (boundary === "cross-world") registry = fixture().spirits;
  if (boundary === "non-god-superior") f.spirit.superiorEid = f.spirit.eid;
  if (boundary === "spirit-as-god") f.spirits.godAgentEid = f.spirit.eid;
  if (boundary === "unobserved-system") value = { ...input, systemName: "InventedSystem" };
  const tools = createArtificerTools(f.world, f.systems, { reporting: { registry, spirit: f.spirit },
    ignoreSystems: boundary === "ignored-system" ? [input.systemName] : [] });
  expect((await report(tools, value)).success).toBe(false);
  expect(getMessagesForGodAI(f.spirits)).toEqual([]); expect(getMessagesForGodAI(registry)).toEqual([]);
});

test("failed report output remains explicitly unavailable in the Artificer summary", async () => {
  const f = fixture(); f.spirits.godAgentEid = undefined;
  generate.mockImplementation(async modelInput => ({ text: "", toolResults: [{ toolName: "reportToGodAI", output: await report(modelInput.tools) }] }));
  const result = await runArtificerWithTools(f.world, f.systems, f.spirits, f.spirit);
  expect(result.recommendations).toHaveLength(1); expect(result.recommendations[0]).toMatch(/not delivered|unavailable/i);
  expect(result.recommendations[0]).not.toMatch(/Report submitted|Issue reported/);
});

test.each(["sender-inactive", "sender-replaced"] as const)("in-flight %s cannot mutate systems through retained maintenance tools", async change => {
  const f = fixture(); let receipts: any[] = [];
  generate.mockImplementation(async modelInput => {
    invalidate(f, change);
    const disabled = await modelInput.tools.disableSystem.execute({ systemName: input.systemName }, {});
    const frequency = await modelInput.tools.adjustSystemFrequency.execute({ systemName: input.systemName, newFrequency: 1 }, {});
    receipts = [disabled, frequency];
    return { text: "", toolResults: [{ toolName: "disableSystem", output: disabled }] };
  });
  const result = await runArtificerWithTools(f.world, f.systems, f.spirits, f.spirit);
  expect(receipts).toEqual([expect.objectContaining({ success: false }), expect.objectContaining({ success: false })]);
  expect(result.repairsAttempted).toEqual([expect.objectContaining({ success: false })]);
  expect(f.system.active).toBe(true); expect(f.system.frequency).toBe(1000);
  // Standalone trusted legacy tools did not acquire a dependency on this
  // optional spirit binding merely because a spirit exists in the world.
  const standalone = createArtificerTools(f.world, f.systems);
  expect((await (standalone.disableSystem.execute as any)({ systemName: input.systemName })).success).toBe(true);
});
