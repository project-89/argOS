import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createAgentEntity, createRoomEntity } = await import("../../ecs/prefabs");
const { createSystemRegistry } = await import("../../ecs/dynamic-systems");
const { entityExists, query, getRelationTargets } = await import("bitecs");
const { Goal, Name, Needs, ObjectState } = await import("../../ecs/components");
const { SittingOn } = await import("../../ecs/relations");
const { createGeneratedIntention } = await import("../../cognition/goal-lifecycle");
const { workingMemoryEntityRef } = await import("../../cognition/working-memory");
const { executeActions } = await import("../../cognition/cognition-system");
const { getRoomForEntity } = await import("../../ecs/location");
const { startCommittedEvents, getCommittedEvents, stopCommittedEvents } = await import("../../runtime/committed-events");
const { enableRoomRouteTopology } = await import("../../runtime/room-routes");
const { advanceSimulationTimeline } = await import("../../runtime/simulation-timeline");
const { createEvolutionCoordinator } = await import("../../runtime/evolution-coordinator");
const { getPlaceBuildStatus } = await import("../../engineering/place-materialization");
const { createSpiritRegistry } = await import("../spirit-registry");
const { createDynamicSpirit, approveProposal, getPendingProposals, resetFactoryState } = await import("../spirit-factory");

beforeEach(() => {
  resetFactoryState(); generate.mockReset();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Successive growth test must remain offline"));
});
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

/** This verifies native world-growth plumbing, NOT autonomous NPC judgment or
 * live author usefulness: needs/actor choices/author JSON/approval are fixtures.
 * Construction, routes, timed execution, depletion and returned receipts are real.
 * No publishCommittedEvent or direct success/state patch stands in for native use. */
