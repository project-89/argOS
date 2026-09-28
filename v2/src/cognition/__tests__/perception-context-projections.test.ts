import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { addComponent, addEntity } = await import("bitecs");
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createAgentEntity, createRoomEntity } = await import("../../ecs/prefabs");
const { Name, Description, Traits } = await import("../../ecs/components");
const { setLocatedIn } = await import("../../ecs/location");
const { createIntentGoal } = await import("../cognition-system");
const { generatePlanForGoal } = await import("../planning-system");
const { generateSchedule } = await import("../schedule-system");
const { generateAutonomousGoal, resetAutonomousGoals } = await import("../autonomous-goals");
const { registerAgentWorldCapabilities } = await import("../world-capabilities");

function fixture() {
  const world = createArgosWorld("Projection boundaries"); world.meta.aiEnabled = true; initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Workshop" }); Description.value[room] = "UNSEEN_WALL_COLOR";
  const actor = createAgentEntity(world, { name: "Mara", role: "resident", systemPrompt: "MY_PRIVATE_IDENTITY", roomId: room });
  addComponent(world, actor, Traits); Traits.active[actor] = JSON.stringify(["blind"]);
  createAgentEntity(world, { name: "UNSEEN_PERSON", role: "PRIVATE_OTHER_ROLE", systemPrompt: "PRIVATE_OTHER_MIND", roomId: room });
  const object = addEntity(world), held = addEntity(world);
  addComponent(world, object, Name); Name.value[object] = "UNSEEN_MACHINE"; setLocatedIn(world, object, room);
  addComponent(world, held, Name); Name.value[held] = "KNOWN_KEY"; setLocatedIn(world, held, actor);
  registerAgentWorldCapabilities(world, actor, { context: () => "", ready: () => true, busy: () => false, execute: () => false,
    affordances: target => target === held || target === object ? [{ name: "use", requires: [] }] : [] });
  const goal = createIntentGoal(world, actor, "Consider what to do next", 5);
  return { world, actor, goal };
}
let oldKey: string | undefined;
beforeEach(() => {
  oldKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY; process.env.GOOGLE_GENERATIVE_AI_API_KEY = "mock-only";
  generate.mockReset(); resetAutonomousGoals();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No paid projection calls"));
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks();
  if (oldKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY; else process.env.GOOGLE_GENERATIVE_AI_API_KEY = oldKey;
});

test("planner receives held tools and authored room names, not hidden visual information", async () => {
  const f = fixture();
  generate.mockResolvedValue({ text: JSON.stringify({ goalDescription: "Consider what to do next", estimatedCompletion: "short", potentialObstacles: [],
    steps: [{ description: "Use the known key", actionType: "interact", target: "KNOWN_KEY", content: "use" }] }) });
  await generatePlanForGoal(f.world, f.actor, f.goal);
  expect(generate).toHaveBeenCalled();
  const system = generate.mock.calls[0][0].system;
  expect(system).toContain("KNOWN_KEY: your possession (not currently seen); native actions: drop");
  expect(system).not.toMatch(/KNOWN_KEY: .*use/);
  expect(system).toContain("Workshop");
  expect(system).not.toMatch(/UNSEEN_|PRIVATE_OTHER/);
});

test("autonomous goal projection uses the same visual boundary and retains possessions", async () => {
  const f = fixture();
  generate.mockResolvedValue({ text: JSON.stringify({ goal: "Think about tomorrow", motivation: "My own priorities", priority: 3, kind: "custom" }) });
  await generateAutonomousGoal(f.world, f.actor);
  expect(generate).toHaveBeenCalled();
  const content = generate.mock.calls[0][0].messages.map((m: { content: string }) => m.content).join("\n");
  expect(content).toContain("KNOWN_KEY"); expect(content).toContain("MY_PRIVATE_IDENTITY");
  expect(content).toContain("not established through sight"); expect(content).not.toMatch(/UNSEEN_|PRIVATE_OTHER/);
});

test("schedule context exposes authored location names but no current private scene state", async () => {
  const f = fixture(); generate.mockResolvedValue({ text: "{}" });
  await generateSchedule(f.world, f.actor);
  expect(generate).toHaveBeenCalled();
  const system = generate.mock.calls[0][0].system;
  expect(system).toContain("Workshop"); expect(system).not.toMatch(/UNSEEN_|PRIVATE_OTHER/);
});
