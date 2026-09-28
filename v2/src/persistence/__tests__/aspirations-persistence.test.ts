import { jest } from "@jest/globals";
import { addComponent, addEntity, hasComponent, removeComponent, removeEntity } from "bitecs";
import { spawnSync } from "node:child_process";
import { Agent, AuthoredAspirations, Name, Removed, WorkingMemoryIdentity } from "../../ecs/components";
import { createArgosWorld, type World } from "../../ecs/world";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { clearAspirations, getAspirations, getCoreDrives, getLongTermAspirations, resetGoalLearning, setAspirations, setCoreDrives } from "../../cognition/goal-learning";
import { PRIVATE_MANAGED_COMPONENTS, PROTECTED_MANAGED_COMPONENTS } from "../../engineering/contracts";
import { getCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { deserializeWorld, serializeWorld, type SerializedWorld } from "../world-persistence";

function actor(world: World, wants: string[]) {
  const eid = addEntity(world);
  addComponent(world, eid, Agent); addComponent(world, eid, Name);
  Name.value[eid] = "Resident"; Agent.role[eid] = "blacksmith";
  Agent.systemPrompt[eid] = "An ordinary resident with a private past.";
  setAspirations(world, eid, wants);
  return eid;
}
function save(world: World): SerializedWorld {
  return JSON.parse(JSON.stringify(serializeWorld(world, createSystemRegistry())));
}
function restore(data: SerializedWorld) {
  const world = createArgosWorld("restored");
  for (let i = 0; i < 12; i++) addEntity(world);
  return { world, ...deserializeWorld(world, createSystemRegistry(), data) };
}

beforeEach(() => { jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Aspirations persistence stays offline")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test("authored wants survive remapped IDs and same-name actors without mutable aliases", () => {
  const world = createArgosWorld("authored");
  const wants = ["Repair the family boat", "Visit my sister"];
  const first = actor(world, wants), second = actor(world, ["Learn gardening"]);
  wants.push("External mutation must not become a drive");
  const copy = getAspirations(world, first); copy.push("Read alias mutation");
  const restored = restore(save(world));
  const firstRestored = restored.oldToNewId.get(first)!;
  expect(firstRestored).not.toBe(first);
  expect(getAspirations(restored.world, firstRestored)).toEqual(["Repair the family boat", "Visit my sister"]);
  expect(getAspirations(restored.world, restored.oldToNewId.get(second)!)).toEqual(["Learn gardening"]);
  resetGoalLearning();
  expect(getAspirations(restored.world, firstRestored)).toEqual(["Repair the family boat", "Visit my sister"]);
});

test("fresh process restores authored aspirations from the snapshot alone", () => {
  const world = createArgosWorld("source");
  const eid = actor(world, ["Keep promises to Ada", "Restore my childhood home"]);
  const saved = save(world);
  const script = `
    let networkCalls = 0;
    globalThis.fetch = async () => { networkCalls++; throw new Error('Offline restore'); };
    const { readFileSync } = await import('node:fs');
    const { addEntity } = await import('bitecs');
    const { createArgosWorld } = await import('./src/ecs/world.ts');
    const { createSystemRegistry } = await import('./src/ecs/dynamic-systems.ts');
    const { deserializeWorld } = await import('./src/persistence/world-persistence.ts');
    const { getAspirations } = await import('./src/cognition/goal-learning.ts');
    const data = JSON.parse(readFileSync(0, 'utf8'));
    const world = createArgosWorld('fresh-process');
    for (let i = 0; i < 20; i++) addEntity(world);
    const { oldToNewId } = deserializeWorld(world, createSystemRegistry(), data);
    const restoredId = oldToNewId.get(${eid});
    console.log('ASPIRATION_RESULT:' + JSON.stringify({ wants: getAspirations(world, restoredId), restoredId, networkCalls }));
  `;
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd: process.cwd(), input: JSON.stringify(saved), encoding: "utf8", timeout: 25_000,
    env: { ...process.env, ARGOS_PROCESS_WORLD_HOST: "1" },
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stderr).not.toContain("Offline restore");
  const line = result.stdout.split("\n").find(value => value.startsWith("ASPIRATION_RESULT:"));
  expect(line).toBeDefined();
  expect(JSON.parse(line!.slice("ASPIRATION_RESULT:".length))).toEqual({
    wants: ["Keep promises to Ada", "Restore my childhood home"], restoredId: 21, networkCalls: 0,
  });
});

test("old saves missing authored drives stay empty rather than inventing role-derived history", () => {
  const world = createArgosWorld("legacy"); const eid = actor(world, ["Private promise"]);
  const saved = save(world); delete saved.entities.find(entity => entity.id === eid)!.components.AuthoredAspirations;
  const restored = restore(saved), next = restored.oldToNewId.get(eid)!;
  expect(getAspirations(restored.world, next)).toEqual([]);
  expect(hasComponent(restored.world, next, AuthoredAspirations)).toBe(false);
  expect(getCommittedEvents(restored.world).events).toHaveLength(0);
});