test("two sequential distinct purposes build useful places, execute natively, and feed consequences back without replenishment", async () => {
  const world = createArgosWorld("Successive useful growth"); initializePrefabs(world);
  world.meta.timedActions = true;
  const sourceId = startCommittedEvents(world), disableRoutes = enableRoomRouteTopology(world);
  const street = createRoomEntity(world, { name: "Street" });
  const actor = createAgentEntity(world, { name: "Ada", roomId: street, role: "visitor", systemPrompt: "PRIVATE_BACKSTORY" });
  Needs.hunger[actor] = 70;
  const foodPurpose = "Find a diner and eat one serving";
  const seatPurpose = "Find a sheltered waiting room and sit down";
  const foodGoal = createGeneratedIntention(world, actor, { description: foodPurpose, priority: 7 }, "foreground")!;
  const registry = createSystemRegistry(), spirits = createSpiritRegistry(world);
  const superior = createDynamicSpirit(spirits, { name: "Growth observer", type: "watcher", rank: "archangel", domain: "ecology" })!;
  const weaver = createDynamicSpirit(spirits, { name: "The Weaver", type: "architect", rank: "archangel", domain: "ecology", superiorEid: superior.eid,
    architectConfig: { canProposeEntities: true, canProposeSystems: false, canProposeComponents: false, canProposeRules: false,
      canExecuteDirectly: false, proposalApproval: "superior", maxProposalsPerCycle: 1 } })!;
  const coordinator = createEvolutionCoordinator({ architectInterval: 1, proposalInterval: 1, autoApproveProposals: false,
    crafterInterval: 10000, stewardInterval: 10000, artificerInterval: 10000, lawgiverInterval: 10000, fileRepairInterval: 10000 },
    { getSpiritsByType: type => type === "architect" ? [weaver] : [] });
  const context = { world, spirits, god: { eid: superior.eid, systemRegistry: registry, fileSystems: [] } as any };
  let stage: "food" | "seat" | "review" = "food", ref = "", diner = -1, meal = -1, mealKey = "";
  let sawDepletionForSecondNeed = false, sawBothNativeOutcomes = false;
  const expectMealAbsent = () => {
    // Native memory creation may reuse a deleted numeric EID. Generation identity
    // and actual object inventory, not that address alone, prove no resurrection.
    if (entityExists(world, meal)) expect(workingMemoryEntityRef(world, meal)?.key).not.toBe(mealKey);
    expect([...query(world, [Name])].filter(eid => Name.value[eid] === "Supper")).toEqual([]);
  };

  generate.mockImplementation(async request => {
    expect(request.prompt).not.toContain("PRIVATE_BACKSTORY");
    if (request.prompt.includes("identify 0-3")) {
      const rows = JSON.parse(request.prompt.split("- Actor intentions (author-only evidence, not other NPCs' knowledge): ")[1].split("\n")[0]);
      const receipts = JSON.parse(request.prompt.split("- Recent observed events: ")[1].split("\n")[0]);
      if (stage !== "food") {
        expect(request.prompt).toContain('"name":"Diner"');
        expect(request.prompt).toContain('"reason":"member_unavailable"');
        expect(request.prompt).toContain("finite consumption are not defects");
        expect(receipts).toEqual(expect.arrayContaining([expect.objectContaining({ event: expect.objectContaining({
          targetName: "Supper", operation: "eating", status: "succeeded",
        }) })]));
        expectMealAbsent();
        sawDepletionForSecondNeed = true;
      }
      if (stage === "review") {
        expect(receipts).toEqual(expect.arrayContaining([expect.objectContaining({ event: expect.objectContaining({
          targetName: "Waiting chair", status: "succeeded", action: "interact",
        }) })]));
        sawBothNativeOutcomes = true;
        return { text: "[]" };
      }
      const demand = rows.find((row: any) => row.kind === "goal" && row.actor === "Ada" && row.description === (stage === "food" ? foodPurpose : seatPurpose));
      expect(demand).toBeDefined(); ref = demand.ref;
      if (stage === "seat") expect(rows.some((row: any) => row.kind === "goal" && row.description === foodPurpose)).toBe(false);
      const objectId = stage === "food" ? "meal" : "seat";
      const objectType = stage === "food" ? "food_item" : "chair";
      const affordance = stage === "food" ? "eat" : "sit";
      return { text: JSON.stringify([{ type: "entity", description: stage === "food" ? "A diner with one meal" : "A sheltered waiting room with a seat",
        priority: "high", rationale: "Support the actor's current chosen purpose", evidence: [ref, `entity:${stage === "food" ? street : diner}`],
        expectedChange: stage === "food" ? "The visitor can reach and eat a serving" : "The visitor can reach and occupy a sheltered seat",
        supportRequirements: [
          { id: "route", kind: "connection", roomEid: stage === "food" ? street : diner, description: "Access from the actor's current room" },
          { id: "visitor", kind: "existing_actor", intentionRef: ref, description: "The actual visitor" },
          { id: objectId, kind: "entity", entityType: "object", objectType, description: "A physically usable object" },
          { id: "use", kind: "interaction", actor: "visitor", target: objectId, affordance, description: "The intended native interaction" },
        ] }]) };
    }
    const food = stage === "food", objectId = food ? "meal" : "seat";
    return { text: JSON.stringify({ name: food ? "Diner" : "Waiting Room", type: "room", description: food ? "A small diner with finite supper" : "A sheltered waiting room",
      components: [], connectToRoomEids: [food ? street : diner], existingActors: [{ id: "visitor", intentionRef: ref }],
      contents: [{ id: objectId, entity: { name: food ? "Supper" : "Waiting chair", type: "object", description: food ? "A single serving" : "An empty chair",
        components: [{ name: "ObjectType", values: { typeId: food ? "food_item" : "chair" } }] } }],
      requiredInteractions: [{ actor: "visitor", target: objectId, affordance: food ? "eat" : "sit" }] }) };
  });
  const choose = (action: { type: "move" | "interact"; target: string; content?: string }) => {
    const before = getCommittedEvents(world).latestSequence, beganAt = world.time.elapsed;
    const duration = action.type === "move" ? 3000 : 1000;
    executeActions(world, [{ eid: actor, action }], registry);
    const admitted = getCommittedEvents(world, before).events.find(event => event.actorId === actor && event.status === "pending")!;
    expect(admitted).toMatchObject({ sourceId, startedAtSimMs: beganAt, expectedEndSimMs: beganAt + duration, targetName: action.target });
    expect(getCommittedEvents(world, before).events.some(event => event.status === "succeeded")).toBe(false);
    advanceSimulationTimeline(world, duration, { integrate: () => {} });
    expect(getCommittedEvents(world, before).events).toEqual(expect.arrayContaining([expect.objectContaining({
      executionId: admitted.executionId, sourceId, status: "succeeded", startedAtSimMs: beganAt, completedAtSimMs: beganAt + duration,
    })]));
  };
  try {
    await coordinator.run(1, context);
    expect(getPlaceBuildStatus(world, registry)).toEqual([]);
    expect(getRoomForEntity(world, actor)).toBe(street);
    expect(getCommittedEvents(world).events).toEqual([]);
    const first = getPendingProposals(); expect(first).toHaveLength(1); approveProposal(first[0].id);
    coordinator.config.architectInterval = 10000;
    await coordinator.run(2, context);
    const firstBuild = getPlaceBuildStatus(world, registry)[0];
    expect(firstBuild.phase).toBe("constructed");
    expect(firstBuild.sourceId).toBe(sourceId);
    diner = firstBuild.members.find(member => member.id === "room")!.eid;
    meal = firstBuild.members.find(member => member.id === "meal")!.eid;
    mealKey = firstBuild.members.find(member => member.id === "meal")!.key;
    expect(getRoomForEntity(world, actor)).toBe(street);
    expect(Goal.progress[foodGoal]).toBe(0); // Authoring is not goal completion.
    choose({ type: "move", target: "Diner" });
    expect(getRoomForEntity(world, actor)).toBe(diner);
    expect(getPlaceBuildStatus(world, registry)[0].support.status).toBe("available");
    choose({ type: "interact", target: "Supper", content: "eat" });
    expectMealAbsent();
    expect(Needs.hunger[actor]).toBe(40);
    expect(getPlaceBuildStatus(world, registry)[0].support).toMatchObject({ status: "unavailable", unmet: expect.arrayContaining([
      expect.objectContaining({ id: "meal", reason: "member_unavailable" }),
    ]) });

    // Explicit fixture choice, not a claim that an LLM independently reprioritized.
    Goal.status[foodGoal] = "retired";
    const seatGoal = createGeneratedIntention(world, actor, { description: seatPurpose, priority: 7 }, "foreground")!;
    stage = "seat"; coordinator.config.architectInterval = 1;
    await coordinator.run(3, context);
    expect(sawDepletionForSecondNeed).toBe(true);
    expect(getPlaceBuildStatus(world, registry)).toHaveLength(1);
    const second = getPendingProposals(); expect(second).toHaveLength(1); approveProposal(second[0].id);
    coordinator.config.architectInterval = 10000;
    await coordinator.run(4, context);
    const builds = getPlaceBuildStatus(world, registry);
    expect(builds).toHaveLength(2); expect(builds.every(build => build.sourceId === sourceId)).toBe(true);
    const waiting = builds.find(build => build.name === "Waiting Room")!;
    expect(waiting.phase).toBe("constructed");
    const waitingRoom = waiting.members.find(member => member.id === "room")!.eid;
    const chair = waiting.members.find(member => member.id === "seat")!.eid;
    expect(getRoomForEntity(world, actor)).toBe(diner); expect(Goal.progress[seatGoal]).toBe(0);
    choose({ type: "move", target: "Waiting Room" });
    expect(getRoomForEntity(world, actor)).toBe(waitingRoom);
    expect(getPlaceBuildStatus(world, registry).find(build => build.name === "Waiting Room")!.support.status).toBe("available");
    choose({ type: "interact", target: "Waiting chair", content: "sit" });
    expect(ObjectState.current[chair]).toBe("occupied");
    expect(getRelationTargets(world, actor, SittingOn)).toEqual([chair]);
    expectMealAbsent();

    stage = "review"; coordinator.config.architectInterval = 1;
    const entityCount = [...query(world, [Name])].length;
    await coordinator.run(5, context);
    expect(sawBothNativeOutcomes).toBe(true);
    const report = superior.inbox.filter(message => message.subject === "World activity reviewed").at(-1)!;
    expect(report.data?.sourceId).toBe(sourceId);
    expect(report.data?.recentEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetName: "Supper", operation: "eating", status: "succeeded" }),
      expect.objectContaining({ targetName: "Waiting chair", action: "interact", status: "succeeded" }),
    ]));
    expect(report.data?.placeBuilds).toHaveLength(2);
    expect(report.data?.placeBuilds.find((build: any) => build.name === "Diner").support.unmet)
      .toContainEqual(expect.objectContaining({ id: "meal", reason: "member_unavailable" }));
    expect(report.content).toContain("Construction is not proof of use");
    expect([...query(world, [Name])]).toHaveLength(entityCount);
    expect(getPendingProposals()).toEqual([]);
    expect(coordinator.getStatus().totals).toMatchObject({ proposalsCreated: 2, proposalsExecuted: 2 });
    expect(getCommittedEvents(world)).toMatchObject({ sourceId, stopped: false, gap: false });
    expect(generate).toHaveBeenCalledTimes(5);
  } finally { disableRoutes(); stopCommittedEvents(world); }
});
