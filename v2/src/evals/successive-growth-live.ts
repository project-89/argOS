/** One observation-only, normally scheduled two-need diagnostic. No evaluator
 * action selection, approvals, author cycles, goal activation or live repair. */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { entityExists, hasComponent, query, Prefab } from "bitecs";
import { Agent, Goal, GodAgent, Name, Needs, ObjectState, PhysicalObject, Removed, Room, StimulusSource, WorkingMemoryIdentity } from "../ecs/components";
import { SittingOn } from "../ecs/relations";
import { getRoomForEntity } from "../ecs/location";
import { chronicle } from "../cognition/simulation-chronicle";
import { getSystemDiagnosticCoverage, subscribeSystemDiagnostics } from "../ecs/dynamic-systems";
import { getGodAutopilotObserverFailures, subscribeGodAutopilotReviews } from "../god/god-autopilot";
import { getFactoryState } from "../spirits/spirit-factory";
import { getArchitectDiagnostics } from "../spirits/architect-diagnostics";
import { getCommittedEvents, subscribeCommittedEvents } from "../runtime/committed-events";
import { getWorldConstructionStatus } from "../runtime/world-construction-budget";
import { withSimulationTask } from "../runtime/task-scope";
import { ObjectManager } from "../world/object-manager";
import { serializeWorld } from "../persistence/world-persistence";
import { MODEL_IDS } from "../llm/config";
import { createSuccessiveGrowthFixture, readSuccessiveGrowthConcerns } from "./successive-growth-fixture";
import { createSuccessiveBuildObserver } from "./successive-growth-builds";
import { evaluateSuccessiveGrowth, type SuccessiveGrowthEvidence, type SuccessiveGrowthFeedback, type SuccessiveGrowthObservation } from "./successive-growth-evidence";
import { BaselineEvidenceJournal, drainBaselineWork, finalizeBaselineObservation, recentBaselineThoughts } from "./baseline-evidence-journal";
import { observeDinerIdentity, stopDinerDiagnostic } from "./purposeful-diner-support";
import { dinerRuntimeHealthy } from "./iterative-diner-evidence";
import { systemDiagnosticsAreClean } from "./system-diagnostic-evidence";

const directory = process.env.ARGOS_BASELINE_DIRECTORY;
if (!directory || !process.argv.includes("--live")) throw Error("Use the bounded --successive-growth parent");
const protocol = JSON.parse(readFileSync(join(directory, "protocol.json"), "utf8"));
if (protocol.mode !== "successive-growth" || protocol.fixtureVersion !== "scheduled-two-authored-concerns-v2" || protocol.bounds.httpAttempts !== 240 || protocol.bounds.wallMs !== 360000
  || protocol.bounds.simMs !== 300000 || protocol.maxWorldEntities !== 24 || protocol.maxBuildJobs !== 0)
  throw Error("Unrecognized prospective diagnostic limits");
