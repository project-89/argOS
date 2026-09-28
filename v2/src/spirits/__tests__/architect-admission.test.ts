import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createArgosWorld } = await import("../../ecs/world");
const { startCommittedEvents, stopCommittedEvents, publishCommittedEvent } = await import("../../runtime/committed-events");
const { initializeRegistry } = await import("../../ecs/component-registry");
const { addEntity, addComponent, query } = await import("bitecs");
const { Name, Room, Goal } = await import("../../ecs/components");
const { initializePrefabs, createAgentEntity, createRoomEntity } = await import("../../ecs/prefabs");
const { createIntentGoal } = await import("../../cognition/cognition-system");
const { executeActions } = await import("../../cognition/cognition-system");
const { getRoomForEntity, setLocatedIn } = await import("../../ecs/location");
const { enableRoomRouteTopology, getRoomRouteTargets, connectRoomRoute, disconnectRoomRoute } = await import("../../runtime/room-routes");
const { advanceSimulationTimeline } = await import("../../runtime/simulation-timeline");
const { createDaemonRegistry, createDaemonsForAllAgents } = await import("../agent-daemon");
const { captureCognitiveLocalView } = await import("../../cognition/cognitive-local-view");
const { createSystemRegistry, registerSystem, runSystems } = await import("../../ecs/dynamic-systems");
const { createSpiritRegistry } = await import("../spirit-registry");
const { createDynamicSpirit, submitProposal, approveProposal, resetFactoryState, getFactoryState } = await import("../spirit-factory");
const { identifyNeeds, validateObservedNeeds, validateManagedProposal, gatherArchitectContext, executeAllApprovedProposals, executeEntityProposal, runArchitectCognition, enqueueManagedSystemProposal } = await import("../architect-spirit");
const { CodingDaemon } = await import("../../engineering/coding-daemon");
const { createGodAgent, godThink } = await import("../../god/god-agent");
const { getComponent } = await import("../../ecs/component-registry");
const { worldSchema } = await import("../../world/schema");
const { executeAffordance } = await import("../../world/effect-executor");
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const { recordEvent } = await import("../consistency-spirit");
const { recordSpiritPublicEnvironmentReceipt } = await import("../spirit-public-event-review");
const { beginArchitectDiagnostics, getArchitectDiagnostics } = await import("../architect-diagnostics");
const { configureWorldConstructionBudget, getWorldConstructionStatus } = await import("../../runtime/world-construction-budget");
const { createEvolutionCoordinator } = await import("../../runtime/evolution-coordinator");
const { resetStewardState, getPendingRoomRequests } = await import("../steward-spirit");
const { createPersonalIntention } = await import("../../cognition/goal-lifecycle");
const { captureIntentionReconsideration, prepareIntentionReconsideration } = await import("../../cognition/intention-reconsideration");
const { integrateActorContinuation } = await import("../../cognition/actor-continuation");
const { queueExperiencedEvent, runExperienceAppraisal } = await import("../../cognition/experience-appraisal");
const { WorkingMemoryIdentity } = await import("../../ecs/components");
const { workingMemoryEntityRef } = await import("../../cognition/working-memory");
const { getPlaceBuildStatus } = await import("../../engineering/place-materialization");
const { queueAllApprovedProposals } = await import("../architect-spirit");
const { resetWorldCrafterState, getWorldCrafterState, approveEvolutionProposal, executeEvolutionProposal } = await import("../world-crafter-spirit");
import type { ArchitectContext } from "../architect-spirit";

test.each(["complete", "queued", "missing_custody", "prose_only", "mutated_after_approval", "duplicate_names", "case_folded_names", "distinct_units"])(
  "initial-custody support survives real need, design and execution admission: %s", async boundary => {
    const f = spirit(); initializePrefabs(f.world); enableRoomRouteTopology(f.world);
    const street = createRoomEntity(f.world, { name: "Street" });
    const actor = createAgentEntity(f.world, { name: "Ada", role: "visitor", systemPrompt: "Choose freely", roomId: street });
    const goal = createIntentGoal(f.world, actor, "Find a staffed cafe and ask to be served a meal", 7);
    f.architect.architectConfig!.canExecuteDirectly = false;
    f.architect.architectConfig!.proposalApproval = "superior";
    generate.mockImplementation(async input => {
      if (input.prompt.includes("identify 0-3")) {
        expect(input.prompt).toContain('kind: "initial_custody"');
        const records = JSON.parse(input.prompt.split("- Actor intentions (author-only evidence, not other NPCs' knowledge): ")[1].split("\n")[0]);
        return { text: JSON.stringify([{ type: "entity", description: "A staffed cafe", rationale: "Offer service", expectedChange: "A cook has fresh stock to offer",
          evidence: [records.find((r: any) => r.actor === "Ada" && r.kind === "goal").ref], supportRequirements: [
            { id: "entry", kind: "connection", roomEid: street, description: "A route from the street" },
            { id: "cook", kind: "entity", entityType: "agent", description: "An independent cook" },
            { id: "meal", kind: "entity", entityType: "object", objectType: "food_item", description: "Fresh food" },
            { id: "stock", kind: "initial_custody", item: "meal", holder: "cook", description: "The cook starts with food to serve" },
          ] }]) };
      }
      expect(input.prompt).toContain('"kind":"initial_custody"');
      expect(input.prompt).toContain("The room name and every child entity.name must be distinct after trimming and ignoring case");
      expect(input.prompt).toContain('"Bread roll 1", "Bread roll 2"');
      return { text: JSON.stringify({ name: "Cafe", type: "room", description: "A small cafe", components: [], connectToRoomEids: [street], contents: [
        { id: "cook", entity: { name: "Leo", type: "agent", description: "A cook", components: [] } },
        { id: "meal", ...(["missing_custody", "prose_only"].includes(boundary) ? {} : { carriedBy: "cook" }),
          entity: { name: "Bread", type: "object", description: "Fresh bread in Leo's inventory", components: [
            { name: "ObjectType", values: { typeId: "food_item" } }, { name: "PhysicalObject", values: { portable: true, weight: 0.2 } },
          ] } },
        ...(["duplicate_names", "case_folded_names", "distinct_units"].includes(boundary) ? [{ id: "meal2", carriedBy: "cook",
          entity: { name: boundary === "distinct_units" ? "Bread 2" : boundary === "case_folded_names" ? "  BREAD  " : "Bread",
            type: "object", description: "Another serving of the same bread", components: [
              { name: "ObjectType", values: { typeId: "food_item" } }, { name: "PhysicalObject", values: { portable: true, weight: .2 } },
            ] } }] : []),
      ] }) };
    });
    const proposals = await runArchitectCognition(f.world, f.registry, f.spirits, f.architect);
    if (["missing_custody", "prose_only", "duplicate_names", "case_folded_names"].includes(boundary)) {
      expect(proposals).toEqual([]); expect(getPlaceBuildStatus(f.world, f.registry)).toEqual([]);
      if (["duplicate_names", "case_folded_names"].includes(boundary)) {
        expect(getArchitectDiagnostics(f.world).entries).toEqual(expect.arrayContaining([
          expect.objectContaining({ stage: "design", outcome: "rejected", reason: "contract", detail: expect.stringContaining("Blueprint entity names must be distinct") }),
        ]));
        expect([...query(f.world, [Name])].some(eid => ["Cafe", "Leo", "Bread"].includes(Name.value[eid]))).toBe(false);
      }
    } else {
      expect(proposals).toHaveLength(1); approveProposal(proposals[0].id);
      if (boundary === "mutated_after_approval") delete (proposals[0].specification as any).contents[1].carriedBy;
      if (boundary === "queued") queueAllApprovedProposals(f.world, f.registry);
      else await executeAllApprovedProposals(f.world, f.registry);
      if (boundary === "mutated_after_approval") {
        expect(proposals[0].status).toBe("failed"); expect(getPlaceBuildStatus(f.world, f.registry)).toEqual([]);
      } else {
        const initial = getPlaceBuildStatus(f.world, f.registry)[0];
        expect(initial).toMatchObject({ phase: "constructed" });
        expect(initial.initialCustody).toEqual(expect.arrayContaining([expect.objectContaining({ item: "meal", holder: "cook" })]));
        expect(initial.initialCustody).toHaveLength(boundary === "distinct_units" ? 2 : 1);
        if (boundary === "distinct_units") {
          const build = getPlaceBuildStatus(f.world, f.registry)[0];
          expect(build.initialCustody).toHaveLength(2);
          expect(build.members.filter(m => ["meal", "meal2"].includes(m.id)).map(m => m.name)).toEqual(["Bread", "Bread 2"]);
        }
      }
    }
    expect(Goal.progress[goal]).toBe(0); expect(getRoomForEntity(f.world, actor)).toBe(street);
    stopCommittedEvents(f.world);
  });

function context(): ArchitectContext {
  return { existingSystems: [], existingComponents: [], entityCounts: { agents: 2, rooms: 1, total: 3 }, recentEvents: [{ type: "action_failed", data: { target: "Sink", reason: "Valve does not stop flow" } }],
    detectedPatterns: [], agentStates: [], setting: { name: "Apartment", entities: [{ eid: 1, name: "Kitchen" }] }, proposalHistory: [], engineeringJobs: [] };
}
function spirit() {
  resetFactoryState(); const world = createArgosWorld("Apartment"); initializeRegistry(world);
  startCommittedEvents(world);
  const registry = createSystemRegistry(), spirits = createSpiritRegistry(world);
  const architect = createDynamicSpirit(spirits, { name: "Weaver", type: "architect", rank: "archangel", domain: "ecology",
    architectConfig: { canProposeSystems: true, canProposeEntities: true, canProposeComponents: true, canProposeRules: true, canExecuteDirectly: true, proposalApproval: "auto", maxProposalsPerCycle: 3, bindFurnishingMotivation: true } })!;
  return { world, registry, architect, spirits };
}

