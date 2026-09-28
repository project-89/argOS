import { jest } from "@jest/globals";
const ai = await import("ai"), generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createAgentEntity, createRoomEntity, createObjectEntity } = await import("../../ecs/prefabs");
const { createSystemRegistry } = await import("../../ecs/dynamic-systems");
const { addComponent, query } = await import("bitecs");
const { Goal, Name, Removed, ObjectState } = await import("../../ecs/components");
const { createGeneratedIntention } = await import("../../cognition/goal-lifecycle");
const { recordPrivateCommunication } = await import("../../cognition/communication-memory");
const { applyCoordinationReviews, reconcileCoordinationGoals } = await import("../../cognition/coordination-memory");
const { startCommittedEvents, getCommittedEvents, stopCommittedEvents } = await import("../../runtime/committed-events");
const { createSpiritRegistry } = await import("../spirit-registry");
const { createDynamicSpirit, approveProposal, resetFactoryState } = await import("../spirit-factory");
const { gatherArchitectContext, runArchitectCognition, executeAllApprovedProposals } = await import("../architect-spirit");
const { getPlaceBuildStatus } = await import("../../engineering/place-materialization");
const { enableRoomRouteTopology } = await import("../../runtime/room-routes");
const { getRoomForEntity, setLocatedIn } = await import("../../ecs/location");
const { createEntityRegistry } = await import("../../ecs/tools");
const { collectEcsSnapshot } = await import("../spirit-cognition");
const { getArchitectDesignFeedback } = await import("../architect-feedback");
const { createEvolutionCoordinator } = await import("../../runtime/evolution-coordinator");
const { executeAffordance } = await import("../../world/effect-executor");
const { worldSchema } = await import("../../world/schema");
const { captureCoordinationGoal } = await import("../../cognition/coordination-memory");
const { integrateActorContinuation, prepareNextPurposeUpdate, reconsiderNextPurposeAfterWait,
  settleNextPurpose, snapshotActorContinuation } = await import("../../cognition/actor-continuation");

beforeEach(() => {
  resetFactoryState(); generate.mockReset();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Weaver demand tests must remain offline"));
});
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

function fixture(task = "Visit an observatory and use its telescope") {
  const world = createArgosWorld("A world growing around intentions"); initializePrefabs(world); startCommittedEvents(world);
  enableRoomRouteTopology(world);
  const street = createRoomEntity(world, { name: "Street" });
  const actor = createAgentEntity(world, { name: "Ada", roomId: street, role: "visitor", systemPrompt: "PRIVATE_BACKSTORY" });
  const goal = createGeneratedIntention(world, actor, { description: "Arrange an evening outing", priority: 7 }, "foreground")!;
  const receipt = recordPrivateCommunication(world, actor, { sourceId: getCommittedEvents(world).sourceId!, messageKey: "outing",
    channel: "phone", kind: "sent", other: "Friend", content: "PRIVATE_BODY: We can meet at the observatory.", sentAtSimMs: 0 })!;
  applyCoordinationReviews(world, actor, [{ kind: "undertake", speechId: receipt.id, task, goalId: goal }]);
  Goal.status[goal] = "retired"; reconcileCoordinationGoals(world, actor);
  const registry = createSystemRegistry(), spirits = createSpiritRegistry(world);
  const weaver = createDynamicSpirit(spirits, { name: "The Weaver", type: "architect", rank: "archangel", domain: "ecology",
    architectConfig: { canProposeEntities: true, canProposeSystems: false, canProposeComponents: false, canProposeRules: false,
      canExecuteDirectly: false, proposalApproval: "superior", maxProposalsPerCycle: 1 } })!;
  return { world, actor, goal, street, receipt, registry, spirits, weaver, run: () => runArchitectCognition(world, registry, spirits, weaver) };
}