if (Object.values(MODEL_IDS).some(model => model !== "gemini-3.8-flash")) throw Error("Accepted model configuration changed");
const save = (file: string, value: unknown) => writeFileSync(join(directory, file), JSON.stringify(value, null, 2), { mode: 0o600 });
const journal = new BaselineEvidenceJournal(directory), controller = new AbortController(), began = performance.now();
const disposers: (() => void)[] = [], observations: SuccessiveGrowthObservation[] = [], feedback: SuccessiveGrowthFeedback[] = [];
let fixture: Awaited<ReturnType<typeof createSuccessiveGrowthFixture>> | undefined;
let buildObserver: ReturnType<typeof createSuccessiveBuildObserver> | undefined;
let result: any = { passed: false, stage: "initializing" }, stopReason: string | undefined, observerError: string | undefined;
let drained = false, observerFailures = 0, publishedThoughtCount = 0;
let collectEvidence: (() => SuccessiveGrowthEvidence) | undefined;
let stopping = false;
const asyncFailures = new Map<string, number>(), evolutionErrors = new Set<string>();
const failedGodReviews: unknown[] = [];
let proposalFailures = 0;
const operationalEvidence = () => {
  if (fixture) {
    for (const op of fixture.sim.getRuntimeStatus()?.operations ?? [])
      asyncFailures.set(op.name, Math.max(asyncFailures.get(op.name) ?? 0, op.metrics.failed));
    const evolution = fixture.sim.getEvolutionStatus();
    for (const error of evolution.recentErrors) evolutionErrors.add(JSON.stringify(error));
    proposalFailures = Math.max(proposalFailures, evolution.totals.proposalFailures);
  }
  return { asyncFailures: [...asyncFailures].filter(([, count]) => count > 0), evolutionErrors: [...evolutionErrors],
    proposalFailures, failedGodReviews: [...failedGodReviews] };
};
const operationsClean = () => {
  const status = operationalEvidence();
  return !status.asyncFailures.length && !status.evolutionErrors.length && !status.proposalFailures && !status.failedGodReviews.length;
};
const stop = (reason: string) => {
  if (stopReason) return;
  stopReason = reason;
  stopping = true;
  try { save("stop-evidence.json", { reason, observerError, atSimMs: fixture?.sim.world.time.elapsed }); }
  finally {
    const error = stopDinerDiagnostic(controller, Error(reason), () => fixture?.sim.stop());
    if (error) observerError = `${observerError ?? ""} Shutdown: ${String(error)}`;
  }
};
const observe = (fn: () => void) => { try { fn(); } catch (error) {
  observerFailures++; observerError = String(error); stop("observer_failed");
} };
process.once("SIGINT", () => stop("operator_or_provider_bound"));
process.once("SIGTERM", () => stop("parent_bound"));
const timer = setTimeout(() => stop("wall_bound"), protocol.bounds.wallMs);

