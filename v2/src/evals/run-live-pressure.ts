/** Two bounded engineering requests while the full library's deterministic NPC loop runs. */
import "dotenv/config";
import assert from "node:assert/strict";
import {mkdir,writeFile} from "node:fs/promises";
import path from "node:path";
import {format} from "node:util";
import {performance} from "node:perf_hooks";
import {createSimulation,type ArgosSimulation} from "../index";
import {getCodingDaemon} from "../engineering/coding-daemon";
import {createSystemRegistry,runSystems,consumeEvents} from "../ecs/dynamic-systems";
import {floodAcceptance,floodInstruction,seededCells,referenceStep} from "./flood-fixture";
import {materializeCell,readCell,checkCell} from "./pressure-suite";

const directory=path.resolve(`stress-test-output/live-pressure-${new Date().toISOString().replace(/[:.]/g,"-")}`);
await mkdir(directory,{recursive:true});
const original=console.log;const tail:string[]=[];
console.log=(...values:unknown[])=>{tail.push(format(...values));if(tail.length>300)tail.shift();};
const started=performance.now();const events:unknown[]=[];const gaps:number[]=[];
let sim:ArgosSimulation|undefined;let watchdog:ReturnType<typeof setInterval>|undefined;
let last=performance.now();
let result:Record<string,unknown>={passed:false,directory};
try {
  sim=await createSimulation({name:"Live flood pressure",preset:"minimal",enableAI:false,enableSpirits:false,evolution:false,enableNarrativeEngine:false,enableServer:false,
    dualLoop:true,ecsTickRate:20,ecsDeltaMs:50,codingDaemons:{backend:"gemini",directory:path.join(directory,"engineering"),timeoutMs:120000,pollMs:100},
    rooms:[{name:"Workshop"},{name:"Generator room"}],agents:[{name:"Mara",role:"keeper",startRoom:"Workshop"},{name:"Ivo",role:"electrician",startRoom:"Generator room"},{name:"Sera",role:"mechanic",startRoom:"Workshop"}]});
  const daemon=getCodingDaemon(sim.world)!;
  sim.onSystem(event=>{if(event.type==="system:build"){events.push({...event,tick:sim!.tick});process.stdout.write(`${JSON.stringify({kind:"live-build",...event,tick:sim!.tick})}\n`);}});
  watchdog=setInterval(()=>{const now=performance.now();gaps.push(now-last);last=now;},25);
  await sim.start();
  const first=sim.requestSystemBuild({source:"eval/Weaver",instruction:floodInstruction,acceptance:floodAcceptance});
  async function admitted(id:string):Promise<void> {
    const deadline=Date.now()+130000;
    while(Date.now()<deadline) {
      const job=sim!.getCodingStatus()!.jobs.find(j=>j.id===id)!;
      if(job.status==="active")return;
      if(["rejected","rolled_back","cancelled"].includes(job.status))throw Error(job.error??job.status);
      await new Promise<void>(resolve=>setTimeout(resolve,100));
    }
    throw Error("Live build deadline exceeded");
  }
  await admitted(first.id);
  const firstAdmittedTick=sim.tick;assert(firstAdmittedTick>10,"World did not tick during construction");
  const cells=seededCells(991,64);const ids=cells.map(c=>materializeCell(sim!.world,c));
  const beforeUpgrade=sim.tick;
  const acceptance=floodAcceptance.filter(t=>t.system==="CorrosionStep").map(t=>t.name.startsWith("wet unsealed")?{...t,expect:t.expect.map(a=>({...a,equals:1.5}))}:t);
  const second=sim.requestSystemBuild({source:"eval/Tinker",instruction:"Upgrade ONLY the existing managed CorrosionStep: corrosion increases by 0.5 per simulation second instead of 0.25. Preserve the water > 5 threshold, sealed immunity, cap of 100, and all other component fields and systems. No entity creation or attachment; only entities with existing Hydraulics and Corrosion participate. Include positive and boundary tests. Do not change FloodStep or CircuitStep.",acceptance});
  await admitted(second.id);
  assert(sim.tick>beforeUpgrade+10,"Simulation stalled during upgrade");
  const liveRuntime=sim.getCodingStatus()!.runtime;
  for(const name of ["FloodStep","CircuitStep"])assert((liveRuntime.find(m=>m.name===name)?.commits??0)>0,`${name} never made progress while a new version was built`);
  // Freeze the wall-clock scheduler, not the ECS state. Evaluate the actual accepted
  // implementations with a settled-step barrier against held-out inputs and a host oracle.
  sim.pause();await daemon.settle();daemon.commitReady(sim.tick+1);
  const managed=createSystemRegistry();
  for(const entry of sim.getCodingStatus()!.activeSystems)managed.systems.set(entry.name,sim.god.systemRegistry.systems.get(entry.name)!);
  let expected=ids.map(readCell);let assertions=0;
  for(let step=1;step<=80;step++) {
    const deltaMs=[50,250,1000,125][step%4];expected=expected.map(c=>referenceStep(c,deltaMs,0.5));
    runSystems(sim.world,managed,sim.tick+step+1,deltaMs);await daemon.settle();daemon.commitReady(sim.tick+step+1);
    for(let i=0;i<ids.length;i++){checkCell(readCell(ids[i]),expected[i],`live upgrade step=${step} cell=${i}`);assertions+=8;}
    consumeEvents(managed);
  }
  assert.equal(sim.getAgents().length,3);
  assert.equal(sim.getCodingStatus()!.jobs.find(j=>j.id===second.id)!.status,"active");
  const sorted=gaps.sort((a,b)=>a-b);
  result={passed:true,directory,backend:"gemini",buildRequests:2,firstAdmittedTick,ticksDuringUpgrade:sim.tick-beforeUpgrade,worldTicks:sim.tick,npcs:sim.getAgents().map(a=>a.name),cells:64,oracleSteps:80,oracleAssertions:assertions,
    watchdogMaxGapMs:sorted.at(-1),watchdogP95GapMs:sorted[Math.floor(sorted.length*0.95)],runtime:sim.getCodingStatus()!.runtime,elapsedMs:performance.now()-started,
    scope:"Real Gemini engineering + live deterministic NPC loop; scripted build requests, not autonomous God/spirit reasoning. No video generation."};
} catch(error) {result={...result,error:String(error),elapsedMs:performance.now()-started};process.exitCode=1;}
finally {
  if(watchdog)clearInterval(watchdog);
  sim?.stop();if(sim){await getCodingDaemon(sim.world)?.settle();await getCodingDaemon(sim.world)?.flush();}
  console.log=original;
  await writeFile(path.join(directory,"results.json"),JSON.stringify({result,events},null,2));await writeFile(path.join(directory,"runtime-tail.log"),tail.join("\n"));
  process.stdout.write(`${JSON.stringify({kind:"live-pressure-summary",...result})}\n`);
}
