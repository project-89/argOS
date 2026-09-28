import {jest} from "@jest/globals";
const ai=await import("ai"),generate=jest.fn<(...args:any[])=>Promise<{text:string}>>();
jest.unstable_mockModule("ai",()=>({...ai,generateText:generate}));
const {createArgosWorld}=await import("../../ecs/world");
const {initializePrefabs,createRoomEntity}=await import("../../ecs/prefabs");
const {createSystemRegistry}=await import("../../ecs/dynamic-systems");
const {startCommittedEvents,stopCommittedEvents}=await import("../../runtime/committed-events");
const {advanceSimulationTime}=await import("../../ecs/simulation-time");
const {createGodAgent}=await import("../../god/god-agent");
const {createSpiritRegistry,setGodAgent,sendMessage}=await import("../spirit-registry");
const {createDynamicSpirit,resetFactoryState}=await import("../spirit-factory");
const {runArchitectCognition,getCurrentObservedProposals,getObservedProposalDiagnostics}=await import("../architect-spirit");
const {runSpiritCognition}=await import("../spirit-cognition");
const {createEntityRegistry}=await import("../../ecs/tools");
const {createWatcherSpirit,runObservationSynthesis}=await import("../watcher-spirit");
const {reportGap}=await import("../observation-aggregator");
const {bindSpiritMessageDelivery}=await import("../spirit-message-delivery");
const {readSimulationTime}=await import("../../ecs/simulation-time");
const {registerNarrativeOpportunity,reviewNarrativeOpportunity,captureNarrativeOpportunities,narrativeOpportunityStatuses}=await import("../narrative-opportunities");
function fixture(){
  const world=createArgosWorld("Narrative request");initializePrefabs(world);startCommittedEvents(world);
  const god=createGodAgent(world,{name:"God",worldName:"Narrative request",narrative:""});
  const registry=createSpiritRegistry(world);setGodAgent(registry,god.eid);
  const room=createRoomEntity(world,{name:"Street"});
  const narrator=createDynamicSpirit(registry,{name:"Narrator",type:"narrator",rank:"archangel",domain:"narrative"})!;
  const weaver=createDynamicSpirit(registry,{name:"Weaver",type:"architect",rank:"archangel",domain:"ecology",architectConfig:{canProposeEntities:true,canProposeSystems:false,canProposeComponents:false,canProposeRules:false,canExecuteDirectly:false,proposalApproval:"godai",maxProposalsPerCycle:1}})!;
  const message=sendMessage(registry,god.eid,narrator.eid,"request","Suggestion","An autonomous visitor may arrive",{requiresResponse:true});
  registerNarrativeOpportunity(registry,narrator,message,"An autonomous visitor may arrive");
  const review=()=>reviewNarrativeOpportunity(world,narrator,[message],[{subject:"Visitor opportunity",content:"Consider a visitor starting on Street, not an accomplished arrival."}]);
  return {world,registry,room,narrator,weaver,message,review};
}
beforeEach(()=>{resetFactoryState();generate.mockReset();jest.spyOn(globalThis,"fetch").mockRejectedValue(new Error("offline"));});
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();jest.restoreAllMocks();});
test("only reviewed original requests become source-bound author evidence",()=>{
  const f=fixture();expect(captureNarrativeOpportunities(f.world).records).toHaveLength(0);
  reviewNarrativeOpportunity(f.world,f.narrator,[{...f.message}],[{subject:"Forged",content:"FORGED"}]);
  expect(captureNarrativeOpportunities(f.world).records).toHaveLength(0);
  f.review();const capture=captureNarrativeOpportunities(f.world);
  expect(capture.records).toHaveLength(1);expect(capture.bind([capture.records[0].ref])()).toBe(true);
  expect(captureNarrativeOpportunities(createArgosWorld()).records).toHaveLength(0);
  expect(capture.bind(["opportunity:forged"])()).toBe(false);
  expect(narrativeOpportunityStatuses(f.world)[0].status).toBe("reviewed");
});
test.each(["expiry","tamper","stop","replacement"])("%s invalidates advice already captured",change=>{
  const f=fixture();f.review();const capture=captureNarrativeOpportunities(f.world),current=capture.bind([capture.records[0].ref]);
  if(change==="expiry")advanceSimulationTime(f.world,1,300001);
  if(change==="tamper")f.message.content="FORGED";
  if(change==="stop")stopCommittedEvents(f.world);
  if(change==="replacement")f.registry.spirits.set(f.narrator.eid,{...f.narrator});
  expect(current()).toBe(false);expect(captureNarrativeOpportunities(f.world).records).toHaveLength(0);
});
test("one proposal consumes an opportunity without invalidating its own admission",()=>{
  const f=fixture();f.review();
  const first=captureNarrativeOpportunities(f.world),second=captureNarrativeOpportunities(f.world);
  const refs=[first.records[0].ref],firstCurrent=first.bind(refs),secondCurrent=second.bind(refs);
  const proposal={id:"native-proposal",status:"pending"} as any;
  first.attach(refs,proposal);
  expect(firstCurrent()).toBe(true);expect(secondCurrent()).toBe(false);
  expect(first.bind(refs)()).toBe(false);
  expect(()=>second.attach(refs,{...proposal})).toThrow("superseded");
  advanceSimulationTime(f.world,1,300001);
  expect(firstCurrent()).toBe(false);
});
test("ambiguous request batches do not attribute one report to multiple suggestions",()=>{
  const f=fixture();
  const other=sendMessage(f.registry,f.registry.godAgentEid!,f.narrator.eid,"request","Other","Other opportunity");
  registerNarrativeOpportunity(f.registry,f.narrator,other,"Other opportunity");
  reviewNarrativeOpportunity(f.world,f.narrator,[f.message,other],[{subject:"Assessment",content:"One visitor"}]);
  expect(captureNarrativeOpportunities(f.world).records).toHaveLength(0);
});
test("native narrator cycle reviews its receipt before consuming the inbox",async()=>{
  const f=fixture();
  generate.mockResolvedValueOnce({text:JSON.stringify({thoughts:"A visitor could offer a choice.",reportToSuperior:{needed:true,subject:"Visitor",content:"Propose a visitor on Street; arrival has not happened."}})});
  await runSpiritCognition(f.narrator,f.world,createEntityRegistry(),f.registry);
  expect(f.narrator.inbox).not.toContain(f.message);
  expect(captureNarrativeOpportunities(f.world).records[0]).toMatchObject({requestId:f.message.id,assessment:"Visitor: Propose a visitor on Street; arrival has not happened."});
});
test("Weaver receives reviewed opportunity and creates only an unapproved proposal",async()=>{
  const f=fixture();f.review();const ref=captureNarrativeOpportunities(f.world).records[0].ref;
  // Executor capability must never grant self-approval in God-reviewed mode.
  f.weaver.architectConfig!.canExecuteDirectly=true;
  generate.mockResolvedValueOnce({text:JSON.stringify([{type:"entity",description:"A visitor to speak with residents",priority:"medium",rationale:"Reviewed story opportunity",evidence:[ref,`entity:${f.room}`],expectedChange:"New autonomous visitor on Street"}])})
    .mockResolvedValueOnce({text:JSON.stringify({name:"Visitor",description:"A visitor in a dark coat.",type:"agent",roomEid:f.room,components:[]})});
  const proposals=await runArchitectCognition(f.world,createSystemRegistry(),f.registry,f.weaver);
  expect(generate.mock.calls[0][0].prompt).toContain(ref);
  expect(proposals).toHaveLength(1);expect(proposals[0].status).toBe("pending");
  expect(getCurrentObservedProposals(f.world)).toContain(proposals[0]);
  expect(narrativeOpportunityStatuses(f.world)[0]).toMatchObject({status:"pending",proposalId:proposals[0].id});
  expect(captureNarrativeOpportunities(f.world).records).toHaveLength(0);
  generate.mockResolvedValueOnce({text:"[]"});
  await runArchitectCognition(f.world,createSystemRegistry(),f.registry,f.weaver);
  expect(getCurrentObservedProposals(f.world)).toContain(proposals[0]);
});

