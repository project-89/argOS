import { jest } from "@jest/globals";
const ai=await import("ai");
const generate=jest.fn<(...args:any[])=>Promise<any>>();
jest.unstable_mockModule("ai",()=>({...ai,generateText:generate}));
const {createArgosWorld}=await import("../../ecs/world");
const {initializePrefabs,createRoomEntity,createAgentEntity}=await import("../../ecs/prefabs");
const {startCommittedEvents,stopCommittedEvents}=await import("../../runtime/committed-events");
const {advanceSimulationTimeline}=await import("../../runtime/simulation-timeline");
const {createGodAgent,godThink}=await import("../god-agent");
const {createSpiritRegistry,setGodAgent,reportToSuperior,getMessagesForGodAI}=await import("../../spirits/spirit-registry");
const {createDynamicSpirit,resetFactoryState,getFactoryState}=await import("../../spirits/spirit-factory");
const {runArchitectCognition,executeAllApprovedProposals}=await import("../../spirits/architect-spirit");
const {initializeGodAutopilot,enqueueSpiritMessages,getAutopilotInbox,runGodAutopilotCycle}=await import("../god-autopilot");
const {buildSpiritGrowthTools}=await import("../spirit-authority");
const {createIntentGoal}=await import("../../cognition/cognition-system");
const {Goal,WorkingMemoryIdentity}=await import("../../ecs/components");
const {Removed}=await import("../../ecs/components");
const {addComponent,removeComponent,hasComponent}=await import("bitecs");
const {getPlaceBuildStatus}=await import("../../engineering/place-materialization");
const {getRoomForEntity}=await import("../../ecs/location");
const {enableRoomRouteTopology}=await import("../../runtime/room-routes");
const {getArchitectDiagnostics}=await import("../../spirits/architect-diagnostics");
const {bindSpiritMessageDelivery}=await import("../../spirits/spirit-message-delivery");

function fixture(){
  const world=createArgosWorld("Scoped growth");initializePrefabs(world);startCommittedEvents(world);enableRoomRouteTopology(world);
  const god=createGodAgent(world,{name:"God",worldName:"Scoped growth",narrative:""});
  const spirits=createSpiritRegistry(world);setGodAgent(spirits,god.eid);
  const weaver=createDynamicSpirit(spirits,{name:"Weaver",type:"architect",rank:"archangel",domain:"ecology",architectConfig:{
    canProposeEntities:true,canProposeSystems:false,canProposeRules:false,canProposeComponents:false,
    canExecuteDirectly:false,proposalApproval:"godai",maxProposalsPerCycle:1}})!;
  initializeGodAutopilot(god,{minRunIntervalMs:0,minPriority:"normal"});
  const send=()=>{reportToSuperior(spirits,weaver.eid,"Evidence","Grounded report","high",{nativeOutcome:"event-1"});return getMessagesForGodAI(spirits)[0];};
  return {world,god,spirits,weaver,send};
}
beforeEach(()=>{resetFactoryState();generate.mockReset();});

test("God's actual activity inspection distinguishes a completed purpose from the current actor's agenda", async () => {
  const f = fixture(), room = createRoomEntity(f.world, { name: "Diner" });
  const actor = createAgentEntity(f.world, { name: "Ada", role: "visitor", systemPrompt: "Choose", roomId: room });
  const goal = createIntentGoal(f.world, actor, "Eat lunch", 7);
  const { recordOngoingActivityChoice } = await import("../../cognition/ongoing-activity");
  recordOngoingActivityChoice(f.world, actor, { purpose: "Look for food", actionType: "think", goalId: goal });
  Goal.status[goal] = "completed";
  let inspected = false;
  generate.mockImplementation(async input => {
    const output = await input.tools.getComponentValues.execute({ entityName: "Ada", componentName: "OngoingActivity" }, {});
    expect(output).toMatchObject({ success: true, result: { currentGoal: false, goalStatus: "completed", entryChoicePurpose: "Look for food" } });
    expect(output.result).not.toHaveProperty("stateJson"); inspected = true;
    return { text: "The old activity is historical.", steps: [] };
  });
  await godThink(f.god, "Review current activity"); expect(inspected).toBe(true);
});

test.each(["removed","identity_deleted"])("even explicit legacy host reports cannot survive recipient %s",change=>{
  const f=fixture(),original=f.send(),hostReport={...original,id:"explicit-host-receipt"};
  enqueueSpiritMessages(f.god,[hostReport],()=>"Host fixture");expect(getAutopilotInbox(f.god)).toHaveLength(1);
  if(change==="removed")addComponent(f.world,f.god.eid,Removed);
  else removeComponent(f.world,f.god.eid,WorkingMemoryIdentity);
  expect(getAutopilotInbox(f.god)).toEqual([]);
  if(change==="identity_deleted")expect(hasComponent(f.world,f.god.eid,WorkingMemoryIdentity)).toBe(false);
});

