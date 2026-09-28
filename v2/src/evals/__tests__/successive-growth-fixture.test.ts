import { jest } from "@jest/globals";
import { addComponent, hasComponent, query, removeComponent } from "bitecs";
import { createSuccessiveGrowthFixture, readSuccessiveGrowthConcerns, successiveGrowthConfiguration, restrictSuccessiveGrowthSpirits } from "../successive-growth-fixture";
import { Agent, BehaviorPolicy, Goal, Name, Needs, PhysicalObject, Removed, Room, WorkingMemoryIdentity } from "../../ecs/components";
import { getCommittedEvents } from "../../runtime/committed-events";
import { isRoomRouteTopologyCurrent } from "../../runtime/room-routes";
import { getRoomForEntity } from "../../ecs/location";
import { ObjectManager } from "../../world/object-manager";
import { readGoalSuccessContract } from "../../cognition/goal-contract";
import { getIdentityAnchors } from "../../cognition/narrative-memory";
import { initializeSpiritSystem, createStandardHierarchy, getSpiritSystemState } from "../../spirits/spirit-system";
import { NarratorDefinition } from "../../spirits/narrator-spirit";
import { resetFactoryState } from "../../spirits/spirit-factory";
import { captureActorIntentionEvidence } from "../../spirits/actor-intention-evidence";
import { HasGoal } from "../../ecs/relations";
import { evaluateSuccessiveGrowth } from "../successive-growth-evidence";

beforeEach(() => {
  resetFactoryState();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("Successive growth fixture tests stay offline"));
});
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test("live configuration retains normal scheduler cadence and bounded authoring authority", () => {
  const config = successiveGrowthConfiguration();
  expect(config).toMatchObject({ enableAI: true, cognitionController: "priority", narrativeMind: true,
    experienceReconsideration: true, enablePlanning: true, enableReflection: true, enableExperienceAppraisal: true,
    enableSpirits: true, godAutopilot: { enabled: true, minPriority: "normal" },
    codingDaemons: false, enableNarrativeEngine: false, hostOfficeTools: false, autoPopulateRooms: false,
    dualLoop: true, maxWorldEntities: 24, ecsTickRate: 2, ecsDeltaMs: 500, timeScale: 1,
    evolution: { architectInterval: 30, proposalInterval: 5, maxProposalExecutions: 1, autoApproveProposals: false,
      crafterInterval: Number.MAX_SAFE_INTEGER, stewardInterval: Number.MAX_SAFE_INTEGER,
      artificerInterval: Number.MAX_SAFE_INTEGER, lawgiverInterval: Number.MAX_SAFE_INTEGER, fileRepairInterval: Number.MAX_SAFE_INTEGER } });
  expect(config.godAutopilot).not.toHaveProperty("minRunIntervalMs");
  expect(config.generateSchedules).toBeUndefined();
});

test("creation authors two independent concerns but no choice, food, chair or successful outcome", async () => {
  const f = await createSuccessiveGrowthFixture(false);
  try {
    const { world } = f.sim, objects = new ObjectManager(world);
    // Check immediately: captureActorIntentionEvidence later in this test can
    // assign goal identities and used to mask a missing pre-start identity.
    for (const goal of [f.foodGoal, f.seatGoal]) {
      expect(hasComponent(world, goal, WorkingMemoryIdentity)).toBe(true);
      expect(WorkingMemoryIdentity.id[goal]).toMatch(/^goal:/);
      expect(hasComponent(world, goal, Name)).toBe(false);
    }
    expect(WorkingMemoryIdentity.id[f.foodGoal]).not.toBe(WorkingMemoryIdentity.id[f.seatGoal]);
    const concerns = readSuccessiveGrowthConcerns(world, f.actor, f.foodGoal, f.seatGoal);
    expect(evaluateSuccessiveGrowth({ sourceId: f.sourceId!, actorKey: WorkingMemoryIdentity.id[f.actor], startAtSimMs: 0,
      initialEntityKeys: [...f.initialKeys], needGoals: concerns, builds: [], observations: [], feedback: [],
      finalState: { sourceId: f.sourceId!, actorKey: WorkingMemoryIdentity.id[f.actor], atSimMs: 0, presentEntityKeys: [...f.initialKeys] },
      diagnostics: { errorsTotal: 0, observerFailures: 0 }, authority: { hostActionInjections: 0, postStartGoalWrites: 0 } }).failures)
      .not.toContain("distinct_initial_concerns_missing");
    expect(world.time.elapsed).toBe(0); expect(f.sim.running).toBe(false);
    expect(getCommittedEvents(world)).toMatchObject({ sourceId: f.sourceId, events: [], stopped: false });
    expect([...query(world, [Room, Name])].map(eid => Name.value[eid])).toEqual(["Neighborhood Courtyard"]);
    expect([...query(world, [Agent, Name])].map(eid => Name.value[eid])).toEqual(["Ada"]);
    expect(getRoomForEntity(world, f.actor)).toBe(f.room);
    expect(Needs.hunger[f.actor]).toBe(65); expect(Needs.energy[f.actor]).toBe(45);
    expect(BehaviorPolicy.enabled[f.actor]).toBe(false);
    expect([f.foodGoal, f.seatGoal].map(goal => [Goal.priority[goal], Goal.status[goal], Goal.progress[goal]]))
      .toEqual([[7, "active", 0], [5, "active", 0]]);
    expect(readGoalSuccessContract(f.foodGoal)).toEqual({ type: "did_interact_affordance", affordance: "eat" });
    expect(readGoalSuccessContract(f.seatGoal)).toEqual({ type: "did_interact_affordance", affordance: "sit" });
    expect(captureActorIntentionEvidence(world).records.filter(row => row.kind === "goal").map(row => row.description))
      .toEqual([f.foodPurpose, f.seatPurpose]);
    expect(getIdentityAnchors(world, f.actor)).toHaveLength(1);
    expect([...query(world, [PhysicalObject])].filter(eid => objects.hasTrait(eid, "edible") || objects.hasTrait(eid, "sittable"))).toEqual([]);
    expect(hasComponent(world, f.removed, Removed)).toBe(true);
    expect(objects.hasTrait(f.removed, "edible")).toBe(false);
    expect(f.initialKeys.size).toBe(f.initialPhysical.length);
    expect(f.initialPhysical.every(row => row.key && !row.key.startsWith("unidentified:"))).toBe(true);
    expect(WorkingMemoryIdentity.id[f.actor]).toBeTruthy();
    expect(hasComponent(world, f.sim.god.eid, WorkingMemoryIdentity)).toBe(true);
    expect(WorkingMemoryIdentity.id[f.sim.god.eid]).toBeTruthy();
    expect(isRoomRouteTopologyCurrent(world)).toBe(true);
    expect(f.spirits).toBeNull(); expect(f.weaver).toBeUndefined();
    expect(getSpiritSystemState(world)).toBeNull();
    expect(world.meta.aiEnabled).toBe(false);
  } finally { f.disableRoutes(); f.sim.stop(); }
});

