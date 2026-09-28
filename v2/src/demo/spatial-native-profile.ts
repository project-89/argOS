/** Provider-free CPU attribution, not an autonomous behavior or real-time gate.
 * Uses the spatial town and real ActorControl path, optionally with the volume
 * of private memory from a recorded trial. Historical keys remain historical;
 * copying them into this isolated fixture is NOT a production restore path. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { Session } from "node:inspector/promises";

const args = Object.fromEntries(process.argv.slice(2).map(value => value.replace(/^--/, "").split(/=(.*)/s).slice(0, 2)));
const ticks = Number(args.ticks ?? 100), mode = args.mode ?? "queued";
const eventCount = Number(args.events ?? 0);
assert.ok(Number.isInteger(ticks) && ticks >= 10 && ticks <= 300);
assert.ok(Number.isInteger(eventCount) && eventCount >= 0 && eventCount <= 2048);
assert.ok(["queued", "deliberating", "runtime"].includes(mode));
assert.ok(args.out, "--out is required; use a private diagnostic directory");
const directory = resolve(args.out); mkdirSync(directory, { recursive: true, mode: 0o700 });
const report = console.log.bind(console); console.log = () => {};
let providers = 0;
globalThis.fetch = (async () => { providers++; throw Error("Native CPU profile forbids providers"); }) as typeof fetch;
const { SpatialDemo } = await import("./spatial-demo");
const { addComponent } = await import("bitecs");
const { Name, WorkingMemory, WorkingMemoryIdentity } = await import("../ecs/components");
const { runActorControlStep } = await import("../cognition/cognition-system");
const { captureThoughtPublication, takeNewAuthoredThoughtEvents } = await import("../cognition/thought-publication");
const { publishCommittedEvent } = await import("../runtime/committed-events");
const { getRoomForEntity } = await import("../ecs/location");
const demo = await SpatialDemo.create({ scenario: "town", story: "coastal-mystery", evolving: true,
  live: false, automaticClock: false, seconds: 600 });
const profiler = new Session(); profiler.connect();
const measures: Record<string, number[]> = { world: [], actorControl: [], thoughtPublication: [] };
const systems = new Map<string, number[]>();
let seededActors = 0;
try {
  await demo.start();
  if (args.memory) {
    const rows = JSON.parse(readFileSync(resolve(args.memory), "utf8"));
    for (const eid of demo.actors) {
      const row = rows.find((row: any) => row.name === Name.value[eid]); if (!row) continue;
      addComponent(demo.sim.world, eid, WorkingMemory);
      WorkingMemory.ownerKey[eid] = WorkingMemoryIdentity.id[eid];
      WorkingMemory.factsJson[eid] = JSON.stringify(row.memory.facts);
      WorkingMemory.receiptsJson[eid] = JSON.stringify(row.memory.receipts);
      WorkingMemory.revision[eid] = row.memory.revision;
      WorkingMemory.evidenceFloorMs[eid] = row.memory.evidenceFloorMs;
      seededActors++;
    }
  }
  // Published fixture speech establishes only public-log load; no listener or
  // perception is injected and no autonomous narrative is being replayed.
  for (let i = 0; i < eventCount; i++) {
    const actorId = demo.actors[i % demo.actors.length];
    publishCommittedEvent(demo.sim.world, { executionId: `profile:${i}`, kind: "speech", action: "speak",
      actorId, roomId: getRoomForEntity(demo.sim.world, actorId)!, status: "succeeded", text: "Fixture speech." });
  }
  for (const system of demo.sim.god.systemRegistry.systems.values()) {
    const original = system.compiledFn; if (!original) continue;
    system.compiledFn = (world, context) => {
      const at = performance.now();
      try { return original(world, context); }
      finally { const values = systems.get(system.name) ?? []; values.push(performance.now() - at); systems.set(system.name, values); }
    };
  }
  await profiler.post("Profiler.enable"); await profiler.post("Profiler.setSamplingInterval", { interval: 500 });
  await profiler.post("Profiler.start");
  const started = performance.now();
  if (mode === "runtime") {
    // Full library fast-loop wrappers, still with AI disabled. This includes
    // emotional/appearance emission, enrollment, monitoring and actor control,
    // unlike manual world.advance. No claim to recreate live asynchronous load.
    await demo.sim.start();
    const deadline = performance.now() + ticks * 100 + 6000;
    while (demo.sim.world.time.tick < ticks && performance.now() < deadline)
      await new Promise(resolve => setTimeout(resolve, 10));
    demo.sim.stop();
    assert.equal(demo.sim.world.time.tick, ticks, "bounded native runtime tick target");
  } else for (let tick = 0; tick < ticks; tick++) {
    let at = performance.now(); demo.advance(100); measures.world.push(performance.now() - at);
    let control = 0, publication = 0;
    for (const eid of demo.actors) {
      at = performance.now(); const cursor = captureThoughtPublication(demo.sim.world, eid); publication += performance.now() - at;
      at = performance.now(); runActorControlStep(demo.sim.world, eid, demo.sim.god.systemRegistry,
        { deliberating: mode === "deliberating" }); control += performance.now() - at;
      at = performance.now(); takeNewAuthoredThoughtEvents(cursor); publication += performance.now() - at;
    }
    measures.actorControl.push(control); measures.thoughtPublication.push(publication);
  }
  const elapsedMs = performance.now() - started;
  const { profile } = await profiler.post("Profiler.stop");
  const stats = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return { count: values.length, totalMs: values.reduce((a, b) => a + b, 0),
      medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.ceil(sorted.length * .95) - 1], maxMs: sorted.at(-1) };
  };
  const result = { mode, ticks, actors: demo.actors.length, seededActors, eventCount, providers, elapsedMs, simulatedMs: demo.atSimMs,
    note: (mode === "runtime"
      ? "Real-time library fast-loop fixture with AI disabled; not live reasoning/queue load. "
      : "Synchronous accelerated profiling fixture. No model execution or queue dispatch. ")
      + "Recorded memory volume is not a world restore or behavioral replay.",
    phases: Object.fromEntries(Object.entries(measures).map(([name, values]) => [name, stats(values)])),
    runtime: mode === "runtime" ? demo.sim.getRuntimeStatus() : undefined,
    systems: Object.fromEntries([...systems].map(([name, values]) => [name, stats(values)])) };
  writeFileSync(join(directory, mode + ".cpuprofile"), JSON.stringify(profile), { mode: 0o600 });
  writeFileSync(join(directory, mode + ".json"), JSON.stringify(result, null, 2), { mode: 0o600 });
  assert.equal(providers, 0); assert.equal(demo.atSimMs, ticks * 100);
  report(JSON.stringify(result));
} finally { demo.stop(); profiler.disconnect(); }
