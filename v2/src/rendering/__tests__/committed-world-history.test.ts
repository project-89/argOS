import { CommittedSceneHistory } from "../committed-scene-history";
import { SitcomScreenwriter } from "../../demo/sitcom-screenplay";
import { projectCommittedSceneWindow } from "../committed-scene-renderer";
import type { SceneSnapshot, SceneEvent } from "../scene-director";

function room(ms:number,id=1):SceneSnapshot {
  const actor=id+10,name=id===1?"Mara":"Nora";
  return {sourceId:"growth",sourceTick:ms,elapsedMs:ms,capturedWallMs:ms,room:{id,identityKey:`room:${id}`,name:`Room ${id}`,description:`Recorded room ${id}`},
    actors:[{id:actor,identityKey:`actor:${actor}`,name,roomId:id,appearance:{eid:actor,name,identity:{description:"An adult",age:"adult",height:"",build:"",hairColor:"",hairStyle:"",eyeColor:"",skinTone:"",distinguishing:""},
      clothing:"blue overalls",accessories:"",wornGarments:[],expression:"neutral",posture:"standing",condition:"",visiblyHolding:"",possessedItems:[],heldItems:[],description:"An adult in overalls"}}],props:[],events:[]};
}
const event=(sequence:number,ms:number,extra:Partial<SceneEvent>={}):SceneEvent=>({id:`event:${sequence}`,sequence,sourceTick:ms,elapsedMs:ms,
  roomId:2,roomKey:"room:2",actorId:12,actorKey:"actor:12",kind:"speech",action:"speak",status:"succeeded",text:"It is ready.",...extra});
function world(h:CommittedSceneHistory,start=0,end=8000){const result=h.assembleWorld(start,end);expect(result.status).toBe("ready");if(result.status!=="ready")throw new Error("Expected world history");return result.window;}

test("lazy room identity in a sparse same-time witness preserves unmentioned occupants",()=>{
  const h=new CommittedSceneHistory(),source=room(0);
  const extra={...source.actors[0],id:99,name:"Observer",identityKey:"actor:99",appearance:{...source.actors[0].appearance,eid:99,name:"Observer"}};
  const initial={...source,room:{...source.room,identityKey:undefined},actors:[...source.actors,extra]};
  h.append({sequence:0,scenes:[initial]});
  h.append({sequence:1,scenes:[room(1000)],eventWitnesses:[{scene:room(0),event:event(1,0,{roomId:1,roomKey:"room:1",actorId:11,actorKey:"actor:11",kind:"action",action:"move",status:"pending",text:undefined,
    interval:{executionId:"first",startedAtSimMs:0,expectedEndSimMs:1000}})}]});
  const observed=world(h,0,1000);
  expect(observed.states[0].scenes[0].actors.map(a=>a.id)).toContain(99);
  expect(observed.states[0].scenes[0].room.identityKey).toBe("room:1");
});

test("world history preserves room birth, absence and dialogue while single-room history remains strict",()=>{
  const h=new CommittedSceneHistory();h.append({sequence:0,scenes:[room(0)]});
  h.append({sequence:1,scenes:[room(3000),room(3000,2)]});
  h.append({sequence:2,scenes:[room(4000),{...room(4000,2),events:[event(1,4000,{interval:{executionId:"arrival-voice",startedAtSimMs:3000,completedAtSimMs:4000}})]}]});
  h.append({sequence:3,scenes:[room(6000)]});h.append({sequence:4,scenes:[room(8000)]});
  expect(h.assemble(0,8000,2).status).toBe("room_unavailable");
  const observed=world(h);
  expect(observed.states[0].scenes.map(s=>s.room.id)).toEqual([1]);
  expect(observed.states.find(s=>s.atSimMs===3000)!.scenes.map(s=>s.room.id)).toEqual([1,2]);
  expect(observed.states.find(s=>s.atSimMs===6000)!.scenes.map(s=>s.room.id)).toEqual([1]);
  expect(observed.rooms.find(w=>w.roomId===2)!.events.map(e=>e.event.text)).toEqual(["It is ready."]);
  const script=new SitcomScreenwriter().compileWorld(observed,[],1,{allowShortEstablishing:true}).script;
  expect(script.prompt).not.toContain('SET "Room 2":');
  expect(script.beats.find(b=>b.direction.includes('SET "Room 2" comes into view'))?.atSimMs).toBe(3000);
  expect(script.beats.find(b=>b.direction.includes('SET "Room 2" is no longer'))?.atSimMs).toBe(6000);
  expect(script.beats.filter(b=>b.kind==="speech").map(b=>b.text)).toEqual(["It is ready."]);
});

