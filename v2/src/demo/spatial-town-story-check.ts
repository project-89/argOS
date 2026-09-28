/** One bounded autonomous town observation. No evaluator chooses an incident,
 * moves an NPC, plants a thought, or changes the profile after the run starts. */
import "dotenv/config";
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { hasComponent } from "bitecs";
import { SpatialDemo } from "./spatial-demo";
import { Name, ObjectState, WorkingMemoryIdentity } from "../ecs/components";
import { isEntityPresent } from "../ecs/entity-presence";
import { getWorkingMemory } from "../cognition/working-memory";
import { subscribeCommittedEvents } from "../runtime/committed-events";
import { withSimulationTask } from "../runtime/task-scope";
import { serializeWorld } from "../persistence/world-persistence";
import { getSpiritSystemState } from "../spirits/spirit-system";
import { getSpiritPublicEventReviewStatus, type SpiritPublicEventReviewStatus } from "../spirits/spirit-public-event-review";
import { getArchitectDiagnostics } from "../spirits/architect-diagnostics";
import { MODEL_IDS } from "../llm/config";
import { evaluateTownStoryEvidence, matchesStoryClearingMemory } from "./spatial-town-story-evidence";

if (process.argv.slice(2).join(" ") !== "--live") throw Error("Use --live for one paid, four-minute autonomous town check. No retries, forced events or H3.");
const root = resolve("recordings"); mkdirSync(root, { recursive: true });
const directory = mkdtempSync(join(root, "town-story-check-")); chmodSync(directory, 0o700);
const save = (file: string, value: unknown) => writeFileSync(join(directory, file), JSON.stringify(value, null, 2), { mode: 0o600 });
const append = (file: string, value: unknown) => appendFileSync(join(directory, file), JSON.stringify(value) + "\n", { mode: 0o600 });
const bounds = { wallMs: 240_000, simulationMs: 240_000, maxHttpAttempts: 550, drainMs: 8000, sampleMs: 1000 };
save("protocol.json", { kind: "one-autonomous-story-loop-observation", bounds, models: MODEL_IDS,
  profile: "community-drama", evaluatorEffects: 0, actionsForced: 0, incidentForced: false, retries: 0,
  earlyStop: "Only after native incident, independently committed repair/memory and subsequent real Narrator feedback are all observed.",
  criteria: ["Narrator applies native branch damage", "Same tree is independently cleared by a resident through native timed action",
    "The successful physical action reaches that actor's sourced working memory", "Actual subsequent Narrator reviews receive exact damage, clearing and action receipt IDs"],
  unchanged: "Ten residents, existing models/controllers, current spirit/coding authority, original tree/weather/construction budgets",
  warning: "Missing, rejected or stale stages remain unproven; not a ten-trial baseline or ten-minute endurance gate." });
console.log("TOWN_STORY_EVIDENCE", directory);