test("pre-start capture rejects missing, duplicate or unowned concerns instead of repairing them", async () => {
  const f = await createSuccessiveGrowthFixture(false), world = f.sim.world;
  try {
    const original = WorkingMemoryIdentity.id[f.foodGoal];
    removeComponent(world, f.foodGoal, WorkingMemoryIdentity);
    expect(() => readSuccessiveGrowthConcerns(world, f.actor, f.foodGoal, f.seatGoal)).toThrow("identity/ownership");
    expect(hasComponent(world, f.foodGoal, WorkingMemoryIdentity)).toBe(false);
    addComponent(world, f.foodGoal, WorkingMemoryIdentity);
    WorkingMemoryIdentity.id[f.foodGoal] = WorkingMemoryIdentity.id[f.seatGoal];
    expect(() => readSuccessiveGrowthConcerns(world, f.actor, f.foodGoal, f.seatGoal)).toThrow("distinct");
    WorkingMemoryIdentity.id[f.foodGoal] = original;
    removeComponent(world, f.actor, HasGoal(f.foodGoal));
    expect(() => readSuccessiveGrowthConcerns(world, f.actor, f.foodGoal, f.seatGoal)).toThrow("identity/ownership");
  } finally { f.disableRoutes(); f.sim.stop(); }
});

test("initial concern capture refuses to backdate a running world's concerns", async () => {
  const f = await createSuccessiveGrowthFixture(false);
  try {
    f.sim.world.time.elapsed = 500;
    expect(() => readSuccessiveGrowthConcerns(f.sim.world, f.actor, f.foodGoal, f.seatGoal)).toThrow("before lived activity");
  } finally { f.disableRoutes(); f.sim.stop(); }
});

test("creation scope restricts actual native Weaver without mutating shared definitions or Watcher cadence", async () => {
  const f = await createSuccessiveGrowthFixture(false), originalInterval = NarratorDefinition.observationInterval;
  try {
    const state = initializeSpiritSystem(f.sim.world, { godAgentEid: f.sim.god.eid, autoCreateNarrator: false });
    createStandardHierarchy(f.sim.god.eid, f.sim.world);
    const watcher = state.registry.spirits.get(state.registry.byName.get("The Watcher")!)!;
    const watcherInterval = watcher.definition.observationInterval, watcherPrompt = watcher.definition.systemPrompt;
    const weaver = restrictSuccessiveGrowthSpirits(state);
    expect(weaver.architectConfig).toEqual({ canProposeEntities: true, canProposeSystems: false, canProposeComponents: false,
      canProposeRules: false, canExecuteDirectly: false, proposalApproval: "godai", maxProposalsPerCycle: 1 });
    expect(watcher.definition.observationInterval).toBe(watcherInterval);
    expect(watcher.definition.systemPrompt).toBe(watcherPrompt);
    expect([...state.registry.spirits.values()].filter(spirit => spirit !== watcher)
      .every(spirit => spirit.definition.observationInterval === Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(NarratorDefinition.observationInterval).toBe(originalInterval);
    expect(getCommittedEvents(f.sim.world).events).toEqual([]);
    state.running = true;
    expect(() => restrictSuccessiveGrowthSpirits(state)).toThrow("before startup");
    state.running = false;
  } finally { f.disableRoutes(); f.sim.stop(); }
});