test("a new room's public event witness precedes its next complete capture without rewriting the baseline",()=>{
  const h=new CommittedSceneHistory();h.append({sequence:0,scenes:[room(0)]});
  const witness:any=room(3500,2);witness.actors[0].thought="PRIVATE_NEW_THOUGHT";witness.actors[0].appearance.possessedItems=[{eid:99,name:"HIDDEN_KEY"}];
  h.append({sequence:1,scenes:[room(4000),room(4000,2)],eventWitnesses:[{event:event(1,3500,{kind:"action",status:"pending",text:undefined,
    interval:{executionId:"new-voice",startedAtSimMs:3500,expectedEndSimMs:4500}}),scene:witness}]});
  h.append({sequence:2,scenes:[room(4500),{...room(4500,2),events:[event(2,4500,{interval:{executionId:"new-voice",startedAtSimMs:3500,completedAtSimMs:4500}})]}]});
  h.append({sequence:3,scenes:[room(8000),room(8000,2)]});
  const observed=world(h),local=observed.rooms.find(w=>w.roomId===2)!;
  expect(observed.states[0].scenes.map(s=>s.room.id)).toEqual([1]);
  expect(observed.states.find(s=>s.atSimMs===3500)!.scenes.map(s=>s.room.id)).toEqual([1,2]);
  expect(local.actions[0]).toMatchObject({startedAtSimMs:3500,visibleStartSimMs:3500,visibleEndSimMs:4500});
  expect(JSON.stringify(observed)).not.toContain("PRIVATE_NEW_THOUGHT");expect(JSON.stringify(observed)).not.toContain("HIDDEN_KEY");
  const restored=CommittedSceneHistory.restore(h.checkpoint());
  expect(restored.assembleWorld(0,7000)).toEqual(h.assembleWorld(0,7000));
  expect(Object.isFrozen(observed.states[1].scenes)).toBe(true);
});

test("a room arriving exactly at a live closing boundary is introduced only in the following packet",()=>{
  const h=new CommittedSceneHistory();h.append({sequence:0,scenes:[room(0)]});h.append({sequence:1,scenes:[room(8000),room(8000,2)]});
  h.append({sequence:2,scenes:[room(16000),room(16000,2)]});
  const writer=new SitcomScreenwriter(),first=writer.compileWorld(world(h),[],1,{allowShortEstablishing:true});
  expect(first.script.prompt).not.toContain("Room 2");expect(first.script.prompt).not.toContain("Nora");first.commit();
  const second=writer.compileWorld(world(h,8000,16000),[],2,{allowShortEstablishing:true}).script;
  expect(second.beats.find(b=>b.direction.includes('SET "Room 2" comes into view'))?.atSimMs).toBe(8000);
});

test("reused room identity is explicit unavailability, never a relabelled old scene",()=>{
  const h=new CommittedSceneHistory();h.append({sequence:0,scenes:[room(0),room(0,2)]});
  h.append({sequence:1,scenes:[room(4000),{...room(4000,2),room:{...room(4000,2).room,identityKey:"replacement",name:"Different place"}}]});
  h.append({sequence:2,scenes:[room(8000)]});
  expect(h.assembleWorld(0,8000).status).toBe("room_unavailable");
});

test("world histories retain the same buffering, expiry and source-stop boundaries",()=>{
  const h=new CommittedSceneHistory({maxCaptures:2});h.append({sequence:0,scenes:[room(0)]});
  expect(h.assembleWorld(0,1000).status).toBe("buffering");h.append({sequence:1,scenes:[room(1000)]});h.append({sequence:2,scenes:[room(2000)]});
  expect(h.assembleWorld(0,2000).status).toBe("expired");h.stop();expect(h.assembleWorld(1000,3000).status).toBe("ended");
  expect(()=>h.assembleWorld(2000,1000)).toThrow(/positive/);
});

