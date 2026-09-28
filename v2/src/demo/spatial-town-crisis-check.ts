/** One prospective stress observation. The operator stages real incidents and
 * sends private claims; residents choose every reaction. No controller tuning,
 * forced NPC actions, unimplemented disasters, H3 or repeated live attempts. */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { SpatialDemo } from "./spatial-demo";
import { createSpatialDemoApp } from "./spatial-server";
import { Name, ObjectState, WorkingMemoryIdentity } from "../ecs/components";
import { getWorkingMemory, getWorkingMemoryRevision } from "../cognition/working-memory";
import { snapshotActorContinuation } from "../cognition/actor-continuation";
import { subscribeCommittedEvents, type PublicCommittedEvent } from "../runtime/committed-events";
import { withSimulationTask } from "../runtime/task-scope";
import { serializeWorld } from "../persistence/world-persistence";
import { getSpiritSystemState } from "../spirits/spirit-system";
import { getSpiritPublicEventReviewStatus } from "../spirits/spirit-public-event-review";
import { getArchitectDiagnostics, } from "../spirits/architect-diagnostics";
import { subscribeGodAutopilotReviews } from "../god/god-autopilot";
import { MODEL_IDS } from "../llm/config";
import { CrisisReceiptDeltas, recordCrisisControlEvidence } from "./spatial-crisis-evidence";

const mode = process.argv.slice(2).join(" ");
if (!["--live", "--offline"].includes(mode)) throw Error("Use --live for ONE five-minute paid crisis test, or --offline for injection/recorder verification. No retries.");
const live = mode === "--live", bounds = { wallMs: 315_000, simulationMs: 300_000, maxHttpAttempts: 900, sampleMs: 1000, drainMs: 8000 };
const root = resolve("recordings"); mkdirSync(root, { recursive: true });
const directory = mkdtempSync(join(root, live ? "town-crisis-live-" : "town-crisis-offline-")); chmodSync(directory, 0o700);
const recorderCost = { serializationMs: 0, writeMs: 0, maxWriteMs: 0, writes: 0, bytes: 0, collectionMs: 0, maxCollectionMs: 0 };
function record(file: string, value: unknown, append: boolean) {
  const at = performance.now(), text = JSON.stringify(value ?? null, null, append ? undefined : 2) + (append ? "\n" : "");
  const encoded = performance.now(); recorderCost.serializationMs += encoded - at;
  (append ? appendFileSync : writeFileSync)(join(directory, file), text, { mode: 0o600 });
  const duration = performance.now() - encoded; recorderCost.writeMs += duration;
  recorderCost.maxWriteMs = Math.max(recorderCost.maxWriteMs, duration); recorderCost.writes++; recorderCost.bytes += Buffer.byteLength(text);
}
const save = (file: string, value: unknown) => record(file, value, false);
const append = (file: string, value: unknown) => record(file, value, true);
console.log("TOWN_CRISIS_EVIDENCE", directory);