test.each(["direct", "queued", "uncited", "invented", "changed_goal", "changed_identity", "substitute"])(
  "place opportunities bind the real cited visitor without constructing or moving them: %s", async boundary=>{
    const f=spirit();initializePrefabs(f.world);enableRoomRouteTopology(f.world);
    const street=createRoomEntity(f.world,{name:"Street"});
    const actor=createAgentEntity(f.world,{name:"Ada",role:"visitor",systemPrompt:"Choose freely",roomId:street});
    const goal=createIntentGoal(f.world,actor,"Visit the workshop and discuss a repair",7);
    if(boundary==="queued") {f.architect.architectConfig!.canExecuteDirectly=false;f.architect.architectConfig!.proposalApproval="superior";}
    let ref="";
    generate.mockImplementation(async input=>{
      if(input.prompt.includes("identify 0-3")) {
        const records=JSON.parse(input.prompt.split("- Actor intentions (author-only evidence, not other NPCs' knowledge): ")[1].split("\n")[0]);
        ref=records.find((r:any)=>r.actor==="Ada"&&r.kind==="goal").ref;
        if(boundary==="invented")ref="intention:invented";
        return {text:JSON.stringify([{type:"entity",description:"A workshop with someone to consult",rationale:"Offer the desired meeting",expectedChange:"Ada can meet a clockmaker after arriving",
          evidence:boundary==="uncited"||boundary==="invented"?[`entity:${street}`]:[ref],supportRequirements:[
            {id:"visitor",kind:"existing_actor",intentionRef:ref,description:"The person with the cited intention"},
            {id:"host",kind:"entity",entityType:"agent",description:"A clockmaker"},
            {id:"consult",kind:"interaction",actor:"visitor",target:"host",affordance:"talk",description:"The visitor can speak to the clockmaker"},
          ]}])};
      }
      if(boundary==="changed_goal")Goal.status[goal]="completed";
      if(boundary==="changed_identity")WorkingMemoryIdentity.id[actor]="replacement";
      return {text:JSON.stringify({name:"Workshop",type:"room",description:"A small workshop",components:[],connectToRoomEids:[street],
        existingActors:[{id:"visitor",intentionRef:ref}],
        contents:[{id:"host",entity:{name:"Nora",description:"A clockmaker",type:"agent",components:[]}}],
        requiredInteractions:[{actor:boundary==="substitute"?"host":"visitor",target:"host",affordance:"talk"}]})};
    });
    const proposals=await runArchitectCognition(f.world,f.registry,f.spirits,f.architect);
    if(boundary==="queued") {expect(proposals).toHaveLength(1);approveProposal(proposals[0].id);queueAllApprovedProposals(f.world,f.registry);}
    const builds=getPlaceBuildStatus(f.world,f.registry);
    if(boundary==="direct"||boundary==="queued") {
      expect(builds).toHaveLength(1);expect(builds[0]).toMatchObject({phase:"constructed",readyNow:false,support:{status:"awaiting_presence"}});
      expect(builds[0].members.map(m=>m.name).sort()).toEqual(["Nora","Workshop"]);
      expect(Goal.progress[goal]).toBe(0);expect(getRoomForEntity(f.world,actor)).toBe(street);
      setLocatedIn(f.world,actor,builds[0].members.find(m=>m.id==="room")!.eid);
      expect(getPlaceBuildStatus(f.world,f.registry)[0]).toMatchObject({readyNow:true,support:{status:"available"}});
      expect(Goal.progress[goal]).toBe(0);
    } else {expect(proposals).toEqual([]);expect(builds).toEqual([]);}
    stopCommittedEvents(f.world);
  });

test.each(["missing_contract", "empty", "wrong_type", "wrong_role", "missing_system", "complete", "queued_complete", "changed_before_execution"])(
  "place designer cannot weaken the preceding author's support requirements: %s", async boundary=>{
    const f=spirit(); initializePrefabs(f.world);
    f.architect.architectConfig!.canExecuteDirectly=false; f.architect.architectConfig!.proposalApproval="superior";
    const street=createRoomEntity(f.world,{name:"Street"}); enableRoomRouteTopology(f.world);
    const actor=createAgentEntity(f.world,{name:"Ada",role:"visitor",systemPrompt:"Choose freely",roomId:street});
    const goal=createIntentGoal(f.world,actor,"Find shelter, somewhere to sit, and a person who runs the shelter",7);
    const supportRequirements=[
      {id:"entry",kind:"connection",roomEid:street,description:"Access from the street"},
      {id:"host",kind:"entity",entityType:"agent",role:"attendant",description:"A person who runs this place"},
      {id:"seat",kind:"entity",entityType:"object",objectType:"chair",description:"A usable seat"},
      {id:"inspect",kind:"interaction",actor:"host",target:"seat",affordance:"examine",description:"The seat can be inspected"},
      {id:"heat",kind:"system",name:"ShelterHeat",description:"An operating heating mechanic"},
    ];
    let designed=false;
    generate.mockImplementation(async input=>{
      if(input.prompt.includes("identify 0-3")) {
        const records=JSON.parse(input.prompt.split("- Actor intentions (author-only evidence, not other NPCs' knowledge): ")[1].split("\n")[0]);
        return {text:JSON.stringify([{type:"entity",description:"Provide shelter",rationale:"Support the cited purpose",evidence:[records.find((r:any)=>r.actor==="Ada"&&r.kind==="goal").ref],
          expectedChange:"A reachable shelter with an attendant, seat and heating exists",
          ...(boundary==="missing_contract"?{}:{supportRequirements})}])};
      }
      designed=true;
      return {text:JSON.stringify({name:"Shelter",description:"Shelter with an attendant, chair and heating",type:"room",components:[],connectToRoomEids:[street],
        requiredSystems:boundary==="missing_system"?[]:["ShelterHeat"],requiredInteractions:boundary==="empty"?[]:[{actor:"host",target:"seat",affordance:"examine"}],
        contents:boundary==="empty"?[]:[
          {id:"host",entity:{name:"Nora",description:"An attendant",type:"agent",components:[{name:"Agent",values:{role:boundary==="wrong_role"?"visitor":"attendant"}}]}},
          {id:"seat",entity:{name:"Chair",description:"A chair",type:"object",components:[{name:"ObjectType",values:{typeId:boundary==="wrong_type"?"object":"chair"}}]}},
        ]})};
    });
    const proposals=await runArchitectCognition(f.world,f.registry,f.spirits,f.architect); expect(designed).toBe(true);
    if(!["complete","queued_complete","changed_before_execution"].includes(boundary)) expect(proposals).toEqual([]);
    else {
      expect(proposals).toHaveLength(1);
      if(boundary==="changed_before_execution") (proposals[0].specification as any).contents=[];
      approveProposal(proposals[0].id);
      if(boundary==="queued_complete") queueAllApprovedProposals(f.world,f.registry); else await executeAllApprovedProposals(f.world,f.registry);
      expect(proposals[0].status).toBe(boundary!=="changed_before_execution"?"executed":"failed");
      if(boundary!=="changed_before_execution") expect(getPlaceBuildStatus(f.world,f.registry)[0]).toMatchObject({phase:"constructed",support:{status:"unavailable",unmet:[{id:"heat",reason:"system_unavailable"}]}});
    }
    expect(Goal.progress[goal]).toBe(0); expect(getRoomForEntity(f.world,actor)).toBe(street);
    if(!["complete","queued_complete"].includes(boundary)) expect(query(f.world,[Name]).some(eid=>Name.value[eid]==="Shelter")).toBe(false);
    stopCommittedEvents(f.world);
  });

test("needs validation retains valid support requirements and rejects malformed contracts instead of discarding them",()=>{
  const c=context(), need={type:"entity",description:"An empty passage",evidence:["entity:1"],expectedChange:"A passage exists",
    supportRequirements:[{id:"space",kind:"space",description:"An empty transit space"}]};
  const [admitted]=validateObservedNeeds([need],c);expect(admitted.supportRequirements).toEqual(need.supportRequirements);
  need.supportRequirements.splice(0);expect(admitted.supportRequirements).toHaveLength(1);
  expect(validateObservedNeeds([need,{...need,type:"system",supportRequirements:admitted.supportRequirements}],c)).toEqual([]);
});

test.each(["complete","queued","prose_only","blank_data"])("data requirements survive actual architect needs/design admission: %s",async boundary=>{
  const f=spirit();initializePrefabs(f.world);
  const street=createRoomEntity(f.world,{name:"Street"}),actor=createAgentEntity(f.world,{name:"Ada",role:"visitor",roomId:street,systemPrompt:"Choose freely"});
  const goal=createIntentGoal(f.world,actor,"Visit the observatory and compare its recorded measurements",7);
  if(boundary==="queued"){f.architect.architectConfig!.canExecuteDirectly=false;f.architect.architectConfig!.proposalApproval="superior";}
  generate.mockImplementation(async input=>{
    if(input.prompt.includes("identify 0-3")) {
      expect(input.prompt).toContain("in_world_document");expect(input.prompt).toContain("read_document");
      const rows=JSON.parse(input.prompt.split("- Actor intentions (author-only evidence, not other NPCs' knowledge): ")[1].split("\n")[0]);
      return {text:JSON.stringify([{type:"entity",description:"An observatory with recorded data",rationale:"Serve the current visit",expectedChange:"Actual measurements exist in a readable physical record",
        evidence:[rows.find((r:any)=>r.actor==="Ada"&&r.kind==="goal").ref],supportRequirements:[
          {id:"record",kind:"entity",entityType:"object",objectType:"object",description:"A record"},
          {id:"measurements",kind:"data",target:"record",component:"WikiDoc",fields:["body"],description:"Actual measurements"},
        ]}])};
    }
    expect(input.prompt).toContain('"kind":"data"');expect(input.prompt).toContain('"component":"WikiDoc"');
    return {text:JSON.stringify({name:"Observatory",description:"A scientific room",type:"room",components:[],contents:[{id:"record",entity:{name:"Measurements",description:"Tonight\u2019s readings are here: 12 and 17 arcseconds.",type:"object",components:[
      {name:"ObjectType",values:{typeId:"object"}},
      ...(boundary==="prose_only"?[]:[{name:"WikiDoc",values:{title:"Measurements",status:"draft",body:boundary==="blank_data"?"":"12 and 17 arcseconds"}},
        {name:"WorkDocument",values:{revision:0,reviewedRevision:-1,deviceKey:"",lastWriterKey:"",completedAtSimMs:-1}}]),
    ]}}]})};
  });
  const proposals=await runArchitectCognition(f.world,f.registry,f.spirits,f.architect);
  if(boundary==="queued"){expect(proposals).toHaveLength(1);approveProposal(proposals[0].id);queueAllApprovedProposals(f.world,f.registry);}
  if(boundary==="complete"||boundary==="queued"){
    const place=getPlaceBuildStatus(f.world,f.registry)[0];expect(place.support.status).toBe("available");
    const record=place.members.find(m=>m.id==="record")!;expect(getComponent("WikiDoc").body[record.eid]).toBe("12 and 17 arcseconds");
  } else {expect(proposals).toEqual([]);expect(getPlaceBuildStatus(f.world,f.registry)).toEqual([]);}
  expect(getRoomForEntity(f.world,actor)).toBe(street);expect(Goal.progress[goal]).toBe(0);stopCommittedEvents(f.world);
});

test("God's actual type listing and prompt supply spawnable registry IDs, not display labels",async()=>{
  const f=spirit(); initializePrefabs(f.world); const god=createGodAgent(f.world,{name:"God",worldName:"Apartment",narrative:""});
  let inspected=false;
  generate.mockImplementation(async input=>{
    const listed=await input.tools.listObjectTypes.execute({},{});
    expect(listed.success).toBe(true);
    for(const row of listed.result) expect(worldSchema.getObjectType(row.name)).toBeDefined();
    expect(listed.result).toEqual(expect.arrayContaining([expect.objectContaining({name:"food_item",typeId:"food_item",displayName:"food"})]));
    expect(input.system).toContain("food_item");inspected=true;
    return {text:"Inspected current IDs.",steps:[{toolCalls:[],toolResults:[]}]};
  });
  await godThink(god,"Inspect the spawnable type vocabulary.");expect(inspected).toBe(true);stopCommittedEvents(f.world);
});

