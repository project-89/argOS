import { getAllEntities, hasComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createRoomEntity, createAgentEntity } from "../../ecs/prefabs";
import { ObjectType, ObjectState, Traits, Surface, PhysicalObject, StimulusSource } from "../../ecs/components";
import { getRoomForEntity } from "../../ecs/location";
import { materializeApprovedEntity } from "../entity-materialization";
import { materializePlaceBlueprint, validateAuthoredEntityBlueprint } from "../place-materialization";
import { worldSchema } from "../../world/schema";
import { startCommittedEvents } from "../../runtime/committed-events";
import { getComponent, listNames } from "../../ecs/component-registry";
import { executeAffordance } from "../../world/effect-executor";
import { getAvailableAffordances } from "../../world/affordance-availability";
import { captureEntityMaterializationScope } from "../entity-materialization-scope";

function setup(){const world=createArgosWorld("Typed place props");initializePrefabs(world);startCommittedEvents(world);
  const room=createRoomEntity(world,{name:"Room"});return {world,room};}
const prop=(name:string,typeId:string)=>({name,description:"A physical prop.",type:"object" as const,
  components:[{name:"ObjectType",values:{typeId}}]});

test("a declared table type supplies its actual native surface and physical traits",()=>{
  const f=setup(),eid=materializeApprovedEntity(f.world,{...prop("Countertop","table"),roomEid:f.room});
  expect(ObjectType.typeId[eid]).toBe("table");expect(ObjectState.current[eid]).toBe("normal");
  expect(hasComponent(f.world,eid,Surface)).toBe(true);expect(Surface.capacity[eid]).toBeGreaterThan(0);
  expect(PhysicalObject.portable[eid]).toBe(false);expect(JSON.parse(Traits.active[eid])).toContain("surface");
  expect(getRoomForEntity(f.world,eid)).toBe(f.room);
});
test("a declared chair starts with its actual empty state and sit affordance traits",()=>{
  const f=setup(),eid=materializeApprovedEntity(f.world,{...prop("Visitor seat","chair"),roomEid:f.room});
  expect(ObjectState.current[eid]).toBe("empty");expect(JSON.parse(Traits.active[eid])).toContain("sittable");
  const actor=createAgentEntity(f.world,{name:"Visitor",roomId:f.room,role:"visitor",systemPrompt:"Choose freely"});
  expect(getAvailableAffordances(f.world,actor,eid).some(a=>a.name==="sit")).toBe(true);
  const result=executeAffordance("sit",{world:f.world,actorEid:actor,targetEid:eid,worldSchema,
    registry:{byName:new Map([["Visitor",actor],["Visitor seat",eid]]),byId:new Map([[actor,"Visitor"],[eid,"Visitor seat"]])}});
  expect(result.success).toBe(true);expect(ObjectState.current[eid]).toBe("occupied");
  expect(getAvailableAffordances(f.world,actor,eid).some(a=>a.name==="sit")).toBe(false);
});
test("an unknown declared type rejects a whole place before allocating its room",()=>{
  const f=setup(),before=[...getAllEntities(f.world)];
  expect(()=>materializePlaceBlueprint(f.world,{name:"Workshop",description:"A workshop.",type:"room",components:[],
    contents:[{id:"prop",entity:prop("Unbuilt apparatus","unknown_apparatus") }]})).toThrow(/type/i);
  expect([...getAllEntities(f.world)]).toEqual(before);
});

test("typed native components and explicit physical overrides survive compound assembly",()=>{
  const f=setup();
  const built=materializePlaceBlueprint(f.world,{name:"Study",description:"An actual computer.",type:"room",components:[],contents:[
    {id:"computer",entity:{...prop("Guest laptop","laptop"),components:[...prop("Guest laptop","laptop").components,
      {name:"PhysicalObject",values:{weight:2,material:"aluminum"}},{name:"Battery",values:{current:25}}]}}
  ]});
  const laptop=[...getAllEntities(f.world)].find(eid=>ObjectType.instanceName[eid]==="Guest laptop")!;
  expect(getRoomForEntity(f.world,laptop)).toBe(built.roomEid);
  expect(hasComponent(f.world,laptop,getComponent("Battery"))).toBe(true);
  expect(getComponent("Battery").current[laptop]).toBe(25);expect(getComponent("Battery").max[laptop]).toBe(100);
  expect(PhysicalObject.weight[laptop]).toBe(2);expect(PhysicalObject.material[laptop]).toBe("aluminum");
});

