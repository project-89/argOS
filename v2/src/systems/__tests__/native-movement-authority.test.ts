import { jest } from "@jest/globals";
import type { SystemDefinition } from "../../ecs/dynamic-systems";

const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { addComponent, addEntity, getRelationTargets } = await import("bitecs");
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createAgentEntity, createRoomEntity } = await import("../../ecs/prefabs");
const { Goal, GridPosition, Needs, Room, Schedule, WorkingMemoryIdentity } = await import("../../ecs/components");
const { HasGoal, HasSchedule } = await import("../../ecs/relations");
const { getDirectContainer } = await import("../../ecs/location");
const { createSystemRegistry, registerSystem, runSystems } = await import("../../ecs/dynamic-systems");
const { registerAgentWorldCapabilities } = await import("../../cognition/world-capabilities");
const { createIntentGoal, executeActions } = await import("../../cognition/cognition-system");
const { setGoalContract } = await import("../../cognition/goal-contract");
const { selectFastAgentAction } = await import("../../cognition/agent-mind");
const { integrateActorContinuation, updateActorContinuation } = await import("../../cognition/actor-continuation");
const { captureCoordinationGoal } = await import("../../cognition/coordination-memory");
const { workingMemoryEntityRef } = await import("../../cognition/working-memory");
const { advanceSimulationTimeline } = await import("../../runtime/simulation-timeline");
const { getCommittedEvents } = await import("../../runtime/committed-events");
const { drainPendingStimuli } = await import("../../cognition/stimulus-queue");
const { createGoalPursuitSystem, createMovementSystem, createRoomArrivalSystem, clearMovementTarget,
  getMovementTarget, setMovementTarget } = await import("../builtin-systems");
const { goalPursuitSystem, scheduleExecutionSystem, needsBasedMovementSystem } = await import("../deterministic-behavior-systems");

