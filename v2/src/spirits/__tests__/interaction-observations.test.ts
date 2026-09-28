import { addComponent,removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs,createRoomEntity,createAgentEntity,createObjectEntity } from "../../ecs/prefabs";
import { Agent,Removed,WorkingMemoryIdentity } from "../../ecs/components";
import { setLocatedIn } from "../../ecs/location";
import { startCommittedEvents,stopCommittedEvents,getCommittedEvents } from "../../runtime/committed-events";
import { withSimulationTask } from "../../runtime/task-scope";
import { captureInteractionObservations,getInteractionObservations,recordUnavailableInteraction } from "../interaction-observations";

function setup() {
  const world=createArgosWorld("Scoped observations");initializePrefabs(world);startCommittedEvents(world);
  const room=createRoomEntity(world,{name:"Kitchen"}),other=createRoomEntity(world,{name:"Attic"});
  const actor=createAgentEntity(world,{name:"Mara",role:"keeper",systemPrompt:"Choose freely",roomId:room});
  return {world,room,other,actor};
}

test("a remote existing target is reported as an existing identity, not diagnosed as missing from the world",()=>{
  const f=setup(),target=createObjectEntity(f.world,{name:"Oil can",roomId:f.other});
  recordUnavailableInteraction(f.world,f.actor,"pickup","Oil can");
  const captured=captureInteractionObservations(f.world),record=captured.records[0];
  expect(record.matches).toEqual([expect.objectContaining({eid:target,kind:"object",roomId:f.other})]);
  const binding=captured.bind([record.ref])!; expect(binding.current()).toBe(true);
  setLocatedIn(f.world,target,f.room); expect(binding.current()).toBe(false);
  setLocatedIn(f.world,target,f.other);expect(binding.current()).toBe(false);
  recordUnavailableInteraction(f.world,f.actor,"pickup","Oil can");
  expect(getInteractionObservations(f.world).records[0].ref).not.toBe(record.ref);
});

test.each(["moved","inactive","removed","actor_identity","room_identity","source","appeared"])("captured failure authority rejects %s",boundary=>{
  const f=setup();recordUnavailableInteraction(f.world,f.actor,"use","Relay");
  const captured=captureInteractionObservations(f.world),binding=captured.bind([captured.records[0].ref])!;
  expect(binding.current()).toBe(true);
  if(boundary==="moved") setLocatedIn(f.world,f.actor,f.other);
  if(boundary==="inactive") Agent.active[f.actor]=false;
  if(boundary==="removed") addComponent(f.world,f.actor,Removed);
  if(boundary==="actor_identity") WorkingMemoryIdentity.id[f.actor]="another actor";
  if(boundary==="room_identity") WorkingMemoryIdentity.id[f.room]="another room";
  if(boundary==="source") {stopCommittedEvents(f.world);startCommittedEvents(f.world);}
  if(boundary==="appeared") createObjectEntity(f.world,{name:"Relay",roomId:f.room});
  expect(binding.current()).toBe(false);expect(getInteractionObservations(f.world).records).toEqual([]);
  if(boundary==="moved") {setLocatedIn(f.world,f.actor,f.room);expect(binding.current()).toBe(false);}
});

test("a repeating unchanged failure retains its reference without starving a delayed author",()=>{
  const f=setup();recordUnavailableInteraction(f.world,f.actor,"use","Relay");
  const a=captureInteractionObservations(f.world),binding=a.bind([a.records[0].ref])!;
  recordUnavailableInteraction(f.world,f.actor,"use","relay");
  const b=getInteractionObservations(f.world);
  expect(b.records).toHaveLength(1);expect(b.records[0]).toMatchObject({ref:a.records[0].ref,attempts:2});
  expect(a.records[0].attempts).toBe(1);expect(binding.current()).toBe(true);
  expect(captureInteractionObservations(createArgosWorld("Other")).bind([a.records[0].ref])).toBeUndefined();
  expect(a.bind(["interaction:invented"])).toBeUndefined();
});

test("bounded observation eviction revokes old receipts and reports omissions",()=>{
  const f=setup();recordUnavailableInteraction(f.world,f.actor,"use","First target");
  const a=captureInteractionObservations(f.world),binding=a.bind([a.records[0].ref])!;
  for(let i=0;i<64;i++)recordUnavailableInteraction(f.world,f.actor,"use",`Target ${i}`);
  expect(getInteractionObservations(f.world).records).toHaveLength(64);expect(getInteractionObservations(f.world).omitted).toBe(1);
  expect(binding.current()).toBe(false);
});

test("a too-wide target match is omitted explicitly rather than granting authority on an incomplete snapshot",()=>{
  const f=setup();for(let i=0;i<65;i++)createObjectEntity(f.world,{name:"Coin",roomId:f.room});
  recordUnavailableInteraction(f.world,f.actor,"take","Coin");
  expect(getInteractionObservations(f.world)).toEqual({records:[],omitted:1});
});

test("construction can fulfill a missing target after admission, but never outlive its actor/source basis",()=>{
  const f=setup();recordUnavailableInteraction(f.world,f.actor,"use","Relay");
  const a=captureInteractionObservations(f.world),binding=a.bind([a.records[0].ref])!;
  expect(binding.current()).toBe(true);
  const relay=createObjectEntity(f.world,{name:"Relay",roomId:f.room});
  expect(binding.current()).toBe(false);expect(binding.duringConstruction()).toBe(true);
  removeEntity(f.world,relay);expect(binding.current()).toBe(false);
  stopCommittedEvents(f.world);expect(binding.duringConstruction()).toBe(false);
});

test("cancellation revokes observations without appending raw command data to public events",async()=>{
  const f=setup(),controller=new AbortController();
  await withSimulationTask(controller.signal,async()=>{recordUnavailableInteraction(f.world,f.actor,"use","PRIVATE-TARGET");});
  expect(getInteractionObservations(f.world).records).toHaveLength(1);
  expect(JSON.stringify(getCommittedEvents(f.world))).not.toContain("PRIVATE-TARGET");
  controller.abort();expect(getInteractionObservations(f.world).records).toEqual([]);
});
