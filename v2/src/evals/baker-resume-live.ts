/** Eval-only counterfactual continuation of a trusted construction checkpoint.
 * No model/controller changes, NPC actions, stock edits or silent live retries. */
import "dotenv/config";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { hasComponent, query } from "bitecs";
import { createSimulation, type ArgosSimulation } from "../index";
import { Agent, Goal, Name, Needs, WorkingMemoryIdentity } from "../ecs/components";
import { getRoomForEntity } from "../ecs/location";
import { enableRoomRouteTopology } from "../runtime/room-routes";
import { withSimulationTask } from "../runtime/task-scope";
import { subscribeCommittedEvents, type PublicCommittedEvent } from "../runtime/committed-events";
import { serializeWorld, type SerializedWorld } from "../persistence/world-persistence";
import { getWorkingMemory } from "../cognition/working-memory";
import { chronicle } from "../cognition/simulation-chronicle";
import { MODEL_IDS } from "../llm/config";
import { getSystemDiagnosticCoverage } from "../ecs/dynamic-systems";
import { systemDiagnosticsAreClean } from "./system-diagnostic-evidence";
import { observeBakeryOutcomes, completedSpeechAfter } from "./bakery-outcome";
import { GENERATED_SERVICE_MEAL_INTENTION, prepareGeneratedServiceClosure, serviceExchangeOccurred } from "./service-closure-fixture";

