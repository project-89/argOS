/** Opt-in, one-shot usefulness probes. Each invocation owns an isolated world.
 * Parent owns combined limits; this worker counts HTTP attempts, not just tasks.
 * No H3, model overrides, forced NPC decisions or retries of failed trials. */
import "dotenv/config";
import { systemDiagnosticsAreClean } from "./system-diagnostic-evidence";
import fs from "node:fs";
import path from "node:path";
import { query } from "bitecs";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../ecs/prefabs";
import { Name, Agent, ObjectType, ObjectState, Traits, Needs, Goal } from "../ecs/components";
import { getRoomForEntity, listDirectContents } from "../ecs/location";
import { createSystemRegistry, runSystems, getSystemDiagnosticCoverage } from "../ecs/dynamic-systems";
import { attachToEntity } from "../ecs/component-registry";
import { createEntityRegistry, registerEntity } from "../ecs/tools";
import { startCommittedEvents, getCommittedEvents, stopCommittedEvents } from "../runtime/committed-events";
import { withSimulationTask } from "../runtime/task-scope";
import { advanceSimulationTimeline } from "../runtime/simulation-timeline";
import { enableRoomRouteTopology } from "../runtime/room-routes";
import { configureWorldConstructionBudget } from "../runtime/world-construction-budget";
import { createSpiritRegistry, createSpirit } from "../spirits/spirit-registry";
import { createDynamicSpirit } from "../spirits/spirit-factory";
import { runArchitectCognition, gatherArchitectContext } from "../spirits/architect-spirit";
import { getArchitectDiagnostics } from "../spirits/architect-diagnostics";
import { getPlaceBuildStatus } from "../engineering/place-materialization";
import { requestRoomPopulationForRoom, populateRoomViaSchema } from "../spirits/steward-spirit";
import { runArtificerWithTools } from "../spirits/artificer-spirit";
import { CodingDaemon } from "../engineering/coding-daemon";
import { geminiBuilder } from "../engineering/builders";
import { createGodAgent } from "../god/god-agent";
import { enqueueSpiritMessages, getAutopilotInbox } from "../god/god-autopilot";
import { setGodAgent, getMessagesForGodAI } from "../spirits/spirit-registry";
import { NarratorDefinition } from "../spirits/narrator-spirit";
import { runSpiritCognition } from "../spirits/spirit-cognition";
import { requestRule, generateRuleProposal, approveRule, runLawgiverCycle } from "../spirits/rules-spirit";
import { ObjectManager } from "../world/object-manager";
import { RulesEngine } from "../world/rules-engine";
import { worldSchema } from "../world/schema";
import { executeAffordance } from "../world/effect-executor";
import { createIntentGoal, executeActions, runCognitionCycle } from "../cognition/cognition-system";
import { getAgentMemory } from "../cognition/agent-mind";
import { MODEL_IDS } from "../llm/config";
import { ProbeRequestDrain } from "./probe-request-drain";
import { observeBakeryOutcomes, hasBakeryOutcomeFeedback } from "./bakery-outcome";
import { prepareServiceClosure, serviceExchangeOccurred, SERVICE_MEAL_INTENTION } from "./service-closure-fixture";
import { getSocialDialogue } from "../cognition/social-memory";

const [mode, directory, budgetRaw] = process.argv.slice(2);
if (!['weaver', 'steward', 'tinker', 'narrator', 'lawgiver', 'integration', 'bakery', 'service'].includes(mode) || !directory
  || !Number.isSafeInteger(Number(budgetRaw)) || Number(budgetRaw) < 1 || Number(budgetRaw) > (['bakery','service'].includes(mode)?64:24))
  throw Error("Explicit probe, evidence directory and remaining request budget required");
