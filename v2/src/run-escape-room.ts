/** Bounded seeded cognition trial. Default is an explicitly scripted physical
 * oracle; --live opts into shared Gemini cognition. No renderer or world builder. */
import "dotenv/config";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { format } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { ESCAPE_PERTURBATION_STAGES, EscapeRoomTestbed, isEscapePerturbationStage, type EscapeRoomEvent, type EscapeTopology } from "./demo/escape-room";
import { runEscapeRoomFixture } from "./evals/escape-room-fixture";
import { evaluateEscapeRoomRun, formatEscapeRoomEvaluation } from "./evals/escape-room-evaluation";
import { serializeWorld } from "./persistence/world-persistence";
import { getWorkingMemory } from "./cognition/working-memory";
import { getCoordinationMemory, getCoordinationRevision } from "./cognition/coordination-memory";
import { getSocialDialogue, getSocialExchanges } from "./cognition/social-memory";
import { getForegroundCognitionReadiness } from "./cognition/idle-cognition";
import { hasPendingCognitionStimuli } from "./cognition/cognition-system";
import { MODEL_IDS } from "./llm/config";
import { getRelationTargets, hasComponent } from "bitecs";
import { Plan } from "./ecs/components";
import { HasPlan } from "./ecs/relations";
import { chronicle } from "./cognition/simulation-chronicle";
import { subscribeCommittedEvents } from "./runtime/committed-events";

const argv = process.argv.slice(2);
const live = argv.includes("--live");
const arg = (name: string, fallback: string) => argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const seconds = Number(arg("seconds", "300")), seed = arg("seed", "11");
const selectedTopology = arg("topology", "observatory");
if (!["observatory", "relay"].includes(selectedTopology)) throw new Error("Choose --topology=observatory|relay");
const topology = selectedTopology as EscapeTopology;
const perturbAt = Number(arg("perturb-at", "0"));
const perturbAfter = arg("perturb-after", "");
if (!Number.isFinite(seconds) || seconds < 10 || seconds > 600) throw new Error("Choose --seconds=10..600");
if (!Number.isFinite(perturbAt) || perturbAt < 0 || perturbAt >= seconds || perturbAt > 0 && !live)
  throw new Error("Choose --perturb-at within a live run, or omit it");
if (perturbAfter && (!live || perturbAt > 0 || !isEscapePerturbationStage(perturbAfter)))
  throw new Error(`Choose --perturb-after=${ESCAPE_PERTURBATION_STAGES.join("|")} for a live run, without --perturb-at`);
if (!seed.trim() || seed.length > 80) throw new Error("Choose a nonempty seed up to 80 characters");
if (live && !String(process.env.GOOGLE_GENERATIVE_AI_API_KEY || "").trim())
  throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is required for --live");

await mkdir(resolve("recordings"), { recursive: true });
const lockPath = resolve("recordings", "escape-room-live.lock"), token = randomUUID();
let lockOwned = false;
if (live) {
  try {
    const old = JSON.parse(await readFile(lockPath, "utf8"));
    if (!Number.isSafeInteger(old.pid) || old.pid <= 0) throw new Error("Unrecognized live-run lock; inspect it before continuing");
    let running = true;
    try { process.kill(old.pid, 0); } catch (e: any) { if (e.code === "ESRCH") running = false; else throw e; }
    if (running) throw new Error(`Another escape-room live process is running (PID ${old.pid}); no duplicate run started`);
    await rename(lockPath, `${lockPath}.stale-${Date.now()}`);
  } catch (e: any) { if (e.code !== "ENOENT") throw e; }
  const file = await open(lockPath, "wx", 0o600);
  try { await file.writeFile(JSON.stringify({ token, pid: process.pid, seed, topology, startedAt: new Date().toISOString() })); lockOwned = true; }
  finally { await file.close(); }
}

const directory = await mkdtemp(resolve("recordings", "escape-room-"));
const runtimeLog = createWriteStream(join(directory, "runtime.log"), { flags: "wx", mode: 0o600 });
const eventLog = createWriteStream(join(directory, "events.jsonl"), { flags: "wx", mode: 0o600 });
const memoryLog = createWriteStream(join(directory, "coordination.jsonl"), { flags: "wx", mode: 0o600 });
const stateLog = createWriteStream(join(directory, "state.jsonl"), { flags: "wx", mode: 0o600 });
const planLog = createWriteStream(join(directory, "plans.jsonl"), { flags: "wx", mode: 0o600 });
const chronicleLog = createWriteStream(join(directory, "chronicle.jsonl"), { flags: "wx", mode: 0o600 });
const publicEventLog = createWriteStream(join(directory, "public-events.jsonl"), { flags: "wx", mode: 0o600 });
let unsubscribePublicEvents: (() => void) | undefined;
// This CLI owns one simulation in a dedicated process. Preserve actual proposal
// discards separately from executor receipts; the global chronicle is not an
// actor perception or a multi-world attribution API. Wall timestamps are exact,
// sampledElapsedMs is the last 500ms physical sample, not exact execution time.
let sampledElapsedMs = 0;
const unsubscribeChronicle = chronicle.subscribe(entry => chronicleLog.write(JSON.stringify({ ...entry,
  sampledElapsedMs, visibility: "operator" }) + "\n"));
