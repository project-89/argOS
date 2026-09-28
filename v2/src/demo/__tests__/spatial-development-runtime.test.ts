import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hasComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity, createObjectEntity } from "../../ecs/prefabs";
import { Mind, ObjectState, Position } from "../../ecs/components";
import { getComponent } from "../../ecs/component-registry";
import { getRoomForEntity, setLocatedIn } from "../../ecs/location";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { createSystemRegistry, runSystems } from "../../ecs/dynamic-systems";
import { workingMemoryEntityRef } from "../../cognition/working-memory";
import { startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { CodingDaemon } from "../../engineering/coding-daemon";
import { createSpatialDevelopmentInputs, registerSpatialDevelopmentInputSchema } from "../spatial-development-inputs";
import { assertSpatialDevelopmentRelease, SPATIAL_DEVELOPMENT_BUILDER_CONTEXT, SPATIAL_DEVELOPMENT_INPUT,
  SPATIAL_DEVELOPMENT_LIMITS, permitsSpatialDevelopmentValue } from "../spatial-development-policy";

/** Deliberately scripted offline worker artifacts. This demonstrates real
 * validated native execution, not model quality or autonomous discovery. */
async function writeMechanic(directory: string, growth: boolean) {
  const component = growth ? "SpatialDevGrowth" : "SpatialDevMoisture", system = `${component}Cycle`;
  await mkdir(path.join(directory, "components"), { recursive: true }); await mkdir(path.join(directory, "systems"), { recursive: true });
  await writeFile(path.join(directory, `components/${component}.json`), JSON.stringify({ name: component, description: "Physical fixture value",
    fields: { value: { type: "number", default: 0 } } }));
  const source = `export function run(ctx:any):void {for(const id of ctx.query("SpatialDevelopmentInput")) {
    if(ctx.get(id,"SpatialDevelopmentInput","eligible")!==true)continue;
    ${growth ? 'if(ctx.get(id,"SpatialDevelopmentInput","asset")!=="plant")continue;' : ""}
    ctx.attach(id,"${component}");
    const previous=ctx.get(id,"${component}","value");
    ${growth ? 'const moisture=ctx.get(id,"SpatialDevMoisture","value"); const rate=typeof moisture==="number"?Math.max(0,Math.min(1,moisture))*.5:0;'
      : 'const rate=ctx.get(id,"SpatialDevelopmentInput","weather")==="rain"?.25:-.125;'}
    ctx.set(id,"${component}","value",Math.max(0,Math.min(1,previous+rate*ctx.deltaMs/1000)));
  }}`;
  await writeFile(path.join(directory, `systems/${system}.ts`), source);
  const fixture = (eligible: boolean) => ({ name: `${system} eligible ${eligible}`, system,
    entities: [{ id: 1, components: { SpatialDevelopmentInput: { eligible, asset: "plant", weather: "rain" },
      [component]: { value: 0 }, ...(growth ? { SpatialDevMoisture: { value: .5 } } : {}) } }], ticks: 1, deltaMs: 1000,
    expect: [{ entity: 1, component, field: "value", equals: eligible ? .25 : 0 }] });
  await writeFile(path.join(directory, "release.json"), JSON.stringify({ version: 1, components: [`components/${component}.json`],
    systems: [{ name: system, description: growth ? "Growth uses committed moisture" : "Moisture follows public rain", file: `systems/${system}.ts`, frequency: 10,
      reads: [SPATIAL_DEVELOPMENT_INPUT, component, ...(growth ? ["SpatialDevMoisture"] : [])], writes: [`${component}.value`] }],
    tests: [fixture(true), fixture(false)] }));
}

async function setup() {
  const world = createArgosWorld("Offline coupled development proof"); initializePrefabs(world); startCommittedEvents(world);
  const garden = createRoomEntity(world, { name: "Garden" }), home = createRoomEntity(world, { name: "Home" });
  const resident = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "PRIVATE_CONTEXT_MUST_STAY_PRIVATE", roomId: garden });
  const plant = createObjectEntity(world, { name: "Potted plant" }); setLocatedIn(world, plant, garden);
  const outsider = createObjectEntity(world, { name: "UNAPPROVED_PLANT" }); setLocatedIn(world, outsider, garden);
  const key = (id: number) => workingMemoryEntityRef(world, id)!.key;
  const registry = createSystemRegistry(), directory = await mkdtemp(path.join(os.tmpdir(), "argos-development-proof-"));
  const inputs = createSpatialDevelopmentInputs({ world,
    targets: [{ id: resident, key: key(resident), kind: "resident", asset: "person" }, { id: plant, key: key(plant), kind: "object", asset: "plant" }],
    rooms: [{ id: garden, key: key(garden), outdoor: true }, { id: home, key: key(home), outdoor: false }],
    weather: () => [{ id: garden, key: key(garden), condition: "rain" }], running: () => true });
  inputs.syncInputs();
  const daemon = new CodingDaemon(world, registry, { directory, maxTotalJobs: SPATIAL_DEVELOPMENT_LIMITS.maxTotalJobs,
    maxQueue: SPATIAL_DEVELOPMENT_LIMITS.maxQueue, authoringContext: SPATIAL_DEVELOPMENT_BUILDER_CONTEXT,
    validateRelease: (release, context) => assertSpatialDevelopmentRelease(release, new Set(context.componentNames)),
    initializeInputs: registerSpatialDevelopmentInputSchema, beforeCommit: inputs.syncInputs, permitsEntity: inputs.permits,
    permitsValue: permitsSpatialDevelopmentValue,
  }, async ({ job, directory: output, context }) => {
    expect(context).toContain(SPATIAL_DEVELOPMENT_BUILDER_CONTEXT); expect(context).not.toContain("PRIVATE_CONTEXT_MUST_STAY_PRIVATE");
    expect(context).not.toContain("UNAPPROVED_PLANT"); await writeMechanic(output, job.request.instruction === "growth");
  });
  await daemon.initialize();
  const activate = async (kind: string) => {
    const job = daemon.enqueue({ source: "offline operator", instruction: kind }); await daemon.pump();
    expect(daemon.getStatus().jobs.find(row => row.id === job.id)?.status).toBe("ready");
    daemon.commitReady(world.time.tick); expect(daemon.getStatus().jobs.find(row => row.id === job.id)?.status).toBe("active"); return job;
  };
  const compute = async (ticks = 10, deltaMs = 1000) => {
    advanceSimulationTime(world, world.time.tick + ticks, deltaMs); inputs.syncInputs(); runSystems(world, registry, world.time.tick, deltaMs); await daemon.settle();
  };
  const value = (name: string, entity = plant) => { const component = getComponent(name); return component && hasComponent(world, entity, component) ? component.value[entity] : undefined; };
  const close = async () => { inputs.close(); daemon.stop(); await daemon.flush(); };
  return { world, garden, home, resident, plant, outsider, registry, inputs, daemon, activate, compute, value, close };
}
beforeEach(() => { jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("Offline native development proof")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test("two separately admitted mechanics compose real committed moisture and growth without native or private mutations", async () => {
  const f = await setup(), arousal = Mind.arousal[f.resident], x = Position.x[f.resident], state = ObjectState.current[f.plant];
  try {
    await f.activate("moisture"); expect(f.value("SpatialDevMoisture")).toBeUndefined();
    await f.compute(); expect(f.value("SpatialDevMoisture")).toBeUndefined();
    f.daemon.commitReady(f.world.time.tick); expect(f.value("SpatialDevMoisture")).toBe(.25);
    await f.activate("growth"); expect(f.value("SpatialDevGrowth")).toBeUndefined();
    await f.compute(); f.daemon.commitReady(f.world.time.tick);
    expect(f.value("SpatialDevMoisture")).toBe(.5); expect(f.value("SpatialDevGrowth")).toBe(.125);
    await f.compute(); f.daemon.commitReady(f.world.time.tick);
    expect(f.value("SpatialDevMoisture")).toBe(.75); expect(f.value("SpatialDevGrowth")).toBe(.375);
    expect(f.value("SpatialDevGrowth", f.resident)).toBeUndefined();
    expect(f.value("SpatialDevGrowth", f.outsider)).toBeUndefined(); expect(f.value("SpatialDevMoisture", f.outsider)).toBeUndefined();
    expect(Mind.arousal[f.resident]).toBe(arousal); expect(Position.x[f.resident]).toBe(x);
    expect(getRoomForEntity(f.world, f.plant)).toBe(f.garden); expect(ObjectState.current[f.plant]).toBe(state);
    expect(f.daemon.getStatus().admissionBudget).toEqual({ limit: 8, used: 2, remaining: 6 });
    expect(f.daemon.getStatus().runtime.every(row => row.changedCommits! > 0 && row.failures === 0)).toBe(true);
  } finally { await f.close(); }
});

test("managed cadence is ticks but physical integration uses actual accumulated milliseconds", async () => {
  const f = await setup();
  try {
    await f.activate("moisture"); await f.compute(1, 100); f.daemon.commitReady(f.world.time.tick);
    expect(f.value("SpatialDevMoisture")).toBe(.025);
    for (let index = 0; index < 9; index++) { await f.compute(1, 100); f.daemon.commitReady(f.world.time.tick); }
    expect(f.value("SpatialDevMoisture")).toBe(.025);
    await f.compute(1, 100); f.daemon.commitReady(f.world.time.tick);
    expect(f.value("SpatialDevMoisture")).toBe(.275);
    expect(f.daemon.getStatus().runtime[0].commits).toBe(2);
  } finally { await f.close(); }
});

test("native movement and source stop invalidate computed batches rather than publishing stale physical history", async () => {
  const f = await setup();
  try {
    await f.activate("moisture"); await f.compute(); f.daemon.commitReady(f.world.time.tick);
    await f.compute(); setLocatedIn(f.world, f.plant, f.home); f.daemon.commitReady(f.world.time.tick);
    expect(f.value("SpatialDevMoisture")).toBe(.25); expect(f.daemon.getStatus().runtime[0].staleResults).toBe(1);
    await f.compute(); stopCommittedEvents(f.world); f.daemon.commitReady(f.world.time.tick);
    expect(f.value("SpatialDevMoisture")).toBe(.25); expect(f.inputs.permits(f.plant)).toBe(false);
  } finally { await f.close(); }
});
