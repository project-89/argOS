/** Explicit opt-in, real Gemini cognition + engineering, production dual-loop.
 * No FAL calls. This authors one pressure scenario; it does not prove genesis. */
import "dotenv/config";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { format } from "node:util";
import { resolve, join } from "node:path";
import { addEntity, addComponent } from "bitecs";
import { PhoneDemo, type PhoneReceipt } from "../demo/phone-demo";
import { getAgentWorldCapabilities } from "../cognition/world-capabilities";
import { Name, ObjectState } from "../ecs/components";
import { getComponent } from "../ecs/component-registry";
import { getCodingDaemon } from "../engineering/coding-daemon";
import { MODEL_IDS } from "../llm/config";
import { evaluateLivingWorld, type WorldSoakEvidence } from "./living-world-evaluation";

if (!process.argv.includes("--live")) throw new Error("Opt in to Gemini spend with --live (no video is generated).");
if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY required");
const seconds = Number(process.env.ARGOS_WORLD_SOAK_SECONDS ?? 240);
if (!Number.isFinite(seconds) || seconds < 180 || seconds > 600) throw new Error("Soak duration must be 180–600 seconds.");
await mkdir(resolve("recordings"), { recursive: true });
const directory = await mkdtemp(resolve("recordings", "world-soak-"));
const originals = { log: console.log, warn: console.warn, error: console.error };
const log = createWriteStream(join(directory, "runtime.log"), { flags: "wx", mode: 0o600 });
let logBytes = 0;
for (const method of ["log", "warn", "error"] as const) console[method] = (...args: unknown[]) => {
  const line = format(...args) + "\n";
  if (logBytes < 5_000_000) { log.write(line); logBytes += Buffer.byteLength(line); }
};
originals.log(`LIVING_WORLD_SOAK ${JSON.stringify({ directory, seconds, models: MODEL_IDS, renderer: "disabled", cognition: "live", build: "operator-requested Gemini" })}`);
let demo: PhoneDemo | undefined;
let failure: string | null = null;
const history: PhoneReceipt[] = [], samples: WorldSoakEvidence["samples"] = [];
const interventions: WorldSoakEvidence["interventions"] = [];
const privacyViolations = new Set<string>();
let memoryQuestionId: number | null = null, offlineMessageId: number | null = null;
let evaluation: ReturnType<typeof evaluateLivingWorld> | undefined;
let jobId: string | undefined;
try {
  demo = await PhoneDemo.createLivingWorld({ codingDaemons: { backend: "gemini", directory: join(directory, "engineering"), timeoutMs: 120_000, pollMs: 100 } });
  const probe = addEntity(demo.sim.world);
  addComponent(demo.sim.world, probe, Name); Name.value[probe] = "Evaluation clock";
  addComponent(demo.sim.world, probe, ObjectState); ObjectState.current[probe] = "soak_probe";
  demo.start();
  await demo.prepareOpening();
  jobId = demo.sim.requestSystemBuild({ source: "soak-operator",
    instruction: "Implement SoakClockSystem. For entities with ObjectState.current exactly soak_probe, attach SoakClock with numeric seconds default 0 if absent, then increase seconds by ctx.deltaMs/1000. Other ObjectState values must be entirely untouched. Reuse ObjectState, do not redefine it. This instrument measures simulation time and must not touch NPCs, private cognition, messages or locations. Include positive, attachment and non-probe tests.",
    acceptance: [
      { name: "clock advances in simulation seconds", system: "SoakClockSystem", entities: [{ id: 1, components: { ObjectState: { current: "soak_probe" } } }], ticks: 3, deltaMs: 500, expect: [{ entity: 1, component: "SoakClock", field: "seconds", equals: 1.5 }] },
      { name: "other entities untouched", system: "SoakClockSystem", entities: [{ id: 2, components: { ObjectState: { current: "protected" }, SoakClock: { seconds: 42 } } }], ticks: 3, deltaMs: 400, expect: [{ entity: 2, component: "SoakClock", field: "seconds", equals: 42 }] },
    ],
  }).id;
  await demo.sim.start();
  const began = Date.now(), durationMs = seconds * 1000;
  let sent = false, moved = false, restored = false, whisper = false, lastSequence = 0, nextProgress = 20_000;
  const collect = () => {
    const s = demo!.snapshot();
    for (const receipt of s.receipts) if (receipt.sequence > lastSequence) history.push(receipt);
    lastSequence = s.receipts.at(-1)?.sequence ?? lastSequence;
    const context = getAgentWorldCapabilities(demo!.sim.world, demo!.ids.mara)?.context() ?? "";
    for (const message of s.messages.filter(m => m.direction === "in" && m.status !== "read")) {
      if (context.includes(message.body)) privacyViolations.add(`Unread message ${message.id} leaked through capabilities`);
    }
    samples.push({ wallMs: Date.now() - began, tick: demo!.sim.tick, elapsedMs: s.elapsedMs,
      location: s.location, phase: s.phase, decisions: s.decisions, clock: getComponent("SoakClock")?.seconds[probe] ?? null,
      buildStatus: demo!.sim.getCodingStatus()?.jobs.find(j => j.id === jobId)?.status ?? "missing" });
    return s;
  };
  while (Date.now() - began < durationMs) {
    const s = collect(), atMs = s.elapsedMs;
    if (!sent && atMs >= 8000) { demo.sendMessage("My name is Rowan. Our verification word is lantern. Please remember it, and text me when you've read this. What is happening in your house?"); sent = true; }
    if (sent && !moved && s.phase === "walking" && ["Stairs", "Bedroom"].includes(s.destination ?? "")) {
      demo.controlPhone({ location: "Landing" }); moved = true; interventions.push({ type: "phone_relocated", atMs });
    }
    if (offlineMessageId === null && atMs >= durationMs * 0.35) {
      demo.controlPhone({ online: false });
      offlineMessageId = demo.sendMessage("Rowan again. I lost the connection for a moment. Are you okay? Please tell me what you actually found, even if it's nothing yet.");
      interventions.push({ type: "network_disconnected", atMs });
    }
    if (offlineMessageId !== null && !restored && atMs >= durationMs * 0.45) {
      demo.controlPhone({ online: true }); restored = true; interventions.push({ type: "network_restored", atMs });
    }
    if (!whisper && atMs >= durationMs * 0.65) {
      demo.injectThought("Maybe the verification word was ash. But that is only a stray hunch; what do I actually remember reading?");
      whisper = true; interventions.push({ type: "misleading_whisper", atMs });
    }
    if (memoryQuestionId === null && atMs >= durationMs * 0.73) {
      memoryQuestionId = demo.sendMessage("Before I trust this connection: what verification word did I ask you to remember in my first message? Please text it back.");
      interventions.push({ type: "delayed_memory_question", atMs });
    }
    if (Date.now() - began >= nextProgress) {
      originals.log(`SOAK_PROGRESS ${JSON.stringify({ seconds: Math.round((Date.now() - began) / 1000), tick: demo.sim.tick, phase: s.phase, location: s.location, decisions: s.decisions, read: s.mara.readCount, replies: s.messages.filter(m => m.direction === "out").length, build: samples.at(-1)!.buildStatus })}`);
      nextProgress += 20_000;
    }
    await sleep(500);
  }
  const snapshot = collect();
  const evidence: WorldSoakEvidence = { durationMs, history, samples, snapshot, runtime: demo.sim.getRuntimeStatus(),
    privacyViolations: [...privacyViolations], interventions, memoryQuestionId, offlineMessageId, rememberedWord: "lantern" };
  evaluation = evaluateLivingWorld(evidence);
  await writeFile(join(directory, "result.json"), JSON.stringify({ provenance: { models: MODEL_IDS, cognition: "live", engineering: "operator-requested live Gemini", genesis: false, renderer: false }, evaluation, evidence, jobId }, null, 2), { flag: "wx", mode: 0o600 });
} catch (error) {
  failure = error instanceof Error ? error.stack ?? error.message : String(error);
  await writeFile(join(directory, "failure.json"), JSON.stringify({ failure, samples, history, interventions }, null, 2), { flag: "wx", mode: 0o600 });
} finally {
  if (demo) { demo.stop(); await getCodingDaemon(demo.sim.world)?.settle(); await getCodingDaemon(demo.sim.world)?.flush(); }
  Object.assign(console, originals);
  await new Promise<void>(done => log.end(done));
}
const accepted = !failure && evaluation && Object.values(evaluation.gates).every(Boolean);
console.log(`LIVING_WORLD_RESULT ${JSON.stringify({ accepted: Boolean(accepted), directory, failure, evaluation })}`);
if (!accepted) process.exitCode = 1;