test.each(["temporary_wait", "take_goal_anchor", "cancel_during_design", "complete_during_design", "source_during_design"])(
  "explicit later-purpose authoring retains only current native demand: %s", async mode => {
    const f = fixture();
    const goal = createGeneratedIntention(f.world, f.actor, { description: "Visit the observatory and use its telescope", priority: 7 }, "foreground")!;
    captureCoordinationGoal(f.world, f.actor, goal);
    const selection = { requestId: "PRIVATE_STEP", actionType: "wait", listedGoals: new Set([goal]) };
    const choose = prepareNextPurposeUpdate(f.world, f.actor, { goalId: goal, purpose: "Visit the observatory after this brief wait" }, undefined, selection)!;
    integrateActorContinuation(f.world, f.actor, { purpose: "Wait a moment", actionType: "wait", observedAtSimMs: 0,
      requestId: selection.requestId, nextPurpose: choose.value });
    let ref = "";
    generate.mockImplementation(async request => {
      expect(request.prompt).not.toContain("PRIVATE_BODY"); expect(request.prompt).not.toContain("PRIVATE_BACKSTORY");
      expect(request.prompt).not.toContain("PRIVATE_STEP");
      if (request.prompt.includes("identify 0-3")) {
        const rows = JSON.parse(request.prompt.split("- Actor intentions (author-only evidence, not other NPCs' knowledge): ")[1].split("\n")[0]);
        const later = rows.find((row: any) => row.kind === "next_purpose"); expect(later).toBeDefined();
        // An enduring goal supplies all details in this case. Its citation can
        // survive taking up the later choice without inventing transfer lineage.
        ref = mode === "take_goal_anchor" ? rows.find((row: any) => row.kind === "goal" && row.goalKey === later.goalKey).ref : later.ref;
        return { text: JSON.stringify([{ type: "entity", description: "A useful observatory", priority: "high",
          rationale: "An explicitly chosen outing lacks a usable destination", evidence: [ref, `entity:${f.street}`],
          expectedChange: "The visitor can enter and examine a telescope", supportRequirements: [
            { id: "route", kind: "connection", roomEid: f.street, description: "Access from the street" },
            { id: "visitor", kind: "existing_actor", intentionRef: ref, description: "The actual visitor" },
            { id: "instrument", kind: "entity", entityType: "object", objectType: "object", description: "A telescope to inspect" },
            { id: "inspect", kind: "interaction", actor: "visitor", target: "instrument", affordance: "examine", description: "The visitor can inspect it" },
          ] }]) };
      }
      settleNextPurpose(f.world, f.actor, { type: "wait", foregroundDecisionId: selection.requestId }, { succeeded: true, pending: false });
      integrateActorContinuation(f.world, f.actor, { purpose: "An unrelated thought", actionType: "think", observedAtSimMs: 0 });
      reconsiderNextPurposeAfterWait(f.world, f.actor);
      if (mode === "take_goal_anchor" || mode === "cancel_during_design") {
        const next = snapshotActorContinuation(f.world, f.actor)!.nextPurpose!;
        const update = prepareNextPurposeUpdate(f.world, f.actor, undefined, {
          id: next.id, disposition: mode === "take_goal_anchor" ? "take" : "cancel", reason: "My fresh choice",
        }, { ...selection, actionType: "observe", goalId: goal })!;
        integrateActorContinuation(f.world, f.actor, { purpose: "Look around now", actionType: "observe", observedAtSimMs: 0,
          goalId: goal, nextPurpose: update.value });
      }
      if (mode === "complete_during_design") Goal.status[goal] = "completed";
      if (mode === "source_during_design") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
      return { text: JSON.stringify({ name: "Observatory", type: "room", description: "A small usable observatory", components: [],
        connectToRoomEids: [f.street], existingActors: [{ id: "visitor", intentionRef: ref }],
        contents: [{ id: "instrument", entity: { name: "Telescope", type: "object", description: "A telescope on a tripod",
          components: [{ name: "ObjectType", values: { typeId: "object" } }] } }],
        requiredInteractions: [{ actor: "visitor", target: "instrument", affordance: "examine" }] }) };
    });
    const proposals = await f.run();
    expect(generate).toHaveBeenCalledTimes(2);
    expect(getPlaceBuildStatus(f.world, f.registry)).toEqual([]);
    if (mode === "temporary_wait" || mode === "take_goal_anchor") {
      expect(proposals).toHaveLength(1); approveProposal(proposals[0].id);
      expect((await executeAllApprovedProposals(f.world, f.registry)).failed).toEqual([]);
      expect(getPlaceBuildStatus(f.world, f.registry)[0].members.map(member => member.name).sort()).toEqual(["Observatory", "Telescope"]);
    } else expect(proposals).toEqual([]);
    expect(getRoomForEntity(f.world, f.actor)).toBe(f.street);
    expect(getCommittedEvents(f.world).events).toEqual([]); // A possibility, not fabricated use or public knowledge.
    expect(Goal.progress[goal]).toBe(0); stopCommittedEvents(f.world);
  }
);

