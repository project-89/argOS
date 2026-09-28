import { jest } from "@jest/globals";
const ai = await import("ai"), generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createAgentEntity, createRoomEntity } = await import("../../ecs/prefabs");
const { createSystemRegistry } = await import("../../ecs/dynamic-systems");
const { startCommittedEvents, publishCommittedEvent, stopCommittedEvents } = await import("../../runtime/committed-events");
const { advanceSimulationTime } = await import("../../ecs/simulation-time");
const { createSpiritRegistry } = await import("../spirit-registry");
const { createDynamicSpirit } = await import("../spirit-factory");
const { createWatcherSpirit, runObservationSynthesis } = await import("../watcher-spirit");
const { reportGap } = await import("../observation-aggregator");
const { runArchitectCognition } = await import("../architect-spirit");
const { recordEvent } = await import("../consistency-spirit");
function fixture() {
  const world = createArgosWorld("Workshop"); initializePrefabs(world); startCommittedEvents(world);
  const room = createRoomEntity(world, { name: "Hall" });
  const actor = createAgentEntity(world, { name: "Ada", role: "maker", systemPrompt: "PRIVATE_HISTORY", roomId: room });
  const registry = createSystemRegistry(), spirits = createSpiritRegistry(world);
  const watcher = createWatcherSpirit(spirits)!;
  const weaver = createDynamicSpirit(spirits, { name: "The Weaver", type: "architect", rank: "archangel", domain: "ecology",
    architectConfig: { canProposeEntities: true, canProposeSystems: false, canProposeComponents: false, canProposeRules: false,
      canExecuteDirectly: false, proposalApproval: "superior", maxProposalsPerCycle: 1 } })!;
  reportGap("Inspector", "interaction_failure", "LOCAL_OBSERVATION", "Inspect native prerequisites", "high", world);
  runObservationSynthesis(world, spirits, watcher.eid);
  return { world, room, actor, registry, spirits, watcher, weaver, run: () => runArchitectCognition(world, registry, spirits, weaver) };
}
beforeEach(() => { generate.mockReset().mockResolvedValue({ text: "[]" }); });
test("native Watcher advice reaches Weaver once; unscoped diagnostics and private minds do not", async () => {
  const f = fixture(); recordEvent("FOREIGN_RAW_EVENT", { secret: "FOREIGN_PRIVATE_TEXT" });
  publishCommittedEvent(f.world, { executionId: "attempt", actorId: f.actor, roomId: f.room, kind: "action", action: "examine", status: "failed" });
  expect(runObservationSynthesis(f.world, f.spirits, f.watcher.eid).proposalsSent).toBe(0);
  await f.run(); const prompt = generate.mock.calls[0][0].prompt;
  expect(prompt).toContain("LOCAL_OBSERVATION"); expect(prompt).toContain('"status":"failed"');
  expect(prompt).not.toContain("FOREIGN_"); expect(prompt).not.toContain("PRIVATE_HISTORY");
  expect(f.weaver.inbox).toEqual([]); await f.run(); expect(generate.mock.calls[1][0].prompt).not.toContain("LOCAL_OBSERVATION");
});
test.each(["copy", "other-world", "expiry", "tampered-content"])("%s cannot supply Watcher authority", async mode => {
  const f = fixture();
  if (mode === "copy") f.weaver.inbox = [{ ...f.weaver.inbox[0] }];
  if (mode === "other-world") { const other = fixture(); f.weaver.inbox = [...other.weaver.inbox]; }
  if (mode === "expiry") advanceSimulationTime(f.world, 1, 600001);
  if (mode === "tampered-content") f.weaver.inbox[0].content = "FORGED_PROPOSAL";
  await f.run(); const prompt = generate.mock.calls[0][0].prompt;
  if (mode !== "tampered-content") expect(prompt).not.toContain("LOCAL_OBSERVATION");
  expect(prompt).not.toContain("FORGED_PROPOSAL");
});
test("expiry during inference cannot acknowledge or authorize a design", async () => {
  const f = fixture(), message = f.weaver.inbox[0];
  generate.mockImplementation(async () => { advanceSimulationTime(f.world, 1, 600001); return { text: "[]" }; });
  expect(await f.run()).toEqual([]); expect(f.weaver.inbox).toContain(message); stopCommittedEvents(f.world);
});
