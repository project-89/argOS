/** One prospective, isolated live observation. No evaluator selects NPC actions,
 * forces construction/weather, refreshes stale grants, or reruns failed trials. */
import "dotenv/config";
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { entityExists, getRelationTargets, hasComponent } from "bitecs";
import { SpatialDemo } from "./spatial-demo";
import { createTownScenario } from "./spatial-town-fixtures";
import { Goal, GoalLifecycle, Name, ObjectState, Position, WorkingMemoryIdentity } from "../ecs/components";
import { HasGoal, SittingOn } from "../ecs/relations";
import { getRoomForEntity } from "../ecs/location";
import { getComponent } from "../ecs/component-registry";
import { subscribeCommittedEvents } from "../runtime/committed-events";
import { withSimulationTask } from "../runtime/task-scope";
import { serializeWorld } from "../persistence/world-persistence";
import { getWorkingMemory } from "../cognition/working-memory";
import { snapshotActorContinuation } from "../cognition/actor-continuation";
import { getObservedProposalDiagnostics } from "../spirits/architect-spirit";
import { getArchitectDiagnostics } from "../spirits/architect-diagnostics";
import { getFactoryState } from "../spirits/spirit-factory";
import { getSpiritSystemState } from "../spirits/spirit-system";
import { getGodAutopilotObserverFailures, subscribeGodAutopilotReviews, type GodAutopilotReview } from "../god/god-autopilot";
import { getSystemDiagnosticCoverage, subscribeSystemDiagnostics } from "../ecs/dynamic-systems";
import { MODEL_IDS } from "../llm/config";
import { evaluateTownGrowthEvidence, type OwnedProposal, type ReceiptEvidence, type WeaverReportEvidence } from "./spatial-town-growth-evidence";

if (process.argv.slice(2).join(" ") !== "--live") throw Error("Use --live to authorize one isolated 180-second paid diagnostic; no retries or H3.");
const recordings = resolve("recordings"); mkdirSync(recordings, { recursive: true });
const directory = mkdtempSync(join(recordings, "town-growth-check-")); chmodSync(directory, 0o700);
const save = (file: string, value: unknown) => writeFileSync(join(directory, file), JSON.stringify(value, null, 2), { mode: 0o600 });
const append = (file: string, value: unknown) => appendFileSync(join(directory, file), JSON.stringify(value) + "\n", { mode: 0o600 });
const bounds = { wallMs: 180_000, drainMs: 8_000, maxHttpAttempts: 400, sampleMs: 1000 };
save("protocol.json", { version: 1, fixture: "cafe-seat-need", bounds, models: MODEL_IDS,
  unchanged: "Native ten-resident town cognition, spirit cadences, God review and construction authority",
  evaluatorMutationsDuringRun: 0, worldEffectsForced: 0, actionsForced: 0, retries: 0, h3: false,
  criteria: ["Initially no cafe chairs and Tess has an authored seated cafe break purpose", "Current source-owned Weaver chair proposal grounded by native evidence",
    "God approval with exact approver and native successful tool result", "Executed proposal adopts one native cafe chair and matching 3D entity",
    "Tess independently commits interact; native occupied/SittingOn and exact source/actor/target identities agree",
    "That same receipt is retained in construction feedback", "A subsequent actual Weaver review reports the same receipt ID"],
  warning: "A failed, absent, expired or late stage remains failed/unobserved. One diagnostic does not close ten-trial, ten-minute endurance or sub-100ms construction gates." });