test.each(["state","identity","component","field","private"])("invalid typed %s rejects before allocation or schema registration",boundary=>{
  const f=setup(), before=[...getAllEntities(f.world)], registered=listNames();
  const extra=boundary==="state" ? {name:"ObjectState",values:{current:"imaginary"}}
    : boundary==="identity" ? {name:"ObjectType",values:{typeId:"laptop",instanceName:"Other"}}
    : boundary==="component" ? {name:"UnknownMechanic",values:{current:1}}
    : boundary==="private" ? {name:"Mind",values:{focus:"Private thoughts"}}
    : {name:"PhysicalObject",values:{nonexistent:1}};
  const base=prop("Guest laptop","laptop");
  expect(()=>materializeApprovedEntity(f.world,{...base,roomEid:f.room,
    components:boundary==="identity"?[extra]:[...base.components,extra]})).toThrow();
  expect([...getAllEntities(f.world)]).toEqual(before);expect(listNames()).toEqual(registered);
});

test("conflicting declared component schemas reject all place members before construction",()=>{
  const f=setup(),before=[...getAllEntities(f.world)],registered=listNames();
  for(const kind of ["number","string"] as const)worldSchema.defineObjectType({name:`meter_${kind}`,description:"A meter",traits:["examinable"],
    states:{normal:{description:"A meter"}},defaultState:"normal",defaultComponents:[{name:"MeterReading",dynamic:true,schema:{amount:kind},values:{amount:kind==="number"?1:"one"}}]});
  expect(()=>materializePlaceBlueprint(f.world,{name:"Meters",description:"Incompatible meters",type:"room",components:[],contents:[
    {id:"one",entity:prop("First meter","meter_number")},{id:"two",entity:prop("Second meter","meter_string")}
  ]})).toThrow(/Conflicting object component schema/);
  expect([...getAllEntities(f.world)]).toEqual(before);expect(listNames()).toEqual(registered);
});

test("custom types materialize their stimuli without mutating the observed type definition",()=>{
  const f=setup();worldSchema.defineObjectType({name:"ringing_instrument",description:"A ringing instrument",traits:["examinable"],
    states:{ringing:{description:"A resonant note rings.",stimuli:[],emitsStimulus:{type:"sound",intensity:0.8,radius:5}}},defaultState:"ringing"});
  const spec={...prop("Instrument","ringing_instrument"),roomEid:f.room};
  const current=captureEntityMaterializationScope(f.world,[f.room]).bind(spec);
  const before=JSON.stringify(worldSchema.getObjectType("ringing_instrument"));
  const eid=materializeApprovedEntity(f.world,spec);
  expect(hasComponent(f.world,eid,StimulusSource)).toBe(true);expect(StimulusSource.template[eid]).toBe("A resonant note rings.");
  expect(JSON.stringify(worldSchema.getObjectType("ringing_instrument"))).toBe(before);expect(current()).toBe(true);
});

test("fresh authors cannot hide an untyped prop in a manifest or infer physics from its name",()=>{
  setup();
  const namedTable={name:"Massive table",description:"A table",type:"object",components:[]};
  expect(()=>validateAuthoredEntityBlueprint({...namedTable,roomEid:1})).toThrow(/ObjectType/);
  expect(()=>validateAuthoredEntityBlueprint({name:"Hall",description:"A hall",type:"room",components:[],contents:[{id:"table",entity:namedTable}]})).toThrow(/ObjectType/);
  const generic={...prop("Massive table","object"),roomEid:1};
  expect(validateAuthoredEntityBlueprint(generic)).toEqual(generic);
});
