/** Bounded, separately versioned additive repair diagnostic. The host schedules
 * specialist opportunities, never NPC choices or successful world outcomes. */
import "dotenv/config";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { hasComponent, query, Prefab } from "bitecs";
import type { ArgosSimulation } from "../index";
import { Agent, Goal, GodAgent, Name, Needs, Perception, PhysicalObject, Removed, Room, StimulusSource, WorkingMemoryIdentity } from "../ecs/components";
import { getRoomForEntity } from "../ecs/location";
import { workingMemoryEntityRef } from "../cognition/working-memory";
import { chronicle } from "../cognition/simulation-chronicle";
import { registerSystem, getSystemDiagnosticCoverage } from "../ecs/dynamic-systems";
import { systemDiagnosticsAreClean } from "./system-diagnostic-evidence";
import { createSpiritRegistry, getMessagesForGodAI, setGodAgent } from "../spirits/spirit-registry";
import { createDynamicSpirit, getFactoryState } from "../spirits/spirit-factory";
import { executeAllApprovedProposals, gatherArchitectContext, getCurrentObservedProposals, runArchitectCognition } from "../spirits/architect-spirit";
import { getArchitectDiagnostics } from "../spirits/architect-diagnostics";
import { getArchitectDesignFeedback } from "../spirits/architect-feedback";
import { enqueueSpiritMessages, getAutopilotInbox, initializeGodAutopilot, runGodAutopilotCycle } from "../god/god-autopilot";
import { ObjectManager } from "../world/object-manager";
import { getCommittedEvents, subscribeCommittedEvents } from "../runtime/committed-events";
import { withSimulationTask } from "../runtime/task-scope";
import { serializeWorld } from "../persistence/world-persistence";
import { MODEL_IDS } from "../llm/config";
import { observeBakeryOutcomes } from "./bakery-outcome";
import { drainBaselineWork, finalizeBaselineObservation, recentBaselineThoughts } from "./baseline-evidence-journal";
import { assertDinerRepairFits, dinerContinuityFailures, dinerReviewIncludesMeal, dinerRuntimeHealthy, type DinerIdentity, type DinerReview } from "./iterative-diner-evidence";
import { createIterativeDinerFixture } from "./iterative-diner-fixture";
import { createDinerProposalDispatch, observeNewDinerFood, observeDinerIdentity, stopDinerDiagnostic } from "./purposeful-diner-support";
import { getWorldConstructionStatus } from "../runtime/world-construction-budget";

const directory = process.env.ARGOS_BASELINE_DIRECTORY;
if (!directory || !process.argv.includes("--live")) throw Error("Use the bounded --iterative-diner parent");
const protocol = JSON.parse(readFileSync(join(directory, "protocol.json"), "utf8"));
const purposeful = protocol.mode === "purposeful-diner";
if ((!purposeful && protocol.mode !== "iterative-diner") || protocol.bounds.httpAttempts !== 200 || protocol.bounds.wallMs !== 300000
  || protocol.bounds.simMs !== 240000) throw Error("Unrecognized prospective diagnostic limits");