save("fixture.json", createTownScenario("cafe-seat-need"));
console.log("TOWN_GROWTH_EVIDENCE", directory);
const began = performance.now(), controller = new AbortController(), originalFetch = globalThis.fetch;
let demo: SpatialDemo | undefined, initial: ReturnType<SpatialDemo["snapshot"]> | undefined;
let stopReason = "", fatal: string | undefined, requests = 0, activeRequests = 0, settledRequests = 0;
let tessId = -1, tessKey = "", cafeId = -1, weaverId = -1;
const errors: string[] = [], disposals: Array<() => void> = [];
const receipts: ReceiptEvidence[] = [], proposals: OwnedProposal[] = [], reviews: GodAutopilotReview[] = [];
const reports = new Map<string, WeaverReportEvidence>(), proposalVersions = new Set<string>();
function rememberReport(message: any, senderId: number, senderName: string) {
  if (!demo || message.subject !== "World activity reviewed" || message.data?.sourceId !== demo.sourceId
    || senderId !== weaverId || senderName !== "The Weaver" || reports.has(message.id)) return;
  const row: WeaverReportEvidence = structuredClone({ sourceId: demo.sourceId, capturedAtSimMs: demo.atSimMs,
    id: message.id, senderId, senderName, subject: message.subject, data: message.data });
  reports.set(row.id, row); append("weaver-reports.jsonl", row);
}
function collect() {
  if (!demo) return;
  for (const diagnostic of getObservedProposalDiagnostics(demo.sim.world)) {
    // Native per-world diagnostics are the ownership filter; the global factory
    // alone is never proof that a proposal belongs to this trial.
    const proposal = getFactoryState().pendingProposals.find(p => p.id === diagnostic.id);
    if (!proposal) continue;
    const version = JSON.stringify({ diagnostic, proposal });
    if (!proposalVersions.has(version)) { proposalVersions.add(version);
      const row = structuredClone({ sourceId: demo.sourceId, atSimMs: demo.atSimMs, diagnostic, proposal });
      proposals.push(row); append("proposals.jsonl", row); }
  }
  const registry = getSpiritSystemState(demo.sim.world)?.registry;
  if (registry?.world === demo.sim.world) for (const message of [...registry.messageQueue,
    ...[...registry.spirits.values()].flatMap(s => [...s.inbox, ...s.outbox])])
    rememberReport(message, message.from, message.senderLabel ?? registry.spirits.get(message.from)?.definition.name ?? "");
  for (const message of demo.sim.god.autopilot?.inbox ?? []) rememberReport(message, message.fromEid, message.fromName);
}
const cognitiveState = () => demo?.actors.map(actor => ({ actor, key: WorkingMemoryIdentity.id[actor], name: Name.value[actor],
  continuation: snapshotActorContinuation(demo!.sim.world, actor),
  goals: getRelationTargets(demo!.sim.world, actor, HasGoal).filter(id => hasComponent(demo!.sim.world, id, Goal)).map(id => ({
    id, key: WorkingMemoryIdentity.id[id], description: Goal.description[id], status: Goal.status[id], priority: Goal.priority[id],
    progress: Goal.progress[id], successJson: Goal.successJson[id],
    ...(hasComponent(demo!.sim.world, id, GoalLifecycle) ? { source: GoalLifecycle.source[id], mode: GoalLifecycle.mode[id],
      reason: GoalLifecycle.reason[id], reviewPendingJson: GoalLifecycle.reviewPendingJson[id], deferredJson: GoalLifecycle.deferredJson[id] } : {}),
  })) }));
