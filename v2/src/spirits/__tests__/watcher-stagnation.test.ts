import { jest } from "@jest/globals";
const evolve = jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue(null);
jest.unstable_mockModule("../../cognition/policy-generator.js", () => ({ evolvePolicy: evolve, canEvolvePolicy: () => true }));
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createAgentEntity, createRoomEntity, createGodAgentEntity } = await import("../../ecs/prefabs");
const { createObjectEntity } = await import("../../ecs/prefabs");
const { addComponent } = await import("bitecs");
const { PhysicalObject } = await import("../../ecs/components");
const { startCommittedEvents, publishCommittedEvent } = await import("../../runtime/committed-events");
const { advanceSimulationTime } = await import("../../ecs/simulation-time");
const { createPersonalIntention } = await import("../../cognition/goal-lifecycle");
const { createSpiritRegistry, createSpirit, setGodAgent, getMessagesForGodAI } = await import("../spirit-registry");
const { isCurrentSpiritMessage } = await import("../spirit-message-delivery");
const { resetAggregator, isCurrentGapObservation } = await import("../observation-aggregator");
const { recordAgentAction, runObservationSynthesis, detectStagnation, resetWatcherState, STAGNATION_LIMITS } = await import("../watcher-spirit");

let tick = 0;
function fixture() {
  tick = 0;
  const world = createArgosWorld("Saltmere watch"); initializePrefabs(world); startCommittedEvents(world);
  const cafe = createRoomEntity(world, { name: "The Waking Gull" }), house = createRoomEntity(world, { name: "Gull House" });
  const tess = createAgentEntity(world, { name: "Tess", role: "cafe keeper", systemPrompt: "TESS_PRIVATE", roomId: cafe });
  const ivo = createAgentEntity(world, { name: "Ivo", role: "neighbor", systemPrompt: "IVO_PRIVATE", roomId: cafe });
  const otis = createAgentEntity(world, { name: "Otis", role: "salvager", systemPrompt: "OTIS_PRIVATE", roomId: house });
  const registry = createSpiritRegistry(world), god = createGodAgentEntity(world, { name: "God" }); setGodAgent(registry, god);
  const def = { domain: "guardian" as const, rank: "archangel" as const, model: "flash" as const, systemPrompt: "Observe", observationInterval: 1000 };
  const watcher = createSpirit(registry, { ...def, name: "The Watcher" })!, weaver = createSpirit(registry, { ...def, name: "The Weaver" })!;
  const narrator = createSpirit(registry, { ...def, domain: "narrative", name: "The Narrator" })!;
  return { world, cafe, house, tess, ivo, otis, registry, god, watcher, weaver, narrator };
}
const advance = (f: ReturnType<typeof fixture>, ms: number) => advanceSimulationTime(f.world, ++tick, ms);
const titles = (rows: { title: string }[]) => rows.map(row => row.title);
beforeEach(() => { resetWatcherState(); resetAggregator(); evolve.mockClear(); });

test("a resident spending most recent choices waiting is flagged; a busy one is not", () => {
  const f = fixture();
  for (let n = 0; n < 8; n++) recordAgentAction(f.tess, n < 6 ? "wait" : "speak", f.world);
  for (let n = 0; n < 8; n++) recordAgentAction(f.ivo, n < 2 ? "rest" : "examine", f.world);
  const found = detectStagnation(f.world, f.registry);
  expect(titles(found)).toContain("Tess is mostly waiting"); expect(titles(found)).not.toContain("Ivo is mostly waiting");
  const idle = found.find(row => row.title === "Tess is mostly waiting")!;
  expect(idle).toMatchObject({ source: "The Watcher", category: "behavioral_gap" });
  for (let n = 0; n < 10; n++) recordAgentAction(f.tess, "examine", f.world);
  expect(isCurrentGapObservation(idle)).toBe(false); // resolved stagnation stops travelling
});

test("two residents sharing a room in silence for over 40s is flagged; speech clears it", () => {
  const f = fixture();
  detectStagnation(f.world, f.registry); advance(f, STAGNATION_LIMITS.quietCompanyMs - 1_000);
  expect(titles(detectStagnation(f.world, f.registry))).not.toContain("Silent company in The Waking Gull");
  advance(f, 2_000);
  const quiet = detectStagnation(f.world, f.registry).find(row => row.title === "Silent company in The Waking Gull")!;
  expect(quiet).toMatchObject({ category: "social_gap", affectedEntities: expect.arrayContaining(["Tess", "Ivo"]) });
  expect(titles(detectStagnation(f.world, f.registry))).not.toContain("Silent company in Gull House"); // Otis is alone
  publishCommittedEvent(f.world, { executionId: "hello", kind: "speech", action: "speak", actorId: f.tess, roomId: f.cafe, status: "succeeded", text: "Morning." });
  expect(isCurrentGapObservation(quiet)).toBe(false);
  expect(titles(detectStagnation(f.world, f.registry))).not.toContain("Silent company in The Waking Gull");
});

