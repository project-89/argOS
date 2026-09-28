import { jest } from "@jest/globals";
const ai=await import("ai");
const generate=jest.fn<(...args:any[])=>Promise<{text:string}>>();
jest.unstable_mockModule("ai",()=>({...ai,generateText:generate}));
const { query,removeEntity }=await import("bitecs");
const { createArgosWorld }=await import("../../ecs/world");
const { initializeRegistry }=await import("../../ecs/component-registry");
const { initializePrefabs,createRoomEntity,createAgentEntity,createObjectEntity }=await import("../../ecs/prefabs");
const { Name,Goal }=await import("../../ecs/components");
const { createGodAgent,godThink }=await import("../../god/god-agent");
const { createSpiritRegistry }=await import("../spirit-registry");
const { resetFactoryState,createDynamicSpirit,approveProposal }=await import("../spirit-factory");
const { createWorldCrafterSpirit,runWorldCrafterCycle,resetWorldCrafterState,setSimulationContext,recordFailedInteraction }=await import("../world-crafter-spirit");
const { gatherArchitectContext,runArchitectCognition,executeAllApprovedProposals,queueAllApprovedProposals }=await import("../architect-spirit");
const { executeActions }=await import("../../cognition/cognition-system");
const { startCommittedEvents,getCommittedEvents }=await import("../../runtime/committed-events");
const { getWorldConstructionStatus }=await import("../../runtime/world-construction-budget");
const { createPersonalIntention }=await import("../../cognition/goal-lifecycle");
const { workingMemoryEntityRef }=await import("../../cognition/working-memory");
const { setLocatedIn,getRoomForEntity }=await import("../../ecs/location");
const { stopCommittedEvents }=await import("../../runtime/committed-events");
const { getPlaceBuildStatus }=await import("../../engineering/place-materialization");
const { registerExternalParticipant }=await import("../../runtime/participant-identities");

function setup() {
  const world=createArgosWorld("Persistence is gameplay"); initializeRegistry(world);initializePrefabs(world);startCommittedEvents(world);
  const god=createGodAgent(world,{name:"God",worldName:"House",narrative:""}), spirits=createSpiritRegistry(world);
  createWorldCrafterSpirit(spirits);
  const room=createRoomEntity(world,{name:"Kitchen"});
  const actor=createAgentEntity(world,{name:"Mara",role:"keeper",roomId:room,systemPrompt:"Choose freely."});
  return {world,god,spirits,room,actor};
}
beforeEach(()=>{resetFactoryState();resetWorldCrafterState();generate.mockReset();generate.mockRejectedValue(new Error("Provider unavailable"));
  jest.spyOn(globalThis,"fetch").mockRejectedValue(new Error("No live inference"));});
afterEach(()=>{expect(globalThis.fetch).not.toHaveBeenCalled();jest.restoreAllMocks();resetFactoryState();resetWorldCrafterState();});

test.each(["balanced","abundance","scarcity"] as const)("native failed pickup in %s mode does not undo deliberate removal",async mode=>{
  const f=setup();setSimulationContext({resourceMode:mode});
  const can=createObjectEntity(f.world,{name:"Oil can",roomId:f.room});removeEntity(f.world,can);
  executeActions(f.world,[{eid:f.actor,action:{type:"pickup",target:"Oil can"}}],f.god.systemRegistry);
  const before=getWorldConstructionStatus(f.world).admitted;
  const result=await runWorldCrafterCycle(f.world,f.spirits,f.god);
  expect(result.entitiesCreated).toBe(0);expect(getWorldConstructionStatus(f.world).admitted).toBe(before);
  expect(query(f.world,[Name]).filter(eid=>Name.value[eid]==="Oil can")).toHaveLength(0);
  expect(generate).not.toHaveBeenCalled();
  const context:any=await gatherArchitectContext(f.world,f.god.systemRegistry);
  expect(context.interactionFailures.records).toEqual([expect.objectContaining({actor:"Mara",action:"pickup",attemptedTarget:"Oil can"})]);
});

test("a failed interaction in one world cannot populate another world's identically named room",async()=>{
  const a=setup(),b=setup();
  recordFailedInteraction("Mara",a.actor,"Kitchen","use","Relay","PRIVATE-COMMAND-CONTENT",a.world);
  const before=getWorldConstructionStatus(b.world).admitted;
  await runWorldCrafterCycle(b.world,b.spirits,b.god);
  expect(getWorldConstructionStatus(b.world).admitted).toBe(before);expect(generate).not.toHaveBeenCalled();
  const context:any=await gatherArchitectContext(b.world,b.god.systemRegistry);
  expect(context.interactionFailures.records).toEqual([]);
  expect(JSON.stringify(getCommittedEvents(a.world))).not.toContain("PRIVATE-COMMAND-CONTENT");
});

test("God receives scoped failure observations without raw command content",async()=>{
  const f=setup();let saw=false;
  recordFailedInteraction("Mara",f.actor,"Kitchen","use","Relay","PRIVATE-COMMAND-CONTENT",f.world);
  generate.mockImplementation(async input=>{
    expect(input.system).toContain("Unresolved local interactions");expect(input.system).toContain('"attemptedTarget":"Relay"');
    expect(input.system).not.toContain("PRIVATE-COMMAND-CONTENT");saw=true;
    return {text:"Inspect the current world before deciding whether to build.",steps:[{toolCalls:[],toolResults:[]}]};
  });
  await godThink(f.god,"Review the latest failures.");expect(saw).toBe(true);
});

