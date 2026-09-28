/** A diagnostic, not a growth/baseline acceptance run. Exact late viewer inputs,
 * autonomous character choices, GUI configuration; no H3 or host NPC actions. */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { ApartmentSitcom } from "../demo/apartment-sitcom";
import { sitcomLaunchProfile } from "../demo/sitcom-launch-profile";
import { ELAINE_DAVID_CONTACT } from "../demo/cookie-character-history";
import { authorPhoneAppointmentSchedule } from "./phone-appointment-fixture";
import { snapshotAttentionSignals } from "../cognition/unresolved-attention";
import { snapshotActorContinuation } from "../cognition/actor-continuation";
import { snapshotOngoingActivity } from "../cognition/ongoing-activity";
import { chronicle } from "../cognition/simulation-chronicle";
import { serializeWorld } from "../persistence/world-persistence";
import { withSimulationTask } from "../runtime/task-scope";
import { MODEL_IDS } from "../llm/config";
import { BaselineEvidenceJournal, drainBaselineWork, finalizeBaselineObservation } from "./baseline-evidence-journal";

const directory=process.env.ARGOS_BASELINE_DIRECTORY;
const scheduledAppointment=process.argv.includes("--scheduled-appointment");
const appointment=process.argv.includes("--appointment")||scheduledAppointment;
const dinnerNotification=process.argv.includes("--dinner-notification"), endSimMs=dinnerNotification?120000:180000;
const profile={...sitcomLaunchProfile([]),...(appointment?{cookieHistory:"david-appointment" as const}:{}),
  ...(process.argv.includes("--snack-grievance")?{cookieGrievance:"snack" as const}:{})};
const contact={...ELAINE_DAVID_CONTACT,...(appointment?{context:"David and Elaine have been dating for two years. They agreed yesterday to meet today at 16:00 at Monk's Café for coffee."}:{})};
if(!directory||!process.argv.includes("--live"))throw Error("Use phone-attention-pass.cjs --live");
if(Object.values(MODEL_IDS).some(m=>m!=="gemini-3.8-flash"))throw Error("Model configuration changed");
const save=(name:string,value:unknown)=>writeFileSync(join(directory,name),JSON.stringify(value,null,2),{mode:0o600});
const journal=new BaselineEvidenceJournal(directory),controller=new AbortController(),began=performance.now();
let bed:ApartmentSitcom|undefined,reason:string|undefined,error:string|undefined,drained=false;
const disposers:Array<()=>void>=[];
const stop=(why:string)=>{if(reason)return;reason=why;controller.abort(Error(why));bed?.stop();};
// Production observers isolate callback exceptions. Latch an evidence-storage
// failure here so that isolation cannot turn a truncated audit into success.
const observe=(fn:()=>void)=>{try{fn();}catch(cause){error??=String(cause);stop("observer_failure");}};
process.on("SIGINT",()=>stop("operator_or_provider_bound"));process.on("SIGTERM",()=>stop("parent_bound"));
const timer=setTimeout(()=>stop("wall_bound"),240000);
try { await withSimulationTask(controller.signal,async()=>{
  bed=await ApartmentSitcom.create(profile);
  if(scheduledAppointment)authorPhoneAppointmentSchedule(bed);
  const t=bed; t.setPhoneContact(contact);
  save("configuration.json",{models:MODEL_IDS,profile,options:t.options,contact,endSimMs,fixture:dinnerNotification?"dinner-notification":scheduledAppointment?"scheduled-known-appointment":appointment?"known-appointment":"unexpected-date-claim"});
  save("initial-world.json",serializeWorld(t.sim.world,t.sim.god.systemRegistry));
  disposers.push(t.onEvent(e=>observe(()=>journal.append("episode-events.jsonl",e))));
  disposers.push(chronicle.subscribe(e=>observe(()=>journal.append("chronicle.jsonl",{...e,atSimMs:t.elapsedMs}))));
  await t.start();let first=false,second=false,last=-1;
  while(!controller.signal.aborted&&t.running&&t.elapsedMs<endSimMs){
    if(!first&&t.elapsedMs>=(dinnerNotification?34500:71000)){t.text(dinnerNotification?"Elaine, the restaurant confirmed our dinner reservation for eight tonight. I'll see you there.":"where are you Elaine?  We had a date!","viewer message");first=true;}
    if(!dinnerNotification&&!second&&t.elapsedMs>=119000){t.text("Hello?","second viewer message");second=true;}
    if(t.elapsedMs!==last){last=t.elapsedMs;journal.append("attention-frames.jsonl.gz",{atSimMs:last,
      attention:snapshotAttentionSignals(t.sim.world,t.ids.Elaine),continuation:snapshotActorContinuation(t.sim.world,t.ids.Elaine),
      activity:snapshotOngoingActivity(t.sim.world,t.ids.Elaine),goals:t.sim.getAgentGoals("Elaine"),state:t.snapshot({eventLimit:0})});}
    await sleep(100);
  }
}); }catch(cause){error=String(cause);}
finally{
  clearTimeout(timer);
  const checkpoint=(prefix:string)=>{if(bed){save(`${prefix}-world.json`,serializeWorld(bed.sim.world,bed.sim.god.systemRegistry));
    save(`${prefix}-state.json`,bed.snapshot());save(`${prefix}-runtime.json`,bed.sim.getRuntimeStatus());}};
  const failures=await finalizeBaselineObservation({checkpoint:()=>checkpoint("pre-stop"),
    lifecycle:stage=>journal.append("lifecycle.jsonl",{stage,atSimMs:bed?.elapsedMs}),
    stop:()=>{controller.abort(Error("Diagnostic complete"));bed?.stop();},
    drain:async()=>{await drainBaselineWork(()=>bed?.sim.drainPendingOperations(2000)??Promise.resolve(),(globalThis as any).__argosBaselineDrain);drained=true;},disposers});
  try{checkpoint("final");}catch(cause){error??=String(cause);}
  save("verdict.json",{diagnosticComplete:!reason&&!error&&!failures.length&&drained&&bed?.elapsedMs===endSimMs,
    reason,error,drained,failures,simMs:bed?.elapsedMs,wallMs:performance.now()-began,
    behavioralAcceptance:false,requiresQualitativeReview:true,notBaselineOrEndurance:true,journal:journal.snapshot()});
  process.exitCode=reason||error||failures.length||!drained?1:0;
}
