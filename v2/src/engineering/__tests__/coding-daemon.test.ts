import { describe, expect, test } from "@jest/globals";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { addEntity, addComponent, hasComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { Name, AffectState } from "../../ecs/components";
import { initializeRegistry, getComponent, getRegistryWorld } from "../../ecs/component-registry";
import { createSystemRegistry, runSystems, registerSystem } from "../../ecs/dynamic-systems";
import { CodingDaemon, type CodingDaemonConfig } from "../coding-daemon";
import { prepareRelease } from "../release";
import { serializeWorld, deserializeWorld } from "../../persistence/world-persistence";
import type { SystemBuilder } from "../builders";
import type { AcceptanceTest } from "../contracts";
import { PRIVATE_MANAGED_COMPONENTS, PROTECTED_MANAGED_COMPONENTS } from "../contracts";
import { createSpiritRegistry } from "../../spirits/spirit-registry";
import { createDynamicSpirit, submitProposal, resetFactoryState } from "../../spirits/spirit-factory";
import { executeAllApprovedProposals } from "../../spirits/architect-spirit";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { createIntentGoal } from "../../cognition/cognition-system";
import { captureActorIntentionEvidence } from "../../spirits/actor-intention-evidence";
import { startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { setWorldSpecification, getWorldAuthoringContext } from "../../world/world-specification";

const newerPrivateFields = [
  ["CommunicationMemory", "receiptsJson"], ["CoordinationReviewState", "reviewedJson"],
  ["OngoingActivity", "stateJson"], ["GoalWorkProgress", "contract"],
  ["GoalAttempt", "exhaustedMacrosJson"], ["WorkingMemoryIdentity", "id"],
] as const;

function acceptance(rate=1):AcceptanceTest[] {
  return [{name:"operator rust progression",system:"RustGrowth",entities:[{id:1,components:{Name:{value:"fixture"},Rust:{level:0}}}],ticks:2,deltaMs:1000,expect:[{entity:1,component:"Rust",field:"level",equals:rate*2}]}];
}
async function packageFiles(dir:string,rate=1,extra="",fields:Record<string,any>={level:{type:"number",default:0}}) {
  await mkdir(path.join(dir,"components"),{recursive:true});await mkdir(path.join(dir,"systems"),{recursive:true});
  await writeFile(path.join(dir,"components/Rust.json"),JSON.stringify({name:"Rust",description:"Surface corrosion",fields}));
  await writeFile(path.join(dir,"systems/RustGrowth.ts"),`export function run(ctx:any):void {for(const id of ctx.query("Name")){ctx.attach(id,"Rust");ctx.set(id,"Rust","level",Math.min(100,ctx.get(id,"Rust","level")+${rate}));${extra}}}`);
  await writeFile(path.join(dir,"release.json"),JSON.stringify({version:1,components:["components/Rust.json"],systems:[{name:"RustGrowth",description:"Advance corrosion",file:"systems/RustGrowth.ts",frequency:1,reads:["Name","Rust"],writes:Object.keys(fields).map(f=>`Rust.${f}`)}],
    tests:[...acceptance(rate),{name:"saturated surface stays bounded",system:"RustGrowth",entities:[{id:1,components:{Name:{value:"fixture"},Rust:{level:100}}}],ticks:1,deltaMs:1000,expect:[{entity:1,component:"Rust",field:"level",equals:100}]}]}));
}
async function ownershipPackage(dir:string,version:1|2) {
  await mkdir(path.join(dir,"components"),{recursive:true});await mkdir(path.join(dir,"systems"),{recursive:true});
  await writeFile(path.join(dir,"components/Transfer.json"),JSON.stringify({name:"Transfer",description:"Ownership transfer fixture",fields:{x:{type:"number",default:0},y:{type:"number",default:0}}}));
  const specs:any[]=[];const tests:any[]=[];
  const add=async(name:string,field:"x"|"y",rate:number)=>{
    await writeFile(path.join(dir,`systems/${name}.ts`),`export function run(ctx:any):void {for(const id of ctx.query("Name")){ctx.attach(id,"Transfer");ctx.set(id,"Transfer","${field}",Math.min(100,ctx.get(id,"Transfer","${field}")+${rate}));}}`);
    specs.push({name,description:`writes ${field}`,file:`systems/${name}.ts`,frequency:1,reads:["Name","Transfer"],writes:[`Transfer.${field}`]});
    tests.push(...[0,100].map(start=>({name:`${name} fixture ${start}`,system:name,entities:[{id:1,components:{Name:{value:"fixture"},Transfer:{x:field==="x"?start:0,y:field==="y"?start:0}}}],ticks:1,deltaMs:1000,
      expect:[{entity:1,component:"Transfer",field,equals:Math.min(100,start+rate)}]})));
  };
  if(version===1)await add("OwnerA","x",1);
  else {await add("OwnerA","y",1);await add("OwnerB","x",10);}
  await writeFile(path.join(dir,"release.json"),JSON.stringify({version:1,components:["components/Transfer.json"],systems:specs,tests}));
}
async function setup(builder:SystemBuilder,config:Partial<CodingDaemonConfig>={}) {
  const directory=await mkdtemp(path.join(os.tmpdir(),"argos-live-build-test-"));
  const world=createArgosWorld("LiveBuildTest");initializeRegistry(world);
  startCommittedEvents(world);
  const id=addEntity(world);addComponent(world,id,Name);Name.value[id]="inhabitant";
  const registry=createSystemRegistry();
  const daemon=new CodingDaemon(world,registry,{directory,...config},builder);await daemon.initialize();
  return {directory,world,id,registry,daemon};
}

describe("continuous coding daemon",()=>{
  test("fresh observations of one intention and exact contract share a pending build across supervisors",async()=>{
    let builds=0;
    const f=await setup(async({directory})=>{builds++;await packageFiles(directory);},{maxTotalJobs:1});
    initializePrefabs(f.world);startCommittedEvents(f.world);
    const room=createRoomEntity(f.world,{name:"Street"});
    const actor=createAgentEntity(f.world,{name:"Ada",role:"resident",systemPrompt:"Choose freely",roomId:room});
    createIntentGoal(f.world,actor,"PRIVATE_PURPOSE_FIND_SHELTER",7);
    const observe=(key:string)=>{
      const evidence=captureActorIntentionEvidence(f.world),record=evidence.records.find(row=>row.actor==="Ada" && row.kind==="goal")!;
      return {key,causalKeys:[record.causalKey],current:evidence.bind([record.ref])!};
    };
    const finished:string[]=[],request={source:"Architect",instruction:"Bounded corrosion",acceptance:acceptance()};
    try {
      const first=f.daemon.enqueue(request,j=>finished.push(`architect:${j.status}`),observe("first"));
      const second=f.daemon.enqueue({...request,source:"God"},j=>finished.push(`god:${j.status}`),observe("fresh"));
      expect(second.id).toBe(first.id);expect(f.daemon.getStatus().jobs).toHaveLength(1);
      expect(f.daemon.getStatus().admissionBudget.used).toBe(1);
      expect(JSON.stringify(f.daemon.getStatus().jobs)).not.toContain("PRIVATE_PURPOSE_FIND_SHELTER");
      await f.daemon.pump();expect(finished).toEqual([]);
      f.daemon.commitReady(1);
      expect(builds).toBe(1);expect(finished).toEqual(["architect:active","god:active"]);
    } finally {f.daemon.stop();await f.daemon.flush();}
  });

  test.each(["cause","instruction","acceptance","protection","simulation source"])("different %s remains separate causal work",async difference=>{
    const f=await setup(async()=>{});startCommittedEvents(f.world);
    const scope=(key:string,causalKeys=["intention:a"])=>({key,causalKeys,current:()=>true});
    const request={source:"Architect",instruction:"Bounded rust",acceptance:acceptance(),protectedConditions:["Preserve obstacles"]};
    try {
      const first=f.daemon.enqueue(request,undefined,scope("first"));
      const secondRequest={...request,source:"God"};
      if(difference==="instruction")secondRequest.instruction="A different mechanic";
      if(difference==="acceptance")secondRequest.acceptance=acceptance(2);
      if(difference==="protection")secondRequest.protectedConditions=["Preserve obstacles","No new routes"];
      if(difference==="simulation source") {stopCommittedEvents(f.world);startCommittedEvents(f.world);}
      const second=f.daemon.enqueue(secondRequest,undefined,scope("next",difference==="cause"?["intention:b"]:undefined));
      expect(second.id).not.toBe(first.id);expect(second.work?.key).not.toBe(first.work?.key);
    } finally {f.daemon.stop();await f.daemon.flush();}
  });

  test("causal work compares JSON contracts, not object insertion order or attribution",async()=>{
    const f=await setup(async()=>{});startCommittedEvents(f.world);
    const scope=(key:string,causalKeys:string[])=>({key,causalKeys,current:()=>true});
    try {
      const first=f.daemon.enqueue({source:"Architect",instruction:"Rust",acceptance:acceptance()},undefined,scope("first",["b","a"]));
      const second=f.daemon.enqueue({acceptance:acceptance().map(row=>Object.fromEntries(Object.entries(row).reverse())) as AcceptanceTest[],instruction:"Rust",source:"God"},
        undefined,scope("second",["a","b","a"]));
      expect(second.id).toBe(first.id);expect(second.work?.causalKeys).toEqual(["a","b"]);
    } finally {f.daemon.stop();await f.daemon.flush();}
  });

  test("joining cannot refresh the original approval before activation",async()=>{
    const f=await setup(async({directory})=>packageFiles(directory));startCommittedEvents(f.world);
    let current=true;const outcomes:string[]=[];
    try {
      const request={source:"Architect",instruction:"Rust"},causalKeys=["intention:a"];
      const first=f.daemon.enqueue(request,j=>outcomes.push(`first:${j.status}`),{key:"first",causalKeys,current:()=>current});
      const joined=f.daemon.enqueue({...request,source:"God"},j=>outcomes.push(`second:${j.status}`),{key:"second",causalKeys,current:()=>true});
      expect(joined.id).toBe(first.id);
      await f.daemon.pump();expect(f.daemon.getStatus().jobs[0].status).toBe("ready");
      current=false;f.daemon.commitReady(1);
      expect(outcomes).toEqual(["first:rejected","second:rejected"]);
      expect(f.registry.systems.has("RustGrowth")).toBe(false);
    } finally {f.daemon.stop();await f.daemon.flush();}
  });

  test("a fresh observation cannot join a pending job whose original approval is already stale",async()=>{
    const f=await setup(async()=>{});startCommittedEvents(f.world);let current=true;
    try {
      const request={source:"Architect",instruction:"Rust"},causalKeys=["intention:a"];
      const first=f.daemon.enqueue(request,undefined,{key:"first",causalKeys,current:()=>current});
      current=false;
      const next=f.daemon.enqueue(request,undefined,{key:"next",causalKeys,current:()=>true});
      expect(next.id).not.toBe(first.id);
      await f.daemon.pump();
      expect(f.daemon.getStatus().jobs.find(job=>job.id===first.id)?.status).toBe("cancelled");
      expect(f.daemon.getStatus().jobs.find(job=>job.id===next.id)?.status).toBe("queued");
    } finally {f.daemon.stop();await f.daemon.flush();}
  });

  test("model/file requests cannot inject host identity and completion subscriptions are bounded",async()=>{
    const f=await setup(async()=>{});startCommittedEvents(f.world);
    const request={source:"Architect",instruction:"Rust"},scope={key:"first",causalKeys:["intention:a"],current:()=>true};
    try {
      expect(()=>f.daemon.enqueue({...request,causalKeys:["intention:a"]} as any)).toThrow();
      expect(()=>f.daemon.enqueue(request,undefined,{...scope,causalKeys:[]})).toThrow(/causal identity/);
      const first=f.daemon.enqueue(request,()=>{},scope);
      for(let i=1;i<64;i++)expect(f.daemon.enqueue(request,()=>{},{...scope,key:`scope:${i}`}).id).toBe(first.id);
      expect(()=>f.daemon.enqueue(request,()=>{},{...scope,key:"overflow"})).toThrow(/observer limit/);
      expect(f.daemon.getStatus().jobs).toHaveLength(1);
    } finally {f.daemon.stop();await f.daemon.flush();}
  });

  test.each(["queued","building","activation"])("changed observed demand rejects at %s without materializing the release",async boundary=>{
    let current=true, calls=0;
    const f=await setup(async({directory})=>{calls++;await packageFiles(directory);if(boundary==="building")current=false;});
    try {
      const job=f.daemon.enqueue({source:"Architect",instruction:"An observed environmental need"},undefined,{key:"observation:test",current:()=>current});
      if(boundary==="queued")current=false;
      await f.daemon.pump();
      if(boundary==="activation") {expect(f.daemon.getStatus().jobs[0].status).toBe("ready");current=false;}
      f.daemon.commitReady(1);
      expect(f.daemon.getStatus().jobs.find(row=>row.id===job.id)?.status).toBe(boundary==="queued"?"cancelled":"rejected");
      expect(calls).toBe(boundary==="queued"?0:1);
      expect(f.registry.systems.has("RustGrowth")).toBe(false);expect(getComponent("Rust")).toBeUndefined();
    } finally {f.daemon.stop();await f.daemon.flush();}
  });

  test("scoped demand does not merge with an unscoped or differently scoped request",async()=>{
    const f=await setup(async({directory})=>{await packageFiles(directory);});
    try {
      const request={source:"Architect",instruction:"Same implementation, distinct authority"};
      const scope={key:"first",current:()=>true};
      const first=f.daemon.enqueue(request,undefined,scope);
      expect(f.daemon.enqueue(request,undefined,scope).id).toBe(first.id);
      expect(f.daemon.enqueue(request).id).not.toBe(first.id);
      expect(f.daemon.enqueue(request,undefined,{key:"second",current:()=>true}).id).not.toBe(first.id);
      expect(f.daemon.getStatus().jobs).toHaveLength(3);
    } finally {f.daemon.stop();await f.daemon.flush();}
  });

  test.each([false,true])("an interrupted observed build cannot restore its lost authority (causal identity: %s)",async causal=>{
    const f=await setup(async({directory})=>{await packageFiles(directory);});
    startCommittedEvents(f.world);
    const job=f.daemon.enqueue({source:"Architect",instruction:"Needs fresh observation on restore"},undefined,
      {key:"old-scope",current:()=>true,...(causal?{causalKeys:["intention:a"]}:{})});
    await f.daemon.flush(); // Preserve the queued crash receipt before graceful stop changes it.
    const receipt=await readFile(path.join(f.directory,"jobs",job.id,"host-job.json"),"utf8");
    expect(!!JSON.parse(receipt).work).toBe(causal);
    f.daemon.stop();await f.daemon.flush();
    await writeFile(path.join(f.directory,"jobs",job.id,"host-job.json"),receipt);
    const world=createArgosWorld("Restored observation"),registry=createSystemRegistry();initializeRegistry(world);
    let built=false;
    const restored=new CodingDaemon(world,registry,{directory:f.directory},async({directory})=>{built=true;await packageFiles(directory);});
    try {
      await restored.initialize();await restored.pump();restored.commitReady(1);
      expect(restored.getStatus().jobs.find(row=>row.id===job.id)).toMatchObject({status:"cancelled",error:expect.stringContaining("fresh authorization")});
      expect(built).toBe(false);expect(registry.systems.has("RustGrowth")).toBe(false);
    } finally {restored.stop();await restored.flush();}
  });

  test("environmental worker context contains public state, not private actor thoughts",async()=>{
    let captured:any;
    const {world,id,daemon}=await setup(async({directory,context})=>{captured=JSON.parse(context);await packageFiles(directory);});
    setWorldSpecification(world, { version: 1, setting: { name: "Salt harbor", genre: "mystery", premise: "A coastal settlement.", tone: "quiet unease" },
      story: { style: "grounded discovery" }, inhabitants: [{ name: "PRIVATE_UNCREATED_CHARACTER", role: "PRIVATE_AUTHOR_ROLE", systemPrompt: "PRIVATE_AUTHOR_HISTORY" }] });
    addComponent(world,id,AffectState);AffectState.reason[id]="PRIVATE_REASON_DO_NOT_EXPORT";
    for (const [name, field] of newerPrivateFields) {
      const component = getComponent(name); addComponent(world, id, component);
      component[field][id] = `PRIVATE_NEW_${name}_DO_NOT_EXPORT`;
    }
    try {daemon.enqueue({source:"operator",instruction:"Public rust mechanics"});await daemon.pump();
      expect(captured.worldAuthoringContext).toBe(getWorldAuthoringContext(world));
      expect(captured.worldAuthoringContext).toContain("grounded discovery");
      expect(JSON.stringify(captured)).not.toContain("PRIVATE_UNCREATED_CHARACTER");
      expect(JSON.stringify(captured)).not.toContain("PRIVATE_AUTHOR_HISTORY");
      expect(JSON.stringify(captured.world)).not.toContain("PRIVATE_REASON_DO_NOT_EXPORT");
      expect(captured.world.find((e:any)=>e.id===id).components.Name.value).toBe("inhabitant");
      expect(captured.managedCapabilities.privateUnreadableComponents).toContain("NarrativeEntry");
      for (const [name] of newerPrivateFields) {
        expect(JSON.stringify(captured.world)).not.toContain(`PRIVATE_NEW_${name}_DO_NOT_EXPORT`);
        expect(captured.world.find((e:any)=>e.id===id).components).not.toHaveProperty(name);
      }
    }finally{daemon.stop();await daemon.flush();}
  });
  test("private environmental inputs are always also write-protected", () => {
    for (const name of PRIVATE_MANAGED_COMPONENTS) expect(PROTECTED_MANAGED_COMPONENTS.has(name)).toBe(true);
  });
  test.each(["EmotionalLife","NarrativeEntry", ...newerPrivateFields.map(([name]) => name)])("public mechanics cannot derive effects from private %s reads",async component=>{
    const {daemon}=await setup(async({directory})=>{
      await mkdir(path.join(directory,"systems"),{recursive:true});await mkdir(path.join(directory,"components"),{recursive:true});
      await writeFile(path.join(directory,"components/LeakedMarker.json"),JSON.stringify({name:"LeakedMarker",description:"Forbidden inferred public output",fields:{value:{type:"number",default:0}}}));
      await writeFile(path.join(directory,"systems/PrivateReader.ts"),`export function run(ctx:any):void {for(const id of ctx.query(${JSON.stringify(component)})){ctx.attach(id,"LeakedMarker");ctx.set(id,"LeakedMarker","value",1);}}`);
      const tests=[0,1].map(value=>({name:`private presence ${value}`,system:"PrivateReader",entities:[{id:1,components:{[component]:{},LeakedMarker:{value}}}],ticks:1,deltaMs:1000,expect:[{entity:1,component:"LeakedMarker",field:"value",equals:1}]}));
      await writeFile(path.join(directory,"release.json"),JSON.stringify({version:1,components:["components/LeakedMarker.json"],systems:[{name:"PrivateReader",description:"Forbidden private read",file:"systems/PrivateReader.ts",frequency:1,reads:[component,"LeakedMarker"],writes:["LeakedMarker.value"]}],tests}));
    });
    try {const job=daemon.enqueue({source:"test",instruction:"Adversarial private read"});await daemon.pump();
      expect(daemon.getStatus().jobs.find(j=>j.id===job.id)).toMatchObject({status:"rejected",error:expect.stringContaining(`Private component read denied: ${component}`)});
      expect(getComponent("LeakedMarker")).toBeUndefined();
    }finally{daemon.stop();await daemon.flush();}
  });
  test.each([
    ["AffectState", "valence", 0, 1], ["CognitiveControl", "stateJson", "before", "changed"],
    ["EmotionalLife", "episodesJson", "before", "changed"], ["NarrativeEntry", "monologue", "before", "changed"],
    ["SocialMemory", "revision", 0, 1], ["WorkingMemoryIdentity", "id", "before", "changed"],
    ...newerPrivateFields.filter(([name]) => name !== "WorkingMemoryIdentity").map(([name, field]) => [name, field, "before", "changed"]),
  ])("independent host gate protects newer private component %s",async(component,field,before,after)=>{
    const {daemon}=await setup(async({directory})=>{
      await mkdir(path.join(directory,"systems"),{recursive:true});
      await writeFile(path.join(directory,"systems/PrivateClobber.ts"),`export function run(ctx:any):void {for(const id of ctx.query(${JSON.stringify(component)}))ctx.set(id,${JSON.stringify(component)},${JSON.stringify(field)},${JSON.stringify(after)});}`);
      const tests=[before,after].map((value,i)=>({name:`private fixture ${i}`,system:"PrivateClobber",entities:[{id:1,components:{[component]:{[field]:value}}}],ticks:1,deltaMs:1000,expect:[{entity:1,component,field,equals:after}]}));
      await writeFile(path.join(directory,"release.json"),JSON.stringify({version:1,components:[],systems:[{name:"PrivateClobber",description:"Must not become a controller",file:"systems/PrivateClobber.ts",frequency:1,reads:[component],writes:[`${component}.${field}`]}],tests}));
    });
    try { const job=daemon.enqueue({source:"test",instruction:"Adversarial private-state write"});await daemon.pump();
      expect(daemon.getStatus().jobs.find(j=>j.id===job.id)).toMatchObject({status:"rejected",error:expect.stringContaining(`Protected component ${component}`)});
      expect(daemon.getStatus().activeSystems).toEqual([]);
    } finally {daemon.stop();await daemon.flush();}
  });
  test("world ticks during a build; release activates only between ticks without resetting registry",async()=>{
    let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
    const {world,id,registry,daemon}=await setup(async({directory})=>{await gate;await packageFiles(directory);});
    let ticks=0;registerSystem(registry,{name:"ExistingClock",description:"existing",pseudocode:"",frequency:0,active:true,lastRun:0,compiledFn:()=>{ticks++;}});
    const nameIdentity=getComponent("Name");
    const job=daemon.enqueue({source:"The Weaver",instruction:"Develop rust mechanics",acceptance:acceptance()});
    const build=daemon.pump();
    for(let t=1;t<=10;t++) await advance(world,registry,daemon,t,1000);
    expect(ticks).toBe(10);expect(getComponent("Rust")).toBeUndefined();
    release();await build;
    expect(daemon.getStatus().jobs[0].status).toBe("ready");expect(getComponent("Rust")).toBeUndefined();
    daemon.commitReady(11);await advance(world,registry,daemon,11,1000);
    expect(getRegistryWorld()).toBe(world);expect(getComponent("Name")).toBe(nameIdentity);
    expect(hasComponent(world,id,getComponent("Rust"))).toBe(true);expect(getComponent("Rust").level[id]).toBe(1);
    expect(daemon.getStatus().jobs.find(j=>j.id===job.id)?.status).toBe("active");
    daemon.stop();await daemon.flush();
  });
  test("host acceptance tests reject plausible but wrong code and preserve the active version",async()=>{
    let rate=1;const {world,id,registry,daemon}=await setup(async({directory})=>packageFiles(directory,rate));
    daemon.enqueue({source:"God",instruction:"v1",acceptance:acceptance()});await daemon.pump();daemon.commitReady(1);await advance(world,registry,daemon,1,1000);
    const good=registry.systems.get("RustGrowth");rate=2;
    daemon.enqueue({source:"God",instruction:"incorrect v2",acceptance:acceptance()});await daemon.pump();daemon.commitReady(2);await advance(world,registry,daemon,2,1000);
    expect(daemon.getStatus().jobs[1].status).toBe("rejected");expect(registry.systems.get("RustGrowth")).toBe(good);
    expect(getComponent("Rust").level[id]).toBe(2);daemon.stop();await daemon.flush();
  });
  test("additive schema upgrades preserve values and component identity",async()=>{
    let upgraded=false;const {world,id,registry,daemon}=await setup(async({directory})=>packageFiles(directory,1,"",upgraded?{level:{type:"number",default:0},wet:{type:"boolean",default:false}}:undefined));
    daemon.enqueue({source:"God",instruction:"v1"});await daemon.pump();daemon.commitReady(1);await advance(world,registry,daemon,1,1000);
    const rust=getComponent("Rust");rust.level[id]=19;upgraded=true;
    daemon.enqueue({source:"God",instruction:"add wetness"});await daemon.pump();daemon.commitReady(2);
    expect(getComponent("Rust")).toBe(rust);expect(rust.level[id]).toBe(19);expect(rust.wet[id]).toBe(false);
    await advance(world,registry,daemon,2,1000);expect(rust.level[id]).toBe(20);daemon.stop();await daemon.flush();
  });
  test("invalid runtime writes are discarded and previous implementation resumes",async()=>{
    let bad=false;const {world,id,registry,daemon}=await setup(async({directory})=>packageFiles(directory,1,bad?'if(ctx.get(id,"Name","value")==="inhabitant")ctx.set(id,"Rust","level","bad");':""));
    daemon.enqueue({source:"God",instruction:"v1"});await daemon.pump();daemon.commitReady(1);await advance(world,registry,daemon,1,1000);
    const original=registry.systems.get("RustGrowth");bad=true;
    daemon.enqueue({source:"God",instruction:"broken update"});await daemon.pump();daemon.commitReady(2);await advance(world,registry,daemon,2,1000);
    expect(getComponent("Rust").level[id]).toBe(1);expect(registry.systems.get("RustGrowth")).toBe(original);
    expect(daemon.getStatus().jobs[1].status).toBe("rolled_back");await advance(world,registry,daemon,3,1000);expect(getComponent("Rust").level[id]).toBe(2);
    daemon.stop();await daemon.flush();
  });
  test("stopped workers cannot activate late files",async()=>{
    let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
    const {daemon}=await setup(async({directory})=>{await gate;await packageFiles(directory);});
    daemon.enqueue({source:"God",instruction:"late job"});const work=daemon.pump();daemon.stop();release();await work;daemon.commitReady(1);
    expect(getComponent("Rust")).toBeUndefined();expect(daemon.getStatus().jobs[0].status).toBe("cancelled");await daemon.flush();
  });
  test("a builder that ignores cancellation times out without blocking later engineering",async()=>{
    let calls=0;
    const {world,id,registry,daemon}=await setup(async({directory})=>{
      calls++;
      if(calls===1)await new Promise<void>(()=>{});
      await packageFiles(directory);
    },{timeoutMs:25});
    daemon.enqueue({source:"God",instruction:"builder that never returns"});
    await daemon.pump();
    const timedOut=daemon.getStatus().jobs[0];
    expect(timedOut.status).toBe("rejected");
    expect(timedOut.error).toMatch(/timed out after 25ms/);
    expect(daemon.getStatus().busy).toBe(false);

    daemon.config.timeoutMs=1000;
    daemon.enqueue({source:"God",instruction:"healthy retry in a fresh candidate"});
    await daemon.pump();daemon.commitReady(1);await advance(world,registry,daemon,1,1000);
    expect(daemon.getStatus().jobs[1].status).toBe("active");
    expect(getComponent("Rust").level[id]).toBe(1);
    daemon.stop();await daemon.flush();
  });
  test("interrupted persisted work is requeued in a fresh candidate after restart",async()=>{
    const first=await setup(async()=>{throw new Error("crashed builder must not run");});
    const queued=first.daemon.enqueue({source:"God",instruction:"survive process crash"});await first.daemon.flush();

    const world=createArgosWorld("Recovered queue");initializeRegistry(world);const id=addEntity(world);addComponent(world,id,Name);Name.value[id]="inhabitant";
    const registry=createSystemRegistry();const daemon=new CodingDaemon(world,registry,{directory:first.directory},async({directory})=>packageFiles(directory));
    await daemon.initialize();
    const recovered=daemon.getStatus().jobs.find(job=>job.id===queued.id)!;
    expect(recovered.status).toBe("queued");expect(recovered.directory).toMatch(/candidate-recovery-/);
    await daemon.pump();daemon.commitReady(1);await advance(world,registry,daemon,1,1000);
    expect(daemon.getStatus().jobs.find(job=>job.id===queued.id)?.status).toBe("active");
    expect(getComponent("Rust").level[id]).toBe(1);daemon.stop();await daemon.flush();
  });
  test("a host job marked active without an active release index is not restored as a phantom",async()=>{
    const first=await setup(async({directory})=>packageFiles(directory));
    const job=first.daemon.enqueue({source:"God",instruction:"activation crash window"});await first.daemon.flush();
    const file=path.join(first.directory,"jobs",job.id,"host-job.json");
    const persisted=JSON.parse(await readFile(file,"utf8"));persisted.status="active";await writeFile(file,JSON.stringify(persisted));

    const world=createArgosWorld("Recovered phantom");initializeRegistry(world);const registry=createSystemRegistry();
    const daemon=new CodingDaemon(world,registry,{directory:first.directory},async({directory})=>packageFiles(directory));await daemon.initialize();
    const recovered=daemon.getStatus().jobs.find(candidate=>candidate.id===job.id)!;
    expect(recovered.status).toBe("queued");expect(daemon.getStatus().activeSystems).toEqual([]);
    await daemon.pump();daemon.commitReady(1);
    expect(daemon.getStatus().jobs.find(candidate=>candidate.id===job.id)?.status).toBe("active");
    daemon.stop();await daemon.flush();
  });
  test("accepted files reload into a fresh process registry without calling the builder",async()=>{
    const first=await setup(async({directory})=>packageFiles(directory));
    first.daemon.enqueue({source:"God",instruction:"persistent build"});await first.daemon.pump();first.daemon.commitReady(1);first.daemon.stop();await first.daemon.flush();
    const world=createArgosWorld("Restored");initializeRegistry(world);const id=addEntity(world);addComponent(world,id,Name);Name.value[id]="restored";
    const registry=createSystemRegistry();const daemon=new CodingDaemon(world,registry,{directory:first.directory},async()=>{throw new Error("Must not build during restore");});
    await daemon.initialize();await advance(world,registry,daemon,1,1000);expect(getComponent("Rust").level[id]).toBe(1);daemon.stop();await daemon.flush();
  });
  test.each([true, false])("managed snapshot rebinds the latest accepted replacement and preserves active=%s",async active=>{
    let rate=1;
    const first=await setup(async({directory})=>packageFiles(directory,rate,"",rate===2
      ? {level:{type:"number",default:0},wet:{type:"boolean",default:false}} : undefined));
    first.daemon.enqueue({source:"God",instruction:"v1"});await first.daemon.pump();first.daemon.commitReady(1);
    rate=2;
    first.daemon.enqueue({source:"God",instruction:"v2"});await first.daemon.pump();first.daemon.commitReady(2);
    const current=first.registry.systems.get("RustGrowth")!;
    current.active=active;
    const saved=serializeWorld(first.world,first.registry);
    first.daemon.stop();await first.daemon.flush();
    const world=createArgosWorld("Managed replacement restore");initializeRegistry(world);
    const registry=createSystemRegistry();
    const {oldToNewId}=deserializeWorld(world,registry,saved,{strictSystems:true});
    expect(registry.systems.get("RustGrowth")?.compiledFn).toBeUndefined();
    let builds=0;
    const daemon=new CodingDaemon(world,registry,{directory:first.directory},async({directory})=>{builds++;await packageFiles(directory,3);});
    try {
      await daemon.initialize();
      expect(builds).toBe(0);
      const restored=registry.systems.get("RustGrowth")!;
      expect(restored.managedRestorePending).toBeUndefined();
      expect(restored.managedRelease).toEqual(current.managedRelease);
      expect(restored.active).toBe(active);
      const id=oldToNewId.get(first.id)!;
      if (!active) {
        await advance(world,registry,daemon,1,1000);
        expect(hasComponent(world,id,getComponent("Rust"))).toBe(false);
        restored.active=true;
      }
      await advance(world,registry,daemon,2,1000);
      expect(getComponent("Rust").level[id]).toBe(2);
      const invalid=daemon.enqueue({source:"God",instruction:"Remove the accepted wet field"});
      await daemon.pump();
      expect(daemon.getStatus().jobs.find(job=>job.id===invalid.id)).toMatchObject({status:"rejected",error:expect.stringContaining("Incompatible schema: Rust.wet")});
      expect(registry.systems.get("RustGrowth")).toBe(restored);
    } finally {daemon.stop();await daemon.flush();}
  });
  test("candidate validation does not alter live world or schemas",async()=>{
    const {world,id,daemon,directory}=await setup(async()=>{});await packageFiles(directory);await prepareRelease(directory);
    expect(getRegistryWorld()).toBe(world);expect(Name.value[id]).toBe("inhabitant");expect(getComponent("Rust")).toBeUndefined();daemon.stop();await daemon.flush();
  });
  test("NPC changes win over an in-flight system result",async()=>{
    const {world,id,registry,daemon}=await setup(async({directory})=>packageFiles(directory));
    daemon.enqueue({source:"God",instruction:"rust"});await daemon.pump();daemon.commitReady(1);
    runSystems(world,registry,1,1000);Name.value[id]="changed while worker ran";
    await daemon.settle();daemon.commitReady(2);
    expect(hasComponent(world,id,getComponent("Rust"))).toBe(false);
    await advance(world,registry,daemon,2,1000);expect(getComponent("Rust").level[id]).toBe(1);
    daemon.stop();await daemon.flush();
  });
  test("stopping an in-flight worker does not roll back a healthy release after restart",async()=>{
    const {world,id,registry,daemon}=await setup(async({directory})=>packageFiles(directory));
    daemon.enqueue({source:"God",instruction:"rust"});await daemon.pump();daemon.commitReady(1);
    runSystems(world,registry,1,1000);daemon.stop();daemon.start();await daemon.settle();daemon.commitReady(2);
    expect(daemon.getStatus().jobs[0].status).toBe("active");
    await advance(world,registry,daemon,2,1000);expect(getComponent("Rust").level[id]).toBe(1);
    daemon.stop();await daemon.flush();
  });
  test("duplicate proposals notify both waiters but differing acceptance is not deduplicated",async()=>{
    const {daemon}=await setup(async({directory})=>packageFiles(directory));
    const finished:string[]=[];const request={source:"God",instruction:"rust"};
    const first=daemon.enqueue(request,j=>finished.push(`first:${j.status}`));
    const duplicate=daemon.enqueue(request,j=>finished.push(`second:${j.status}`));
    const distinct=daemon.enqueue({...request,acceptance:acceptance(2)});
    expect(duplicate.id).toBe(first.id);expect(distinct.id).not.toBe(first.id);
    await daemon.pump();daemon.commitReady(1);expect(finished).toEqual(["first:active","second:active"]);
    daemon.stop();await daemon.flush();
  });
  test("approved spirit proposal is only executed after actual admission",async()=>{
    resetFactoryState();
    const {world,registry,daemon}=await setup(async({directory})=>packageFiles(directory));
    const spirits=createSpiritRegistry(world);
    const weaver=createDynamicSpirit(spirits,{name:"The Weaver",type:"architect",rank:"archangel",domain:"ecology",
      architectConfig:{canProposeSystems:true,canProposeComponents:true,canProposeEntities:true,canProposeRules:false,
        canExecuteDirectly:true,proposalApproval:"auto",maxProposalsPerCycle:3}})!;
    const proposal=submitProposal(weaver.eid,"system","RustGrowth","Rust mechanics",{name:"RustGrowth"},"Salt affects exposed surfaces")!;
    const result=await executeAllApprovedProposals(world,registry);
    expect(result.executed).toEqual([]);expect(result.queued).toEqual(["RustGrowth"]);expect(proposal.status).toBe("building");
    await daemon.pump();expect(proposal.status).toBe("building");daemon.commitReady(1);expect(proposal.status).toBe("executed");
    daemon.stop();await daemon.flush();resetFactoryState();
  });
  test("removing an existing component field rejects the release",async()=>{
    let upgrade=false;
    const {world,registry,daemon}=await setup(async({directory})=>packageFiles(directory,1,"",upgrade?undefined:{level:{type:"number",default:0},wet:{type:"boolean",default:false}}));
    daemon.enqueue({source:"God",instruction:"rust with wetness"});await daemon.pump();daemon.commitReady(1);await advance(world,registry,daemon,1,1000);
    upgrade=true;daemon.enqueue({source:"God",instruction:"delete wetness"});await daemon.pump();
    expect(daemon.getStatus().jobs[1].status).toBe("rejected");expect(daemon.getStatus().jobs[1].error).toMatch(/Incompatible schema/);
    expect(getComponent("Rust").wet).toBeDefined();daemon.stop();await daemon.flush();
  });
  test("rollback persists last good code and additive schema across restart",async()=>{
    let bad=false;
    const first=await setup(async({directory})=>packageFiles(directory,1,bad?'if(ctx.get(id,"Name","value")==="inhabitant")ctx.set(id,"Rust","level","bad");':"",
      bad?{level:{type:"number",default:0},wet:{type:"boolean",default:false}}:undefined));
    first.daemon.enqueue({source:"God",instruction:"v1"});await first.daemon.pump();first.daemon.commitReady(1);await advance(first.world,first.registry,first.daemon,1,1000);
    bad=true;first.daemon.enqueue({source:"God",instruction:"v2 broken"});await first.daemon.pump();first.daemon.commitReady(2);await advance(first.world,first.registry,first.daemon,2,1000);
    expect(first.daemon.getStatus().revision).toBe(3);first.daemon.stop();await first.daemon.flush();
    expect(JSON.parse(await readFile(path.join(first.directory,"active.json"),"utf8"))[1].disabled).toBe(true);
    const world=createArgosWorld("restored rollback");initializeRegistry(world);const id=addEntity(world);addComponent(world,id,Name);Name.value[id]="inhabitant";
    const registry=createSystemRegistry();const daemon=new CodingDaemon(world,registry,{directory:first.directory},async()=>{throw Error("No rebuild");});
    await daemon.initialize();await advance(world,registry,daemon,1,1000);
    expect(getComponent("Rust").level[id]).toBe(1);expect(getComponent("Rust").wet[id]).toBe(false);
    expect(daemon.getStatus().jobs[1].status).toBe("rolled_back");daemon.stop();await daemon.flush();
  });
  test("repairs inherit the active host acceptance contract across restart",async()=>{
    const first=await setup(async({directory})=>packageFiles(directory,1));
    first.daemon.enqueue({source:"operator",instruction:"rust invariant",acceptance:acceptance(1),protectedConditions:["Rust advances exactly once per logical tick"]});
    await first.daemon.pump();first.daemon.commitReady(1);first.daemon.stop();await first.daemon.flush();

    const world=createArgosWorld("Restored acceptance");initializeRegistry(world);const registry=createSystemRegistry();
    const daemon=new CodingDaemon(world,registry,{directory:first.directory},async({directory})=>packageFiles(directory,2));await daemon.initialize();
    const restored=registry.systems.get("RustGrowth");
    const repair=daemon.enqueue({source:"The Tinker",instruction:"speed up rust"});await daemon.pump();
    expect(daemon.getStatus().jobs.find(job=>job.id===repair.id)?.status).toBe("rejected");
    expect(daemon.getStatus().jobs.find(job=>job.id===repair.id)?.error).toMatch(/operator rust progression/);
    expect(registry.systems.get("RustGrowth")).toBe(restored);daemon.stop();await daemon.flush();
  });
  test("an atomic release can transfer field ownership between replaced managed systems",async()=>{
    let version:1|2=1;const {registry,daemon}=await setup(async({directory})=>ownershipPackage(directory,version));
    daemon.enqueue({source:"God",instruction:"owner A v1"});await daemon.pump();daemon.commitReady(1);
    version=2;const replacement=daemon.enqueue({source:"God",instruction:"transfer x from A to B"});await daemon.pump();daemon.commitReady(2);
    expect(daemon.getStatus().jobs.find(job=>job.id===replacement.id)?.status).toBe("active");
    expect(daemon.getStatus().activeSystems.map(system=>system.name).sort()).toEqual(["OwnerA","OwnerB"]);
    daemon.stop();await daemon.flush();
  });
  test("world ticks through rollback and repair before hot-activating the repaired release",async()=>{
    let version:"good"|"broken"|"repair"="good";
    let releaseRepair!:()=>void;
    const repairGate=new Promise<void>(resolve=>{releaseRepair=resolve;});
    const {world,id,registry,daemon}=await setup(async({directory})=>{
      if(version==="repair")await repairGate;
      await packageFiles(directory,version==="repair"?2:1,
        version==="broken"?'if(ctx.get(id,"Name","value")==="inhabitant")ctx.set(id,"Rust","level","bad");':"");
    });
    let nativeTicks=0;
    registerSystem(registry,{name:"NativeCognitionClock",description:"unmanaged heartbeat",pseudocode:"",frequency:0,active:true,lastRun:0,compiledFn:()=>{nativeTicks++;}});

    daemon.enqueue({source:"God",instruction:"healthy v1"});await daemon.pump();daemon.commitReady(1);
    await advance(world,registry,daemon,1,1000);
    const original=registry.systems.get("RustGrowth");
    version="broken";daemon.enqueue({source:"The Tinker",instruction:"latent broken v2"});await daemon.pump();daemon.commitReady(2);
    await advance(world,registry,daemon,2,1000);
    expect(daemon.getStatus().jobs[1].status).toBe("rolled_back");
    expect(registry.systems.get("RustGrowth")).toBe(original);

    version="repair";daemon.enqueue({source:"The Tinker",instruction:"repair corrosion safely"});
    const repairBuild=daemon.pump();
    await advance(world,registry,daemon,3,1000);
    await advance(world,registry,daemon,4,1000);
    expect(getComponent("Rust").level[id]).toBe(3);
    expect(nativeTicks).toBe(4);
    releaseRepair();await repairBuild;daemon.commitReady(5);await advance(world,registry,daemon,5,1000);
    expect(daemon.getStatus().jobs[2].status).toBe("active");
    expect(registry.systems.get("RustGrowth")).not.toBe(original);
    expect(getComponent("Rust").level[id]).toBe(5);
    expect(nativeTicks).toBe(5);
    daemon.stop();await daemon.flush();
  });
  test("a latent managed failure queues one invariant-preserving repair and hot-activates it",async()=>{
    let build=0;
    const {world,id,registry,daemon}=await setup(async({directory})=>{
      build++;
      await packageFiles(directory,1,build===2?'if(ctx.get(id,"Name","value")==="inhabitant")ctx.set(id,"Rust","level","bad");':build===3?'if(false)ctx.set(id,"Rust","level",0);':"");
    });
    const invariant=acceptance(1),protectedConditions=["The keeper's protected tools never corrode"];
    daemon.enqueue({source:"operator",instruction:"healthy rust",acceptance:invariant,protectedConditions});
    await daemon.pump();daemon.commitReady(1);await advance(world,registry,daemon,1,1000);
    const broken=daemon.enqueue({source:"God",instruction:"latent bad update"});await daemon.pump();daemon.commitReady(2);
    await advance(world,registry,daemon,2,1000);
    expect(daemon.getStatus().jobs.find(job=>job.id===broken.id)?.status).toBe("rolled_back");
    const repair=daemon.getStatus().jobs.find(job=>job.repairOfJobId===broken.id)!;
    expect(repair.status).toBe("queued");expect(repair.repairAttempt).toBe(1);
    expect(repair.request.acceptance).toEqual(invariant);expect(repair.request.protectedConditions).toEqual(protectedConditions);

    await daemon.pump();daemon.commitReady(3);await advance(world,registry,daemon,3,1000);
    expect(daemon.getStatus().jobs.find(job=>job.id===repair.id)?.status).toBe("active");
    expect(getComponent("Rust").level[id]).toBe(2);
    daemon.stop();await daemon.flush();
  });
  test("a failed automatic repair is terminal and never recursively queues itself",async()=>{
    let build=0;
    const {world,registry,daemon}=await setup(async({directory})=>{
      build++;
      await packageFiles(directory,1,build>1?'if(ctx.get(id,"Name","value")==="inhabitant")ctx.set(id,"Rust","level","bad");':"");
    });
    daemon.enqueue({source:"operator",instruction:"healthy v1",acceptance:acceptance(1)});await daemon.pump();daemon.commitReady(1);
    await advance(world,registry,daemon,1,1000);
    const broken=daemon.enqueue({source:"God",instruction:"broken v2"});await daemon.pump();daemon.commitReady(2);await advance(world,registry,daemon,2,1000);
    const repair=daemon.getStatus().jobs.find(job=>job.repairOfJobId===broken.id)!;
    await daemon.pump();daemon.commitReady(3);await advance(world,registry,daemon,3,1000);
    expect(daemon.getStatus().jobs.find(job=>job.id===repair.id)?.status).toBe("rolled_back");
    expect(daemon.getStatus().jobs.filter(job=>job.repairOfJobId!==undefined)).toHaveLength(1);
    expect(daemon.getStatus().jobs.some(job=>["queued","building","validating","ready"].includes(job.status))).toBe(false);
    await daemon.pump();expect(build).toBe(3);
    daemon.stop();await daemon.flush();
  });
  test("overlapping release rollbacks do not resurrect an already failed ancestor",async()=>{
    let version=1;
    const {world,registry,daemon}=await setup(async({directory})=>{
      await packageFiles(directory,version,version===3?'if(ctx.tick>=4 && ctx.get(id,"Name","value")==="inhabitant")ctx.set(id,"Rust","level","bad");':"");
      if(version!==2)return;
      await writeFile(path.join(directory,"components/Fault.json"),JSON.stringify({name:"Fault",description:"test fixture",fields:{value:{type:"number",default:0}}}));
      await writeFile(path.join(directory,"systems/FaultSystem.ts"),'export function run(ctx:any){for(const id of ctx.query("Name")){ctx.attach(id,"Fault");ctx.set(id,"Fault","value",ctx.get(id,"Name","value")==="inhabitant" ? "bad" : Math.min(100,ctx.get(id,"Fault","value")+1));}}');
      const manifest=JSON.parse(await readFile(path.join(directory,"release.json"),"utf8"));
      manifest.components.push("components/Fault.json");
      manifest.systems.push({name:"FaultSystem",description:"latent runtime fault",file:"systems/FaultSystem.ts",frequency:1,reads:["Name","Fault"],writes:["Fault.value"]});
      manifest.tests.push(...[0,100].map(value=>({name:`fault fixture ${value}`,system:"FaultSystem",entities:[{id:1,components:{Name:{value:"fixture"},Fault:{value}}}],ticks:1,deltaMs:1000,expect:[{entity:1,component:"Fault",field:"value",equals:Math.min(100,value+1)}]})));
      await writeFile(path.join(directory,"release.json"),JSON.stringify(manifest));
    });
    daemon.enqueue({source:"God",instruction:"v1"});await daemon.pump();daemon.commitReady(1);
    const original=registry.systems.get("RustGrowth");
    version=2;daemon.enqueue({source:"God",instruction:"v2 two systems"});await daemon.pump();daemon.commitReady(2);
    version=3;daemon.enqueue({source:"God",instruction:"v3 replaces only rust"});await daemon.pump();daemon.commitReady(3);
    await advance(world,registry,daemon,3,1000);
    expect(daemon.getStatus().jobs[1].status).toBe("rolled_back");expect(daemon.getStatus().jobs[2].status).toBe("active");
    await advance(world,registry,daemon,4,1000);
    expect(daemon.getStatus().jobs[2].status).toBe("rolled_back");expect(registry.systems.get("RustGrowth")).toBe(original);
    daemon.stop();await daemon.flush();
  });
});
async function advance(world:any,registry:any,daemon:CodingDaemon,tick:number,delta:number) {
  runSystems(world,registry,tick,delta);await daemon.settle();daemon.commitReady(tick);
}
