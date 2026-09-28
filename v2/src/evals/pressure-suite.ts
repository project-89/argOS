import assert from "node:assert/strict";
import {mkdir,writeFile,readFile} from "node:fs/promises";
import path from "node:path";
import {performance} from "node:perf_hooks";
import {addEntity,addComponent,removeEntity,entityExists,getAllEntities,hasComponent} from "bitecs";
import {createArgosWorld,type World} from "../ecs/world";
import {Name,Mind} from "../ecs/components";
import {initializeRegistry,getComponent} from "../ecs/component-registry";
import {createSystemRegistry,runSystems,consumeEvents} from "../ecs/dynamic-systems";
import {CodingDaemon} from "../engineering/coding-daemon";
import type {SystemBuilder} from "../engineering/builders";
import {writeFloodRelease,floodAcceptance,seededCells,cellEntity,referenceStep,type FloodCell} from "./flood-fixture";
import {npcContention} from "./npc-contention";

export type PressureResult={name:string;passed:boolean;elapsedMs:number;metrics:Record<string,unknown>;error?:string};
export type PressureOptions={directory:string;seeds:number[];entities:number;ticks:number};

export function materializeCell(world:World,cell:FloodCell):number {
  const id=addEntity(world);
  for(const [name,fields] of Object.entries(cellEntity(cell).components)) {
    const soa=getComponent(name);addComponent(world,id,soa);
    for(const [field,value] of Object.entries(fields))soa[field][id]=value;
  }
  return id;
}
export function readCell(id:number):FloodCell {
  const h=getComponent("Hydraulics"),r=getComponent("Corrosion"),c=getComponent("Circuit");
  return {water:h.water[id],capacity:h.capacity[id],inflow:h.inflow[id],drain:h.drain[id],rust:r.level[id],sealed:r.sealed[id],on:c.on[id],threshold:c.threshold[id]};
}
export function checkCell(actual:FloodCell,expected:FloodCell,label:string):void {
  for(const field of Object.keys(expected) as Array<keyof FloodCell>) {
    const a=actual[field],e=expected[field];
    if(typeof e==="number")assert(typeof a==="number"&&Number.isFinite(a)&&Math.abs(a-e)<1e-8,`${label}.${field}: expected ${e}, got ${a}`);
    else assert.equal(a,e,`${label}.${field}`);
  }
}
async function fixture(directory:string,builder:SystemBuilder=async({directory})=>writeFloodRelease(directory)) {
  const world=createArgosWorld("Pressure world");initializeRegistry(world);
  const registry=createSystemRegistry();
  const daemon=new CodingDaemon(world,registry,{directory},builder);
  try {
    await daemon.initialize();daemon.enqueue({source:"pressure-oracle",instruction:"Flood mechanics",acceptance:floodAcceptance});
    await daemon.pump();daemon.commitReady(0);
    assert.equal(daemon.getStatus().jobs[0].status,"active",daemon.getStatus().jobs[0].error);
    return {world,registry,daemon};
  } catch(error){await cleanup(daemon);throw error;}
}
async function cleanup(daemon:CodingDaemon){daemon.stop();await daemon.settle();await daemon.flush();}