test("sparse event witnesses update known subjects without erasing their unmentioned neighbors",()=>{
  const h=new CommittedSceneHistory(),base=room(0),neighbor={...base.actors[0],id:30,identityKey:"neighbor",name:"Ivo",appearance:{...base.actors[0].appearance,eid:30,name:"Ivo"}};
  const initial={...base,actors:[...base.actors,neighbor]};h.append({sequence:0,scenes:[initial]});
  const witnessBase=room(3000),witness={...witnessBase,actors:[{...witnessBase.actors[0],appearance:{...witnessBase.actors[0].appearance,clothing:"new coat"}}]};
  h.append({sequence:1,scenes:[{...room(4000),actors:initial.actors}],eventWitnesses:[{scene:witness,
    event:event(1,3000,{roomId:1,roomKey:"room:1",actorId:11,actorKey:"actor:11",kind:"action",text:undefined})}]});
  h.append({sequence:2,scenes:[room(8000)]});
  const observed=world(h).states.find(s=>s.atSimMs===3000)!.scenes[0];
  expect(observed.actors.map(a=>a.name).sort()).toEqual(["Ivo","Mara"]);
  expect(observed.actors.find(a=>a.name==="Mara")!.appearance.clothing).toBe("new coat");
});

test("a replacement first witnessed at the playhead does not inherit occupants of the old room lifetime",()=>{
  const h=new CommittedSceneHistory();h.append({sequence:0,scenes:[room(0)]});h.append({sequence:1,scenes:[room(4000)]});
  const base=room(4000,2),next={...base,room:{id:1,identityKey:"new-room",name:"New place",description:"New room"},actors:base.actors.map(a=>({...a,roomId:1}))};
  h.append({sequence:2,scenes:[{...next,sourceTick:5000,elapsedMs:5000}],eventWitnesses:[{scene:next,
    event:event(1,4000,{roomId:1,roomKey:"new-room",kind:"action",text:undefined})}]});
  h.append({sequence:3,scenes:[{...next,sourceTick:8000,elapsedMs:8000}]});
  expect(world(h,4000,8000).states[0].scenes[0].actors.map(a=>a.name)).toEqual(["Nora"]);
  expect(h.assembleWorld(0,8000).status).toBe("room_unavailable");
});

test("a transient room event at the playhead cannot be silently dropped from a successful world window",()=>{
  const h=new CommittedSceneHistory();h.append({sequence:0,scenes:[room(0)]});
  h.append({sequence:1,scenes:[room(4000)],eventWitnesses:[{scene:room(4000,2),event:event(1,4000)}]});
  h.append({sequence:2,scenes:[room(8000)]});
  expect(h.assembleWorld(4000,8000).status).toBe("room_unavailable");
});

test("dialogue uses the room label observed at the utterance, not its old baseline name",()=>{
  const h=new CommittedSceneHistory();h.append({sequence:0,scenes:[room(0,2)]});
  const renamed=(ms:number)=>({...room(ms,2),room:{...room(ms,2).room,name:"Blue studio",description:"A newly blue wall"}});
  h.append({sequence:1,scenes:[renamed(2000)]});
  h.append({sequence:2,scenes:[{...renamed(4000),events:[event(1,4000,{interval:{executionId:"named-room-voice",startedAtSimMs:3000,completedAtSimMs:4000}})]}]});
  h.append({sequence:3,scenes:[renamed(8000)]});
  const script=new SitcomScreenwriter().compileWorld(world(h),[],1,{allowShortEstablishing:true}).script;
  expect(script.beats.find(b=>b.kind==="speech")!.direction).toContain('in "Blue studio"');
  expect(script.beats.find(b=>b.direction.includes('SET "Blue studio" has this updated'))?.atSimMs).toBe(2000);
});

test("world-room evidence cannot be fed to a continuous-room renderer, even through JSON",()=>{
  const h=new CommittedSceneHistory();h.append({sequence:0,scenes:[room(0)]});
  h.append({sequence:1,scenes:[room(3000),room(3000,2)]});h.append({sequence:2,scenes:[room(8000),room(8000,2)]});
  const partial=world(h).rooms.find(w=>w.roomId===2)!;
  // @ts-expect-error Partial world evidence is not a continuous-room window.
  expect(()=>projectCommittedSceneWindow(partial)).toThrow(/world presence/i);
  // @ts-expect-error The legacy multi-room compiler also requires continuous rooms.
  expect(()=>new SitcomScreenwriter().compile([partial],[],1)).toThrow(/compileWorld/);
  expect(()=>projectCommittedSceneWindow(JSON.parse(JSON.stringify(partial)))).toThrow(/world presence/i);
  const {coverage,...unmarked}=partial;
  expect(coverage).toBe("world_room");expect(()=>projectCommittedSceneWindow(unmarked)).toThrow(/baseline/);
});
