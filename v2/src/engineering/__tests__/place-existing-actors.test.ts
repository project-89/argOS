import { addComponent, getAllEntities, Prefab } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializeRegistry } from "../../ecs/component-registry";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { Agent, ExternalParticipant, GodAgent, Goal, Name, Needs, Removed, WorkingMemoryIdentity } from "../../ecs/components";
import { getRoomForEntity, setLocatedIn } from "../../ecs/location";
import { createIntentGoal } from "../../cognition/cognition-system";
import { captureActorIntentionEvidence } from "../../spirits/actor-intention-evidence";
import { startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { enableRoomRouteTopology } from "../../runtime/room-routes";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { executeAffordance, executeEffect } from "../../world/effect-executor";
import { worldSchema } from "../../world/schema";
import { materializePlaceBlueprint, getPlaceBuildStatus, type RoomBlueprint, type PlaceActorReference } from "../place-materialization";
import { placeSupportRequirementsSchema } from "../place-support";

const worlds:ReturnType<typeof createArgosWorld>[]=[];
afterEach(()=>{for(const w of worlds.splice(0))stopCommittedEvents(w);});
function fixture() {
  const world=createArgosWorld("Existing visitors");worlds.push(world);initializeRegistry(world);initializePrefabs(world);
  startCommittedEvents(world);enableRoomRouteTopology(world);
  const street=createRoomEntity(world,{name:"Street"}),registry=createSystemRegistry();
  const actor=createAgentEntity(world,{name:"Ada",role:"visitor",systemPrompt:"Choose freely",roomId:street});
  const goal=createIntentGoal(world,actor,"Have dinner and company",7),evidence=captureActorIntentionEvidence(world);
  const ref=evidence.records.find(r=>r.kind==="goal")!.ref;
  const references=new Map<string,PlaceActorReference>([[ref,evidence.resolveActor(ref)!]]);
  const spec:RoomBlueprint={name:"Dining room",type:"room",description:"A place to eat",components:[],connectToRoomEids:[street],
    existingActors:[{id:"visitor",intentionRef:ref}],
    contents:[{id:"host",entity:{name:"Nora",type:"agent",description:"A host",components:[]}},
      {id:"food",entity:{name:"Supper",type:"object",description:"A meal",components:[{name:"ObjectType",values:{typeId:"food_item"}}]}}],
    requiredInteractions:[{actor:"visitor",target:"food",affordance:"eat"},{actor:"host",target:"visitor",affordance:"talk"}]};
  const support=placeSupportRequirementsSchema.parse([
    {id:"visitor",kind:"existing_actor",intentionRef:ref,description:"The real prospective diner"},
    {id:"host",kind:"entity",entityType:"agent",description:"An independent host"},
    {id:"food",kind:"entity",entityType:"object",objectType:"food_item",description:"Food to eat"},
    {id:"dine",kind:"interaction",actor:"visitor",target:"food",affordance:"eat",description:"The visitor can eat"},
    {id:"company",kind:"interaction",actor:"host",target:"visitor",affordance:"talk",description:"The host can speak to the visitor"},
  ]);
  const build=()=>materializePlaceBlueprint(world,spec,evidence.bind([ref]),support,references);
  return {world,registry,street,actor,goal,evidence,ref,references,spec,support,build};
}

test.each(["missing", "foreign_world", "source", "identity", "inactive", "removed", "name", "external", "god", "prefab", "model_eid", "local_collision", "unknown_reference", "undeclared_actor", "surplus", "goal"])(
  "existing actor binding rejects %s before allocating a place", boundary=>{
    const f=fixture(),ref=f.references.get(f.ref)!;
    if(boundary==="missing")f.references.clear();
    if(boundary==="foreign_world")f.references.set(f.ref,{...ref,world:createArgosWorld("Foreign")});
    if(boundary==="source"){stopCommittedEvents(f.world);startCommittedEvents(f.world);}
    if(boundary==="identity")WorkingMemoryIdentity.id[f.actor]="replacement";
    if(boundary==="inactive")Agent.active[f.actor]=false;
    if(boundary==="removed")addComponent(f.world,f.actor,Removed);
    if(boundary==="name")Name.value[f.actor]="Another name";
    if(boundary==="external")addComponent(f.world,f.actor,ExternalParticipant);
    if(boundary==="god")addComponent(f.world,f.actor,GodAgent);
    if(boundary==="prefab")addComponent(f.world,f.actor,Prefab);
    if(boundary==="model_eid")(f.spec.existingActors![0] as any).eid=f.actor;
    if(boundary==="local_collision")f.spec.contents[0].id="visitor";
    if(boundary==="unknown_reference")f.references.set(f.ref,{...ref,eid:999999});
    if(boundary==="undeclared_actor")f.support=f.support.filter(r=>r.kind!=="existing_actor"&&r.kind!=="interaction");
    if(boundary==="surplus")f.references.set("intention:extra",ref);
    if(boundary==="goal")Goal.status[f.goal]="completed";
    const before=getAllEntities(f.world).length;
    expect(()=>materializePlaceBlueprint(f.world,f.spec,f.evidence.bind([f.ref]),f.support,f.references)).toThrow();
    expect(getAllEntities(f.world)).toHaveLength(before);expect(getPlaceBuildStatus(f.world,f.registry)).toEqual([]);
  });

test("two captured intentions cannot turn one existing actor into two independent people",()=>{
  const f=fixture();createIntentGoal(f.world,f.actor,"Also inspect the room",5);
  const observations=captureActorIntentionEvidence(f.world),ref=observations.records.find(r=>r.description==="Also inspect the room")!.ref;
  f.spec.existingActors!.push({id:"another",intentionRef:ref});
  f.support.push({id:"another",kind:"existing_actor",intentionRef:ref,description:"Not a second person"});
  f.references.set(ref,observations.resolveActor(ref)!);
  const before=getAllEntities(f.world).length;
  expect(f.build).toThrow(/One existing person/);expect(getAllEntities(f.world)).toHaveLength(before);
});

test("existing actor is a native actor and target after arrival; construction does not act or complete goals",()=>{
  const f=fixture(),before=getAllEntities(f.world).length,{roomEid}=f.build();
  const status=()=>getPlaceBuildStatus(f.world,f.registry)[0];
  expect(getAllEntities(f.world)).toHaveLength(before+3);expect(getRoomForEntity(f.world,f.actor)).toBe(f.street);
  expect(status()).toMatchObject({readyNow:false,awaitingPresence:["visitor"],support:{status:"awaiting_presence"},
    existingActors:[{eid:f.actor,current:true}],interactions:[{status:"awaiting_presence"},{status:"awaiting_presence"}]});
  // Controlled location transition tests availability, not autonomous travel.
  setLocatedIn(f.world,f.actor,roomEid);
  expect(status()).toMatchObject({readyNow:true,support:{status:"available"},interactions:[{status:"available"},{status:"available"}]});
  Needs.hunger[f.actor]=70;
  const food=status().members.find(m=>m.id==="food")!;
  const registry={byName:new Map([["Ada",f.actor],[food.name,food.eid]]),byId:new Map([[f.actor,"Ada"],[food.eid,food.name]])};
  expect(executeAffordance("eat",{world:f.world,worldSchema,registry,actorEid:f.actor,targetEid:food.eid}).success).toBe(true);
  expect(Needs.hunger[f.actor]).toBe(40);expect(Goal.progress[f.goal]).toBe(0);
  expect(status().support.status).toBe("unavailable");
  const count=getAllEntities(f.world).length;status();expect(getAllEntities(f.world)).toHaveLength(count);
});

test("awaiting presence is not a predicted successful action; native capability is checked on arrival",()=>{
  const f=fixture(),{roomEid}=f.build(),before=getPlaceBuildStatus(f.world,f.registry)[0];
  const food=before.members.find(m=>m.id==="food")!,host=before.members.find(m=>m.id==="host")!;
  expect(executeEffect({type:"set_state",target:"target",state:"rotten"},{world:f.world,worldSchema,
    registry:{byName:new Map(),byId:new Map()},actorEid:host.eid,targetEid:food.eid}).success).toBe(true);
  expect(getPlaceBuildStatus(f.world,f.registry)[0].interactions[0].status).toBe("awaiting_presence");
  setLocatedIn(f.world,f.actor,roomEid);
  expect(getPlaceBuildStatus(f.world,f.registry)[0]).toMatchObject({readyNow:false,support:{status:"unavailable"},interactions:[{status:"unavailable"},{status:"available"}]});
});

test("a missing mechanic or departed host is unavailable, not merely awaiting the visitor",()=>{
  const f=fixture();f.spec.requiredSystems=["Service"];
  f.support.push({id:"service",kind:"system",name:"Service",description:"A service mechanic"});f.build();
  const status=getPlaceBuildStatus(f.world,f.registry)[0];expect(status.support.status).toBe("unavailable");
  setLocatedIn(f.world,status.members.find(m=>m.id==="host")!.eid,f.street);
  const after=getPlaceBuildStatus(f.world,f.registry)[0];expect(after.interactions[1].status).toBe("unavailable");
});

test("physical availability outlives the old goal; later identity replacement does not inherit the binding",()=>{
  const f=fixture(),{roomEid}=f.build();Goal.status[f.goal]="completed";setLocatedIn(f.world,f.actor,roomEid);
  expect(f.evidence.resolveActor(f.ref)).toBeUndefined();
  expect(getPlaceBuildStatus(f.world,f.registry)[0].support.status).toBe("available");
  WorkingMemoryIdentity.id[f.actor]="replacement";
  expect(getPlaceBuildStatus(f.world,f.registry)[0]).toMatchObject({readyNow:false,support:{status:"unavailable"},existingActors:[{current:false}]});
});

test("bindings are copied into receipts; post-build caller mutations cannot rewrite native identity",()=>{
  const f=fixture(),{roomEid}=f.build();f.references.clear();f.spec.existingActors!.splice(0);
  const first=getPlaceBuildStatus(f.world,f.registry)[0];first.existingActors[0].eid=first.members[1].eid;
  first.existingActors[0].key="wrong";first.awaitingPresence.splice(0);
  expect(getPlaceBuildStatus(f.world,f.registry)[0]).toMatchObject({awaitingPresence:["visitor"],existingActors:[{eid:f.actor,current:true}]});
  setLocatedIn(f.world,f.actor,roomEid);expect(getPlaceBuildStatus(f.world,f.registry)[0].support.status).toBe("available");
});

test("reentrant identity change retains honest partial construction, never a completed venue",()=>{
  const f=fixture();
  expect(()=>materializePlaceBlueprint(f.world,f.spec,room=>{
    if(room)WorkingMemoryIdentity.id[f.actor]="replacement";
    return true;
  },f.support,f.references)).toThrow(/changed/);
  expect(getPlaceBuildStatus(f.world,f.registry)[0]).toMatchObject({phase:"failed",readyNow:false,support:{status:"unavailable"}});
  expect(getRoomForEntity(f.world,f.actor)).toBe(f.street);expect(Goal.progress[f.goal]).toBe(0);
});
