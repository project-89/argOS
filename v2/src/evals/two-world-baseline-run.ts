/** Opt-in fixed-world runner. No renderer, author or scripted actor decisions. */
import "dotenv/config";
import { appendFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { format } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { getRelationTargets, query, hasComponent } from "bitecs";
import { ApartmentSitcom, type SitcomEvent } from "../demo/apartment-sitcom";
import { EscapeRoomTestbed, type EscapeRoomEvent } from "../demo/escape-room";
import { CoffeeIntervention } from "../demo/coffee-intervention";
import { breakupTrialInputs } from "../demo/sitcom-breakup-evaluation";
import { Agent, Name, Mind, Perception, Plan, WikiDoc, WorkDocument } from "../ecs/components";
import { HasPlan } from "../ecs/relations";
import { getRoomForEntity } from "../ecs/location";
import { getAgentPerceptions } from "../cognition/agent-mind";
import { getWorkingMemory } from "../cognition/working-memory";
import { getSocialDialogue } from "../cognition/social-memory";
import { getNarrativeHistory } from "../cognition/narrative-memory";
import { snapshotActorContinuation } from "../cognition/actor-continuation";
import { snapshotExperienceAppraisal } from "../cognition/experience-appraisal";
import { snapshotAffect } from "../cognition/affect-state";
import { chronicle } from "../cognition/simulation-chronicle";
import { subscribeCommittedEvents } from "../runtime/committed-events";
import { getExternalParticipants } from "../runtime/participant-identities";
import { serializeWorld } from "../persistence/world-persistence";
import { MODEL_IDS } from "../llm/config";
import { BASELINE_CONFIG, BASELINE_TRIALS } from "./two-world-baseline-protocol";
import { evaluateForegroundAttempts, type ForegroundTimingEntry } from "./foreground-attempt-evaluation";
import { evaluateEscapeRoomRun } from "./escape-room-evaluation";
import { BaselineEvidenceJournal, drainBaselineWork, finalizeBaselineObservation, recentBaselineThoughts } from "./baseline-evidence-journal";

const id = process.argv.find(a => a.startsWith("--trial="))?.slice(8);
const trial = BASELINE_TRIALS.find(t => t.id === id);
if (!trial || !process.argv.includes("--live") || !process.env.ARGOS_BASELINE_DIRECTORY)
  throw new Error("Use the bounded two-world-baseline-guard.cjs launcher with --live and a declared trial ID");
if (Object.values(MODEL_IDS).some(model => model !== BASELINE_CONFIG.model)) throw new Error("Model configuration differs from declared baseline");
if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) throw new Error("Missing configured Google key");
const directory = resolve(process.env.ARGOS_BASELINE_DIRECTORY), began = performance.now();
const save = (file: string, value: unknown) => writeFileSync(join(directory, file), JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 });
const journal = new BaselineEvidenceJournal(directory);
const append = (file: string, value: unknown) => journal.append(file, value);
let runtimeBytes = 0, logOverflow = false;
const log = console.log.bind(console);
for (const kind of ["log", "warn", "error"] as const) console[kind] = (...args: unknown[]) => {
  const line = format(...args) + "\n"; runtimeBytes += Buffer.byteLength(line);
  if (runtimeBytes <= 4 * 1024 * 1024) appendFileSync(join(directory, "runtime.log"), line, { mode: 0o600 });
  else logOverflow = true;
};
let bed: ApartmentSitcom | EscapeRoomTestbed | undefined;
let stopReason: string | null = null, failure: string | null = null, observationFailure: string | null = null;
let runtimeStart = 0, runtimeEnd = 0, runtimeBeforeStop: unknown;
const timing: ForegroundTimingEntry[] = [], events: Array<SitcomEvent | EscapeRoomEvent> = [];
const disposers: Array<() => void> = [], violations = new Set<string>();
let perturbationApplied = false;
const stop = (reason: string) => { stopReason ??= reason; bed?.stop(); };
process.once("SIGINT", () => stop("operator_or_bound")); process.once("SIGTERM", () => stop("outer_bound"));
const observe = (fn: () => void) => { try { fn(); } catch (error) { observationFailure ??= error instanceof Error ? error.message : "observer_failed"; } };
save("configuration.json", { trial, config: BASELINE_CONFIG, models: MODEL_IDS, pid: process.pid });
save("journal-format.json", { version: 2, frames: "frames.jsonl.gz", encoding: "gzip members of UTF-8 JSON lines",
  lossless: true, limits: journal.snapshot().limits,
  note: "gunzip the concatenated members to recover the original complete frames; other journals remain plain JSONL. No sampled fields or actor memories are omitted." });
