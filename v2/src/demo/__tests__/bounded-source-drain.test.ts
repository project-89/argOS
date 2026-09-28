import { jest } from "@jest/globals";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs,createAgentEntity,createRoomEntity } from "../../ecs/prefabs";
import { publishCommittedEvent,startCommittedEvents,stopCommittedEvents } from "../../runtime/committed-events";
import { advanceSimulationTimeline,clearSimulationTimeline,scheduleSimulationEvent } from "../../runtime/simulation-timeline";
import { attachBoundedSourceDrain,sourcePacketBoundary } from "../bounded-source-drain";
import { ApartmentSitcom } from "../apartment-sitcom";
import { SitcomDirector } from "../sitcom-director";
function fixture(){
  const world=createArgosWorld("Drain");initializePrefabs(world);startCommittedEvents(world);
  const room=createRoomEntity(world,{name:"Room"}),actor=createAgentEntity(world,{name:"Ada",role:"resident",systemPrompt:"Choose freely",roomId:room});
  const emit=(executionId:string,status:"pending"|"succeeded")=>publishCommittedEvent(world,{executionId,kind:"action",action:"interact",operation:"typing",actorId:actor,roomId:room,status});
  const advance=(ms:number)=>advanceSimulationTimeline(world,ms,{integrate:()=>{}});
  const seal=jest.fn(()=>{clearSimulationTimeline(world);stopCommittedEvents(world);});
  return {world,emit,advance,seal};
}
test("quiet end seals exactly at a native packet boundary without a synthetic hold",()=>{
  const f=fixture();attachBoundedSourceDrain(f.world,{nominalEndMs:120000,maxDrainMs:30000,onSeal:f.seal});
  f.advance(150000);expect(f.world.time.elapsed).toBe(120625);
  expect(f.seal).toHaveBeenCalledWith(expect.objectContaining({reason:"drained",unfinishedExecutionIds:[]}));
});
test("an already-started action may settle, while later actions cannot renew the shutdown cohort",()=>{
  const f=fixture();attachBoundedSourceDrain(f.world,{nominalEndMs:120000,maxDrainMs:30000,onSeal:f.seal});
  f.advance(118000);f.emit("reply","pending");
  scheduleSimulationEvent(f.world,{atSimMs:121000,run:()=>{f.emit("reply","succeeded");f.emit("later-work","pending");}});
  f.advance(32000);expect(f.world.time.elapsed).toBe(129125);
  expect(f.seal).toHaveBeenCalledWith(expect.objectContaining({reason:"drained",unfinishedExecutionIds:[]}));
});
test("a stuck action ends at the declared hard boundary and preserves failure evidence",()=>{
  const f=fixture();attachBoundedSourceDrain(f.world,{nominalEndMs:120000,maxDrainMs:30000,onSeal:f.seal});
  f.emit("stuck","pending");f.advance(160000);
  expect(f.world.time.elapsed).toBe(146125);
  expect(f.seal).toHaveBeenCalledWith(expect.objectContaining({reason:"drain_limit",unfinishedExecutionIds:["stuck"]}));
});
test("cancelled/changed sources cannot invoke a late seal callback",()=>{
  const f=fixture();const cancel=attachBoundedSourceDrain(f.world,{nominalEndMs:120000,maxDrainMs:30000,onSeal:f.seal});
  cancel();f.advance(150000);expect(f.seal).not.toHaveBeenCalled();
  const g=fixture();attachBoundedSourceDrain(g.world,{nominalEndMs:120000,maxDrainMs:30000,onSeal:g.seal});
  stopCommittedEvents(g.world);startCommittedEvents(g.world);g.advance(150000);expect(g.seal).not.toHaveBeenCalled();
});
test("invalid bounds never silently extend a spending budget",()=>{
  expect(sourcePacketBoundary(120000,"up")).toBe(120625);
  expect(sourcePacketBoundary(150000,"down")).toBe(146125);
  const f=fixture();expect(()=>attachBoundedSourceDrain(f.world,{nominalEndMs:120000,maxDrainMs:0,onSeal:f.seal})).toThrow();
  expect(()=>sourcePacketBoundary(NaN,"up")).toThrow();
});
test("late native phone read and completed reply remain in a complete unit-rate final packet",async()=>{
  const fetch=jest.spyOn(globalThis,"fetch").mockRejectedValue(new Error("Offline only"));
  const t=await ApartmentSitcom.create({live:false,outsideTextAtMs:null});
  const director=new SitcomDirector(t,{scheduling:"realtime",promptStyle:"direct"});
  try{
    attachBoundedSourceDrain(t.sim.world,{nominalEndMs:120000,maxDrainMs:30000,onSeal:()=>t.stop()});
    await t.start();t.text("PRIVATE DINNER MESSAGE");t.advance(107000);
    t.dispatch("Elaine",{type:"move",target:"Kitchen"});t.advance(3000);
    t.dispatch("Elaine",{type:"pickup",target:"Elaine's phone"});t.advance(4500);
    t.dispatch("Elaine",{type:"interact",target:"Elaine's phone",content:"read_phone"});t.advance(3500);
    const message=t.snapshot().phone.find(m=>m.direction==="in")!;
    t.dispatch("Elaine",{type:"interact",target:"Elaine's phone",content:`reply ${JSON.stringify({replyTo:message.id,text:"Great, eight works. See you then!"})}`});
    t.advance(32000);
    expect(t.elapsedMs).toBe(129125);
    expect(t.snapshot().phone.some(m=>m.direction==="out"&&m.status==="delivered")).toBe(true);
    const scripts=[];let version=0;
    for(let i=0;i<20;i++){const next=director.next(version);if("segment"in next){scripts.push(next.segment.script);version=next.segment.version;}else{expect(next).toMatchObject({ended:true});expect("unfilmedTail"in next).toBe(false);break;}}
    expect(scripts.at(-1)?.sourceEndSimMs).toBe(129125);
    expect(scripts.every(s=>s.sourceEndSimMs-s.sourceStartSimMs===s.performance.durationMs)).toBe(true);
    expect(scripts.some(s=>s.prompt.includes("reads")&&s.beats.some(b=>b.operation==="reading"))).toBe(true);
    expect(scripts.some(s=>s.prompt.includes("types using"))).toBe(true);
    expect(scripts.map(s=>s.prompt).join("\n")).not.toContain("PRIVATE DINNER MESSAGE");
  }finally{director.stop();t.stop();expect(fetch).not.toHaveBeenCalled();fetch.mockRestore();}
});
