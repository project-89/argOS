/** Local, bounded testbed. --live opts into Gemini; never starts FAL/H3. */
import "dotenv/config";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { format } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { createInterface } from "node:readline";
import { GenerativeAgentsTestbed, type TestbedCharacter, type TestbedEvent } from "./demo/generative-agents";
import { serializeWorld } from "./persistence/world-persistence";
import { getCodingDaemon } from "./engineering/coding-daemon";
import { MODEL_IDS } from "./llm/config";
import { getSocialDialogue, getSocialExchanges, getSocialClosures } from "./cognition/social-memory";
import { getWorkingMemory } from "./cognition/working-memory";
import { getCoordinationMemory, getCoordinationRevision } from "./cognition/coordination-memory";
import { getForegroundCognitionReadiness } from "./cognition/idle-cognition";
import { getAgentWorldCapabilities } from "./cognition/world-capabilities";
import { hasPendingCognitionStimuli } from "./cognition/cognition-system";
import { evaluateGenerativeAgentsRun, formatGenerativeAgentsEvaluation, STORM_HOUSE_MILESTONES } from "./evals/generative-agents-evaluation";

const live = process.argv.includes("--live"), evolve = process.argv.includes("--evolve");
const challenge = process.argv.includes("--challenge");
const seconds = Number(process.argv.find(arg => arg.startsWith("--seconds="))?.split("=")[1] ?? 120);
const perturbAt = Number(process.argv.find(arg => arg.startsWith("--perturb-at="))?.split("=")[1] ?? 0);
if (!Number.isFinite(seconds) || seconds < 10 || seconds > 600) throw new Error("Choose --seconds=10..600");
if (!Number.isFinite(perturbAt) || perturbAt < 0 || perturbAt >= seconds || perturbAt > 0 && !live) throw new Error("--perturb-at must be within a live run, or omitted");
if (evolve && !live) throw new Error("--evolve requires --live");
if (live && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is required for --live");
await mkdir(resolve("recordings"), { recursive: true });
const directory = await mkdtemp(resolve("recordings", "generative-agents-"));
const originals = { log: console.log, warn: console.warn, error: console.error };
const log = createWriteStream(join(directory, "runtime.log"), { flags: "wx", mode: 0o600 });
const eventLog = createWriteStream(join(directory, "events.jsonl"), { flags: "wx", mode: 0o600 });
const promptLog = createWriteStream(join(directory, "scenes.jsonl"), { flags: "wx", mode: 0o600 });
const coordinationLog = createWriteStream(join(directory, "coordination.jsonl"), { flags: "wx", mode: 0o600 });
const coordinationRevisions = new Map<string, number>();
let logBytes = 0;
for (const method of ["log", "warn", "error"] as const) console[method] = (...args: unknown[]) => {
  const line = format(...args) + "\n"; if (logBytes < 5_000_000) { log.write(line); logBytes += Buffer.byteLength(line); }
};
originals.log(`${live ? "LIVE COGNITION" : "SCRIPTED PHYSICS FIXTURE"} · Storm House · H3 disabled\nArtifacts: ${directory}`);
let testbed: GenerativeAgentsTestbed | undefined, error: string | null = null, lastVersion = 0;
const events: TestbedEvent[] = [];
const readiness: Array<Record<string, unknown>> = [];
let perturbed = false;
let terminal: ReturnType<typeof createInterface> | undefined;
const saveShots = () => {
  for (const shot of testbed!.director.snapshot().shots) if (shot.version > lastVersion) {
    promptLog.write(JSON.stringify({ ...shot, rendered: false }) + "\n"); lastVersion = shot.version;
  }
};
try {
  testbed = await GenerativeAgentsTestbed.create({ live, evolve, challenge });
  testbed.onEvent(event => {
    events.push(event); eventLog.write(JSON.stringify(event) + "\n");
    const actor = testbed!.characters.find(name => testbed!.ids[name] === event.actorId) ?? "World";
    if (["thought", "speech", "goal_completed"].includes(event.kind) || event.status === "failed")
      originals.log(`[${(event.elapsedMs / 1000).toFixed(1)}s] ${actor} ${event.kind === "thought" ? "thinks" : event.kind}: ${event.text}${event.status === "failed" ? " [FAILED]" : ""}`);
  });
  await testbed.start();
  saveShots();
  if (live) {
    if (process.stdin.isTTY) {
      terminal = createInterface({ input: process.stdin, output: process.stdout });
      originals.log("Commands: /thought Mara | a subtle thought; /move Spare fuse | Common Room; /state; /stop");
      terminal.on("line", line => {
        try {
          if (line === "/stop") { testbed!.stop(); return; }
          if (line === "/state") { originals.log(testbed!.snapshot().actors.map(a => `${a.name}: ${a.room}; ${a.goalStatus}`).join("\n")); return; }
          const match = /^\/(thought|move)\s+([^|]+)\|\s*(.+)$/.exec(line);
          if (!match) throw new Error("Use /thought Mara | text, /move Spare fuse | Common Room, /state or /stop");
          if (match[1] === "thought") {
            const character = match[2].trim();
            if (!testbed!.characters.includes(character as TestbedCharacter)) throw new Error("Choose Mara, Ivo or Sera");
            testbed!.plantThought(character as TestbedCharacter, match[3]);
          } else testbed!.relocateObject(match[2].trim(), match[3].trim());
        } catch (e) { originals.error(String(e)); }
      });
    }
    const began = Date.now(); let nextProgress = 15_000;
    while (testbed.sim.running && Date.now() - began < seconds * 1000) {
      saveShots();
      for (const name of testbed.characters) {
        const world = testbed.sim.world, eid = testbed.ids[name];
        const coordinationRevision = getCoordinationRevision(world, eid);
        if (coordinationRevision !== (coordinationRevisions.get(name) ?? 0)) {
          const coordination = getCoordinationMemory(world, eid);
          coordinationLog.write(JSON.stringify({ elapsedMs: testbed.snapshot().elapsedMs, actor: name, visibility: "operator", ...coordination }) + "\n");
          coordinationRevisions.set(name, coordination.revision);
        }
        readiness.push({ elapsedMs: Date.now() - began, actor: name, physicallyReady: getAgentWorldCapabilities(world, eid)?.ready(),
          coordinationRevision,
          workingMemoryRevision: getWorkingMemory(world, eid).revision,
          lastKnownFuse: getWorkingMemory(world, eid).facts.find(fact => fact.subjectLabel === "Spare fuse" && fact.predicate === "location"),
          ...getForegroundCognitionReadiness(world, eid, { hasPendingStimuli: hasPendingCognitionStimuli(world, eid) }) });
      }
      if (perturbAt && !perturbed && Date.now() - began >= perturbAt * 1000) {
        // Explicit, recorded operator intervention, not evidence of autonomous world evolution.
        testbed.relocateObject("Spare fuse", "Common Room"); perturbed = true;
        originals.log("PERTURBATION: the real Spare fuse was moved into the Common Room; no thought or command was injected.");
      }
      if (Date.now() - began >= nextProgress) {
        const s = testbed.snapshot(); originals.log(`STATE ${Math.round(s.elapsedMs / 1000)}s · lamp ${s.lamp} · ${s.actors.map(a => `${a.name}: ${a.room}`).join(" / ")}`); nextProgress += 15_000;
      }
      await sleep(500);
    }
  } else if (challenge) {
    // Explicit fixture, not autonomous behavior; the model never receives this recipe.
    const travel = (who: TestbedCharacter, target: string) => { testbed!.dispatch(who, { type: "move", target }); testbed!.advance(3000); saveShots(); };
    const interact = (who: TestbedCharacter, target: string, content: string) => testbed!.dispatch(who, { type: "interact", target, content });
    travel("Ivo", "Utility Room"); travel("Ivo", "Store Room");
    interact("Ivo", "Supply cupboard", "unlock"); testbed.dispatch("Ivo", { type: "pickup", target: "Spare fuse" });
    interact("Ivo", "Leak valve", "close"); travel("Ivo", "Utility Room"); travel("Mara", "Utility Room");
    testbed.dispatch("Ivo", { type: "give", target: "Mara", content: "Spare fuse" });
    travel("Sera", "Utility Room"); travel("Sera", "Store Room"); testbed.dispatch("Sera", { type: "pickup", target: "Cleaning cloth" });
    travel("Sera", "Utility Room"); interact("Sera", "Wet floor", "dry"); testbed.advance(5000);
    interact("Ivo", "Access panel", "hold"); interact("Mara", "Lighting relay", "repair"); testbed.advance(6000);
    interact("Sera", "Isolation switch", "switch_on"); testbed.advance(1000); saveShots();
  } else {
    // Explicit scripted intentions exercise the SAME action executor and physics.
    // These lines demonstrate mechanics, not emergent social behavior.
    testbed.dispatch("Sera", { type: "speak", target: "Mara", content: "I put the spare fuse in the supply cupboard. Ivo has the key." });
    testbed.dispatch("Ivo", { type: "give", target: "Mara", content: "Brass key" });
    testbed.advance(1000);
    testbed.dispatch("Mara", { type: "move", target: "Utility Room" }); testbed.advance(3000); saveShots();
    for (const action of [
      { type: "interact", target: "Supply cupboard", content: "unlock" },
      { type: "pickup", target: "Spare fuse" },
      { type: "interact", target: "Isolation switch", content: "switch_off" },
      { type: "interact", target: "Lighting relay", content: "repair" },
      { type: "interact", target: "Isolation switch", content: "switch_on" },
    ] as const) { testbed.dispatch("Mara", action); testbed.advance(1000); saveShots(); }
  }
  testbed.stop(); saveShots();
  await writeFile(join(directory, "readiness.json"), JSON.stringify({ perturbAt, perturbed, samples: readiness }, null, 2));
  const snapshot = testbed.snapshot();
  const byActor = testbed.characters.map(name => {
    const id = testbed!.ids[name], own = events.filter(e => e.actorId === id);
    const latencies = own.filter(e => e.kind === "decision_latency").map(e => Number(e.text)).sort((a, b) => a - b);
    return { name, thoughts: own.filter(e => e.kind === "thought").length, speech: own.filter(e => e.kind === "speech" && e.status === "succeeded").length,
      successes: own.filter(e => e.status === "succeeded").length, failures: own.filter(e => e.status === "failed").length,
      decisionP95Ms: latencies.length ? latencies[Math.ceil(latencies.length * .95) - 1] : null,
      goals: testbed!.sim.getAgentGoals(name), memories: testbed!.sim.getAgentMemories(name),
      workingMemory: getWorkingMemory(testbed!.sim.world, id),
      coordination: getCoordinationMemory(testbed!.sim.world, id),
      socialClosures: getSocialClosures(testbed!.sim.world, id),
      dialogue: getSocialDialogue(testbed!.sim.world, id), exchanges: getSocialExchanges(testbed!.sim.world, id) };
  });
  const gates = { everyActorThinks: byActor.every(a => a.thoughts > 0), everyActorSpeaks: byActor.every(a => a.speech > 0),
    actualItemHandoff: events.some(e => e.action?.type === "give" && e.status === "succeeded"),
    actualRepair: snapshot.circuit.repaired, lightPhysicallyOn: snapshot.circuit.lit,
    cameraCoversMultipleRooms: new Set(snapshot.camera.shots.map(s => s.scene.room.id)).size > 1,
    rendererNeverIssued: snapshot.camera.issued === 0 };
  const evaluation = evaluateGenerativeAgentsRun(events, snapshot.elapsedMs, {
    actorNames: Object.fromEntries(testbed.characters.map(name => [testbed!.ids[name], name])),
    milestoneRules: [...STORM_HOUSE_MILESTONES, ...(challenge ? [
      { id: "leak_stopped", label: "Leak valve closed", actionType: "interact", target: "Leak valve", verb: "close" },
      { id: "floor_dried", label: "Floor drying completed", actionType: "interact", target: "Wet floor", verb: "dry" },
      { id: "helper_holding", label: "Distinct helper holding panel", actionType: "interact", target: "Access panel", verb: "hold" },
    ] : [])],
  });
  const result = { provenance: { cognition: live ? "live shared Argos" : "scripted physical fixture", models: live ? MODEL_IDS : null, evolution: evolve, challenge, h3: false, genesis: false }, gates, actors: byActor, snapshot, evaluation };
  await writeFile(join(directory, "evaluation.json"), JSON.stringify(evaluation, null, 2), { flag: "wx", mode: 0o600 });
  await writeFile(join(directory, "result.json"), JSON.stringify(result, null, 2), { flag: "wx", mode: 0o600 });
  await writeFile(join(directory, "world.json"), JSON.stringify(serializeWorld(testbed.sim.world, testbed.sim.god.systemRegistry), null, 2), { flag: "wx", mode: 0o600 });
  const report = `# Storm House testbed\n\n${live ? "Live, autonomous Argos cognition" : "Scripted physical fixture — not autonomous evidence"}. No H3/video session. World expansion ${evolve ? "enabled" : "disabled for the social baseline"}.\n\nLamp: **${snapshot.lamp}** after ${(snapshot.elapsedMs / 1000).toFixed(1)} simulated seconds.\n\n| Character | Thoughts | Spoken turns | Successful actions | Failed actions | Decision p95 |\n|---|---:|---:|---:|---:|---:|\n${byActor.map(a => `| ${a.name} | ${a.thoughts} | ${a.speech} | ${a.successes} | ${a.failures} | ${a.decisionP95Ms === null ? "n/a" : a.decisionP95Ms + " ms"} |`).join("\n")}\n\n## Observed gates\n\n${Object.entries(gates).map(([k, v]) => `- ${k}: ${v ? "observed" : "not observed"}`).join("\n")}\n\n## Public conversation\n\n${events.filter(e => e.kind === "speech" && e.status === "succeeded").map(e => `- ${(e.elapsedMs / 1000).toFixed(1)}s **${testbed!.characters.find(n => testbed!.ids[n] === e.actorId)}**: ${e.text.replace(/\n/g, " ")}`).join("\n")}\n\n## Artifacts\n\n- events.jsonl: operator-only thoughts, perceptions, speech and physical receipts.\n- scenes.jsonl: public, room-local immutable camera prompts; rendered=false.\n- result.json: per-actor evidence, goals, memories, state and runtime timings.\n- world.json: ECS checkpoint, not a resumable testbed runtime/session.\n\nA passing fixture proves mechanics only. One live run does not establish long-horizon social quality. Camera configure/transport acknowledgement is not proof of video fidelity or synchronization.\n`;
  await writeFile(join(directory, "report.md"), report + `\n\n${formatGenerativeAgentsEvaluation(evaluation)}\n`, { flag: "wx", mode: 0o600 });
  originals.log(`RESULT ${JSON.stringify({ directory, live, challenge, gates, actors: byActor.map(({ goals, memories, dialogue, exchanges, workingMemory, socialClosures, coordination, ...a }) => a) })}`);
} catch (e) {
  error = e instanceof Error ? e.stack ?? e.message : String(e);
  await writeFile(join(directory, "failure.json"), JSON.stringify({ error, events }, null, 2), { flag: "wx", mode: 0o600 });
} finally {
  terminal?.close(); testbed?.stop();
  if (testbed) { await getCodingDaemon(testbed.sim.world)?.settle(); await getCodingDaemon(testbed.sim.world)?.flush(); }
  Object.assign(console, originals);
  await Promise.all([log, eventLog, promptLog, coordinationLog].map(stream => new Promise<void>(done => stream.end(done))));
}
if (error) { console.error(error); process.exitCode = 1; }