function evidence() {
  if (!demo) return;
  collect(); return { wallMs: performance.now() - began, frame: demo.snapshot(), cognition: cognitiveState(),
    growth: demo.townLife!.inspectGrowth(), architect: getArchitectDiagnostics(demo.sim.world),
    proposals: getObservedProposalDiagnostics(demo.sim.world), evolution: demo.sim.getEvolutionStatus(),
    runtime: demo.sim.getRuntimeStatus(), operational: demo.sim.getOperationalStatus(),
    god: demo.sim.god.autopilot && { lastRunAt: demo.sim.god.autopilot.lastRunAt,
      consecutiveFailures: demo.sim.god.autopilot.consecutiveFailures, lastError: demo.sim.god.autopilot.lastError,
      inbox: structuredClone(demo.sim.god.autopilot.inbox) } };
}
function stop(reason: string) {
  if (stopReason) return; stopReason = reason;
  try { if (demo) save("before-stop.json", evidence()); } catch (error) { errors.push(`Before-stop evidence: ${String(error)}`); }
  try { demo?.stop(); } catch (error) { errors.push(`Stop: ${String(error)}`); }
  finally { controller.abort(new Error(reason)); }
}
globalThis.fetch = async (input, init) => {
  controller.signal.throwIfAborted();
  if (requests >= bounds.maxHttpAttempts) { stop("request_bound"); throw controller.signal.reason; }
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.protocol !== "https:" || url.hostname !== "generativelanguage.googleapis.com") throw Error("Town check permits only the existing Google cognition provider");
  const id = ++requests, at = performance.now(); activeRequests++;
  // No headers, credentials, query strings or environment are archived.
  append("requests.jsonl", { id, phase: "issued", path: url.pathname, atWallMs: at - began });
  try {
    const requestText = typeof init?.body === "string" ? init.body : input instanceof Request ? await input.clone().text() : undefined;
    let requestBody: unknown = requestText;
    if (requestText) { try { requestBody = JSON.parse(requestText); } catch { /* retain uninterpreted body */ } }
    append("provider-exchanges.jsonl", { id, phase: "issued", path: url.pathname, atWallMs: at - began, body: requestBody });
    const response = await originalFetch(input, { ...init, signal: AbortSignal.any([controller.signal,
      ...(init?.signal ? [init.signal] : []), ...(input instanceof Request ? [input.signal] : [])]) });
    const body = await response.text(); settledRequests++;
    append("provider-exchanges.jsonl", { id, phase: "settled", status: response.status, durationMs: performance.now() - at, body });
    append("requests.jsonl", { id, phase: "settled", status: response.status, durationMs: performance.now() - at });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (error) { append("requests.jsonl", { id, phase: "failed", durationMs: performance.now() - at, error: String(error) }); throw error; }
  finally { activeRequests--; }
};
const deadline = setTimeout(() => stop("wall_bound"), bounds.wallMs);
const signals = (["SIGINT", "SIGTERM"] as const).map(signal => { const handler = () => stop(`operator_${signal}`); process.once(signal, handler); return { signal, handler }; });
try {
  await withSimulationTask(controller.signal, async () => {
    demo = await SpatialDemo.create({ scenario: "town", evolving: true, townFixture: "cafe-seat-need", live: true, seconds: 180 });
    cafeId = demo.byId.get("town-cafe")!; tessId = demo.actors.find(id => Name.value[id] === "Tess")!;
    tessKey = WorkingMemoryIdentity.id[tessId];
    weaverId = getSpiritSystemState(demo.sim.world)!.registry.byName.get("The Weaver")!;
    initial = demo.snapshot(); save("initial.json", initial); save("initial-world.json", serializeWorld(demo.sim.world, demo.sim.god.systemRegistry));
    if (initial.actors.length !== 10 || initial.entities.some(e => e.roomId === cafeId && ["chair", "sofa"].includes(e.asset)))
      throw Error("Fixture did not establish ten residents and the intended seating gap");
    disposals.push(subscribeCommittedEvents(demo.sim.world, event => {
      try {
        const world = demo!.sim.world, target = event.targetId, present = target !== undefined && entityExists(world, target);
        const placement = getComponent("SpatialPlacement");
        const row: ReceiptEvidence = structuredClone({ event, native: {
          actorKey: WorkingMemoryIdentity.id[event.actorId], sittingOn: getRelationTargets(world, event.actorId, SittingOn),
          targetPresent: present, ...(present ? { targetKey: WorkingMemoryIdentity.id[target!], targetRoom: getRoomForEntity(world, target!),
            targetState: ObjectState.current[target!], position: { x: Position.x[target!], y: Position.y[target!] },
            ...(placement && hasComponent(world, target!, placement) ? { placement: { assetId: placement.assetId[target!], siteId: placement.siteId[target!] } } : {}),
            visual: demo!.snapshot().entities.find(e => e.id === target), } : {}),
        } }); receipts.push(row); append("receipts.jsonl", row);
      } catch (error) { errors.push(`Receipt ${event.id}: ${String(error)}`); }
    }));
    disposals.push(subscribeGodAutopilotReviews(demo.sim.god, review => {
      const row = structuredClone(review); reviews.push(row); append("god-reviews.jsonl", row);
      for (const message of row.before) rememberReport(message, message.fromEid, message.fromName);
      collect();
    }));
    disposals.push(subscribeSystemDiagnostics(demo.sim.god.systemRegistry, row => append("system-diagnostics.jsonl", row)));
    await demo.start();
    while (demo.running && !controller.signal.aborted) { append("samples.jsonl", evidence()); await sleep(bounds.sampleMs); }
    if (!stopReason) stop("native_session_stopped");
  });
} catch (error) { if (!controller.signal.aborted) fatal = String(error); stop(fatal ? "probe_error" : "bounded_stop"); }
finally {
  clearTimeout(deadline); if (!stopReason) stop("probe_finished");
  const drainUntil = performance.now() + bounds.drainMs;
  while (activeRequests > 0 && performance.now() < drainUntil) await sleep(50);
  for (const dispose of disposals) dispose();
  for (const { signal, handler } of signals) process.removeListener(signal, handler);
  let result: ReturnType<typeof evaluateTownGrowthEvidence> | undefined;
  if (demo) {
    save("after-stop.json", evidence()); save("world.json", serializeWorld(demo.sim.world, demo.sim.god.systemRegistry));
    save("session.json", demo.snapshot());
    save("working-memory.json", demo.actors.map(actor => ({ name: Name.value[actor], memory: getWorkingMemory(demo!.sim.world, actor) })));
    result = evaluateTownGrowthEvidence({ sourceId: demo.sourceId, godId: demo.sim.god.eid, weaverId, cafeId, tessId, tessKey,
      initialNeed: initial?.actors.find(a => a.id === tessId)?.goals?.some(g => g.description === createTownScenario("cafe-seat-need").residents.find(r => r.id === "tess")!.initialGoal.description) === true,
      initialActorCount: initial?.actors.length ?? 0, initialCafeSeats: initial?.entities.filter(e => e.roomId === cafeId && ["chair", "sofa"].includes(e.asset)).length ?? -1,
      proposals, reviews, receipts, growth: demo.townLife!.inspectGrowth(), reports: [...reports.values()] });
  }
  const summary = { kind: "single-bounded-unmet-need-observation", directory, stopReason, fatal, observerErrors: errors,
    wallMs: Math.round(performance.now() - began), simulationMs: demo?.atSimMs, requests, settledRequests, activeRequests,
    godObserverFailures: demo && getGodAutopilotObserverFailures(demo.sim.god),
    systemDiagnostics: demo && getSystemDiagnosticCoverage(demo.sim.god.systemRegistry), result };
  save("result.json", summary); console.log("TOWN_GROWTH_RESULT", JSON.stringify(summary));
  // A failed behavioral gate is preserved data, not a reason to extend/retry.
  // Exit also closes provider connection pools after the bounded drain.
  globalThis.fetch = originalFetch;
  process.exit(fatal || errors.length || activeRequests ? 1 : 0);
}
