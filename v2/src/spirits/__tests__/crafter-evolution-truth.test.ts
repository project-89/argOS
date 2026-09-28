import { getAllEntities, query } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createGodAgent } from "../../god/god-agent";
import { Agent, Name, WorkingMemoryIdentity } from "../../ecs/components";
import { initializePrefabs, createRoomEntity } from "../../ecs/prefabs";
import { initializeRegistry } from "../../ecs/component-registry";
import { getInventoryItems } from "../../ecs/inventory";
import { getRoomForEntity } from "../../ecs/location";
import { startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { getWorldCrafterState, resetWorldCrafterState, recordResourceGap, hasResourceSource,
  registerResourceSource, getEvolutionWorkStatus,
  getUnresolvedResourceGaps, approveEvolutionProposal, executeEvolutionProposal, analyzeGapsAndProposeEvolution,
  type EvolutionProposal } from "../world-crafter-spirit";

function setup(type:EvolutionProposal["type"]="merchant") {
  const world=createArgosWorld("No imaginary supply"); initializeRegistry(world); initializePrefabs(world); startCommittedEvents(world);
  const god=createGodAgent(world,{name:"God",worldName:"Town",narrative:""});
  const room=createRoomEntity(world,{name:"Market"});
  recordResourceGap("copper","Nora","Market");
  const proposal:EvolutionProposal={id:"request-one",timestamp:Date.now(),type,addressesGaps:["copper"],status:"pending",
    proposal:{entityName:"Mina",entityType:"Merchant",location:"Market",description:"A trader who hopes to sell copper.",resources:["copper"]}};
  getWorldCrafterState().evolutionProposals.push(proposal);
  return {world,god,room,proposal};
}
beforeEach(()=>resetWorldCrafterState());
afterEach(()=>resetWorldCrafterState());

test("constructing a native merchant does not claim stock, resource access or a solved supply chain",async()=>{
  const f=setup(); expect(approveEvolutionProposal(f.proposal.id,f.world)).toBe(f.proposal);
  expect(await executeEvolutionProposal(f.proposal,f.god)).toBe(true);
  const merchant=query(f.world,[Agent,Name]).find(eid=>Name.value[eid]==="Mina")!;
  expect(merchant).toBeDefined(); expect(getRoomForEntity(f.world,merchant)).toBe(f.room);
  expect(getInventoryItems(f.world,merchant)).toEqual([]);
  expect(f.proposal.status).toBe("constructed"); expect(hasResourceSource("copper")).toBe(false);
  expect(getUnresolvedResourceGaps()).toHaveLength(1);
  expect(getEvolutionWorkStatus(f.world).work[0]).toMatchObject({status:"constructed",resourcesVerified:false,
    construction:{eid:merchant,current:true,roomEid:f.room}});
  expect(await executeEvolutionProposal(f.proposal,f.god)).toBe(false);
  expect(query(f.world,[Agent,Name]).filter(eid=>Name.value[eid]==="Mina")).toHaveLength(1);
});

test.each(["resource_source","crafting_recipe","trade_route","system"] as const)("a descriptive %s request is not an implemented capability",async type=>{
  const f=setup(type),before=[...getAllEntities(f.world)];
  expect(approveEvolutionProposal(f.proposal.id,f.world)).toBe(f.proposal);
  expect(await executeEvolutionProposal(f.proposal,f.god)).toBe(false);
  expect(f.proposal).toMatchObject({status:"failed",error:expect.stringMatching(/validated|managed/i)});
  expect(getEvolutionWorkStatus(f.world).work[0]).toMatchObject({status:"failed",resourcesVerified:false});
  expect([...getAllEntities(f.world)]).toEqual(before); expect(hasResourceSource("copper")).toBe(false);
  expect(getUnresolvedResourceGaps()).toHaveLength(1);
  // The same unchanged failed work is evidence, not a new automatic retry.
  recordResourceGap("copper","Nora","Market"); recordResourceGap("copper","Nora","Market");
  expect(await analyzeGapsAndProposeEvolution()).toEqual([]);
});

test("reset does not carry source hints into the next simulation",()=>{
  registerResourceSource("copper","Mina"); expect(hasResourceSource("copper")).toBe(true);
  resetWorldCrafterState(); expect(hasResourceSource("copper")).toBe(false);
});

test("work observations are world-bound and an approval is one-shot, not a writable status flag",async()=>{
  const f=setup(); approveEvolutionProposal(f.proposal.id,f.world);
  expect(getEvolutionWorkStatus(f.world).work[0].executionAvailable).toBe(true);
  expect(getEvolutionWorkStatus(createArgosWorld("Unrelated"))).toEqual({omitted:0,work:[]});
  expect(await executeEvolutionProposal(f.proposal,f.god)).toBe(true);
  expect(getEvolutionWorkStatus(f.world).work[0].executionAvailable).toBe(false);
  f.proposal.status="approved";
  expect(await executeEvolutionProposal(f.proposal,f.god)).toBe(false);
  stopCommittedEvents(f.world); startCommittedEvents(f.world);
  expect(getEvolutionWorkStatus(f.world).work[0].basisCurrent).toBe(false);
});

test.each(["missing_room","ambiguous_room","source","changed_spec","replaced_room","foreign_world","copied_approval","unbound_approval"])("legacy authoring respects %s instead of retargeting an old promise",async boundary=>{
  const f=setup();
  if(boundary==="missing_room") f.proposal.proposal.location="near Market";
  if(boundary==="ambiguous_room") createRoomEntity(f.world,{name:"Market"});
  if(boundary==="unbound_approval") f.proposal.status="approved";
  else approveEvolutionProposal(f.proposal.id,f.world);
  if(boundary==="source") {stopCommittedEvents(f.world);startCommittedEvents(f.world);}
  if(boundary==="changed_spec") f.proposal.proposal.resources=["gold"];
  if(boundary==="replaced_room") WorkingMemoryIdentity.id[f.room]="replacement-room";
  let god=f.god;
  if(boundary==="foreign_world") {
    const other=createArgosWorld("Another town");initializeRegistry(other);initializePrefabs(other);startCommittedEvents(other);
    god=createGodAgent(other,{name:"God",worldName:"Another town",narrative:""}); createRoomEntity(other,{name:"Market"});
  }
  const before=[...getAllEntities(god.world)];
  expect(await executeEvolutionProposal(boundary==="copied_approval" ? structuredClone(f.proposal) : f.proposal,god)).toBe(false);
  expect([...getAllEntities(god.world)]).toEqual(before);
  expect(getUnresolvedResourceGaps()).toHaveLength(1);
});
