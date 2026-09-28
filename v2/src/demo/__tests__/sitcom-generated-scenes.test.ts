import { jest } from "@jest/globals";
import { ApartmentSitcom } from "../apartment-sitcom";
import { SitcomDirector, type SitcomRenderSegment } from "../sitcom-director";
import { materializePlaceBlueprint, getPlaceBuildStatus } from "../../engineering/place-materialization";
import { executeActions } from "../../cognition/cognition-system";
import { getCommittedEvents } from "../../runtime/committed-events";
import { drainPendingStimuli } from "../../cognition/stimulus-queue";
import { addComponent, hasComponent, Prefab } from "bitecs";
import { Agent, Appearance, GodAgent, Removed } from "../../ecs/components";
import { createAgentEntity, createObjectEntity } from "../../ecs/prefabs";
import { getRoomForEntity } from "../../ecs/location";

let t:ApartmentSitcom, d:SitcomDirector;
beforeEach(()=>{drainPendingStimuli();jest.spyOn(globalThis,"fetch").mockRejectedValue(new Error("Generated scene tests are offline"));});
afterEach(()=>{d?.stop();t?.stop();expect(globalThis.fetch).not.toHaveBeenCalled();jest.restoreAllMocks();drainPendingStimuli();});
async function fixture(scenario:"cookie"|"duet"="duet") {
  t=await ApartmentSitcom.create({live:false,scenario,outsideTextAtMs:null});
  d=new SitcomDirector(t,{scheduling:"performance"});await t.start();
}
function build() {
  const result=materializePlaceBlueprint(t.sim.world,{name:"Lantern Workshop",description:"An interior workshop with blue walls and a repair bench.",type:"room",components:[],
    ...(t.options.scenario==="duet"?{connectToRoomEids:[t.ids.living]}:{}),contents:[
    {id:"keeper",entity:{name:"Nora",description:"A keeper in blue overalls.",type:"agent",components:[{name:"Agent",values:{role:"keeper",systemPrompt:"PRIVATE_NEW_ACTOR_THOUGHTS"}},
      {name:"Appearance",values:{clothing:"blue overalls",hairStyle:"braid",expression:"attentive"}}]}}
  ]});
  const status=getPlaceBuildStatus(t.sim.world,t.sim.god.systemRegistry).find(s=>s.id===result.receiptId)!;
  return {room:result.roomEid,actor:status.members.find(m=>m.id==="keeper")!.eid};
}
function drain() {
  t.stop();const segments:SitcomRenderSegment[]=[];
  for(let i=0;i<50;i++) {
    const result=d.next(segments.at(-1)?.version);
    if("segment" in result){segments.push(result.segment);continue;}
    expect(result).toEqual({ended:true});return segments;
  }
  throw new Error("Generated-scene playback failed to finish");
}

test.each(["cookie","duet"] as const)("%s scene projection discovers native generated rooms and actors",async scenario=>{
  await fixture(scenario);t.advance(3000);const made=build();
  const scene=t.scenes().find(s=>s.room.id===made.room);
  expect(scene).toBeDefined();expect(scene!.actors.map(a=>a.id)).toContain(made.actor);
  expect(JSON.stringify(scene)).not.toContain("PRIVATE_NEW_ACTOR_THOUGHTS");
});

test("a generated NPC's native speech is filmed once, with no pre-birth room or cast in the opening",async()=>{
  await fixture();t.advance(11_000);const made=build();
  executeActions(t.sim.world,[{eid:made.actor,action:{type:"speak",content:"The repair is ready for you."}}],t.sim.god.systemRegistry);
  t.advance(15_000);
  const spoken=getCommittedEvents(t.sim.world).events.filter(e=>e.actorId===made.actor&&e.kind==="speech"&&e.status==="succeeded"&&e.text);
  expect(spoken.length).toBeGreaterThan(0);
  const segments=drain(),beats=segments.flatMap(s=>s.script.beats),prompt=segments.map(s=>s.prompt).join("\n");
  expect(segments[0].prompt).not.toContain("Lantern Workshop");expect(segments[0].prompt).not.toContain("Nora");
  expect(beats.filter(b=>b.kind==="speech"&&b.actorId===made.actor).map(b=>b.text)).toEqual(["The repair is ready for you."]);
  expect(prompt).toContain("blue walls");expect(prompt).toContain('"Nora"');expect(prompt).not.toContain("PRIVATE_NEW_ACTOR_THOUGHTS");
  expect(prompt).toContain("blue overalls");expect(prompt).toContain('shot of "Nora" speaking');
  const evidence=beats.filter(b=>b.kind==="speech"&&b.actorId===made.actor).flatMap(b=>b.evidence);
  expect(evidence).toEqual(spoken.map(e=>e.sequence));
  expect(d.status().reason).toBeNull();
});

