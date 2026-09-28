/** Opt-in bounded production cognition, no H3 or prescribed action sequence. */
import "dotenv/config";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { format } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { createDocumentWorkTestbed, INSPECTION_NOTES } from "./document-work-testbed";
import { Goal, WikiDoc, WorkDocument } from "../ecs/components";
import { readSimulationTime } from "../ecs/simulation-time";
import { getCommittedEvents, startCommittedEvents, subscribeCommittedEvents } from "../runtime/committed-events";
import { chronicle } from "../cognition/simulation-chronicle";
import { serializeWorld } from "../persistence/world-persistence";
import { MODEL_IDS } from "../llm/config";

const live = process.argv.includes("--live");
const seconds = Number(process.argv.find(a => a.startsWith("--seconds="))?.slice(10) ?? 90);
if (!Number.isInteger(seconds) || seconds < 30 || seconds > 180) throw new Error("Choose --seconds=30..180");
if (live && !process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY required for --live");
await mkdir(resolve("recordings"), { recursive: true });
const directory = await mkdtemp(resolve("recordings", "document-work-"));
const original = { log: console.log, warn: console.warn, error: console.error };
const runtime = createWriteStream(join(directory, "runtime.log"), { flags: "wx", mode: 0o600 });
let logged = 0;
for (const key of ["log", "warn", "error"] as const) console[key] = (...args: unknown[]) => {
  const line = format(...args) + "\n"; if (logged < 12_000_000) { runtime.write(line); logged += Buffer.byteLength(line); }
};
original.log(`DOCUMENT_WORK ${live ? "LIVE" : "OFFLINE"} · NO H3 · ${directory}`);
let fixture: Awaited<ReturnType<typeof createDocumentWorkTestbed>> | undefined, failed: string | null = null;
const frames: unknown[] = [], events: unknown[] = [], disposals: Array<() => void> = [];
const stop = () => fixture?.sim.stop(); process.once("SIGINT", stop); process.once("SIGTERM", stop);
try {
  const paths = ["src/index.ts", "src/demo/document-work-testbed.ts", "src/demo/document-work-check.ts", "src/world/productive-work.ts",
    "src/world/schema.ts", "src/cognition/agent-mind.ts", "src/cognition/cognition-system.ts", "src/cognition/planning-system.ts",
    "src/cognition/goal-lifecycle.ts", "src/cognition/goal-contract.ts", "src/cognition/actor-continuation.ts", "src/ecs/components.ts",
    "src/cognition/action-registry.ts", "src/systems/scheduled-activity-systems.ts", "src/systems/goal-evaluation-system.ts",
    "src/cognition/bt-compiler.ts", "src/cognition/procedural-skills.ts", "src/world/affordance-availability.ts", "src/cognition/physical-activity.ts",
    "src/cognition/skill-registry.ts", "src/cognition/goal-learning.ts", "src/world/effect-executor.ts", "src/cognition/goal-attempt.ts"];
  const fingerprints = Object.fromEntries(await Promise.all(paths.map(async path => [path, createHash("sha256").update(await readFile(path)).digest("hex")])));
  await writeFile(join(directory, "configuration.json"), JSON.stringify({ live, seconds, h3: false, models: MODEL_IDS, fingerprints,
    initialTask: "Finalize Field report", initialSourceArtifact: INSPECTION_NOTES,
    experiment: "Initial owned task and source artifact only. No action script, runtime nudges, forced thought or completion. Authored task competence, not spontaneous goal adoption." }, null, 2), { flag: "wx", mode: 0o600 });
  fixture = await createDocumentWorkTestbed(live);
  const { sim, actor, report, goal } = fixture;
  startCommittedEvents(sim.world);
  disposals.push(subscribeCommittedEvents(sim.world, event => { if (events.length < 8000) events.push(event); }));
  disposals.push(chronicle.subscribe(event => { if (events.length < 8000) events.push({ ...event, atSimMs: readSimulationTime(sim.world), channel: "chronicle" }); }));
  const began = performance.now();
  if (live) await sim.start();
  while ((!live || sim.running) && readSimulationTime(sim.world) < seconds * 1000 && performance.now() - began < seconds * 1000 + 2000) {
    frames.push({ atSimMs: readSimulationTime(sim.world), goals: sim.getAgentGoals("Wren"), thoughts: sim.getAgentThoughts("Wren").slice(-4),
      document: { body: WikiDoc.body[report], revision: WorkDocument.revision[report], status: WikiDoc.status[report] } });
    if (live) await sleep(500); else await sim.step(500);
  }
  const result = { atSimMs: readSimulationTime(sim.world), wallSeconds: (performance.now() - began) / 1000, actor,
    document: { body: WikiDoc.body[report], revision: WorkDocument.revision[report], reviewedRevision: WorkDocument.reviewedRevision[report], status: WikiDoc.status[report], completedAtSimMs: WorkDocument.completedAtSimMs[report] },
    goalStatus: Goal.status[goal], runtime: sim.getRuntimeStatus(), systemHealth: sim.getSystemHealth(),
    interpretation: "Inspect actual action receipts and report/source fidelity. A finished document is not automatically accurate; missing autonomous work is not a pass." };
  sim.stop();
  await Promise.all([writeFile(join(directory, "result.json"), JSON.stringify(result, null, 2)),
    writeFile(join(directory, "frames.json"), JSON.stringify(frames)), writeFile(join(directory, "events.json"), JSON.stringify(events)),
    writeFile(join(directory, "world.json"), JSON.stringify(serializeWorld(sim.world, sim.god.systemRegistry)))]);
  original.log(`DOCUMENT_RESULT ${JSON.stringify({ directory, ...result.document, goalStatus: result.goalStatus, atSimMs: result.atSimMs })}`);
} catch (error) { failed = String(error); original.error(failed); process.exitCode = 1; }
finally {
  fixture?.sim.stop(); disposals.forEach(dispose => dispose()); process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
  await writeFile(join(directory, "termination.json"), JSON.stringify({ failed }));
  for (const key of ["log", "warn", "error"] as const) console[key] = original[key];
  await new Promise<void>(resolve => runtime.end(resolve));
}