const offline = process.argv.includes("--offline");
const directory = process.env.ARGOS_BASELINE_DIRECTORY;
if (!directory || !offline && !process.argv.includes("--live")) throw Error("Explicit bounded continuation launcher required");
if (Object.values(MODEL_IDS).some(model => model !== "gemini-3.8-flash")) throw Error("Accepted model configuration changed");
const saved = JSON.parse(readFileSync(join(directory, "source-checkpoint.json"), "utf8"));
const snapshot: SerializedWorld = saved.world;
const write = (name: string, value: unknown) => writeFileSync(join(directory, name), JSON.stringify(value, null, 2), { mode: 0o600 });
const append = (name: string, value: unknown) => appendFileSync(join(directory, name), JSON.stringify(value) + "\n", { mode: 0o600 });
const controller = new AbortController(), began = performance.now();
let sim: ArgosSimulation | undefined, result: any = { passed: false, stage: "restore" }, stopReason: string | undefined, observerError: string | undefined;
const disposers: Array<() => void> = [];
const stop = (reason: string) => { stopReason ??= reason; controller.abort(Error(reason)); sim?.stop(); };
process.once("SIGINT", () => stop("operator_or_provider_bound"));
process.once("SIGTERM", () => stop("parent_bound"));
const timer = setTimeout(() => stop("wall_bound"), 120000);
try { await withSimulationTask(controller.signal, async () => {
  if (!snapshot || saved.atSimMs !== snapshot.clock?.elapsed || saved.builds?.length !== 1) throw Error("Expected an original construction checkpoint");
  sim = await createSimulation({ name: snapshot.name, restoreSnapshot: snapshot, enableAI: !offline,
    narrativeMind: true, cognitionController: "priority", experienceReconsideration: true,
    enablePlanning: true, enableReflection: true, enableSpirits: false, godAutopilot: false,
    evolution: false, codingDaemons: false, enableNarrativeEngine: false, hostOfficeTools: false,
    enableServer: false, dualLoop: true, ecsTickRate: 2, ecsDeltaMs: 500, timeScale: 1 });
  const live = sim, world = live.world, registry = live.god.systemRegistry, start = world.time.elapsed;
  enableRoomRouteTopology(world, { travelMs: 4000 }); // Original runtime policy, not restored closures.
  const resolve = (key: string) => {
    const matches = [...query(world, [WorkingMemoryIdentity])].filter(eid => WorkingMemoryIdentity.id[eid] === key);
    if (!key || matches.length !== 1) throw Error("Missing/ambiguous restored lifetime");
    return matches[0];
  };
  const oneSaved = (predicate: (entity: SerializedWorld["entities"][number]) => boolean) => {
    const matches = snapshot.entities.filter(predicate);
    if (matches.length !== 1) throw Error("Missing/ambiguous original checkpoint actor or goal");
    return resolve(matches[0].components.WorkingMemoryIdentity?.id);
  };
  const actor = oneSaved(entity => entity.components.Agent && entity.components.Name?.value === "Ada");
  const goal = oneSaved(entity => entity.components.Goal?.description === GENERATED_SERVICE_MEAL_INTENTION);
  const members = saved.builds[0].members as Array<{ id: string; key: string; type: string }>;
  const bakers = members.filter(m => m.type === "agent"), rooms = members.filter(m => m.id === "room");
  if (bakers.length !== 1 || rooms.length !== 1) throw Error("Expected the original single baker and service room");
  const baker = resolve(bakers[0].key), room = resolve(rooms[0].key);
  const foodMembers = members.filter(m => ["fresh_serving_one", "fresh_serving_two"].includes(m.id));
  if (foodMembers.length !== 2 || !hasComponent(world, actor, Agent) || !hasComponent(world, baker, Agent)) throw Error("Original fixture members unavailable");
  const foodIds = foodMembers.map(m => resolve(m.key));
  const service = prepareGeneratedServiceClosure(world, registry, { actor, goal, room, baker, foodIds });
  write("restore.json", { start, service, remapped: members.map(m => ({ ...m, restoredEid: resolve(m.key) })),
    semantics: "New source, same saved lifetime keys and clock; in-flight tasks are not replayed. Original prospective goal binding and route policy reapplied before choices." });
  write("restored-world.json", serializeWorld(world, registry));
  if (offline) { result = { passed: true, stage: "offline_restore", start, noLiveRequests: true }; return; }
  const speech: PublicCommittedEvent[] = [], beforeMeals = new Set<string>(), witnessed: unknown[] = [];
  const outcomes = observeBakeryOutcomes(world, actor, foodIds, row => append("native-outcomes.jsonl", row), { providerId: baker, roomId: room });
  disposers.push(outcomes.stop, chronicle.subscribe(event => append("chronicle.jsonl", { ...event, atSimMs: world.time.elapsed })));
  disposers.push(subscribeCommittedEvents(world, event => {
    try {
      append("public-events.jsonl", event);
      if (completedSpeechAfter(event, baker, start)) speech.push(event);
      if (event.actorId === actor && event.action === "interact" && event.status === "pending"
        && foodMembers.some(m => m.key === event.targetKey) && !beforeMeals.has(event.executionId)) {
        // Save each attempt: the first attempt on an item may fail before a
        // later successful meal. Preserve both instead of overwriting evidence.
        beforeMeals.add(event.executionId);
        write(`before-meal-${beforeMeals.size}.json`, { event, world: serializeWorld(world, registry),
          semantics: "Action-start world state. A future continuation must redecide unfinished actions, not replay their callbacks." });
      }
      if (event.actorId === actor && event.action === "interact" && event.status === "succeeded") {
        const row = { event, baker: getWorkingMemory(world, baker), visitor: getWorkingMemory(world, actor) };
        witnessed.push(row); append("witness-memory.jsonl", row);
      }
    } catch (error) { observerError = String(error); stop("observer_failed"); }
  }));
  await live.start();
  result = { passed: false, stage: "live_continuation", start };
  let frame = -1;
  while (!controller.signal.aborted && world.time.elapsed - start < 60000) {
    if (world.time.elapsed !== frame) {
      frame = world.time.elapsed;
      append("frames.jsonl", { atSimMs: frame, wallMs: Math.round(performance.now() - began), runtime: live.getRuntimeStatus(),
        actors: [actor, baker].map(eid => ({ eid, name: Name.value[eid], room: getRoomForEntity(world, eid), hunger: Needs.hunger[eid],
          goals: live.getAgentGoals(Name.value[eid]), thoughts: live.getAgentThoughts(Name.value[eid]), memory: getWorkingMemory(world, eid) })) });
    }
    await sleep(100);
  }
  controller.signal.throwIfAborted();
  const memory = getWorkingMemory(world, baker), meals = outcomes.evidence.meals;
  const terminal = (key: string) => {
    const facts = memory.facts.filter(f => f.subject === key);
    return facts.length === 1 && facts[0].slot === "Entity.lifecycle" && facts[0].value === "removed";
  };
  const postMealSpeech = meals.length > 0 ? speech.filter(e => completedSpeechAfter(e, baker, meals[0].atSimMs)) : [];
  const systemDiagnostics = getSystemDiagnosticCoverage(registry);
  result = { passed: meals.length === 2 && foodMembers.every(m => terminal(m.key)) && postMealSpeech.length > 0
      && serviceExchangeOccurred(world, actor, baker) && !observerError && !outcomes.errors.length && systemDiagnosticsAreClean(systemDiagnostics),
    systemDiagnostics, stage: "bounded_observation_complete", requiresQualitativeReview: true, start, end: world.time.elapsed,
    meals, serviceMeals: outcomes.evidence.serviceMeals, postMealSpeech, bilateralHeard: serviceExchangeOccurred(world, actor, baker),
    goal: { status: Goal.status[goal], progress: Goal.progress[goal] }, witnessSamples: witnessed.length,
    terminalMemory: foodMembers.map(m => ({ key: m.key, valid: terminal(m.key) })), errors: outcomes.errors,
    health: live.getSystemHealth(), runtime: live.getRuntimeStatus(),
    limitations: "One restored construction branch; no new growth/spirit acceptance. Actual requests/proposals/spoken words still need semantic stale-offer review." };
}); } catch (error) { result = { ...result, passed: false, error: String(error) }; }
finally {
  clearTimeout(timer);
  if (sim) { write("final-world.json", serializeWorld(sim.world, sim.god.systemRegistry)); sim.stop(); }
  controller.abort(Error("Continuation finished"));
  const drain = (globalThis as any).__argosBaselineDrain;
  let drainTimer: ReturnType<typeof setTimeout> | undefined;
  const drained = offline || typeof drain === "function" && await Promise.race([drain().then(() => true),
    new Promise<boolean>(resolve => { drainTimer = setTimeout(() => resolve(false), 2000); })]);
  if (drainTimer) clearTimeout(drainTimer);
  disposers.forEach(dispose => dispose());
  write("verdict.json", { result, stopReason, observerError, drained, wallMs: Math.round(performance.now() - began), simMs: sim?.world.time.elapsed });
  process.exitCode = result.passed && !stopReason && !observerError && drained ? 0 : 1;
}
