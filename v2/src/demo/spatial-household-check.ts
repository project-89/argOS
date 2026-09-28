/** One prospectively bounded observation of an autonomous household. The
 * observer never sends messages, selects actions, changes weather or builds. */
import "dotenv/config";
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { entityExists, getRelationTargets, hasComponent } from "bitecs";
import { SpatialDemo } from "./spatial-demo";
import { createHouseholdScenario, HOUSEHOLD_GROWTH_SITES } from "./spatial-household";
import { createHouseholdChallengeScenario } from "./spatial-household-challenge";
import { Goal, GoalLifecycle, Name, Needs, ObjectState, WorkingMemoryIdentity } from "../ecs/components";
import { HasGoal, RelatesTo, SittingOn } from "../ecs/relations";
import { getRoomForEntity, getDirectContainer } from "../ecs/location";
import { getComponent } from "../ecs/component-registry";
import { isEntityPresent } from "../ecs/entity-presence";
import { getStampedSimulationTime } from "../ecs/temporal-age";
import { getWorkingMemory } from "../cognition/working-memory";
import { getIdentityAnchors } from "../cognition/narrative-memory";
import { getAspirations } from "../cognition/goal-learning";
import { snapshotActorContinuation } from "../cognition/actor-continuation";
import { subscribeCommittedEvents } from "../runtime/committed-events";
import { withSimulationTask } from "../runtime/task-scope";
import { serializeWorld } from "../persistence/world-persistence";
import { getSpiritSystemState } from "../spirits/spirit-system";
import { getSpiritPublicEventReviewStatus } from "../spirits/spirit-public-event-review";
import { getArchitectDiagnostics } from "../spirits/architect-diagnostics";
import { getObservedProposalDiagnostics } from "../spirits/architect-spirit";
import { getFactoryState } from "../spirits/spirit-factory";
import { getCodingDaemon } from "../engineering/coding-daemon";
import { subscribeGodAutopilotReviews } from "../god/god-autopilot";
import { MODEL_IDS, THINKING_LEVELS } from "../llm/config";
import { evaluateHouseholdEvidence, type HouseholdEvidenceInput } from "./spatial-household-evidence";

const flags = process.argv.slice(2), challenge = flags.includes("--challenge"), mechanic = flags.includes("--weather-mechanic");
if (!flags.includes("--live") || new Set(flags).size !== flags.length
  || flags.some(flag => !["--live", "--challenge", "--weather-mechanic"].includes(flag)) || mechanic && !challenge)
  throw Error("Use --live, optionally --challenge --weather-mechanic, for one paid 180-second observation. No retries, forced events or H3.");

const recordings = resolve("recordings"); mkdirSync(recordings, { recursive: true });
const directory = mkdtempSync(join(recordings, "household-check-")); chmodSync(directory, 0o700);
// Bodies remain complete except for exact configured credential values. Never
// save headers, URLs, query strings, process environment or raw error objects.
const credentials = [process.env.GOOGLE_GENERATIVE_AI_API_KEY, process.env.GOOGLE_API_KEY, process.env.GEMINI_API_KEY]
  .filter((value): value is string => typeof value === "string" && value.length > 0);
