/** Bounded autonomous observation, one process per trial. No evaluator action
 * injection, repair, goal manipulation or narrative success judgments. */
import "dotenv/config";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { SpatialDemo } from "./spatial-demo";
import { MODEL_IDS } from "../llm/config";
import { subscribeCommittedEvents } from "../runtime/committed-events";
import { serializeWorld } from "../persistence/world-persistence";
import { withSimulationTask } from "../runtime/task-scope";
import { getSystemDiagnosticCoverage, subscribeSystemDiagnostics } from "../ecs/dynamic-systems";
import { getWorkingMemory } from "../cognition/working-memory";
import { Goal, GoalLifecycle, Name, WorkingMemoryIdentity } from "../ecs/components";
import { getRelationTargets, hasComponent } from "bitecs";
import { HasGoal } from "../ecs/relations";
import { snapshotActorContinuation } from "../cognition/actor-continuation";
import { snapshotWaitExperience } from "../cognition/wait-experience";
import { captureMemoryBaseline, captureBlackoutExperience, restoreBlackoutExperience } from "./spatial-blackout-memory";
import { afterRepairTailEvidence, parseAfterRepairTail } from "./spatial-after-repair-protocol";

const directoryArg = process.argv.find(arg => arg.startsWith("--directory="))?.slice(12);
if (!process.argv.includes("--live") || !directoryArg) throw Error("Use --live --directory=<new evidence directory>; optionally --variant=B --memories=<prior experiences.json>");
const tail = parseAfterRepairTail(process.argv);
const variant = process.argv.includes("--variant=B") ? "B" : "A";
const extended = process.argv.includes("--extended");
const intervention = process.argv.includes("--second-outage");
const memoryFile = process.argv.find(arg => arg.startsWith("--memories="))?.slice(11);
const directory = resolve(directoryArg);
mkdirSync(directory, { recursive: false, mode: 0o700 }); // Never overwrite an earlier outcome.
const save = (file: string, value: unknown) => writeFileSync(join(directory, file), JSON.stringify(value, null, 2), { mode: 0o600 });
const append = (file: string, value: unknown) => appendFileSync(join(directory, file), JSON.stringify(value) + "\n", { mode: 0o600 });
const bounds = { wallMs: 180_000, simMs: 180_000, httpAttempts: tail.httpAttempts, httpTimeoutMs: 25_000, stableSuccessMs: 10_000 };
save("protocol.json", { version: 3, scenario: "blackout", layout: extended ? "extended" : "compact", variant, models: MODEL_IDS, bounds,
  retainedMemory: !!memoryFile, controller: "priority", operatorActions: 0, growth: false,
  afterRepairTail: tail.tailMs ? { requestedMs: tail.tailMs, begins: "After a native repair remains powered for 10 simulation seconds",
    objective: "Observe actual goal review, waiting and voluntary next-purpose/action handoffs. No exact action, acceptance of a revelation, or goal completion is required or supplied by the evaluator.",
    incompleteAtGlobalBound: "Preserve the partial tail; do not increase time/request budgets or claim success." } : null,
  operatorWorldIntervention: intervention ? "After first native repair is stable for 10simsec, one request cuts power. Observe autonomous recovery without any NPC action/goal injection." : "none",
  disclaimer: "Single diagnostic, not a learning-effect, ten-trial, or endurance acceptance result." });
