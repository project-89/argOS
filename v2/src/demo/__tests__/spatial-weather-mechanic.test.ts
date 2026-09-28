import { jest } from "@jest/globals";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { addComponent, hasComponent, removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createObjectEntity, createRoomEntity } from "../../ecs/prefabs";
import { Mind, Name, Traits, WorkingMemoryIdentity } from "../../ecs/components";
import { getComponent } from "../../ecs/component-registry";
import { setLocatedIn } from "../../ecs/location";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { createSystemRegistry, runSystems } from "../../ecs/dynamic-systems";
import { workingMemoryEntityRef } from "../../cognition/working-memory";
import { drainPendingStimuli, peekPendingStimuli } from "../../cognition/stimulus-queue";
import { startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { CodingDaemon } from "../../engineering/coding-daemon";
import { prepareRelease } from "../../engineering/release";
import { createSpatialWeather } from "../spatial-weather";
import { assertSpatialWeatherMechanicRelease, createSpatialWeatherMechanic, createSpatialWeatherMechanicRequest,
  SPATIAL_WEATHER_EXPOSURE, SPATIAL_WETNESS, SPATIAL_WEATHER_MECHANIC_SYSTEM,
  type SpatialWeatherMechanicReceipt, type SpatialWeatherMechanicTarget } from "../spatial-weather-mechanic";

/** Explicit offline builder fixture. This proves the admission/native bridge,
 * not a successful model invocation or autonomous authoring. */
async function writeCandidate(directory: string, multiplier = 1) {
  await mkdir(path.join(directory, "components"), { recursive: true }); await mkdir(path.join(directory, "systems"), { recursive: true });
  await writeFile(path.join(directory, `components/${SPATIAL_WETNESS}.json`), JSON.stringify({ name: SPATIAL_WETNESS,
    description: "Physical wetness on a host-marked entity", fields: { value: { type: "number", default: 0 } } }));
  await writeFile(path.join(directory, `systems/${SPATIAL_WEATHER_MECHANIC_SYSTEM}.ts`), `export function run(ctx:any):void {
    for(const id of ctx.query("${SPATIAL_WEATHER_EXPOSURE}")) {
      if(ctx.get(id,"${SPATIAL_WEATHER_EXPOSURE}","eligible")!==true)continue;
      const rain=ctx.get(id,"${SPATIAL_WEATHER_EXPOSURE}","rainRate"),dry=ctx.get(id,"${SPATIAL_WEATHER_EXPOSURE}","dryRate");
      if(typeof rain!=="number" || typeof dry!=="number" || !Number.isFinite(rain) || !Number.isFinite(dry) || rain<0 || dry<0)continue;
      ctx.attach(id,"${SPATIAL_WETNESS}");
      ctx.set(id,"${SPATIAL_WETNESS}","value",Math.max(0,Math.min(1,ctx.get(id,"${SPATIAL_WETNESS}","value")+(rain-dry)*ctx.deltaMs/1000*${multiplier})));
    }}
  `);
  // Worker tests are deliberately independent of the host's eleven gates.
  const workerTest = (eligible: boolean) => ({ name: `worker eligible ${eligible}`, system: SPATIAL_WEATHER_MECHANIC_SYSTEM,
    entities: [{ id: 1, components: { [SPATIAL_WEATHER_EXPOSURE]: { eligible, rainRate: .025, dryRate: 0, ownerKey: "a", sourceKey: "b" },
      [SPATIAL_WETNESS]: { value: 0 } } }], ticks: 1, deltaMs: 1000,
    expect: [{ entity: 1, component: SPATIAL_WETNESS, field: "value", equals: eligible ? .025 * multiplier : 0 }] });
  await writeFile(path.join(directory, "release.json"), JSON.stringify({ version: 1, components: [`components/${SPATIAL_WETNESS}.json`],
    systems: [{ name: SPATIAL_WEATHER_MECHANIC_SYSTEM, description: "Elapsed-time physical wetness", file: `systems/${SPATIAL_WEATHER_MECHANIC_SYSTEM}.ts`,
      frequency: 1, reads: [SPATIAL_WEATHER_EXPOSURE, SPATIAL_WETNESS], writes: [`${SPATIAL_WETNESS}.value`] }],
    tests: [workerTest(true), workerTest(false)] }));
}

async function fixture() {
  const world = createArgosWorld("Generated weather proof"); world.meta.aiEnabled = false; initializePrefabs(world); startCommittedEvents(world);
  const square = createRoomEntity(world, { name: "Square" }), home = createRoomEntity(world, { name: "House" });
  const mara = createAgentEntity(world, { name: "Mara", role: "resident", systemPrompt: "My private rain memory stays private.", roomId: square });
  const ivo = createAgentEntity(world, { name: "Ivo", role: "resident", systemPrompt: "I choose my own response.", roomId: home });
  const bench = createObjectEntity(world, { name: "Outdoor bench", description: "A public wooden bench." }); setLocatedIn(world, bench, square);
  const hidden = createObjectEntity(world, { name: "HIDDEN_SECRET_BENCH", description: "Hidden fixture." }); setLocatedIn(world, hidden, square);
  addComponent(world, hidden, Traits); Traits.active[hidden] = '["hidden"]';
  const room = { id: square, key: workingMemoryEntityRef(world, square)!.key };
  const targets: SpatialWeatherMechanicTarget[] = [mara, ivo, bench, hidden].map(id => ({ id,
    key: workingMemoryEntityRef(world, id)!.key, kind: id === mara || id === ivo ? "resident" : "furniture" }));
  let running = true;
  const weather = createSpatialWeather({ world, outdoorRooms: [room], running: () => running, record: () => {} });
  const directory = await mkdtemp(path.join(os.tmpdir(), "argos-weather-mechanic-")), registry = createSystemRegistry();
  const daemon = new CodingDaemon(world, registry, { directory, maxTotalJobs: 1, validateRelease: assertSpatialWeatherMechanicRelease },
    async ({ directory: output, context }) => { expect(context).not.toContain("My private rain memory stays private."); await writeCandidate(output); });
  await daemon.initialize();
  const receipts: SpatialWeatherMechanicReceipt[] = [];
  const mechanic = createSpatialWeatherMechanic({ world, targets, outdoorRooms: [room], weather: weather.view,
    running: () => running, active: () => daemon.getStatus().activeSystems.some(row => row.name === SPATIAL_WEATHER_MECHANIC_SYSTEM && row.active),
    record: receipt => receipts.push(receipt) });
  const advance = (delta: number) => advanceSimulationTime(world, world.time.tick + 1, delta);
  const activate = async () => {
    const job = daemon.enqueue(createSpatialWeatherMechanicRequest("offline operator fixture")); await daemon.pump();
    expect(daemon.getStatus().jobs.find(row => row.id === job.id)?.status).toBe("ready");
    mechanic.syncInputs(); daemon.commitReady(world.time.tick); return job;
  };
  const compute = async (delta: number) => { advance(delta); mechanic.syncInputs(); runSystems(world, registry, world.time.tick, delta); await daemon.settle(); };
  const commit = () => { mechanic.syncInputs(); daemon.commitReady(world.time.tick); mechanic.collect(); };
  const close = async () => { running = false; mechanic.close(); weather.close(); daemon.stop(); await daemon.flush(); };
  return { world, square, home, mara, ivo, bench, hidden, targets, room, weather, mechanic, daemon, directory, registry, receipts, advance, activate, compute, commit, close };
}
beforeEach(() => { drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("Weather mechanics tests do not use models")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli(); });

test("exposure projection alone cannot create wetness, observations or a fake generated system", async () => {
  const f = await fixture();
  try {
    f.weather.set("rain", f.square); drainPendingStimuli(); f.advance(100_000); f.mechanic.syncInputs(); f.mechanic.collect();
    expect(f.mechanic.view().active).toBe(false); expect(f.mechanic.view().targets.every(row => row.value === null)).toBe(true);
    expect(f.mechanic.exposure.rainRate[f.mara]).toBe(.025); expect(f.mechanic.exposure.rainRate[f.ivo]).toBe(0);
    expect(f.mechanic.localContext(f.mara)).toBeUndefined(); expect(f.receipts).toEqual([]);
    expect(peekPendingStimuli(undefined, f.world)).toEqual([]); expect(getComponent(SPATIAL_WETNESS)).toBeUndefined();
  } finally { await f.close(); }
});

test("the real admission/worker boundary changes existing entities, then makes only committed local wetness perceivable", async () => {
  const f = await fixture(), arousal = Mind.arousal[f.mara];
  try {
    f.weather.set("rain", f.square); drainPendingStimuli(); const job = await f.activate();
    expect(f.daemon.getStatus().jobs.find(row => row.id === job.id)).toMatchObject({ status: "active", testsPassed: 13 });
    expect(f.mechanic.getWetness(f.mara)).toBeUndefined();
    await f.compute(20_000); f.mechanic.collect();
    expect(f.mechanic.getWetness(f.mara)).toBeUndefined(); expect(f.receipts).toEqual([]);
    f.commit();
    expect(f.mechanic.getWetness(f.mara)).toBe(.5); expect(f.mechanic.getWetness(f.bench)).toBe(.5);
    expect(f.mechanic.getWetness(f.ivo)).toBe(0); expect(f.mechanic.localContext(f.mara)).toContain("Your clothes feel wet against your skin");
    expect(f.mechanic.localContext(f.mara)).toContain("Outdoor bench looks wet");
    expect(f.mechanic.localContext(f.mara)).not.toContain("HIDDEN_SECRET_BENCH"); expect(f.mechanic.localContext(f.ivo)).toBeUndefined();
    expect(peekPendingStimuli(f.mara, f.world).some(row => row.modality === "tactile")).toBe(true);
    expect(JSON.stringify(peekPendingStimuli(f.mara, f.world))).not.toContain("HIDDEN_SECRET_BENCH");
    expect(peekPendingStimuli(f.ivo, f.world)).toEqual([]);
    expect(f.receipts.find(row => row.targetId === f.mara)).toMatchObject({ before: "dry", phase: "wet", value: .5, roomId: f.square, atSimMs: 20_000 });
    const count = f.receipts.length; f.mechanic.collect(); expect(f.receipts).toHaveLength(count);
    expect(Mind.arousal[f.mara]).toBe(arousal); expect(Name.value[f.mara]).toBe("Mara");
    expect(() => f.daemon.enqueue(createSpatialWeatherMechanicRequest())).toThrow(/budget exhausted/);
  } finally { await f.close(); }
});

test("shelter invalidates a computed rain result, then the generated system dries clothes without forcing behavior", async () => {
  const f = await fixture();
  try {
    f.weather.set("rain", f.square); await f.activate(); await f.compute(20_000); f.commit();
    await f.compute(10_000); setLocatedIn(f.world, f.mara, f.home); f.commit();
    expect(f.mechanic.getWetness(f.mara)).toBe(.5);
    expect(f.daemon.getStatus().runtime[0].staleResults).toBe(1);
    expect(f.mechanic.exposure.rainRate[f.mara]).toBe(0); expect(f.mechanic.exposure.dryRate[f.mara]).toBe(.00625);
    drainPendingStimuli(); await f.compute(20_000); f.commit();
    expect(f.mechanic.getWetness(f.mara)).toBeLessThan(.5); expect(f.mechanic.getWetness(f.bench)).toBe(1);
    expect(f.mechanic.localContext(f.mara)).not.toContain("Outdoor bench");
    expect(f.receipts.find(row => row.targetId === f.mara && row.phase === "damp")?.roomId).toBe(f.home);
  } finally { await f.close(); }
});

test("visual loss does not erase one's tactile wetness and hidden/remote details do not leak", async () => {
  const f = await fixture();
  try {
    addComponent(f.world, f.mara, Traits); Traits.active[f.mara] = '["blind"]';
    f.weather.set("rain", f.square); await f.activate(); drainPendingStimuli(); await f.compute(20_000); f.commit();
    expect(f.mechanic.localContext(f.mara)).toBe("Current physical wetness: Your clothes feel wet against your skin.");
    expect(peekPendingStimuli(f.mara, f.world).map(row => row.modality)).toEqual(["tactile"]);
  } finally { await f.close(); }
});

test.each(["source-stop", "identity-replaced", "entity-removed", "room-replaced"])("%s revokes exposure and pending sensory delivery", async cause => {
  const f = await fixture();
  try {
    f.weather.set("rain", f.square); await f.activate(); drainPendingStimuli(); await f.compute(20_000); f.commit();
    if (cause === "source-stop") stopCommittedEvents(f.world);
    if (cause === "identity-replaced") WorkingMemoryIdentity.id[f.mara] = "different-person";
    if (cause === "entity-removed") removeEntity(f.world, f.mara);
    if (cause === "room-replaced") WorkingMemoryIdentity.id[f.square] = "different-place";
    f.mechanic.syncInputs();
    expect(f.mechanic.getWetness(f.mara)).toBe(cause === "source-stop" ? .5 : undefined); expect(f.mechanic.localContext(f.mara)).toBeUndefined();
    expect(peekPendingStimuli(f.mara, f.world)).toEqual([]);
    if (cause !== "entity-removed") expect(f.mechanic.exposure.eligible[f.mara]).toBe(false);
  } finally { await f.close(); }
});

test("stop preserves confirmed physical appearance without producing any new effects", async () => {
  const f = await fixture();
  try {
    f.weather.set("rain", f.square); await f.activate(); await f.compute(20_000); f.commit();
    const count = f.receipts.length;
    f.mechanic.close(); stopCommittedEvents(f.world); f.mechanic.syncInputs(); f.mechanic.collect();
    expect(f.mechanic.getWetness(f.mara)).toBe(.5);
    expect(f.mechanic.view()).toMatchObject({ active: false });
    expect(f.mechanic.view().targets.find(row => row.id === f.mara)).toMatchObject({ value: .5, phase: "wet" });
    expect(f.mechanic.localContext(f.mara)).toBeUndefined(); expect(f.receipts).toHaveLength(count);
    startCommittedEvents(f.world); expect(f.mechanic.getWetness(f.mara)).toBeUndefined();
  } finally { await f.close(); }
});

test("restored wet state is present sensory context, not a fabricated new dry-to-wet event", async () => {
  const f = await fixture();
  let restored: ReturnType<typeof createSpatialWeatherMechanic> | undefined;
  try {
    f.weather.set("rain", f.square); await f.activate(); await f.compute(20_000); f.commit();
    expect(f.mechanic.getWetness(f.mara)).toBe(.5);
    f.mechanic.close(); drainPendingStimuli();
    const freshReceipts: SpatialWeatherMechanicReceipt[] = [];
    // Rebind the native adapter to retained ECS state, without resetting the
    // physical component or asking a builder to recreate its lived history.
    restored = createSpatialWeatherMechanic({ world: f.world, targets: f.targets, outdoorRooms: [f.room],
      weather: f.weather.view, running: () => true, active: () => true, record: row => freshReceipts.push(row) });
    restored.syncInputs(); restored.collect();
    expect(restored.getWetness(f.mara)).toBe(.5);
    expect(restored.localContext(f.mara)).toContain("Your clothes feel wet against your skin.");
    expect(freshReceipts).toEqual([]); expect(peekPendingStimuli(undefined, f.world)).toEqual([]);
    // A later genuine committed physical threshold remains observable once.
    getComponent(SPATIAL_WETNESS).value[f.mara] = .25;
    restored.collect(); restored.collect();
    expect(freshReceipts).toHaveLength(1);
    expect(freshReceipts[0]).toMatchObject({ targetId: f.mara, before: "wet", phase: "damp", value: .25 });
  } finally { restored?.close(); await f.close(); }
});

test("invalid generated values fail closed rather than being clamped into invented sensory evidence", async () => {
  const f = await fixture();
  try {
    await f.activate(); await f.compute(1000); f.commit();
    getComponent(SPATIAL_WETNESS).value[f.mara] = 12;
    f.mechanic.collect(); expect(f.mechanic.getWetness(f.mara)).toBeUndefined();
    expect(f.mechanic.localContext(f.mara)).toBeUndefined(); expect(f.receipts).toEqual([]);
  } finally { await f.close(); }
});

test("independent host rate gates reject a plausible wrong candidate before it changes the world", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "argos-weather-wrong-")); await writeCandidate(directory, 2);
  await expect(prepareRelease(directory, createSpatialWeatherMechanicRequest().acceptance)).rejects.toThrow(/host rain exposure/);
});

test("release scope is exact, disallowing private reads, public host writes, extra systems and component fields", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "argos-weather-policy-")); await writeCandidate(directory);
  const good = await prepareRelease(directory, createSpatialWeatherMechanicRequest().acceptance);
  expect(() => assertSpatialWeatherMechanicRelease(good)).not.toThrow();
  for (const mutate of [
    (r: typeof good) => { r.manifest.systems[0].reads.push("Mind"); },
    (r: typeof good) => { r.manifest.systems[0].writes.push(`${SPATIAL_WEATHER_EXPOSURE}.rainRate`); },
    (r: typeof good) => { r.manifest.systems.push({ ...r.manifest.systems[0], name: "ExtraMechanic" }); },
    (r: typeof good) => { r.components[0].fields.hidden = { type: "number", default: 0 }; },
    (r: typeof good) => { r.components[0].name = "OtherWetness"; },
    (r: typeof good) => { r.manifest.systems[0].frequency = 5; },
  ]) {
    const copy = { ...good, manifest: structuredClone(good.manifest), components: structuredClone(good.components) };
    mutate(copy); expect(() => assertSpatialWeatherMechanicRelease(copy)).toThrow(/only the one generated/);
  }
});
