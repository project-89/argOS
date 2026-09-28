/** One running-world vertical slice. Builders/observers never select NPC actions.
 * Parent freezes source, accounts for actual HTTP attempts and owns hard limits. */
import "dotenv/config";
import {writeFileSync,appendFileSync} from "node:fs";
import {join} from "node:path";
import {setTimeout as sleep} from "node:timers/promises";
import {query,hasComponent,addComponent} from "bitecs";
import {createSimulation,type ArgosSimulation} from "../index";
import {Agent,Goal,Name,Needs,Removed,ObjectType} from "../ecs/components";
import {getDirectContainer,getRoomForEntity} from "../ecs/location";
import {registerSystem,getSystemDiagnosticCoverage} from "../ecs/dynamic-systems";
import {systemDiagnosticsAreClean} from "./system-diagnostic-evidence";
import {createIntentGoal} from "../cognition/cognition-system";
import {chronicle} from "../cognition/simulation-chronicle";
import {createSpiritRegistry,setGodAgent,getMessagesForGodAI} from "../spirits/spirit-registry";
import {createDynamicSpirit,getFactoryState} from "../spirits/spirit-factory";
import {runArchitectCognition,gatherArchitectContext,executeAllApprovedProposals} from "../spirits/architect-spirit";
import {getArchitectDiagnostics} from "../spirits/architect-diagnostics";
import {initializeGodAutopilot,enqueueSpiritMessages,getAutopilotInbox,runGodAutopilotCycle} from "../god/god-autopilot";
import {getPlaceBuildStatus} from "../engineering/place-materialization";
import {ObjectManager} from "../world/object-manager";
import {getCommittedEvents,subscribeCommittedEvents} from "../runtime/committed-events";
import {enableRoomRouteTopology} from "../runtime/room-routes";
import {withSimulationTask} from "../runtime/task-scope";
import {serializeWorld} from "../persistence/world-persistence";
import {MODEL_IDS} from "../llm/config";
import {observeBakeryOutcomes,hasBakeryServiceFeedback,bakeryFoodExists} from "./bakery-outcome";
import {prepareGeneratedServiceClosure,GENERATED_SERVICE_MEAL_INTENTION as SERVICE_MEAL_INTENTION,serviceExchangeOccurred} from "./service-closure-fixture";
import {recentBaselineThoughts} from "./baseline-evidence-journal";
import {workingMemoryEntityRef} from "../cognition/working-memory";