export async function coupledOracle(directory:string,seed:number,entities:number,ticks:number):Promise<Record<string,unknown>> {
  const {world,registry,daemon}=await fixture(directory);
  try {
    let expected=seededCells(seed,entities);const ids=expected.map(c=>materializeCell(world,c));
    const actor=addEntity(world);addComponent(world,actor,Name);addComponent(world,actor,Mind);Name.value[actor]="Mara";Mind.mode[actor]="reflective";
    const mainThread:number[]=[];let checks=0;const commits:Record<string,number>={};
    for(let tick=1;tick<=ticks;tick++) {
      const deltaMs=[50,125,250,500][(tick+seed)%4];
      if(tick%11===0) {
        const index=(tick*7+seed)%entities;
        expected[index]={...expected[index],inflow:tick%22===0?0:4,sealed:!expected[index].sealed};
        getComponent("Hydraulics").inflow[ids[index]]=expected[index].inflow;
        getComponent("Corrosion").sealed[ids[index]]=expected[index].sealed;
      }
      expected=expected.map(c=>referenceStep(c,deltaMs));
      let started=performance.now();runSystems(world,registry,tick,deltaMs);let synchronous=performance.now()-started;
      // Perceptions, thoughts, and other unrelated entities are continuously born.
      const bystander=addEntity(world);addComponent(world,bystander,Name);Name.value[bystander]=`background-${tick}`;
      await daemon.settle();started=performance.now();daemon.commitReady(tick);synchronous+=performance.now()-started;mainThread.push(synchronous);
      removeEntity(world,bystander);
      for(let i=0;i<ids.length;i++){checkCell(readCell(ids[i]),expected[i],`seed=${seed} tick=${tick} cell=${i}`);checks+=8;}
      assert.equal(Mind.mode[actor],"reflective");assert.equal(Name.value[actor],"Mara");
      assert(!hasComponent(world,actor,getComponent("Corrosion")),"Bystander acquired a mechanic");
      assert.equal(daemon.getStatus().jobs[0].status,"active",daemon.getStatus().jobs[0].error);
      for(const event of consumeEvents(registry))if(event.type==="managed_system_changed")commits[event.data.system]=(commits[event.data.system]??0)+1;
    }
    const sorted=mainThread.sort((a,b)=>a-b);
    for(const metric of daemon.getStatus().runtime)assert.equal(metric.commits,ticks,`${metric.name} silently starved`);
    return {seed,entities,ticks,assertions:checks,changedInvocations:commits,runtime:daemon.getStatus().runtime,dispatchAndCommitP95Ms:sorted[Math.floor(sorted.length*0.95)],dispatchAndCommitMaxMs:sorted.at(-1),rssMb:process.memoryUsage().rss/1024/1024};
  } finally {await cleanup(daemon);}
}

async function interference(directory:string):Promise<Record<string,unknown>> {
  const {world,registry,daemon}=await fixture(directory);
  try {
    const initial={...seededCells(12,1)[0],water:10,inflow:2,drain:0,sealed:false};
    const id=materializeCell(world,initial);
    for(let tick=1;tick<=40;tick++) {
      runSystems(world,registry,tick,1000);
      const sentinel=tick%2===0?2:12;getComponent("Hydraulics").water[id]=sentinel;
      await daemon.settle();daemon.commitReady(tick);
      assert.equal(getComponent("Hydraulics").water[id],sentinel,"Worker overwrote an intervention");
      assert.equal(getComponent("Corrosion").level[id],initial.rust,"Stale dependent system committed");
    }
    runSystems(world,registry,41,1000);removeEntity(world,id);
    await daemon.settle();daemon.commitReady(41);assert(!entityExists(world,id),"Deleted object resurrected");
    const replacement=materializeCell(world,{...initial,water:3});
    runSystems(world,registry,42,1000);await daemon.settle();daemon.commitReady(42);
    assert(entityExists(world,replacement));assert.equal(getAllEntities(world).length,1);
    assert.equal(daemon.getStatus().jobs[0].status,"active");
    return {interventions:40,deletedEntities:1,replacementWater:getComponent("Hydraulics").water[replacement],note:"Missed time accumulates; this test checks stale-write safety, not historical input integration."};
  } finally {await cleanup(daemon);}
}

async function mutationOverload(directory:string):Promise<Record<string,unknown>> {
  const {world,registry,daemon}=await fixture(directory);
  try {
    const cells=seededCells(13,2001).map(c=>({...c,inflow:2,drain:0}));const ids=cells.map(c=>materializeCell(world,c));
    runSystems(world,registry,1,50);await daemon.settle();daemon.commitReady(1);
    assert.equal(daemon.getStatus().jobs[0].status,"rolled_back","Over-budget release was not isolated");
    for(let i=0;i<ids.length;i++)assert.equal(getComponent("Hydraulics").water[ids[i]],cells[i].water,"Partial over-budget writes escaped");
    let ticks=0;for(let t=2;t<=101;t++){runSystems(world,registry,t,50);ticks++;}
    return {entities:ids.length,hostTicksAfterFailure:ticks,error:daemon.getStatus().jobs[0].error};
  } finally {await cleanup(daemon);}
}