let oldKey: string | undefined;
beforeEach(() => {
  oldKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "offline-movement-test";
  generate.mockReset().mockResolvedValue({ text: '{"memories":[],"beliefs":[],"impressions":[]}' });
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Movement authority tests cannot use a network"));
  drainPendingStimuli();
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli();
  if (oldKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  else process.env.GOOGLE_GENERATIVE_AI_API_KEY = oldKey;
});

const wrapped = (name: string, compiledFn: SystemDefinition["compiledFn"]): SystemDefinition => ({
  name, description: "Offline movement authority fixture", pseudocode: "", active: true,
  frequency: 0, lastRun: 0, compiledFn,
});
const pursuers = [
  ["grid", () => createGoalPursuitSystem()],
  ["legacy direct-room", () => wrapped("LegacyGoalPursuit", goalPursuitSystem)],
] as const;

function fixture(aiEnabled: boolean | undefined = true, candidate: "schedule" | "need" = "schedule") {
  const world = createArgosWorld("Native actor movement authority"); initializePrefabs(world);
  world.meta.aiEnabled = aiEnabled; world.time.simulationHour = 13;
  const living = createRoomEntity(world, { name: "Living Room", x: 50, y: 50 });
  const kitchen = createRoomEntity(world, { name: "Kitchen", x: 170, y: 50 });
  const study = createRoomEntity(world, { name: "Study", x: 290, y: 50 });
  Room.ambience[living] = "home";
  const actor = createAgentEntity(world, { name: "Elaine", role: "resident", systemPrompt: "Choose what to do.",
    roomId: kitchen, gridPosition: { x: 8, y: 2 } });
  clearMovementTarget(actor);
  const close = registerAgentWorldCapabilities(world, actor, {
    // The apartment delegates native movement; this is not package-owned locomotion.
    context: () => "", ready: () => true, busy: () => false, execute: () => false,
  });
  const personal = createIntentGoal(world, actor, "Check my phone before deciding what to do", 9);
  const run = (definition: SystemDefinition, delta = 500) => {
    const registry = createSystemRegistry();
    registerSystem(registry, { ...definition, frequency: 0, lastRun: 0 });
    runSystems(world, registry, 1, delta);
    expect(registry.errors).toEqual([]);
    return registry.events;
  };
  if (candidate === "schedule") {
    const schedule = addEntity(world); addComponent(world, schedule, Schedule);
    addComponent(world, actor, HasSchedule(schedule));
    Schedule.activities[schedule] = JSON.stringify([{ name: "afternoon_work", startHour: 13, duration: 4, location: "Living Room" }]);
    run(wrapped("ScheduleFixture", scheduleExecutionSystem));
  } else {
    Needs.energy[actor] = 20; Needs.hunger[actor] = 0; Needs.social[actor] = 80;
    run(wrapped("NeedFixture", needsBasedMovementSystem));
  }
  const background = getRelationTargets(world, actor, HasGoal).find(id => Goal.kind[id] === "move_to_room")!;
  expect(background).toBeDefined(); expect(Goal.priority[background]).toBeLessThan(Goal.priority[personal]);
  const settleGrid = () => {
    const movement = createMovementSystem(), arrival = createRoomArrivalSystem();
    for (let step = 0; step < 6; step++) { run(movement); run(arrival); }
  };
  return { world, actor, kitchen, living, study, personal, background, run, settleGrid,
    close: () => { close(); clearMovementTarget(actor); } };
}

describe.each(pursuers)("%s pursuit", (_label, create) => {
  test.each(["schedule", "need"] as const)("an active %s goal cannot commandeer a live native actor", candidate => {
    const f = fixture(true, candidate);
    try {
      f.run(create()); f.settleGrid();
      expect(getMovementTarget(f.actor)).toBeUndefined();
      expect(getDirectContainer(f.world, f.actor)).toBe(f.kitchen);
      expect(GridPosition.x[f.actor]).toBe(8);
      expect(Goal.status[f.personal]).toBe("active");
      expect(Goal.status[f.background]).toBe("active");
      expect(getCommittedEvents(f.world).events).toEqual([]);
    } finally { f.close(); }
  });
  test.each([false, undefined])("no-AI/legacy movement remains available (aiEnabled=%s)", aiEnabled => {
    const f = fixture(aiEnabled);
    // The default argument is true, so explicitly restore the legacy undefined case.
    f.world.meta.aiEnabled = aiEnabled;
    try {
      f.run(create()); f.settleGrid();
      expect(getDirectContainer(f.world, f.actor)).toBe(f.living);
      expect(GridPosition.x[f.actor]).toBeLessThan(5);
    } finally { f.close(); }
  });
});

test("background pursuit cannot replace an explicitly installed native grid target", () => {
  const f = fixture();
  try {
    setMovementTarget(f.actor, f.study); f.run(createGoalPursuitSystem());
    expect(getMovementTarget(f.actor)).toBe(f.study);
    f.run(createMovementSystem()); expect(GridPosition.x[f.actor]).toBe(9);
    expect(Goal.status[f.background]).toBe("active");
  } finally { f.close(); }
});

test("a native actor's explicit room move still commits at its physical deadline", () => {
  const f = fixture(); f.world.meta.timedActions = true;
  try {
    const registry = createSystemRegistry();
    executeActions(f.world, [{ eid: f.actor, action: { type: "move", target: "Study" } }], registry);
    f.run(createGoalPursuitSystem());
    advanceSimulationTimeline(f.world, 2999, { integrate: () => {} });
    expect(getDirectContainer(f.world, f.actor)).toBe(f.kitchen);
    advanceSimulationTimeline(f.world, 1, { integrate: () => {} });
    expect(getDirectContainer(f.world, f.actor)).toBe(f.study);
    expect(GridPosition.x[f.actor]).toBe(GridPosition.x[f.study]);
    expect(getCommittedEvents(f.world).events.map(e => [e.action, e.status, e.atSimMs]))
      .toEqual([["move", "pending", 0], ["move", "succeeded", 3000]]);
    f.run(createGoalPursuitSystem()); f.settleGrid();
    expect(getDirectContainer(f.world, f.actor)).toBe(f.study);
    expect(Goal.status[f.background]).toBe("active");
  } finally { f.close(); }
});

test.each([false, true])("an unchosen navigation goal cannot veto a selected move, but real transit can (in flight=%s)", inFlight => {
  const f = fixture();
  try {
    setGoalContract(f.world, f.personal, { version: 1, kind: "custom", params: {}, success: { type: "in_room", roomName: "Study" } });
    workingMemoryEntityRef(f.world, f.actor); captureCoordinationGoal(f.world, f.actor, f.personal);
    const revision = integrateActorContinuation(f.world, f.actor, { purpose: "Go somewhere private to check my phone", actionType: "move", target: "Study",
      observedAtSimMs: 0, goalId: f.personal, goalKey: WorkingMemoryIdentity.id[f.personal] })!;
    updateActorContinuation(f.world, f.actor, revision, "dispatched");
    if (inFlight) setMovementTarget(f.actor, f.living);
    expect(selectFastAgentAction(f.world, f.actor)).toMatchObject(inFlight ? { type: "wait" } : { type: "move", target: "Study" });
    expect(generate).not.toHaveBeenCalled();
  } finally { f.close(); }
});
