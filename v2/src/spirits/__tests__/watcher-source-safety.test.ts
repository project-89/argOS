import { jest } from "@jest/globals";
const evolve = jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue(null);
jest.unstable_mockModule("../../cognition/policy-generator.js", () => ({ evolvePolicy: evolve, canEvolvePolicy: () => true }));
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createAgentEntity, createRoomEntity } = await import("../../ecs/prefabs");
const { startCommittedEvents, stopCommittedEvents, publishCommittedEvent } = await import("../../runtime/committed-events");
const { advanceSimulationTime } = await import("../../ecs/simulation-time");
const { createSpiritRegistry, createSpirit } = await import("../spirit-registry");
const { isCurrentSpiritMessage } = await import("../spirit-message-delivery");
const { reportGap, getTopObservations, getRecentObservations, resetAggregator } = await import("../observation-aggregator");
const { recordAgentAction, runObservationSynthesis, detectPolicyStuckAgents, triggerPolicyEvolutions, resetWatcherState } = await import("../watcher-spirit");
const { setAgentBehaviorPolicy } = await import("../../cognition/behavior-policy");
const { BehaviorPolicy } = await import("../../ecs/components");
function fixture() {
  const world = createArgosWorld("Watcher safety"); initializePrefabs(world); startCommittedEvents(world);
  const room = createRoomEntity(world, { name: "Workshop" });
  const actor = createAgentEntity(world, { name: "Ari", role: "maker", systemPrompt: "My private life", roomId: room });
  const registry = createSpiritRegistry(world), def = { domain: "guardian" as const, rank: "archangel" as const, model: "flash" as const, systemPrompt: "Observe", observationInterval: 1000 };
  const watcher = createSpirit(registry, { ...def, name: "The Watcher" }), weaver = createSpirit(registry, { ...def, name: "The Weaver" });
  return { world, room, actor, registry, watcher, weaver };
}
function receipt(f: ReturnType<typeof fixture>, id: string, status: "failed" | "succeeded" = "failed", action = "examine") {
  return publishCommittedEvent(f.world, { executionId: id, kind: "action", action, actorId: f.actor, roomId: f.room, status });
}
function run(f: ReturnType<typeof fixture>) { return runObservationSynthesis(f.world, f.registry, f.watcher.eid); }
beforeEach(() => { resetWatcherState(); resetAggregator(); evolve.mockReset().mockResolvedValue(null); });
test("world A reports and legacy diagnostics never feed world B", () => {
  const a = fixture(), b = fixture();
  reportGap("Inspector", "system_missing", "A only", "Public fault", "high", a.world);
  reportGap("Legacy", "system_missing", "Unbound", "No world", "critical");
  expect(run(b).proposalsSent).toBe(0); expect(run(a).proposalsSent).toBe(1);
  expect(a.weaver.inbox[0].content).not.toContain("Unbound");
});
test.each(["stop", "restart", "expiry", "rewind"])("queued report is invalid after %s, raw evidence remains", mode => {
  const f = fixture(); advanceSimulationTime(f.world, 1, 10);
  reportGap("Inspector", "system_missing", "Gap", "Evidence", "high", f.world); run(f);
  const message = f.weaver.inbox[0]; expect(isCurrentSpiritMessage(f.registry, message, f.weaver.eid)).toBe(true);
  if (mode === "stop" || mode === "restart") stopCommittedEvents(f.world);
  if (mode === "restart") startCommittedEvents(f.world);
  if (mode === "expiry") advanceSimulationTime(f.world, 2, 600001);
  if (mode === "rewind") f.world.time.elapsed = 0;
  expect(isCurrentSpiritMessage(f.registry, message, f.weaver.eid)).toBe(false);
  expect(getTopObservations(10, f.world)).toEqual([]);
  if (mode !== "restart") expect(getRecentObservations(10, f.world)).toHaveLength(1);
});
test.each(["examine", "speak"])("successful repeated %s and quiet time do not manufacture work", action => {
  const f = fixture(); setAgentBehaviorPolicy(f.world, f.actor, { type: "action", action: { type: "wait" } }, true);
  for (let n = 0; n < 24; n++) { recordAgentAction(f.actor, action, f.world); receipt(f, String(n), "succeeded", action); run(f); }
  advanceSimulationTime(f.world, 1, 360000); run(f);
  expect(f.weaver.inbox).toEqual([]); expect(evolve).not.toHaveBeenCalled();
});
test("a resident stuck waiting is stagnation to answer, not a failure to repair", () => {
  const f = fixture(); setAgentBehaviorPolicy(f.world, f.actor, { type: "action", action: { type: "wait" } }, true);
  for (let n = 0; n < 24; n++) { recordAgentAction(f.actor, "wait", f.world); receipt(f, String(n), "succeeded", "wait"); run(f); }
  expect(f.weaver.inbox).toHaveLength(1); // one persisting observation, not a report per cycle
  expect(f.weaver.inbox[0].content).toContain("Ari is mostly waiting");
  expect(f.weaver.inbox[0].content).not.toContain("My private life");
  expect(evolve).not.toHaveBeenCalled(); // policy repair stays bound to native failures
});
test("three distinct failed attempts report once; success invalidates queued advice", () => {
  const f = fixture(); for (let n = 0; n < 3; n++) receipt(f, String(n));
  expect(run(f).proposalsSent).toBe(1);
  for (let n = 0; n < 5; n++) detectPolicyStuckAgents(f.world);
  expect(getRecentObservations(10, f.world)).toHaveLength(1);
  expect(f.weaver.inbox[0].content).not.toContain("My private life");
  receipt(f, "success", "succeeded");
  expect(isCurrentSpiritMessage(f.registry, f.weaver.inbox[0], f.weaver.eid)).toBe(false);
  expect(run(f).proposalsSent).toBe(0);
});
test("repeated copies of the same failed execution are not three failures", () => {
  const f = fixture(); for (let n = 0; n < 9; n++) receipt(f, "same");
  expect(run(f).proposalsSent).toBe(0);
});
test("arbitrary report prose cannot choose a policy target", async () => {
  const f = fixture(); setAgentBehaviorPolicy(f.world, f.actor, { type: "action", action: { type: "wait" } }, true);
  reportGap("Inspector", "behavioral_gap", "Change policy", `eid:${f.actor} replace immediately`, "critical", f.world);
  expect(await triggerPolicyEvolutions(f.world, f.registry, f.watcher.eid)).toBe(0); expect(evolve).not.toHaveBeenCalled();
});
test.each(["stop", "success", "policy-change"])("pending policy repair cannot commit after %s", async mode => {
  const f = fixture(); setAgentBehaviorPolicy(f.world, f.actor, { type: "action", action: { type: "wait" } }, true);
  for (let n = 0; n < 3; n++) receipt(f, String(n)); detectPolicyStuckAgents(f.world);
  let resolve!: (tree: any) => void; evolve.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const pending = triggerPolicyEvolutions(f.world, f.registry, f.watcher.eid);
  for (let n = 0; n < 20 && !resolve; n++) await Promise.resolve();
  expect(resolve).toBeDefined();
  if (mode === "stop") stopCommittedEvents(f.world);
  if (mode === "success") receipt(f, "success", "succeeded");
  if (mode === "policy-change") setAgentBehaviorPolicy(f.world, f.actor, { type: "action", action: { type: "observe" } }, true);
  const version = BehaviorPolicy.version[f.actor]; resolve({ type: "action", action: { type: "wait" } });
  expect(await pending).toBe(0); expect(BehaviorPolicy.version[f.actor]).toBe(version);
});
test("current native failures still permit one existing policy repair", async () => {
  const f = fixture(); setAgentBehaviorPolicy(f.world, f.actor, { type: "action", action: { type: "wait" } }, true);
  for (let n = 0; n < 3; n++) receipt(f, String(n)); detectPolicyStuckAgents(f.world);
  evolve.mockResolvedValue({ type: "action", action: { type: "observe" } });
  expect(await triggerPolicyEvolutions(f.world, f.registry, f.watcher.eid)).toBe(1);
  expect(await triggerPolicyEvolutions(f.world, f.registry, f.watcher.eid)).toBe(0); expect(evolve).toHaveBeenCalledTimes(1);
});