test.each(["current", "travel", "released_during_design"])("an ongoing commitment can grow a useful place after its reply goal ended: %s", async mode => {
  const f = fixture(); let ref = "";
  const other = createRoomEntity(f.world, { name: "Square" });
  generate.mockImplementation(async request => {
    expect(request.prompt).not.toContain("PRIVATE_BODY"); expect(request.prompt).not.toContain("PRIVATE_BACKSTORY");
    if (request.prompt.includes("identify 0-3")) {
      expect(request.prompt).toContain("A healthy runtime can still lack a destination");
      const rows = JSON.parse(request.prompt.split("- Actor intentions (author-only evidence, not other NPCs' knowledge): ")[1].split("\n")[0]);
      const work = rows.find((r: any) => r.kind === "undertaking" && r.actor === "Ada"); ref = work.ref;
      expect(work.description).toBe("Visit an observatory and use its telescope");
      expect(rows.some((r: any) => r.kind === "goal" && r.actor === "Ada")).toBe(false);
      return { text: JSON.stringify([{ type: "entity", description: "An accessible observatory with a telescope", priority: "high",
        rationale: "The actor has undertaken a visit and no such place exists in this small world", evidence: [ref, `entity:${f.street}`],
        expectedChange: "Ada can independently enter and inspect a telescope", supportRequirements: [
          { id: "route", kind: "connection", roomEid: f.street, description: "Access from the street" },
          { id: "visitor", kind: "existing_actor", intentionRef: ref, description: "The actor who chose to visit" },
          { id: "instrument", kind: "entity", entityType: "object", objectType: "object", description: "The telescope to inspect" },
          { id: "inspect", kind: "interaction", actor: "visitor", target: "instrument", affordance: "examine", description: "The visitor can inspect the instrument" },
        ] }]) };
    }
    if (mode === "travel") setLocatedIn(f.world, f.actor, other);
    if (mode === "released_during_design") applyCoordinationReviews(f.world, f.actor, [{ kind: "release", id: f.receipt.id, reason: "I changed my mind" }]);
    return { text: JSON.stringify({ name: "Observatory", type: "room", description: "A small usable observatory", components: [],
      connectToRoomEids: [f.street], existingActors: [{ id: "visitor", intentionRef: ref }],
      contents: [{ id: "instrument", entity: { name: "Telescope", type: "object", description: "A telescope on a tripod", components: [
        { name: "ObjectType", values: { typeId: "object" } }, { name: "PhysicalObject", values: { portable: false, weight: 15 } },
      ] } }], requiredInteractions: [{ actor: "visitor", target: "instrument", affordance: "examine" }] }) };
  });
  const proposals = await f.run();
  expect(generate).toHaveBeenCalledTimes(2);
  expect(getPlaceBuildStatus(f.world, f.registry)).toEqual([]); // Observation/design alone never builds.
  if (mode === "released_during_design") expect(proposals).toEqual([]);
  else {
    expect(proposals).toHaveLength(1); approveProposal(proposals[0].id);
    const outcome = await executeAllApprovedProposals(f.world, f.registry); expect(outcome.failed).toEqual([]);
    const build = getPlaceBuildStatus(f.world, f.registry)[0]; expect(build.phase).toBe("constructed");
    expect(build.members.map(m => m.name).sort()).toEqual(["Observatory", "Telescope"]);
    expect(getRoomForEntity(f.world, f.actor)).toBe(mode === "travel" ? other : f.street);
  }
  expect(Goal.progress[f.goal]).toBe(0); expect(Goal.status[f.goal]).toBe("retired"); stopCommittedEvents(f.world);
});

