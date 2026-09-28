import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hasComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { ObjectState, Description, StimulusSource } from "../../ecs/components";
import { getComponent, initializeRegistry } from "../../ecs/component-registry";
import { createSystemRegistry, registerSystem, runSystems } from "../../ecs/dynamic-systems";
import { getRoomForEntity } from "../../ecs/location";
import { worldSchema } from "../../world/schema";
import { executeAffordance } from "../../world/effect-executor";
import { materializePlaceBlueprint, getPlaceBuildStatus } from "../place-materialization";
import { CodingDaemon } from "../coding-daemon";
import type { AcceptanceTest } from "../contracts";

const fixture = (name: string, state: string, start: number, ticks: number, deltaMs: number, expected: number): AcceptanceTest => ({
  name, system: "ValveFlow", entities: [{ id: 1, components: { ObjectType: { typeId: "test_leaking_valve" }, ObjectState: { current: state }, CollectedWater: { amount: start } } }],
  ticks, deltaMs, expect: [{ entity: 1, component: "CollectedWater", field: "amount", equals: expected }],
});
const hostAcceptance = [fixture("host open valve adds two units per second", "open", 0, 2, 1000, 4),
  fixture("host fine timestep agrees", "open", 0, 4, 500, 4), fixture("host closing stops flow", "closed", 4, 3, 1000, 4),
  fixture("host capacity saturates", "open", 99, 2, 1000, 100)];

async function candidate(directory: string, rate: number) {
  await mkdir(path.join(directory, "components"), { recursive: true }); await mkdir(path.join(directory, "systems"), { recursive: true });
  await writeFile(path.join(directory, "components/CollectedWater.json"), JSON.stringify({ name: "CollectedWater", description: "Water emitted by the valve", fields: { amount: { type: "number", default: 0 } } }));
  await writeFile(path.join(directory, "systems/ValveFlow.ts"), `export function run(ctx:any):void {for(const id of ctx.query("ObjectType","ObjectState")){if(ctx.get(id,"ObjectType","typeId")!=="test_leaking_valve")continue;ctx.attach(id,"CollectedWater");if(ctx.get(id,"ObjectState","current")==="open")ctx.set(id,"CollectedWater","amount",Math.min(100,ctx.get(id,"CollectedWater","amount")+${rate}*ctx.deltaMs/1000));}}`);
  await writeFile(path.join(directory, "release.json"), JSON.stringify({ version: 1, components: ["components/CollectedWater.json"], systems: [{ name: "ValveFlow", description: "Integrate valve flow with elapsed simulation time", file: "systems/ValveFlow.ts", frequency: 1, reads: ["ObjectType", "ObjectState", "CollectedWater"], writes: ["CollectedWater.amount"] }],
    tests: [fixture("worker positive", "open", 0, 1, 1000, rate), fixture("worker boundary", "closed", 0, 1, 1000, 0)] }));
}

