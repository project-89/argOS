/** One live verification: focused 60s/90s source/receiver, or --cookie 120s/180s.
 * Launch prepares only; the browser's Start button authorizes paid rendering. */
import "dotenv/config";
import {randomBytes} from "node:crypto";
import {mkdtemp} from "node:fs/promises";
import {resolve} from "node:path";
import {ApartmentSitcom} from "./apartment-sitcom";
import {createSitcomDemoApp} from "./sitcom-server";
import {sitcomLaunchProfile} from "./sitcom-launch-profile";
import {validateDirectorResolution} from "../rendering/director-projection";
import {ELAINE_DAVID_CONTACT} from "./cookie-character-history";
import {sitcomH3LaunchOptions} from "./sitcom-h3-chunk";
if(!process.env.FAL_KEY?.trim()||!process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) throw new Error("Configured simulation and video keys required");
const directory=await mkdtemp(resolve("recordings/h3-bounded-verification-")),token=randomBytes(24).toString("hex");
const cookie=process.argv.includes("--cookie"), threeMinutes=process.argv.includes("--three-minutes");
if(threeMinutes&&!cookie)throw new Error("Three-minute verification requires --cookie");
const sourceSeconds=threeMinutes?180:cookie?120:60;
const t=await ApartmentSitcom.create(sitcomLaunchProfile(cookie?[]:["--focused","--core-only"]));
if(cookie)t.setPhoneContact({...ELAINE_DAVID_CONTACT});
const receiver=await createSitcomDemoApp({testbed:t,directory,token,seconds:cookie?180:90,allowVideo:true,
  ...sitcomH3LaunchOptions(process.argv.slice(2),{
    ARGOS_H3_SCRIPT_QUEUE:process.env.ARGOS_H3_SCRIPT_QUEUE,
    ARGOS_H3_CHUNK_SECONDS:process.env.ARGOS_H3_CHUNK_SECONDS,
  }),h3Resolution:validateDirectorResolution(process.env.ARGOS_H3_RESOLUTION??"768p")});
const server=receiver.app.listen(0,"127.0.0.1",()=>{
  const a=server.address();if(!a||typeof a==="string") throw new Error("No local address");
  console.log(`VERIFICATION_READY http://127.0.0.1:${a.port}/#${token}`);console.log(`VERIFICATION_EVIDENCE ${directory}`);
});
let sent=false;
const sourceCap=setInterval(()=>{
  if(cookie&&!sent&&t.running&&t.elapsedMs>=34500){sent=true;t.text("Elaine, the restaurant confirmed our dinner reservation for eight tonight. I'll see you there.","viewer message");}
  if(t.running&&t.elapsedMs>=sourceSeconds*1000){clearInterval(sourceCap);t.stop();console.log("VERIFICATION_SOURCE_SEALED",t.elapsedMs);}
},25);
const shutdown=()=>{clearInterval(sourceCap);clearTimeout(wallCap);void receiver.stop().finally(()=>server.close());};
const wallCap=setTimeout(shutdown,300000);
process.once("SIGINT",shutdown);process.once("SIGTERM",shutdown);