const redact = (value: string) => credentials.reduce((text, secret) => text.split(secret).join("[credential redacted]"), value);
const encoded = (value: unknown, pretty = false) => redact(JSON.stringify(value, null, pretty ? 2 : undefined));
const save = (file: string, value: unknown) => writeFileSync(join(directory, file), encoded(value, true), { mode: 0o600 });
const append = (file: string, value: unknown) => appendFileSync(join(directory, file), encoded(value) + "\n", { mode: 0o600 });
const safeError = (error: unknown) => redact(error instanceof Error ? `${error.name}: ${error.message}` : String(error))
  .replace(/https?:\/\/[^\s"'<>]+/g, "[URL omitted]");
const bounds = { wallMs: 180_000, simulationMs: 180_000, maxHttpAttempts: 300, drainMs: 8_000, sampleMs: 1000 };
const scenario = challenge ? createHouseholdChallengeScenario() : createHouseholdScenario();
save("protocol.json", { version: 1, kind: "one-bounded-autonomous-household-observation", bounds,
  profile: challenge ? "challenge" : "evening", authoredScenarioId: scenario.id,
  options: { scenario: "household", householdChallenge: challenge, story: "household", evolving: true, live: true, seconds: 180 },
  provider: "existing Google provider", models: MODEL_IDS, thinkingLevels: THINKING_LEVELS,
  settings: "Existing provider transport, model middleware, cognition and spirit settings; no overrides.",
  residents: ["Tess", "Ivo", "Noor", "Mara"], rooms: ["household-sitting-room", "household-kitchen", "household-patio"],
  finiteFood: scenario.blueprint.props.filter(p => p.assetId === "food").map(p => p.id), initialSeat: "household-patio-chair",
  growthSites: HOUSEHOLD_GROWTH_SITES, actionsForced: 0, messagesForced: 0, eventsForced: 0,
  trialRetries: 0, providerRetries: "Unchanged SDK retries each count toward the 300 HTTP-attempt bound.",
  h3: false, codingDaemon: mechanic ? { maxTotalJobs: 1, timeoutMs: 120_000,
    backend: process.env.ARGOS_CODE_BUILDER ?? "codex", purpose: "Existing validated wetting/drying contract only; further proposals review-only." } : false,
  earlySuccessStop: false, durationPolicy: "Observe until the first declared wall/simulation/request bound or actual failure/operator stop; no early success, extensions or reruns.",
  criteria: ["Native public action receipts with matching target state and actor-owned working memory",
    "Sampled opening and subsequent goal lifecycle, including failure and deferral",
    "Native weather changes and exact receipts in actual subsequent accepted Narrator reviews",
    "Optional native construction status; no construction or story outcome is required or forced"],
  privacy: "Directory 0700, evidence files 0600; every request/response body archived, credentials redacted, no headers or query strings.",
  spiritIdentity: "Observer tokens bind actual registered SpiritState objects to this source and eid; they are not fabricated ECS identities.",
  warning: "One observation only. Ten-trial baseline, ten-minute endurance and construction latency gates remain OPEN." });
save("scenario.json", scenario);
console.log("HOUSEHOLD_EVIDENCE", directory);

type Evidence = HouseholdEvidenceInput;
const receipts: Evidence["receipts"][number][] = [], goalSamples: Evidence["goalSamples"][number][] = [];
const weather: Evidence["weather"][number][] = [], narratorReviews: Evidence["narratorReviews"][number][] = [];
const changes: Array<{ sourceId: string; capturedAtSimMs: number; change: NonNullable<ReturnType<SpatialDemo["snapshot"]>["townLife"]>["changes"][number] }> = [];
const seenChanges = new Set<string>(), seenReviews = new Set<string>(), seenEvents = new Set<number>(), seenProposals = new Set<string>();
const targetIds = new Map<string, number>(), errors: string[] = [], disposals: Array<() => void> = [];
const spiritIdentities = new WeakMap<object, string>();
let spiritIdentitySequence = 0;
const controller = new AbortController(), originalFetch = globalThis.fetch;
let demo: SpatialDemo | undefined, initial: Evidence["initial"] | undefined;
let stopReason = "", fatal: string | undefined, requests = 0, activeRequests = 0, returnedRequests = 0, settledRequests = 0;
let observationBegan: number | undefined, stoppedAt: number | undefined;
const began = performance.now();
let notifyStopped!: () => void;
const stopped = new Promise<void>(resolve => { notifyStopped = resolve; });

function spiritKey(spirit: { eid: number }): string {
  let key = spiritIdentities.get(spirit);
  if (!key) { key = `observed-spirit:${demo!.sourceId}:${spirit.eid}:${++spiritIdentitySequence}`; spiritIdentities.set(spirit, key); }
  return key;
}

function cognitiveState() {
  if (!demo) return [];
  const world = demo.sim.world;
  return demo.actors.map(actor => ({ sourceId: demo!.sourceId, atSimMs: demo!.atSimMs,
    actorKey: WorkingMemoryIdentity.id[actor], actor, name: Name.value[actor], continuation: snapshotActorContinuation(world, actor),
    goals: getRelationTargets(world, actor, HasGoal).filter(id => entityExists(world, id) && hasComponent(world, id, Goal)).map(id => ({
      id, key: WorkingMemoryIdentity.id[id], description: Goal.description[id], status: Goal.status[id], priority: Goal.priority[id],
      createdAtSimMs: getStampedSimulationTime(world, id, "Goal.createdAt", Goal.createdAt[id]) ?? NaN,
      progress: Goal.progress[id], successJson: Goal.successJson[id],
      source: hasComponent(world, id, GoalLifecycle) ? GoalLifecycle.source[id] : "authored",
      mode: hasComponent(world, id, GoalLifecycle) ? GoalLifecycle.mode[id] : "",
      persistence: hasComponent(world, id, GoalLifecycle) ? GoalLifecycle.persistence[id] : "",
      ...(hasComponent(world, id, GoalLifecycle) ? { reason: GoalLifecycle.reason[id], reviewRevision: GoalLifecycle.reviewRevision[id],
        reviewPendingJson: GoalLifecycle.reviewPendingJson[id], deferredJson: GoalLifecycle.deferredJson[id],
        handoffReviewJson: GoalLifecycle.handoffReviewJson[id], settledAtSimMs:
          getStampedSimulationTime(world, id, "GoalLifecycle.settledAt", GoalLifecycle.settledAt[id]) } : {}),
    })) }));
}

function collect() {
  if (!demo) return;
  const snapshot = demo.snapshot(), world = demo.sim.world;
  for (const entity of snapshot.entities) targetIds.set(entity.key, entity.id);
  const registry = getSpiritSystemState(world)?.registry;
  if (registry?.world === world) for (const spirit of registry.spirits.values()) {
    const status = getSpiritPublicEventReviewStatus(world, spirit);
    if (!status) continue;
    const identity = `${spirit.eid}:${JSON.stringify(status)}`;
    if (seenReviews.has(identity)) continue;
    seenReviews.add(identity);
    const row = structuredClone({ sourceId: demo.sourceId, capturedAtSimMs: demo.atSimMs,
      spiritId: spirit.eid, spiritKey: spiritKey(spirit), spiritName: spirit.definition.name, status });
    append("spirit-public-reviews.jsonl", row);
    if (spirit.definition.name === "The Narrator") {
      const review = { sourceId: row.sourceId, capturedAtSimMs: row.capturedAtSimMs,
        narratorId: row.spiritId, narratorKey: row.spiritKey, status: row.status };
      narratorReviews.push(review); append("narrator-reviews.jsonl", review);
    }
  }
  for (const change of snapshot.townLife?.changes ?? []) {
    if (seenChanges.has(change.id)) continue;
    seenChanges.add(change.id);
    const row = structuredClone({ sourceId: demo.sourceId, capturedAtSimMs: demo.atSimMs, change });
    changes.push(row); append("world-changes.jsonl", row);
    const match = /^weather:(\d+):(\d+)$/.exec(change.id), component = getComponent("SpatialWeather");
    if (match && component) {
      const roomId = Number(match[1]), revision = Number(match[2]);
      if (isEntityPresent(world, roomId) && hasComponent(world, roomId, component)
        && component.revision[roomId] === revision && component.changedAtSimMs[roomId] === change.atSimMs
        && change.status === "applied") {
        const condition = component.condition[roomId];
        const entry = structuredClone({ sourceId: demo.sourceId, capturedAtSimMs: demo.atSimMs,
          receiptId: change.id, spirit: change.spirit,
          receipt: { status: "applied" as const, detail: change.summary, roomId, condition, atSimMs: change.atSimMs, revision },
          native: { roomKey: WorkingMemoryIdentity.id[roomId], condition, revision } });
        weather.push(entry); append("weather-evidence.jsonl", { ...entry, derivedFrom: "townLife.changes+SpatialWeather" });
      } else append("weather-evidence-gaps.jsonl", { ...row, reason: "No matching current native weather revision; not reconstructed." });
    }
  }
  for (const event of snapshot.events) if (!seenEvents.has(event.id)) { seenEvents.add(event.id); append("operator-events.jsonl", event); }
  for (const diagnostic of getObservedProposalDiagnostics(world)) {
    const proposal = getFactoryState().pendingProposals.find(p => p.id === diagnostic.id);
    const version = JSON.stringify({ diagnostic, proposal });
    if (seenProposals.has(version)) continue;
    seenProposals.add(version); append("proposals.jsonl", { sourceId: demo.sourceId, atSimMs: demo.atSimMs, diagnostic, proposal });
  }
  return snapshot;
}

function sample() {
  if (!demo) return;
  const frame = collect(), cognition = cognitiveState();
  for (const row of cognition) goalSamples.push(structuredClone(row));
  const row = { wallMs: performance.now() - began, sourceId: demo.sourceId, simMs: demo.atSimMs,
    frame, cognition, growth: demo.townLife?.inspectGrowth(), architect: getArchitectDiagnostics(demo.sim.world),
    evolution: demo.sim.getEvolutionStatus(), coding: demo.sim.getCodingStatus(),
    runtime: demo.sim.getRuntimeStatus(), operational: demo.sim.getOperationalStatus() };
  append("samples.jsonl", row); return row;
}

function stop(reason: string) {
  if (stopReason) return;
  stopReason = reason; stoppedAt = performance.now();
  try { if (demo) save("before-stop.json", sample()); } catch (error) { errors.push(`Before-stop evidence: ${safeError(error)}`); }
  try { demo?.stop(); } catch (error) { errors.push(`Stop: ${safeError(error)}`); }
  finally { controller.abort(Error(reason)); notifyStopped(); }
}

globalThis.fetch = async (input, init) => {
  controller.signal.throwIfAborted();
  if (performance.now() - began >= bounds.wallMs) { stop("wall_bound"); throw controller.signal.reason; }
  if (demo && demo.atSimMs >= bounds.simulationMs) { stop("simulation_bound"); throw controller.signal.reason; }
  if (requests >= bounds.maxHttpAttempts) { stop("request_bound"); throw controller.signal.reason; }
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.protocol !== "https:" || url.hostname !== "generativelanguage.googleapis.com")
    throw Error("This check permits only the existing Google provider");
  const id = ++requests, at = performance.now(); activeRequests++;
  append("requests.jsonl", { id, phase: "issued", path: url.pathname, atWallMs: at - began });
  try {
    // SDK requests use text bodies. Refuse an unarchivable body before sending
    // it, rather than losing evidence or consuming a live upload stream.
    let body: string;
    if (typeof init?.body === "string") body = init.body;
    else if (init?.body == null && input instanceof Request) body = await input.clone().text();
    else if (init?.body == null) body = "";
    else throw Error("Unsupported provider body type; HTTP request was not sent.");
    append("provider-exchanges.jsonl", { id, phase: "issued", atWallMs: at - began, body });
    controller.signal.throwIfAborted();
    const response = await originalFetch(input, { ...init, signal: AbortSignal.any([controller.signal,
      ...(init?.signal ? [init.signal] : []), ...(input instanceof Request ? [input.signal] : [])]) });
    returnedRequests++;
    // Retain partial response text as failed evidence if cancellation interrupts
    // a body; a missing suffix must never look like a complete response.
    let text = "";
    const reader = response.body?.getReader(), decoder = new TextDecoder();
    try {
      if (reader) while (true) {
        const part = await reader.read();
        if (part.done) break;
        text += decoder.decode(part.value, { stream: true });
      }
      text += decoder.decode();
    } catch (error) {
      text += decoder.decode();
      append("provider-exchanges.jsonl", { id, phase: "returned", status: response.status, complete: false,
        atWallMs: performance.now() - began, durationMs: performance.now() - at, body: text });
      throw error;
    } finally { reader?.releaseLock(); }
    append("provider-exchanges.jsonl", { id, phase: "returned", status: response.status,
      complete: true, atWallMs: performance.now() - began, durationMs: performance.now() - at, body: text });
    settledRequests++; append("requests.jsonl", { id, phase: "settled", status: response.status, durationMs: performance.now() - at });
    // Headers are forwarded to the unchanged SDK but never archived.
    return new Response(response.body === null ? null : text, { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (error) {
    const failure = { id, phase: "failed", durationMs: performance.now() - at, error: safeError(error) };
    append("requests.jsonl", failure); append("provider-exchanges.jsonl", failure); throw error;
  } finally { activeRequests--; }
};

const deadline = setTimeout(() => stop("wall_bound"), bounds.wallMs);
const handlers = (["SIGINT", "SIGTERM"] as const).map(signal => {
  const handler = () => stop(`operator_${signal}`); process.once(signal, handler); return { signal, handler };
});
let taskFinished = false;
const run = withSimulationTask(controller.signal, async () => {
  demo = await SpatialDemo.create({ scenario: "household", householdChallenge: challenge, story: "household", evolving: true, live: true, seconds: 180,
    ...(mechanic ? { weatherMechanic: { directory: join(directory, "weather-build") } } : {}),
    onPlanningEvent: event => append("planning-events.jsonl", { sourceId: demo?.sourceId, atSimMs: demo?.atSimMs, ...event }) });
  if (controller.signal.aborted) { demo.stop(); controller.signal.throwIfAborted(); }
  const frame = demo.snapshot(), world = demo.sim.world;
  save("initial.json", frame); save("initial-world.json", serializeWorld(world, demo.sim.god.systemRegistry));
  if (!!getCodingDaemon(world) !== mechanic) throw Error("Coding daemon differs from declared trial authority");
  const names = frame.actors.map(actor => actor.name).sort();
  if (JSON.stringify(names) !== JSON.stringify(["Ivo", "Mara", "Noor", "Tess"]) || frame.rooms.length !== 3
    || frame.entities.filter(entity => entity.asset === "food").length !== (challenge ? 1 : 2)
    || frame.entities.filter(entity => entity.asset === "chair").length !== 1 || !frame.townLife?.enabled)
    throw Error("Initial household does not match the prospectively declared trial");
  const identify = (scenarioId: string) => {
    const id = demo!.byId.get(scenarioId);
    if (id === undefined || !isEntityPresent(world, id) || !hasComponent(world, id, WorkingMemoryIdentity)
      || !WorkingMemoryIdentity.id[id]) throw Error(`Missing native identity: ${scenarioId}`);
    return { scenarioId, id, key: WorkingMemoryIdentity.id[id] };
  };
  const registry = getSpiritSystemState(world)?.registry;
  const narrator = registry && [...registry.spirits.values()].find(spirit => spirit.definition.name === "The Narrator");
  const cognition = cognitiveState();
  initial = { atSimMs: demo.atSimMs,
    residents: frame.actors.map(actor => {
      const seed = scenario.residents.find(resident => resident.name === actor.name)!;
      const goals = cognition.find(row => row.actor === actor.id)!.goals.filter(goal => goal.description === seed.initialGoal.description);
      if (goals.length !== 1) throw Error(`Opening intention is not uniquely native: ${actor.name}`);
      return { id: actor.id, key: actor.key, name: actor.name, openingGoal: { id: goals[0].id, key: goals[0].key },
        identityCounts: { memories: getIdentityAnchors(world, actor.id).length, motivations: getAspirations(world, actor.id).length,
          relationships: getRelationTargets(world, actor.id, RelatesTo).length } };
    }),
    objects: scenario.blueprint.props.map(prop => { const row = identify(prop.id); return { ...row, roomId: getRoomForEntity(world, row.id)! }; }),
    rooms: scenario.blueprint.rooms.map(room => identify(room.id)),
    ...(narrator ? { narrator: { id: narrator.eid, key: spiritKey(narrator) } } : {}) };
  save("initial-evidence.json", initial);
  save("initial-cognition.json", frame.actors.map(actor => ({ actor, goals: cognition.find(row => row.actor === actor.id),
    anchors: getIdentityAnchors(world, actor.id), aspirations: getAspirations(world, actor.id),
    relationships: getRelationTargets(world, actor.id, RelatesTo), memory: getWorkingMemory(world, actor.id) })));
  for (const object of initial.objects) targetIds.set(object.key, object.id);
  disposals.push(subscribeCommittedEvents(world, event => {
    try {
      const target = event.targetId ?? (event.targetKey ? targetIds.get(event.targetKey) : undefined);
      const targetMatches = target !== undefined && entityExists(world, target)
        && hasComponent(world, target, WorkingMemoryIdentity) && WorkingMemoryIdentity.id[target] === event.targetKey;
      const present = targetMatches && isEntityPresent(world, target!);
      const parent = targetMatches ? getDirectContainer(world, target!) : undefined;
      const parentKey = parent !== undefined && isEntityPresent(world, parent) && hasComponent(world, parent, WorkingMemoryIdentity)
        ? WorkingMemoryIdentity.id[parent] : undefined;
      const knownTarget = target !== undefined && event.targetKey !== undefined && targetIds.get(event.targetKey) === target;
      const row = structuredClone({ event, capturedAtSimMs: demo!.atSimMs,
        native: { sourceId: demo!.sourceId, actorKey: WorkingMemoryIdentity.id[event.actorId],
          targetPresent: present, targetRemoved: knownTarget && !present,
          // A source-owned historical key survives consumption. Never read a
          // replacement entity's state through the previous numeric address.
          ...(knownTarget || targetMatches ? { targetKey: event.targetKey } : {}),
          ...(parentKey ? { targetContainerKey: parentKey } : {}),
          ...(targetMatches && hasComponent(world, target!, ObjectState) ? { targetState: ObjectState.current[target!] } : {}),
          sittingOn: getRelationTargets(world, event.actorId, SittingOn), actorRoomId: getRoomForEntity(world, event.actorId)!,
          hunger: Needs.hunger[event.actorId] },
        memory: { sourceId: demo!.sourceId, actorKey: WorkingMemoryIdentity.id[event.actorId], capturedAtSimMs: demo!.atSimMs,
          receipts: getWorkingMemory(world, event.actorId).receipts } });
      receipts.push(row); append("receipts.jsonl", row);
    } catch (error) { errors.push(`Receipt ${event.id}: ${safeError(error)}`); }
  }));
  disposals.push(subscribeGodAutopilotReviews(demo.sim.god, review => {
    try { append("god-reviews.jsonl", structuredClone(review)); collect(); }
    catch (error) { errors.push(`God review capture: ${safeError(error)}`); }
  }));
  disposals.push(demo.onStop(() => {
    if (!stopReason) stop(demo!.atSimMs >= bounds.simulationMs ? "simulation_bound" : "native_session_stopped");
  }));
  sample(); observationBegan = performance.now();
  await demo.start();
  while (demo.running && !controller.signal.aborted) {
    sample();
    if (demo.atSimMs >= bounds.simulationMs) { stop("simulation_bound"); break; }
    await sleep(bounds.sampleMs, undefined, { signal: controller.signal });
  }
  if (!stopReason) stop("native_session_stopped");
}).catch(error => {
  if (!controller.signal.aborted) fatal = safeError(error);
  stop(fatal ? "check_error" : "bounded_stop");
}).finally(() => { taskFinished = true; });

try { await Promise.race([run, stopped]); }
finally {
  clearTimeout(deadline); if (!stopReason) stop("check_finished");
  const drainBegan = performance.now(), drainUntil = drainBegan + bounds.drainMs;
  const codingSettled = () => !demo?.sim.getCodingStatus()?.busy;
  while ((!taskFinished || activeRequests > 0 || !codingSettled()) && performance.now() < drainUntil) await sleep(50);
  let codingPersisted = !mechanic;
  if (demo && codingSettled()) {
    const daemon = getCodingDaemon(demo.sim.world);
    if (!daemon) codingPersisted = true;
    else {
      void daemon.flush().then(() => { codingPersisted = true; }, error => { errors.push(`Coding persistence: ${safeError(error)}`); });
      while (!codingPersisted && performance.now() < drainUntil) await sleep(25);
    }
  }
  for (const dispose of disposals) dispose();
  for (const { signal, handler } of handlers) process.removeListener(signal, handler);
  let result: ReturnType<typeof evaluateHouseholdEvidence> | undefined;
  if (demo) {
    try {
      save("after-stop.json", sample()); save("session.json", demo.snapshot());
      save("world.json", serializeWorld(demo.sim.world, demo.sim.god.systemRegistry));
      save("working-memory.json", demo.actors.map(actor => ({ actor, key: WorkingMemoryIdentity.id[actor], name: Name.value[actor],
        memory: getWorkingMemory(demo!.sim.world, actor) })));
      const input: HouseholdEvidenceInput | undefined = initial && { profile: challenge ? "challenge" : "evening",
        sourceId: demo.sourceId, endAtSimMs: demo.atSimMs, initial, receipts, goalSamples, weather, narratorReviews };
      if (input) { save("evaluator-input.json", input); result = evaluateHouseholdEvidence(input); }
    } catch (error) { errors.push(`Final evidence: ${safeError(error)}`); }
  }
  const summary = { kind: "one-bounded-autonomous-household-observation", directory, stopReason, fatal, observerErrors: errors,
    wallMs: Math.round((stoppedAt ?? performance.now()) - began), totalWallMs: Math.round(performance.now() - began),
    observationWallMs: observationBegan === undefined ? 0 : Math.round((stoppedAt ?? performance.now()) - observationBegan),
    drainMs: Math.round(performance.now() - drainBegan), simulationMs: demo?.atSimMs,
    requests, returnedRequests, settledRequests, activeRequests, taskFinished, codingPersisted,
    result, changes, growth: demo?.townLife?.inspectGrowth(), coding: demo?.sim.getCodingStatus(),
    baselineAndEndurance: "OPEN", constructionUnder100ms: "NOT_ASSESSED" };
  save("result.json", summary);
  console.log("HOUSEHOLD_RESULT", encoded(summary));
  // Dedicated process: leave the aborted guard installed so no late retry can
  // escape the declared budget while the provider connection pools shut down.
  process.exit(fatal || errors.length || activeRequests || !taskFinished || !codingSettled() || !codingPersisted ? 1 : 0);
}
