import { addComponent, entityExists, getAllEntities } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializeRegistry } from "../../ecs/component-registry";
import { createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Agent, Needs, ObjectState, ObjectType, Removed, WorkingMemoryIdentity } from "../../ecs/components";
import { getRoomForEntity, setLocatedIn } from "../../ecs/location";
import { createSystemRegistry, registerSystem } from "../../ecs/dynamic-systems";
import { enableRoomRouteTopology, disconnectRoomRoute } from "../../runtime/room-routes";
import { startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { worldSchema } from "../../world/schema";
import { executeAffordance, executeEffect } from "../../world/effect-executor";
import { placeSupportRequirementsSchema, readPlaceDesignResponse, validatePlaceSupportDesign } from "../place-support";
import { materializePlaceBlueprint, getPlaceBuildStatus, type RoomBlueprint } from "../place-materialization";
import { getEntityAuthoringCatalog } from "../entity-authoring-catalog";

const worlds:ReturnType<typeof createArgosWorld>[]=[];
afterEach(()=>{for(const w of worlds.splice(0))stopCommittedEvents(w);});
function setup() {
  const world=createArgosWorld("Place support");worlds.push(world);initializeRegistry(world);initializePrefabs(world);startCommittedEvents(world);
  enableRoomRouteTopology(world);const registry=createSystemRegistry(),street=createRoomEntity(world,{name:"Street"});
  const support=placeSupportRequirementsSchema.parse([
    {id:"entry",kind:"connection",roomEid:street,description:"Access to the public street"},
    {id:"owner",kind:"entity",entityType:"agent",role:"owner",description:"A person who runs this place"},
    {id:"customer",kind:"entity",entityType:"agent",role:"customer",description:"An independent diner"},
    {id:"meal",kind:"entity",entityType:"object",objectType:"food_item",description:"Actual food"},
    {id:"dining",kind:"interaction",actor:"customer",target:"meal",affordance:"eat",description:"A diner can eat the food"},
  ]);
  const spec:RoomBlueprint={name:"Dining room",description:"A place to eat",type:"room",components:[],connectToRoomEids:[street],
    contents:[
      {id:"owner",entity:{name:"Rafi",description:"The owner",type:"agent",components:[{name:"Agent",values:{role:"owner"}}]}},
      {id:"customer",entity:{name:"Jo",description:"A customer",type:"agent",components:[{name:"Agent",values:{role:"customer"}}]}},
      {id:"meal",entity:{name:"Supper",description:"A meal",type:"object",components:[{name:"ObjectType",values:{typeId:"food_item"}}]}},
    ],requiredInteractions:[{actor:"customer",target:"meal",affordance:"eat"}]};
  return {world,registry,street,spec,support};
}

test("every advertised authoring type ID resolves in the actual registry, including differently named food",()=>{
  setup();const catalog=getEntityAuthoringCatalog();
  expect(catalog.objectTypes.some(t=>t.typeId==="food_item")).toBe(true);
  for(const type of catalog.objectTypes) expect(worldSchema.getObjectType(type.typeId)).toBeDefined();
});

test("a designer can strengthen an incomplete contract without weakening original requirements",()=>{
  const f=setup(), base=f.support.slice(0,3), additions=f.support.slice(3);
  const raw={...f.spec,additionalSupportRequirements:additions,unresolvedSupport:[]};
  const result=readPlaceDesignResponse(raw,base);
  expect(result.requirements).toEqual(f.support); expect(base).toHaveLength(3);
  expect(result.blueprint).toEqual(f.spec); expect(raw.additionalSupportRequirements).toEqual(additions);
  expect(()=>validatePlaceSupportDesign(result.blueprint as RoomBlueprint,result.requirements)).not.toThrow();
  // The old furniture/residents-only blueprint cannot satisfy added meal support.
  const incomplete={...f.spec,contents:f.spec.contents.slice(0,2),requiredInteractions:[]};
  expect(()=>validatePlaceSupportDesign(incomplete,result.requirements)).toThrow(/support requirement/);
});

test("a redundant complete contract is author metadata, not an unknown ECS field",()=>{
  const f=setup(), base=f.support.slice(0,3);
  const echoed=structuredClone(f.support).reverse();
  echoed[0]=Object.fromEntries(Object.entries(echoed[0]).reverse()) as typeof echoed[number];
  const raw={...f.spec,supportRequirements:echoed,unresolvedSupport:[]};
  const result=readPlaceDesignResponse(raw,base);
  expect(result.blueprint).toEqual(f.spec);
  expect(result.requirements).toEqual(expect.arrayContaining(f.support));
  expect(result.requirements).toHaveLength(f.support.length);
  expect(()=>validatePlaceSupportDesign(result.blueprint as RoomBlueprint,result.requirements)).not.toThrow();
  expect(raw.supportRequirements).toEqual(echoed);
});

test.each(["missing","changed","duplicate"])("a full contract echo cannot weaken its source: %s",boundary=>{
  const f=setup(),echoed:any[]=structuredClone(f.support);
  if(boundary==="missing")echoed.pop();
  if(boundary==="changed")echoed[0].roomEid++;
  if(boundary==="duplicate")echoed.push(echoed[0]);
  expect(()=>readPlaceDesignResponse({...f.spec,supportRequirements:echoed},f.support)).toThrow();
});

test.each(["redefine","missing_reference","private_data","too_many","unresolved","nonroom"])(
  "support strengthening fails closed: %s",boundary=>{
    const f=setup(), raw:any={...f.spec,additionalSupportRequirements:[],unresolvedSupport:[]};
    if(boundary==="redefine")raw.additionalSupportRequirements=[{...f.support[0],kind:"space"}];
    if(boundary==="missing_reference")raw.additionalSupportRequirements=[{id:"bad",description:"Bad interaction",kind:"interaction",actor:"absent",target:"meal",affordance:"eat"}];
    if(boundary==="private_data")raw.additionalSupportRequirements=[{id:"mind",description:"Read mind",kind:"data",target:"room",component:"Thought",fields:["content"]}];
    if(boundary==="too_many")raw.additionalSupportRequirements=Array.from({length:25},(_,i)=>({id:`s${i}`,kind:"space",description:"Space"}));
    if(boundary==="unresolved")raw.unresolvedSupport=["Still no usable meal"];
    if(boundary==="nonroom")raw.type="object";
    expect(()=>readPlaceDesignResponse(raw,f.support)).toThrow();
    expect(getPlaceBuildStatus(f.world,f.registry)).toEqual([]);
  });

test.each(["empty","duplicate_id","reserved_id","unknown_field","wrong_role_kind","wrong_object_kind","missing_actor","non_agent_actor","missing_target","too_many","bad_id","empty_description"])(
  "support requirements reject malformed authority before any allocation: %s",boundary=>{
    const f=setup(), input:any=structuredClone(f.support);
    if(boundary==="empty")input.splice(0);
    if(boundary==="duplicate_id")input[1].id=input[0].id;
    if(boundary==="reserved_id")input[0].id="room";
    if(boundary==="unknown_field")input[0].completeGoal=true;
    if(boundary==="wrong_role_kind")input[3].role="owner";
    if(boundary==="wrong_object_kind")input[1].objectType="chair";
    if(boundary==="missing_actor")input[4].actor="absent";
    if(boundary==="non_agent_actor")input[4].actor="meal";
    if(boundary==="missing_target")input[4].target="absent";
    if(boundary==="too_many")for(let i=0;i<25;i++)input.push({id:`space${i}`,kind:"space",description:"Space"});
    if(boundary==="bad_id")input[0].id="../room";
    if(boundary==="empty_description")input[0].description=" ";
    const before=getAllEntities(f.world).length;
    expect(()=>materializePlaceBlueprint(f.world,f.spec,undefined,input)).toThrow();
    expect(getAllEntities(f.world)).toHaveLength(before);expect(getPlaceBuildStatus(f.world,f.registry)).toEqual([]);
  });

test.each(["no_contents","missing_person","wrong_kind","wrong_object","wrong_role","no_route","no_interaction","different_interaction","nonexistent_system"])(
  "a detailed design must discharge the original support contract: %s",boundary=>{
    const f=setup(), spec=structuredClone(f.spec), support=structuredClone(f.support);
    if(boundary==="no_contents")spec.contents=[];
    if(boundary==="missing_person")spec.contents.splice(0,1);
    if(boundary==="wrong_kind")spec.contents[0].entity.type="stimulus_source";
    if(boundary==="wrong_object")spec.contents[2].entity.components[0].values.typeId="object";
    if(boundary==="wrong_role")spec.contents[0].entity.components[0].values.role="visitor";
    if(boundary==="no_route")spec.connectToRoomEids=[];
    if(boundary==="no_interaction")spec.requiredInteractions=[];
    if(boundary==="different_interaction")spec.requiredInteractions![0].affordance="examine";
    if(boundary==="nonexistent_system")support.push({id:"heat",kind:"system",name:"Heating",description:"Heating"});
    expect(()=>validatePlaceSupportDesign(spec,support)).toThrow(/support requirement/);
  });

test("real native food can be consumed; available support does not mean the meal has happened",()=>{
  const f=setup();const {roomEid}=materializePlaceBlueprint(f.world,f.spec,undefined,f.support);
  const before=getPlaceBuildStatus(f.world,f.registry)[0]; expect(before.support.status).toBe("available");
  const customer=before.members.find(m=>m.id==="customer")!.eid, meal=before.members.find(m=>m.id==="meal")!.eid;
  expect(entityExists(f.world,meal)).toBe(true);expect(getRoomForEntity(f.world,customer)).toBe(roomEid);
  Needs.hunger[customer]=70;
  const byName=new Map([["Jo",customer],["Supper",meal]]),byId=new Map([[customer,"Jo"],[meal,"Supper"]]);
  const result=executeAffordance("eat",{world:f.world,worldSchema,registry:{byName,byId},actorEid:customer,targetEid:meal});
  expect(result.success).toBe(true);expect(Needs.hunger[customer]).toBe(40);
  const after=getPlaceBuildStatus(f.world,f.registry)[0];
  expect(after.support).toMatchObject({status:"unavailable",unmet:expect.arrayContaining([{id:"meal",reason:"member_unavailable"}])});
  // The observer never replenishes food or compels another person to eat.
  const count=getAllEntities(f.world).length;getPlaceBuildStatus(f.world,f.registry);expect(getAllEntities(f.world)).toHaveLength(count);
});

test.each(["departure","inactive","removed","identity","role","object_type","rotten","route","source"])(
  "support availability follows current native facts: %s",boundary=>{
    const f=setup();materializePlaceBlueprint(f.world,f.spec,undefined,f.support);
    const before=getPlaceBuildStatus(f.world,f.registry)[0],owner=before.members.find(m=>m.id==="owner")!,meal=before.members.find(m=>m.id==="meal")!;
    expect(before.support.status).toBe("available");
    if(boundary==="departure")setLocatedIn(f.world,owner.eid,f.street);
    if(boundary==="inactive")Agent.active[owner.eid]=false;
    if(boundary==="removed")addComponent(f.world,owner.eid,Removed);
    if(boundary==="identity")WorkingMemoryIdentity.id[owner.eid]="replacement";
    if(boundary==="role")Agent.role[owner.eid]="visitor";
    if(boundary==="object_type")ObjectType.typeId[meal.eid]="object";
    if(boundary==="rotten") {
      const byName=new Map([[owner.name,owner.eid],[meal.name,meal.eid]]),byId=new Map([[owner.eid,owner.name],[meal.eid,meal.name]]);
      expect(executeEffect({type:"set_state",target:"target",state:"rotten"},{world:f.world,worldSchema,registry:{byName,byId},actorEid:owner.eid,targetEid:meal.eid}).success).toBe(true);
      expect(ObjectState.current[meal.eid]).toBe("rotten");
    }
    if(boundary==="route")disconnectRoomRoute(f.world,f.street,before.members.find(m=>m.id==="room")!.eid);
    if(boundary==="source"){stopCommittedEvents(f.world);startCommittedEvents(f.world);}
    const after=getPlaceBuildStatus(f.world,f.registry)[0];expect(after.phase).toBe("constructed");expect(after.support.status).toBe("unavailable");
    if(boundary==="departure") {expect(after.readyNow).toBe(true);expect(after.support).toMatchObject({unmet:[{id:"owner",reason:"member_elsewhere"}]});}
  });

test("support contracts and observations are copied, never rewritten by caller mutation",()=>{
  const f=setup();materializePlaceBlueprint(f.world,f.spec,()=>{f.support.splice(0);return true;},f.support);
  const first=getPlaceBuildStatus(f.world,f.registry)[0];expect(first.support.status).toBe("available");
  if(first.support.status!=="unassessed")first.support.requirements.splice(0);
  expect((getPlaceBuildStatus(f.world,f.registry)[0].support as any).requirements).toHaveLength(5);
});

test("unassessed assembly, empty transit support and missing mechanics remain distinct",()=>{
  const f=setup();materializePlaceBlueprint(f.world,f.spec);
  expect(getPlaceBuildStatus(f.world,f.registry)[0].support).toEqual({status:"unassessed"});
  const transit:RoomBlueprint={name:"Passage",description:"An empty passage",type:"room",components:[],contents:[],connectToRoomEids:[f.street],requiredSystems:["RouteLamp"]};
  const requirements=placeSupportRequirementsSchema.parse([{id:"path",kind:"connection",roomEid:f.street,description:"A passage"},{id:"lamp",kind:"system",name:"RouteLamp",description:"A working light"}]);
  materializePlaceBlueprint(f.world,transit,undefined,requirements);
  expect(getPlaceBuildStatus(f.world,f.registry)[1].support).toMatchObject({status:"unavailable",unmet:[{id:"lamp",reason:"system_unavailable"}]});
  registerSystem(f.registry,{name:"RouteLamp",description:"Host-installed fixture",pseudocode:"",frequency:1,active:true,lastRun:0,compiledFn:()=>{}});
  expect(getPlaceBuildStatus(f.world,f.registry)[1].support.status).toBe("available");
  // Active executable availability is not a behavioral test of its illumination.
  f.registry.systems.get("RouteLamp")!.consecutiveErrors=1;
  expect(getPlaceBuildStatus(f.world,f.registry)[1].support.status).toBe("unavailable");
});