test("author observations contain the native directed routes used by real locomotion, without teaching NPCs the global map", async () => {
  const f=spirit(); initializePrefabs(f.world);
  const street=createRoomEntity(f.world,{name:"Street"}), venue=createRoomEntity(f.world,{name:"Workshop"}), remote=createRoomEntity(f.world,{name:"Distant yard"});
  const actor=createAgentEntity(f.world,{name:"Ada",role:"visitor",systemPrompt:"PRIVATE_MIND",roomId:street});
  enableRoomRouteTopology(f.world,{travelMs:4200});
  connectRoomRoute(f.world,street,venue);
  connectRoomRoute(f.world,venue,remote,{bidirectional:false});
  const context=await gatherArchitectContext(f.world,f.registry);
  let actualInput:any;
  generate.mockImplementation(async input=>{actualInput=input;return {text:"[]"};});
  await identifyNeeds(f.architect,context);
  const setting=JSON.parse(actualInput.prompt.split("- Setting and entities (entity:<eid> evidence): ")[1].split("\n")[0]);
  expect(setting.entities.find((e:any)=>e.eid===street).routeExits).toEqual({status:"available",travelMs:4200,targets:[{eid:venue,name:"Workshop"}],omittedTargets:0});
  expect(setting.entities.find((e:any)=>e.eid===venue).routeExits.targets.map((e:any)=>e.eid)).toEqual([street,remote]);
  expect(setting.entities.find((e:any)=>e.eid===remote).routeExits.targets).toEqual([]);
  expect(getRoomRouteTargets(f.world,actor)).toEqual([venue]);
  expect(JSON.stringify(captureCognitiveLocalView(f.world,actor))).not.toContain("Distant yard");
  expect(JSON.stringify(setting)).not.toContain("PRIVATE_MIND");
  disconnectRoomRoute(f.world,street,venue);
  const fresh=await gatherArchitectContext(f.world,f.registry);
  expect(fresh.setting.entities.find(e=>e.eid===street)?.routeExits?.targets).toEqual([]);
  expect(setting.entities.find((e:any)=>e.eid===street).routeExits.targets).toHaveLength(1); // Old input is an observation, not a live getter.
});

test.each(["needs", "design", "approval", "reopened", "new_exit", "endpoint_only", "unrelated", "current"])(
  "delayed architect construction keeps relevant observed exits fresh: %s", async boundary => {
    const f=spirit(); initializePrefabs(f.world);
    f.architect.architectConfig!.canExecuteDirectly=false;
    f.architect.architectConfig!.proposalApproval="superior";
    const street=createRoomEntity(f.world,{name:"Street"}), square=createRoomEntity(f.world,{name:"Square"});
    const yard=createRoomEntity(f.world,{name:"Yard"}), shed=createRoomEntity(f.world,{name:"Shed"});
    const actor=createAgentEntity(f.world,{name:"Ada",role:"visitor",systemPrompt:"Choose freely",roomId:street});
    createIntentGoal(f.world,actor,"Visit a workshop to repair my clock",7);
    const disable=enableRoomRouteTopology(f.world); connectRoomRoute(f.world,street,square);
    const change=()=>{
      if(boundary==="unrelated") connectRoomRoute(f.world,yard,shed);
      else if(boundary==="new_exit") connectRoomRoute(f.world,street,yard);
      else if(boundary!=="current") {
        disconnectRoomRoute(f.world,street,square);
        if(boundary==="reopened") connectRoomRoute(f.world,street,square);
      }
    };
    let designs=0;
    generate.mockImplementation(async input=>{
      if(input.prompt.includes("identify 0-3")) {
        const records=JSON.parse(input.prompt.split("- Actor intentions (author-only evidence, not other NPCs' knowledge): ")[1].split("\n")[0]);
        if(boundary==="needs") change();
        return {text:JSON.stringify([{type:"entity",description:"Provide a reachable workshop",rationale:"Support the current repair intention",
          evidence:[records.find((r:any)=>r.actor==="Ada"&&r.kind==="goal").ref,...(boundary==="endpoint_only"?[]:[`entity:${street}`])],
          expectedChange:"A connected workshop and a resident clockmaker exist",supportRequirements:[{id:"keeper",kind:"entity",entityType:"agent",description:"A clockmaker in the new room"}]}])};
      }
      designs++;
      if(boundary==="design"||boundary==="endpoint_only") change();
      return {text:JSON.stringify({name:"Workshop",description:"A clockmaker's workshop",type:"room",components:[],
        contents:[{id:"keeper",entity:{name:"Rafi",description:"A clockmaker",type:"agent",components:[]}}],connectToRoomEids:[street,square]})};
    });
    try {
      const proposals=await runArchitectCognition(f.world,f.registry,f.spirits,f.architect);
      if(["needs","design","endpoint_only"].includes(boundary)) {
        expect(proposals).toEqual([]); expect(designs).toBe(boundary==="needs"?0:1);
      } else {
        expect(proposals).toHaveLength(1); change(); approveProposal(proposals[0].id);
        const result=await executeAllApprovedProposals(f.world,f.registry);
        if(["unrelated","current"].includes(boundary)) {
          expect(result.executed).toEqual(["Workshop"]);
          const status=getPlaceBuildStatus(f.world,f.registry)[0];
          expect(status).toMatchObject({phase:"constructed",readyNow:true}); expect(status.members).toHaveLength(2);
        } else expect(result.failed).toEqual(["Workshop"]);
      }
      if(!["unrelated","current"].includes(boundary)) {
        expect(query(f.world,[Name]).filter(eid=>["Workshop","Rafi"].includes(Name.value[eid]))).toEqual([]);
        expect(getPlaceBuildStatus(f.world,f.registry)).toEqual([]);
      }
      expect(getRoomForEntity(f.world,actor)).toBe(street);
    } finally { disable(); stopCommittedEvents(f.world); }
  });

test("actual design receives cited intention contents and rationale, not opaque IDs or unrelated private plans", async () => {
  const f=spirit(); initializePrefabs(f.world);
  const street=createRoomEntity(f.world,{name:"Street"}); enableRoomRouteTopology(f.world);
  const actor=createAgentEntity(f.world,{name:"Ada",role:"visitor",systemPrompt:"PRIVATE_SYSTEM_PROMPT",roomId:street});
  const purpose="Visit the workshop to discuss repairing the broken clock";
  createIntentGoal(f.world,actor,purpose,7);
  createIntentGoal(f.world,actor,"UNRELATED_PRIVATE_PLAN",6);
  let ref:string|undefined, designInput:any;
  const rationale="The observed repair intention needs a reachable workspace, not a performance venue.";
  generate.mockImplementation(async input=>{
    if(input.prompt.includes("identify 0-3")) {
      const records=JSON.parse(input.prompt.split("- Actor intentions (author-only evidence, not other NPCs' knowledge): ")[1].split("\n")[0]);
      ref=records.find((r:any)=>r.description===purpose).ref;
      return {text:JSON.stringify([{type:"entity",description:"Add a reachable venue",rationale,evidence:[ref,`entity:${street}`],expectedChange:"A workshop reachable from the Street exists",
        supportRequirements:[{id:"entry",kind:"connection",roomEid:street,description:"A route to the provisional space"}]}])};
    }
    designInput=input;
    return {text:JSON.stringify({name:"Workshop",description:"A workshop",type:"room",components:[],contents:[],connectToRoomEids:[street]})};
  });
  const proposals=await runArchitectCognition(f.world,f.registry,f.spirits,f.architect);
  expect(designInput).toBeDefined();
  const evidence=JSON.parse(designInput.prompt.split("Observed evidence: ")[1].split("\n")[0]);
  expect(evidence).toEqual([
    {ref,observation:expect.objectContaining({actor:"Ada",kind:"goal",description:purpose})},
    {ref:`entity:${street}`,observation:expect.objectContaining({eid:street,name:"Street",isRoom:true,routeExits:expect.objectContaining({status:"available"})})}
  ]);
  expect(designInput.prompt).toContain(rationale);
  expect(designInput.prompt).not.toContain("UNRELATED_PRIVATE_PLAN");
  expect(designInput.prompt).not.toContain("PRIVATE_SYSTEM_PROMPT");
  expect(proposals).toHaveLength(1); expect(proposals[0].status).toBe("executed");
  expect(getRoomForEntity(f.world,actor)).toBe(street); // Observations and construction did not enact the intention.
});

test.each([
  "Meet Lin at the Orchard restaurant for dinner",
  "Visit the observatory to compare the comet measurements",
  "Take the broken clock to the workshop for repair",
])("explicit intention edits reach production authoring consumers with their untouched purpose: %s", async original => {
  const f=spirit(); initializePrefabs(f.world);
  const street=createRoomEntity(f.world,{name:"Street"}); enableRoomRouteTopology(f.world);
  const actor=createAgentEntity(f.world,{name:"Ada",role:"visitor",systemPrompt:"PRIVATE_CHARACTER_DETAIL",roomId:street});
  workingMemoryEntityRef(f.world,actor);
  const goal=createPersonalIntention(f.world,actor,original,7)!;
  expect(prepareIntentionReconsideration(captureIntentionReconsideration(f.world,actor),[{goalId:goal,disposition:"refine",
    edits:[{op:"append",text:"Bring my notebook."}],reason:"I want to refer to my notes"}])!.commit()).toBe(true);
  let needsSaw=false,designerSaw=false;
  generate.mockImplementation(async input=>{
    if(input.prompt.includes("identify 0-3")) {
      const records=JSON.parse(input.prompt.split("- Actor intentions (author-only evidence, not other NPCs' knowledge): ")[1].split("\n")[0]);
      const record=records.find((r:any)=>r.actor==="Ada"&&r.kind==="goal");
      expect(record.description).toBe(`${original} Bring my notebook.`); needsSaw=true;
      return {text:JSON.stringify([{type:"entity",description:"A new reachable destination",rationale:"Support the cited intention",
        evidence:[record.ref,`entity:${street}`],expectedChange:"A physical destination exists; no arrival or completed work claimed",
        supportRequirements:[{id:"space",kind:"space",description:"An explicitly empty provisional space"}]}])};
    }
    const records=JSON.parse(input.prompt.split("Observed evidence: ")[1].split("\n")[0]);
    expect(records[0].observation.description).toBe(`${original} Bring my notebook.`); designerSaw=true;
    return {text:JSON.stringify({name:"Destination",description:"An explicitly empty provisional space",type:"room",components:[],contents:[],connectToRoomEids:[street]})};
  });
  const proposals=await runArchitectCognition(f.world,f.registry,f.spirits,f.architect);
  expect(needsSaw&&designerSaw).toBe(true); expect(proposals[0]?.status).toBe("executed");
  expect(getRoomForEntity(f.world,actor)).toBe(street); expect(Goal.progress[goal]).toBe(0);
  // The controlled designer did NOT produce a useful restaurant/observatory/
  // workshop. This verifies causal input preservation, not semantic acceptance.
});

test.each(["room_missing_contents","object_missing_type","empty_transit","typed_table"])("fresh entity designs require explicit assembly and object kind: %s",async variant=>{
  const f=spirit();initializePrefabs(f.world);const room=createRoomEntity(f.world,{name:"Street"});enableRoomRouteTopology(f.world);
  let designed=false;
  generate.mockImplementation(async input=>{
    if(input.prompt.includes("identify 0-3"))return {text:JSON.stringify([{type:"entity",description:"Add a usable meeting place or fixture",priority:"medium",
      rationale:"A new physical possibility",evidence:[`entity:${room}`],expectedChange:"A real reachable space or typed fixture exists",
      ...(["room_missing_contents","empty_transit"].includes(variant)?{supportRequirements:[{id:"space",kind:"space",description:"An empty transit space"}]}:{})}])};
    designed=true;
    return {text:JSON.stringify(variant.startsWith("room")||variant==="empty_transit"
      ?{name:"Passage",description:"An empty passage.",type:"room",components:[],connectToRoomEids:[room],...(variant==="empty_transit"?{contents:[]}:{})}
      :{name:"Countertop",description:"A wooden table.",type:"object",roomEid:room,components:variant==="typed_table"?[{name:"ObjectType",values:{typeId:"table"}}]:[]})};
  });
  const proposals=await runArchitectCognition(f.world,f.registry,f.spirits,f.architect);
  expect(designed).toBe(true);
  expect(proposals).toHaveLength(["empty_transit","typed_table"].includes(variant)?1:0);
  if(proposals.length)expect(proposals[0].status).toBe("executed");
});

