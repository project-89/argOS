import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { addComponent, addEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { Name } from "../../ecs/components";
import { getComponent, initializeRegistry } from "../../ecs/component-registry";
import { createSystemRegistry, registerSystem, runSystems } from "../../ecs/dynamic-systems";
import { startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { withSimulationTask } from "../../runtime/task-scope";
import { CodingDaemon } from "../coding-daemon";

async function files(directory:string,variant="good") {
  await mkdir(path.join(directory,"systems"),{recursive:true});
  await mkdir(path.join(directory,"components"),{recursive:true});
  const name=variant==="target"?"OtherCounter":"RepairCounter";
  const fields:any={value:{type:"number",default:0}};
  if(variant==="schema")fields.extra={type:"number",default:0};
  const component={name:"RepairCount",description:"Public counter",fields};
  await writeFile(path.join(directory,"components/RepairCount.json"),JSON.stringify(component));
  await writeFile(path.join(directory,"systems/Counter.ts"),`export function run(ctx:any){for(const id of ctx.query("RepairCount")){ctx.set(id,"RepairCount","value",Math.min(100,ctx.get(id,"RepairCount","value")+1));${variant==="latent"?'if(ctx.get(id,"Name","value")==="inhabitant")ctx.set(id,"RepairCount","value","bad");':""}}}`);
  const systems=[{name,description:"Increment bounded counter",file:"systems/Counter.ts",frequency:variant==="frequency"?2:1,
    reads:["RepairCount","Name",...(variant==="private"?["NarrativeEntry"]:[])],
    writes:["RepairCount.value",...(variant==="write"?["Needs.hunger"]:[])]}];
  await writeFile(path.join(directory,"release.json"),JSON.stringify({version:1,components:["components/RepairCount.json"],systems,
    tests:[0,100].map(value=>({name:`Counter at ${value}`,system:name,entities:[{id:1,components:{RepairCount:{value},Name:{value:"fixture"}}}],
      ticks:1,deltaMs:1000,expect:[{entity:1,component:"RepairCount",field:"value",equals:Math.min(100,value+1)}]}))}));
}
async function setup() {
  const world=createArgosWorld("Repair admission");initializeRegistry(world);startCommittedEvents(world);
  const registry=createSystemRegistry(),directory=await mkdtemp(path.join(os.tmpdir(),"argos-repair-admission-"));
  let variant="good",builds=0;
  const daemon=new CodingDaemon(world,registry,{directory},async input=>{builds++;await files(input.directory,variant);});
  await daemon.initialize();daemon.enqueue({source:"host",instruction:"Increment bounded public counter"});await daemon.pump();daemon.commitReady(0);
  const actor=addEntity(world);addComponent(world,actor,Name);Name.value[actor]="inhabitant";
  addComponent(world,actor,getComponent("RepairCount"));getComponent("RepairCount").value[actor]=0;
  return {world,registry,daemon,actor,setVariant:(value:string)=>{variant=value;},builds:()=>builds,
    tick:async(n:number)=>{runSystems(world,registry,n,1000);await daemon.settle();daemon.commitReady(n);},
    close:async()=>{daemon.stop();await daemon.flush();}};
}
test.each(["target","schema","frequency","write","private"])("repair refuses changed %s contract before activation",async variant=>{
  const f=await setup();try {
    const original=f.registry.systems.get("RepairCounter");f.setVariant(variant);
    const job=f.daemon.requestRepair("RepairCounter","Fix counter");await f.daemon.pump();f.daemon.commitReady(1);
    expect(f.daemon.getRepairStatus(job.id)?.stage).toBe("rejected");
    expect(f.registry.systems.get("RepairCounter")).toBe(original);
    expect(getComponent("RepairCount").value[f.actor]).toBe(0);
    expect(getComponent("RepairCount").extra).toBeUndefined();
  }finally{await f.close();}
});
test.each(["source","cancel","replacement","code","stop","owner"])("ready repair is invalidated by %s",async change=>{
  const f=await setup(),abort=new AbortController();try {
    const job=await withSimulationTask(abort.signal,async()=>f.daemon.requestRepair("RepairCounter","Fix counter"));
    await f.daemon.pump();expect(f.daemon.getRepairStatus(job.id)?.stage).toBe("validated");
    const original=f.registry.systems.get("RepairCounter")!;
    if(change==="source"){stopCommittedEvents(f.world);startCommittedEvents(f.world);}
    if(change==="cancel")abort.abort();
    if(change==="replacement")registerSystem(f.registry,{...original});
    if(change==="code")original.code="changed after validation";
    if(change==="stop")f.daemon.stop();
    if(change==="owner")new CodingDaemon(f.world,createSystemRegistry(),{directory:f.daemon.directory+"-other"});
    f.daemon.commitReady(1);
    expect(["rejected","cancelled"]).toContain(f.daemon.getRepairStatus(job.id)?.stage);
    expect(getComponent("RepairCount").value[f.actor]).toBe(0);
  }finally{await f.close();}
});
test("validation is isolated; recovered requires a changed native commit; duplicate requests join",async()=>{
  const f=await setup();try {
    const job=f.daemon.requestRepair("RepairCounter","Fix counter");
    expect(f.daemon.requestRepair("RepairCounter","Same failure different prose").id).toBe(job.id);
    expect(f.daemon.getRepairStatus(job.id)?.stage).toBe("queued");
    await f.daemon.pump();expect(f.daemon.getRepairStatus(job.id)?.stage).toBe("validated");
    expect(getComponent("RepairCount").value[f.actor]).toBe(0);
    f.daemon.commitReady(1);expect(f.daemon.getRepairStatus(job.id)?.stage).toBe("activated");
    await f.tick(2);expect(getComponent("RepairCount").value[f.actor]).toBe(1);
    expect(f.daemon.getRepairStatus(job.id)?.stage).toBe("recovered");
    expect(()=>f.daemon.requestRepair("RepairCounter","Try again")).toThrow(/exhausted/);
  }finally{await f.close();}
});
test("native rollback repair retains errors, cannot overwrite new targets, and does not retry forever",async()=>{
  const f=await setup();try {
    f.setVariant("latent");f.daemon.enqueue({source:"host",instruction:"Latent faulty update"});await f.daemon.pump();f.daemon.commitReady(1);
    await f.tick(2);expect(f.registry.errors).toHaveLength(1);
    const repair=f.daemon.getStatus().jobs.find(job=>job.repairOfJobId)!;
    expect(f.daemon.requestRepair("RepairCounter","Repair fault").id).toBe(repair.id);
    await f.daemon.pump();f.daemon.commitReady(3);await f.tick(4);
    expect(f.daemon.getRepairStatus(repair.id)?.stage).toBe("rolled_back");
    expect(f.registry.errors).toHaveLength(2);
    expect(f.daemon.getStatus().jobs.filter(job=>job.repairOfJobId)).toHaveLength(1);
  }finally{await f.close();}
});
test("unmanaged systems are refused without changing code or running a builder",async()=>{
  const f=await setup();try {
    registerSystem(f.registry,{name:"Legacy",description:"",pseudocode:"",active:false,lastRun:0,frequency:0,code:"legacy",compiledFn:()=>{throw Error("must not run");}});
    expect(()=>f.daemon.requestRepair("Legacy","Fix")).toThrow(/unmanaged migration/);
    expect(f.builds()).toBe(1);expect(f.registry.systems.get("Legacy")?.code).toBe("legacy");
  }finally{await f.close();}
});