const began = performance.now(), controller = new AbortController(), nativeFetch = globalThis.fetch;
let demo: SpatialDemo | undefined, calls = 0, active = 0, stopReason = "", firstPoweredAt: number | undefined;
let fatal: string | undefined, successfulRequests = 0, failedRequests = 0;
let outageReceipt: Awaited<ReturnType<SpatialDemo["worldCommand"]>> | undefined, initialRepairAt: number | undefined;
let afterRepairStartedAt: number | undefined;
let baselines: ReturnType<typeof captureMemoryBaseline>[] = [];
const remove: Array<() => void> = [];
const cognitionEvidence = () => demo ? demo.actors.map(actor => ({ actorId: actor, actorKey: WorkingMemoryIdentity.id[actor], name: Name.value[actor],
  continuation: snapshotActorContinuation(demo!.sim.world, actor), wait: snapshotWaitExperience(demo!.sim.world, actor),
  goals: getRelationTargets(demo!.sim.world, actor, HasGoal).filter(g => hasComponent(demo!.sim.world, g, Goal)).map(g => ({
    id: g, key: WorkingMemoryIdentity.id[g], description: Goal.description[g], status: Goal.status[g], priority: Goal.priority[g], progress: Goal.progress[g],
    successJson: Goal.successJson[g], ...(hasComponent(demo!.sim.world, g, GoalLifecycle) ? {
      source: GoalLifecycle.source[g], mode: GoalLifecycle.mode[g], persistence: GoalLifecycle.persistence[g],
      reviewPendingJson: GoalLifecycle.reviewPendingJson[g], deferredJson: GoalLifecycle.deferredJson[g], reason: GoalLifecycle.reason[g],
    } : {}),
  })) })) : [];
