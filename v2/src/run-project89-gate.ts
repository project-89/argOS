/** Bounded real-model phone gate. Operator messages only; no authored NPC actions. */
import "dotenv/config";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { format } from "node:util";
import { resolve, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { ApartmentSitcom } from "./demo/apartment-sitcom";
import { sitcomLaunchProfile } from "./demo/sitcom-launch-profile";
import { evaluateSitcom } from "./demo/sitcom-report";
import { serializeWorld } from "./persistence/world-persistence";
import { backgroundThinkingLevel } from "./cognition/background-reasoning";
import { MODEL_IDS } from "./llm/config";
import { requestProject89Influence, project89SpiritDiagnostics } from "./demo/project89";
import { narrativeOpportunityStatuses } from "./spirits/narrative-opportunities";
import { getCurrentObservedProposals, getObservedProposalDiagnostics } from "./spirits/architect-spirit";
import { enableControlLoopDiagnostics, getControlLoopDiagnostics } from "./runtime/control-loop-diagnostics";
import { snapshotActorContinuation } from "./cognition/actor-continuation";
import { snapshotOngoingActivity } from "./cognition/ongoing-activity";
import { getReflectionQuestions } from "./cognition/reflection-questions";
import { getRelationTargets, hasComponent } from "bitecs";
import { HasGoal, HasPlan } from "./ecs/relations";
import { Goal, GoalLifecycle, Plan } from "./ecs/components";

if (!process.argv.includes("--live")) throw new Error("Explicit --live required; uses the configured cognition provider, no H3.");
const delayedVisitor=process.argv.includes("--delayed-visitor");
const visitorRequested=process.argv.includes("--visitor");
if(delayedVisitor && !visitorRequested) throw new Error("--delayed-visitor requires --visitor");
const visitorRequestAtMs=delayedVisitor?120_000:10_000;
const modelConfig={...MODEL_IDS,backgroundThinking:backgroundThinkingLevel(), characterHistory:process.argv.includes("--formative-history")?"formative":"legacy",
  visitorTiming:visitorRequested?delayedVisitor?"delayed_120s":"baseline_10s":"none",visitorRequestAtMs:visitorRequested?visitorRequestAtMs:null};
const visitorSuggestion="Offer a grounded story opportunity: create Morpheus, a visitor in a dark coat and sunglasses, on the existing Street. He knows about Project 89 and wants to visit Jerry and George to discuss it. Give him his own motive and let him navigate the existing connected rooms and introduce himself. Do not place him directly in their apartment or script anyone else's decisions, knowledge, speech, or reactions. This is a proposed inhabitant, not an event that has already happened.";
const sceneChanges: {atSimMs:number;actors:{id:number;name:string;room:string}[]}[]=[];
const cognitionTrace: unknown[]=[];
const opportunityChanges: unknown[]=[];
const godQueueChanges: unknown[]=[];
let lastCognition="",lastOpportunity="",lastGodQueue="";
await mkdir(resolve("recordings"), {recursive:true});
const directory=await mkdtemp(resolve("recordings","project89-gate-"));
const original={log:console.log,warn:console.warn,error:console.error};
const log=createWriteStream(join(directory,"runtime.log"),{flags:"wx",mode:0o600});
let bytes=0;
for(const key of ["log","warn","error"] as const) console[key]=(...args:unknown[])=>{
  const line=format(...args)+"\n"; if(bytes<8_000_000){log.write(line);bytes+=Buffer.byteLength(line);}
};
original.log(`PROJECT89_GATE ${directory}`);
let t:ApartmentSitcom|undefined, failure:string|undefined, interrupted=false;
const interrupt=()=>{interrupted=true;t?.stop();};process.once("SIGINT",interrupt);process.once("SIGTERM",interrupt);
try {
  t=await ApartmentSitcom.create(sitcomLaunchProfile(["--project89",...(process.argv.includes("--formative-history")?["--formative-history"]:[])]));
  if(process.argv.includes("--trace-cognition")) enableControlLoopDiagnostics(t.sim.world);
  t.onEvent(e=>{if(e.disposition?.type==="decision_rejected" || ["phone_read","reply_delivered"].includes(e.kind))
    original.log(JSON.stringify({at:e.atSimMs,actor:e.actor,kind:e.kind,field:e.disposition?.schemaField}));});
  await t.start(); const began=performance.now(); let first=false,followup=false,visitor=false,lastScene="";
  while(!interrupted && t.running && t.elapsedMs<180_000 && performance.now()-began<190_000){
    // Opt-in local operator evidence only; never fed back into NPC prompts.
    if(process.argv.includes("--trace-cognition")){
      const world=t.sim.world,eid=t.ids.Jerry;
      const state={continuation:snapshotActorContinuation(world,eid),activity:snapshotOngoingActivity(world,eid),questions:getReflectionQuestions(world,eid),
        goals:getRelationTargets(world,eid,HasGoal).filter(id=>hasComponent(world,id,Goal)).map(id=>({id,
          description:Goal.description[id],status:Goal.status[id],priority:Goal.priority[id],
          deferral:GoalLifecycle.deferredJson[id],review:GoalLifecycle.handoffReviewJson[id]})),
        plans:getRelationTargets(world,eid,HasPlan).filter(id=>hasComponent(world,id,Plan)).map(id=>({id,
          goal:Plan.goalEid[id],status:Plan.status[id],step:Plan.currentStep[id],steps:Plan.steps[id]}))};
      const key=JSON.stringify(state);
      if(key!==lastCognition){cognitionTrace.push({atSimMs:t.elapsedMs,...JSON.parse(key)});lastCognition=key;}
    }
    if(visitorRequested && !visitor && t.elapsedMs>=visitorRequestAtMs){
      const receipt=requestProject89Influence(t.sim.world,visitorSuggestion);
      original.log(JSON.stringify({at:t.elapsedMs,kind:"visitor_requested",receipt}));visitor=true;
    }
    if(visitorRequested){
      const autopilot=t.sim.god.autopilot;
      const queue={lastRunAt:autopilot?.lastRunAt,lastBatchKind:autopilot?.lastBatchKind,failures:autopilot?.consecutiveFailures,
        failureKind:autopilot?.lastError ? /expired/i.test(autopilot.lastError)?"expired":/timeout/i.test(autopilot.lastError)?"timeout":"other" : undefined,
        inbox:autopilot?.inbox.map(m=>({id:m.id,priority:m.priority,proposalId:typeof m.data?.proposal?.id==="string"?m.data.proposal.id:undefined}))};
      const queueKey=JSON.stringify(queue);
      if(queueKey!==lastGodQueue){godQueueChanges.push({atSimMs:t.elapsedMs,...queue});lastGodQueue=queueKey;}
      const currentIds=new Set(getCurrentObservedProposals(t.sim.world).map(p=>p.id));
      const proposalDiagnostics=process.argv.includes("--trace-cognition")?getObservedProposalDiagnostics(t.sim.world):[];
      const statuses=narrativeOpportunityStatuses(t.sim.world).map(row=>({...row,
        ...(row.proposalId?{currentlyAdmissible:currentIds.has(row.proposalId),
          ...(proposalDiagnostics.length?{admissionDiagnostic:proposalDiagnostics.find(p=>p.id===row.proposalId)}:{})}:{})})),statusKey=JSON.stringify(statuses);
      if(statusKey!==lastOpportunity){opportunityChanges.push({atSimMs:t.elapsedMs,statuses});lastOpportunity=statusKey;}
      const actors=t.scenes().flatMap(scene=>scene.actors.map(actor=>({id:actor.id,name:actor.name,room:scene.room.name})));
      const key=JSON.stringify(actors);
      if(key!==lastScene){sceneChanges.push({atSimMs:t.elapsedMs,actors});lastScene=key;}
    }
    if(!first && t.elapsedMs>=26_000){t.text("Jerry, look in the drawer beneath your couch. There is a card inside. What does it say? Text me back.");first=true;}
    if(!followup && t.snapshot().phone.some(m=>m.direction==="out" && m.status==="delivered")){
      t.text("I am outside your world. What would convince you this is real? Text me one question.");followup=true;
    }
    await sleep(250);
  }
} catch(error){failure=String(error);process.exitCode=1;}
finally {
  t?.stop();
  if(t){const snapshot=t.snapshot();await writeFile(join(directory,"result.json"),JSON.stringify({modelConfig,failure,interrupted,snapshot,evaluation:evaluateSitcom(t),
    ...(process.argv.includes("--trace-cognition")?{controlLoopDiagnostics:getControlLoopDiagnostics(t.sim.world)}:{}),
    ...(cognitionTrace.length?{cognitionTrace}:{}),
    ...(visitorRequested?{visitor:{godEid:t.sim.god.eid,godReviews:t.sim.god.thinkingLog.slice(-12),godQueueChanges,
      godReviewFailures:t.sim.god.autopilot?.consecutiveFailures,godDiscardedMessages:t.sim.god.autopilot?.discardedMessages,
      suggestion:visitorSuggestion,opportunities:narrativeOpportunityStatuses(t.sim.world),opportunityChanges,spirits:project89SpiritDiagnostics(t.sim.world),sceneChanges,scenes:t.scenes()}}:{})},null,2),{flag:"wx",mode:0o600});
    await writeFile(join(directory,"world.json"),JSON.stringify(serializeWorld(t.sim.world,t.sim.god.systemRegistry)),{flag:"wx",mode:0o600});}
  if(failure)await writeFile(join(directory,"failure.json"),JSON.stringify({failure}),{flag:"wx",mode:0o600});
  Object.assign(console,original);await new Promise<void>(done=>log.end(done));
  process.removeListener("SIGINT",interrupt);process.removeListener("SIGTERM",interrupt);
  original.log(`PROJECT89_GATE_SAVED ${directory}`);
}