test("state and removed identities are author context, not empty slots or NPC disclosures", async () => {
  const f = fixture(), empty = createObjectEntity(f.world, { name: "Used serving", roomId: f.street });
  ObjectState.current[empty] = "consumed";
  const removed = createObjectEntity(f.world, { name: "Removed key", roomId: f.street }); addComponent(f.world, removed, Removed);
  const context = await gatherArchitectContext(f.world, f.registry);
  expect(context.setting.entities.find(e => e.eid === empty)?.state).toBe("consumed");
  expect(context.setting.entities.some(e => e.eid === removed)).toBe(false);
  expect(context.setting.unavailableEntities).toContainEqual({ eid: removed, name: "Removed key", reason: "removed" });
  generate.mockResolvedValue({ text: "[]" }); expect(await f.run()).toEqual([]);
  const prompt = generate.mock.calls[0][0].prompt;
  expect(prompt).toContain("rather than a slot to refill"); expect(prompt).toContain("\"entities\":true");
  expect(JSON.stringify(collectEcsSnapshot(f.world, createEntityRegistry()))).not.toContain("Visit an observatory");
  expect(getCommittedEvents(f.world).events).toEqual([]); stopCommittedEvents(f.world);
});

test.each([false, true])("autonomous design cannot resurrect a removed named object (removed during design=%s)", late => {
  return (async () => {
    const f = fixture(), removed = createObjectEntity(f.world, { name: late ? "Previously different key" : "Missing key", roomId: f.street });
    if (!late) addComponent(f.world, removed, Removed);
    generate.mockImplementation(async request => {
      if (request.prompt.includes("identify 0-3")) return { text: JSON.stringify([{ type: "entity", description: "Replacement key",
        rationale: "Model misinterprets an obstacle", evidence: [`entity:${f.street}`], expectedChange: "A key is present" }]) };
      if (late) { Name.value[removed] = "Missing key"; addComponent(f.world, removed, Removed); }
      return { text: JSON.stringify({ name: "Missing key", description: "A replacement key", type: "object", roomId: f.street,
        components: [{ name: "ObjectType", values: { typeId: "object" } }] }) };
    });
    expect(await f.run()).toEqual([]);
    expect([...query(f.world, [Name])].filter(e => Name.value[e] === "Missing key")).toEqual([removed]);
    stopCommittedEvents(f.world);
  })();
});

test("an entity-only growth pass does not admit a system recommendation", async () => {
  const f = fixture(); generate.mockResolvedValue({ text: JSON.stringify([{ type: "system", description: "An unpermitted new mechanic",
    evidence: [`entity:${f.street}`], expectedChange: "More mechanics", rationale: "Wrong authoring lane" }]) });
  expect(await f.run()).toEqual([]); expect(generate).toHaveBeenCalledTimes(1); stopCommittedEvents(f.world);
});

