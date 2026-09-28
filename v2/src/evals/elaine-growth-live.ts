/** One bounded text-only episode. Host authors one outside message and schedules
 * two author reviews; it never chooses NPC actions, goals or stock movement. */
import "dotenv/config";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { query, hasComponent, addComponent } from "bitecs";
import { ApartmentSitcom, type SitcomEvent } from "../demo/apartment-sitcom";
import { ELAINE_DAVID_CONTACT } from "../demo/cookie-character-history";
import { Agent, Name, GodAgent, Removed, Needs } from "../ecs/components";
import { getDirectContainer, getRoomForEntity } from "../ecs/location";
import { chronicle } from "../cognition/simulation-chronicle";
import { getWorkingMemory, workingMemoryEntityRef } from "../cognition/working-memory";
import { getSocialDialogue } from "../cognition/social-memory";
import { getNarrativeHistory } from "../cognition/narrative-memory";
import { snapshotActorContinuation } from "../cognition/actor-continuation";
import { createSpiritRegistry, setGodAgent, getMessagesForGodAI } from "../spirits/spirit-registry";
import { createDynamicSpirit } from "../spirits/spirit-factory";
import { runArchitectCognition, gatherArchitectContext, executeAllApprovedProposals } from "../spirits/architect-spirit";
import { captureActorIntentionEvidence } from "../spirits/actor-intention-evidence";
import { getArchitectDiagnostics } from "../spirits/architect-diagnostics";
import { initializeGodAutopilot, enqueueSpiritMessages, getAutopilotInbox, runGodAutopilotCycle } from "../god/god-autopilot";
import { getPlaceBuildStatus } from "../engineering/place-materialization";
import { ObjectManager } from "../world/object-manager";
import { subscribeCommittedEvents, getCommittedEvents, type PublicCommittedEvent } from "../runtime/committed-events";
import { withSimulationTask } from "../runtime/task-scope";
import { serializeWorld } from "../persistence/world-persistence";
import { attachCommittedSceneRenderer } from "../rendering/attach-committed-renderer";
import { MODEL_IDS } from "../llm/config";
import { getSystemDiagnosticCoverage } from "../ecs/dynamic-systems";
import { systemDiagnosticsAreClean } from "./system-diagnostic-evidence";
import { BaselineEvidenceJournal, drainBaselineWork, finalizeBaselineObservation, recentBaselineThoughts } from "./baseline-evidence-journal";
import { evaluateForegroundAttempts, type ForegroundTimingEntry } from "./foreground-attempt-evaluation";
import { observeBakeryOutcomes, hasBakeryServiceFeedback } from "./bakery-outcome";
import { serviceExchangeOccurred } from "./service-closure-fixture";
import { snapshotInhabitedWorld } from "./inhabited-world-observation";
import { ELAINE_GROWTH_TEXT, ELAINE_GROWTH_CONTACT, observedDiningIntention, completedPhoneRead,
  completedPhoneReply, completedArrival } from "./elaine-growth-evidence";

const directory = process.env.ARGOS_BASELINE_DIRECTORY;
const davidHistory = process.argv.includes("--david-history");
const contact = davidHistory ? ELAINE_DAVID_CONTACT : ELAINE_GROWTH_CONTACT;
if (!directory || !process.argv.includes("--live")) throw Error("Use the bounded --elaine-growth parent");
if (Object.values(MODEL_IDS).some(m => m !== "gemini-3.8-flash")) throw Error("Accepted model configuration changed");
const save = (name: string, value: unknown) => writeFileSync(join(directory, name), JSON.stringify(value, null, 2), { mode: 0o600 });
const journal = new BaselineEvidenceJournal(directory), append = (name: string, value: unknown) => journal.append(name, value);
const began = performance.now(), controller = new AbortController();
const events: SitcomEvent[] = [], native: PublicCommittedEvent[] = [], timings: ForegroundTimingEntry[] = [];
const disposers: Array<() => void> = [], cameras: Array<{ name: string; roomId: number; count: number; lastEnd: number; camera: ReturnType<typeof attachCommittedSceneRenderer> }> = [];
let bed: ApartmentSitcom | undefined, interval: ReturnType<typeof setInterval> | undefined;
let stopReason: string | undefined, observerError: string | undefined, drained = false;
let result: Record<string, any> = { passed: false, stage: "initializing" };
let messageId: number | undefined, readAt: number | undefined, room: number | undefined, resident: number | undefined;
let outcomes: ReturnType<typeof observeBakeryOutcomes> | undefined;
function stop(reason: string) { stopReason ??= reason; controller.abort(Error(reason)); bed?.stop(); }
function observe(fn: () => void) { try { fn(); } catch (error) { observerError ??= String(error); stop("observer_failed"); } }
function stage(name: string) { result.stage = name; append("stages.jsonl", { stage: name, atSimMs: bed?.elapsedMs ?? 0, wallMs: Math.round(performance.now() - began) }); }
process.once("SIGINT", () => stop("operator_or_provider_bound")); process.once("SIGTERM", () => stop("parent_bound"));
const timer = setTimeout(() => stop("wall_bound"), 420000);