try {
  bed = trial.world === "social"
    ? await ApartmentSitcom.create({ live: true, scenario: "duet", outsideTextAtMs: null, worldMaintenance: false,
      cognitionController: "priority", narrativeMind: true, experienceReconsideration: true })
    : await EscapeRoomTestbed.create({ live: true, seed: trial.seed, topology: "relay", narrativeMind: true, experienceReconsideration: true });
  const sim = bed.sim, world = sim.world;
  const social = bed instanceof ApartmentSitcom ? bed : undefined;
  const puzzle = bed instanceof EscapeRoomTestbed ? bed : undefined;
  const input = trial.world === "social" ? breakupTrialInputs(trial.condition, "boyfriend") : undefined;
  if (social && input) social.setPhoneContact({ ...input.contact, name: "Alex", context: input.contact.context.replaceAll("David", "Alex") });
  const stimuli = input?.stimuli.map(row => ({ ...row, text: row.text.replaceAll("David", "Alex") })) ?? [];
  save("inputs.json", stimuli);
  const coffee = trial.world === "social" && trial.drainFirstPour ? new CoffeeIntervention() : undefined;
  save("initial-world.json", serializeWorld(world, sim.god.systemRegistry));
  const onEvent = (event: SitcomEvent | EscapeRoomEvent) => observe(() => {
    if (events.length >= 20000) throw new Error("Native event bound exceeded");
    events.push(event); append("events.jsonl", event);
  });
  disposers.push(social ? social.onEvent(onEvent) : puzzle!.onEvent(onEvent));
  disposers.push(subscribeCommittedEvents(world, event => observe(() => append("public-events.jsonl", event))));
  disposers.push(chronicle.subscribe(event => observe(() => {
    const observedWallMs = performance.now() - began;
    const row = { ...event, atSimMs: bed!.elapsedMs, observedWallMs };
    append("chronicle.jsonl", row);
    if (["foreground_attempt_started", "foreground_attempt_finished", "foreground_provider_result"].includes(event.type)) timing.push(row);
  })));
  const capture = () => {
    const actors = [...query(world, [Agent, Name])].filter(eid => Agent.active[eid]).map(eid => ({
      eid, name: Name.value[eid], room: Name.value[getRoomForEntity(world, eid)!],
      mind: { mode: Mind.mode[eid], arousal: Mind.arousal[eid], focus: Mind.focus[eid] },
      goals: sim.getAgentGoals(Name.value[eid]), thoughts: recentBaselineThoughts(sim.getAgentThoughts(Name.value[eid])),
      plans: getRelationTargets(world, eid, HasPlan).filter(p => hasComponent(world, p, Plan)).map(p => ({
        id: p, goalId: Plan.goalEid[p], status: Plan.status[p], step: Plan.currentStep[p], stepsJson: Plan.steps[p] })),
      perceptions: getAgentPerceptions(world, eid).map(p => ({ id: p, type: Perception.type[p], source: Perception.source[p], content: Perception.content[p], timestamp: Perception.timestamp[p] })),
      memory: getWorkingMemory(world, eid), dialogue: getSocialDialogue(world, eid),
      narrative: getNarrativeHistory(world, eid, { limit: 12 }), continuation: snapshotActorContinuation(world, eid),
      appraisal: snapshotExperienceAppraisal(world, eid), affect: snapshotAffect(world, eid),
    }));
    const records = [...query(world, [WikiDoc, WorkDocument])].map(eid => ({ eid, name: Name.value[eid], room: Name.value[getRoomForEntity(world, eid)!],
      body: WikiDoc.body[eid], status: WikiDoc.status[eid], revision: WorkDocument.revision[eid], writer: WorkDocument.lastWriterKey[eid], reviewedRevision: WorkDocument.reviewedRevision[eid] }));
    const { events: _events, ...state } = social ? social.snapshot({ eventLimit: 0 }) : puzzle!.snapshot();
    append("frames.jsonl.gz", { atSimMs: bed!.elapsedMs, observedWallMs: performance.now() - began, actors, records, state,
      externalParticipants: getExternalParticipants(world), runtime: sim.getRuntimeStatus(), systemHealth: sim.getSystemHealth() });
  };
  runtimeStart = performance.now();
  if (stopReason) throw new Error("Stopped during startup");
  await bed.start();
  let nextStimulus = 0, nextFrameAt = 0, nextProgress = 0;
  while (!stopReason && bed.elapsedMs < trial.seconds * 1000 && performance.now() - runtimeStart < (trial.seconds + 20) * 1000) {
    if (!sim.running) throw new Error("Runtime stopped before declared duration");
    if (observationFailure || logOverflow) throw new Error(observationFailure ?? "Runtime log bound exceeded");
    while (social && stimuli[nextStimulus] && bed.elapsedMs >= stimuli[nextStimulus].atSimMs) {
      const stimulus = stimuli[nextStimulus++];
      const messageId = social.text(stimulus.text, "baseline declared stimulus");
      append("issued-inputs.jsonl", { ...stimulus, actualAtSimMs: bed.elapsedMs, messageId });
    }
    if (social && coffee) coffee.poll(social);
    if (puzzle) {
      for (const violation of puzzle.invariants()) violations.add(violation);
      if (trial.world === "puzzle" && trial.perturbAfter && !perturbationApplied)
        perturbationApplied = puzzle.perturb({ after: trial.perturbAfter }).changed;
    }
    if (violations.size) throw new Error("Physical invariant violation");
    if (bed.elapsedMs >= nextFrameAt) { capture(); nextFrameAt = bed.elapsedMs + 1000; }
    if (bed.elapsedMs >= nextProgress) { log("BASELINE_PROGRESS", JSON.stringify({ id, simMs: bed.elapsedMs,
      runtimeWallMs: Math.round(performance.now() - runtimeStart), events: events.length })); nextProgress = bed.elapsedMs + 15000; }
    await sleep(100);
  }
  runtimeEnd = performance.now(); runtimeBeforeStop = sim.getRuntimeStatus(); capture();
  if (!stopReason && bed.elapsedMs < trial.seconds * 1000) stopReason = "runtime_wall_bound";
  save("world.json", serializeWorld(world, sim.god.systemRegistry));
  save("state.json", social ? social.snapshot() : puzzle!.snapshot());
  save("intervention.json", coffee?.snapshot() ?? { requested: trial.world === "puzzle" ? trial.perturbAfter ?? null : null, applied: perturbationApplied });
  if (puzzle) save("puzzle-evaluation.json", evaluateEscapeRoomRun(events as EscapeRoomEvent[], puzzle.snapshot(), {
    live: true, topology: "relay", violations: [...violations], interruptionRequested: trial.world === "puzzle" && !!trial.perturbAfter,
    interruptionApplied: perturbationApplied, interruptionStage: trial.world === "puzzle" ? trial.perturbAfter : undefined,
    runtimeError: stopReason }));
} catch (error) { failure = error instanceof Error ? error.message : "runner_failure"; }
finally {
  runtimeEnd ||= performance.now();
  observe(() => { runtimeBeforeStop ??= bed?.sim.getRuntimeStatus(); });
  // Preserve an explicitly incomplete checkpoint before entering cancellation.
  // This cannot substitute for a settled final report or turn a killed run green.
  const cleanupFailures = await finalizeBaselineObservation({
    checkpoint: () => save("pre-shutdown.json", { stage: "before_stop", stopReason, failure, observationFailure,
      elapsedSimMs: bed?.elapsedMs, runtimeBeforeStop,
      foreground: evaluateForegroundAttempts(timing, performance.now() - began) }),
    lifecycle: stage => append("lifecycle.jsonl", { stage, observedWallMs: performance.now() - began }),
    stop: () => bed?.stop(),
    drain: async () => {
      // Keep observers installed while aborted requests settle; unfinished IDs
      // remain censored after this bounded cleanup, never erased by shutdown.
      const drain = (globalThis as typeof globalThis & { __argosBaselineDrain?: () => Promise<unknown> }).__argosBaselineDrain;
      await drainBaselineWork(() => bed?.sim.drainPendingOperations(2000) ?? Promise.resolve(), drain);
    },
    disposers,
  });
  if (cleanupFailures.length) failure ??= `Cleanup failed: ${cleanupFailures.map(row => row.stage).join(", ")}`;
  const latency = evaluateForegroundAttempts(timing, performance.now() - began);
  observe(() => save("foreground.json", latency));
  observe(() => save("result.json", { trial, stopReason, failure, observationFailure, logOverflow, models: MODEL_IDS,
    runtimeWallMs: runtimeStart ? Math.round(runtimeEnd - runtimeStart) : null, outerWallMs: Math.round(performance.now() - began),
    elapsedSimMs: bed?.elapsedMs, runtimeBeforeStop, systemHealth: bed?.sim.getSystemHealth(), violations: [...violations],
    eventCount: events.length, journal: journal.snapshot(), cleanupFailures,
    latency: { complete: latency.complete, count: latency.count, p95WallMs: latency.p95WallMs, byActor: latency.byActor },
    behavioralVerdict: "UNREVIEWED", criticalIntegrityVerdict: "UNREVIEWED", note: "No automatic behavioral pass; audit native causal evidence and full prompts." }));
  log("BASELINE_FINISHED", JSON.stringify({ id, directory, stopReason, failure, p95WallMs: latency.p95WallMs }));
  if (stopReason || failure || observationFailure || logOverflow) process.exitCode = 1;
}