test.each(["after_acceptance","during_design"])("Watcher expiry %s does not substitute for native proposal evidence",async boundary=>{
  const f=fixture();f.review();
  f.registry.byName.set("The Weaver",f.weaver.eid);
  const watcher=createWatcherSpirit(f.registry)!;
  reportGap("Inspector","interaction_failure","Historical observation","Inspect native prerequisites","high",f.world);
  runObservationSynthesis(f.world,f.registry,watcher.eid);
  const receipt=f.weaver.inbox.find(m=>m.from===watcher.eid)!;expect(receipt).toBeDefined();
  bindSpiritMessageDelivery(f.registry,receipt,()=>readSimulationTime(f.world)<20000);
  const ref=captureNarrativeOpportunities(f.world).records[0].ref;
  generate.mockResolvedValueOnce({text:JSON.stringify([{type:"entity",description:"A visitor",priority:"medium",rationale:"Reviewed author opportunity",evidence:[ref,`entity:${f.room}`],expectedChange:"Visitor on Street"}])})
    .mockImplementationOnce(async()=>{
      if(boundary==="during_design")advanceSimulationTime(f.world,1,25000);
      return {text:JSON.stringify({name:"Visitor",description:"An autonomous visitor",type:"agent",roomEid:f.room,components:[]})};
    });
  const proposals=await runArchitectCognition(f.world,createSystemRegistry(),f.registry,f.weaver);
  if(boundary==="during_design"){expect(proposals).toEqual([]);return;}
  expect(proposals).toHaveLength(1);
  advanceSimulationTime(f.world,1,25000);
  expect(getCurrentObservedProposals(f.world)).toContain(proposals[0]);
  stopCommittedEvents(f.world);
  expect(getCurrentObservedProposals(f.world)).toEqual([]);
});

