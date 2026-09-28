import { jest } from "@jest/globals";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { addComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createRoomEntity, createAgentEntity, createObjectEntity } from "../../ecs/prefabs";
import { Description, Traits } from "../../ecs/components";
import { setLocatedIn } from "../../ecs/location";
import { getComponent, attachToEntity } from "../../ecs/component-registry";
import { createSystemRegistry, runSystems } from "../../ecs/dynamic-systems";
import { generateStimuliForAgent, getAgentSensoryFingerprint } from "../../cognition/sensory-system";
import { CodingDaemon } from "../coding-daemon";

test("only committed managed public appearance changes enter local sight and its cache", async () => {
  const fetch = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No model in mechanic perception test"));
  const world = createArgosWorld("Perceptible growth"); world.meta.aiEnabled = false; initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Cellar" }), remote = createRoomEntity(world, { name: "Garden" });
  const actor = createAgentEntity(world, { name: "Mara", role: "resident", systemPrompt: "Resident", roomId: room });
  const distant = createAgentEntity(world, { name: "Ivo", role: "resident", systemPrompt: "Resident", roomId: remote });
  const floor = createObjectEntity(world, { name: "Floor gauge", description: "The gauge reads dry." }); setLocatedIn(world, floor, room);
  const concealed = createObjectEntity(world, { name: "PRIVATE_GAUGE", description: "PRIVATE_DRY" }); setLocatedIn(world, concealed, room);
  addComponent(world, concealed, Traits); Traits.active[concealed] = '["hidden"]';
  const directory = await mkdtemp(path.join(os.tmpdir(), "argos-perceptible-mechanic-"));
  const registry = createSystemRegistry();
  const daemon = new CodingDaemon(world, registry, { directory }, async ({ directory: output }) => {
    await mkdir(path.join(output, "components"), { recursive: true }); await mkdir(path.join(output, "systems"), { recursive: true });
    await writeFile(path.join(output, "components/WaterGauge.json"), JSON.stringify({ name: "WaterGauge", description: "Physical water depth", fields: { depth: { type: "number", default: 0 } } }));
    await writeFile(path.join(output, "systems/RisingWater.ts"), 'export function run(ctx:any){for(const id of ctx.query("WaterGauge","Description")){const depth=Math.min(2,ctx.get(id,"WaterGauge","depth")+1);ctx.set(id,"WaterGauge","depth",depth);ctx.set(id,"Description","value",`The gauge reads ${depth} cm of water.`);}}');
    const test = (start: number, expected: number) => ({ name: `depth ${start}`, system: "RisingWater", entities: [{ id: 1, components: { WaterGauge: { depth: start }, Description: { value: "dry" } } }], ticks: 1, deltaMs: 1000, expect: [{ entity: 1, component: "WaterGauge", field: "depth", equals: expected }, { entity: 1, component: "Description", field: "value", equals: `The gauge reads ${expected} cm of water.` }] });
    await writeFile(path.join(output, "release.json"), JSON.stringify({ version: 1, components: ["components/WaterGauge.json"], systems: [{ name: "RisingWater", description: "Water and its visible gauge", file: "systems/RisingWater.ts", frequency: 1, reads: ["WaterGauge", "Description"], writes: ["WaterGauge.depth", "Description.value"] }], tests: [test(0, 1), test(2, 2)] }));
  });
  const perception = (eid: number) => JSON.stringify(generateStimuliForAgent(world, eid, []));
  try {
    await daemon.initialize();
    const job = daemon.enqueue({ source: "fixture architect", instruction: "Make rising water visible through its physical gauge" });
    await daemon.pump(); daemon.commitReady(0);
    attachToEntity(world, floor, "WaterGauge", { depth: 0 }); attachToEntity(world, concealed, "WaterGauge", { depth: 0 });
    const initial = getAgentSensoryFingerprint(world, actor), remoteInitial = getAgentSensoryFingerprint(world, distant);
    expect(perception(actor)).toContain("The gauge reads dry.");
    expect(perception(actor)).not.toContain("PRIVATE_");
    runSystems(world, registry, 1, 1000); await daemon.settle();
    expect(getAgentSensoryFingerprint(world, actor)).toBe(initial);
    expect(perception(actor)).not.toContain("1 cm");
    daemon.commitReady(1);
    expect(getComponent("WaterGauge").depth[floor]).toBe(1);
    expect(Description.value[concealed]).toBe("The gauge reads 1 cm of water.");
    expect(getAgentSensoryFingerprint(world, actor)).not.toBe(initial);
    expect(perception(actor)).toContain("Floor gauge"); expect(perception(actor)).toContain("1 cm of water");
    expect(perception(actor)).not.toContain("PRIVATE_GAUGE");
    expect(getAgentSensoryFingerprint(world, distant)).toBe(remoteInitial);
    expect(perception(distant)).not.toContain("1 cm");
    const receipts = () => registry.events.filter(event => event.type === "managed_system_changed");
    expect(receipts()).toHaveLength(1);
    expect(receipts()[0].data).toMatchObject({ system: "RisingWater", jobId: job.id, release: registry.systems.get("RisingWater")!.managedRelease!.digest });
    // An intervention wins over the already-computed next worker result.
    runSystems(world, registry, 2, 1000); await daemon.settle();
    getComponent("WaterGauge").depth[floor] = 0; Description.value[floor] = "The gauge reads dry again.";
    daemon.commitReady(2);
    expect(perception(actor)).toContain("dry again"); expect(perception(actor)).not.toContain("2 cm");
    expect(receipts()).toHaveLength(1);
    expect(daemon.getStatus().runtime.find(system => system.name === "RisingWater")?.staleResults).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
  } finally { daemon.stop(); await daemon.flush(); fetch.mockRestore(); }
});
