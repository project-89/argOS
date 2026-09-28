/** One real builder invocation, followed by native deterministic physics checks.
 * Residents do not infer or choose actions here: the evaluator selects weather
 * and explicitly asks one person to walk indoors. This is NOT an autonomous
 * spirit/NPC test, a performance benchmark, or an H3 rendering run. */
import "dotenv/config";
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { SpatialDemo } from "./spatial-demo";
import { getCodingDaemon } from "../engineering/coding-daemon";
import { serializeWorld } from "../persistence/world-persistence";
import { getRoomForEntity } from "../ecs/location";
import { subscribeCommittedEvents, type PublicCommittedEvent } from "../runtime/committed-events";
import { withSimulationTask } from "../runtime/task-scope";
import { SPATIAL_WEATHER_MECHANIC_SYSTEM } from "./spatial-weather-mechanic";

if (process.argv.slice(2).join(" ") !== "--live") throw Error("Use --live for one paid, bounded system build and manual physics check. No NPC/spirit inference, retries or H3.");
const root = resolve("recordings"); mkdirSync(root, { recursive: true });
const directory = mkdtempSync(join(root, "weather-mechanic-check-")); chmodSync(directory, 0o700);
const releaseDirectory = join(directory, "engineering");
const save = (file: string, data: unknown) => writeFileSync(join(directory, file), JSON.stringify(data, null, 2), { mode: 0o600 });
const append = (file: string, data: unknown) => appendFileSync(join(directory, file), JSON.stringify(data) + "\n", { mode: 0o600 });
const bounds = { wallMs: 240_000, simulationMs: 600_000, stepMs: 100, builderTimeoutMs: 120_000,
  maxJobs: 1, maxInProcessProviderAttempts: 3, drainMs: 8000 };
// Mirror the existing daemon's backend choice; do not override its setting.
const backend = process.env.ARGOS_CODE_BUILDER === "gemini" ? "gemini" : "codex";
save("protocol.json", { kind: "operator-requested-live-generated-weather-physics-check", bounds, backend,
  modelSelection: "Unchanged configured builder/model; no backend or model override.", releaseDirectory,
  npcInference: false, spiritInference: false, h3: false, broadGeneration: false, automaticRetry: false,
  declaredInterventions: ["Native rain in an already occupied outdoor room", "One explicit native walk to an existing indoor room", "Native clear weather after its cooldown"],
  physicsChecks: ["Independent admission of a real generated release", "Rain wets exposed existing resident and furniture",
    "Indoor furniture remains dry", "Committed wetness enters the resident's body/local sensory context", "Native walk reaches shelter",
    "Sheltered clothes dry while furniture outside stays wet", "Clear weather dries that furniture", "Stop retains last confirmed physical wetness"],
  diagnosticScheduling: "Native ticks continue during the build. After activation, diagnostic phase steps wait for pending system workers; this isolates physics and is not a throughput benchmark.",
  excludedClaims: ["Autonomous Weaver discovery or God approval", "NPC voluntarily chooses shelter", "Subsequent real spirit judgment", "Plant growth", "Ten-trial baseline", "Ten-minute endurance", "Exact historical exposure across delayed rate changes"] });
console.log("WEATHER_MECHANIC_EVIDENCE", directory);

const began = performance.now(), controller = new AbortController(), originalFetch = globalThis.fetch;
let demo: SpatialDemo | undefined, stopReason = "", fatal: string | undefined, phase = "initialization";
let providerAttempts = 0, activeRequests = 0, lastSampleSimMs = -1000;
const errors: string[] = [], receipts: PublicCommittedEvent[] = [], removers: Array<() => void> = [];
const changesSeen = new Set<string>(), eventsSeen = new Set<number>();
const gates = { realReleaseActive: false, oneJobOnly: false, exposedResidentWet: false, exposedFurnitureWet: false,
  indoorControlDry: false, personalWetnessPerceived: false, nativeWalkCompleted: false, shelterDriesResident: false,
  rainKeepsOutdoorFurnitureWet: false, clearDriesFurniture: false, thresholdsRecorded: false, stoppedStateRetained: false };
