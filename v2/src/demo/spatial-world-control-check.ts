/** Two explicitly authorized classifier calls; no live NPCs or world clock.
 * Refuses to overwrite evidence and never serializes provider errors/headers. */
import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { getAllEntities } from "bitecs";
import { SpatialDemo } from "./spatial-demo";
import { createSpatialWorldControl, interpretWorldCommand, type WorldControlReceipt } from "./spatial-world-control";
import { ObjectState, WorkingMemoryIdentity } from "../ecs/components";
import { MODEL_IDS, THINKING_LEVELS } from "../llm/config";
import { getCommittedEvents } from "../runtime/committed-events";

if (!process.argv.includes("--live")) throw new Error("This bounded two-call check requires explicit --live authorization.");
if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) throw new Error("The configured Google model credential is unavailable.");
const output = resolve(process.argv.find(arg => arg.startsWith("--out="))?.slice(6)
  ?? "recordings/spatial-house-spirit-language-20260925-01");
await mkdir(output); // Deliberately not recursive: an existing evidence directory is an error.
const write = (name: string, value: unknown) => writeFile(resolve(output, name), JSON.stringify(value, null, 2), { flag: "wx" });
const sourcePaths = ["src/demo/spatial-world-control.ts", "src/demo/spatial-blackout.ts", "src/demo/spatial-demo.ts", "src/llm/config.ts"];
const fingerprint = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async path =>
  [path, createHash("sha256").update(await readFile(path)).digest("hex")])));
const beforeSources = await fingerprint(), startedAt = new Date().toISOString();
let demo: SpatialDemo | undefined, control: ReturnType<typeof createSpatialWorldControl> | undefined;
let calls = 0, settledCalls = 0;
const outcomes: unknown[] = [], logs: Array<{ request: string; receipt: WorldControlReceipt }> = [];
const log = console.log;
const deadline = setTimeout(() => {
  control?.stop(); demo?.stop();
  void write("deadline.json", { status: "failed", reason: "40-second global deadline", calls, settledCalls, outcomes })
    .finally(() => process.exit(2));
}, 40_000);
await write("manifest.json", { startedAt, sourceBefore: beforeSources, model: MODEL_IDS.code,
  thinking: THINKING_LEVELS.SPIRIT, maxCalls: 2, perCallDeadlineMs: 15_000, globalDeadlineMs: 40_000,
  npcAI: false, automaticClock: false, requests: [
    "Could you lift the lid of the household supplies box?", "Add a dog to the apartment",
  ] });
try {
  console.log = () => {}; // Avoid an unrelated full private fixture dump in this narrow evidence set.
  demo = await SpatialDemo.create({ live: false, automaticClock: false, scenario: "blackout" });
  await demo.start(); console.log = log;
  const world = demo.sim.world, box = demo.byId.get("supply-box")!;
  const readPhysical = () => ({ boxKey: WorkingMemoryIdentity.id[box], boxState: ObjectState.current[box],
    entityIds: [...getAllEntities(world)].sort((a, b) => a - b), power: demo!.blackout!.view().power,
    sourceId: getCommittedEvents(world).sourceId });
  control = createSpatialWorldControl({ world, running: () => demo!.running, live: false, blackout: demo.blackout!, box,
    interpreter: async (text, signal) => {
      if (++calls > 2) throw new Error("Classifier call budget exceeded");
      try { return await interpretWorldCommand(text, signal); } finally { settledCalls++; }
    }, changed: () => {}, record: (request, receipt) => logs.push({ request, receipt }),
  });
  const cases = [
    { request: "Could you lift the lid of the household supplies box?", operation: "box_open", status: "applied", boxState: "open" },
    { request: "Add a dog to the apartment", operation: "unsupported", status: "rejected", boxState: undefined },
  ] as const;
  for (const [index, test] of cases.entries()) {
    const before = readPhysical(), start = performance.now();
    const receipt = await control.command(test.request), latencyMs = Math.round(performance.now() - start), after = readPhysical();
    const passed = receipt.operation === test.operation && receipt.status === test.status
      && after.boxState === (test.boxState ?? before.boxState) && after.power === before.power
      && JSON.stringify(after.entityIds) === JSON.stringify(before.entityIds) && after.sourceId === before.sourceId;
    const outcome = { ordinal: index + 1, request: test.request, expected: test, latencyMs, receipt, before, after, passed };
    outcomes.push(outcome); await write(`request-${index + 1}.json`, outcome);
    log(JSON.stringify({ ordinal: index + 1, latencyMs, operation: receipt.operation, status: receipt.status, passed }));
  }
  control.stop(); console.log = () => {}; demo.stop(); console.log = log;
  const sourceAfter = await fingerprint();
  const result = { startedAt, endedAt: new Date().toISOString(), model: MODEL_IDS.code, calls, settledCalls,
    passed: calls === 2 && settledCalls === 2 && outcomes.every(row => (row as { passed: boolean }).passed),
    outcomes, logs, sourceAfter, sourceChangedDuringCheck: JSON.stringify(beforeSources) !== JSON.stringify(sourceAfter) };
  await write("result.json", result); log(JSON.stringify({ evidence: output, passed: result.passed, calls, settledCalls }));
  process.exitCode = result.passed ? 0 : 1;
} catch (error) {
  control?.stop(); console.log = () => {}; demo?.stop(); console.log = log;
  await write("failure.json", { reason: "Bounded check could not finish", errorType: error instanceof Error ? error.name : typeof error,
    calls, settledCalls, outcomes });
  process.exitCode = 1;
} finally { console.log = log; clearTimeout(deadline); }