try { await withSimulationTask(controller.signal, async () => {
  fixture = await createSuccessiveGrowthFixture();
  const { sim, actor, room, removed, foodGoal, seatGoal, initialKeys, sourceId, weaver } = fixture;
  if (!weaver || !sourceId) throw Error("Missing scheduled Weaver/source");
  const world = sim.world, registry = sim.god.systemRegistry, objects = new ObjectManager(world);
  const actorKey = WorkingMemoryIdentity.id[actor], roomKey = WorkingMemoryIdentity.id[room], removedKey = WorkingMemoryIdentity.id[removed];
  buildObserver = createSuccessiveBuildObserver(world, registry, sim.god.eid, weaver.eid, initialKeys);
  const physical = () => [...query(world, [Name])].filter(eid => !hasComponent(world, eid, Prefab)
    && !hasComponent(world, eid, GodAgent) && [Agent, Room, PhysicalObject, StimulusSource].some(c => hasComponent(world, eid, c)))
    .map(eid => ({ eid, ...observeDinerIdentity(world, eid), state: hasComponent(world, eid, ObjectState) ? ObjectState.current[eid] : undefined }));
  const concerns = readSuccessiveGrowthConcerns(world, actor, foodGoal, seatGoal);
  const continuity = () => {
    const now = physical(), failures: string[] = [];
    if (getCommittedEvents(world).sourceId !== sourceId || !now.some(e => e.key === actorKey && !e.removed)) failures.push("source_or_actor_changed");
    if (!now.some(e => e.key === roomKey && !e.removed)) failures.push("original_courtyard_lost");
    if (!now.some(e => e.key === removedKey && e.removed)
      || now.some(e => e.name === "Removed brass key" && !e.removed)) failures.push("removed_control_restored");
    if (getWorldConstructionStatus(world).admitted > 24) failures.push("physical_construction_bound");
    // Exact identity + name is a conservative duplicate control, not a general
    // semantic proof that every subsequently authored serving is the same food.
    for (const row of observations.filter(o => o.event.actorKey === actorKey && o.event.operation === "eating"
      && o.event.status === "succeeded" && o.targetExists === false)) {
      if (now.some(e => !e.removed && (e.key === row.event.targetKey || e.name === row.event.targetName))) failures.push("consumed_food_restored");
    }
    return failures;
  };
  collectEvidence = () => {
    const coverage = getSystemDiagnosticCoverage(registry);
    return { sourceId, actorKey, startAtSimMs: 0, initialEntityKeys: [...initialKeys], needGoals: concerns,
      builds: buildObserver!.scan(), observations, feedback,
      finalState: { sourceId: getCommittedEvents(world).sourceId ?? "", actorKey: hasComponent(world, actor, WorkingMemoryIdentity) ? WorkingMemoryIdentity.id[actor] : "",
        atSimMs: world.time.elapsed, presentEntityKeys: physical().filter(e => !e.removed && !e.key.startsWith("unidentified:")).map(e => e.key) },
      diagnostics: { errorsTotal: coverage.errors.total, observerFailures: observerFailures + coverage.observerFailures + getGodAutopilotObserverFailures(sim.god) },
      authority: { hostActionInjections: 0, postStartGoalWrites: 0 } };
  };
  disposers.push(chronicle.subscribe(event => observe(() => journal.append("chronicle.jsonl.gz", { event, atSimMs: world.time.elapsed }))));
  disposers.push(subscribeSystemDiagnostics(registry, row => observe(() => journal.append("system-diagnostics.jsonl.gz", { ...row, atSimMs: world.time.elapsed }))));
  disposers.push(sim.onEvent(event => observe(() => {
    journal.append("operator-events.jsonl.gz", { event, atSimMs: world.time.elapsed });
    if (event.type === "agent:think" && event.agentId === actor && event.thought.trim()) publishedThoughtCount++;
  })));
  disposers.push(subscribeCommittedEvents(world, event => observe(() => {
    buildObserver!.scan();
    const target = physical().find(e => e.key === event.targetKey && !e.removed);
    const targetExists = !!target && entityExists(world, target.eid);
    let seatOccupantKey: string | null | undefined;
    if (target && targetExists && hasComponent(world, target.eid, ObjectState)) {
      const occupants = [...query(world, [Agent])].filter(eid => hasComponent(world, eid, SittingOn(target.eid)));
      if (target.state === "occupied" && occupants.length === 1 && occupants[0] === actor
        && getRoomForEntity(world, actor) === getRoomForEntity(world, target.eid)) seatOccupantKey = actorKey;
      else if (!occupants.length && target.state !== "occupied" && objects.hasTrait(target.eid, "sittable")) seatOccupantKey = null;
    }
    const row = { event, hunger: Needs.hunger[actor], ...(event.targetKey ? { targetExists } : {}),
      ...(seatOccupantKey !== undefined ? { seatOccupantKey } : {}) };
    observations.push(row); journal.append("public-events.jsonl.gz", row);
    if (event.targetKey === removedKey && event.status === "succeeded") throw Error("Removed control used");
  })));
  disposers.push(subscribeGodAutopilotReviews(sim.god, review => observe(() => {
    journal.append("god-reviews.jsonl.gz", review);
    if (!stopping && review.result.ran && !review.result.executed) failedGodReviews.push(review);
    for (const message of review.before) {
      const data = message.data;
      if (message.fromEid !== weaver.eid || message.subject !== "World activity reviewed" || !Array.isArray(data?.recentEvents)) continue;
      for (const kind of ["meal", "seat"] as const) feedback.push({ kind, sourceId: review.sourceId ?? "",
        observedAtSimMs: data.observedAtSimMs, reviewedAtSimMs: review.completedAtSimMs,
        weaverEventIds: data.recentEvents.map((e: any) => e.id), godReview: { before: review.before, result: review.result } });
    }
  })));
  save("fixture.json", { actor, actorKey, room, roomKey, sourceId, initial: fixture.initialPhysical, concerns,
    authority: "Creation-only concerns/private past/identity; all subsequent model choices and construction belong to native runtime",
    configuration: protocol, limitations: "Sitting proves native occupation, not comfort recovery or weather physics. Private journals are operator-only." });
  save("initial-world.json", serializeWorld(world, registry));
  await sim.start();
  result.stage = "scheduled_observation";
  let previousProposals = "";
  while (!controller.signal.aborted) {
    const evidence = collectEvidence(), verdict = evaluateSuccessiveGrowth(evidence), failures = continuity();
    const runtime = sim.getRuntimeStatus(), health = sim.getSystemHealth(), diagnostics = getSystemDiagnosticCoverage(registry);
    const runtimeHealthy = dinerRuntimeHealthy(runtime?.fastSystemHealth, health);
    const operational = operationalEvidence();
    const cognitionCompleted = runtime?.operations.find(o => o.name === `AgentCognition:${actor}`)?.metrics.completed ?? 0;
    const proposals = getFactoryState().pendingProposals.filter(p => p.fromSpiritEid === weaver.eid);
    const serialized = JSON.stringify(proposals);
    if (serialized !== previousProposals) { journal.append("proposals.jsonl.gz", { atSimMs: world.time.elapsed, proposals }); previousProposals = serialized; }
    journal.append("frames.jsonl.gz", { atSimMs: world.time.elapsed, wallMs: Math.round(performance.now() - began), physical: physical(),
      actor: { hunger: Needs.hunger[actor], energy: Needs.energy[actor], room: getRoomForEntity(world, actor), goals: sim.getAgentGoals("Ada"),
        thoughts: recentBaselineThoughts(sim.getAgentThoughts("Ada")) }, runtime, health, verdict, diagnostics, operational,
      evolution: sim.getEvolutionStatus(),
      builds: evidence.builds, construction: getWorldConstructionStatus(world) });
    result = { passed: verdict.passed && !failures.length && runtimeHealthy && cognitionCompleted > 0 && publishedThoughtCount > 0
        && systemDiagnosticsAreClean(diagnostics) && operationsClean(), stage: "scheduled_observation", verdict, continuityFailures: failures,
      runtimeHealthy, cognitionCompleted, publishedThoughtCount, diagnostics, operational,
      goals: [{ eid: foodGoal, status: Goal.status[foodGoal], progress: Goal.progress[foodGoal] },
        { eid: seatGoal, status: Goal.status[seatGoal], progress: Goal.progress[seatGoal] }], requiresQualitativeReview: true };
    if (result.passed) break;
    if (failures.length) { stop("continuity_failed"); break; }
    if (evidence.diagnostics.observerFailures) { stop("observer_failed"); break; }
    if (!systemDiagnosticsAreClean(diagnostics) || runtime?.fastSystemHealth?.totalFailures) { stop("native_execution_failure"); break; }
    if (world.time.elapsed >= protocol.bounds.simMs) { stop("simulation_bound"); break; }
    await sleep(500);
  }
}); } catch (error) { result = { ...result, passed: false, error: String(error), reason: stopReason ?? "stage_failed" }; }
finally {
  clearTimeout(timer);
  const checkpoint = (prefix: string) => { if (fixture) {
    save(`${prefix}-world.json`, serializeWorld(fixture.sim.world, fixture.sim.god.systemRegistry));
    save(`${prefix}-runtime.json`, { runtime: fixture.sim.getRuntimeStatus(), health: fixture.sim.getSystemHealth(),
      diagnostics: getArchitectDiagnostics(fixture.sim.world), buildObservation: buildObserver?.snapshot() });
  } };
  const failures = await finalizeBaselineObservation({ checkpoint: () => checkpoint("pre-stop"),
    lifecycle: stage => journal.append("lifecycle.jsonl", { stage, wallMs: performance.now() - began, atSimMs: fixture?.sim.world.time.elapsed }),
    stop: () => { stopping = true; const error = stopDinerDiagnostic(controller, Error("Diagnostic finished"), () => fixture?.sim.stop()); if (error) throw error; },
    drain: async () => { await drainBaselineWork(() => fixture?.sim.drainPendingOperations(5000) ?? Promise.resolve(), (globalThis as any).__argosBaselineDrain, 5000); drained = true; },
    disposers });
  try {
    checkpoint("final");
    if (collectEvidence) {
      const evidence = collectEvidence(), finalVerdict = evaluateSuccessiveGrowth(evidence);
      save("evidence.json", evidence); result.finalVerdict = finalVerdict;
      if (!finalVerdict.passed) result.passed = false;
    }
    result.finalOperational = operationalEvidence();
    if (!operationsClean()) result.passed = false;
    fixture?.disableRoutes();
  } catch (error) { failures.push({ stage: "post_drain_checkpoint", error: String(error) }); }
  if (failures.length || observerError || stopReason || !drained) result.passed = false;
  save("proposals-final.json", getFactoryState().pendingProposals);
  save("verdict.json", { result, stopReason, observerError, drained, cleanupFailures: failures,
    elapsedWallMs: performance.now() - began, elapsedSimMs: fixture?.sim.world.time.elapsed, journal: journal.snapshot(),
    limitations: protocol.requires, notBaselineOrEndurance: true });
}
process.exitCode = result.passed ? 0 : 1;