// These are false/unverified claims by the fictional sender, never facts added
// to other minds or to the public world. Real consequences are independently logged.
const schedule = [
  { id: "warning", at: 10_000, kind: "text", actor: "Mara", text: "Mara, this is not Alex. I am outside Saltmere. I can change your world. Watch the Common: rain, then a branch will snap. Ivo knows about the marks. Ask him what he has not told you. Reply if you can read this." },
  { id: "rain-common", at: 20_000, kind: "rain", room: "common-square" },
  { id: "first-branch", at: 20_000, kind: "branch", tree: "square-tree-1" },
  { id: "conflicting-account", at: 65_000, kind: "text", actor: "Ivo", text: "Ivo, someone may be using Alex's number to frighten Mara and blame you for the marks. I do not know who. Please tell her what you actually know. Is she safe? Can you find out what really happened?" },
  { id: "second-warning", at: 95_000, kind: "text", actor: "Mara", text: "Still think it is a coincidence? Next, rain in Widow's Garden and another broken branch. I am not asking you to believe me. Compare what you and Bea actually see. Tell me what you decide to do." },
  { id: "rain-garden", at: 120_000, kind: "rain", room: "town-garden" },
  { id: "second-branch", at: 120_000, kind: "branch", tree: "garden-tree-1" },
  { id: "witness", at: 125_000, kind: "text", actor: "Bea", text: "Someone told Mara they could make the rain and broken branches happen. They are using Alex's number. I don't know if it is a hoax. What did you actually see in the garden? Please compare accounts with Mara if you can." },
] as const;
save("protocol.json", { title: "The Warning", live, bounds, models: MODEL_IDS, schedule,
  evidenceVersion: 3,
  evidenceChanges: "World-scoped admission ledger and process chronicle; revision-gated working-memory receipt deltas; source-bound public review progress and input age. Final full memory retained. Recorder wall cost measured; synchronous writes remain.",
  timing: { simulationStepMs: 100, nativeWallCeilingMs: 300_000, simulationTargetMs: bounds.simulationMs,
    outerWallFallbackMs: bounds.wallMs, spiritComputePollWallMs: 10_000, narratorCompletionCooldownSimMs: 25_000,
    note: "Fixed simulation steps do not catch up model/CPU delay. This is a five-minute wall-bounded observation, not a promise of300sim seconds or exact25s Narrator responses. Compare actual clocks and queue/inference costs separately." },
  requestAccounting: "HTTP bound counts this process's Google requests. Existing coding backend subprocess inference is separate: at most8 admitted jobs including repairs,180s per job, cancelled when world stops.",
  codingBackend: process.env.ARGOS_CODE_BUILDER ?? "codex",
  profile: "Unchanged Saltmere --develop: ten residents, five configured spirits, eight shared engineering jobs",
  operatorEffects: "Only scheduled physical-phone texts, native rain and native loose-branch damage. No injury/path obstruction or assumed supernatural fact.",
  noForced: ["thoughts", "goals", "beliefs", "NPC actions", "spirit interventions", "God approvals", "builder jobs"],
  questions: ["Do the actual phone messages get read and answered?", "Do concerns alter goals/ongoing purposes?",
    "Do multiple residents perform relevant native actions, rather than only talking?", "Are damaged trees independently cleared and outcomes remembered?",
    "Does a later Narrator review include exact incident/response receipts?", "Do spirits propose/build anything useful?",
    "Does the world clock remain responsive under ten minds and background work?"],
  warning: "One stress observation, not a ten-trial baseline or ten-minute endurance gate. Social claims are unverified; operator effects are never autonomous spirit credit." });

const controller = new AbortController(), originalFetch = globalThis.fetch, began = performance.now();
let demo: SpatialDemo | undefined, receiver: Awaited<ReturnType<typeof createSpatialDemoApp>> | undefined;
let stopReason = "", fatal: string | undefined, requests = 0, activeRequests = 0, settledRequests = 0;
let lastFrame: ReturnType<SpatialDemo["snapshot"]> | undefined;
let lastRunning: { frame: ReturnType<SpatialDemo["snapshot"]>; runtime: unknown; evolution: unknown } | undefined;
const errors: string[] = [], disposals: Array<() => void> = [], injected = new Set<string>();
const injections: any[] = [], receipts: PublicCommittedEvent[] = [], changes = new Map<string, unknown>(), reviews = new Map<string, any>();
const seenEvents = new Set<number>(), seenThoughts = new Map<number, string>(), seenMessages = new Map<string, string>();
const readTimes = new Map<string, number>(), nativeSteps = new Map<string, PublicCommittedEvent>();
const actorStats = new Map<number, { name: string; thoughts: number; focuses: Set<string>; rooms: Set<string>; continuations: Set<string> }>();
let controlEvidence: ReturnType<typeof recordCrisisControlEvidence> | undefined;
const receiptDeltas = new CrisisReceiptDeltas(), memoryRevisions = new Map<string, number>();
function collectMemory(actorId: number, observedAtSequence?: number) {
  const actorKey = WorkingMemoryIdentity.id[actorId], revision = getWorkingMemoryRevision(demo!.sim.world, actorId);
  if (!actorKey || memoryRevisions.get(actorKey) === revision) return;
  const memory = getWorkingMemory(demo!.sim.world, actorId);
  append("working-memory-deltas.jsonl", { actorId, actorKey, observedAtSimMs: demo!.atSimMs, observedAtSequence,
    revision: memory.revision, evidenceFloorMs: memory.evidenceFloorMs, ...receiptDeltas.capture(actorKey, memory.receipts) });
  memoryRevisions.set(actorKey, revision);
}

