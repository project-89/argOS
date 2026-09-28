import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { addComponent, addEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs } from "../../ecs/prefabs";
import { GodAgent } from "../../ecs/components";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { serializeWorld, type SerializedWorld } from "../world-persistence";

const values = { worldName: "Living archive", narrative: "An unfinished evening", tick: 42,
  narrativeGoals: '["Keep the river navigable"]', tension: .4, lastObservation: 12345,
  interventionCount: 3, observationInterval: 5000, stagnationScore: .2 };
function fixture() {
  const world = createArgosWorld("Monitoring source"); initializePrefabs(world);
  const eid = addEntity(world); addComponent(world, eid, GodAgent);
  for (const [field, value] of Object.entries(values)) (GodAgent as any)[field][eid] = value;
  return { eid, saved: JSON.parse(JSON.stringify(serializeWorld(world, createSystemRegistry()))) as SerializedWorld };
}
function restore(saved: SerializedWorld) {
  const output = execFileSync(process.execPath, ["--import", "tsx", resolve("src/persistence/__tests__/fixtures/social-memory-restore.ts")], {
    input: JSON.stringify({ saved, poison: true }), encoding: "utf8", timeout: 20_000, maxBuffer: 2_000_000,
  });
  return JSON.parse(output.split("\n").find(line => line.startsWith("GOD_RESTORE_RESULT "))!.slice("GOD_RESTORE_RESULT ".length))[0];
}
test("God's durable monitoring context survives serialization and a fresh-process remapped restore", () => {
  const f = fixture();
  expect(f.saved.entities.find(e => e.id === f.eid)!.components.GodAgent).toEqual(values);
  const restored = restore(f.saved);
  expect(restored.eid).not.toBe(f.eid);
  expect(restored.fields).toEqual(values);
});
test("old God snapshots default omitted monitoring fields instead of inheriting retired world state", () => {
  const f = fixture();
  f.saved.entities.find(e => e.id === f.eid)!.components.GodAgent = {
    worldName: values.worldName, narrative: values.narrative, tick: values.tick,
  };
  expect(restore(f.saved).fields).toEqual({ worldName: values.worldName, narrative: values.narrative, tick: values.tick,
    narrativeGoals: "[]", tension: 0, lastObservation: 0, interventionCount: 0, observationInterval: 30000, stagnationScore: 0 });
});