test("new actors perform native physical actions in their new room and retain public visual state",async()=>{
  await fixture();t.advance(11_000);const made=build();
  const object=createObjectEntity(t.sim.world,{name:"Spare cog",description:"A brass cog",roomId:made.room,portable:true});
  executeActions(t.sim.world,[{eid:made.actor,action:{type:"pickup",target:"Spare cog"}}],t.sim.god.systemRegistry);
  t.advance(1000);expect(getRoomForEntity(t.sim.world,object)).toBe(made.room);
  const receipts=getCommittedEvents(t.sim.world).events.filter(e=>e.actorId===made.actor&&e.action==="pickup");
  expect(receipts.some(e=>e.status==="succeeded")).toBe(true);
  t.advance(15_000);const segments=drain(),beats=segments.flatMap(s=>s.script.beats);
  expect(beats.some(b=>b.actorId===made.actor&&b.operation==="pickup"&&(b.endSimMs??b.atSimMs)>b.atSimMs)).toBe(true);
  expect(segments.map(s=>s.prompt).join("\n")).toContain('shot of "Nora"');
  expect(hasComponent(t.sim.world,made.actor,Appearance)).toBe(true);
});

test("scene discovery excludes removed, inactive, prefab and God actors; later removal does not erase recorded speech",async()=>{
  await fixture();t.advance(11_000);const made=build();
  for(const kind of ["removed","inactive","prefab","god"]) {
    const actor=createAgentEntity(t.sim.world,{name:`Excluded ${kind}`,roomId:made.room,role:"fixture",systemPrompt:"PRIVATE"});
    if(kind==="inactive")Agent.active[actor]=false;
    else addComponent(t.sim.world,actor,kind==="removed"?Removed:kind==="prefab"?Prefab:GodAgent);
  }
  expect(t.scenes().find(s=>s.room.id===made.room)!.actors.map(a=>a.name)).toEqual(["Nora"]);
  executeActions(t.sim.world,[{eid:made.actor,action:{type:"speak",content:"The bench is over here."}}],t.sim.god.systemRegistry);
  t.advance(5000);addComponent(t.sim.world,made.actor,Removed);addComponent(t.sim.world,made.room,Removed);t.advance(10_000);
  expect(t.scenes().some(s=>s.room.id===made.room)).toBe(false);
  const segments=drain(),beats=segments.flatMap(s=>s.script.beats);
  expect(beats.filter(b=>b.kind==="speech"&&b.actorId===made.actor).map(b=>b.text)).toEqual(["The bench is over here."]);
  expect(beats.some(b=>b.direction.includes('SET "Lantern Workshop" is no longer'))).toBe(true);
});

test("native travel, phone vibrations and reading enter a generated room's film without disclosing the message",async()=>{
  await fixture();t.advance(11_000);const made=build();
  const move=(target:string)=>{t.dispatch("Elaine",{type:"move",target});t.advance(3000);};
  move("Kitchen");t.dispatch("Elaine",{type:"pickup",target:"Elaine's phone"});t.advance(800);
  move("Living Room");move("Lantern Workshop");
  expect(getRoomForEntity(t.sim.world,t.ids.Elaine)).toBe(made.room);
  t.text("PRIVATE_NEW_ROOM_MESSAGE");t.advance(200);
  t.dispatch("Elaine",{type:"interact",target:"Elaine's phone",content:"read_phone"});t.advance(1200);t.advance(15_000);
  const segments=drain(),beats=segments.flatMap(s=>s.script.beats),prompt=segments.map(s=>s.prompt).join("\n");
  expect(beats.some(b=>b.kind==="sound"&&b.roomId===made.room)).toBe(true);
  expect(beats.some(b=>b.operation==="reading"&&b.roomId===made.room&&(b.endSimMs??b.atSimMs)>b.atSimMs)).toBe(true);
  expect(prompt).toContain('"Elaine" enters "Lantern Workshop"');expect(prompt).toContain('phone vibration in "Lantern Workshop"');
  expect(prompt).not.toContain("PRIVATE_NEW_ROOM_MESSAGE");expect(prompt).not.toContain("PRIVATE_NEW_ACTOR_THOUGHTS");
});
