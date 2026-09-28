import { addEntity, addComponent, query, hasComponent, getAllEntities, removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { ExternalParticipant, ParticipantEmbodiment, Agent, Mind, Name, WorkingMemoryIdentity } from "../../ecs/components";
import { createEcsTools, createEntityRegistry, registerEntity } from "../../ecs/tools";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { attachToEntity } from "../../ecs/component-registry";
import { setDynamicComponentValue } from "../../ecs/dynamic-components";
import { registerExternalParticipant, getExternalParticipants, authorizeParticipantEmbodiment, assertAgentIdentityAvailable,
  beginParticipantEmbodiment, type ParticipantEmbodimentGrant } from "../participant-identities";
import { startCommittedEvents, stopCommittedEvents, getCommittedEvents } from "../committed-events";
import { withSimulationTask } from "../task-scope";
import { serializeWorld, deserializeWorld } from "../../persistence/world-persistence";
import { materializeApprovedEntity } from "../../engineering/entity-materialization";
import { materializePlaceBlueprint, getPlaceBuildStatus } from "../../engineering/place-materialization";
import { PRIVATE_MANAGED_COMPONENTS, PROTECTED_MANAGED_COMPONENTS } from "../../engineering/contracts";

function setup(){const world=createArgosWorld("Participants");initializePrefabs(world);startCommittedEvents(world);
  registerExternalParticipant(world,"remote:1","Morgan");return world;}
const config=(name:string,participantGrant?:ParticipantEmbodimentGrant)=>({name,role:"visitor",systemPrompt:`You are ${name}.`,participantGrant});

test.each(["Morgan"," mOrGaN ","Ｍｏｒｇａｎ"])("registered remote identity %s is not automatically an NPC",name=>{
  const w=setup(),before=[...getAllEntities(w)];expect(()=>createAgentEntity(w,config(name))).toThrow(/identity/);
  expect([...getAllEntities(w)]).toEqual(before);expect(getCommittedEvents(w).events).toEqual([]);
});
test("identities are per-world, metadata is not perception, and new populated places remain valid",()=>{
  const w=setup();
  const room=materializePlaceBlueprint(w,{name:"Workshop",description:"A workshop.",type:"room",components:[],contents:[
    {id:"keeper",entity:{name:"Nora",description:"A keeper.",type:"agent",components:[]}},
    {id:"guest",entity:{name:"Ivo",description:"A guest.",type:"agent",components:[]}},
  ]});
  expect(getPlaceBuildStatus(w,createSystemRegistry())[0]).toMatchObject({phase:"constructed",readyNow:true});
  expect(room.roomEid).toBeDefined();expect([...query(w,[Agent])].filter(eid=>Name.value[eid])).toHaveLength(2);
  const record=[...query(w,[ExternalParticipant])][0];
  expect(hasComponent(w,record,Agent)).toBe(false);expect(hasComponent(w,record,Name)).toBe(false);
  expect(hasComponent(w,record,Mind)).toBe(false);expect(getCommittedEvents(w).events).toEqual([]);
  // Legacy prefab metadata uses an ambient registry; finish this world's
  // construction before booting another. Identity reads themselves are scoped.
  const other=createArgosWorld("Independent");initializePrefabs(other);
  expect(()=>createAgentEntity(other,config("Morgan"))).not.toThrow();
  expect(()=>assertAgentIdentityAvailable(w,"Morgan")).toThrow(/identity/);
});
test("a host can explicitly delegate one autonomous avatar without claiming remote physical presence",()=>{
  const w=setup(),first=authorizeParticipantEmbodiment(w,"remote:1"),second=authorizeParticipantEmbodiment(w,"remote:1");
  const eid=createAgentEntity(w,config("Morgan",first));
  expect(Agent.active[eid]).toBe(true);expect(ParticipantEmbodiment.participantId[eid]).toBe("remote:1");
  expect(ParticipantEmbodiment.ownerKey[eid]).toBe(WorkingMemoryIdentity.id[eid]);
  expect(getExternalParticipants(w)[0]).toMatchObject({presence:"outside_world",delegatedAvatars:[{eid}]});
  expect(()=>createAgentEntity(w,config("Morgan",first))).toThrow(/grant/);
  expect(()=>createAgentEntity(w,config("Morgan",second))).toThrow(/grant/);
});
test.each(["rename","rename_back","source","foreign_world","copied","wrong_name"])("%s invalidates delayed embodiment authority",change=>{
  const w=setup(),token=authorizeParticipantEmbodiment(w,"remote:1");let target=w,name="Morgan",grant=token;
  if(change.startsWith("rename")){registerExternalParticipant(w,"remote:1","Riley");if(change==="rename_back")registerExternalParticipant(w,"remote:1","Morgan");}
  if(change==="source"){stopCommittedEvents(w);startCommittedEvents(w);}
  if(change==="foreign_world")target=setup();
  if(change==="copied")grant={...token};
  if(change==="wrong_name")name="Nora";
  const before=[...getAllEntities(target)];expect(()=>createAgentEntity(target,config(name,grant))).toThrow(/grant/);
  expect([...getAllEntities(target)]).toEqual(before);
});
test("task cancellation invalidates a delayed host grant",async()=>{
  const w=setup(),controller=new AbortController();
  const grant=await withSimulationTask(controller.signal,async()=>authorizeParticipantEmbodiment(w,"remote:1"));controller.abort();
  expect(()=>createAgentEntity(w,config("Morgan",grant))).toThrow(/grant/);
});
test("failed construction consumes its host grant and revalidates source at completion",()=>{
  const w=setup(),grant=authorizeParticipantEmbodiment(w,"remote:1"),finish=beginParticipantEmbodiment(w,"Morgan",grant);
  stopCommittedEvents(w);startCommittedEvents(w);
  const eid=createAgentEntity(w,config("Nora"));expect(()=>finish(eid)).toThrow(/grant/);
  expect(hasComponent(w,eid,ParticipantEmbodiment)).toBe(false);
  expect(()=>createAgentEntity(w,config("Morgan",grant))).toThrow(/grant/);
});
test("rename keeps historical aliases reserved without leaking a relationship or message",()=>{
  const w=setup();registerExternalParticipant(w,"remote:1","Riley");
  expect(getExternalParticipants(w)[0]).toEqual({id:"remote:1",name:"Riley",aliases:["Morgan","Riley"],presence:"outside_world",delegatedAvatars:[]});
  expect(()=>assertAgentIdentityAvailable(w,"Morgan")).toThrow(/identity/);
  expect(()=>assertAgentIdentityAvailable(w,"Riley")).toThrow(/identity/);
});
test("persisted identities and delegated bindings survive remapping but old grants do not",()=>{
  const w=setup(),grant=authorizeParticipantEmbodiment(w,"remote:1"),avatar=createAgentEntity(w,config("Morgan",grant));
  registerExternalParticipant(w,"remote:2","Robin");const pending=authorizeParticipantEmbodiment(w,"remote:2");
  const saved=JSON.parse(JSON.stringify(serializeWorld(w,createSystemRegistry())));
  const restored=createArgosWorld("Restored");initializePrefabs(restored);startCommittedEvents(restored);
  const {oldToNewId}=deserializeWorld(restored,createSystemRegistry(),saved);
  expect(getExternalParticipants(restored)[0].delegatedAvatars[0]).toEqual({eid:oldToNewId.get(avatar),key:WorkingMemoryIdentity.id[avatar]});
  expect(()=>createAgentEntity(restored,config("Robin",pending))).toThrow(/grant/);
  expect(()=>createAgentEntity(restored,config("Morgan"))).toThrow(/identity/);
});
test.each(["set_name","add_name","attach_agent","set_agent","forge_binding","remove_binding"])("generic tools cannot bypass participant authority through %s",path=>{
  const w=setup(),reg=createEntityRegistry(),tools=createEcsTools(w,reg);
  const person=createAgentEntity(w,config("Nora"));registerEntity(reg,"Nora",person);
  const placeholder=addEntity(w);addComponent(w,placeholder,Name);Name.value[placeholder]="Morgan";registerEntity(reg,"Morgan",placeholder);
  const result=path==="set_name"?tools.setComponentValues({entityName:"Nora",componentName:"Name",values:{value:"Morgan"}})
    :path==="add_name"?tools.addComponent({entityName:"Nora",componentName:"Name",values:{value:"Morgan"}})
    :path==="attach_agent"?tools.addComponent({entityName:"Morgan",componentName:"Agent"})
    :path==="set_agent"?tools.setComponentValues({entityName:"Morgan",componentName:"Agent",values:{active:true}})
    :path==="forge_binding"?tools.addComponent({entityName:"Nora",componentName:"ParticipantEmbodiment",values:{participantId:"remote:1"}})
    :tools.removeComponentFromEntity({entityName:"Nora",componentName:"ParticipantEmbodiment"});
  expect(result.success).toBe(false);expect(Name.value[person]).toBe("Nora");expect(hasComponent(w,placeholder,Agent)).toBe(false);
});
test.each(["ExternalParticipant","ParticipantEmbodiment"])("generated code and component proposals cannot write %s",component=>{
  const w=setup(),room=createRoomEntity(w,{name:"Room"}),before=[...getAllEntities(w)];
  expect(PRIVATE_MANAGED_COMPONENTS.has(component)).toBe(true);expect(PROTECTED_MANAGED_COMPONENTS.has(component)).toBe(true);
  expect(()=>materializeApprovedEntity(w,{name:"Nora",description:"resident",type:"agent",roomEid:room,components:[{name:component,values:{}}]})).toThrow(/host authority/);
  expect([...getAllEntities(w)]).toEqual(before);
});
test("a newly registered participant invalidates an older native actor proposal at actual admission",()=>{
  const w=setup(),room=createRoomEntity(w,{name:"Room"}),spec={name:"Robin",description:"A visitor",type:"agent" as const,roomEid:room,components:[]};
  assertAgentIdentityAvailable(w,spec.name);registerExternalParticipant(w,"remote:2","Robin");
  const before=[...getAllEntities(w)];expect(()=>materializeApprovedEntity(w,spec)).toThrow(/identity/);
  expect([...getAllEntities(w)]).toEqual(before);
});
test("registration does not rename or take control of an existing namesake",()=>{
  const w=setup(),eid=createAgentEntity(w,config("Robin"));registerExternalParticipant(w,"remote:2","Robin");
  expect(Agent.active[eid]).toBe(true);expect(Name.value[eid]).toBe("Robin");
  expect(hasComponent(w,eid,ParticipantEmbodiment)).toBe(false);
  expect(getExternalParticipants(w)[1].delegatedAvatars).toEqual([]);
});
test("identity aliases are bounded without silently discarding old names",()=>{
  const w=setup();for(let i=0;i<31;i++)registerExternalParticipant(w,"remote:1",`Name ${i}`);
  expect(()=>registerExternalParticipant(w,"remote:1","Overflow")).toThrow(/bound/);
  expect(getExternalParticipants(w)[0].name).toBe("Name 30");
  expect(()=>assertAgentIdentityAvailable(w,"Morgan")).toThrow(/identity/);
});

test.each(["registry","legacy_setter"])("%s cannot bypass constructor identity checks",path=>{
  const w=setup(),eid=createAgentEntity(w,config("Nora"));
  expect(()=>path==="registry"?attachToEntity(w,eid,"Name",{value:"Morgan"}):setDynamicComponentValue("Name",eid,"value","Morgan")).toThrow(/identity/);
  expect(Name.value[eid]).toBe("Nora");
  expect(()=>attachToEntity(w,eid,"Name",{value:"Nora Reed"})).not.toThrow();
  expect(Name.value[eid]).toBe("Nora Reed");
});