test("outside identities reach God and architect as author-only metadata without granting embodiment",async()=>{
  const f=setup();registerExternalParticipant(f.world,"remote:1","Morgan");
  const context=await gatherArchitectContext(f.world,f.god.systemRegistry);
  expect(context.externalParticipants).toEqual([{id:"remote:1",name:"Morgan",aliases:["Morgan"],presence:"outside_world",delegatedAvatars:[]}]);
  expect(context.setting.entities.some(e=>e.name==="Morgan")).toBe(false);
  let reached=false;
  generate.mockImplementation(async input=>{
    expect(input.system).toContain("Outside participants");expect(input.system).toContain('"presence":"outside_world"');
    expect(input.system).toContain('"name":"Morgan"');
    expect(Object.keys(input.tools??{})).not.toContain("authorizeParticipantEmbodiment");reached=true;
    return {text:"The participant is outside, not a missing NPC.",steps:[{toolCalls:[],toolResults:[]}]};
  });
  await godThink(f.god,"Review available identities.");expect(reached).toBe(true);
  expect([...query(f.world,[Name])].some(eid=>Name.value[eid]==="Morgan")).toBe(false);
});

test.each(["valid","approved_build","queued_build","delayed_appearance","moved","travel_with_goal","target_appeared","source","goal_paused","provider_failure","abstain","repeated_failure"])("fresh authoring after failure preserves useful growth and the %s boundary",async boundary=>{
  const f=setup();workingMemoryEntityRef(f.world,f.actor);
  const goal=createPersonalIntention(f.world,f.actor,"Visit a workshop to repair my equipment",7)!;
  const architect=createDynamicSpirit(f.spirits,{name:"The Weaver",type:"architect",rank:"archangel",domain:"ecology",
    architectConfig:{canProposeEntities:true,canProposeSystems:true,canExecuteDirectly:true,proposalApproval:"auto",maxProposalsPerCycle:1}})!;
  const manual=["approved_build","queued_build","delayed_appearance"].includes(boundary);
  if(manual) {architect.architectConfig!.canExecuteDirectly=false;architect.architectConfig!.proposalApproval="superior";}
  recordFailedInteraction("Mara",f.actor,"Kitchen","use","Workshop","PRIVATE-ARGUMENT",f.world);
  let sawFailure=false;
  generate.mockImplementation(async input=>{
    if(input.prompt.includes("identify 0-3")) {
      const line=input.prompt.split("\n").find((line:string)=>line.startsWith("- Unresolved local interactions"));
      const failures=JSON.parse(line.slice(line.indexOf(": ")+2));
      expect(failures.records[0]).toMatchObject({attemptedTarget:"Workshop",matches:[]});
      expect(input.prompt).not.toContain("PRIVATE-ARGUMENT");sawFailure=true;
      if(boundary==="provider_failure") throw new Error("Provider unavailable");
      if(boundary==="abstain") return {text:"[]"};
      const intentions=JSON.parse(input.prompt.split("- Actor intentions (author-only evidence, not other NPCs' knowledge): ")[1].split("\n")[0]);
      return {text:JSON.stringify([{type:"entity",description:"Provide a usable workshop",priority:"high",rationale:"The current intention needs a repair destination",
        evidence:[failures.records[0].ref,...(boundary==="moved"?[]:[intentions.find((r:any)=>r.actor==="Mara" && r.kind==="goal").ref])],expectedChange:"A native workshop and keeper exist, not a completed repair",
        supportRequirements:[{id:"keeper",kind:"entity",entityType:"agent",description:"A keeper in the new space"}]}])};
    }
    if(boundary==="moved" || boundary==="travel_with_goal") {
      setLocatedIn(f.world,f.actor,createRoomEntity(f.world,{name:"Street"}));
      // A normal observer may notice travel while the author is still thinking.
      await runWorldCrafterCycle(f.world,f.spirits,f.god);
    }
    if(boundary==="target_appeared") createObjectEntity(f.world,{name:"Workshop",roomId:f.room});
    if(boundary==="source") {stopCommittedEvents(f.world);startCommittedEvents(f.world);}
    if(boundary==="goal_paused") Goal.status[goal]="paused";
    if(boundary==="repeated_failure") recordFailedInteraction("Mara",f.actor,"Kitchen","use","Workshop",undefined,f.world);
    return {text:JSON.stringify({name:"Workshop",description:"A place for repair work.",type:"room",components:[],contents:[
      {id:"keeper",entity:{name:"Nora",description:"The workshop keeper.",type:"agent",components:[]}}]})};
  });
  const proposals=await runArchitectCognition(f.world,f.god.systemRegistry,f.spirits,architect);
  expect(sawFailure).toBe(true);
  const valid=["valid","repeated_failure","travel_with_goal","approved_build","queued_build"].includes(boundary);
  expect(proposals).toHaveLength(valid || manual?1:0);
  if(manual) {
    if(boundary==="delayed_appearance")createObjectEntity(f.world,{name:"Workshop",roomId:f.room});
    approveProposal(proposals[0].id);
    if(boundary==="queued_build")queueAllApprovedProposals(f.world,f.god.systemRegistry);
    else await executeAllApprovedProposals(f.world,f.god.systemRegistry);
    if(boundary==="delayed_appearance")expect(proposals[0].status).toBe("failed");
  }
  if(valid) {
    expect(proposals[0].status).toBe("executed");
    expect(getPlaceBuildStatus(f.world,f.god.systemRegistry)[0]).toMatchObject({phase:"constructed",readyNow:true});
    expect(getPlaceBuildStatus(f.world,f.god.systemRegistry)[0].members).toHaveLength(2);
    expect(Name.value[getRoomForEntity(f.world,f.actor)!]).toBe(boundary==="travel_with_goal"?"Street":"Kitchen");
  }
  expect(Goal.progress[goal]).toBe(0);
});