test("the actual entity designer receives registered type choices and component fields, not live private actor state",async()=>{
  const f=spirit();initializePrefabs(f.world);const room=createRoomEntity(f.world,{name:"Street"});
  createAgentEntity(f.world,{name:"Ada",roomId:room,role:"resident",systemPrompt:"PRIVATE_ACTOR_VALUE"});
  let catalog:any;
  generate.mockImplementation(async input=>{
    if(input.prompt.includes("identify 0-3"))return {text:JSON.stringify([{type:"entity",description:"Add a seat",evidence:[`entity:${room}`],expectedChange:"An actual seat exists"}])};
    const line=input.prompt.split("\n").find((line:string)=>line.startsWith("Entity authoring catalog"));
    catalog=JSON.parse(line.slice(line.indexOf(": ")+2));
    return {text:JSON.stringify({name:"Seat",description:"A seat",type:"object",roomEid:room,components:[{name:"ObjectType",values:{typeId:"chair"}}]})};
  });
  const proposals=await runArchitectCognition(f.world,f.registry,f.spirits,f.architect);
  expect(catalog).toBeDefined();
  expect(catalog.objectTypes).toEqual(expect.arrayContaining([expect.objectContaining({typeId:"chair",defaultState:"empty",states:expect.arrayContaining(["empty","occupied"])})]));
  expect(catalog.objectTypes.find((t:any)=>t.typeId==="laptop").defaultComponents).toEqual(expect.arrayContaining([
    expect.objectContaining({name:"Battery",registration:"declared_by_type",fields:{current:"number",max:"number"}})
  ]));
  expect(catalog.componentSchemas).toEqual(expect.arrayContaining([expect.objectContaining({name:"PhysicalObject",fields:expect.objectContaining({portable:"boolean",weight:"number"})}),
    expect.objectContaining({name:"Agent",fields:expect.objectContaining({role:"string",systemPrompt:"string"})})]));
  expect(catalog.componentSchemas.some((c:any)=>["Mind","ExternalParticipant","ParticipantEmbodiment"].includes(c.name))).toBe(false);
  expect(JSON.stringify(catalog)).not.toContain("PRIVATE_ACTOR_VALUE");
  expect(proposals[0]?.status).toBe("executed");
});

test.each(["during_design","before_execution","unrelated"])("actual architect typed design rechecks the %s type boundary",async boundary=>{
  const f=spirit();initializePrefabs(f.world);const room=createRoomEntity(f.world,{name:"Street"});
  f.architect.architectConfig!.canExecuteDirectly=false;f.architect.architectConfig!.proposalApproval="superior";
  const original=worldSchema.getObjectType("chair")!;
  let reached=false;
  try {
    generate.mockImplementation(async input=>{
      if(input.prompt.includes("identify 0-3"))return {text:JSON.stringify([{type:"entity",description:"Add a seat",evidence:[`entity:${room}`],expectedChange:"A usable seat exists"}])};
      reached=true;
      if(boundary==="during_design")worldSchema.defineObjectType({...original,description:"Changed while author thought"});
      return {text:JSON.stringify({name:"Seat",description:"A seat",type:"object",roomEid:room,components:[{name:"ObjectType",values:{typeId:"chair"}}]})};
    });
    const proposals=await runArchitectCognition(f.world,f.registry,f.spirits,f.architect);
    expect(reached).toBe(true);
    if(boundary==="during_design")expect(proposals).toHaveLength(0);
    else {
      expect(proposals).toHaveLength(1);approveProposal(proposals[0].id);
      worldSchema.defineObjectType({...original,name:boundary==="unrelated"?"other_seat":"chair",description:"Changed before admission"});
      await executeAllApprovedProposals(f.world,f.registry);
      expect(proposals[0].status).toBe(boundary==="unrelated"?"executed":"failed");
    }
    expect([...query(f.world,[Name])].some(eid=>Name.value[eid]==="Seat")).toBe(boundary==="unrelated");
  } finally {worldSchema.defineObjectType(original);}
});

test.each(["direct","approved","queued","changed_goal","changed_child","invalid_child"])("inhabited place design follows actual architect execution and freshness (%s)",async boundary=>{
  const f=spirit(); initializePrefabs(f.world);
  const street=createRoomEntity(f.world,{name:"Street"}), actor=createAgentEntity(f.world,{name:"Ada",roomId:street,role:"resident",systemPrompt:"Choose freely"});
  const goal=createIntentGoal(f.world,actor,"Visit the workshop to discuss a repair",7);
  enableRoomRouteTopology(f.world);
  if(boundary!=="direct") { f.architect.architectConfig!.canExecuteDirectly=false; f.architect.architectConfig!.proposalApproval="superior"; }
  generate.mockImplementation(async input=>{
    if(input.prompt.includes("identify 0-3")) {
      const records=JSON.parse(input.prompt.split("- Actor intentions (author-only evidence, not other NPCs' knowledge): ")[1].split("\n")[0]);
      const record=records.find((r:any)=>r.actor==="Ada" && r.kind==="goal");
      return {text:JSON.stringify([{type:"entity",description:"Provide an inhabited workshop",priority:"high",rationale:"An active repair intention needs a place",
        evidence:[record.ref],expectedChange:"A reachable workshop and native keeper exist; the repair is not yet done",
        supportRequirements:[{id:"keeper",kind:"entity",entityType:"agent",description:"A native keeper"},{id:"repair",kind:"system",name:"RepairBench",description:"The repair mechanic"}]}])};
    }
    expect(input.prompt).toContain("contents array");
    return {text:JSON.stringify({name:"Workshop",description:"A workshop and its keeper.",type:"room",components:[],connectToRoomEids:[street],requiredSystems:["RepairBench"],
      contents:[{id:"keeper",entity:{name:"Nora",description:"The keeper.",type:"agent",components:boundary==="invalid_child" ? [{name:"MissingComponent",values:{}}] : []}}]})};
  });
  const proposals=await runArchitectCognition(f.world,f.registry,f.spirits,f.architect);
  if(boundary==="invalid_child") expect(proposals).toEqual([]);
  else {
    expect(proposals).toHaveLength(1);
    if(boundary==="changed_goal") Goal.status[goal]="paused";
    if(boundary==="changed_child") (proposals[0].specification as any).contents[0].entity.name="Different person";
    if(boundary!=="direct") {
      approveProposal(proposals[0].id);
      if(boundary==="queued") queueAllApprovedProposals(f.world,f.registry);
      else await executeAllApprovedProposals(f.world,f.registry);
    }
  }
  const successful=["direct","approved","queued"].includes(boundary), status=getPlaceBuildStatus(f.world,f.registry);
  expect(status).toHaveLength(successful?1:0);
  if(successful) {
    expect(proposals[0].status).toBe("executed"); expect(status[0]).toMatchObject({phase:"constructed",readyNow:false,unmet:["system:RepairBench"]});
    expect(status[0].members).toHaveLength(2);
    const context=await gatherArchitectContext(f.world,f.registry);
    expect(context.placeBuilds).toEqual(status);
    expect(getRoomRouteTargets(f.world,actor)).toEqual([status[0].members[0].eid]);
    const daemons=createDaemonRegistry(); createDaemonsForAllAgents(daemons,f.world);
    expect(daemons.daemons.has(status[0].members.find(m=>m.id==="keeper")!.eid)).toBe(true);
  }
  expect(getRoomForEntity(f.world,actor)).toBe(street); expect(Goal.progress[goal]).toBe(0);
});

test("God's real model tool surface builds and observes the same native place, without delegating speculative furnishings",async()=>{
  const f=spirit(); initializePrefabs(f.world); resetStewardState();
  const god=createGodAgent(f.world,{name:"God",worldName:"Town",narrative:""});
  let result:any;
  generate.mockImplementation(async input=>{
    expect(input.tools.createPlace).toBeDefined(); expect(input.tools.getPlaceBuilds).toBeDefined();
    expect(input.tools.createAndPopulateRoom.description).toContain("does not create NPCs");
    const blueprint={name:"Workshop",description:"A place for repairs.",type:"room",components:[],contents:[
      {id:"keeper",entity:{name:"Nora",description:"A careful keeper.",type:"agent",components:[]}}],requiredSystems:["RepairBench"]};
    expect(input.tools.createPlace.inputSchema.safeParse(blueprint).success).toBe(true);
    result=await input.tools.createPlace.execute(blueprint,{});
    expect(await input.tools.getPlaceBuilds.execute({},{})).toMatchObject({success:true,result:[result.result]});
    return {text:"Native assembly exists; repair mechanic is still absent.",steps:[{toolCalls:[],toolResults:[]}]};
  });
  await godThink(god,"Build a small populated workshop, then report what is missing.");
  expect(result).toMatchObject({success:true,result:{phase:"constructed",readyNow:false,unmet:["system:RepairBench"]}});
  expect(god.registry.byName.get("Nora")).toBe(result.result.members[1].eid);
  expect(getPendingRoomRequests(f.world)).toEqual([]);
});

test.each([false,true])("God's real createPlace tool requires typed props before allocating any member: %s",async typed=>{
  const f=spirit();initializePrefabs(f.world);
  const god=createGodAgent(f.world,{name:"God",worldName:"Town",narrative:""});
  const before=getWorldConstructionStatus(f.world).admitted;
  let result:any;
  generate.mockImplementation(async input=>{
    result=await input.tools.createPlace.execute({name:"Parlor",description:"A furnished room",type:"room",components:[],contents:[
      {id:"seat",entity:{name:"Visitor seat",description:"A chair",type:"object",components:typed?[{name:"ObjectType",values:{typeId:"chair"}}]:[]}}
    ]},{});
    return {text:"Report the actual native admission result",steps:[{toolCalls:[],toolResults:[]}]};
  });
  await godThink(god,"Build a room and its furniture through native assembly.");
  expect(result).toBeDefined();expect(result.success).toBe(typed);
  expect(getWorldConstructionStatus(f.world).admitted-before).toBe(typed?2:0);
  expect([...query(f.world,[Name])].some(eid=>Name.value[eid]==="Visitor seat")).toBe(typed);
});