if (Object.values(MODEL_IDS).some(model => model !== "gemini-3.8-flash")) throw Error("Accepted model configuration changed");
const save = (file: string, value: unknown) => writeFileSync(join(directory, file), JSON.stringify(value, null, 2), { mode: 0o600 });
const append = (file: string, value: unknown) => appendFileSync(join(directory, file), JSON.stringify(value) + "\n", { mode: 0o600 });
const controller = new AbortController(), began = performance.now(), disposers: (() => void)[] = [];
let sim: ArgosSimulation | undefined, interval: ReturnType<typeof setInterval> | undefined;
let result: any = { passed: false, stage: "initializing" }, stopReason: string | undefined, observerError: string | undefined, drained = false;
const stages: any[] = [], cycles: any[] = [], additions: DinerIdentity[] = [], closures: any[] = [];
const publishedThoughts: any[] = [];
const outcomes: ReturnType<typeof observeBakeryOutcomes>[] = [];
let growingOutcome: ReturnType<typeof observeNewDinerFood> | undefined;
const meals = () => [...outcomes.flatMap(o => o.evidence.meals), ...(growingOutcome?.evidence.meals ?? [])];
const stage = (name: string) => {
  result.stage = name; const row = { stage: name, atSimMs: sim?.world.time.elapsed ?? 0, wallMs: Math.round(performance.now() - began) };
  stages.push(row); append("stages.jsonl", row);
};
const stop = (reason: string) => {
  if (stopReason) return;
  stopReason = reason;
  save("stop-evidence.json", { reason, observerError, stage: result.stage, atSimMs: sim?.world.time.elapsed, additions, meals: meals() });
  const error = stopDinerDiagnostic(controller, Error(reason), () => sim?.stop());
  if (error) append("shutdown-errors.jsonl", { reason, error: String(error) });
};
process.once("SIGINT", () => stop("operator_or_provider_bound")); process.once("SIGTERM", () => stop("parent_bound"));
const timer = setTimeout(() => stop("wall_bound"), protocol.bounds.wallMs);
try { await withSimulationTask(controller.signal, async () => {
  const fixture = await createIterativeDinerFixture(true, purposeful ? "purposeful-v2" : "v1"); sim = fixture.sim;
  const live = sim, world = live.world, registry = live.god.systemRegistry;
  const { actor, room, goal, removed, intention } = fixture;
  const objects = new ObjectManager(world);
  const spirits = createSpiritRegistry(world); setGodAgent(spirits, live.god.eid);
  initializeGodAutopilot(live.god, { minRunIntervalMs: 0, minPriority: "normal" });
  const weaver = createDynamicSpirit(spirits, { name: "The Weaver", type: "architect", rank: "archangel", domain: "ecology",
    architectConfig: { canProposeSystems: false, canProposeComponents: false, canProposeRules: false, canProposeEntities: true,
      canExecuteDirectly: false, proposalApproval: "godai", maxProposalsPerCycle: 1 } })!;
  const physicalIds = () => [...query(world, [Name])].filter(eid => !hasComponent(world, eid, Prefab)
    && !hasComponent(world, eid, GodAgent) && [Room, PhysicalObject, Agent, StimulusSource].some(c => hasComponent(world, eid, c)));
  physicalIds().forEach(eid => workingMemoryEntityRef(world, eid)); // Creation-time identity setup only.
  const physical = (): DinerIdentity[] => physicalIds().map(eid => observeDinerIdentity(world, eid));
  const initial = physical(), roomKey = WorkingMemoryIdentity.id[room], removedKey = WorkingMemoryIdentity.id[removed];
  const initialKeys = new Set(initial.map(e => e.key)), seenFood = new Set<string>();
  const initialAdmissions = getWorldConstructionStatus(world).admitted;
  const constructedCount = () => getWorldConstructionStatus(world).admitted - initialAdmissions;
  const collectAdditions = () => {
    const known = new Set([...initialKeys, ...additions.map(e => e.key)]);
    // A bare ObjectManager spawn need not have an identity until perception or
    // action publishes it. Do not mint one in an allegedly read-only observer.
    for (const e of physical()) if (!e.key.startsWith("unidentified:") && !known.has(e.key)) additions.push(e);
  };
  const dispatch = purposeful ? createDinerProposalDispatch({ world, god: live.god, spirits }, room, constructedCount) : undefined;
  let continuityFailures: string[] = [];
  const checkContinuity = () => {
    continuityFailures = dinerContinuityFailures(initial, physical(), additions);
    if (additions.length > 3 || purposeful && constructedCount() > 3) continuityFailures.push("construction_addition_bound");
    if (purposeful && [...query(world, [Perception])].some(e => Perception.source[e] === Name.value[removed]))
      continuityFailures.push("removed_control_emitted_perception");
    if (continuityFailures.length) throw Error(continuityFailures.join(", "));
  };
  const seenGoalEvents = new WeakSet<object>();
  registerSystem(registry, { name: "DinerEvidenceObserver", description: "Eval-only read-only goal receipt observer", pseudocode: "Observe only",
    frequency: 1, active: true, lastRun: 0, compiledFn: () => {
      for (const e of registry.events) if (e.type === "goal_completed" && e.data.agent === "Ada" && e.data.goal === intention && !seenGoalEvents.has(e)) {
        seenGoalEvents.add(e); const row = { ...e, atSimMs: world.time.elapsed, hunger: Needs.hunger[actor], room: getRoomForEntity(world, actor) };
        closures.push(row); append("native-goal-completions.jsonl", row);
      }
    } });
  disposers.push(chronicle.subscribe(e => append("chronicle.jsonl", { ...e, atSimMs: world.time.elapsed })));
  if (purposeful) disposers.push(live.bus.subscribeAll(e => {
    if (e.type === "agent:think" && e.agentId === actor && e.thought.trim()) {
      const row = { ...e, atSimMs: world.time.elapsed };
      publishedThoughts.push(row); append("published-thoughts.jsonl", row);
    }
  }));
  disposers.push(subscribeCommittedEvents(world, e => {
    append("public-events.jsonl", e);
    if (e.targetKey === removedKey && e.status === "succeeded") { observerError = "Removed control used"; stop("removed_control_used"); }
  }));
  save("fixture.json", { intention, goal, actor, room, initial, hostAuthority: "Creation-time fixture and goal contract only; no post-start action/stock/goal writes" });
  save("initial-world.json", serializeWorld(world, registry));
  await live.start(); stage("independent_initial_activity");
  if (purposeful) {
    growingOutcome = observeNewDinerFood(world, actor, initialKeys, row => append("native-outcomes.jsonl", row), collectAdditions);
    disposers.push(growingOutcome.stop);
  }
  interval = setInterval(() => { try {
    if (world.time.elapsed >= protocol.bounds.simMs) { stop("simulation_bound"); return; }
    checkContinuity();
    append("frames.jsonl", { atSimMs: world.time.elapsed, wallMs: Math.round(performance.now() - began),
      actor: { room: getRoomForEntity(world, actor), hunger: Needs.hunger[actor], goals: live.getAgentGoals("Ada"),
        thoughts: recentBaselineThoughts(live.getAgentThoughts("Ada")) }, physical: physical(), runtime: live.getRuntimeStatus() });
  } catch (error) { observerError = String(error); stop("observer_failed"); } }, 500);

  const review = async (kind: "repair" | "outcome") => {
    const cycle: any = { index: cycles.length + 1, kind, startedAtSimMs: world.time.elapsed, reviews: [], additions: [] };
    cycles.push(cycle); stage(`weaver_${kind}_${cycle.index}`);
    // This checkpoint is diagnostic. The actual model input is captured by the
    // provider audit and the native World activity reviewed receipt below.
    save(`cycle-${cycle.index}-before.json`, { context: await gatherArchitectContext(world, registry),
      failures: getArchitectDesignFeedback(world, weaver), world: serializeWorld(world, registry) });
    const priorDiagnostic = getArchitectDiagnostics(world).latestSequence;
    const proposals = await runArchitectCognition(world, registry, spirits, weaver);
    cycle.observationCompleted = getArchitectDiagnostics(world).entries.some(e => e.sequence > priorDiagnostic && e.stage === "needs" && e.outcome === "completed");
    cycle.proposalsBeforeGod = structuredClone(proposals);
    const receipts = getMessagesForGodAI(spirits); cycle.receipts = structuredClone(receipts);
    enqueueSpiritMessages(live.god, receipts, id => spirits.spirits.get(id)?.definition.name ?? `Spirit ${id}`);
    for (let turn = 0; turn < 2; turn++) {
      const before = structuredClone(getAutopilotInbox(live.god)); if (!before.length) break;
      stage(`god_${kind}_${cycle.index}_${turn + 1}`);
      const godResult = await runGodAutopilotCycle(live.god);
      const row: DinerReview = { before, result: godResult }; cycle.reviews.push(row);
      append("god-reviews.jsonl", { cycle: cycle.index, atSimMs: world.time.elapsed, ...row, thinking: live.god.thinkingLog });
      if (!godResult.executed) break; // Later opportunity may reassess; no same-call retry.
    }
    const approved = purposeful ? getCurrentObservedProposals(world).filter(p => p.status === "approved") : proposals.filter(p => p.status === "approved");
    cycle.proposalsAfterGod = structuredClone(purposeful ? getCurrentObservedProposals(world) : proposals);
    if (kind === "repair" && approved.length) {
      for (const p of approved) assertDinerRepairFits(p.specification, room, purposeful ? constructedCount() : additions.length);
      stage(`native_repair_${cycle.index}`);
      cycle.buildResult = dispatch ? await dispatch() : await executeAllApprovedProposals(world, registry, { maxProposals: 1 });
    }
    // Outcome proposals are retained, never silently approved/executed by the
    // host as a way to erase depletion. God decisions above remain evidence.
    if (purposeful) {
      growingOutcome!.scan();
      cycle.additions = additions.filter(e => !cycles.slice(0, -1).some(c => c.additions.some((a: DinerIdentity) => a.key === e.key)));
    } else {
      const known = new Set([...initialKeys, ...additions.map(e => e.key)]);
      for (const added of physical().filter(e => !known.has(e.key))) { additions.push(added); cycle.additions.push(added); }
    }
    checkContinuity();
    if (!purposeful) for (const eid of physicalIds()) if (!hasComponent(world, eid, Removed) && objects.hasTrait(eid, "edible")
      && !initialKeys.has(WorkingMemoryIdentity.id[eid]) && !seenFood.has(WorkingMemoryIdentity.id[eid])) {
      const key = WorkingMemoryIdentity.id[eid];
      if (!key || getCommittedEvents(world).events.some(e => e.targetKey === key && e.kind === "action"))
        throw Error("New food observer attached after activity or without identity");
      seenFood.add(key);
      const observed = observeBakeryOutcomes(world, actor, [eid], row => append("native-outcomes.jsonl", row));
      outcomes.push(observed); disposers.push(observed.stop);
    }
    cycle.completedAtSimMs = world.time.elapsed;
    save(`cycle-${cycle.index}-after.json`, { cycle, diagnostics: getArchitectDiagnostics(world), failures: getArchitectDesignFeedback(world, weaver),
      world: serializeWorld(world, registry), health: live.getSystemHealth() });
    return cycle;
  };
  const waitUntil = async (at: number) => { while (!controller.signal.aborted && !meals().length && world.time.elapsed < at) await sleep(100); controller.signal.throwIfAborted(); };
  await waitUntil(12000);
  for (let attempt = 0; attempt < 3 && !meals().length; attempt++) {
    await review("repair");
    if (purposeful && attempt === 2 && !meals().length
      && !physicalIds().some(e => !hasComponent(world, e, Removed) && objects.hasTrait(e, "edible"))
      && !getCurrentObservedProposals(world).some(p => ["approved", "building"].includes(p.status)))
      throw Error("Repair opportunities exhausted with no meal, available food or current work");
    await waitUntil(attempt === 2 ? protocol.bounds.simMs : world.time.elapsed + 20000);
  }
  controller.signal.throwIfAborted();
  if (!meals().length) throw Error("No independent meal within the fixed repair opportunities");
  const outcomeCycle = await review("outcome");
  // Let the existing native goal evaluator observe the outcome, not a host flag.
  while (!controller.signal.aborted && !closures.length && world.time.elapsed < outcomeCycle.completedAtSimMs + 5000) await sleep(100);
  controller.signal.throwIfAborted(); checkContinuity();
  const nativeMeals = meals().filter(m => m.roomKey === roomKey && additions.some(e => e.key === m.foodKey));
  const godSawMeal = nativeMeals.some(meal => outcomeCycle.reviews.some((r: DinerReview) => dinerReviewIncludesMeal(r, meal.eventId)));
  const weaverSawMeal = nativeMeals.some(meal => outcomeCycle.receipts.some((r: any) => r.data?.recentEvents?.some((e: any) => e.id === meal.eventId && e.status === "succeeded")));
  const consumedStillGone = nativeMeals.every(m => {
    const key = m.foodKey, remaining = physical().find(e => e.key === key);
    return !remaining && !physical().some(e => e.name === additions.find(a => a.key === key)?.name);
  });
  const approvedRepair = cycles.some(c => c.kind === "repair" && c.proposalsAfterGod.some((p: any) => p.status === "approved")
    && c.reviews.some((r: DinerReview) => r.result.executed) && c.buildResult?.executed.length && !c.buildResult.failed.length
    && (purposeful ? additions.length : c.additions.length));
  const runtimeHealthy = dinerRuntimeHealthy(live.getRuntimeStatus()?.fastSystemHealth, live.getSystemHealth());
  const cognitionCompleted = live.getRuntimeStatus()?.operations.find(o => o.name === `AgentCognition:${actor}`)?.metrics.completed ?? 0;
  const thoughts = recentBaselineThoughts(live.getAgentThoughts("Ada"));
  const foregroundEngaged = cognitionCompleted > 0 && publishedThoughts.length > 0;
  const identityCoverage = !purposeful || additions.length === constructedCount();
  const systemDiagnostics = getSystemDiagnosticCoverage(registry);
  result = { stage: "gates_evaluated", passed: approvedRepair && cycles.filter(c => c.observationCompleted).length >= 2
    && outcomeCycle.startedAtSimMs >= nativeMeals[0]?.atSimMs && nativeMeals.length > 0 && Goal.status[goal] === "completed"
    && Goal.progress[goal] === 100 && closures.length === 1 && closures[0].room === room && weaverSawMeal && godSawMeal
    && outcomeCycle.proposalsBeforeGod.length === 0 && consumedStillGone && !continuityFailures.length
    && outcomes.every(o => !o.errors.length) && !growingOutcome?.errors.length && systemDiagnosticsAreClean(systemDiagnostics) && !observerError && runtimeHealthy
    && identityCoverage && (!purposeful || foregroundEngaged),
    systemDiagnostics, foregroundEngaged, cognitionCompleted, thoughts, publishedThoughtCount: publishedThoughts.length,
    identityCoverage, foodObserverErrors: growingOutcome?.errors,
    nativeMeals, approvedRepair, weaverSawMeal, godSawMeal, consumedStillGone, continuityFailures, runtimeHealthy,
    goal: { eid: goal, status: Goal.status[goal], progress: Goal.progress[goal] }, closures, additions,
    health: live.getSystemHealth(), limitations: protocol.requires, requiresQualitativeReview: true };
}); } catch (error) { result = { ...result, passed: false, error: String(error), reason: stopReason ?? "stage_failed" }; }
finally {
  if (interval) clearInterval(interval); clearTimeout(timer);
  const checkpoint = (prefix: string) => { if (sim) {
    save(`${prefix}-world.json`, serializeWorld(sim.world, sim.god.systemRegistry));
    save(`${prefix}-runtime.json`, { runtime: sim.getRuntimeStatus(), health: sim.getSystemHealth(), diagnostics: getArchitectDiagnostics(sim.world) });
  } };
  const failures = await finalizeBaselineObservation({ checkpoint: () => checkpoint("pre-stop"),
    lifecycle: name => append("lifecycle.jsonl", { stage: name, wallMs: performance.now() - began, atSimMs: sim?.world.time.elapsed }),
    stop: () => { controller.abort(Error("Diagnostic finished")); sim?.stop(); },
    drain: async () => { await drainBaselineWork(() => sim?.drainPendingOperations(2000) ?? Promise.resolve(), (globalThis as any).__argosBaselineDrain); drained = true; }, disposers });
  try { checkpoint("final"); } catch { failures.push({ stage: "post_drain_checkpoint", error: "Final checkpoint failed" }); }
  save("cycles.json", cycles); save("proposals-final.json", getFactoryState().pendingProposals);
  if (failures.length || observerError) result.passed = false;
  save("verdict.json", { result, stopReason, observerError, drained, cleanupFailures: failures, stages,
    meals: meals(), additions, closures, wallMs: Math.round(performance.now() - began), simMs: sim?.world.time.elapsed });
  process.exitCode = result.passed && drained && !stopReason && !observerError ? 0 : 1;
}