async function poisonedUpdate(directory:string):Promise<Record<string,unknown>> {
  let tamper=false;
  const {registry,daemon}=await fixture(directory,async({directory})=>{
    await writeFloodRelease(directory);if(!tamper)return;
    // A candidate passes its own altered examples but violates host acceptance.
    const file=path.join(directory,"systems/FloodStep.ts");const code=await readFile(file,"utf8");await writeFile(file,code.replace("net*ctx.deltaMs/1000","net*ctx.deltaMs/500"));
    const manifest=JSON.parse(await readFile(path.join(directory,"release.json"),"utf8"));manifest.tests[0].expect[0].equals=12;
    await writeFile(path.join(directory,"release.json"),JSON.stringify(manifest));
  });
  try {
    const original=registry.systems.get("FloodStep");
    tamper=true;daemon.enqueue({source:"God",instruction:"plausible but wrong physics",acceptance:floodAcceptance});await daemon.pump();daemon.commitReady(1);
    assert.equal(daemon.getStatus().jobs[1].status,"rejected");assert.match(daemon.getStatus().jobs[1].error??"",/expected 11/);
    assert.equal(registry.systems.get("FloodStep"),original);
    return {rejection:daemon.getStatus().jobs[1].error,previousImplementationPreserved:true};
  } finally {await cleanup(daemon);}
}

export async function queuePressure(directory:string):Promise<Record<string,unknown>> {
  const world=createArgosWorld("Queue pressure");initializeRegistry(world);const registry=createSystemRegistry();
  let hanging=true,ticks=0;const config={directory,timeoutMs:80,maxQueue:8};
  const daemon=new CodingDaemon(world,registry,config,async({directory,signal})=>{
    if(hanging)await new Promise<void>((_,reject)=>{
      const cancel=()=>reject(new Error("Injected builder timeout"));
      if(signal.aborted)cancel();else signal.addEventListener("abort",cancel,{once:true});
    });
    else await writeFloodRelease(directory);
  });
  const timer=setInterval(()=>{runSystems(world,registry,++ticks,5);daemon.commitReady(ticks);},5);
  try {
    await daemon.initialize();daemon.enqueue({source:"God",instruction:"hung engineering job"});await daemon.pump();
    // Deadline expiry rejects a candidate; explicit simulation stop cancels it.
    // Match the daemon's bounded-timeout contract without conflating the two.
    assert.equal(daemon.getStatus().jobs[0].status,"rejected");
    assert.match(daemon.getStatus().jobs[0].error ?? "", /timed out after 80ms/);
    assert(ticks>0,"Host stopped ticking during a hung job");
    hanging=false;config.timeoutMs=3000;
    daemon.enqueue({source:"God",instruction:"healthy recovery"});await daemon.pump();daemon.commitReady(++ticks);
    assert.equal(daemon.getStatus().jobs[1].status,"active",daemon.getStatus().jobs[1].error);
    let accepted=0,rejected=0;
    for(let i=0;i<40;i++)try{daemon.enqueue({source:"request storm",instruction:`proposal ${i}`});accepted++;}catch(error){assert.match(String(error),/queue is full/);rejected++;}
    assert.equal(accepted,8);assert.equal(rejected,32);
    return {timedOutJobs:1,recoveryActive:true,hostTicks:ticks,burstRequests:40,accepted,rejected};
  } finally {clearInterval(timer);await cleanup(daemon);}
}

export async function runPressureSuite(options:PressureOptions):Promise<PressureResult[]> {
  const results:PressureResult[]=[];
  const cases:Array<[string,(directory:string)=>Promise<Record<string,unknown>>]> = [
    ...options.seeds.map(seed=>[`coupled-oracle-seed-${seed}`,(dir:string)=>coupledOracle(dir,seed,options.entities,options.ticks)] as [string,(dir:string)=>Promise<Record<string,unknown>>]),
    ["mid-flight-interventions-and-removal",interference],
    ["mutation-overload-isolation",mutationOverload],
    ["independent-acceptance-rejects-wrong-physics",poisonedUpdate],
    ["twelve-npcs-contend-for-scarce-inventory",npcContention],
    ["builder-timeout-recovery-and-request-storm",queuePressure],
  ];
  for(const [name,run] of cases) {
    const started=performance.now();
    try {results.push({name,passed:true,elapsedMs:performance.now()-started,metrics:await run(path.join(options.directory,name))});results.at(-1)!.elapsedMs=performance.now()-started;}
    catch(error){results.push({name,passed:false,elapsedMs:performance.now()-started,metrics:{},error:String(error)});}
    await mkdir(options.directory,{recursive:true});await writeFile(path.join(options.directory,"results.json"),JSON.stringify({options,results},null,2));
    process.stdout.write(`${JSON.stringify({kind:"pressure-case",...results.at(-1)})}\n`);
  }
  return results;
}
