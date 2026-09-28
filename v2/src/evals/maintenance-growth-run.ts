/** Dedicated-process, explicit-spend maintenance diagnostic. No H3 or UI server.
 * Technical milestones are not an autonomous usefulness/goal acceptance score. */
import "dotenv/config";
import { mkdir, mkdtemp, open, readFile, unlink, writeFile } from "node:fs/promises";
import { createWriteStream, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { format } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { query, addComponent, getRelationTargets, hasComponent } from "bitecs";
import { createSimulation, type ArgosSimulation } from "../index";
import { Agent, Name, Description, ObjectState, ObjectType, Perception, Plan } from "../ecs/components";
import { HasPlan } from "../ecs/relations";
import { PostQuietDisturbanceGate, settledReview, reopenFixtureValve } from "./post-quiet-disturbance";
import { getCodingDaemon } from "../engineering/coding-daemon";
import { getFactoryState } from "../spirits/spirit-factory";
import { recordEvent } from "../spirits/consistency-spirit";
import { getArchitectDiagnostics } from "../spirits/architect-diagnostics";
import { getSpiritSystemState } from "../spirits/spirit-system";
import { getAgentPerceptions } from "../cognition/agent-mind";
import { getCommittedEvents } from "../runtime/committed-events";
import { serializeWorld } from "../persistence/world-persistence";
import { worldSchema } from "../world/schema";
import { MODEL_IDS } from "../llm/config";

const args = process.argv.slice(2);
const durationArg = args.find(arg => arg.startsWith("--seconds="));
const seconds = Number(durationArg?.split("=")[1] ?? 180);
const disturbAfterQuiet = args.includes("--disturb-after-quiet");
if (!args.includes("--live") || args.some(arg => arg !== "--live" && arg !== "--disturb-after-quiet" && !arg.startsWith("--seconds="))
  || !Number.isInteger(seconds) || seconds < 120 || seconds > 300)
  throw new Error("Use --live --seconds=120..300 [--disturb-after-quiet]. Explicit Gemini cognition/build spend; no H3.");
if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) throw new Error("Gemini key required");

await mkdir(resolve("recordings"), { recursive: true });
const lockPath = resolve("recordings/maintenance-growth-live.lock"), token = randomUUID();
// Never steal a stale lock automatically; inspect its owner before recovery.
const lock = await open(lockPath, "wx", 0o600);
await lock.writeFile(JSON.stringify({ pid: process.pid, token, seconds, startedAt: new Date().toISOString() })); await lock.close();
const directory = await mkdtemp(resolve("recordings/maintenance-growth-"));
const original = { log: console.log, warn: console.warn, error: console.error };
const log = createWriteStream(join(directory, "runtime.log"), { flags: "wx", mode: 0o600 });
let bytes = 0;
for (const method of ["log", "warn", "error"] as const) console[method] = (...values: unknown[]) => {
  const line = format(...values) + "\n";
  if (bytes + Buffer.byteLength(line) <= 5_000_000) { log.write(line); bytes += Buffer.byteLength(line); }
};
const brief = "Requested environmental capability: water should accumulate in the reservoir while the supply valve is open and stop accumulating when it is closed. The present world has the physical openable valve and reservoir but no accumulation mechanic. Supply the missing bounded mechanic through normal spirit review and managed engineering. Keep its physical quantity and public appearance consistent. Do not write NPC minds, move people, invent success or require the caretaker to act. Do not generate unrelated systems, rooms or people. A validated installation is not proof that the room problem is solved.";
const provenance = { seconds, models: MODEL_IDS, builder: "gemini", renderer: false, productionCoordinator: true, maxTotalJobs: 1,
  disturbance: disturbAfterQuiet ? { kind: "one physical valve reopening", quietSimMs: 60_000, minimumResponseMs: 90_000,
    eligibility: "Active generated mechanic, closed valve, same completed sustained-work review and no pending planning for 60 simulation seconds.",
    scoring: "No eligible window is inconclusive. Track fault, actual perception, decisions and committed effects separately. Closure or a grounded alternative is responsive; observed deliberate refusal is reported separately, never forced. No perception is a perception failure; perceived but no reconsideration/action is a cognition failure. This single diagnostic cannot pass the ten-trial matrix." } : null,
  initialWorld: "authored", needSource: "operator capability request, not spontaneous failure discovery", brief };
