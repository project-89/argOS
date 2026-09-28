import { jest } from "@jest/globals";
const ai = await import("ai"), generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createAgentEntity, createRoomEntity } = await import("../../ecs/prefabs");
const { createSystemRegistry } = await import("../../ecs/dynamic-systems");
const { startCommittedEvents, stopCommittedEvents } = await import("../../runtime/committed-events");
const { createSpiritRegistry, createSpirit } = await import("../spirit-registry");
const { createDynamicSpirit } = await import("../spirit-factory");
const { runArchitectCognition, architectFocus, ARCHITECT_NOVELTY_AFTER_EMPTY_REVIEWS } = await import("../architect-spirit");

function fixture(name = "The Weaver") {
  const world = createArgosWorld("Saltmere growth"); initializePrefabs(world); startCommittedEvents(world);
  const room = createRoomEntity(world, { name: "The Net House" });
  createAgentEntity(world, { name: "Mara", role: "returning daughter", systemPrompt: "PRIVATE_MARA", roomId: room });
  const registry = createSystemRegistry(), spirits = createSpiritRegistry(world);
  const narrator = createSpirit(spirits, { name: "The Narrator", domain: "narrative", rank: "archangel", model: "flash", systemPrompt: "Author", observationInterval: 20_000 })!;
  Object.assign(narrator.narrativeState!, { tension: 0.4, plotThreads: [{ id: "t", name: "The logbook", description: "Someone forced the Net House box.",
    participants: ["Mara", "Otis"], status: "active", tension: .5, events: [], startedAt: 0 }], dramaticQuestions: ["Who has the logbook?"] });
  const architect = createDynamicSpirit(spirits, { name, type: "architect", rank: "archangel", domain: "ecology",
    architectConfig: { canProposeEntities: true, canProposeSystems: false, canProposeComponents: false, canProposeRules: false,
      canExecuteDirectly: false, proposalApproval: "godai", maxProposalsPerCycle: 1 } })!;
  return { world, spirits, run: () => runArchitectCognition(world, registry, spirits, architect) };
}
const needsPrompts = () => generate.mock.calls.map(call => call[0].prompt as string).filter(prompt => prompt.includes("identify 0-3"));
beforeEach(() => { generate.mockReset().mockResolvedValue({ text: "[]" }); });

test("the Weaver is asked what would enrich the place, sees the story ledger, and is never told that [] is success", async () => {
  const f = fixture(); await f.run();
  const [prompt] = needsPrompts();
  expect(prompt).toContain("give these residents more to do, want and discover");
  expect(prompt).toContain("STORY LEDGER"); expect(prompt).toContain("The logbook"); expect(prompt).toContain("Who has the logbook?");
  expect(prompt).not.toMatch(/No change is a successful observation|Do not manufacture novelty|Return \[\] when|propose nothing/);
  expect(prompt).not.toContain("NOVELTY BUDGET"); expect(prompt).not.toContain("PRIVATE_MARA");
  stopCommittedEvents(f.world);
});

test("after consecutive empty reviews the novelty budget asks for at least one grounded addition", async () => {
  const f = fixture();
  for (let n = 0; n <= ARCHITECT_NOVELTY_AFTER_EMPTY_REVIEWS; n++) await f.run();
  const prompts = needsPrompts();
  expect(prompts).toHaveLength(ARCHITECT_NOVELTY_AFTER_EMPTY_REVIEWS + 1);
  expect(prompts.slice(0, -1).every(prompt => !prompt.includes("NOVELTY BUDGET"))).toBe(true);
  expect(prompts.at(-1)).toContain(`NOVELTY BUDGET: your last ${ARCHITECT_NOVELTY_AFTER_EMPTY_REVIEWS} reviews added nothing`);
  stopCommittedEvents(f.world);
});

test("Steward and Crafter read the same world through their own lens", async () => {
  expect(architectFocus("The Steward")).toContain("furnished and lived-in");
  expect(architectFocus("The Crafter")).toContain("repeatedly try to use");
  const f = fixture("The Crafter"); await f.run();
  expect(needsPrompts()[0]).toContain("You are the Crafter, maker of things");
  stopCommittedEvents(f.world);
});