test.each(["stop","restart","owner","retarget","cross_world","copy","age"])("God inbox retains %s admission beyond initial spirit delivery",change=>{
  const f=fixture(), message=f.send();
  if(change==="cross_world") {const other=fixture();enqueueSpiritMessages(other.god,[message],()=>"Weaver");expect(getAutopilotInbox(other.god)).toEqual([]);return;}
  if(change==="copy") {enqueueSpiritMessages(f.god,[{...message}],()=>"Weaver");expect(getAutopilotInbox(f.god)).toEqual([]);return;}
  enqueueSpiritMessages(f.god,[message],()=>"Weaver");expect(getAutopilotInbox(f.god)).toHaveLength(1);
  if(change==="stop")stopCommittedEvents(f.world);
  if(change==="restart"){stopCommittedEvents(f.world);startCommittedEvents(f.world);}
  if(change==="owner")WorkingMemoryIdentity.id[f.god.eid]="new owner";
  if(change==="retarget")message.to=f.weaver.eid;
  if(change==="age")advanceSimulationTimeline(f.world,120001,{integrate:()=>{}});
  expect(getAutopilotInbox(f.god)).toEqual([]);
});

test("historical data is captured, shown as evidence, and never replayed on duplicate receipt",async()=>{
  const f=fixture(), message=f.send();enqueueSpiritMessages(f.god,[message,message],()=>"Weaver");
  message.data!.nativeOutcome="mutated";
  expect(getAutopilotInbox(f.god)).toHaveLength(1);
  const seen:string[]=[];
  expect((await runGodAutopilotCycle(f.god,{executeCommand:async command=>{seen.push(command);}})).executed).toBe(true);
  expect(seen[0]).toContain('"nativeOutcome":"event-1"');expect(seen[0]).not.toContain("mutated");
  enqueueSpiritMessages(f.god,[message],()=>"Weaver");expect(getAutopilotInbox(f.god)).toEqual([]);
});

test("native Weaver feedback exposes its original observation deadline, not a renewed delivery lifetime", async () => {
  const f = fixture(), room = createRoomEntity(f.world, { name: "Courtyard" });
  const actor = createAgentEntity(f.world, { name: "Ada", role: "visitor", systemPrompt: "Choose", roomId: room });
  const { publishCommittedEvent } = await import("../../runtime/committed-events");
  const { captureGodMessageDelivery } = await import("../../spirits/spirit-message-delivery");
  advanceSimulationTimeline(f.world, 10000, { integrate: () => {} });
  publishCommittedEvent(f.world, { executionId: "observed-courtyard", kind: "action", actorId: actor,
    roomId: room, action: "observe", operation: "inspecting", status: "succeeded" });
  generate.mockImplementation(async () => {
    advanceSimulationTimeline(f.world, 7000, { integrate: () => {} });
    return { text: "[]" };
  });
  await runArchitectCognition(f.world, f.god.systemRegistry, f.spirits, f.weaver);
  const report = getMessagesForGodAI(f.spirits).find(message => message.subject === "World activity reviewed")!;
  expect(report).toBeDefined();
  const binding = captureGodMessageDelivery(f.world, f.god.eid, report)!;
  expect(binding.at).toBe(17000);
  expect(binding.expiresAtSimMs).toBe(40000); // observed at10s + unchanged30s, not delivered at17s +30s
  expect(binding.current()).toBe(true);
  advanceSimulationTimeline(f.world, 23001, { integrate: () => {} });
  expect(binding.current()).toBe(false);
});

test("a concurrent batch cannot consume twice; expiration during inference is a failed result",async()=>{
  const f=fixture();enqueueSpiritMessages(f.god,[f.send()],()=>"Weaver");
  let release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;});
  const first=runGodAutopilotCycle(f.god,{executeCommand:async()=>barrier});
  expect((await runGodAutopilotCycle(f.god)).reason).toBe("in_flight");
  stopCommittedEvents(f.world);release();
  expect(await first).toMatchObject({ran:true,executed:false});expect(getAutopilotInbox(f.god)).toEqual([]);
  expect(generate).not.toHaveBeenCalled();
});