const originals = { log: console.log, warn: console.warn, error: console.error };
let logBytes = 0;
for (const method of ["log", "warn", "error"] as const) console[method] = (...items: unknown[]) => {
  const line = format(...items) + "\n";
  if (logBytes < 10_000_000) { runtimeLog.write(line); logBytes += Buffer.byteLength(line); }
};
originals.log(`${live ? "LIVE COGNITION" : "SCRIPTED PHYSICAL ORACLE"} · ${topology === "relay" ? "Flooded Relay" : "Drowned Observatory"} · ${topology} topology · seed ${seed} · H3 disabled\nArtifacts: ${directory}`);
let room: EscapeRoomTestbed | undefined, error: string | null = null;
let interrupted = false, interruptionAttempted = false, requestedStop = false;
const events: EscapeRoomEvent[] = [], violations = new Set<string>(), lastRevision = new Map<string, number>();
const lastPlanSnapshot = new Map<string, string>();
const onStop = () => { requestedStop = true; room?.stop(); };
process.once("SIGINT", onStop); process.once("SIGTERM", onStop);
const capture = () => {
  if (!room) return;
  const snapshot = room.snapshot();
  sampledElapsedMs = snapshot.elapsedMs;
  for (const violation of room.invariants()) violations.add(violation);
  // The event tape is stored once; sampling never duplicates the growing history.
  stateLog.write(JSON.stringify({ elapsedMs: snapshot.elapsedMs, topology, tick: snapshot.tick, state: snapshot.state,
    actors: snapshot.actors.map(({ id, name, room, activity, untilMs, goalStatus }) => ({ id, name, room, activity, untilMs, goalStatus })),
    milestones: snapshot.milestones, invariantViolations: snapshot.invariantViolations,
    visibility: "operator", readiness: room.characters.map(name => ({ name,
    ...getForegroundCognitionReadiness(room!.sim.world, room!.ids[name], {
      hasPendingStimuli: hasPendingCognitionStimuli(room!.sim.world, room!.ids[name]),
    }) })) }) + "\n");
  for (const name of room.characters) {
    const eid = room.ids[name], revision = getCoordinationRevision(room.sim.world, eid);
    const plans = getRelationTargets(room.sim.world, eid, HasPlan).filter(id => hasComponent(room!.sim.world, id, Plan))
      .sort((a, b) => (Plan.lastUpdated[b] || 0) - (Plan.lastUpdated[a] || 0)).slice(0, 8)
      .map(id => ({ id, goalId: Plan.goalEid[id], status: Plan.status[id], cursor: Plan.currentStep[id],
        createdAt: Plan.createdAt[id], updatedAt: Plan.lastUpdated[id], steps: JSON.parse(Plan.steps[id] || "[]") }));
    const serializedPlans = JSON.stringify(plans);
    if (lastPlanSnapshot.get(name) !== serializedPlans) {
      planLog.write(JSON.stringify({ elapsedMs: snapshot.elapsedMs, actor: name, visibility: "operator", plans }) + "\n");
      lastPlanSnapshot.set(name, serializedPlans);
    }
    if (revision !== (lastRevision.get(name) ?? 0)) {
      memoryLog.write(JSON.stringify({ elapsedMs: snapshot.elapsedMs, actor: name, visibility: "operator",
        ...getCoordinationMemory(room.sim.world, eid) }) + "\n");
      lastRevision.set(name, revision);
    }
  }
};
try {
  room = await EscapeRoomTestbed.create({ live, seed, topology });
  unsubscribePublicEvents = subscribeCommittedEvents(room.sim.world, event => publicEventLog.write(JSON.stringify(event) + "\n"));
  room.onEvent(event => {
    events.push(event); eventLog.write(JSON.stringify(event) + "\n");
    if (["thought", "speech", "milestone", "goal_completed"].includes(event.kind) || event.status === "failed") {
      const name = room!.characters.find(n => room!.ids[n] === event.actorId) ?? "World";
      originals.log(`[${(event.elapsedMs / 1000).toFixed(1)}s] ${name} ${event.kind}: ${event.text}${event.status === "failed" ? " [FAILED]" : ""}`);
    }
  });
  await room.start();
  capture();
  if (live) {
    const began = Date.now(); let nextProgress = 15_000;
    while (room.sim.running && !requestedStop && Date.now() - began < seconds * 1000 && !room.snapshot().escaped) {
      if (!interruptionAttempted && (perturbAt > 0 && Date.now() - began >= perturbAt * 1000
        || isEscapePerturbationStage(perturbAfter) && room.canPerturbAfter(perturbAfter))) {
        // The perturbation must actually change physical state to qualify.
        interruptionAttempted = true;
        interrupted = room.perturb(isEscapePerturbationStage(perturbAfter) ? { after: perturbAfter } : {}).changed;
        if (!interrupted) originals.log("Interruption was a no-op; this run does not establish disruption recovery.");
      }
      capture();
      if (violations.size) throw new Error("Escape-room invariant violation; see state.jsonl");
      if (Date.now() - began >= nextProgress) {
        const s = room.snapshot(); originals.log(`STATE ${Math.round(s.elapsedMs / 1000)}s · ${s.actors.map(a => `${a.name}: ${a.room}`).join(" / ")} · escaped=${s.escaped}`);
        nextProgress += 15_000;
      }
      await sleep(500);
    }
  } else {
    const fixture = runEscapeRoomFixture(room);
    await writeFile(join(directory, "fixture.json"), JSON.stringify(fixture, null, 2), { flag: "wx", mode: 0o600 });
  }
  capture();
  if (requestedStop) error = "Operator stopped the evaluation before its bounded completion";
} catch (e) { error = e instanceof Error ? e.stack ?? e.message : String(e); }
finally {
  room?.stop();
  unsubscribeChronicle();
  unsubscribePublicEvents?.();
  process.removeListener("SIGINT", onStop); process.removeListener("SIGTERM", onStop);
  try {
    if (room) {
      const snapshot = room.snapshot();
      const result = evaluateEscapeRoomRun(events, snapshot, { live, topology, violations: [...violations],
        interruptionRequested: perturbAt > 0 || !!perturbAfter, interruptionApplied: interrupted,
        interruptionStage: isEscapePerturbationStage(perturbAfter) ? perturbAfter : undefined, runtimeError: error });
      const actors = room.characters.map(name => ({ name, goals: room!.sim.getAgentGoals(name),
        memory: room!.sim.getAgentMemories(name), workingMemory: getWorkingMemory(room!.sim.world, room!.ids[name]),
        coordination: getCoordinationMemory(room!.sim.world, room!.ids[name]), dialogue: getSocialDialogue(room!.sim.world, room!.ids[name]),
        exchanges: getSocialExchanges(room!.sim.world, room!.ids[name]) }));
      await writeFile(join(directory, "result.json"), JSON.stringify({ ...result, seed, topology, models: live ? MODEL_IDS : null,
        h3: false, evolution: false, temporal: { timedSpeech: room.sim.world.meta.timedSpeech,
          timedActions: room.sim.world.meta.timedActions, simulationElapsedMs: room.sim.world.time.elapsed }, snapshot, actors }, null, 2), { flag: "wx", mode: 0o600 });
      await writeFile(join(directory, "world.json"), JSON.stringify(serializeWorld(room.sim.world, room.sim.god.systemRegistry), null, 2), { flag: "wx", mode: 0o600 });
      await writeFile(join(directory, "report.md"), formatEscapeRoomEvaluation(result) +
        "\n## Evidence\n\n- events.jsonl: operator-only full thought, perception, speech and executor trace.\n- state.jsonl: physical state and readiness samples.\n- coordination.jsonl: private coordination revisions.\n- plans.jsonl: operator-only changed plan/cursor/evidence-barrier snapshots (500ms sampling, not exact execution timing).\n- chronicle.jsonl: dedicated-process operator diagnostics, including actual stale-decision discards; wall timestamps are exact and sampledElapsedMs is approximate.\n- world.json: ECS data checkpoint, not a resumable process snapshot.\n- result.json: final goals, memory, state and metrics.\n", { flag: "wx", mode: 0o600 });
      originals.log(`RESULT ${JSON.stringify({ directory, seed, topology, live, passed: result.passed, gates: result.gates, byActor: result.byActor, error })}`);
      if (!result.passed) process.exitCode = 1;
    } else {
      await writeFile(join(directory, "failure.json"), JSON.stringify({ seed, topology, live, error }, null, 2), { flag: "wx", mode: 0o600 });
      process.exitCode = 1;
    }
  } finally {
    Object.assign(console, originals);
    await Promise.all([runtimeLog, eventLog, memoryLog, stateLog, planLog, chronicleLog, publicEventLog].map(stream => new Promise<void>(done => stream.end(done))));
    if (lockOwned) {
      const current = JSON.parse(await readFile(lockPath, "utf8"));
      if (current.token === token) await unlink(lockPath);
    }
  }
}
if (error) originals.error(error);