test.each(["missing-identity", "foreign-owner", "malformed", "non-strings"])("invalid saved ownership/content fails closed: %s", kind => {
  const world = createArgosWorld("invalid"); const eid = actor(world, ["Private promise"]);
  const saved = save(world), components = saved.entities.find(entity => entity.id === eid)!.components;
  if (kind === "missing-identity") delete components.WorkingMemoryIdentity;
  if (kind === "foreign-owner") components.AuthoredAspirations.ownerKey = "another-owner";
  if (kind === "malformed") components.AuthoredAspirations.itemsJson = "{";
  if (kind === "non-strings") components.AuthoredAspirations.itemsJson = '["drive", 42]';
  const restored = restore(saved), next = restored.oldToNewId.get(eid)!;
  expect(getAspirations(restored.world, next)).toEqual([]);
  expect(save(restored.world).entities.find(entity => entity.id === next)!.components.AuthoredAspirations).toBeUndefined();
});

test.each([false, true])("overlapping world IDs fail closed, even with cloned identity (%s)", cloneIdentity => {
  const a = createArgosWorld("A"), first = actor(a, ["A's private drive"]);
  const originalIdentity = WorkingMemoryIdentity.id[first];
  const b = createArgosWorld("B");
  const second = addEntity(b); expect(second).toBe(first);
  addComponent(b, second, Agent); addComponent(b, second, Name); Name.value[second] = "Resident";
  if (cloneIdentity) {
    addComponent(b, second, WorkingMemoryIdentity); WorkingMemoryIdentity.id[second] = originalIdentity;
  }
  setAspirations(b, second, ["B's private drive"]);
  expect(getAspirations(a, first)).toEqual([]);
  expect(getAspirations(b, second)).toEqual(["B's private drive"]);
  expect(getAspirations(a, first)).toEqual([]);
  setAspirations(a, first, ["A must not overwrite B"]); clearAspirations(a, first);
  expect(getAspirations(b, second)).toEqual(["B's private drive"]);
  expect(save(a).entities.find(entity => entity.id === first)!.components.AuthoredAspirations).toBeUndefined();
  expect(JSON.parse(save(b).entities.find(entity => entity.id === second)!.components.AuthoredAspirations.itemsJson))
    .toEqual({ version: 1, drives: [], aspirations: ["B's private drive"] });
});

test("updating ambitions preserves core drives across save/remap without creating goals or receipts", () => {
  const world = createArgosWorld("motives"), eid = actor(world, ["Build a workshop"]);
  setCoreDrives(world, eid, ["Keep promises to people I care about"]);
  setAspirations(world, eid, ["Learn to restore boats"]);
  expect(getAspirations(world, eid)).toEqual(["Keep promises to people I care about", "Learn to restore boats"]);
  const restored = restore(save(world)), next = restored.oldToNewId.get(eid)!;
  expect(getCoreDrives(restored.world, next)).toEqual(["Keep promises to people I care about"]);
  expect(getLongTermAspirations(restored.world, next)).toEqual(["Learn to restore boats"]);
  expect(getCommittedEvents(restored.world).events).toHaveLength(0);
});

test("legacy string-array snapshots remain ambitions without inventing separate core drives", () => {
  const world = createArgosWorld("old motives"), eid = actor(world, []), data = save(world);
  data.entities.find(entity => entity.id === eid)!.components.AuthoredAspirations.itemsJson = '["Visit my sister"]';
  const restored = restore(data), next = restored.oldToNewId.get(eid)!;
  expect(getAspirations(restored.world, next)).toEqual(["Visit my sister"]);
  expect(getCoreDrives(restored.world, next)).toEqual([]);
});

test("deletion, component removal and recycled IDs never inherit old drives", () => {
  const world = createArgosWorld("recycled"), first = actor(world, ["Old resident's drive"]);
  removeEntity(world, first); expect(getAspirations(world, first)).toEqual([]);
  const next = actor(world, ["New resident's drive"]); expect(next).toBe(first);
  expect(getAspirations(world, next)).toEqual(["New resident's drive"]);
  addComponent(world, next, Removed); expect(getAspirations(world, next)).toEqual([]);
  removeComponent(world, next, Removed);
  clearAspirations(world, next); expect(getAspirations(world, next)).toEqual([]);
  expect(hasComponent(world, next, AuthoredAspirations)).toBe(false);
});

test("stopped worlds cannot receive late asynchronous aspirations and generated code cannot read or write them", () => {
  const world = createArgosWorld("stopped"), eid = actor(world, ["Original drive"]);
  stopCommittedEvents(world);
  setAspirations(world, eid, ["Late model response"]);
  expect(getAspirations(world, eid)).toEqual(["Original drive"]);
  expect(PRIVATE_MANAGED_COMPONENTS.has("AuthoredAspirations")).toBe(true);
  expect(PROTECTED_MANAGED_COMPONENTS.has("AuthoredAspirations")).toBe(true);
});