const evidence: Record<string, unknown> = {};
function collect(force = false) {
  if (!demo) return;
  const snapshot = demo.snapshot();
  for (const change of snapshot.townLife?.changes ?? []) if (!changesSeen.has(change.id)) {
    changesSeen.add(change.id); append("world-changes.jsonl", { sourceId: demo.sourceId, phase, change });
  }
  for (const event of snapshot.events) if (!eventsSeen.has(event.id)) {
    eventsSeen.add(event.id); append("operator-events.jsonl", { sourceId: demo.sourceId, phase, event });
  }
  if (force || demo.atSimMs - lastSampleSimMs >= 1000) {
    lastSampleSimMs = demo.atSimMs;
    append("samples.jsonl", { phase, wallMs: Math.round(performance.now() - began), atSimMs: demo.atSimMs,
      sourceId: demo.sourceId, weather: snapshot.weather, wetness: demo.weatherMechanic?.view(), coding: demo.sim.getCodingStatus() });
  }
  return snapshot;
}
function stop(reason: string) {
  if (stopReason) return; stopReason = reason;
  try { if (demo) save("before-stop.json", collect(true)); } catch (error) { errors.push(`Before-stop evidence: ${String(error)}`); }
  try { demo?.stop(); } catch (error) { errors.push(`Stop: ${String(error)}`); }
  finally { controller.abort(Error(reason)); }
}
// Codex CLI network inference belongs to its independently time-bounded child.
// If the configured backend is Gemini, allow only its existing code-builder
// calls, never an accidental resident, God, or Narrator request.
globalThis.fetch = async (input, init) => {
  controller.signal.throwIfAborted();
  const url = new URL(input instanceof Request ? input.url : String(input));
  const body = typeof init?.body === "string" ? init.body : input instanceof Request ? await input.clone().text() : "";
  if (backend !== "gemini" || url.protocol !== "https:" || url.hostname !== "generativelanguage.googleapis.com"
    || !body.includes("You are the Argos system engineering daemon.") || providerAttempts >= bounds.maxInProcessProviderAttempts)
    throw Error("This check permits only its bounded configured code-builder inference.");
  const id = ++providerAttempts, issued = performance.now(); activeRequests++;
  append("provider-attempts.jsonl", { id, phase: "issued", atWallMs: issued - began, path: url.pathname });
  try {
    const response = await originalFetch(input, { ...init, signal: AbortSignal.any([controller.signal,
      ...(init?.signal ? [init.signal] : []), ...(input instanceof Request ? [input.signal] : [])]) });
    append("provider-attempts.jsonl", { id, phase: "settled", status: response.status, wallMs: performance.now() - issued });
    return response;
  } catch (error) { append("provider-attempts.jsonl", { id, phase: "failed", error: String(error) }); throw error; }
  finally { activeRequests--; }
};
const deadline = setTimeout(() => stop("wall_bound"), bounds.wallMs);
const handlers = (["SIGINT", "SIGTERM"] as const).map(signal => {
  const handler = () => stop(`operator_${signal}`); process.once(signal, handler); return { signal, handler };
});
async function step(waitForWorkers: boolean) {
  controller.signal.throwIfAborted();
  if (!demo?.running) throw Error("Native session stopped before the declared checks completed");
  demo.advance(bounds.stepMs);
  if (waitForWorkers) await getCodingDaemon(demo.sim.world)!.settle();
  collect();
  // Always yield to timers/worker responses/cancellation; no busy-spin physics.
  await sleep(waitForWorkers ? 1 : bounds.stepMs);
}
async function until(test: () => boolean, simulationMs: number, name: string) {
  const start = demo!.atSimMs; phase = name; collect(true);
  while (!test() && demo!.atSimMs - start < simulationMs) await step(true);
  collect(true); return test();
}
try {
  await withSimulationTask(controller.signal, async () => {
    demo = await SpatialDemo.create({ scenario: "town", evolving: true, live: false, automaticClock: false,
      seconds: bounds.simulationMs / 1000, weatherMechanic: { directory: releaseDirectory } });
    const initial = demo.snapshot();
    if (initial.limits.ai || initial.mode !== "manual" || !demo.weatherMechanic || !demo.townLife
      || demo.sim.getCodingStatus()?.admissionBudget.limit !== 1) throw Error("Check initialized outside its declared manual one-build scope");
    save("initial.json", initial); save("initial-world.json", serializeWorld(demo.sim.world, demo.sim.god.systemRegistry));
    removers.push(subscribeCommittedEvents(demo.sim.world, event => { receipts.push(event); append("native-receipts.jsonl", event); }));
    removers.push(demo.sim.onSystem(event => { if (event.type === "system:build") append("build-events.jsonl", { atSimMs: demo!.atSimMs, event }); }));
    await demo.start(); phase = "building";
    while (demo.running && !controller.signal.aborted) {
      const status = demo.sim.getCodingStatus()!, job = status.jobs[0];
      if (status.jobs.length > 1) throw Error("One-job admission scope was exceeded");
      if (job?.status === "active") { gates.realReleaseActive = !!demo.sim.god.systemRegistry.systems.get(SPATIAL_WEATHER_MECHANIC_SYSTEM)?.managedRelease;
        gates.oneJobOnly = status.admissionBudget.used === 1 && status.jobs.length === 1; evidence.acceptedJob = job; break; }
      if (job && ["rejected", "cancelled", "rolled_back"].includes(job.status)) { evidence.failedJob = job; stop(`builder_${job.status}`); return; }
      await step(false);
    }
    if (!gates.realReleaseActive) return;
    const state = demo.snapshot(), room = state.rooms.find(r => r.environment === "outdoor"
      && state.entities.some(e => e.roomId === r.id && e.kind === "actor")
      && state.entities.some(e => e.roomId === r.id && ["chair", "table", "sofa"].includes(e.asset)));
    if (!room) throw Error("No existing occupied outdoor area with approved furniture");
    const resident = state.entities.find(e => e.roomId === room.id && e.kind === "actor")!;
    const furniture = state.entities.find(e => e.roomId === room.id && ["chair", "table", "sofa"].includes(e.asset))!;
    const shelter = state.rooms.find(r => r.name === "Shared Workshop" && r.environment === "indoor")
      ?? state.rooms.find(r => r.environment === "indoor")!;
    const control = state.entities.find(e => e.roomId === shelter.id && ["chair", "table", "sofa"].includes(e.asset));
    if (!control) throw Error("No existing indoor furniture control");
    const wetness = (id: number) => demo!.weatherMechanic!.getWetness(id);
    evidence.selected = { sourceId: demo.sourceId, room, resident, furniture, shelter, control };
    await until(() => [resident.id, furniture.id, control.id].every(id => wetness(id) !== undefined), 5000, "initial-committed-values");
    evidence.beforeRain = { atSimMs: demo.atSimMs, resident: wetness(resident.id), furniture: wetness(furniture.id), control: wetness(control.id) };
    const rain = demo.townLife.weather.set("rain", room.id); save("native-rain.json", rain);
    if (rain.status !== "applied") throw Error(`Native rain admission failed: ${rain.detail}`);
    await until(() => (wetness(resident.id) ?? 0) >= .5 && (wetness(furniture.id) ?? 0) >= .5, 30_000, "rain-exposure");
    const wetContext = demo.weatherMechanic.localContext(resident.id);
    gates.exposedResidentWet = (wetness(resident.id) ?? 0) >= .5;
    gates.exposedFurnitureWet = (wetness(furniture.id) ?? 0) >= .5;
    gates.indoorControlDry = wetness(control.id) === 0;
    gates.personalWetnessPerceived = !!wetContext?.includes("Your clothes feel wet against your skin");
    evidence.afterRain = { atSimMs: demo.atSimMs, resident: wetness(resident.id), furniture: wetness(furniture.id), control: wetness(control.id), localContext: wetContext };
    if (!gates.exposedResidentWet || !gates.exposedFurnitureWet) { stop("rain_physics_gate_failed"); return; }
    phase = "operator-dispatched-native-walk"; const moveAt = demo.atSimMs;
    demo.dispatch(resident.key, "move", shelter.key);
    await until(() => getRoomForEntity(demo!.sim.world, resident.id) === shelter.id
      && receipts.some(r => r.actorId === resident.id && r.targetId === shelter.id && r.action === "move" && r.status === "succeeded" && r.atSimMs >= moveAt), 60_000, phase);
    gates.nativeWalkCompleted = getRoomForEntity(demo.sim.world, resident.id) === shelter.id
      && receipts.some(r => r.actorId === resident.id && r.targetId === shelter.id && r.action === "move" && r.status === "succeeded" && r.atSimMs >= moveAt);
    evidence.nativeWalk = receipts.filter(r => r.actorId === resident.id && r.action === "move" && r.atSimMs >= moveAt);
    if (!gates.nativeWalkCompleted) { stop("native_walk_gate_failed"); return; }
    const arrivalWetness = wetness(resident.id)!;
    await until(() => (wetness(resident.id) ?? 1) <= arrivalWetness - .15, 40_000, "sheltered-drying");
    gates.shelterDriesResident = (wetness(resident.id) ?? 1) <= arrivalWetness - .15;
    gates.rainKeepsOutdoorFurnitureWet = (wetness(furniture.id) ?? 0) >= .5;
    gates.indoorControlDry &&= wetness(control.id) === 0;
    evidence.afterShelter = { atSimMs: demo.atSimMs, arrivalWetness, resident: wetness(resident.id), furniture: wetness(furniture.id), control: wetness(control.id),
      localContext: demo.weatherMechanic.localContext(resident.id) };
    await until(() => demo!.atSimMs >= demo!.townLife!.weather.view().nextChangeAtSimMs, 60_000, "native-weather-cooldown");
    const clear = demo.townLife.weather.set("clear", room.id); save("native-clear.json", clear);
    if (clear.status !== "applied") throw Error(`Native clear-weather admission failed: ${clear.detail}`);
    const beforeClear = wetness(furniture.id)!;
    await until(() => (wetness(furniture.id) ?? 1) < .4, 75_000, "clear-weather-drying");
    gates.clearDriesFurniture = beforeClear > (wetness(furniture.id) ?? 1) && (wetness(furniture.id) ?? 1) < .4;
    gates.thresholdsRecorded = [...changesSeen].some(id => id.startsWith("wetness:"));
    const confirmed = wetness(furniture.id); evidence.afterClear = { atSimMs: demo.atSimMs, beforeClear, furniture: confirmed, resident: wetness(resident.id) };
    save("physics-complete.json", collect(true)); stop("physics_checks_completed");
    gates.stoppedStateRetained = confirmed !== undefined && wetness(furniture.id) === confirmed;
  });
} catch (error) {
  if (!controller.signal.aborted) fatal = String(error);
  stop(fatal ? "check_error" : "bounded_stop");
} finally {
  clearTimeout(deadline); if (!stopReason) stop("check_finished");
  if (demo) {
    try {
      const drained = await Promise.race([getCodingDaemon(demo.sim.world)!.settle()
        .then(() => getCodingDaemon(demo!.sim.world)!.flush()).then(() => true), sleep(bounds.drainMs).then(() => false)]);
      if (!drained) errors.push("Worker persistence did not drain within the declared bound.");
    }
    catch (error) { errors.push(`Worker drain: ${String(error)}`); }
  }
  for (const remove of removers) remove();
  for (const { signal, handler } of handlers) process.removeListener(signal, handler);
  try { if (demo) {
    save("session.json", demo.snapshot()); save("world.json", serializeWorld(demo.sim.world, demo.sim.god.systemRegistry));
    save("coding-status.json", demo.sim.getCodingStatus());
  } } catch (error) { errors.push(`Final evidence: ${String(error)}`); }
  const result = { kind: "operator-requested-live-generated-weather-physics-check", directory, releaseDirectory, backend, stopReason, fatal,
    observerErrors: errors, wallMs: Math.round(performance.now() - began), simulationMs: demo?.atSimMs,
    providerAttempts: backend === "gemini" ? providerAttempts : "Codex child process; see its bounded job diagnostics", activeRequests,
    gates, passed: Object.values(gates).every(Boolean) && !fatal && !errors.length && !activeRequests,
    evidence, coding: demo?.sim.getCodingStatus(), autonomousSpiritNpcLoop: "NOT_ASSESSED", baselineAndEndurance: "OPEN" };
  save("result.json", result); console.log("WEATHER_MECHANIC_RESULT", JSON.stringify(result));
  // Dedicated process: cancelled provider guard remains installed so a late
  // retry cannot escape this run's stated inference boundary.
  process.exit(result.passed ? 0 : 1);
}
