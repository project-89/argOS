import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createGodAgentEntity } = await import("../../ecs/prefabs");
const { createEntityRegistry } = await import("../../ecs/tools");
const { createSpiritRegistry, createSpirit, sendMessage } = await import("../spirit-registry");
const { runSpiritCognition } = await import("../spirit-cognition");
const { advanceSimulationTime } = await import("../../ecs/simulation-time");
const { startCommittedEvents, stopCommittedEvents } = await import("../../runtime/committed-events");
const { WorkingMemoryIdentity } = await import("../../ecs/components");
const { removeEntity } = await import("bitecs");
const { initializeSpiritSystem, startSpiritSystem, stopSpiritSystem } = await import("../spirit-system");

function fixture() {
  const world = createArgosWorld("Supervisor cycle"); initializePrefabs(world); startCommittedEvents(world);
  advanceSimulationTime(world, 1, 1000);
  const entities = createEntityRegistry(), registry = createSpiritRegistry(world);
  const definition = { domain: "narrative" as const, rank: "archangel" as const, model: "flash" as const, systemPrompt: "Observe actual state.", observationInterval: 1000 };
  const superior = createSpirit(registry, { ...definition, name: "Supervisor" });
  const alternate = createSpirit(registry, { ...definition, name: "Alternate" });
  const spirit = createSpirit(registry, { ...definition, name: "Observer" }, superior.eid);
  sendMessage(registry, superior.eid, spirit.eid, "report", "Input", "An observed event.");
  const god = createGodAgentEntity(world, { name: "God", worldName: "Supervisor cycle" });
  const completions: ((text: string) => void)[] = [];
  generate.mockImplementation(() => new Promise(resolve => completions.push(text => resolve({ text }))));
  const run = () => runSpiritCognition(spirit, world, entities, registry);
  const complete = (index = 0, label = "Old") => completions[index](JSON.stringify({ thoughts: `${label} interpretation`,
    observations: [{ content: `${label} observation` }], reportToSuperior: { needed: true, subject: `${label} report`, content: "Consider the observed event." },
    narrativeUpdate: { tension: label === "Old" ? 0.9 : 0.2 }, storyProse: "The room is quiet." }));
  return { world, registry, spirit, superior, alternate, god, run, complete };
}
beforeEach(() => { generate.mockReset(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No live inference in cycle tests")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test.each(["stop", "restart", "replace"])("managed spirit %s retires pending writes even within the same world epoch", async boundary => {
  const world = createArgosWorld("Managed lifetime"); initializePrefabs(world); startCommittedEvents(world);
  const state = initializeSpiritSystem(world, { autoCreateNarrator: false }); startSpiritSystem(world);
  const spirit = createSpirit(state.registry, { name: "Observer", domain: "narrative", rank: "archangel",
    model: "flash", systemPrompt: "Observe.", observationInterval: 1 });
  let release!: (value: { text: string }) => void;
  generate.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const baseline = structuredClone(spirit);
  const pending = runSpiritCognition(spirit, world, createEntityRegistry(), state.registry);
  if (boundary === "replace") initializeSpiritSystem(world, { autoCreateNarrator: false });
  else { stopSpiritSystem(world); if (boundary === "restart") startSpiritSystem(world); }
  release({ text: JSON.stringify({ thoughts: "Stale interpretation", observations: [{ content: "Stale observation" }],
    narrativeUpdate: { tension: 0.9 }, storyProse: "Stale scene" }) });
  const output = await pending;
  expect(output.discarded).toBe("stale_cycle");
  expect(spirit.shortTermMemory).toEqual(baseline.shortTermMemory);
  expect(spirit.observations).toEqual(baseline.observations);
  expect(spirit.narrativeState).toEqual(baseline.narrativeState);
  expect(state.registry.messageQueue).toEqual([]);
  stopCommittedEvents(world);
});

test.each(["stop", "restart", "removed", "replaced", "prompt", "permissions", "rewind"])("%s prevents every late output, not just interventions", async change => {
  const f = fixture(), baseline = structuredClone(f.spirit), pending = f.run();
  if (change === "stop") stopCommittedEvents(f.world);
  if (change === "restart") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
  if (change === "removed") removeEntity(f.world, f.spirit.eid);
  if (change === "replaced") f.registry.spirits.set(f.spirit.eid, { ...f.spirit });
  if (change === "prompt") f.spirit.definition.systemPrompt = "New supervisor.";
  if (change === "permissions") f.spirit.definition.canInjectEvents = false;
  if (change === "rewind") f.world.time.elapsed = 0;
  f.complete(); const output = await pending;
  expect(output.observations).toEqual([]); expect(output.reports).toEqual([]); expect(output.storyProse).toBeUndefined();
  expect(f.spirit.observations).toEqual(baseline.observations);
  expect(f.spirit.shortTermMemory).toEqual(baseline.shortTermMemory);
  expect(f.spirit.narrativeState).toEqual(baseline.narrativeState);
  expect(f.spirit.lastObservationTime).toBe(baseline.lastObservationTime);
  expect(f.spirit.inbox).toEqual(baseline.inbox);
  expect(f.superior.inbox).toEqual([]); expect(f.registry.messageQueue).toEqual([]);
  expect(output.discarded).toBe("stale_cycle");
});

test("unchanged supervisor gets one report and the valid cycle is acknowledged", async () => {
  const f = fixture(), pending = f.run(); f.complete(); const output = await pending;
  expect(output.reports).toHaveLength(1); expect(f.superior.inbox.map(row => row.subject)).toEqual(["Old report"]);
  expect(f.spirit.inbox).toEqual([]); expect(f.spirit.narrativeState?.tension).toBe(0.9);
});

test.each(["superior", "superiorReplacement", "god", "godOwner"])("%s change cannot retarget a pending report", async change => {
  const f = fixture();
  if (change.startsWith("god")) { f.spirit.superiorEid = undefined; f.registry.godAgentEid = f.god; }
  const pending = f.run();
  if (change === "superior") f.spirit.superiorEid = f.alternate.eid;
  if (change === "superiorReplacement") f.registry.spirits.set(f.superior.eid, { ...f.superior });
  if (change === "god") f.registry.godAgentEid = f.alternate.eid;
  if (change === "godOwner") WorkingMemoryIdentity.id[f.god] = "replacement-god";
  f.complete(); await pending;
  expect(f.superior.inbox).toEqual([]); expect(f.alternate.inbox).toEqual([]);
  expect(f.registry.messageQueue).toEqual([]); expect(f.spirit.outbox).toEqual([]);
});

test("an older overlapping cycle cannot overwrite a newer accepted interpretation", async () => {
  const f = fixture(), older = f.run(), newer = f.run(); f.complete(1, "New"); await newer;
  f.complete(0); const output = await older;
  expect(output.storyProse).toBeUndefined();
  expect(f.spirit.narrativeState?.tension).toBe(0.2);
  expect(f.spirit.shortTermMemory).toEqual(["New interpretation"]);
  expect(f.superior.inbox.map(row => row.subject)).toEqual(["New report"]);
});

test("current God receives the actual report queue entry", async () => {
  const f = fixture(); f.spirit.superiorEid = undefined; f.registry.godAgentEid = f.god;
  const pending = f.run(); f.complete(); await pending;
  expect(f.registry.messageQueue.map(row => ({ to: row.to, subject: row.subject }))).toEqual([{ to: f.god, subject: "Old report" }]);
  expect(f.spirit.inbox).toEqual([]);
});

test("an unrelated God change does not invalidate an unchanged explicit superior", async () => {
  const f = fixture(), pending = f.run(); f.registry.godAgentEid = f.god; f.complete(); await pending;
  expect(f.superior.inbox.map(row => row.subject)).toEqual(["Old report"]);
  expect(f.registry.messageQueue).toEqual([]);
});

test("discarded hierarchy output leaves input available for a fresh cycle", async () => {
  const f = fixture(), pending = f.run(); f.spirit.superiorEid = f.alternate.eid; f.complete(); await pending;
  expect(f.spirit.inbox.map(row => row.subject)).toEqual(["Input"]);
  const next = f.run(); f.complete(1, "New"); await next;
  expect(f.spirit.inbox).toEqual([]);
  expect(f.alternate.inbox.map(row => row.subject)).toEqual(["New report"]);
  expect(f.superior.inbox).toEqual([]);
});

test("a stopped source does not start inference", async () => {
  const f = fixture(); stopCommittedEvents(f.world);
  expect((await f.run()).discarded).toBe("stale_cycle");
  expect(generate).not.toHaveBeenCalled(); expect(f.spirit.inbox).toHaveLength(1);
});

test("a stale provider failure cannot write an error into the replacement cycle's memory", async () => {
  const f = fixture(); let fail!: (error: Error) => void;
  generate.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  const pending = f.run(); stopCommittedEvents(f.world); startCommittedEvents(f.world);
  fail(new Error("Old provider request failed")); const output = await pending;
  expect(output.discarded).toBe("stale_cycle");
  expect(f.spirit.shortTermMemory).toEqual([]); expect(f.spirit.inbox).toHaveLength(1);
  expect(f.superior.inbox).toEqual([]);
});