test("unfinished legacy work reaches the actual God and architect input without a false supply claim",async()=>{
  resetWorldCrafterState();
  const f=spirit(); initializePrefabs(f.world);
  const god=createGodAgent(f.world,{name:"God",worldName:"Town",narrative:""});
  try {
    const proposal:import("../world-crafter-spirit").EvolutionProposal={id:"legacy-route",timestamp:Date.now(),type:"trade_route",status:"pending",
      addressesGaps:["copper"],proposal:{description:"A route bringing copper to town."}};
    getWorldCrafterState().evolutionProposals.push(proposal); approveEvolutionProposal(proposal.id,f.world);
    expect(await executeEvolutionProposal(proposal,god)).toBe(false);
    const context=await gatherArchitectContext(f.world,f.registry);
    expect(context.legacyEvolution?.work[0]).toMatchObject({id:"legacy-route",status:"failed",resourcesVerified:false,executionAvailable:false});
    let architectSaw=false,godSaw=false;
    generate.mockImplementation(async input=>{
      expect(input.prompt).toContain('"resourcesVerified":false'); expect(input.prompt).toContain("legacy-route");
      architectSaw=true;
      return {text:"[]"};
    });
    expect(await identifyNeeds(f.architect,context)).toEqual([]);
    expect(architectSaw).toBe(true);
    generate.mockImplementation(async input=>{
      expect(input.system).toContain("Legacy evolution work"); expect(input.system).toContain("legacy-route");
      expect(input.system).toContain('"resourcesVerified":false');
      godSaw=true;
      return {text:"The trade route has not been implemented.",steps:[{toolCalls:[],toolResults:[]}]};
    });
    await godThink(god,"Review unfinished construction.");
    expect(godSaw).toBe(true);
  } finally {resetWorldCrafterState();}
});
beforeEach(() => { generate.mockReset(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No live inference in architecture tests")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); resetFactoryState(); });

test.each(["{}", "null", '"quiet"', "[]"])("needs telemetry distinguishes invalid shape from a valid empty array: %s", async response => {
  const f = spirit(), diagnostic = beginArchitectDiagnostics(f.world, f.architect.eid);
  generate.mockResolvedValue({ text: response });
  expect(await identifyNeeds(f.architect, context(), diagnostic)).toEqual([]);
  const entries = getArchitectDiagnostics(f.world).entries;
  if (response === "[]") expect(entries.at(-1)).toMatchObject({ stage: "needs", outcome: "completed", candidates: 0 });
  else {
    expect(entries.at(-1)).toMatchObject({ stage: "needs", outcome: "rejected", reason: "non_array" });
    expect(entries.some(e => e.outcome === "completed")).toBe(false);
  }
});

test.each(["current", "needs", "design", "approval", "source", "policy", "copy", "foreign_world", "travel", "changed_spec"])("intention-driven entity proposal respects the %s boundary", async boundary => {
  const f = spirit(); initializePrefabs(f.world);
  expect(f.spirits.spirits.get(f.architect.eid)).toBe(f.architect);
  f.architect.architectConfig!.canExecuteDirectly = false;
  f.architect.architectConfig!.proposalApproval = "superior";
  const street = createRoomEntity(f.world,{name:"Street"});
  const actor = createAgentEntity(f.world,{name:"Ada",roomId:street,role:"resident",systemPrompt:"Choose freely"});
  const goal = createIntentGoal(f.world,actor,"Meet a friend for dinner",7);
  generate.mockImplementation(async input => {
    if(input.prompt.includes("identify 0-3")) {
      const records = JSON.parse(input.prompt.split("- Actor intentions (author-only evidence, not other NPCs' knowledge): ")[1].split("\n")[0]);
      const record = records.find((r:any)=>r.kind==="goal" && r.actor==="Ada");
      expect(record.description).toBe("Meet a friend for dinner");
      if(boundary==="needs") Goal.status[goal]="paused";
      return {text:JSON.stringify([{type:"entity",description:"Provide a place to meet for dinner",priority:"high",
        rationale:"An active intention needs a destination",evidence:[record.ref],expectedChange:"A named room exists for a later validated route",
        supportRequirements:[{id:"space",kind:"space",description:"A provisional named space"}]}])};
    }
    if(boundary==="design") Goal.status[goal]="paused";
    return {text:JSON.stringify({name:"Meeting Place",description:"A modest place for dinner",type:"room",components:[],contents:[]})};
  });
  const proposals = await runArchitectCognition(f.world,f.registry,f.spirits,f.architect);
  if(boundary==="needs" || boundary==="design") {
    expect(proposals).toEqual([]);
    expect(getArchitectDiagnostics(f.world).entries.some(row=>row.reason==="stale_observation")).toBe(true);
  } else {
    expect(proposals).toHaveLength(1); expect(proposals[0].observationScopeId).toBeDefined();
    if(boundary==="approval") Goal.status[goal]="paused";
    if(boundary==="source") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
    if(boundary==="policy") f.architect.architectConfig!.canProposeEntities=false;
    if(boundary==="travel") setLocatedIn(f.world,actor,createRoomEntity(f.world,{name:"Square"}));
    if(boundary==="changed_spec") proposals[0].specification={...(proposals[0].specification as object), name:"Changed destination"};
    if(boundary==="copy") {
      const rows=getFactoryState().pendingProposals;
      rows[rows.indexOf(proposals[0])]=JSON.parse(JSON.stringify(proposals[0]));
    }
    approveProposal(proposals[0].id);
    if(boundary==="foreign_world") {
      const other=createArgosWorld("Unrelated world");initializeRegistry(other);
      const foreign=await executeAllApprovedProposals(other,createSystemRegistry());
      expect(foreign).toEqual({executed:[],failed:[],queued:[]});
      expect(proposals[0].status).toBe("approved");
    }
    const result = await executeAllApprovedProposals(f.world,f.registry);
    expect(result.executed).toEqual(["current","foreign_world","travel"].includes(boundary) ? ["Meeting Place"] : []);
  }
  expect(query(f.world,[Room,Name]).filter(id=>Name.value[id]==="Meeting Place")).toHaveLength(["current","foreign_world","travel"].includes(boundary)?1:0);
  expect(Goal.progress[goal]).toBe(0);
});

test.each(["phone detour", "travel rewording", "different destination", "released", "paused", "source restart", "replaced route"])(
  "receipt appraisal → concrete goal → delayed architect design respects %s", async boundary => {
    const f = spirit(); initializePrefabs(f.world); f.world.meta.aiEnabled = true;
    f.world.meta.narrativeMind = true; f.world.meta.experienceReconsideration = true;
    const oldKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY; process.env.GOOGLE_GENERATIVE_AI_API_KEY = "mock-only";
    const street = createRoomEntity(f.world, { name:"Street" });
    const actor = createAgentEntity(f.world, { name:"Ada", role:"resident", systemPrompt:"Choose freely", roomId:street });
    workingMemoryEntityRef(f.world, actor);
    const goal = createPersonalIntention(f.world, actor, "Spend an evening with my friend", 7)!;
    const disable = enableRoomRouteTopology(f.world);
    const choose = (purpose:string, attached = true) => integrateActorContinuation(f.world, actor, { purpose, actionType:"wait", observedAtSimMs:0,
      ...(attached ? { goalId:goal, goalKey:WorkingMemoryIdentity.id[goal] } : {}) });
    const revise = (disposition:string, description?:string) => prepareIntentionReconsideration(captureIntentionReconsideration(f.world,actor),
      [{ goalId:goal, disposition, reason:"My plans have changed", ...(description ? { edits:[{op:"replace",before:Goal.description[goal],after:description}] } : {}) }])!.commit();
    try {
      choose("Decide how to spend the evening");
      expect(queueExperiencedEvent(f.world, actor, { id:"invitation:1", channel:"heard-speech", source:"Lin", content:"Would you like to meet at Orchard?",
        atSimMs:0 })).toBe(true);
      generate.mockResolvedValueOnce({ text:JSON.stringify({ innerThought:"I'd like to go and see them.", intentionRevisions:[{
        goalId:goal, disposition:"refine", edits:[{op:"replace",before:Goal.description[goal],after:"Meet Lin at Orchard for the evening"}], reason:"I chose to accept the invitation" }] }) });
      expect(await runExperienceAppraisal(f.world,actor)).toMatchObject({ status:"admitted", integration:"current" });
      expect(Goal.description[goal]).toBe("Meet Lin at Orchard for the evening");
      choose("Head toward Orchard");
      generate.mockImplementation(async input => {
        if (input.prompt.includes("identify 0-3")) {
          const records = JSON.parse(input.prompt.split("- Actor intentions (author-only evidence, not other NPCs' knowledge): ")[1].split("\n")[0]);
          const demand = records.find((r:any) => r.actor === "Ada" && r.kind === "goal");
          expect(demand.description).toBe("Meet Lin at Orchard for the evening");
          choose(boundary === "phone detour" ? "Answer my phone briefly" : "Walk toward Orchard", boundary !== "phone detour");
          return { text:JSON.stringify([{ type:"entity", description:"Provide the chosen meeting place", priority:"high", rationale:"An owned goal needs a reachable place",
            evidence:[demand.ref], expectedChange:"A reachable room exists, not a completed social encounter",
            supportRequirements:[{id:"space",kind:"space",description:"A provisional meeting space"}] }]) };
        }
        if (boundary === "different destination") revise("refine", "Meet Lin at Riverside instead");
        if (boundary === "released") revise("release");
        if (boundary === "paused") Goal.status[goal] = "paused";
        if (boundary === "source restart") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
        if (boundary === "replaced route") WorkingMemoryIdentity.id[street] = "replacement-room";
        return { text:JSON.stringify({ name:"Orchard", description:"A meeting room", type:"room", components:[], contents:[], connectToRoomEids:[street] }) };
      });
      const proposals = await runArchitectCognition(f.world, f.registry, f.spirits, f.architect);
      const valid = ["phone detour", "travel rewording"].includes(boundary);
      expect(proposals).toHaveLength(valid ? 1 : 0);
      const destination = query(f.world,[Room,Name]).find(id => Name.value[id] === "Orchard");
      expect(destination !== undefined).toBe(valid);
      if (valid) {
        expect(proposals[0].status).toBe("executed"); expect(getRoomRouteTargets(f.world,actor)).toEqual([destination]);
        // Authoring gives a choice; it doesn't move the actor or finish dinner.
        expect(getRoomForEntity(f.world,actor)).toBe(street); expect(Goal.status[goal]).toBe("active");
      }
      expect(Goal.progress[goal]).toBe(0);
    } finally {
      disable(); if (oldKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY; else process.env.GOOGLE_GENERATIVE_AI_API_KEY = oldKey;
    }
  });

test("observed intentions can build a reachable destination, then an autonomous inhabitant through normal authoring", async () => {
  const f = spirit(); initializePrefabs(f.world);
  const street = createRoomEntity(f.world, { name: "Street" });
  const actor = createAgentEntity(f.world, { name: "Ada", roomId: street, role: "resident", systemPrompt: "Choose freely" });
  const goal = createIntentGoal(f.world, actor, "Meet a friend for dinner", 7);
  const disable = enableRoomRouteTopology(f.world), daemons = createDaemonRegistry();
  createDaemonsForAllAgents(daemons, f.world);
  let destination: number | undefined;
  generate.mockImplementation(async input => {
    if (input.prompt.includes("identify 0-3")) {
      const records = JSON.parse(input.prompt.split("- Actor intentions (author-only evidence, not other NPCs' knowledge): ")[1].split("\n")[0]);
      return { text: JSON.stringify([{ type: "entity", description: destination === undefined ? "Provide a dining place" : "Inhabit the dining place",
        priority: "high", rationale: "Support an actual chosen purpose", evidence: [records.find((r: any) => r.kind === "goal" && r.actor === "Ada").ref],
        expectedChange: destination === undefined ? "A connected destination exists" : "An autonomous host inhabits the destination",
        ...(destination===undefined ? {supportRequirements:[{id:"entry",kind:"connection",roomEid:street,description:"An initial route to the space"}]} : {}) }]) };
    }
    expect(input.prompt).toContain("connectToRoomEids");
    return { text: JSON.stringify(destination === undefined
      ? { name: "Dining Room", description: "A modest dining place", type: "room", components: [], contents: [], connectToRoomEids: [street] }
      : { name: "Nora", description: "The host of the dining room", type: "agent", roomEid: destination,
        components: [{ name: "Agent", values: { role: "host", systemPrompt: "You are Nora, an independent host tending your dining room." } }] }) };
  });
  try {
    const [place] = await runArchitectCognition(f.world, f.registry, f.spirits, f.architect);
    expect(place.status).toBe("executed");
    destination = query(f.world, [Room, Name]).find(eid => Name.value[eid] === "Dining Room")!;
    expect(getRoomRouteTargets(f.world, actor)).toEqual([destination]);
    expect(getRoomForEntity(f.world, actor)).toBe(street);
    const [inhabitant] = await runArchitectCognition(f.world, f.registry, f.spirits, f.architect);
    expect(inhabitant.status).toBe("executed");
    const host = query(f.world, [Name]).find(eid => Name.value[eid] === "Nora")!;
    expect(getRoomForEntity(f.world, host)).toBe(destination);
    expect(createDaemonsForAllAgents(daemons, f.world)).toBe(1);
    expect(daemons.daemons.get(host)?.agentName).toBe("Nora");
    expect(JSON.stringify(captureCognitiveLocalView(f.world, host))).not.toContain("Meet a friend for dinner");
    executeActions(f.world, [{ eid: actor, action: { type: "move", target: "Dining Room" } }], f.registry);
    advanceSimulationTimeline(f.world, 3000, { integrate: () => {} });
    expect(getRoomForEntity(f.world, actor)).toBe(destination);
    expect(Goal.progress[goal]).toBe(0);
  } finally { disable(); stopCommittedEvents(f.world); }
});

test("native evolution leaves empty transit spaces available while an observed purpose builds a destination and inhabitant", async () => {
  const f = spirit(); initializePrefabs(f.world); resetStewardState();
  const street = createRoomEntity(f.world, { name: "Street" });
  createRoomEntity(f.world, { name: "Hallway" });
  const actor = createAgentEntity(f.world, { name: "Ada", role: "resident", systemPrompt: "Choose freely.", roomId: street });
  const goal = createIntentGoal(f.world, actor, "Meet a friend for dinner", 7);
  configureWorldConstructionBudget(f.world, 5);
  const disable = enableRoomRouteTopology(f.world);
  let destination: number | undefined;
  generate.mockImplementation(async input => {
    if (input.prompt.includes("identify 0-3")) {
      const records = JSON.parse(input.prompt.split("- Actor intentions (author-only evidence, not other NPCs' knowledge): ")[1].split("\n")[0]);
      const record = records.find((r: any) => r.actor === "Ada" && r.kind === "goal");
      expect(input.prompt).toContain('"objectCount":0');
      return { text: JSON.stringify([{ type: "entity", description: destination ? "A dining host" : "A reachable dining room", priority: "high",
        rationale: "An observed purpose needs a usable destination", evidence: [record.ref], expectedChange: destination ? "An actual host occupies the dining room" : "A connected room exists",
        ...(destination===undefined ? {supportRequirements:[{id:"entry",kind:"connection",roomEid:street,description:"An initial route to the space"}]} : {}) }]) };
    }
    if (!input.prompt.includes("Design a")) throw new Error("Unexpected speculative furnishing inference");
    return { text: JSON.stringify(destination
      ? { name: "Nora", description: "An independent dining host.", type: "agent", roomEid: destination, components: [] }
      : { name: "Dining Room", description: "A modest dining room.", type: "room", components: [], contents: [], connectToRoomEids: [street] }) };
  });
  const coordinator = createEvolutionCoordinator({ crafterInterval: 10000, artificerInterval: 10000, lawgiverInterval: 10000, fileRepairInterval: 10000 },
    { getSpiritsByType: type => type === "architect" ? [f.architect] : [] });
  const ctx = { world: f.world, god: { eid: 0, systemRegistry: f.registry, fileSystems: [] } as any, spirits: f.spirits };
  try {
    await coordinator.run(5, ctx);
    expect(generate).not.toHaveBeenCalled(); expect(getPendingRoomRequests()).toEqual([]);
    expect(getWorldConstructionStatus(f.world).remaining).toBe(2);
    await coordinator.run(30, ctx);
    destination = query(f.world, [Room, Name]).find(id => Name.value[id] === "Dining Room");
    expect(destination).toBeDefined(); expect(getRoomRouteTargets(f.world, actor)).toEqual([destination]);
    await coordinator.run(60, ctx);
    const host = query(f.world, [Name]).find(id => Name.value[id] === "Nora")!;
    expect(getRoomForEntity(f.world, host)).toBe(destination);
    expect(getWorldConstructionStatus(f.world).remaining).toBe(0);
    executeActions(f.world, [{ eid: actor, action: { type: "move", target: "Dining Room" } }], f.registry);
    advanceSimulationTimeline(f.world, 3000, { integrate: () => {} });
    expect(getRoomForEntity(f.world, actor)).toBe(destination); expect(Goal.progress[goal]).toBe(0);
  } finally { disable(); stopCommittedEvents(f.world); resetStewardState(); }
});

test.each(["current", "abandoned", "replaced proposal", "route_before_build", "route_before_commit", "unrelated_route"])("God joins the actual intention-scoped architect build without creating another job (%s)", async boundary => {
  const f = spirit(); initializePrefabs(f.world);
  const god = createGodAgent(f.world, { name: "God", worldName: "Apartment", narrative: "" });
  const room = createRoomEntity(f.world, { name: "Street" });
  const routesExercised=boundary.includes("route");
  const square=routesExercised ? createRoomEntity(f.world,{name:"Square"}) : undefined;
  const yard=routesExercised ? createRoomEntity(f.world,{name:"Yard"}) : undefined;
  const disable=routesExercised ? enableRoomRouteTopology(f.world) : undefined;
  if(square!==undefined) connectRoomRoute(f.world,room,square);
  const actor = createAgentEntity(f.world, { name: "Ada", role: "resident", roomId: room, systemPrompt: "Choose freely" });
  const goal = createIntentGoal(f.world, actor, "Find a place to shelter", 7);
  const acceptance = [{ name: "elapsed public count", system: "WorldCounter", entities: [{ id: 1, components: { Name: { value: "fixture" }, BuildCounter: { value: 0 } } }],
    ticks: 2, deltaMs: 1000, expect: [{ entity: 1, component: "BuildCounter", field: "value", equals: 2 }] },
    { name: "unnamed entity excluded", system: "WorldCounter", entities: [{ id: 1, components: { BuildCounter: { value: 100 } } }],
      ticks: 1, deltaMs: 1000, expect: [{ entity: 1, component: "BuildCounter", field: "value", equals: 100 }] }];
  const spec = { name: "WorldCounter", description: "A public elapsed quantity", requiredCapabilities: ["read_scalar_components", "write_unprotected_scalars", "attach_dynamic_components"],
    writes: ["BuildCounter.value"], acceptance };
  let cause = "", builds = 0;
  const directory = await mkdtemp(path.join(os.tmpdir(), "argos-shared-supervisor-build-"));
  const daemon = new CodingDaemon(f.world, f.registry, { directory, maxTotalJobs: 1 }, async ({ directory: output }) => {
    builds++; await mkdir(path.join(output, "components"), { recursive: true }); await mkdir(path.join(output, "systems"), { recursive: true });
    await writeFile(path.join(output, "components/counter.json"), JSON.stringify({ name: "BuildCounter", description: "Public elapsed quantity", fields: { value: { type: "number", default: 0 } } }));
    await writeFile(path.join(output, "systems/counter.ts"), 'export function run(ctx:any){for(const id of ctx.query("Name")){ctx.attach(id,"BuildCounter");ctx.set(id,"BuildCounter","value",ctx.get(id,"BuildCounter","value")+ctx.deltaMs/1000);}}');
    await writeFile(path.join(output, "release.json"), JSON.stringify({ version: 1, components: ["components/counter.json"], systems: [{ name: "WorldCounter", description: spec.description,
      file: "systems/counter.ts", frequency: 1, reads: ["Name", "BuildCounter"], writes: spec.writes }], tests: acceptance }));
  });
  await daemon.initialize();
  generate.mockImplementation(async input => {
    if (input.prompt.includes("identify 0-3")) {
      const records = JSON.parse(input.prompt.split("- Actor intentions (author-only evidence, not other NPCs' knowledge): ")[1].split("\n")[0]);
      const record = records.find((r: any) => r.actor === "Ada" && r.kind === "goal"); cause = record.causalKey;
      return { text: JSON.stringify([{ type: "system", description: spec.description, rationale: "Test an intention-linked public mechanic",
        evidence: [record.ref,...(routesExercised ? [`entity:${room}`] : [])], expectedChange: "The public count advances with time" }]) };
    }
    return { text: JSON.stringify(spec) };
  });
  try {
    const [proposal] = await runArchitectCognition(f.world, f.registry, f.spirits, f.architect);
    expect(proposal.status).toBe("building");
    const first = daemon.getStatus().jobs[0];
    expect(first.work?.causalKeys).toEqual([cause]);
    expect(() => enqueueManagedSystemProposal(createArgosWorld("Foreign world"), proposal)).toThrow(/stale or unavailable/);
    expect(() => enqueueManagedSystemProposal(f.world, { ...proposal })).toThrow(/stale or unavailable/);
    expect(() => enqueueManagedSystemProposal(f.world, { ...proposal, status: "pending" })).toThrow(/approved system/);
    expect((await gatherArchitectContext(f.world, f.registry)).engineeringJobs[0].work?.key).toBe(first.work?.key);
    let joined: any;
    generate.mockImplementation(async input => {
      const tool = input.tools.requestSystemBuild;
      expect(tool.inputSchema.safeParse({ proposalId: proposal.id, instruction: "Different work" }).success).toBe(false);
      expect(await tool.execute({ proposalId: proposal.id, instruction: "Different work" }, {})).toMatchObject({ success: false });
      joined = await tool.execute({ proposalId: proposal.id }, {});
      return { text: "Observing the existing approved job.", steps: [{ toolCalls: [{ toolCallId: "join", toolName: "requestSystemBuild", input: { proposalId: proposal.id } }],
        toolResults: [{ toolCallId: "join", output: joined }] }] };
    });
    await godThink(god, "Follow the approved architect work.");
    expect(joined).toMatchObject({ success: true, result: { id: first.id } });
    expect(daemon.getStatus().jobs).toHaveLength(1);
    if (boundary === "abandoned") Goal.status[goal] = "paused";
    if (boundary === "route_before_build") disconnectRoomRoute(f.world,room,square!);
    if (boundary === "unrelated_route") connectRoomRoute(f.world,square!,yard!);
    const replacement = { ...proposal };
    if (boundary === "replaced proposal") {
      const rows = getFactoryState().pendingProposals; rows[rows.indexOf(proposal)] = replacement;
    }
    await daemon.pump();
    if (boundary === "current" || boundary === "unrelated_route") {
      expect(proposal.status).toBe("building"); expect(f.registry.systems.has("WorldCounter")).toBe(false);
      daemon.commitReady(1); expect(proposal.status).toBe("executed");
      runSystems(f.world, f.registry, 2, 1000); await daemon.settle(); daemon.commitReady(2);
      expect(getComponent("BuildCounter").value[actor]).toBe(1); expect(builds).toBe(1);
    } else if(boundary === "route_before_commit") {
      expect(builds).toBe(1); expect(proposal.status).toBe("building");
      disconnectRoomRoute(f.world,room,square!); daemon.commitReady(1);
      expect(proposal.status).toBe("failed"); expect(f.registry.systems.has("WorldCounter")).toBe(false);
    } else {
      expect(proposal.status).toBe("failed"); expect(builds).toBe(0);
      expect(f.registry.systems.has("WorldCounter")).toBe(false);
      if (boundary === "replaced proposal") expect(replacement.status).toBe("building");
    }
    expect(Goal.progress[goal]).toBe(0);
  } finally { daemon.stop(); await daemon.flush(); disable?.(); stopCommittedEvents(f.world); }
});

test.each(["design", "approval"])("route endpoint replacement during %s cannot retarget an architect proposal", async boundary => {
  const f = spirit(); initializePrefabs(f.world);
  f.architect.architectConfig!.canExecuteDirectly = false;
  f.architect.architectConfig!.proposalApproval = "superior";
  const street = createRoomEntity(f.world, { name: "Street" }), square = createRoomEntity(f.world, { name: "Square" });
  const actor = createAgentEntity(f.world, { name: "Ada", role: "resident", systemPrompt: "Choose freely", roomId: street });
  createIntentGoal(f.world, actor, "Find somewhere to eat", 7);
  const disable = enableRoomRouteTopology(f.world);
  generate.mockImplementation(async input => {
    if (input.prompt.includes("identify 0-3")) {
      const records = JSON.parse(input.prompt.split("- Actor intentions (author-only evidence, not other NPCs' knowledge): ")[1].split("\n")[0]);
      return { text: JSON.stringify([{ type: "entity", description: "Provide a dining place", priority: "high", rationale: "An active intention needs a destination",
        evidence: [records.find((r: any) => r.kind === "goal" && r.actor === "Ada").ref], expectedChange: "A connected dining place exists",
        supportRequirements:[{id:"entry",kind:"connection",roomEid:square,description:"An initial connection to the space"}] }]) };
    }
    if (boundary === "design") Name.value[square] = "A different place";
    return { text: JSON.stringify({ name: "Dining Room", description: "A modest dining place", type: "room", components: [], contents: [], connectToRoomEids: [square] }) };
  });
  try {
    const proposals = await runArchitectCognition(f.world, f.registry, f.spirits, f.architect);
    if (boundary === "design") expect(proposals).toEqual([]);
    else {
      expect(proposals).toHaveLength(1);
      Name.value[square] = "A different place";
      approveProposal(proposals[0].id);
      expect((await executeAllApprovedProposals(f.world, f.registry)).failed).toEqual(["Dining Room"]);
    }
    expect(query(f.world, [Room, Name]).filter(eid => Name.value[eid] === "Dining Room")).toEqual([]);
    expect(getRoomForEntity(f.world, actor)).toBe(street);
  } finally { disable(); stopCommittedEvents(f.world); }
});

test("healthy [] and provider failure both abstain instead of inventing fallback growth", async () => {
  const f = spirit(), c = context(); generate.mockResolvedValueOnce({ text: "[]" }).mockRejectedValueOnce(new Error("provider unavailable"));
  expect(await identifyNeeds(f.architect, c)).toEqual([]); expect(await identifyNeeds(f.architect, c)).toEqual([]);
  const prompt = generate.mock.calls[0][0].prompt;
  expect(prompt).toContain("identify 0-3"); expect(prompt).toContain("Apartment"); expect(prompt).toContain("Valve does not stop flow");
  // Generative framing: returning nothing is no longer described as success.
  expect(prompt).not.toContain("No change is a successful observation"); expect(prompt).not.toContain("Do not manufacture novelty");
  expect(prompt).toContain("give these residents more to do, want and discover"); expect(prompt).toContain("No event emission, relation queries");
});

test("operator diagnostics distinguish model abstention from rejected contract without entering future context", async () => {
  const f = spirit(), room = addEntity(f.world); addComponent(f.world, room, Room); addComponent(f.world, room, Name); Name.value[room] = "Kitchen";
  generate.mockResolvedValueOnce({ text: "[]" });
  await runArchitectCognition(f.world, f.registry, f.spirits, f.architect);
  const first = getArchitectDiagnostics(f.world).entries;
  expect(first.find(e => e.stage === "needs" && e.outcome === "completed")).toMatchObject({ candidates: 0, admitted: 0 });
  expect(first.filter(e => e.stage === "design")).toEqual([]);
  const need = { type: "system", description: "Track flow", evidence: [`entity:${room}`], expectedChange: "Physical flow stops" };
  generate.mockResolvedValueOnce({ text: JSON.stringify([need]) }).mockResolvedValueOnce({ text: JSON.stringify({ name: "Flow", requiredCapabilities: ["UNSUPPORTED_CAPABILITY"] }) });
  await runArchitectCognition(f.world, f.registry, f.spirits, f.architect);
  const diagnostic = getArchitectDiagnostics(f.world);
  expect(diagnostic.entries.find(e => e.stage === "needs" && e.cycleId === 2 && e.outcome === "completed")).toMatchObject({ candidates: 1, admitted: 1 });
  expect(diagnostic.entries.find(e => e.stage === "design" && e.outcome === "rejected")).toMatchObject({ reason: "contract", detail: expect.stringContaining("UNSUPPORTED_CAPABILITY") });
  diagnostic.entries[0].outcome = "failed";
  expect(getArchitectDiagnostics(f.world).entries[0].outcome).toBe("started");
  const other = createArgosWorld("Other"); expect(getArchitectDiagnostics(other).entries).toEqual([]);
  const report = beginArchitectDiagnostics(other, 1);
  for (let i = 0; i < 510; i++) report({ stage: "cycle", outcome: "started", detail: "x".repeat(800) });
  const bounded = getArchitectDiagnostics(other);
  expect(bounded.truncated).toBe(true); expect(bounded.entries).toHaveLength(500); expect(bounded.entries[0].detail).toHaveLength(600);
  expect((await gatherArchitectContext(f.world, f.registry)) as any).not.toHaveProperty("architectDiagnostics");
});
test("needs require real evidence references, observable change, and no duplicate pending work", () => {
  const c = context(); const valid = { type: "system", description: "Stop flow at closed valves", priority: "high", rationale: "A witnessed failure", evidence: ["event:0"], expectedChange: "Closed valve does not add water" };
  expect(validateObservedNeeds([valid, valid], c)).toHaveLength(1);
  expect(validateObservedNeeds([{ ...valid, evidence: ["event:999"] }, { ...valid, expectedChange: "" }, { ...valid, type: "rule" }], c)).toEqual([]);
  c.proposalHistory.push({ name: "ValveFlow", type: "system", description: valid.description, status: "building" });
  expect(validateObservedNeeds([valid], c)).toEqual([]);
});
test("a failed proposal can be explicitly reconsidered once its failure is cited, but not implicitly repeated", () => {
  const c = context();
  const failed = { id: "proposal_1", name: "ValveFlow", type: "system", description: "Stop flow at closed valves", status: "failed", rejectionReason: "Independent acceptance failed" };
  c.proposalHistory.push(failed);
  const need = { type: "system", description: failed.description, priority: "high", rationale: "Correct the rejected implementation", evidence: ["proposal:proposal_1"], expectedChange: "Closed valve adds no water", revisionOf: "proposal_1" };
  expect(validateObservedNeeds([need], c)).toHaveLength(1);
  expect(validateObservedNeeds([{ ...need, revisionOf: undefined }], c)).toEqual([]);
  expect(validateObservedNeeds([{ ...need, evidence: ["event:0"] }], c)).toEqual([]);
  failed.status = "building";
  expect(validateObservedNeeds([need], c)).toEqual([]);
});
test("revision chains reject branches, unavailable history, and more than two corrections", () => {
  const c = context();
  const root = { id: "proposal_1", name: "ValveFlow", type: "system", description: "Stop flow", status: "failed", rejectionReason: "Acceptance failed" };
  const second = { ...root, id: "proposal_2", revisionOf: root.id };
  const third = { ...root, id: "proposal_3", revisionOf: second.id };
  const need = (id: string) => ({ type: "system", description: root.description, evidence: [`proposal:${id}`], expectedChange: "Flow stops", revisionOf: id });
  c.proposalHistory.push(root, second);
  expect(validateObservedNeeds([need(root.id)], c)).toEqual([]);
  expect(validateObservedNeeds([need(second.id)], c)).toHaveLength(1);
  c.proposalHistory.push(third);
  expect(validateObservedNeeds([need(third.id)], c)).toEqual([]);
  c.proposalHistory = [second];
  expect(validateObservedNeeds([need(second.id)], c)).toEqual([]);
  c.proposalHistory = [root, { ...root, id: "other", status: "building" }];
  expect(validateObservedNeeds([need(root.id)], c)).toEqual([]);
});

test("architect redesigns a rejected mechanic while ticks continue; accepted work responds to native actions", async () => {
  const f = spirit(), room = addEntity(f.world); addComponent(f.world, room, Room); addComponent(f.world, room, Name); Name.value[room] = "Kitchen";
  // Native construction and native affordance execution share the registered type authority.
  const schema = worldSchema;
  schema.defineObjectType({ name: "review_valve", description: "Valve", traits: ["openable"], defaultState: "open",
    states: { open: { description: "Water runs.", stimuli: [{ type: "sound", template: "Water splashes.", intensity: 0.5, radius: 10 }] }, closed: { description: "Water has stopped." } } });
  const actor = executeEntityProposal(f.world, { name: "Keeper", description: "An inhabitant", type: "agent", roomEid: room, components: [] });
  const valve = executeEntityProposal(f.world, { name: "Valve", description: "Running valve", type: "object", roomEid: room,
    components: [{ name: "ObjectType", values: { typeId: "review_valve", instanceName: "Valve" } }, { name: "ObjectState", values: { current: "open" } }, { name: "Traits", values: { active: '["openable"]' } }] });
  const entityRegistry = { byName: new Map([["Keeper", actor], ["Valve", valve]]), byId: new Map([[actor, "Keeper"], [valve, "Valve"]]) };
  const acceptance = (rate: number) => [{ name: "open flow", system: "ReviewedFlow", entities: [{ id: 1, components: { ObjectType: { typeId: "review_valve" }, ObjectState: { current: "open" }, ReviewWater: { amount: 0 } } }], ticks: 1, deltaMs: 1000, expect: [{ entity: 1, component: "ReviewWater", field: "amount", equals: rate }] },
    { name: "closed flow", system: "ReviewedFlow", entities: [{ id: 1, components: { ObjectType: { typeId: "review_valve" }, ObjectState: { current: "closed" }, ReviewWater: { amount: 0 } } }], ticks: 1, deltaMs: 1000, expect: [{ entity: 1, component: "ReviewWater", field: "amount", equals: 0 }] }];
  const spec = { name: "ReviewedFlow", description: "Track actual valve flow", requiredCapabilities: ["read_scalar_components", "write_unprotected_scalars", "attach_dynamic_components"], writes: ["ReviewWater.amount"], acceptance: acceptance(2) };
  const need = { type: "system", description: spec.description, priority: "high", rationale: "The existing valve has no water quantity mechanic", evidence: [`entity:${valve}`], expectedChange: "Only an open valve adds two units per second" };
  let rate = 3, ticks = 0, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const directory = await mkdtemp(path.join(os.tmpdir(), "argos-architect-recovery-"));
  const daemon = new CodingDaemon(f.world, f.registry, { directory }, async ({ directory: output }) => {
    await gate; await mkdir(path.join(output, "components"), { recursive: true }); await mkdir(path.join(output, "systems"), { recursive: true });
    await writeFile(path.join(output, "components/water.json"), JSON.stringify({ name: "ReviewWater", description: "Actual collected water", fields: { amount: { type: "number", default: 0 } } }));
    await writeFile(path.join(output, "systems/flow.ts"), `export function run(ctx:any){for(const id of ctx.query("ObjectType","ObjectState")){if(ctx.get(id,"ObjectType","typeId")!=="review_valve")continue;ctx.attach(id,"ReviewWater");if(ctx.get(id,"ObjectState","current")==="open")ctx.set(id,"ReviewWater","amount",ctx.get(id,"ReviewWater","amount")+${rate}*ctx.deltaMs/1000);}}`);
    await writeFile(path.join(output, "release.json"), JSON.stringify({ version: 1, components: ["components/water.json"], systems: [{ name: "ReviewedFlow", description: spec.description, file: "systems/flow.ts", frequency: 1, reads: ["ObjectType", "ObjectState", "ReviewWater"], writes: ["ReviewWater.amount"] }], tests: acceptance(rate) }));
  });
  await daemon.initialize();
  registerSystem(f.registry, { name: "ExistingHeartbeat", description: "Existing work", pseudocode: "", active: true, lastRun: 0, frequency: 0, compiledFn: () => { ticks++; } });
  const step = async (tick: number) => { runSystems(f.world, f.registry, tick, 1000); await daemon.settle(); daemon.commitReady(tick); };
  try {
    generate.mockResolvedValueOnce({ text: JSON.stringify([need]) }).mockResolvedValueOnce({ text: JSON.stringify(spec) });
    const [first] = await runArchitectCognition(f.world, f.registry, f.spirits, f.architect);
    expect(first.status).toBe("building");
    const building = daemon.pump();
    await step(1); await step(2); expect(ticks).toBe(2); expect(getComponent("ReviewWater")).toBeUndefined();
    release(); await building;
    expect(first.status).toBe("failed"); expect(first.rejectionReason).toContain("expected 2");
    const failureContext = await gatherArchitectContext(f.world, f.registry);
    expect(failureContext.proposalHistory).toContainEqual(expect.objectContaining({ id: first.id, status: "failed", rejectionReason: first.rejectionReason }));
    rate = 2;
    generate.mockResolvedValueOnce({ text: JSON.stringify([{ ...need, revisionOf: first.id, evidence: [`proposal:${first.id}`] }]) }).mockResolvedValueOnce({ text: JSON.stringify(spec) });
    const [revision] = await runArchitectCognition(f.world, f.registry, f.spirits, f.architect);
    expect(generate.mock.calls[2][0].prompt).toContain(first.rejectionReason);
    expect(generate.mock.calls[3][0].prompt).toContain(first.rejectionReason);
    expect(revision.revisionOf).toBe(first.id); expect(revision.status).toBe("building");
    expect((await executeAllApprovedProposals(f.world, f.registry)).queued).toEqual([]);
    await daemon.pump(); expect(revision.status).toBe("building"); daemon.commitReady(3);
    expect(revision.status).toBe("executed"); await step(3); expect(getComponent("ReviewWater").amount[valve]).toBe(2);
    expect(executeAffordance("close", { world: f.world, worldSchema: schema, registry: entityRegistry, actorEid: actor, targetEid: valve }).success).toBe(true);
    await step(4); expect(getComponent("ReviewWater").amount[valve]).toBe(2);
    expect(getComponent("Description").value[valve]).toContain("stopped");
    expect(executeAffordance("open", { world: f.world, worldSchema: schema, registry: entityRegistry, actorEid: actor, targetEid: valve }).success).toBe(true);
    await step(5); expect(getComponent("ReviewWater").amount[valve]).toBe(4); expect(ticks).toBe(5);
    expect(daemon.getStatus().jobs).toHaveLength(2);
    expect((await gatherArchitectContext(f.world, f.registry)).proposalHistory).toContainEqual(expect.objectContaining({ id: revision.id, status: "executed" }));
  } finally { release(); daemon.stop(); await daemon.flush(); }
});
test("unimplemented rules fail without an executed receipt", async () => {
  const f = spirit(); const proposal = submitProposal(f.architect.eid, "rule", "TensionRule", "Change feelings", {}, "Unimplemented rule")!;
  const result = await executeAllApprovedProposals(f.world, f.registry);
  expect(result.executed).toEqual([]); expect(result.failed).toEqual(["TensionRule"]); expect(proposal.status).toBe("failed");
});
test.each([
  { allowedTypes: [] },
  { requireObserved: true },
  { requireObserved: true, allowedTypes: ["entity"] },
])("native approved executor honors explicit grants without consuming legacy approvals: %j", async options => {
  const f = spirit();
  const proposals = (["entity", "system", "component", "rule"] as const).map(type => submitProposal(f.architect.eid,
    type, `Legacy ${type}`, "Legacy approved work without an observed admission",
    type === "entity" ? { name: "Unexpected room", description: "Must not be constructed", type: "room", components: [] } : {},
    "Not an observed, current world need")!);
  const before = [...query(f.world, [Name])];
  expect(proposals.every(proposal => proposal.status === "approved" && !proposal.observationScopeId)).toBe(true);
  const result = await executeAllApprovedProposals(f.world, f.registry, options as any);
  expect(result).toEqual({ executed: [], failed: [], queued: [] });
  expect(proposals.map(proposal => proposal.status)).toEqual(["approved", "approved", "approved", "approved"]);
  expect([...query(f.world, [Name])]).toEqual(before);
  expect(generate).not.toHaveBeenCalled(); stopCommittedEvents(f.world);
});
test("proposal admission rejects capabilities and cognition writes outside the managed API", () => {
  expect(() => validateManagedProposal({ name: "FakeDialogue", requiredCapabilities: ["emit_dialogue"] } as any)).toThrow(/Unsupported managed capability/);
  expect(() => validateManagedProposal({ name: "FakeEmotion", writes: ["Mind.arousal"] } as any)).toThrow(/Protected component/);
  expect(() => validateManagedProposal({ name: "Unproven" } as any, true)).toThrow(/acceptance/);
});

test("designer admission rejects invented built-in coordinates and impossible built-in fixtures", () => {
  spirit();
  expect(() => validateManagedProposal({ name: "InventedContainer", writes: ["Container.fluidDepth"] } as any)).toThrow(/Unknown built-in field Container.fluidDepth/);
  const fixture = { name: "truthful valve", system: "Flow", entities: [{ id: 1, components: { ObjectState: { isOpen: true } } }], ticks: 1, deltaMs: 1000,
    expect: [{ entity: 1, component: "ObjectState", field: "isOpen", equals: true }] };
  expect(() => validateManagedProposal({ name: "Flow", acceptance: [fixture] } as any)).toThrow(/Unknown built-in field ObjectState.isOpen/);
  fixture.entities[0].components = { ObjectState: { current: 1 } } as any;
  expect(() => validateManagedProposal({ name: "Flow", acceptance: [fixture] } as any)).toThrow(/Invalid built-in field type ObjectState.current/);
  expect(() => validateManagedProposal({ name: "NewQuantity", writes: ["NewWater.depth"] } as any)).not.toThrow();
});

test("managed design prompt uses a valid complete example and real public schemas", async () => {
  const f = spirit(), room = addEntity(f.world); addComponent(f.world, room, Room); addComponent(f.world, room, Name); Name.value[room] = "Kitchen";
  generate.mockResolvedValueOnce({ text: JSON.stringify([{ type: "system", description: "Track physical state", evidence: [`entity:${room}`], expectedChange: "A quantity advances" }]) })
    .mockResolvedValueOnce({ text: "null" });
  await runArchitectCognition(f.world, f.registry, f.spirits, f.architect);
  const prompt = generate.mock.calls[1][0].prompt;
  const example = JSON.parse(prompt.split("<managed-design-example>\n")[1].split("\n</managed-design-example>")[0]);
  expect(() => validateManagedProposal(example, true)).not.toThrow();
  expect(prompt).toContain("frequency is a count of ECS ticks");
  expect(prompt).not.toContain("ms between executions");
  const schemas = (await gatherArchitectContext(f.world, f.registry)).managedComponents!;
  expect(schemas.find(s => s.name === "ObjectState")?.fields).toHaveProperty("current", "string");
  expect(schemas.find(s => s.name === "Container")?.fields).not.toHaveProperty("fluidDepth");
  expect(schemas.some(s => s.name === "Mind")).toBe(false);
  for (const component of ["CommunicationMemory", "CoordinationReviewState", "OngoingActivity", "GoalAttempt", "GoalWorkProgress", "WorkingMemoryIdentity"]) {
    expect(schemas.some(s => s.name === component)).toBe(false);
    expect(() => validateManagedProposal({ name: "PrivateRead", targetComponents: [component] } as any)).toThrow(/Private component read denied/);
  }
  expect(prompt).toContain(JSON.stringify(schemas));
});
test("architect recent-event window uses thirty simulation seconds, not fifty milliseconds or unscoped diagnostics", async () => {
  const f = spirit(); initializePrefabs(f.world);
  const room = createRoomEntity(f.world, { name: "Workshop" });
  const actor = createAgentEntity(f.world, { name: "Ada", role: "maker", systemPrompt: "Choose", roomId: room });
  const event = publishCommittedEvent(f.world, { actorId: actor, roomId: room, executionId: "observed", kind: "action", action: "examine", status: "failed" })!;
  recordEvent("unscoped_observation", { mechanic: "valve" }, "test");
  advanceSimulationTimeline(f.world, 500, { integrate() {} });
  const gathered = await gatherArchitectContext(f.world, f.registry);
  expect(gathered.recentEvents.some(row => row.id === event.id)).toBe(true);
  expect(JSON.stringify(gathered.recentEvents)).not.toContain("unscoped_observation");
  advanceSimulationTimeline(f.world, 30001, { integrate() {} });
  expect((await gatherArchitectContext(f.world, f.registry)).recentEvents).toEqual([]);
});
test("architect context includes actual props, not only characters and rooms", async () => {
  const f = spirit(), room = addEntity(f.world); addComponent(f.world, room, Room); addComponent(f.world, room, Name); Name.value[room] = "Kitchen";
  const valve = executeEntityProposal(f.world, { name: "Existing valve", description: "Already in the kitchen", type: "object", roomEid: room, components: [] });
  const gathered = await gatherArchitectContext(f.world, f.registry);
  expect(gathered.setting.entities).toContainEqual(expect.objectContaining({ eid: valve, name: "Existing valve", room: "Kitchen" }));
});

test("architect observes native environmental outcomes without turning historical receipts into build authority", async () => {
  const f = spirit(); initializePrefabs(f.world);
  const room = createRoomEntity(f.world, { name: "Garden" });
  recordSpiritPublicEnvironmentReceipt(f.world, { id: "wet-seat", atSimMs: f.world.time.elapsed,
    roomId: room, detail: "The garden seat became wet in the rain." });
  const context = await gatherArchitectContext(f.world, f.registry);
  expect(context.environmentalOutcomes?.receipts).toContainEqual(expect.objectContaining({ id: "wet-seat" }));
  expect(validateObservedNeeds([{ type: "system", description: "Dry furniture", priority: "low", rationale: "rain",
    evidence: ["wet-seat"], expectedChange: "Wetness declines indoors" }], context)).toEqual([]);
  generate.mockResolvedValueOnce({ text: "[]" }); await identifyNeeds(f.architect, context);
  expect(generate.mock.calls.at(-1)![0].prompt).toContain("The garden seat became wet in the rain.");
  stopCommittedEvents(f.world); expect((await gatherArchitectContext(f.world, f.registry)).environmentalOutcomes?.receipts).toEqual([]);
});
