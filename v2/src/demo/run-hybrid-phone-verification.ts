/** One fresh full-profile episode, not a frozen cognition replay. No retries.
 * Browser Start allocates H3; the only injected action is an ordinary text. */
import "dotenv/config";
import {randomBytes} from "node:crypto";
import {mkdtemp,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {ApartmentSitcom} from "./apartment-sitcom";
import {createSitcomDemoApp} from "./sitcom-server";
import {sitcomLaunchProfile} from "./sitcom-launch-profile";
import {attachBoundedSourceDrain} from "./bounded-source-drain";
if(!process.env.FAL_KEY?.trim()||!process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) throw new Error("Configured simulation and video keys required");
const directory=await mkdtemp(resolve("recordings/h3-hybrid-phone-")),token=randomBytes(24).toString("hex");
const profile=sitcomLaunchProfile([]);
const message="Elaine, the restaurant confirmed our dinner reservation for eight tonight. I'll see you there.";
await writeFile(resolve(directory,"protocol.json"),JSON.stringify({profile,message,messageAtSimMs:34500,
  sourceNominalEndMs:120000,maxSourceDrainMs:30000,receiverBudgetSeconds:165,transport:"direct realtime",attempts:1,
  recording:"raw + synchronized thought/phone composition",forcedNpcActions:false},null,2),{mode:0o600});
const t=await ApartmentSitcom.create(profile);
const cancelSourceDrain=attachBoundedSourceDrain(t.sim.world,{nominalEndMs:120000,maxDrainMs:30000,onSeal:report=>{
  t.stop();console.log("HYBRID_SOURCE_SEALED",JSON.stringify(report));
  void writeFile(resolve(directory,"source-drain.json"),JSON.stringify(report,null,2),{flag:"wx",mode:0o600})
    .catch(error=>console.error("HYBRID_DRAIN_SAVE_FAILED",String(error)));
}});
const receiver=await createSitcomDemoApp({testbed:t,directory,token,seconds:165,allowVideo:true,scriptQueue:false,h3ChunkSeconds:10,conversationFraming:false});
const server=receiver.app.listen(0,"127.0.0.1",()=>{
  const a=server.address();if(!a||typeof a==="string")throw new Error("No local address");
  console.log(`HYBRID_READY http://127.0.0.1:${a.port}/#${token}`);
  console.log(`HYBRID_EVIDENCE ${directory}`);
});
let sent=false,startedAt=0;
const monitor=setInterval(()=>{
  if(t.running)startedAt ||= Date.now();
  if(t.running&&!sent&&t.elapsedMs>=34500){sent=true;t.text(message,"bounded verification operator");console.log("HYBRID_TEXT_SENT",t.elapsedMs);}
  if(startedAt&&Date.now()-startedAt>225000){clearInterval(monitor);void receiver.stop();}
},25);
process.once("SIGINT",()=>{cancelSourceDrain();clearInterval(monitor);void receiver.stop().finally(()=>server.close());});