type Evidence = Parameters<typeof evaluateTownStoryEvidence>[0];
const changes: Array<Evidence["changes"][number]> = [], receipts: Array<Evidence["receipts"][number]> = [], reviews: SpiritPublicEventReviewStatus[] = [];
const changeIds = new Set<string>(), reviewIds = new Set<string>(), eventIds = new Set<number>();
const errors: string[] = [], disposals: Array<() => void> = [];
const controller = new AbortController(), originalFetch = globalThis.fetch;
let demo: SpatialDemo | undefined, initial: ReturnType<SpatialDemo["snapshot"]> | undefined;
let initialTrees: Evidence["initialTrees"] = [], stopReason = "", fatal: string | undefined;
let requests = 0, activeRequests = 0, settledRequests = 0;
const began = performance.now();
function collect() {
  if (!demo) return;
  const snapshot = demo.snapshot(), state = getSpiritSystemState(demo.sim.world);
  const narrator = state && [...state.registry.spirits.values()].find(s => s.definition.name === "The Narrator");
  const review = narrator && getSpiritPublicEventReviewStatus(demo.sim.world, narrator);
  if (review && !review.sourceStopped) {
    const id = `${review.atSimMs}:${review.observedThroughSequence}:${review.observedEnvironmentThroughSequence}:${review.accepted}`;
    if (!reviewIds.has(id)) { reviewIds.add(id); reviews.push(review); append("narrator-reviews.jsonl", review); }
  }
  for (const change of snapshot.townLife?.changes ?? []) {
    if (changeIds.has(change.id)) continue; changeIds.add(change.id);
    const treeMatch = /^story:(\d+):\d+:(?:tree_damage|tree_cleared)$/.exec(change.id);
    const target = treeMatch ? Number(treeMatch[1]) : undefined;
    const row = { sourceId: snapshot.sourceId, targetKey: target !== undefined && isEntityPresent(demo.sim.world, target)
      && hasComponent(demo.sim.world, target, WorkingMemoryIdentity) ? WorkingMemoryIdentity.id[target] : "", change: structuredClone(change) };
    changes.push(row); append("world-changes.jsonl", row);
  }
  for (const event of snapshot.events) if (!eventIds.has(event.id)) { eventIds.add(event.id); append("operator-events.jsonl", event); }
  return snapshot;
}
function evaluate() {
  if (!demo) return;
  return evaluateTownStoryEvidence({ sourceId: demo.sourceId, initialTrees, changes, receipts, reviews,
    endTrees: demo.storyEvents!.view().trees.map(t => ({ id: t.id, key: t.key, phase: t.phase, revision: t.revision })) });
}
function stop(reason: string) {
  if (stopReason) return; stopReason = reason;
  try { if (demo) { save("before-stop.json", collect()); save("runtime-before-stop.json", demo.sim.getRuntimeStatus()); } }
  catch (error) { errors.push(`Before-stop evidence: ${String(error)}`); }
  try { demo?.stop(); } catch (error) { errors.push(`Stop: ${String(error)}`); }
  finally { controller.abort(Error(reason)); }
}
globalThis.fetch = async (input, init) => {
  controller.signal.throwIfAborted();
  if (requests >= bounds.maxHttpAttempts) { stop("request_bound"); throw controller.signal.reason; }
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.protocol !== "https:" || url.hostname !== "generativelanguage.googleapis.com") throw Error("This check permits only the existing Google provider");
  const id = ++requests, at = performance.now(); activeRequests++;
  append("requests.jsonl", { id, phase: "issued", path: url.pathname, atWallMs: at - began });
  try {
    const body = typeof init?.body === "string" ? init.body : input instanceof Request ? await input.clone().text() : "";
    const narrator = body.includes("You are THE NARRATOR");
    // Only the Narrator exchange is archived; no headers, querystrings or keys.
    if (narrator) append("narrator-exchanges.jsonl", { id, phase: "issued", atWallMs: at - began, body });
    const response = await originalFetch(input, { ...init, signal: AbortSignal.any([controller.signal,
      ...(init?.signal ? [init.signal] : []), ...(input instanceof Request ? [input.signal] : [])]) });
    if (narrator) append("narrator-exchanges.jsonl", { id, phase: "returned", atWallMs: performance.now() - began,
      status: response.status, body: await response.clone().text() });
    settledRequests++; append("requests.jsonl", { id, phase: "settled", status: response.status, durationMs: performance.now() - at });
    return response;
  } catch (error) { append("requests.jsonl", { id, phase: "failed", durationMs: performance.now() - at, error: String(error) }); throw error; }
  finally { activeRequests--; }
};
const deadline = setTimeout(() => stop("wall_bound"), bounds.wallMs);
const handlers = (["SIGINT", "SIGTERM"] as const).map(signal => { const handler = () => stop(`operator_${signal}`); process.once(signal, handler); return { signal, handler }; });
try {
  await withSimulationTask(controller.signal, async () => {
    demo = await SpatialDemo.create({ scenario: "town", evolving: true, story: "community-drama", live: true, seconds: bounds.simulationMs / 1000 });
    initial = demo.snapshot(); initialTrees = demo.storyEvents!.view().trees.map(t => ({ id: t.id, key: t.key }));
    if (initial.actors.length !== 10 || initialTrees.length !== 3 || !initial.townLife?.enabled || initial.townLife.story?.remainingEvents !== 2)
      throw Error("Initial story profile did not match the prospectively declared trial");
    save("initial.json", initial); save("initial-world.json", serializeWorld(demo.sim.world, demo.sim.god.systemRegistry));
    disposals.push(subscribeCommittedEvents(demo.sim.world, event => {
      try {
        const world = demo!.sim.world, target = event.targetId, present = target !== undefined && isEntityPresent(world, target);
        const key = present ? WorkingMemoryIdentity.id[target!] : undefined;
        const memoryRecorded = event.status === "succeeded" && ["interact", "use"].includes(event.action)
          && getWorkingMemory(world, event.actorId).receipts.some(r => matchesStoryClearingMemory(event, r));
        const row = { event, native: { actorKey: WorkingMemoryIdentity.id[event.actorId], targetPresent: present,
          targetKey: key, targetState: present ? ObjectState.current[target!] : undefined,
          targetRevision: target !== undefined && initialTrees.some(t => t.id === target) ? demo!.storyEvents!.component.revision[target] as number : undefined,
          atTarget: present && demo!.spatial.isAtTarget(event.actorId, target!), memoryRecorded } };
        receipts.push(row); append("receipts.jsonl", row);
        if (event.kind === "speech" || memoryRecorded) append("public-performance.jsonl", row);
      } catch (error) { errors.push(`Receipt ${event.id}: ${String(error)}`); }
    }));
    await demo.start();
    while (demo.running && !controller.signal.aborted) {
      const snapshot = collect();
      append("samples.jsonl", { wallMs: performance.now() - began, sourceId: demo.sourceId, simMs: demo.atSimMs,
        actors: snapshot?.actors, trees: demo.storyEvents!.view(), weather: snapshot?.weather, story: snapshot?.townLife?.story,
        runtime: demo.sim.getRuntimeStatus() });
      const result = evaluate();
      if (result?.completeNativeStoryLoopObserved) { stop("full_loop_observed"); break; }
      await sleep(bounds.sampleMs);
    }
    if (!stopReason) stop("native_session_stopped");
  });
} catch (error) { if (!controller.signal.aborted) fatal = String(error); stop(fatal ? "check_error" : "bounded_stop"); }
finally {
  clearTimeout(deadline); if (!stopReason) stop("check_finished");
  const drainUntil = performance.now() + bounds.drainMs;
  while (activeRequests > 0 && performance.now() < drainUntil) await sleep(50);
  for (const dispose of disposals) dispose();
  for (const { signal, handler } of handlers) process.removeListener(signal, handler);
  if (demo) {
    save("session.json", demo.snapshot()); save("world.json", serializeWorld(demo.sim.world, demo.sim.god.systemRegistry));
    save("working-memory.json", demo.actors.map(actor => ({ actor, name: Name.value[actor], memory: getWorkingMemory(demo!.sim.world, actor) })));
    save("architect-diagnostics.json", getArchitectDiagnostics(demo.sim.world));
  }
  const summary = { kind: "one-bounded-autonomous-story-loop", directory, stopReason, fatal, observerErrors: errors,
    wallMs: Math.round(performance.now() - began), simulationMs: demo?.atSimMs, requests, settledRequests, activeRequests,
    result: evaluate(), changes, reviews };
  save("result.json", summary); console.log("TOWN_STORY_RESULT", JSON.stringify(summary));
  // This is a dedicated process. The cancelled fetch guard stays installed so
  // a late provider retry cannot silently escape the declared request budget.
  process.exit(fatal || errors.length || activeRequests ? 1 : 0);
}
