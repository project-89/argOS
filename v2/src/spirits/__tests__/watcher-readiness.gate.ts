/** Outcome-based Watcher diagnostics. No real policy generation or live inference. */
import { jest } from "@jest/globals";
const evolve = jest.fn<(...args: any[]) => Promise<null>>().mockResolvedValue(null);
jest.unstable_mockModule("../../cognition/policy-generator.js", () => ({ evolvePolicy: evolve, canEvolvePolicy: () => false }));
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createRoomEntity, createAgentEntity } = await import("../../ecs/prefabs");
const { createPersonalIntention } = await import("../../cognition/goal-lifecycle");
const { startCommittedEvents, publishCommittedEvent } = await import("../../runtime/committed-events");
const { createSpiritRegistry, createSpirit } = await import("../spirit-registry");
const { recordAgentAction, runObservationSynthesis, resetWatcherState } = await import("../watcher-spirit");
const { getObservationsByCategory, reportGap, resetAggregator } = await import("../observation-aggregator");
const { resetAllPolicyMetrics } = await import("../../cognition/policy-metrics");

function fixture() {
  const world = createArgosWorld("Watcher readiness"); initializePrefabs(world); startCommittedEvents(world);
  const room = createRoomEntity(world, { name: "Gate workshop" });
  const actor = createAgentEntity(world, { name: "Gate craftsperson", role: "maker", systemPrompt: "Complete my work.", roomId: room });
  const registry = createSpiritRegistry(world);
  const definition = { domain: "guardian" as const, rank: "archangel" as const, model: "flash" as const,
    systemPrompt: "Observe.", observationInterval: 1000 };
  const watcher = createSpirit(registry, { ...definition, name: "The Watcher" });
  const weaver = createSpirit(registry, { ...definition, name: "The Weaver" });
  return { world, actor, room, registry, watcher, weaver };
}
beforeEach(() => {
  resetWatcherState(); resetAggregator(); resetAllPolicyMetrics(); evolve.mockClear();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline gate"));
});
afterEach(async () => {
  await Promise.resolve(); await Promise.resolve();
  expect(globalThis.fetch).not.toHaveBeenCalled(); expect(evolve).not.toHaveBeenCalled();
  resetWatcherState(); resetAggregator(); resetAllPolicyMetrics(); jest.restoreAllMocks();
});

test("W1: no observations means no manufactured work request", () => {
  const f = fixture();
  expect(runObservationSynthesis(f.world, f.registry, f.watcher.eid).proposalsSent).toBe(0);
  expect(f.weaver.inbox).toEqual([]);
});

test("W2: repetitive successful work is not evidence of blocked behavior", () => {
  const f = fixture(); createPersonalIntention(f.world, f.actor, "Inspect the twelve finished parts", 5);
  for (let cycle = 0; cycle < 3; cycle++) {
    for (let n = 0; n < 8; n++) {
      recordAgentAction(f.actor, "examine", f.world);
      publishCommittedEvent(f.world, { kind: "action", actorId: f.actor, roomId: f.room, action: "examine", status: "succeeded",
        executionId: `gate-part-${cycle}-${n}` });
    }
    runObservationSynthesis(f.world, f.registry, f.watcher.eid);
  }
  expect(getObservationsByCategory("behavioral_gap", f.world).filter(gap => gap.title.includes("Gate craftsperson"))).toEqual([]);
  expect(f.weaver.inbox).toEqual([]);
});

test("W3: an explicitly reported current gap reaches the architect without building or acting", () => {
  const f = fixture();
  reportGap("Gate inspector", "system_missing", "Gate gauge cannot update", "A gauge requires an integration system.", "high", f.world);
  expect(runObservationSynthesis(f.world, f.registry, f.watcher.eid).proposalsSent).toBe(1);
  expect(f.weaver.inbox).toHaveLength(1); expect(f.weaver.inbox[0].content).toContain("Gate gauge cannot update");
});

test("W4: another world's repeated activity cannot become this world's growth request", () => {
  const a = fixture(), b = fixture();
  for (let n = 0; n < 8; n++) recordAgentAction(a.actor, "examine", a.world);
  for (let cycle = 0; cycle < 3; cycle++) runObservationSynthesis(b.world, b.registry, b.watcher.eid);
  expect(b.weaver.inbox).toEqual([]);
  expect(getObservationsByCategory("behavioral_gap", b.world)).toEqual([]);
});