test.each(["opportunity", "specification", "scope", "stop"])("operator diagnostics record native %s invalidation without reevaluating authority", async change => {
  const f=fixture(); f.review(); const ref=captureNarrativeOpportunities(f.world).records[0].ref;
  generate.mockResolvedValueOnce({text:JSON.stringify([{type:"entity",description:"A visitor",priority:"medium",rationale:"Reviewed opportunity",evidence:[ref,`entity:${f.room}`],expectedChange:"Visitor on Street"}])})
    .mockResolvedValueOnce({text:JSON.stringify({name:"Visitor",description:"An autonomous visitor",type:"agent",roomEid:f.room,components:[]})});
  const proposals=await runArchitectCognition(f.world,createSystemRegistry(),f.registry,f.weaver);
  expect(proposals).toHaveLength(1);
  expect(getCurrentObservedProposals(f.world)).toContain(proposals[0]);
  const before=getObservedProposalDiagnostics(f.world);
  expect(before[0]).toMatchObject({lastObservedAdmissible:true,evidence:[ref,`entity:${f.room}`]});
  if(change==="opportunity") f.message.content="A replaced request";
  if(change==="specification") proposals[0].specification.description="Changed specification";
  if(change==="scope") proposals[0].observationScopeId="forged";
  if(change==="stop") stopCommittedEvents(f.world);
  // Passive inspection must not test/revoke the admission, even on a stale world.
  expect(getObservedProposalDiagnostics(f.world)).toEqual(before);
  expect(getCurrentObservedProposals(f.world)).toEqual([]);
  const after=getObservedProposalDiagnostics(f.world);
  expect(after[0]).toMatchObject({lastObservedAdmissible:false,reason:{opportunity:"narrative_opportunity",specification:"specification_changed",scope:"scope_key_changed",stop:"producer_source"}[change]});
  after[0].evidence.push("FORGED_DIAGNOSTIC");
  expect(getObservedProposalDiagnostics(f.world)[0].evidence).not.toContain("FORGED_DIAGNOSTIC");
  expect(proposals[0].status).toBe("pending");
  expect(getObservedProposalDiagnostics(createArgosWorld())).toEqual([]);
});