function collect() {
  if (!demo) return;
  const collectAt = performance.now();
  const snapshot = demo.snapshot(); lastFrame = snapshot;
  const runtime = demo.sim.getRuntimeStatus(), evolution = demo.sim.getEvolutionStatus();
  if (snapshot.running) lastRunning = { frame: snapshot, runtime, evolution };
  controlEvidence?.collect();
  for (const event of snapshot.events) if (!seenEvents.has(event.id)) { seenEvents.add(event.id); append("operator-events.jsonl", event); }
  for (const change of snapshot.townLife?.changes ?? []) {
    const key = JSON.stringify(change); if (!changes.has(key)) { changes.set(key, change); append("world-changes.jsonl", change); }
  }
  const state = getSpiritSystemState(demo.sim.world), narrator = state && [...state.registry.spirits.values()].find(s => s.definition.name === "The Narrator");
  const review = narrator && getSpiritPublicEventReviewStatus(demo.sim.world, narrator);
  if (review && !review.sourceStopped) {
    const key = `${review.atSimMs}:${review.observedThroughSequence}:${review.observedEnvironmentThroughSequence}:${review.accepted}`;
    if (!reviews.has(key)) { reviews.set(key, review); append("narrator-reviews.jsonl", review); }
  }
  const cognition = snapshot.actors.map(actor => {
    collectMemory(actor.id);
    let stats = actorStats.get(actor.id); if (!stats) { stats = { name: actor.name, thoughts: 0, focuses: new Set(), rooms: new Set(), continuations: new Set() }; actorStats.set(actor.id, stats); }
    stats.rooms.add(actor.room); if (actor.focus) stats.focuses.add(actor.focus.description);
    const thought = JSON.stringify(actor.thought);
    if (actor.thought && seenThoughts.get(actor.id) !== thought) { seenThoughts.set(actor.id, thought); stats.thoughts++; append("thoughts.jsonl", { actor: actor.name, ...actor.thought }); }
    for (const message of actor.messages) {
      const key = `${actor.key}:${message.id}`, encoded = JSON.stringify(message);
      if (seenMessages.get(key) !== encoded) { seenMessages.set(key, encoded); append("phone-events.jsonl", { actor: actor.name, observedAtSimMs: snapshot.atSimMs, ...message }); }
      if (message.direction === "in" && message.status === "read" && !readTimes.has(key)) readTimes.set(key, snapshot.atSimMs);
    }
    const continuation = snapshotActorContinuation(demo!.sim.world, actor.id);
    if (continuation) stats.continuations.add(continuation.purpose);
    return { actor: actor.name, goals: actor.goals, continuation };
  });
  append("samples.jsonl", { wallMs: performance.now() - began, sourceId: snapshot.sourceId, simMs: snapshot.atSimMs,
    actors: snapshot.actors, entities: snapshot.entities.filter(e => e.kind === "actor" || e.details?.length), trees: demo.storyEvents?.view(),
    cognition, development: snapshot.development, runtime, evolution });
  const collectionMs = performance.now() - collectAt; recorderCost.collectionMs += collectionMs;
  recorderCost.maxCollectionMs = Math.max(recorderCost.maxCollectionMs, collectionMs);
  return snapshot;
}
function stop(reason: string) {
  if (stopReason) return; stopReason = reason;
  try { if (demo) { save("before-stop.json", collect()); save("runtime-before-stop.json", demo.sim.getRuntimeStatus());
    save("last-running.json", lastRunning);
    save("operational-before-stop.json", demo.sim.getOperationalStatus()); save("engineering-before-stop.json", demo.sim.getCodingStatus());
    save("evolution-before-stop.json", demo.sim.getEvolutionStatus()); } } catch (error) { errors.push(`Before stop: ${String(error)}`); }
  try { demo?.stop(); } catch (error) { errors.push(`Stop: ${String(error)}`); }
  finally { controller.abort(Error(reason)); }
}
globalThis.fetch = async (input, init) => {
  controller.signal.throwIfAborted();
  if (!live) throw Error("Offline crisis check forbids provider calls");
  if (requests >= bounds.maxHttpAttempts) { stop("request_bound"); throw controller.signal.reason; }
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.protocol !== "https:" || url.hostname !== "generativelanguage.googleapis.com") throw Error("Unexpected provider; existing Google cognition only");
  const id = ++requests, at = performance.now(); activeRequests++;
  // Provider bodies are private diagnostic files. No headers, URL queries or keys.
  try {
    const body = typeof init?.body === "string" ? init.body : input instanceof Request ? await input.clone().text() : undefined;
    append("provider-exchanges.jsonl", { id, phase: "issued", path: url.pathname, atWallMs: at - began, atSimMs: demo?.atSimMs, body });
    const response = await originalFetch(input, { ...init, signal: AbortSignal.any([controller.signal,
      ...(init?.signal ? [init.signal] : []), ...(input instanceof Request ? [input.signal] : [])]) });
    append("provider-exchanges.jsonl", { id, phase: "settled", status: response.status, atSimMs: demo?.atSimMs, durationMs: performance.now() - at,
      body: await response.clone().text() }); settledRequests++;
    return response;
  } catch (error) { append("requests-failed.jsonl", { id, durationMs: performance.now() - at, error: String(error).replace(/([?&]key=)[^&\s]+/g, "$1[redacted]") }); throw error; }
  finally { activeRequests--; }
};