async function pendingPlace(f:ReturnType<typeof fixture>){
  const street=createRoomEntity(f.world,{name:"Street"});
  const actor=createAgentEntity(f.world,{name:"Ada",role:"visitor",systemPrompt:"Choose freely",roomId:street});
  const goal=createIntentGoal(f.world,actor,"Visit a workshop to meet a clockmaker",7);
  generate.mockImplementation(async input=>{
    if(input.prompt.includes("identify 0-3")){
      const records=JSON.parse(input.prompt.split("- Actor intentions (author-only evidence, not other NPCs' knowledge): ")[1].split("\n")[0]);
      const ref=records.find((r:any)=>r.actor==="Ada"&&r.kind==="goal").ref;
      return {text:JSON.stringify([{type:"entity",description:"A workshop and clockmaker",priority:"high",rationale:"Ada wants a consultation",expectedChange:"A reachable meeting place",evidence:[ref],
        supportRequirements:[{id:"host",kind:"entity",entityType:"agent",description:"A clockmaker to consult"}]}])};
    }
    return {text:JSON.stringify({name:"Workshop",type:"room",description:"Clock repair",components:[],connectToRoomEids:[street],
      contents:[{id:"host",entity:{name:"Nora",type:"agent",description:"A clockmaker",components:[]}}]})};
  });
  const proposals=await runArchitectCognition(f.world,f.god.systemRegistry,f.spirits,f.weaver);
  if(!proposals.length)throw new Error(JSON.stringify({diagnostics:getArchitectDiagnostics(f.world),calls:generate.mock.calls.length}));
  expect(proposals).toHaveLength(1);expect(proposals[0].status).toBe("pending");
  return {street,actor,goal,proposal:proposals[0]};
}

test.each(["current","changed_goal","changed_spec","foreign","legacy"])("proposal review preserves native %s admission",async boundary=>{
  const f=fixture(), p=await pendingPlace(f);
  const unsafe=jest.fn(), full={createRoom:{execute:unsafe},setComponentValues:{execute:unsafe},requestSystemBuild:{execute:unsafe},sendDivineMessage:{execute:unsafe}};
  const scoped=buildSpiritGrowthTools(boundary==="foreign"?fixture().world:f.world,f.god.eid,full,()=>true);
  expect(Object.keys(scoped).sort()).toEqual(["approveProposal","getSpiritProposals","rejectProposal"]);
  if(boundary==="changed_goal")Goal.status[p.goal]="completed";
  if(boundary==="changed_spec")p.proposal.specification={...p.proposal.specification,name:"Other workshop"};
  if(boundary==="legacy") {const clone={...p.proposal,observationScopeId:undefined};getFactoryState().pendingProposals.splice(0,1,clone);}
  const result=await scoped.approveProposal.execute({proposalId:p.proposal.id},{});
  expect(result.success).toBe(boundary==="current");expect(unsafe).not.toHaveBeenCalled();
  expect(getPlaceBuildStatus(f.world,f.god.systemRegistry)).toEqual([]);
  if(boundary==="current"){
    const built=await executeAllApprovedProposals(f.world,f.god.systemRegistry);
    expect(built.failed).toEqual([]);expect(built.executed).toHaveLength(1);
    expect(getRoomForEntity(f.world,p.actor)).toBe(p.street);expect(Goal.status[p.goal]).toBe("active");
  }
});

test("actual autopilot uses the restricted God profile and does not promote a report to operator history",async()=>{
  const f=fixture(), p=await pendingPlace(f);enqueueSpiritMessages(f.god,getMessagesForGodAI(f.spirits),()=>"Weaver");
  const prior=[...f.god.conversationHistory];
  generate.mockImplementation(async input=>{
    expect(input.tools.createRoom).toBeUndefined();expect(input.tools.requestSystemBuild).toBeUndefined();
    const output=await input.tools.approveProposal.execute({proposalId:p.proposal.id},{});
    return {text:"Approved grounded meeting place.",steps:[{toolCalls:[{toolCallId:"a",toolName:"approveProposal",input:{proposalId:p.proposal.id}}],toolResults:[{toolCallId:"a",output}]}]};
  });
  const result=await runGodAutopilotCycle(f.god);
  expect(result.executed).toBe(true);expect(result.actions).toHaveLength(1);expect(p.proposal.status).toBe("approved");
  expect(f.god.conversationHistory).toEqual(prior);
});

test("God tool execution cannot outlive its receipt source and stale inference does not retry",async()=>{
  const f=fixture(), p=await pendingPlace(f);let current=true;
  generate.mockClear();generate.mockImplementation(async input=>{
    current=false;
    await expect(input.tools.approveProposal.execute({proposalId:p.proposal.id},{})).rejects.toThrow("expired");
    return {text:"Late answer",steps:[]};
  });
  await expect(godThink(f.god,"Review report",{authority:"spirit-growth",current:()=>current})).rejects.toThrow("expired");
  expect(generate).toHaveBeenCalledTimes(1);expect(p.proposal.status).toBe("pending");
});

