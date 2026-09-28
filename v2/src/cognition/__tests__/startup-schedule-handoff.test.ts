import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createSimulation } = await import("../../index");
const { createObjectEntity } = await import("../../ecs/prefabs");
const { Goal } = await import("../../ecs/components");
const { getDirectContainer } = await import("../../ecs/location");
const { runWorldTickAt } = await import("../../god/god-agent");
const { agentThink, addPerception } = await import("../agent-mind");
const { createIntentGoal, executeActions } = await import("../cognition-system");
const { createPlanEntity } = await import("../planning-system");
const { isDiscardedForegroundDecision } = await import("../foreground-action-admission");
const { getSchedule } = await import("../schedule-system");
const { chronicle } = await import("../simulation-chronicle");
const { advanceSimulationTimeline } = await import("../../runtime/simulation-timeline");

let previousKey: string | undefined;
beforeEach(() => {
  previousKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "mock-only";
  generate.mockReset();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline handoff regression"));
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  jest.restoreAllMocks();
  if (previousKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  else process.env.GOOGLE_GENERATIVE_AI_API_KEY = previousKey;
});

async function fixture() {
  const sim = await createSimulation({ name: "Startup handoff", preset: "minimal", enableAI: false,
    enableSpirits: false, evolution: false, codingDaemons: false, enableNarrativeEngine: false,
    godAutopilot: false, enableServer: false, dualLoop: false,
    rooms: [{ name: "Home" }, { name: "Workshop" }],
    agents: [{ name: "Resident", role: "visitor", startRoom: "Home" }] });
  sim.world.meta.aiEnabled = true; // Only the mocked foreground is enabled; never start AI loops.
  sim.world.time.simulationHour = 18;
  const actor = sim.god.registry.byName.get("Resident")!, room = sim.god.registry.byName.get("Home")!;
  const phone = createObjectEntity(sim.world, { name: "My phone", roomId: room, portable: true, traits: ["takeable"] });
  const purpose = createIntentGoal(sim.world, actor, "Understand the strange marks on the workshop box", 7);
  return { sim, actor, phone, purpose };
}

test("baseline schedules are installed before the first world tick or cognition request", async () => {
  const { sim, actor } = await fixture();
  try { expect(getSchedule(sim.world, actor)).toBeDefined(); }
  finally { sim.stop(); }
});

test("late routine maintenance and a background plan do not erase the first chosen pickup", async () => {
  const { sim, actor, phone, purpose } = await fixture();
  const log = jest.spyOn(chronicle, "record");
  try {
    // Native fast tick precedes cognition in the live loop. Previously it had
    // no schedule to project, because baseline installation was async-only.
    runWorldTickAt(sim.god, 1, 100);
    addPerception(sim.world, actor, { type: "attention", source: "local observation", content: "Time to decide what to take on my visit." });
    generate.mockImplementation(async () => {
      const system = sim.god.systemRegistry.systems.get("DailySchedulePlanner")!;
      await system.compiledFn!(sim.world, { log: () => {} } as any);
      runWorldTickAt(sim.god, 2, 1000);
      createPlanEntity(sim.world, actor, purpose, { goalDescription: "Understand the strange marks on the workshop box", steps: [
        { description: "Go to the workshop", actionType: "move", target: "Workshop" },
      ] });
      return { text: JSON.stringify({ innerThought: "I'll bring my phone with me.",
        control: { version: 2, purpose: "Take my phone before leaving", goalId: null, localDependencies: [] },
        action: { type: "pickup", target: "My phone" } }) };
    });
    const action = await agentThink(sim.world, actor);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(log.mock.calls.filter(([type]) => type === "decision_superseded" || type === "decision_rejected")).toEqual([]);
    expect(isDiscardedForegroundDecision(action)).toBe(false);
    expect(action.type).toBe("pickup");
    executeActions(sim.world, [{ eid: actor, action }], sim.god.systemRegistry);
    // Admission is not completion: let the native timed pickup finish.
    expect(getDirectContainer(sim.world, phone)).not.toBe(actor);
    advanceSimulationTimeline(sim.world, 5000, { integrate: () => {} });
    expect(getDirectContainer(sim.world, phone)).toBe(actor);
    expect(Goal.status[purpose]).toBe("active");
    expect(generate).toHaveBeenCalledTimes(1);
  } finally { sim.stop(); }
});

test("a genuinely new intention during inference still rejects the outdated pickup", async () => {
  const { sim, actor, phone } = await fixture();
  const log = jest.spyOn(chronicle, "record");
  try {
    runWorldTickAt(sim.god, 1, 100);
    addPerception(sim.world, actor, { type: "attention", source: "local observation", content: "Time to decide what to take on my visit." });
    generate.mockImplementation(async () => {
      createIntentGoal(sim.world, actor, "Help my neighbor with a new urgent problem", 9);
      return { text: JSON.stringify({ innerThought: "I'll bring my phone with me.",
        control: { version: 2, purpose: "Take my phone before leaving", goalId: null, localDependencies: [] },
        action: { type: "pickup", target: "My phone" } }) };
    });
    const action = await agentThink(sim.world, actor);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(isDiscardedForegroundDecision(action)).toBe(true);
    expect(log.mock.calls).toContainEqual(["decision_superseded", expect.objectContaining({ reason: "goal_changed", boundary: "response" })]);
    executeActions(sim.world, [{ eid: actor, action }], sim.god.systemRegistry);
    advanceSimulationTimeline(sim.world, 5000, { integrate: () => {} });
    expect(getDirectContainer(sim.world, phone)).not.toBe(actor);
  } finally { sim.stop(); }
});