test("a validated new mechanic hot-loads, responds to a native physical action, and rejects a bad replacement", async () => {
  const world = createArgosWorld("Working valve proof"); initializeRegistry(world); const registry = createSystemRegistry();
  // Construction and actions must resolve the same registered physical type.
  const schema = worldSchema; schema.defineObjectType({ name: "test_leaking_valve", description: "Kitchen valve", traits: ["openable"], defaultState: "open",
    states: { open: { description: "Water runs from the open valve.", stimuli: [{ type: "sound", template: "Water splashes from the valve.", intensity: 0.5, radius: 10 }] }, closed: { description: "The valve is shut; the water has stopped." } } });
  const { roomEid:room } = materializePlaceBlueprint(world,{ name:"Valve workshop",description:"A keeper tends a leaking valve.",type:"room",components:[],
    requiredSystems:["ValveFlow"],requiredInteractions:[{actor:"keeper",target:"valve",affordance:"close"}],contents:[
    {id:"keeper",entity:{ name: "Keeper", description: "An inhabitant", type: "agent", components: [] }},
    {id:"valve",entity:{ name: "Sink valve", description: "Water runs from the open valve.", type: "object",
    components: [{ name: "ObjectType", values: { typeId: "test_leaking_valve", instanceName: "Sink valve" } }, { name: "ObjectState", values: { current: "open" } },
      { name: "Traits", values: { active: '["openable"]' } }, { name: "StimulusSource", values: { stimulusType: "auditory", template: "Water splashes.", interval: 1000 } }] }}] },undefined,[
        {id:"keeper",kind:"entity",entityType:"agent",description:"A person can operate the valve"},
        {id:"valve",kind:"entity",entityType:"object",objectType:"test_leaking_valve",description:"A physical valve"},
        {id:"close",kind:"interaction",actor:"keeper",target:"valve",affordance:"close",description:"The valve can be closed"},
        {id:"flow",kind:"system",name:"ValveFlow",description:"An actual elapsed-time flow mechanic"},
      ]);
  const initial=getPlaceBuildStatus(world,registry)[0];
  expect(initial).toMatchObject({phase:"constructed",readyNow:false,unmet:["system:ValveFlow"]});
  expect(initial.support).toMatchObject({status:"unavailable",unmet:[{id:"flow",reason:"system_unavailable"}]});
  const actor=initial.members.find(m=>m.id==="keeper")!.eid, valve=initial.members.find(m=>m.id==="valve")!.eid;
  expect(getRoomForEntity(world, valve)).toBe(room);
  const directory = await mkdtemp(path.join(os.tmpdir(), "argos-usable-mechanic-")); let rate = 2, release!: () => void;
  const entityRegistry = { byName: new Map([["Keeper", actor], ["Sink valve", valve]]), byId: new Map([[actor, "Keeper"], [valve, "Sink valve"]]) };
  const gate = new Promise<void>(resolve => { release = resolve; });
  const daemon = new CodingDaemon(world, registry, { directory }, async ({ directory }) => { await gate; await candidate(directory, rate); });
  await daemon.initialize(); let nativeTicks = 0;
  registerSystem(registry, { name: "NativeHeartbeat", description: "existing runtime", pseudocode: "", frequency: 0, active: true, lastRun: 0, compiledFn: () => { nativeTicks++; } });
  const step = async (tick: number, deltaMs = 1000) => { runSystems(world, registry, tick, deltaMs); await daemon.settle(); daemon.commitReady(tick); };
  try {
    const job = daemon.enqueue({ source: "operator fixture", instruction: "Water flows only while the physical valve is open", acceptance: hostAcceptance });
    const building = daemon.pump(); for (let i = 1; i <= 4; i++) await step(i);
    expect(nativeTicks).toBe(4); expect(getComponent("CollectedWater")).toBeUndefined();
    release(); await building; expect(daemon.getStatus().jobs.find(j => j.id === job.id)?.status).toBe("ready");
    daemon.commitReady(5); await step(5); expect(getComponent("CollectedWater").amount[valve]).toBe(2);
    expect(daemon.getStatus().jobs.find(j => j.id === job.id)?.status).toBe("active");
    expect(getPlaceBuildStatus(world,registry)[0].readyNow).toBe(true);
    expect(getPlaceBuildStatus(world,registry)[0].support.status).toBe("available");
    const action = executeAffordance("close", { world, worldSchema: schema, registry: entityRegistry, actorEid: actor, targetEid: valve });
    expect(action.success).toBe(true); expect(ObjectState.current[valve]).toBe("closed");
    expect(Description.value[valve]).toContain("water has stopped"); expect(hasComponent(world, valve, StimulusSource)).toBe(false);
    // Native close is idempotently available on an openable object. The
    // physical assertions above/below, not availability, prove the flow stops.
    expect(getPlaceBuildStatus(world,registry)[0].readyNow).toBe(true);
    await step(6); await step(7); expect(getComponent("CollectedWater").amount[valve]).toBe(2);
    expect(executeAffordance("open", { world, worldSchema: schema, registry: entityRegistry, actorEid: actor, targetEid: valve }).success).toBe(true);
    expect(hasComponent(world, valve, StimulusSource)).toBe(true); await step(8, 500); expect(getComponent("CollectedWater").amount[valve]).toBe(3);
    rate = 3; const bad = daemon.enqueue({ source: "operator fixture", instruction: "Deliberately wrong replacement to prove the host gate", acceptance: hostAcceptance });
    await daemon.pump(); expect(daemon.getStatus().jobs.find(j => j.id === bad.id)?.status).toBe("rejected");
    expect(getPlaceBuildStatus(world,registry)[0].readyNow).toBe(true);
    await step(9, 500); expect(getComponent("CollectedWater").amount[valve]).toBe(4);
    expect(nativeTicks).toBe(9);
  } finally { daemon.stop(); await daemon.flush(); }
});