test("flat story tension across Narrator reviews is flagged; movement clears it", () => {
  const f = fixture(); f.narrator.narrativeState!.tension = 0.3;
  for (let n = 0; n < STAGNATION_LIMITS.flatTensionReviews - 1; n++) { expect(titles(detectStagnation(f.world, f.registry))).not.toContain("Story tension is flat"); advance(f, 20_000); }
  const flat = detectStagnation(f.world, f.registry).find(row => row.title === "Story tension is flat")!;
  expect(flat).toMatchObject({ category: "narrative_gap", severity: "high" });
  f.narrator.narrativeState!.tension = 0.7; advance(f, 20_000);
  expect(titles(detectStagnation(f.world, f.registry))).not.toContain("Story tension is flat");
});

test("a goal without progress for two minutes is flagged", () => {
  const f = fixture(); createPersonalIntention(f.world, f.otis, "Sell the salvage before anyone asks", 7);
  detectStagnation(f.world, f.registry); advance(f, STAGNATION_LIMITS.stuckGoalMs + 1_000);
  expect(detectStagnation(f.world, f.registry).find(row => row.title === "Otis is stuck on a goal")?.detail).toContain("Sell the salvage");
});

test("story objects nobody has handled are flagged; handling one retires the observation", () => {
  const f = fixture(); const logbook = createObjectEntity(f.world, { name: "Marrow Star logbook", description: "Water-stained.", roomId: f.house });
  addComponent(f.world, logbook, PhysicalObject); PhysicalObject.portable[logbook] = true;
  detectStagnation(f.world, f.registry); advance(f, STAGNATION_LIMITS.untouchedObjectMs + 1_000);
  const untouched = detectStagnation(f.world, f.registry).find(row => row.title === "Story objects nobody has touched")!;
  expect(untouched.affectedEntities).toEqual(["Marrow Star logbook"]);
  publishCommittedEvent(f.world, { executionId: "take", kind: "action", action: "take", actorId: f.otis, roomId: f.house, targetId: logbook, status: "succeeded" });
  expect(isCurrentGapObservation(untouched)).toBe(false);
});

test("stagnation is relayed to the Narrator's inbox and to God's review queue, without private minds and without per-cycle spam", () => {
  const f = fixture();
  for (let n = 0; n < 8; n++) { recordAgentAction(f.tess, "wait", f.world); recordAgentAction(f.ivo, "wait", f.world); }
  detectStagnation(f.world, f.registry); advance(f, 45_000);
  for (let n = 0; n < 4; n++) { runObservationSynthesis(f.world, f.registry, f.watcher.eid); advance(f, 5_000); }
  const story = f.narrator.inbox.filter(m => m.subject === "[Watcher] The story is sagging");
  expect(story).toHaveLength(1); expect(isCurrentSpiritMessage(f.registry, story[0], f.narrator.eid)).toBe(true);
  expect(story[0].content).toContain("Tess is mostly waiting"); expect(story[0].content).toContain("Silent company in The Waking Gull");
  const god = getMessagesForGodAI(f.registry).filter(m => m.subject === "[Watcher] The world needs something to happen");
  expect(god).toHaveLength(1); expect(god[0].content).toContain("staging an event");
  expect(["normal", "high"]).toContain(god[0].priority);
  const weaver = f.weaver.inbox.filter(m => m.subject.startsWith("[Watcher]"));
  expect(weaver).toHaveLength(1); // persisting stagnation is one observation, not a report per cycle
  for (const message of [...story, ...god, ...weaver]) expect(message.content).not.toMatch(/TESS_PRIVATE|IVO_PRIVATE|OTIS_PRIVATE/);
  expect(evolve).not.toHaveBeenCalled();
  // Resolution retires the relayed story message.
  for (let n = 0; n < 10; n++) { recordAgentAction(f.tess, "speak", f.world); recordAgentAction(f.ivo, "speak", f.world); }
  publishCommittedEvent(f.world, { executionId: "talk", kind: "speech", action: "speak", actorId: f.ivo, roomId: f.cafe, status: "succeeded", text: "Tess." });
  expect(isCurrentSpiritMessage(f.registry, story[0], f.narrator.eid)).toBe(false);
});