test("a short-lived activity report cannot invalidate an isolated proposal review",async()=>{
  const f=fixture(), p=await pendingPlace(f);
  const proposalMessages=getMessagesForGodAI(f.spirits);
  reportToSuperior(f.spirits,f.weaver.eid,"Short activity report","TRANSIENT_ACTIVITY_CONTEXT","normal",{});
  const activity=getMessagesForGodAI(f.spirits)[0];
  // Match the live failure: proposal arrives with only 5.5s left on a separate report.
  // Use the same timeline reader as delivery, not wall time or arbitrary sleeps.
  const {readSimulationTime}=await import("../../ecs/simulation-time");
  bindSpiritMessageDelivery(f.spirits,activity,()=>readSimulationTime(f.world)<=30000);
  advanceSimulationTimeline(f.world,24500,{integrate:()=>{}});
  enqueueSpiritMessages(f.god,[...proposalMessages,activity],()=>"Weaver");
  generate.mockImplementation(async input=>{
    expect(JSON.stringify(input.messages)).not.toContain("TRANSIENT_ACTIVITY_CONTEXT");
    advanceSimulationTimeline(f.world,10000,{integrate:()=>{}});
    const output=await input.tools.approveProposal.execute({proposalId:p.proposal.id},{});
    expect(output.success).toBe(true);
    return {text:"Approved",steps:[{toolCalls:[{toolCallId:"a",toolName:"approveProposal",input:{proposalId:p.proposal.id}}],toolResults:[{toolCallId:"a",output}]}]};
  });
  const result=await runGodAutopilotCycle(f.god);
  expect(result).toMatchObject({executed:true,messagesIncluded:1});
  expect(p.proposal.status).toBe("approved"); expect(getAutopilotInbox(f.god)).toEqual([]);
  expect(getPlaceBuildStatus(f.world,f.god.systemRegistry)).toEqual([]);
});

test("urgent report work excludes pending proposal context, then a later cycle reviews it",async()=>{
  const f=fixture(), p=await pendingPlace(f), messages=getMessagesForGodAI(f.spirits);
  reportToSuperior(f.spirits,f.weaver.eid,"Urgent health observation","HEALTH_ONLY","urgent",{});
  enqueueSpiritMessages(f.god,[...messages,...getMessagesForGodAI(f.spirits)],()=>"Weaver");
  const first=await runGodAutopilotCycle(f.god,{executeCommand:async command=>{
    expect(command).toContain("HEALTH_ONLY"); expect(command).not.toContain("New Proposal:");
  }});
  expect(first.messagesIncluded).toBe(1); expect(getAutopilotInbox(f.god)).toHaveLength(1);
  const second=await runGodAutopilotCycle(f.god,{executeCommand:async command=>{
    expect(command).toContain("New Proposal:"); expect(command).not.toContain("HEALTH_ONLY");
  }});
  expect(second.executed).toBe(true); expect(getAutopilotInbox(f.god)).toEqual([]);
  expect(p.proposal.status).toBe("pending"); // A test executor isn't native approval.
});

test.each(["high","urgent"])("fresh %s reports cannot starve proposals unless genuinely urgent",async priority=>{
  const f=fixture();await pendingPlace(f);
  const messages=getMessagesForGodAI(f.spirits);messages[0].priority="normal";
  const sendReport=()=>{reportToSuperior(f.spirits,f.weaver.eid,"Current observation","FRESH_ACTIVITY",priority as "high"|"urgent",{});
    enqueueSpiritMessages(f.god,getMessagesForGodAI(f.spirits),()=>"Weaver");};
  enqueueSpiritMessages(f.god,messages,()=>"Weaver");sendReport();
  const first=await runGodAutopilotCycle(f.god,{executeCommand:async command=>{
    expect(command).toContain("FRESH_ACTIVITY");expect(command).not.toContain("New Proposal:");
  }});
  expect(first.executed).toBe(true);
  sendReport();
  const second=await runGodAutopilotCycle(f.god,{executeCommand:async command=>{
    if(priority==="urgent"){expect(command).toContain("FRESH_ACTIVITY");expect(command).not.toContain("New Proposal:");}
    else {expect(command).toContain("New Proposal:");expect(command).not.toContain("FRESH_ACTIVITY");}
  }});
  expect(second.executed).toBe(true);
});
