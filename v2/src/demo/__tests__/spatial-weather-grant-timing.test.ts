import { jest } from "@jest/globals";

const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { addComponent } = await import("bitecs");
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs } = await import("../../ecs/prefabs");
const { createEntityRegistry, createEcsTools } = await import("../../ecs/tools");
const { PhysicalObject, Position } = await import("../../ecs/components");
const { advanceSimulationTime } = await import("../../ecs/simulation-time");
const { workingMemoryEntityRef } = await import("../../cognition/working-memory");
const { drainPendingStimuli } = await import("../../cognition/stimulus-queue");
const { startCommittedEvents, stopCommittedEvents } = await import("../../runtime/committed-events");
const { createSpiritRegistry, createSpirit } = await import("../../spirits/spirit-registry");
const { runSpiritCognition } = await import("../../spirits/spirit-cognition");
const { ObjectManager } = await import("../../world/object-manager");
const { createSpatialWeather } = await import("../spatial-weather");
const { createSpatialStoryEvents } = await import("../spatial-story-events");

const cleanups: Array<() => void> = [];

function fixture() {
  const world = createArgosWorld("Combined narrator timing");
  initializePrefabs(world); startCommittedEvents(world);
  const advance = (ms: number) => advanceSimulationTime(world, world.time.tick + 1, ms);
  advance(5_000);
  const entities = createEntityRegistry(), ecs = createEcsTools(world, entities);
  const room = ecs.createRoom({ name: "Park" }).result.entityId;
  const roomKey = workingMemoryEntityRef(world, room)!.key;
  const tree = new ObjectManager(world).spawn("object", {
    name: "Old tree", description: "A standing ornamental tree.", containedIn: room, state: "normal",
  })!;
  PhysicalObject.portable[tree] = false;
  addComponent(world, tree, Position); Position.x[tree] = 0; Position.y[tree] = 0;
  const storyReceipts: unknown[] = [], weatherReceipts: unknown[] = [];
  const story = createSpatialStoryEvents({ world,
    trees: [{ id: tree, key: workingMemoryEntityRef(world, tree)!.key, roomId: room, roomKey }],
    running: () => true, record: receipt => storyReceipts.push(receipt),
  });
  const weather = createSpatialWeather({ world, outdoorRooms: [{ id: room, key: roomKey }],
    running: () => true, record: receipt => weatherReceipts.push(receipt),
  });
  const registry = createSpiritRegistry(world);
  const narrator = createSpirit(registry, { name: "The Narrator", domain: "narrative", rank: "archangel",
    model: "flash", systemPrompt: "Review native events.", observationInterval: 1000, canInjectEvents: true });
  weather.registerNarrator(registry, narrator, story);
  cleanups.push(() => { weather.close(); story.close(); stopCommittedEvents(world); });
  const run = () => runSpiritCognition(narrator, world, entities, registry);
  return { world, room, weather, story, weatherReceipts, storyReceipts, advance, run };
}

function weatherResponse(prompt: string, condition = "cloudy") {
  const evidence = JSON.parse(prompt.match(/ISSUED_INTERVENTION_EVIDENCE:\n([^\n]+)/)![1]);
  const evidenceIds = evidence.records.filter((record: any) => record.kind === "place" && record.subject === "Park")
    .map((record: any) => record.id);
  expect(evidenceIds).toHaveLength(1);
  return { text: JSON.stringify({ intervention: { needed: true, type: "world_effect", targetType: "room",
    target: "Park", evidenceIds, content: { operation: "weather", condition }, reason: "A native weather change." } }) };
}

beforeEach(() => {
  generate.mockReset(); drainPendingStimuli();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("Combined grant timing tests are offline"));
});
afterEach(() => {
  for (const close of cleanups.splice(0)) close();
  expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli();
});

test("combined grant supplies current simulation time and both native eligibility clocks", async () => {
  const f = fixture();
  generate.mockResolvedValueOnce({ text: JSON.stringify({ observations: [], storyProse: "" }) });
  await f.run();
  const prompt = generate.mock.calls[0][0].prompt;
  expect(prompt).toContain("Native effects:");
  expect(prompt).toContain("Current simulation time: 5000ms");
  expect(prompt).toContain("next eligible weather simulation time: 5000ms");
  expect(prompt).toContain("Earliest next event: 5000ms");
  expect(prompt).toContain('{"operation":"weather","condition":"rain"}');
  expect(prompt).toContain('{"operation":"tree_damage","tree":"exact tree name"}');
  expect(f.weatherReceipts).toEqual([]); expect(f.storyReceipts).toEqual([]);
});

test("combined grant describes cooldown waiting, and native weather admits its exact simulation boundary", async () => {
  const f = fixture(); f.advance(2_000);
  expect(f.weather.set("rain", f.room).status).toBe("applied");
  f.advance(59_999);
  generate.mockImplementationOnce(({ prompt }) => Promise.resolve(weatherResponse(prompt)));
  const early = await f.run(), waitingPrompt = generate.mock.calls[0][0].prompt;
  expect(waitingPrompt).toContain("Current simulation time: 66999ms");
  expect(waitingPrompt).toContain("next eligible weather simulation time: 67000ms");
  expect(early.interventions[0].result).toBe("rejected");
  expect(f.weather.view()).toMatchObject({ changes: 1, nextChangeAtSimMs: 67_000 });
  expect(f.weatherReceipts).toHaveLength(1);
  f.advance(1);
  generate.mockImplementationOnce(({ prompt }) => Promise.resolve(weatherResponse(prompt)));
  const exact = await f.run(), eligiblePrompt = generate.mock.calls[1][0].prompt;
  expect(eligiblePrompt).toContain("Current simulation time: 67000ms");
  expect(eligiblePrompt).toContain("next eligible weather simulation time: 67000ms");
  expect(exact.interventions[0].result).toBe("applied");
  expect(f.weather.view()).toMatchObject({ changes: 2, remainingChanges: 1, nextChangeAtSimMs: 127_000 });
  expect(f.weatherReceipts).toHaveLength(2); expect(f.storyReceipts).toEqual([]);
});

test.each(["weather", "story", "source"])("%s changes during inference still invalidate the combined native grant", async change => {
  const f = fixture();
  let finish!: (value: { text: string }) => void;
  generate.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = f.run(), prompt = generate.mock.calls[0][0].prompt;
  if (change === "weather") expect(f.weather.set("rain", f.room).status).toBe("applied");
  if (change === "story") expect(f.story.damage("Old tree", f.room).status).toBe("applied");
  if (change === "source") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
  // Mere time passage must not restore a grant whose captured state changed.
  f.advance(60_000);
  finish(weatherResponse(prompt));
  const output = await pending;
  expect(output.interventions.every(intervention => intervention.result !== "applied")).toBe(true);
  expect(f.weatherReceipts).toHaveLength(change === "weather" ? 1 : 0);
  expect(f.storyReceipts).toHaveLength(change === "story" ? 1 : 0);
  expect(f.weather.component.condition[f.room]).toBe(change === "weather" ? "rain" : "clear");
});