await writeFile(join(directory, "protocol.json"), JSON.stringify(provenance, null, 2), { flag: "wx", mode: 0o600 });
original.log(`MAINTENANCE_DIAGNOSTIC ${JSON.stringify({ directory, seconds, renderer: false })}`);
let sim: ArgosSimulation | undefined, failure: string | null = null, stopRequested = false;
const samples: unknown[] = [], publicEvents: unknown[] = [], buildEvents: unknown[] = [];
const disturbanceGate = new PostQuietDisturbanceGate();
let disturbance: unknown = null;
let sampledSequence = 0, evidenceBytes = 0;
const onStop = () => { stopRequested = true; };
process.once("SIGINT", onStop); process.once("SIGTERM", onStop);
// Includes initialization and bounded cleanup; kills only this owned CLI process.
const watchdog = setTimeout(() => {
  writeFileSync(join(directory, "hard-timeout.json"), JSON.stringify({ reason: "diagnostic hard deadline", seconds, samples: samples.length }), { mode: 0o600 });
  process.exit(2); // Preserve the lock for explicit owner verification after hard failure.
}, (seconds + 60) * 1000);
try {
  sim = await createSimulation({ name: "Reservoir maintenance diagnostic", narrative: brief, preset: "minimal",
    enableAI: true, enableServer: false, enableSpirits: true, enableNarrativeEngine: false,
    generateSchedules: false, autoPopulateRooms: false, cognitionController: "situated", narrativeMind: true,
    experienceReconsideration: true, dualLoop: true, ecsTickRate: 2, ecsDeltaMs: 500,
    codingDaemons: { backend: "gemini", directory: join(directory, "engineering"), timeoutMs: 90000, maxQueue: 3, maxTotalJobs: 1 },
    godAutopilot: { enabled: true, minRunIntervalMs: 30000, maxMessagesPerRun: 4, maxInboxSize: 30 },
    evolution: { architectInterval: 10, crafterInterval: 60, stewardInterval: 60, artificerInterval: 60,
      lawgiverInterval: 120, maxProposalExecutions: 1 },
    rooms: [{ name: "Reading room", description: "A small public reading room. A supply valve feeds a shallow reservoir beside the books. Water should not spill onto the books.", autoPopulate: false }],
    agents: [{ name: "Mara", role: "caretaker", startRoom: "Reading room", systemPrompt: "You care about keeping this reading room and its books in good condition. You can inspect your surroundings and act on what you actually perceive. You have your own judgment; do not claim actions you have not performed." }],
    objects: [{ name: "Supply valve", room: "Reading room", traits: ["openable"], description: "The supply valve is open, feeding the reservoir." },
      { name: "Reservoir", room: "Reading room", description: "A shallow reservoir with a visible depth gauge, currently empty." }] });
  worldSchema.defineObjectType({ name: "diagnostic_supply_valve", description: "Reservoir supply valve", traits: ["openable"], defaultState: "open",
    states: { open: { description: "The supply valve is open, feeding the reservoir." }, closed: { description: "The supply valve is closed; its incoming flow has stopped." } } });
  const valve = [...query(sim.world, [Name])].find(id => Name.value[id] === "Supply valve")!;
  const actor = [...query(sim.world, [Agent, Name])].find(id => Name.value[id] === "Mara")!;
  addComponent(sim.world, valve, ObjectType); ObjectType.typeId[valve] = "diagnostic_supply_valve";
  addComponent(sim.world, valve, ObjectState); ObjectState.current[valve] = "open";
  sim.onSystem(event => { if (event.type === "system:build") buildEvents.push({ ...event, atSimMs: sim!.world.time.elapsed }); });
  recordEvent("operator_requested_capability", { content: brief, valveEid: valve }, "diagnostic operator");
  const began = Date.now();
  const sample = () => {
    const current = sim!;
    const events = getCommittedEvents(current.world, sampledSequence);
    if (events.gap) throw new Error("Committed-event evidence gap");
    for (const event of events.events) { publicEvents.push(event); sampledSequence = Math.max(sampledSequence, event.sequence); }
    const row = { wallMs: Date.now() - began, simMs: current.world.time.elapsed, tick: current.tick,
      engineering: current.getCodingStatus(), evolution: current.getEvolutionStatus(), observer: current.bus.getObserverHealth(),
      proposals: getFactoryState().pendingProposals.map(p => ({ id: p.id, name: p.name, status: p.status, revisionOf: p.revisionOf, reason: p.rejectionReason })),
      valveState: ObjectState.current[valve], settledReview: settledReview(current.world, actor),
      plans: getRelationTargets(current.world, actor, HasPlan).filter(id => hasComponent(current.world, id, Plan)).map(id => ({ id,
        goalId: Plan.goalEid[id], status: Plan.status[id], createdAt: Plan.createdAt[id], lastUpdated: Plan.lastUpdated[id], currentStep: Plan.currentStep[id] })),
      appearance: [...query(current.world, [Name, Description])].map(id => ({ id, name: Name.value[id], description: Description.value[id] })),
      actualPerceptions: [...query(current.world, [Agent])].map(id => ({ id, name: Name.value[id], entries: getAgentPerceptions(current.world, id).map(p => ({ id: p, content: Perception.content[p], source: Perception.source[p], timestamp: Perception.timestamp[p] })) })) };
    evidenceBytes += Buffer.byteLength(JSON.stringify(row));
    if (evidenceBytes > 20_000_000) throw new Error("Diagnostic evidence budget exceeded");
    samples.push(row); return row;
  };
  void sim.start().catch(error => { failure = String(error); stopRequested = true; });
  while (!stopRequested && Date.now() - began < seconds * 1000) {
    const row = sample();
    if (disturbAfterQuiet && disturbanceGate.consider({ simMs: row.simMs, remainingWallMs: seconds * 1000 - row.wallMs,
      remainingSimMs: seconds * 1000 - row.simMs, sourceId: getCommittedEvents(sim.world).sourceId,
      reviewKey: row.settledReview?.fingerprint ?? null, valveClosed: row.valveState === "closed",
      mechanicActive: row.engineering?.activeSystems.some(system => system.active) ?? false })) {
      const ids = [...query(sim.world, [Name])];
      const result = reopenFixtureValve({ world: sim.world, worldSchema,
        registry: { byName: new Map(ids.map(id => [Name.value[id], id])), byId: new Map(ids.map(id => [id, Name.value[id]])) } }, valve);
      disturbance = { wallMs: row.wallMs, simMs: row.simMs, sourceId: getCommittedEvents(sim.world).sourceId,
        actorId: actor, valveId: valve, review: row.settledReview, result, description: Description.value[valve] };
      if (!result.ok) throw new Error(`Physical fault failed: ${result.error}`);
      recordEvent("diagnostic_physical_fault", { valveEid: valve, previous: result.oldState, current: "open" }, "diagnostic fixture");
      original.log(`MAINTENANCE_DISTURBANCE ${JSON.stringify(disturbance)}`);
    }
    await writeFile(join(directory, "checkpoint.json"), JSON.stringify({ row, disturbance, publicEvents, buildEvents, architectDiagnostics: getArchitectDiagnostics(sim.world) }), { mode: 0o600 });
    if ((row.engineering?.admissionBudget.used ?? 0) > 1) { failure = "engineering admission budget exceeded"; break; }
    if (process.memoryUsage().rss > 2_000_000_000) { failure = "RSS budget exceeded"; break; }
    if (samples.length % 10 === 0) original.log(`MAINTENANCE_PROGRESS ${JSON.stringify({ seconds: Math.round(row.wallMs / 1000), tick: row.tick, proposals: row.proposals.length, jobs: row.engineering?.jobs.map(j => j.status) })}`);
    await sleep(1000);
  }
  if (stopRequested && !failure) failure = "interrupted";
  sample();
} catch (error) { failure = String(error); }
finally {
  try {
    sim?.stop();
    if (sim) {
      const daemon = getCodingDaemon(sim.world);
      const drained = await Promise.race([Promise.all([daemon?.settle(), daemon?.flush()]).then(() => true), sleep(5000).then(() => false)]);
      if (!drained) failure = failure ?? "Cleanup deadline exceeded; pending work not fully settled";
      await writeFile(join(directory, "world.json"), JSON.stringify(serializeWorld(sim.world, sim.god.systemRegistry)), { flag: "wx", mode: 0o600 });
    }
  } catch (error) { failure = `${failure ?? "Cleanup failed"}: ${String(error)}`; }
  await writeFile(join(directory, "result.json"), JSON.stringify({ provenance, failure, disturbance, samples, publicEvents, buildEvents,
    terminal: sim ? { engineering: sim.getCodingStatus(), evolution: sim.getEvolutionStatus(), architectDiagnostics: getArchitectDiagnostics(sim.world),
      godInbox: sim.god.autopilot?.inbox, spiritInboxes: [...(getSpiritSystemState()?.registry.spirits.values() ?? [])].map(s => ({ name: s.definition.name, inbox: s.inbox })) } : null,
    runtime: sim?.getRuntimeStatus(), assessment: "Diagnostic evidence only: causal usefulness and autonomous response require review; not an acceptance pass." }), { flag: "wx", mode: 0o600 });
  Object.assign(console, original); await new Promise<void>(done => log.end(done));
  const owner = JSON.parse(await readFile(lockPath, "utf8")); if (owner.token === token) await unlink(lockPath);
  process.removeListener("SIGINT", onStop); process.removeListener("SIGTERM", onStop); clearTimeout(watchdog);
  original.log(`MAINTENANCE_RESULT ${JSON.stringify({ directory, failure, samples: samples.length, publicEvents: publicEvents.length, assessment: "requires causal review" })}`);
  process.exit(failure ? 1 : 0);
}