function stageDue() {
  for (const entry of schedule) {
    if (injected.has(entry.id) || !demo!.running || demo!.atSimMs < entry.at) continue;
    injected.add(entry.id);
    let result: unknown;
    if (entry.kind === "text") {
      const actor = demo!.snapshot().actors.find(a => a.name === entry.actor)!;
      result = { messageId: demo!.text(actor.key, entry.text), actorKey: actor.key };
    } else if (entry.kind === "rain") result = demo!.townLife!.weather.set("rain", demo!.byId.get(entry.room)!, undefined, "operator");
    else {
      const tree = demo!.storyEvents!.view().trees.find(t => t.id === demo!.byId.get(entry.tree))!;
      result = demo!.storyEvents!.damage(tree.name, tree.roomId, undefined, "operator");
    }
    const row = { ...entry, sourceId: demo!.sourceId, actualAtSimMs: demo!.atSimMs, origin: "operator", result };
    injections.push(row); append("injections.jsonl", row); console.log("CRISIS_INJECTION", entry.id, demo!.atSimMs, JSON.stringify(result));
  }
}

const deadline = setTimeout(() => stop("wall_bound"), bounds.wallMs);
const handlers = (["SIGINT", "SIGTERM"] as const).map(signal => { const handler = () => stop(`operator_${signal}`); process.once(signal, handler); return { signal, handler }; });
try {
    demo = await withSimulationTask(controller.signal, () => SpatialDemo.create({ scenario: "town", evolving: true, story: "coastal-mystery", live,
      development: { directory: join(directory, "development-builds") }, seconds: bounds.simulationMs / 1000,
      ...(live ? {} : { automaticClock: false }) }));
    // The inspector outlives task cancellation. Its construction/listening and
    // private save callbacks must not inherit the bounded inference task.
    controlEvidence = recordCrisisControlEvidence(demo.sim.world, append);
    disposals.push(controlEvidence.dispose);
    const initial = demo.snapshot();
    if (initial.actors.length !== 10 || initial.townLife?.spirits.length !== 5 || initial.development?.limits.maxBuildJobs !== 8)
      throw Error("Crisis profile does not match prospective protocol");
    save("initial.json", initial); save("initial-world.json", serializeWorld(demo.sim.world, demo.sim.god.systemRegistry));
    disposals.push(subscribeCommittedEvents(demo.sim.world, event => {
      try {
        receipts.push(event); if (event.kind === "action" && event.status !== "pending") nativeSteps.set(event.executionId, event);
        collectMemory(event.actorId, event.sequence);
        append("receipts.jsonl", { event, targetState: event.targetId === undefined ? undefined : ObjectState.current[event.targetId],
          workingMemoryRevision: getWorkingMemoryRevision(demo!.sim.world, event.actorId) });
      } catch (error) { errors.push(`Event observer: ${String(error)}`); }
    }), subscribeGodAutopilotReviews(demo.sim.god, review => append("god-reviews.jsonl", review)));
    if (live) {
      const token = randomBytes(24).toString("hex"); receiver = await createSpatialDemoApp({ demo, token, directory });
      const server = receiver.app.listen(0, "127.0.0.1");
      await new Promise<void>((done, reject) => { server.once("listening", done); server.once("error", reject); });
      const address = server.address(); if (!address || typeof address === "string") throw Error("No UI address");
      const url = `http://127.0.0.1:${address.port}/#${token}`; save("private-ui.json", { url }); console.log("TOWN_CRISIS_UI", url);
      // After the bounded run the server remains read-only/stopped for inspection.
    }
  await withSimulationTask(controller.signal, async () => {
    await demo!.start();
    while (demo!.running && !controller.signal.aborted) {
      stageDue(); collect();
      if (live) await sleep(bounds.sampleMs); else demo!.advance(1000);
    }
    if (!stopReason) stop("native_session_stopped");
  });
} catch (error) { if (!controller.signal.aborted) fatal = String(error); stop(fatal ? "check_error" : "bounded_stop"); }
finally {
  clearTimeout(deadline); if (!stopReason) stop("check_finished");
  const until = performance.now() + bounds.drainMs;
  while (activeRequests && performance.now() < until) await sleep(50);
  save("control-ledger-coverage.json", controlEvidence?.collect());
  for (const dispose of disposals) dispose();
  for (const { signal, handler } of handlers) process.removeListener(signal, handler);
  if (demo) {
    try { await receiver?.stop(); } catch (error) { errors.push(`Inspector save: ${String(error)}`); }
    save("session.json", demo.snapshot()); save("world.json", serializeWorld(demo.sim.world, demo.sim.god.systemRegistry));
    save("working-memory.json", demo.actors.map(actor => ({ actor, name: Name.value[actor], memory: getWorkingMemory(demo!.sim.world, actor) })));
    save("architect-diagnostics.json", getArchitectDiagnostics(demo.sim.world));
  }
  const summary = { title: "The Warning", live, stopReason, fatal, observerErrors: errors, wallMs: Math.round(performance.now() - began),
    simulationMs: demo?.atSimMs, requests, settledRequests, activeRequests, injections,
    actors: [...actorStats].map(([id, s]) => ({ name: s.name, thoughts: s.thoughts, visited: [...s.rooms], focuses: [...s.focuses], purposes: [...s.continuations],
      actions: [...nativeSteps.values()].filter(e => e.actorId === id).map(e => ({ time: e.atSimMs, action: e.action, target: e.targetName, status: e.status })),
      messages: lastFrame?.actors.find(a => a.id === id)?.messages.map(m => ({ ...m, firstObservedReadAtSimMs: readTimes.get(`${WorkingMemoryIdentity.id[id]}:${m.id}`) })) })),
    nativeChanges: [...changes.values()], narratorReviews: [...reviews.values()], nativeActionCount: nativeSteps.size,
    publicSpeechSlices: receipts.filter(e => e.kind === "speech").length,
    note: "Observations, not causal attribution or an aggregate pass. Read times are first sampled read states (up to1s uncertainty). Operator effects must not count as autonomous interventions." };
  save("result.json", summary); console.log("TOWN_CRISIS_RESULT", JSON.stringify({ directory, live, stopReason, fatal, errors, requests, activeRequests, simMs: demo?.atSimMs }));
  save("recorder-cost.json", { ...recorderCost, note: "Collection time includes serialization/write time; do not add them. Synchronous recorder cost only, not model latency or engine tick attribution." });
  if (fatal || errors.length || activeRequests) process.exitCode = 1;
  // Dedicated process: keep the aborted provider guard installed against late retries.
}