try { await withSimulationTask(controller.signal, async () => {
  bed = await ApartmentSitcom.create({ live: true, scenario: "cookie", openNeighborhood: true, outsideTextAtMs: null,
    cookieHistory: davidHistory ? "david" : "legacy",
    cognitionController: "priority", narrativeMind: true, experienceReconsideration: true,
    worldMaintenance: false, growthLimits: { maxWorldEntities: 24, maxBuildJobs: 0 } });
  const t = bed, sim = t.sim, world = sim.world, registry = sim.god.systemRegistry;
  const actor = t.ids.Elaine, actorKey = workingMemoryEntityRef(world, actor)!.key;
  const sourceId = getCommittedEvents(world).sourceId!;
  const streetKey = workingMemoryEntityRef(world, t.ids.street)!.key;
  let diningDeparture: { demand: NonNullable<ReturnType<typeof observedDiningIntention>>; departure: PublicCommittedEvent;
    selected: ReturnType<typeof snapshotActorContinuation>; atSimMs: number; all: ReturnType<typeof captureActorIntentionEvidence>["records"] } | undefined;
  t.setPhoneContact({ ...contact });
  const spirits = createSpiritRegistry(world); setGodAgent(spirits, sim.god.eid);
  initializeGodAutopilot(sim.god, { minRunIntervalMs: 0, minPriority: "normal" });
  const weaver = createDynamicSpirit(spirits, { name: "The Weaver", type: "architect", rank: "archangel", domain: "ecology",
    architectConfig: { canProposeSystems: false, canProposeComponents: false, canProposeRules: false, canProposeEntities: true,
      canExecuteDirectly: false, proposalApproval: "godai", maxProposalsPerCycle: 1 } })!;
  const removed = new ObjectManager(world).spawn("object", { name: "Discarded blue umbrella", containedIn: t.ids.street })!;
  addComponent(world, removed, Removed);
  const removedKey = workingMemoryEntityRef(world, removed)!.key, removedHolder = getDirectContainer(world, removed);
  const addCamera = (name: string, roomId: number) => {
    const camera = attachCommittedSceneRenderer(world, { roomId, windowMs: 8000,
      captureScenes: () => t.scenes().filter(scene => scene.room.id === roomId) });
    cameras.push({ name, roomId, camera, count: 0, lastEnd: t.elapsedMs }); disposers.push(camera.stop);
    if (camera.sourceId !== sourceId) throw Error("Camera source mismatch");
  };
  const drainCameras = () => {
    for (const view of cameras) {
      if (view.camera.status().error) throw Error(`Camera ${view.name}: ${view.camera.status().errorDetail}`);
      const beforeTime = t.elapsedMs;
      const otherCursors = cameras.filter(c => c !== view).map(c => c.camera.renderer.snapshot().sourcePlayheadSimMs);
      for (let i = 0; i < 64; i++) {
        const next = view.camera.renderer.next();
        if (next.status !== "ready") {
          if (next.status !== "buffering") throw Error(`Camera ${view.name} lost coverage: ${next.status}`);
          break;
        }
        if (next.segment.sourceId !== sourceId || next.segment.window.events.some(row => row.event.roomId !== view.roomId))
          throw Error("Cross-source or remote camera event");
        if (next.segment.prompt.includes(ELAINE_GROWTH_TEXT)) throw Error("Private phone body leaked into camera");
        append("camera-segments.jsonl.gz", { name: view.name, segment: next.segment });
        if (!view.camera.renderer.settle(next.segment.version, true)) throw Error("Offline camera settlement failed");
        view.count++; view.lastEnd = next.segment.sourceEndSimMs;
        if (i === 63) throw Error("Camera drain bound exceeded");
      }
      if (t.elapsedMs !== beforeTime || cameras.filter(c => c !== view).some((c, i) => c.camera.renderer.snapshot().sourcePlayheadSimMs !== otherCursors[i]))
        throw Error("Reading one camera changed world time or another cursor");
    }
  };
  const capture = () => {
    append("frames.jsonl.gz", { atSimMs: t.elapsedMs, wallMs: Math.round(performance.now() - began), state: t.snapshot({ eventLimit: 0 }),
      inhabited: snapshotInhabitedWorld(world), runtime: sim.getRuntimeStatus(), health: sim.getSystemHealth(),
      actors: [...query(world, [Agent, Name])].filter(id => Agent.active[id] && !hasComponent(world, id, GodAgent)).map(id => ({
        eid: id, key: workingMemoryEntityRef(world, id)!.key, name: Name.value[id], room: getRoomForEntity(world, id), hunger: Needs.hunger[id],
        goals: sim.getAgentGoals(Name.value[id]), thoughts: recentBaselineThoughts(sim.getAgentThoughts(Name.value[id])),
        memory: getWorkingMemory(world, id), dialogue: getSocialDialogue(world, id), narrative: getNarrativeHistory(world, id, { limit: 12 }),
        continuation: snapshotActorContinuation(world, id),
      })) });
    drainCameras();
  };
  disposers.push(chronicle.subscribe(event => observe(() => {
    append("chronicle.jsonl", { ...event, atSimMs: t.elapsedMs, observedWallMs: performance.now() - began });
    if (event.type.startsWith("foreground_")) timings.push({ type: event.type, data: event.data ?? {}, observedWallMs: performance.now() - began });
  })));
  disposers.push(t.onEvent(event => observe(() => { events.push(event); append("episode-events.jsonl", event);
    if (messageId !== undefined && readAt === undefined && completedPhoneRead([event], messageId, 5000)) {
      readAt = event.atSimMs; save("phone-read-world.json", serializeWorld(world, registry));
    }
  })));
  disposers.push(subscribeCommittedEvents(world, event => observe(() => {
    native.push(event); append("public-events.jsonl", { event, actorRoomAtReceipt: getRoomForEntity(world, event.actorId) });
    if (event.targetKey === removedKey && event.status === "succeeded") throw Error("Successful removed-object activity");
    if (!diningDeparture && readAt !== undefined && completedArrival(event, { sourceId, actorKey, destinationKey: streetKey, afterSimMs: readAt, minTravelMs: 3000 })) {
      const selected = snapshotActorContinuation(world, actor), all = captureActorIntentionEvidence(world).records;
      const demand = observedDiningIntention(all, actorKey, readAt, { departure: event, sourceId, streetKey, streetName: Name.value[t.ids.street], selected });
      append("departure-probes.jsonl", { atSimMs: t.elapsedMs, departure: event, selected, all, admitted: !!demand });
      if (demand) diningDeparture = { demand, departure: event, selected, atSimMs: t.elapsedMs, all };
    }
  })));
  save("configuration.json", { models: MODEL_IDS, options: t.options, message: ELAINE_GROWTH_TEXT, contact,
    authority: "One outside message, one scoped construction and outcome review; no host goal/action/stock edits or semantic goal binding" });
  save("initial-world.json", serializeWorld(world, registry));
  save("initial-intentions.json", captureActorIntentionEvidence(world).records);
  await t.start(); addCamera("apartment", t.ids.living); capture();
  let lastFrame = t.elapsedMs;
  interval = setInterval(() => observe(() => {
    if (t.elapsedMs >= 360000) { stop("simulation_bound"); return; }
    if (t.elapsedMs >= lastFrame + 1000) { lastFrame = t.elapsedMs; capture(); }
  }), 250);
  const waitFor = async (condition: () => boolean) => { while (!condition()) { controller.signal.throwIfAborted(); await sleep(100); } controller.signal.throwIfAborted(); };
  stage("waiting_for_phone_time"); await waitFor(() => t.elapsedMs >= 5000);
  messageId = t.text(ELAINE_GROWTH_TEXT, "predeclared outside dinner invitation");
  save("issued-input.json", { messageId, atSimMs: t.elapsedMs, text: ELAINE_GROWTH_TEXT });
  stage("waiting_for_independent_read_and_dining_departure");
  await waitFor(() => !!diningDeparture);
  save("demand.json", { ...diningDeparture, readAt });
  stage("weaver_observing_need");
  const proposals = await runArchitectCognition(world, registry, spirits, weaver);
  save("initial-proposals.json", { atSimMs: t.elapsedMs, proposals, diagnostics: getArchitectDiagnostics(world) });
  if (proposals.length !== 1) {
    result = { ...result, growthFailure: "No single admitted destination proposal; no replacement attempt", initialProposalCount: proposals.length };
    stage("observing_after_no_construction");
    // Preserve the valid no-need response and the NPC's remaining behavior.
    // Do not retry authors, construct by fiat, or cancel an in-progress reply.
    await waitFor(() => false);
    throw Error("Episode ended without construction");
  }
  const deliver = () => {
    const receipts = getMessagesForGodAI(spirits);
    enqueueSpiritMessages(sim.god, receipts, id => spirits.spirits.get(id)?.definition.name ?? `Spirit ${id}`);
    append("god-receipts.jsonl", { atSimMs: t.elapsedMs, receipts, inbox: getAutopilotInbox(sim.god) }); return receipts;
  };
  stage("god_reviewing_proposal"); deliver();
  const approval = await runGodAutopilotCycle(sim.god);
  save("god-approval.json", { atSimMs: t.elapsedMs, approval, thinking: sim.god.thinkingLog });
  if (!approval.executed || proposals[0].status !== "approved") throw Error("God did not approve grounded destination");
  stage("native_construction");
  const construction = await executeAllApprovedProposals(world, registry, { maxProposals: 1 });
  const builds = getPlaceBuildStatus(world, registry), place = builds.length === 1 ? builds[0] : undefined;
  save("construction.json", { atSimMs: t.elapsedMs, construction, builds, world: serializeWorld(world, registry) });
  room = place?.members.find(m => m.id === "room")?.eid;
  const residents = place?.members.filter(m => m.type === "agent") ?? [], objects = new ObjectManager(world);
  const foods = place?.members.filter(m => m.type === "object" && objects.hasTrait(m.eid, "edible")) ?? [];
  if (!place || room === undefined || residents.length !== 1 || !foods.length || construction.failed.length
    || !place.existingActors.some(a => a.eid === actor && a.key === actorKey))
    throw Error("Place must bind real Elaine and supply one resident plus edible finite stock");
  resident = residents[0].eid;
  if ([...query(world, [Agent, Name])].some(id => Name.value[id] === contact.name)) throw Error("Outside contact improperly materialized");
  const destinationKey = workingMemoryEntityRef(world, room)!.key;
  addCamera("restaurant", room);
  outcomes = observeBakeryOutcomes(world, actor, foods.map(f => f.eid), row => {
    append("native-service.jsonl", row);
    if (row.event.actorKey === actorKey && row.event.action === "interact" && row.event.status === "pending")
      save(`before-interaction-${row.event.sequence}.json`, { event: row.event, world: serializeWorld(world, registry) });
  }, { providerId: resident, roomId: room }); disposers.push(outcomes.stop);
  const feedback: Awaited<ReturnType<typeof gatherArchitectContext>>[] = [];
  let count = 0;
  const reply = () => completedPhoneReply(events, readAt!).find(e => t.snapshot({ eventLimit: 0 }).phone
    .some(m => m.id === e.messageId && m.direction === "out" && m.replyTo === messageId && ["sent", "delivered"].includes(m.status)));
  const departure = () => native.find(e => completedArrival(e, { sourceId, actorKey, destinationKey: streetKey, afterSimMs: readAt!, minTravelMs: 3000 }));
  const arrival = () => native.find(e => completedArrival(e, { sourceId, actorKey, destinationKey, afterSimMs: readAt!, minTravelMs: 3000 }));
  const apartmentActivity = () => { const left = departure(); return left && native.filter(e => [t.ids.Jerry, t.ids.George, t.ids.Kramer].includes(e.actorId)
    && [t.ids.living, t.ids.kitchen].includes(e.roomId!) && e.status === "succeeded" && e.atSimMs > left.atSimMs
    && (e.kind === "speech" && e.text === undefined || e.kind === "action" && !["wait", "think", "observe"].includes(e.action ?? ""))); };
  stage("independent_departure_and_service");
  while (!controller.signal.aborted) {
    const next = outcomes.evidence.handoffs.length + outcomes.evidence.sharedReleases.length + outcomes.evidence.meals.length;
    if (next !== count) { count = next; const context = await gatherArchitectContext(world, registry); feedback.push(context);
      append("outcome-feedback.jsonl", { atSimMs: t.elapsedMs, context }); }
    // Start the sole outcome review on actual meal, while its receipt is fresh.
    // Reply and apartment gates may settle while the author review runs.
    if (outcomes.evidence.serviceMeals.length) break;
    controller.signal.throwIfAborted(); await sleep(100);
  }
  controller.signal.throwIfAborted();
  save("meal-world.json", serializeWorld(world, registry));
  stage("weaver_reviewing_outcomes");
  const followupStarted = t.elapsedMs, followup = await runArchitectCognition(world, registry, spirits, weaver), receipts = deliver();
  stage("god_reviewing_outcomes"); const reflection = await runGodAutopilotCycle(sim.god);
  save("followup.json", { followupStarted, atSimMs: t.elapsedMs, followup, receipts, reflection, thinking: sim.god.thinkingLog });
  const receiptHasMeal = outcomes.evidence.serviceMeals.some(meal => receipts.some(r => r.data?.recentEvents?.some((e: any) => e.id === meal.eventId && e.status === "succeeded")));
  stage("settling_episode_gates");
  await waitFor(() => !!(reply() && arrival() && apartmentActivity()?.length && serviceExchangeOccurred(world, actor, resident!)));
  capture();
  const removedIntact = hasComponent(world, removed, Removed) && workingMemoryEntityRef(world, removed)?.key === removedKey
    && getDirectContainer(world, removed) === removedHolder;
  const systemDiagnostics = getSystemDiagnosticCoverage(registry);
  result = { passed: !!readAt && !!departure() && !!arrival() && !!reply() && !!apartmentActivity()?.length
    && serviceExchangeOccurred(world, actor, resident) && outcomes.evidence.serviceMeals.length > 0
    && hasBakeryServiceFeedback(outcomes.evidence, feedback) && receiptHasMeal && reflection.executed
    && cameras.every(c => c.count > 0 && !c.camera.status().error) && removedIntact && !outcomes.errors.length && systemDiagnosticsAreClean(systemDiagnostics),
    systemDiagnostics, stage: "bounded_episode_complete", requiresQualitativeReview: true, readAt, reply: reply(), departure: departure(), arrival: arrival(),
    apartmentActivity: apartmentActivity(), serviceMeals: outcomes.evidence.serviceMeals, handoffs: outcomes.evidence.handoffs,
    sharedReleases: outcomes.evidence.sharedReleases, receiptHasMeal, reflection, removedIntact, goals: sim.getAgentGoals("Elaine"),
    limitations: "One message-driven opportunity and two scheduled author reviews. No semantic goal binding/completion credit, open-ended scheduler, all-spirit run or H3 depiction." };
}); } catch (error) { result = { ...result, passed: false, error: String(error), reason: stopReason ?? "stage_failed" }; }
finally {
  if (interval) clearInterval(interval); clearTimeout(timer);
  const checkpoint = (prefix: string) => { if (bed) {
    save(`${prefix}-world.json`, serializeWorld(bed.sim.world, bed.sim.god.systemRegistry)); save(`${prefix}-state.json`, bed.snapshot());
    save(`${prefix}-runtime.json`, { status: bed.sim.getRuntimeStatus(), health: bed.sim.getSystemHealth(),
      diagnostics: getArchitectDiagnostics(bed.sim.world), service: outcomes && { meals: outcomes.evidence.meals,
        serviceMeals: outcomes.evidence.serviceMeals, errors: outcomes.errors }, cameras: cameras.map(c => ({ name: c.name, count: c.count, lastEnd: c.lastEnd, status: c.camera.status() })) });
  } };
  const failures = await finalizeBaselineObservation({
    checkpoint: () => checkpoint("pre-stop"),
    lifecycle: stage => append("lifecycle.jsonl", { stage, wallMs: performance.now() - began, atSimMs: bed?.elapsedMs }),
    stop: () => { controller.abort(Error("Episode finished")); bed?.stop(); },
    drain: async () => {
      await drainBaselineWork(() => bed?.sim.drainPendingOperations(2000) ?? Promise.resolve(), (globalThis as any).__argosBaselineDrain);
      drained = true;
    }, disposers,
  });
  try { checkpoint("final"); } catch { failures.push({ stage: "post_drain_checkpoint", error: "Final checkpoint failed" }); }
  const timing = evaluateForegroundAttempts(timings, performance.now() - began);
  save("foreground-timing.json", timing);
  if (failures.length || observerError || !timing.complete) result.passed = false;
  save("verdict.json", { result, stopReason, observerError, drained, cleanupFailures: failures,
    wallMs: Math.round(performance.now() - began), simMs: bed?.elapsedMs, journal: journal.snapshot() });
  process.exitCode = result.passed && drained && !stopReason && !observerError ? 0 : 1;
}