test("later evolution cycles correct rejected support, construct it, and observe depletion without replenishing", async () => {
  const f=fixture("Find a diner and get something to eat"); let attempts=0, ref="", sawRejection=false, sawDepletion=false;
  generate.mockImplementation(async request=>{
    if(request.prompt.includes("identify 0-3")) {
      const rows=JSON.parse(request.prompt.split("- Actor intentions (author-only evidence, not other NPCs' knowledge): ")[1].split("\n")[0]);
      ref=rows.find((r:any)=>r.kind==="undertaking"&&r.actor==="Ada").ref;
      if(attempts===2) {
        expect(request.prompt).toContain('"status":"unavailable"');
        expect(request.prompt).toContain('"reason":"member_unavailable"');
        expect(request.prompt).toContain("finite consumption and deliberate absence stay as they are"); sawDepletion=true;
        return {text:"[]"}; // Model fixture acknowledges a real consequence, not automatic refill.
      }
      if(attempts===1) {
        const feedback=JSON.parse(request.prompt.split("- This author's recent design rejections (historical advice, NOT citable world evidence): ")[1].split("\n")[0]);
        expect(feedback).toEqual([expect.objectContaining({reason:"contract",description:"A nearby diner",problem:expect.any(String)})]); sawRejection=true;
      }
      return {text:JSON.stringify([{type:"entity",description:"A nearby diner",priority:"high",rationale:"An ongoing dining purpose",evidence:[ref,`entity:${f.street}`],
        expectedChange:"The visitor can find a place to sit",supportRequirements:[
          {id:"entry",kind:"connection",roomEid:f.street,description:"A reachable destination"},
          {id:"visitor",kind:"existing_actor",intentionRef:ref,description:"The actual visitor"},
          {id:"seat",kind:"entity",entityType:"object",objectType:"chair",description:"A seat"},
        ]}])};
    }
    expect(request.prompt).toContain("preceding need may be incomplete"); attempts++;
    return {text:JSON.stringify({name:"Diner",description:"A modest counter and a server with one meal",type:"room",components:[],
      connectToRoomEids:[f.street],existingActors:[{id:"visitor",intentionRef:ref}],unresolvedSupport:[],
      additionalSupportRequirements:[
        {id:"server",kind:"entity",entityType:"agent",description:"A server"},
        {id:"meal",kind:"entity",entityType:"object",objectType:"food_item",description:"Finite food"},
        {id:"eat",kind:"interaction",actor:"visitor",target:"meal",affordance:"eat",description:"The visitor can eat"},
      ],
      contents:[{id:"seat",entity:{name:"Seat",description:"A seat",type:"object",components:[{name:"ObjectType",values:{typeId:"chair"}}]}},
        {id:"server",entity:{name:"Nora",description:"A server",type:"agent",components:[]}},
        // First design acknowledges food support but forgets to build it.
        ...(attempts===1?[]:[{id:"meal",entity:{name:"Supper",description:"A single serving",type:"object",components:[{name:"ObjectType",values:{typeId:"food_item"}}]}}])],
      requiredInteractions:[{actor:"visitor",target:"meal",affordance:"eat"}]})};
  });
  const coordinator=createEvolutionCoordinator({architectInterval:1,proposalInterval:1,autoApproveProposals:false,
    crafterInterval:10000,stewardInterval:10000,artificerInterval:10000,lawgiverInterval:10000,fileRepairInterval:10000},
    {getSpiritsByType:type=>type==="architect"?[f.weaver]:[]});
  const context={world:f.world,spirits:f.spirits,god:{eid:0,systemRegistry:f.registry,fileSystems:[]} as any};
  await coordinator.run(1,context);
  expect(getPlaceBuildStatus(f.world,f.registry)).toEqual([]);
  expect(getArchitectDesignFeedback(f.world,f.weaver)).toHaveLength(1);
  expect(getCommittedEvents(f.world).events).toEqual([]);
  await coordinator.run(2,context);
  expect(sawRejection).toBe(true); expect(getPlaceBuildStatus(f.world,f.registry)).toEqual([]);
  const {getPendingProposals}=await import("../spirit-factory");
  const pending=getPendingProposals(); expect(pending).toHaveLength(1); approveProposal(pending[0].id);
  // Due proposal stage executes the already approved work, without another design.
  coordinator.config.architectInterval=10000;
  await coordinator.run(3,context);
  const build=getPlaceBuildStatus(f.world,f.registry)[0]; expect(build.phase).toBe("constructed");
  expect(build.support.requirements).toEqual(expect.arrayContaining([expect.objectContaining({id:"meal"}),expect.objectContaining({id:"eat"})]));
  expect(getRoomForEntity(f.world,f.actor)).toBe(f.street);expect(Goal.progress[f.goal]).toBe(0);
  const meal=build.members.find(m=>m.id==="meal")!, room=build.members.find(m=>m.id==="room")!;
  // Offline native-physics fixture, not evidence of independent live NPC choice.
  setLocatedIn(f.world,f.actor,room.eid);
  const result=executeAffordance("eat",{world:f.world,worldSchema,registry:{byName:new Map([["Ada",f.actor],["Supper",meal.eid]]),byId:new Map([[f.actor,"Ada"],[meal.eid,"Supper"]])},actorEid:f.actor,targetEid:meal.eid});
  expect(result.success).toBe(true);
  const count=[...query(f.world,[Name])].length;
  coordinator.config.architectInterval=1;
  await coordinator.run(4,context);
  expect(sawDepletion).toBe(true);expect([...query(f.world,[Name])]).toHaveLength(count);
  expect(coordinator.getStatus().totals).toMatchObject({proposalsCreated:1,proposalsExecuted:1});
  stopCommittedEvents(f.world);
});
