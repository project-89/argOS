import { addComponent, getAllEntities, removeComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializeRegistry, registryCreateComponent } from "../../ecs/component-registry";
import { createRoomEntity, createAgentEntity, initializePrefabs } from "../../ecs/prefabs";
import { Goal, WikiDoc, WorkDocument } from "../../ecs/components";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { createIntentGoal, executeActions } from "../../cognition/cognition-system";
import { captureActorIntentionEvidence } from "../../spirits/actor-intention-evidence";
import { advanceSimulationTimeline } from "../../runtime/simulation-timeline";
import { startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { getRoomForEntity, setLocatedIn } from "../../ecs/location";
import { peekPendingStimuli } from "../../cognition/stimulus-queue";
import { materializePlaceBlueprint, getPlaceBuildStatus, type RoomBlueprint } from "../place-materialization";
import { getEntityAuthoringCatalog } from "../entity-authoring-catalog";

const worlds:ReturnType<typeof createArgosWorld>[]=[];
afterEach(()=>{for(const w of worlds.splice(0))stopCommittedEvents(w);});
function fixture() {
  const world=createArgosWorld("Authored data");worlds.push(world);initializeRegistry(world);initializePrefabs(world);startCommittedEvents(world);
  world.meta.aiEnabled=false;world.meta.timedActions=true;
  const street=createRoomEntity(world,{name:"Street"}),registry=createSystemRegistry();
  const actor=createAgentEntity(world,{name:"Ada",role:"visitor",systemPrompt:"Choose freely",roomId:street});
  const goal=createIntentGoal(world,actor,"Read the measurements and record the difference",7);
  const evidence=captureActorIntentionEvidence(world),ref=evidence.records.find(r=>r.kind==="goal")!.ref;
  const references=new Map([[ref,evidence.resolveActor(ref)!]]);
  const support:any=[{id:"visitor",kind:"existing_actor",intentionRef:ref,description:"The real visitor"},
    {id:"record",kind:"entity",entityType:"object",objectType:"object",description:"A physical record"},
    {id:"measurements",kind:"data",target:"record",component:"WikiDoc",fields:["body"],description:"Actual measurement values to read"},
    {id:"read",kind:"interaction",actor:"visitor",target:"record",affordance:"read_document",description:"The visitor can read the data"}];
  const body="At 21:00 the offset was 12 arcseconds. At 22:00 the offset was 17 arcseconds.";
  const spec:RoomBlueprint={name:"Observatory",description:"A room with recorded measurements",type:"room",components:[],existingActors:[{id:"visitor",intentionRef:ref}],
    contents:[{id:"record",entity:{name:"Observation log",type:"object",description:"A paper log with two entries",components:[
      {name:"ObjectType",values:{typeId:"object"}}, {name:"WikiDoc",values:{title:"Observation log",body,status:"draft"}},
      {name:"WorkDocument",values:{revision:0,reviewedRevision:-1,deviceKey:"",lastWriterKey:"",completedAtSimMs:-1}},
    ]}}],requiredInteractions:[{actor:"visitor",target:"record",affordance:"read_document"}]};
  const build=()=>materializePlaceBlueprint(world,spec,evidence.bind([ref]),support,references);
  return {world,registry,street,actor,goal,body,spec,support,build};
}

test("the author catalog exposes native document composition without claiming availability",()=>{
  fixture();const catalog:any=getEntityAuthoringCatalog();
  expect(catalog.nativeCapabilities).toEqual(expect.arrayContaining([expect.objectContaining({id:"in_world_document",interactions:expect.arrayContaining(["read_document","write_document"])} )]));
});

test("a data-bearing generated place feeds actual timed reading and writing, not automatic knowledge or goals",()=>{
  const f=fixture(),before=getAllEntities(f.world).length,{roomEid}=f.build();
  const status=()=>getPlaceBuildStatus(f.world,f.registry)[0],record=status().members.find(m=>m.id==="record")!.eid;
  expect(getAllEntities(f.world)).toHaveLength(before+2);expect(WikiDoc.body[record]).toBe(f.body);
  expect(status().support.status).toBe("awaiting_presence");expect(getRoomForEntity(f.world,f.actor)).toBe(f.street);
  expect(JSON.stringify(peekPendingStimuli(f.actor,f.world))).not.toContain(f.body);
  setLocatedIn(f.world,f.actor,roomEid);expect(status().support.status).toBe("available");
  const act=(content:string)=>executeActions(f.world,[{eid:f.actor,action:{type:"interact",target:"Observation log",content}}],f.registry);
  const advance=(ms:number)=>advanceSimulationTimeline(f.world,ms,{integrate:()=>{}});
  act("read_document");advance(1199);expect(JSON.stringify(peekPendingStimuli(f.actor,f.world))).not.toContain(f.body);
  advance(1);expect(JSON.stringify(peekPendingStimuli(f.actor,f.world))).toContain(f.body);
  act('write_document {"revision":0,"text":"The difference is 5 arcseconds."}');advance(2000);
  expect(WikiDoc.body[record]).toContain("The difference is 5 arcseconds.");expect(WorkDocument.revision[record]).toBe(1);
  expect(Goal.progress[f.goal]).toBe(0);expect(status().support.status).toBe("available");
  WikiDoc.body[record]="";expect(status().support).toMatchObject({status:"unavailable",unmet:expect.arrayContaining([{id:"measurements",reason:"data_unavailable"}])});
});

test.each(["missing_component","missing_field","blank","wrong_type","unknown_field","unknown_component","private_component","existing_actor","new_actor","duplicate_fields","reserved_field","unknown_property","too_many_fields"])(
  "data support rejects %s before construction",boundary=>{
    const f=fixture(),data=f.support.find((r:any)=>r.kind==="data"),doc=f.spec.contents[0].entity;
    if(boundary==="missing_component")doc.components=doc.components.filter(c=>c.name!=="WikiDoc");
    if(boundary==="missing_field")delete doc.components.find(c=>c.name==="WikiDoc")!.values.body;
    if(boundary==="blank")doc.components.find(c=>c.name==="WikiDoc")!.values.body="  ";
    if(boundary==="wrong_type")doc.components.find(c=>c.name==="WikiDoc")!.values.body=12;
    if(boundary==="unknown_field")data.fields=["measurement"];
    if(boundary==="unknown_component")data.component="InventedRecord";
    if(boundary==="private_component")data.component="Memory";
    if(boundary==="existing_actor")data.target="visitor";
    if(boundary==="new_actor"){f.support[1].entityType="agent";delete f.support[1].objectType;}
    if(boundary==="duplicate_fields")data.fields=["body","body"];
    if(boundary==="reserved_field")data.fields=["__proto__"];
    if(boundary==="unknown_property")data.completeGoal=true;
    if(boundary==="too_many_fields")data.fields=Array.from({length:17},(_,i)=>`field${i}`);
    const count=getAllEntities(f.world).length;expect(f.build).toThrow();expect(getAllEntities(f.world)).toHaveLength(count);
    expect(getPlaceBuildStatus(f.world,f.registry)).toEqual([]);
  });

test("data status follows native presence and values without exposing the record or recreating it",()=>{
  const f=fixture();f.build();const status=()=>getPlaceBuildStatus(f.world,f.registry)[0],record=status().members.find(m=>m.id==="record")!.eid;
  expect(JSON.stringify(status())).not.toContain(f.body);
  removeComponent(f.world,record,WikiDoc);expect(status().support.status).toBe("unavailable");
  addComponent(f.world,record,WikiDoc);WikiDoc.body[record]="A later real observation";
  expect(status().support.status).toBe("awaiting_presence");
  (WikiDoc.body as any)[record]=NaN;expect(status().support.status).toBe("unavailable");
});

test("finite zero and false are meaningful scalar data; missing or nonfinite values are not",()=>{
  const f=fixture();registryCreateComponent({name:"SurveySample",description:"Actual values",properties:{offset:"number",confirmed:"boolean"}});
  f.spec.contents[0].entity.components.push({name:"SurveySample",values:{offset:0,confirmed:false}});
  f.support.push({id:"sample",kind:"data",target:"record",component:"SurveySample",fields:["offset","confirmed"],description:"The recorded sample"});
  f.build();expect(getPlaceBuildStatus(f.world,f.registry)[0].support.status).toBe("awaiting_presence");
});

test("native composition metadata is detached and gives newly authored drafts the same initial lifecycle",()=>{
  const f=fixture(),catalog=getEntityAuthoringCatalog();
  const capability=catalog.nativeCapabilities.find(c=>c.id==="in_world_document")!;
  const work=capability.components.find(c=>c.name==="WorkDocument")!;
  expect(work.initialValues).toMatchObject({revision:0,reviewedRevision:-1,deviceKey:"",lastWriterKey:"",completedAtSimMs:-1});
  (work.initialValues as any).reviewedRevision=100;capability.interactions.splice(0);
  const next=getEntityAuthoringCatalog().nativeCapabilities[0];expect(next.interactions).toContain("read_document");
  expect(next.components.find(c=>c.name==="WorkDocument")!.initialValues).toMatchObject({reviewedRevision:-1});
  f.build();const doc=getPlaceBuildStatus(f.world,f.registry)[0].members.find(m=>m.id==="record")!.eid;
  expect(WorkDocument.reviewedRevision[doc]).toBe(-1);
});

test("the actual live CSV-trait design rejects before it can poison world ticks",()=>{
  const f=fixture();f.spec.contents[0].entity.components.push({name:"Traits",values:{active:"readable,examinable"}});
  const count=getAllEntities(f.world).length;
  expect(f.build).toThrow(/Traits.active/);expect(getAllEntities(f.world)).toHaveLength(count);
});
