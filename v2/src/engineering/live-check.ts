/** Bounded engineering integration probe. Uses live coding inference, no video or NPC LLM calls. */
import "dotenv/config";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { format } from "node:util";
import { query } from "bitecs";
import { createSimulation } from "../index";
import { Name, ObjectState } from "../ecs/components";
import { getComponent } from "../ecs/component-registry";
import { getCodingDaemon } from "./coding-daemon";
import type { AcceptanceTest } from "./contracts";

const backend=process.argv.includes("--gemini")?"gemini":"codex";
const directory=await mkdtemp(path.join(os.tmpdir(),`argos-${backend}-live-`));
const originalLog=console.log;
const log=createWriteStream(path.join(directory,"runtime.log"));
console.log=(...args:unknown[])=>{const line=format(...args);log.write(line+"\n");if(line.startsWith('{"build"')||line.startsWith("LIVE_ENGINEERING"))originalLog(line);};
originalLog(`Live engineering probe (${backend}): ${directory}`);
const sim=await createSimulation({name:"Continuous Engineering Probe",preset:"minimal",enableAI:false,enableSpirits:false,evolution:false,
  enableNarrativeEngine:false,enableServer:false,dualLoop:true,ecsTickRate:20,ecsDeltaMs:50,
  codingDaemons:{backend,directory,timeoutMs:150000,pollMs:100},
  rooms:[{name:"Workshop",description:"Salt air and brass fixtures"}],
  agents:[{name:"Mara",role:"keeper",systemPrompt:"You tend the workshop.",startRoom:"Workshop"}],
  objects:[{name:"Brass latch",room:"Workshop",portable:false}]});
const latch=[...query(sim.world,[Name])].find(e=>Name.value[e]==="Brass latch")!;
ObjectState.current[latch]="exposed";
const acceptance:AcceptanceTest[]=[
  {name:"exposed object gains corrosion in simulation seconds",system:"SalineCorrosion",entities:[{id:1,components:{ObjectState:{current:"exposed"}}}],ticks:2,deltaMs:500,expect:[{entity:1,component:"Corrosion",field:"level",equals:1}]},
  {name:"protected object unchanged",system:"SalineCorrosion",entities:[{id:1,components:{ObjectState:{current:"protected"},Corrosion:{level:42}}}],ticks:2,deltaMs:500,expect:[{entity:1,component:"Corrosion",field:"level",equals:42}]},
];
const events:any[]=[];
sim.onSystem(event=>{if(event.type==="system:build"){events.push({...event,tick:sim.tick});console.log(JSON.stringify({build:event,tick:sim.tick}));}});
const job=sim.requestSystemBuild({source:"The Weaver",instruction:"Implement managed system SalineCorrosion. For entities whose ObjectState.current is exposed, attach Corrosion (numeric level, default 0) if absent, and increase level by ctx.deltaMs / 1000, capped at 100. Leave all other entities entirely unchanged. Reuse ObjectState, do not redefine it. Include positive, protected-object, and cap boundary tests. Do not solve any puzzle or alter ObjectState.",acceptance});
let timer:ReturnType<typeof setInterval>|undefined;
const started=Date.now();
let result: Record<string, unknown> | undefined;
try {
  await sim.start();
  await new Promise<void>((resolve,reject)=>{
    timer=setInterval(()=>{
      const current=sim.getCodingStatus()!.jobs.find(j=>j.id===job.id)!;
      if(["rejected","cancelled","rolled_back"].includes(current.status))reject(new Error(current.error ?? current.status));
      if(current.status==="active"&&(getComponent("Corrosion")?.level[latch]??0)>0.1)resolve();
      if(Date.now()-started>170000)reject(new Error("Live check deadline exceeded"));
    },100);
  });
  result={ok:true,backend,job:sim.getCodingStatus()!.jobs.find(j=>j.id===job.id),ticks:sim.tick,
    corrosion:getComponent("Corrosion").level[latch],objectState:ObjectState.current[latch],npc:sim.getAgents().map(a=>a.name),elapsedMs:Date.now()-started};
  console.log("LIVE_ENGINEERING_VERIFIED "+JSON.stringify(result));
} catch (error) {
  result={ok:false,backend,error:String(error),ticks:sim.tick,elapsedMs:Date.now()-started};
  console.log("LIVE_ENGINEERING_FAILED "+JSON.stringify(result));
  process.exitCode=1;
} finally {
  clearInterval(timer);sim.stop();await getCodingDaemon(sim.world)?.settle();await getCodingDaemon(sim.world)?.flush();
  result={...result,job:sim.getCodingStatus()?.jobs.find(j=>j.id===job.id)};
  await writeFile(path.join(directory,"verification.json"),JSON.stringify({result,events},null,2));
  console.log=originalLog;await new Promise<void>(resolve=>log.end(resolve));
}