const directory=process.env.ARGOS_BASELINE_DIRECTORY;
if(!directory||!process.argv.includes("--live"))throw Error("Use the one-shot continued-growth parent");
if(Object.values(MODEL_IDS).some(model=>model!=="gemini-3.8-flash"))throw Error("Accepted model configuration changed");
const write=(name:string,value:unknown)=>writeFileSync(join(directory,name),JSON.stringify(value,null,2),{mode:0o600});
const append=(name:string,value:unknown)=>appendFileSync(join(directory,name),JSON.stringify(value)+"\n",{mode:0o600});
const controller=new AbortController(),began=performance.now();
let sim:ArgosSimulation|undefined,interval:ReturnType<typeof setInterval>|undefined,result:any={passed:false,stage:"initializing",reason:"in_progress"};
function stage(name:string){result={...result,stage:name};append("probe-stages.jsonl",{stage:name,atSimMs:sim?.world.time.elapsed??0,wallMs:Math.round(performance.now()-began)});}
const disposers:Array<()=>void>=[],closedGoals:any[]=[];
let observerError:string|undefined,stopReason:string|undefined;
function stop(reason:string){stopReason??=reason;controller.abort(Error(reason));sim?.stop();}
process.once("SIGINT",()=>stop("operator_or_provider_bound"));process.once("SIGTERM",()=>stop("parent_bound"));
const timer=setTimeout(()=>stop("wall_bound"),300000);
try {await withSimulationTask(controller.signal,async()=>{
  sim=await createSimulation({name:"A bakery that is not here yet",preset:"minimal",enableAI:true,narrativeMind:true,
    cognitionController:"priority",experienceReconsideration:true,enablePlanning:true,enableReflection:true,
    enableSpirits:false,godAutopilot:false,evolution:false,codingDaemons:false,enableNarrativeEngine:false,
    hostOfficeTools:false,enableServer:false,maxWorldEntities:20,dualLoop:true,ecsTickRate:2,ecsDeltaMs:500,timeScale:1,
    rooms:[{name:"Street",description:"A public street. No shops or food services have opened here yet."}],
    agents:[{name:"Ada",role:"visitor",startRoom:"Street",systemPrompt:"You are Ada, a practical, warm bicycle mechanic. You choose what to do from what you actually perceive.",
      past:{background:"I grew up above my aunt's bakery and now repair bicycles.",drives:["Look after myself","Be considerate to people I meet"],
        memories:[{recollection:"My aunt gave me warm bread after my first long day helping in the shop.",period:"Age eleven",emotionalTone:"warmth",importance:.8,
          selfBelief:"Small acts of care matter to me",meaning:"Food can be kindness",cues:["bakery","bread","hungry"],provenance:"authored-history"}]}}]});
  const live=sim,world=live.world,registry=live.god.systemRegistry,actor=[...query(world,[Agent,Name])].find(eid=>Name.value[eid]==="Ada")!;
  const street=getRoomForEntity(world,actor)!;enableRoomRouteTopology(world,{travelMs:4000});Needs.hunger[actor]=70;
  const goal=createIntentGoal(world,actor,SERVICE_MEAL_INTENTION,7);
  const spirits=createSpiritRegistry(world);setGodAgent(spirits,live.god.eid);
  initializeGodAutopilot(live.god,{minRunIntervalMs:0,minPriority:"normal"});
  const weaver=createDynamicSpirit(spirits,{name:"The Weaver",type:"architect",rank:"archangel",domain:"ecology",architectConfig:{
    canProposeSystems:false,canProposeComponents:false,canProposeRules:false,canProposeEntities:true,
    canExecuteDirectly:false,proposalApproval:"godai",maxProposalsPerCycle:1}})!;
  // A removed, non-food player prop is a permanent negative control, not a need.
  const removed=new ObjectManager(world).spawn("object",{name:"Discarded blue umbrella",containedIn:street})!;addComponent(world,removed,Removed);
  const removedBefore={eid:removed,name:Name.value[removed],holder:getDirectContainer(world,removed)};
  const removedKey=workingMemoryEntityRef(world,removed)!.key;
  disposers.push(chronicle.subscribe(event=>append("chronicle.jsonl",{...event,atSimMs:world.time.elapsed})));
  disposers.push(subscribeCommittedEvents(world,event=>{
    append("public-events.jsonl",event);
    if(event.targetKey===removedKey&&event.status==="succeeded"){
      observerError="Successful activity on the removed negative-control entity";stop("removed_entity_activity");
    }
  }));
  const observedEvents=new WeakSet<object>();
  registerSystem(registry,{name:"GrowthEvidenceObserver",description:"Eval-only read-only native completion observer",pseudocode:"Observe, never control",frequency:1,active:true,lastRun:0,
    compiledFn:()=>{for(const event of registry.events)if(event.type==="goal_completed"&&event.data.agent==="Ada"&&event.data.goal===SERVICE_MEAL_INTENTION&&!observedEvents.has(event)){
      observedEvents.add(event);closedGoals.push({...event,atSimMs:world.time.elapsed,room:getRoomForEntity(world,actor),hunger:Needs.hunger[actor]});append("native-goal-completions.jsonl",closedGoals.at(-1));
    }}});
  write("initial-world.json",serializeWorld(world,registry));
  await live.start();
  let lastFrame=-1;
  interval=setInterval(()=>{
    try {
      if(world.time.elapsed>=240000){stop("simulation_bound");return;}
      if(lastFrame===world.time.elapsed)return;lastFrame=world.time.elapsed;
      append("frames.jsonl",{atSimMs:world.time.elapsed,wallMs:Math.round(performance.now()-began),runtime:live.getRuntimeStatus(),
        actors:[...query(world,[Agent,Name])].filter(eid=>Agent.active[eid]).map(eid=>({eid,name:Name.value[eid],room:getRoomForEntity(world,eid),
          hunger:Needs.hunger[eid],goals:live.getAgentGoals(Name.value[eid]),thoughts:recentBaselineThoughts(live.getAgentThoughts(Name.value[eid]))}))});
    }catch(error){observerError=String(error);stop("observer_failed");}
  },500);
  const growthStarted=world.time.elapsed;stage("weaver_observing_need");
  const proposals=await runArchitectCognition(world,registry,spirits,weaver);
  write("initial-proposals.json",{atSimMs:world.time.elapsed,proposals,diagnostics:getArchitectDiagnostics(world)});
  const deliver=()=>{const receipts=getMessagesForGodAI(spirits);enqueueSpiritMessages(live.god,receipts,id=>spirits.spirits.get(id)?.definition.name??`Spirit ${id}`);
    append("god-receipts.jsonl",{atSimMs:world.time.elapsed,receipts,inbox:getAutopilotInbox(live.god)});return receipts;};
  if(proposals.length!==1)throw Error("Expected one admitted purposeful place; no replacement attempt");
  stage("god_reviewing_proposal");deliver();const approval=await runGodAutopilotCycle(live.god);write("god-approval.json",{approval,thinking:live.god.thinkingLog,atSimMs:world.time.elapsed});
  if(!approval.executed||proposals[0].status!=="approved")throw Error("God did not approve a current grounded proposal");
  stage("native_construction");const buildResult=await executeAllApprovedProposals(world,registry,{maxProposals:1});
  const builds=getPlaceBuildStatus(world,registry),place=builds.length===1?builds[0]:undefined;
  const room=place?.members.find(m=>m.id==="room")?.eid,bakers=place?.members.filter(m=>m.type==="agent")??[];
  const objects=new ObjectManager(world),foodIds=place?.members.filter(m=>m.type==="object"&&objects.hasTrait(m.eid,"edible")).map(m=>m.eid)??[];
  write("construction.json",{atSimMs:world.time.elapsed,growthStarted,buildResult,builds,world:serializeWorld(world,registry)});
  if(room===undefined||bakers.length!==1||foodIds.length<2||buildResult.failed.length)throw Error("Generated place lacks one resident and two finite fresh servings");
  const support=place!.support;
  if(support.status==="unassessed"||foodIds.some(eid=>{
    const member=place!.members.find(m=>m.eid===eid)!;
    return !support.requirements.some(r=>r.kind==="initial_custody"&&r.item===member.id&&r.holder===bakers[0].id)
      || !place!.initialCustody.some(c=>c.itemKey===member.key&&c.holderKey===bakers[0].key);
  }))throw Error("Each serving needs an original authored custody requirement and native assembly receipt");
  const service=prepareGeneratedServiceClosure(world,registry,{actor,goal,room,baker:bakers[0].eid,foodIds});write("prospective-service-contract.json",service);
  const foodRefs=place!.members.filter(member=>foodIds.includes(member.eid));
  const outcomes=observeBakeryOutcomes(world,actor,foodIds,row=>append("native-outcomes.jsonl",row),{providerId:bakers[0].eid,roomId:room});disposers.push(outcomes.stop);
  stage("independent_service_activity");
  const snapshotOutcome=()=>({handoffs:outcomes.evidence.handoffs,sharedReleases:outcomes.evidence.sharedReleases,
    serviceMeals:outcomes.evidence.serviceMeals,meals:outcomes.evidence.meals,errors:outcomes.errors});
  const feedback:Awaited<ReturnType<typeof gatherArchitectContext>>[]=[];let count=0;
  while(!controller.signal.aborted){
    result={...result,outcomes:snapshotOutcome(),goal:{eid:goal,status:Goal.status[goal],progress:Goal.progress[goal]},hunger:Needs.hunger[actor],closedGoals};
    const next=outcomes.evidence.handoffs.length+outcomes.evidence.sharedReleases.length+outcomes.evidence.meals.length;
    if(next!==count){count=next;const context=await gatherArchitectContext(world,registry);feedback.push(context);append("outcome-feedback.jsonl",{atSimMs:world.time.elapsed,context});}
    if(outcomes.evidence.serviceMeals.length && Goal.status[goal]==="completed" && serviceExchangeOccurred(world,actor,bakers[0].eid))break;
    if(!outcomes.evidence.serviceMeals.length && foodRefs.every(food=>!bakeryFoodExists(world,food)))
      throw Error("service_gate_impossible: all finite food identities consumed without a qualifying provider-to-meal chain");
    await sleep(100);
  }
  controller.signal.throwIfAborted();
  const followupStarted=world.time.elapsed;stage("weaver_reviewing_outcomes");
  const followup=await runArchitectCognition(world,registry,spirits,weaver);const receipts=deliver();
  stage("god_reviewing_outcomes");const reflection=await runGodAutopilotCycle(live.god);
  write("followup.json",{followupStarted,atSimMs:world.time.elapsed,followup,receipts,reflection,thinking:live.god.thinkingLog});
  const receiptHasMeal=outcomes.evidence.serviceMeals.some(meal=>receipts.some(r=>r.data?.recentEvents?.some((e:any)=>e.id===meal.eventId&&e.status==="succeeded")));
  const removedIntact=hasComponent(world,removed,Removed)&&Name.value[removed]===removedBefore.name&&getDirectContainer(world,removed)===removedBefore.holder
    && [...query(world,[Name])].filter(eid=>Name.value[eid]===removedBefore.name).length===1;
  const nativeCompletion=live.getAgentGoals("Ada").find((g:any)=>g.eid===goal||g.description===SERVICE_MEAL_INTENTION);
  const systemDiagnostics=getSystemDiagnosticCoverage(registry);
  result={stage:"finished",reason:"gates_evaluated",passed:outcomes.evidence.serviceMeals.length>0&&Goal.status[goal]==="completed"&&Goal.progress[goal]===100
      && serviceExchangeOccurred(world,actor,bakers[0].eid)&&closedGoals[0]?.room===room
      && hasBakeryServiceFeedback(outcomes.evidence,feedback)&&receiptHasMeal&&reflection.executed&&removedIntact
      && world.time.elapsed>growthStarted&&closedGoals.length===1&&outcomes.errors.length===0&&!observerError&&systemDiagnosticsAreClean(systemDiagnostics),
    systemDiagnostics,approval,buildResult,outcomes:snapshotOutcome(),
    goal:{eid:goal,status:Goal.status[goal],progress:Goal.progress[goal],nativeCompletion},hunger:Needs.hunger[actor],
    receiptHasMeal,removedIntact,reflection,proposals:getFactoryState().pendingProposals,
    runtime:live.getRuntimeStatus(),health:live.getSystemHealth(),closedGoals,
    limitations:"One generated service and feedback turn, not open-ended world growth. Prospective native target binding is eval-owned; no host stock assignment, NPC actions, semantic goal rewrite or completion."};
});}catch(error){result={...result,passed:false,reason:stopReason??"probe_failed",error:String(error)};}
finally{
  if(interval)clearInterval(interval);clearTimeout(timer);
  if(sim){write("final-world.json",serializeWorld(sim.world,sim.god.systemRegistry));write("runtime-before-stop.json",sim.getRuntimeStatus());sim.stop();}
  controller.abort(Error("Probe finished"));
  const drain=(globalThis as any).__argosBaselineDrain;
  let drainTimer:ReturnType<typeof setTimeout>|undefined;
  const drained=typeof drain==="function"?await Promise.race([drain().then(()=>true),new Promise<boolean>(resolve=>{drainTimer=setTimeout(()=>resolve(false),2000);})]):false;
  if(drainTimer)clearTimeout(drainTimer);
  disposers.forEach(dispose=>dispose());
  write("verdict.json",{result,stopReason,observerError,drained,wallMs:Math.round(performance.now()-began),simMs:sim?.world.time.elapsed});
  process.exitCode=result.passed&&!stopReason&&!observerError?0:1;
}