const output = path.resolve(directory), budget = Number(budgetRaw), controller = new AbortController();
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const write = (file: string, value: unknown) => fs.writeFileSync(path.join(output, file), JSON.stringify(value, null, 2), { mode: 0o600 });
const append = (file: string, value: unknown) => fs.appendFileSync(path.join(output, file), JSON.stringify(value) + "\n", { mode: 0o600 });
let calls = 0, active = 0;
const pendingRequests = new ProbeRequestDrain();
const requestRecords: unknown[] = [], nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.protocol !== "https:" || url.hostname !== "generativelanguage.googleapis.com") throw Error("Probe network boundary");
  controller.signal.throwIfAborted();
  if (calls >= budget) { controller.abort(Error("Provider request budget exhausted")); throw controller.signal.reason; }
  const id = ++calls, began = performance.now(); active++;
  const settled=pendingRequests.begin();
  // Never record URL queries, headers, credentials or environment values.
  let body: unknown; try { body = JSON.parse(String(init?.body ?? "null")); } catch { body = "unparsed"; }
  append("provider.ndjson", { id, phase: "issued", endpoint: url.pathname, body });
  try {
    const response = await nativeFetch(input, { ...init, signal: AbortSignal.any([controller.signal,
      AbortSignal.timeout(60000), ...(init?.signal ? [init.signal] : [])]) });
    const result = await response.text();
    const receipt = { id, phase: "settled", status: response.status, durationMs: Math.round(performance.now() - began), body: result };
    requestRecords.push(receipt); append("provider.ndjson", receipt);
    return new Response(result, { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (error) {
    append("provider.ndjson", { id, phase: "failed", durationMs: Math.round(performance.now() - began), error: String(error) }); throw error;
  } finally { active--;settled(); }
};
const world = createArgosWorld(`Bounded ${mode} usefulness`); initializePrefabs(world); startCommittedEvents(world);
world.meta.aiEnabled = true; world.meta.narrativeMind = true; world.meta.timedActions = true; world.meta.timedSpeech = true;
configureWorldConstructionBudget(world, 30);
const registry = createSystemRegistry(), spirits = createSpiritRegistry(world), entities = createEntityRegistry();
let codingDaemon: CodingDaemon | undefined;
const god = ['narrator','integration','bakery','service'].includes(mode) ? createGodAgent(world,{name:'God',worldName:world.meta.name}) : undefined;
if(god)setGodAgent(spirits,god.eid);
function deliverToGod() {
  const receipts=getMessagesForGodAI(spirits);
  if(god)enqueueSpiritMessages(god,receipts,eid=>spirits.spirits.get(eid)?.definition.name ?? 'Unknown spirit');
  const inbox=god ? getAutopilotInbox(god) : [];
  return {receipts,receivedIds:inbox.map(message=>message.id),consumed:!!receipts.length && receipts.every(receipt=>inbox.some(message=>message.id===receipt.id))};
}
const room = createRoomEntity(world, { name: mode === 'steward' ? 'Small bakery' : 'Street', description: mode === 'steward'
  ? 'A small bakery serving fresh food to hungry visitors. No decorative substitutes for edible stock.' : 'A public street with no shops yet.' });
const actor = createAgentEntity(world, { name: 'Ada', role: 'visitor', roomId: room,
  systemPrompt: 'You are Ada, a practical, warm person. You choose what to do from what you actually perceive.',
  past: { background: 'I grew up above my aunt’s bakery and now repair bicycles.', drives: ['Look after myself', 'Be considerate to people I meet'],
    memories: [{ recollection: 'My aunt gave me warm bread after my first long day helping in the shop.', period: 'Age eleven',
      emotionalTone: 'warmth', importance: .8, selfBelief: 'Small acts of care matter to me', meaning: 'Food can be kindness', cues: ['bakery', 'bread', 'hungry'], provenance: 'authored-history' }] } });
for (const eid of query(world, [Name])) registerEntity(entities, Name.value[eid], eid);
const initial = () => ({ time: world.time.elapsed, entities: [...query(world, [Name])].map(eid => ({ eid, name: Name.value[eid],
  room: getRoomForEntity(world, eid), objectType: ObjectType.typeId[eid], state: ObjectState.current[eid], traits: Traits.active[eid] })),
  events: getCommittedEvents(world).events, goals: [...query(world, [Goal])].map(eid => ({ eid, status: Goal.status[eid], progress: Goal.progress[eid] })) });
const advance = (ms: number) => { if (world.time.elapsed + ms > 120000) throw Error('Simulation budget exceeded');
  advanceSimulationTimeline(world, ms, { integrate(delta) { runSystems(world, registry, world.time.tick, delta); } }); };
async function probe(): Promise<unknown> {
  if (mode === 'lawgiver') {
    const objects = new ObjectManager(world), engine = new RulesEngine(world, objects);
    const selected = objects.spawn('object', { name: 'Cloth on drying rack', containedIn: room })!;
    const control = objects.spawn('object', { name: 'Wet cloth in closed hamper', containedIn: room })!;
    objects.addTrait(selected, 'wet'); objects.addTrait(selected, 'on_drying_rack'); objects.addTrait(control, 'wet');
    const idle = await runLawgiverCycle(spirits), idleCalls = calls;
    const request = requestRule('Implement drying cloth on a drying rack.', { worldTheme: 'Everyday physical world',
      desiredBehavior: 'On tick, an object with both wet and on_drying_rack traits becomes dry (remove wet and add dry). A wet object not on the rack must remain wet. Use native declarative trait effects; no private or agency changes.' }, 'bounded host request', world);
    const proposed = await generateRuleProposal(request); write('proposal.json', proposed);
    const approved = !!proposed && approveRule(proposed.id); engine.processTick(1);
    const matching = objects.hasTrait(selected, 'dry') && !objects.hasTrait(selected, 'wet');
    const unchangedControl = objects.hasTrait(control, 'wet') && !objects.hasTrait(control, 'dry');
    return { passed: approved && matching && unchangedControl && idleCalls === 0, approved, matching, unchangedControl, idle,
      generatedRule: proposed && worldSchema.getRule(proposed.name) };
  }
  if (mode === 'steward') {
    const request = requestRoomPopulationForRoom(world, room, { roomType: 'bakery', context: {
      worldTheme: 'Contemporary small town', inhabitants: ['Ada'], primaryFunction: 'Serve an actually edible fresh meal to a hungry visitor.' }, constraints: { maxItems: 12 } });
    const populated = await populateRoomViaSchema(world, request, room); write('population.json', populated);
    const objects = new ObjectManager(world), food = listDirectContents(world, room).find(eid => objects.hasTrait(eid, 'edible'));
    const before = Needs.hunger[actor]; let result: unknown;
    if (food !== undefined) result = executeAffordance('eat', { world, actorEid: actor, targetEid: food, worldSchema, registry: entities });
    return { passed: !!populated && food !== undefined && (result as any)?.success === true && Needs.hunger[actor]>=0 && Needs.hunger[actor]<=100, populated, food, result,
      hungerBefore: before, hungerAfter: Needs.hunger[actor], nativeStateAfter: food === undefined ? undefined : ObjectState.current[food],
      evidenceKind: 'Real-model population, host-dispatched native capability control; not independent NPC choice' };
  }
  if (mode === 'tinker') {
    let seed=true;
    codingDaemon=new CodingDaemon(world,registry,{directory:path.join(output,'managed-repairs'),maxTotalJobs:2,timeoutMs:60000},async input=>{
      if(!seed)return geminiBuilder(input);
      seed=false;
      fs.mkdirSync(path.join(input.directory,'systems'),{recursive:true});fs.mkdirSync(path.join(input.directory,'components'),{recursive:true});
      fs.writeFileSync(path.join(input.directory,'components/ProbeCounter.json'),JSON.stringify({name:'ProbeCounter',description:'Public diagnostic counter',fields:{value:{type:'number',default:0}}}));
      fs.writeFileSync(path.join(input.directory,'systems/ProbeCounter.ts'),'export function run(ctx:any){for(const id of ctx.query("ProbeCounter")){const value=ctx.get(id,"ProbeCounter","value");if(value>0 && value<100)throw new Error("Injected counter failure after first tick");ctx.set(id,"ProbeCounter","value",Math.min(100,value+1));}}');
      fs.writeFileSync(path.join(input.directory,'release.json'),JSON.stringify({version:1,components:['components/ProbeCounter.json'],
        systems:[{name:'ProbeCounter',description:'Increment public counter by one per logical tick, capped at 100',file:'systems/ProbeCounter.ts',frequency:1,reads:['ProbeCounter'],writes:['ProbeCounter.value']}],
        tests:[0,100].map(value=>({name:`counter boundary ${value}`,system:'ProbeCounter',entities:[{id:1,components:{ProbeCounter:{value}}}],ticks:1,deltaMs:500,expect:[{entity:1,component:'ProbeCounter',field:'value',equals:Math.min(100,value+1)}]}))}));
    });
    await codingDaemon.initialize();codingDaemon.enqueue({source:'bounded fault fixture',instruction:'Increment the public ProbeCounter by one per logical tick, capped at 100. A latent fault is deliberately introduced for this maintenance evaluation.'});
    await codingDaemon.pump();codingDaemon.commitReady(0);
    const { getDynamicComponentValue } = await import('../ecs/dynamic-components');
    attachToEntity(world, room, 'ProbeCounter', { value: 0 });
    for (let n = 0; n < 2; n++) {advance(500);await codingDaemon.settle();codingDaemon.commitReady(world.time.tick);}
    write('fault-before.json', { errors: registry.errors, systems: [...registry.systems.values()].map(s => ({ ...s, compiledFn: undefined })) });
    const tinker = createDynamicSpirit(spirits, { name: 'The Tinker', type: 'artificer', rank: 'archangel', domain: 'guardian' })!;
    const report = await runArtificerWithTools(world, registry, spirits, tinker); write('maintenance-report.json', report);
    const before = getDynamicComponentValue('ProbeCounter', room, 'value');
    await codingDaemon.pump();write('validated-jobs.json',codingDaemon.getStatus());codingDaemon.commitReady(world.time.tick);
    for(let n=0;n<3;n++){advance(500);await codingDaemon.settle();codingDaemon.commitReady(world.time.tick);}
    const after = getDynamicComponentValue('ProbeCounter', room, 'value'), system = registry.systems.get('ProbeCounter');
    const repair=codingDaemon.getStatus().jobs.find(job=>job.repairOfJobId),status=repair && codingDaemon.getRepairStatus(repair.id);
    return { passed: status?.recovered===true && typeof after==='number' && after>(before as number), report, before, after,
      active:system?.active,remainingErrors:registry.errors,code:system?.code,status,jobs:codingDaemon.getStatus(),
      evidenceKind:'Managed native failure → shared Tinker/daemon repair queue → real-model coding → validated release → changed native ticks. Not legacy system migration.' };
  }
  if (mode === 'narrator') {
    const goal = createIntentGoal(world, actor, 'Find somewhere to eat and talk to a local baker', 7);
    const narrator = createSpirit(spirits, NarratorDefinition)!;
    const before = initial();
    const output = await runSpiritCognition(narrator, world, entities, spirits);
    const after = initial();
    const delivery=deliverToGod();
    return { passed: delivery.consumed && after.events.length===before.events.length && getRoomForEntity(world,actor)===room
      && Goal.status[goal]==='active' && Goal.progress[goal]===0, requiresQualitativeReview: true, output, before, after, goal,delivery,
      noInventedNativeEvents: after.events.length === before.events.length,
      noForcedMovement: getRoomForEntity(world, actor) === room, goalUnchanged: Goal.status[goal] === 'active' && Goal.progress[goal] === 0 };
  }
  enableRoomRouteTopology(world, { travelMs: 4000 });
  const goal = createIntentGoal(world, actor, mode==='service'?SERVICE_MEAL_INTENTION:'Visit a local bakery, meet the baker and eat fresh food there', 7);
  Needs.hunger[actor] = 70;
  const weaver = createDynamicSpirit(spirits, { name: 'The Weaver', type: 'architect', rank: 'archangel', domain: 'ecology',
    architectConfig: { canProposeSystems: false, canProposeComponents: false, canProposeRules: false, canProposeEntities: true,
      canExecuteDirectly: true, proposalApproval: 'auto', maxProposalsPerCycle: 1 } })!;
  const proposals = await runArchitectCognition(world, registry, spirits, weaver);
  write('construction.json', { proposals, builds: getPlaceBuildStatus(world, registry), diagnostics: getArchitectDiagnostics(world), beforeChoice: initial() });
  if (!getPlaceBuildStatus(world, registry).length) return { passed: false, reason: 'No admitted purposeful place', proposals, diagnostics: getArchitectDiagnostics(world) };
  const actions: unknown[] = [];
  const objects = new ObjectManager(world);
  const foodIds = [...query(world, [ObjectType])].filter(eid => objects.hasTrait(eid, 'edible'));
  let service: ReturnType<typeof prepareServiceClosure> | undefined;
  if(mode==='service'){
    const builds=getPlaceBuildStatus(world,registry);
    const place=builds.length===1?builds[0]:undefined,root=place?.members.find(member=>member.id==='room');
    const bakers=place?.members.filter(member=>member.type==='agent')??[];
    if(!root || bakers.length!==1 || !foodIds.length || foodIds.some(id=>!place!.members.some(member=>member.eid===id)))
      throw Error('Generated service place requires one identifiable resident and real local food');
    service=prepareServiceClosure(world,registry,{actor,goal,room:root.eid,baker:bakers[0].eid,foodIds});
    write('service-setup.json',service);
  }
  const outcomes = observeBakeryOutcomes(world, actor, foodIds, row => append('native-outcomes.ndjson', row));
  const outcomeFeedback: Awaited<ReturnType<typeof gatherArchitectContext>>[] = [];
  let capturedOutcomes=0;
  const captureOutcomeFeedback=async()=>{
    const count=outcomes.evidence.handoffs.length+outcomes.evidence.meals.length;
    if(count===capturedOutcomes)return;
    capturedOutcomes=count;
    const context=await gatherArchitectContext(world,registry);
    outcomeFeedback.push(context);append('outcome-feedback.ndjson',{atSimMs:world.time.elapsed,context});
  };
  // This is the normal sensory/cognition/executor path, bounded. No
  // narrator commands, choosing model answers, or teleporting to prove utility.
  for (let n = 0; n < (['bakery','service'].includes(mode)?22:mode==='integration'?20:8) && calls < budget - 1; n++) {
    advance(5000);
    await captureOutcomeFeedback();
    const residents = [...query(world, [Agent])].filter(eid => Agent.active[eid] && eid !== god?.eid).slice(0, 3);
    const next = await runCognitionCycle(world, registry, { agentEids: residents, maxAgents: 1, enablePlanning: false, tick: world.time.tick });
    actions.push(...next); executeActions(world, next, registry); write('choices.json', actions);
    if (service ? outcomes.evidence.handoffThenMeal && Goal.status[goal]==='completed' && serviceExchangeOccurred(world,actor,service.baker)
      : mode==='bakery' ? outcomes.evidence.handoffThenMeal : outcomes.evidence.meals.length>0) break;
  }
  if(world.time.elapsed+10000<=120000)advance(10000);
  await captureOutcomeFeedback();
  const feedback = await gatherArchitectContext(world, registry);
  const delivery=god?deliverToGod():undefined;
  write('feedback.json', feedback); write('actor-memory.json', getAgentMemory(world, actor));
  outcomes.stop();
  const ate=outcomes.evidence.meals.length>0;
  const feedbackHasMeal=hasBakeryOutcomeFeedback(outcomes.evidence,outcomeFeedback,false);
  const feedbackHasMealAndHandoff=hasBakeryOutcomeFeedback(outcomes.evidence,outcomeFeedback,true);
  const serviceClosure=service && {goal,goalStatus:Goal.status[goal],goalProgress:Goal.progress[goal],
    originalGoalDescription:Goal.description[goal],completedEvents:registry.events.filter(event=>event.type==='goal_completed' && event.data.goal===SERVICE_MEAL_INTENTION),
    exchangeOccurred:serviceExchangeOccurred(world,actor,service.baker),visitorDialogue:getSocialDialogue(world,actor),bakerDialogue:getSocialDialogue(world,service.baker),
    systemErrors:registry.errors,systemDiagnostics:getSystemDiagnosticCoverage(registry)};
  if(serviceClosure)write('service-closure.json',serviceClosure);
  return { passed: ate && Needs.hunger[actor]>=0 && Needs.hunger[actor]<70 && feedbackHasMeal
      && outcomes.errors.length===0 && (!['bakery','service'].includes(mode) || outcomes.evidence.handoffThenMeal && feedbackHasMealAndHandoff && delivery?.consumed===true)
      && (!serviceClosure || serviceClosure.goalStatus==='completed' && serviceClosure.goalProgress===100
        && serviceClosure.completedEvents.length===1 && serviceClosure.exchangeOccurred && systemDiagnosticsAreClean(serviceClosure.systemDiagnostics)),
    requiresQualitativeReview: true, proposals, builds: getPlaceBuildStatus(world, registry), actions,delivery,
    ...(serviceClosure?{serviceClosure}:{}),
    outcomes:{handoffs:outcomes.evidence.handoffs,meals:outcomes.evidence.meals,handoffThenMeal:outcomes.evidence.handoffThenMeal,errors:outcomes.errors},
    events: getCommittedEvents(world).events, hunger: Needs.hunger[actor], goalStatus: Goal.status[goal],
    feedbackHasNativeOutcomes: feedbackHasMeal,feedbackHasMealAndHandoff,
    note: 'Short Weaver usefulness probe, not ten-trial baseline or all-spirit integration; background planning disabled to bound inference. God inbox delivery is not God reasoning. Self-service alone does not exercise the bakery handoff gate.' };
}
const wallDeadlineMs=['bakery','service'].includes(mode)?180000:120000;
const began = performance.now(), timer = setTimeout(() => controller.abort(Error('Probe wall deadline')), wallDeadlineMs);
write('protocol.json', { mode, models: MODEL_IDS, providerRequestLimit: budget, wallDeadlineMs, simulationLimitMs: 120000,
  ...(['bakery','service'].includes(mode)?{requires:'Generated useful place; independent native handoff and consumption of the same food; native feedback to Weaver and report in God inbox',
    requestDrainMs:2000,priorTrialsRemainSeparate:true}:{}),
  ...(mode==='service'?{nativeGoalClosure:true,goalDescription:SERVICE_MEAL_INTENTION,initialStockCustody:'Explicit host fixture, all generated food starts with the resident before cognition',
    requiresReciprocalHeardCompleteSpeech:true,goalEvaluator:'Existing GoalEvaluationSystem, no test-written completion flag'}:{}),
  seed: initial(), noModelOverrides: true, noH3: true, oneAttempt: true });
let verdict: unknown;
try { verdict = await withSimulationTask(controller.signal, probe); }
catch (error) { verdict = { passed: false, error: String(error) }; }
finally {
  codingDaemon?.stop();await codingDaemon?.flush();
  stopCommittedEvents(world); controller.abort(Error('Probe finished')); clearTimeout(timer);
  const requestsDrained=await pendingRequests.drain(2000);
  write('final-world.json', initial()); write('verdict.json', { mode, result: verdict, calls, activeRequestsAtStop: active,
    requestsDrained,
    wallMs: Math.round(performance.now() - began), simMs: world.time.elapsed, providerResponses: requestRecords.length });
  console.log(JSON.stringify({ mode, directory: output, calls, wallMs: Math.round(performance.now() - began), result: verdict }));
}