const stop = (reason: string) => {
  if (stopReason) return; stopReason = reason;
  demo?.stop(); controller.abort(new Error(reason));
};
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.protocol !== "https:" || url.hostname !== "generativelanguage.googleapis.com") throw Error("Blackout probe network boundary");
  controller.signal.throwIfAborted();
  if (calls >= bounds.httpAttempts) { stop("request_bound"); throw controller.signal.reason; }
  const id = ++calls, started = performance.now(); active++;
  // Credentials/headers/query strings are deliberately never recorded.
  let body: unknown; try { body = JSON.parse(String(init?.body ?? "null")); } catch { body = "unparsed"; }
  append("provider.jsonl", { id, phase: "issued", path: url.pathname, body });
  try {
    const response = await nativeFetch(input, { ...init, signal: AbortSignal.any([controller.signal,
      AbortSignal.timeout(bounds.httpTimeoutMs), ...(init?.signal ? [init.signal] : [])]) });
    const text = await response.text();
    if (response.ok) successfulRequests++; else failedRequests++;
    append("provider.jsonl", { id, phase: "settled", status: response.status, elapsedMs: Math.round(performance.now() - started), body: text });
    return new Response(text, { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (error) {
    failedRequests++; append("provider.jsonl", { id, phase: "failed", elapsedMs: Math.round(performance.now() - started), error: String(error) }); throw error;
  } finally { active--; }
};
const deadline = setTimeout(() => stop("wall_bound"), bounds.wallMs);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => stop("operator_stop"));
try {
  await withSimulationTask(controller.signal, async () => {
    demo = await SpatialDemo.create({ live: true, scenario: "blackout", ...(extended ? { layout: "extended" } : {}), requiredSpec: variant, seconds: 180, automaticClock: false });
    if (memoryFile) {
      const bundles: unknown = JSON.parse(readFileSync(resolve(memoryFile), "utf8"));
      if (!Array.isArray(bundles) || bundles.length !== demo.actors.length) throw Error("Expected one trusted local experience bundle per actor");
      for (const [index, actor] of demo.actors.entries()) restoreBlackoutExperience(demo.sim.world, actor, bundles[index]);
    }
    baselines = demo.actors.map(actor => captureMemoryBaseline(demo!.sim.world, actor));
    save("initial.json", demo.snapshot());
    remove.push(subscribeCommittedEvents(demo.sim.world, event => append("events.jsonl", { event, scenario: demo!.snapshot().scenario })));
    remove.push(subscribeSystemDiagnostics(demo.sim.god.systemRegistry, event => append("diagnostics.jsonl", event)));
    await demo.start();
    while (demo.running && !controller.signal.aborted) {
      const state = demo.snapshot(); append("frames.jsonl", { ...state, runtime: demo.sim.getRuntimeStatus() });
      if (tail.tailMs) append("after-repair-cognition.jsonl", { atSimMs: state.atSimMs, tail: afterRepairTailEvidence(tail.tailMs, afterRepairStartedAt, state.atSimMs), actors: cognitionEvidence() });
      if (state.scenario?.complete) firstPoweredAt ??= state.atSimMs;
      else firstPoweredAt = undefined;
      if (firstPoweredAt !== undefined && state.atSimMs - firstPoweredAt >= bounds.stableSuccessMs) {
        if (tail.tailMs) {
          if (afterRepairStartedAt === undefined) {
            initialRepairAt = firstPoweredAt; afterRepairStartedAt = state.atSimMs;
            save("after-repair-start.json", { atSimMs: state.atSimMs, state, actors: cognitionEvidence() });
          }
        } else if (intervention && !outageReceipt) {
          initialRepairAt = firstPoweredAt;
          outageReceipt = await demo.worldCommand("Turn the light back off");
          save("intervention.json", { atSimMs: demo.atSimMs, request: "Turn the light back off", receipt: outageReceipt, after: demo.snapshot() });
          if (outageReceipt.status !== "applied" || demo.snapshot().scenario?.power !== "off") { stop("intervention_failed"); break; }
          firstPoweredAt = undefined;
        } else { stop(intervention ? "stable_native_recovery" : "stable_native_success"); break; }
      }
      if (tail.tailMs && afterRepairTailEvidence(tail.tailMs, afterRepairStartedAt, state.atSimMs).observedEntireTail) {
        stop("after_repair_tail_observed"); break;
      }
      if (state.atSimMs >= bounds.simMs) { stop("simulation_bound"); break; }
      await sleep(500);
    }
    if (!stopReason) stop("simulation_stopped");
  });
} catch (error) { fatal = String(error); stop("probe_error"); }
finally {
  clearTimeout(deadline); if (!stopReason) stop("probe_finished");
  for (const dispose of remove) dispose();
  const drainUntil = performance.now() + 8000;
  while (active && performance.now() < drainUntil) await sleep(50);
  globalThis.fetch = nativeFetch;
  if (demo) {
    // Outside the cancelled task: export read evidence after stopping, not a
    // late task mutation. No evaluator-written solution is added to memories.
    if (baselines.length === demo.actors.length) {
      try { save("experiences.json", demo.actors.map((actor, index) => captureBlackoutExperience(demo!.sim.world, actor, baselines[index]))); }
      catch (error) { fatal = `${fatal ?? ""} Experience export: ${String(error)}`; }
    }
    save("final.json", demo.snapshot());
    save("world.json", serializeWorld(demo.sim.world, demo.sim.god.systemRegistry));
    save("working-memory.json", demo.actors.map(actor => ({ name: Name.value[actor], memory: getWorkingMemory(demo!.sim.world, actor) })));
    if (tail.tailMs) save("after-repair-final.json", { atSimMs: demo.atSimMs, actors: cognitionEvidence() });
  }
  const result = { stopReason, nativeSuccess: demo?.snapshot().scenario?.complete === true, firstPoweredAt,
    elapsedWallMs: Math.round(performance.now() - began), atSimMs: demo?.atSimMs,
    calls, successfulRequests, failedRequests, activeAtFinish: active, fatal, initialRepairAt, outageReceipt,
    afterRepairTail: tail.tailMs ? afterRepairTailEvidence(tail.tailMs, afterRepairStartedAt, demo?.atSimMs ?? 0) : null,
    systemDiagnostics: demo && getSystemDiagnosticCoverage(demo.sim.god.systemRegistry), runtime: demo?.sim.getRuntimeStatus(),
    growth: "not enabled", learningEffect: "not assessed", baselineAndEndurance: "OPEN" };
  save("result.json", result); console.log("BLACKOUT_RESULT", JSON.stringify(result));
}
