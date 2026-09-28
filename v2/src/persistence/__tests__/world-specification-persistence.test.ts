import { jest } from "@jest/globals";
import { addComponent, addEntity, getAllEntities, query } from "bitecs";
import { Agent, GodAgent, Name, NarrativeEntry } from "../../ecs/components";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { initializeRegistry, listDynamic } from "../../ecs/component-registry";
import { getIdentityAnchors } from "../../cognition/narrative-memory";
import { buildAgentContext } from "../../cognition/agent-mind";
import { getCommittedEvents } from "../../runtime/committed-events";
import { configureWorldConstructionBudget, snapshotWorldConstructionBudget } from "../../runtime/world-construction-budget";
import { getRuntimePackageRequirements } from "../../runtime/package-requirements";
import { getCodingDaemon } from "../../engineering/coding-daemon";
import { isWorldOfficeToolAllowed, setWorldOfficeToolPolicy } from "../../office-tools/tool-registry";
import { worldSchema } from "../../world/schema";
import { getWorldSpecification, parseWorldSpecification, setWorldSpecification } from "../../world/world-specification";
import { deserializeWorld, serializeWorld, type SerializedWorld } from "../world-persistence";
import { validateSimulationSnapshot } from "../simulation-snapshot";

const specification = () => parseWorldSpecification({ version: 1,
  setting: { name: "The Lantern House", genre: "domestic mystery", premise: "A shared house remembers an unfinished promise.", tone: "Warm but uncertain" },
  story: { style: "Character-led discovery", tensions: ["Privacy and mutual care"] },
  inhabitants: [{ name: "Ada", role: "resident", description: "A resident in a blue coat.", systemPrompt: "Decide for yourself.", startRoom: "Kitchen",
    past: { background: "PRIVATE_PAST: I grew up above a repair shop.", drives: ["Keep my promises"], memories: [
      { period: "Childhood", recollection: "PRIVATE_MEMORY: My sister stayed beside me during a storm.", emotionalTone: "Gratitude", importance: .8,
        selfBelief: "I try to stay when needed", meaning: "Presence matters", cues: ["storm", "sister"], provenance: "authored-history" },
    ] } }],
  opportunities: ["Neighbors can exchange help"], discovery: ["Old letters may challenge assumptions"], constraints: ["No predetermined character choices"],
});
function snapshot(spec = specification()): SerializedWorld {
  const world = createArgosWorld("Authoring source"); initializeRegistry(world);
  const god = addEntity(world);
  addComponent(world, god, GodAgent); GodAgent.worldName[god] = "Authoring source";
  addComponent(world, god, Name); Name.value[god] = "Host God";
  setWorldSpecification(world, spec);
  return JSON.parse(JSON.stringify(serializeWorld(world, createSystemRegistry())));
}
beforeEach(() => {
  jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("World specification persistence is offline"));
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test("authored specification including private past round-trips as detached metadata, without creating its inhabitants", () => {
  const expected = specification(), saved = snapshot(expected), world = createArgosWorld("Restored metadata"), registry = createSystemRegistry();
  expect(saved.worldSpecification).toEqual(expected);
  expect(validateSimulationSnapshot(saved)).toBe(saved.entities.find(e => e.components.GodAgent)!.id);
  const restored = deserializeWorld(world, registry, saved);
  expect(getWorldSpecification(world)).toEqual(expected);
  expect(restored.oldToNewId.size).toBe(saved.entities.length);
  expect([...getAllEntities(world)]).toHaveLength(saved.entities.length);
  expect([...query(world, [Agent])]).toEqual([]); expect([...query(world, [NarrativeEntry])]).toEqual([]);
  expect(registry.systems.size).toBe(0); expect(getCommittedEvents(world).events).toEqual([]);
  const read = getWorldSpecification(world)!; read.inhabitants[0].past!.memories[0].recollection = "Read mutation";
  saved.worldSpecification!.setting.premise = "Snapshot input mutation";
  const exported = serializeWorld(world, registry); exported.worldSpecification!.discovery.push("Export mutation");
  expect(getWorldSpecification(world)).toEqual(expected);
  expect(serializeWorld(world, registry).worldSpecification).toEqual(expected);
});

test("optional authored lists default during restore without authoring runtime entities", () => {
  const saved = snapshot();
  (saved as any).worldSpecification = { version: 1, setting: specification().setting, story: { style: "Open-ended lives" } };
  expect(() => validateSimulationSnapshot(saved)).not.toThrow();
  const next = createArgosWorld("Minimal brief"); deserializeWorld(next, createSystemRegistry(), saved);
  expect(getWorldSpecification(next)).toMatchObject({ inhabitants: [], opportunities: [], discovery: [], constraints: [], story: { tensions: [] } });
  expect([...query(next, [Agent])]).toEqual([]);
});

test("existing saved private character history restores once and is not reseeded from specification", () => {
  const world = createArgosWorld("Private history source"); initializePrefabs(world);
  const spec = specification(); setWorldSpecification(world, spec);
  const room = createRoomEntity(world, { name: "Kitchen" });
  const actor = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "Choose", roomId: room, past: spec.inhabitants[0].past });
  const peer = createAgentEntity(world, { name: "Lin", role: "neighbor", systemPrompt: "Choose", roomId: room });
  const anchors = getIdentityAnchors(world, actor), saved = JSON.parse(JSON.stringify(serializeWorld(world, createSystemRegistry())));
  const next = createArgosWorld("Restored private history"); initializePrefabs(next);
  for (let i = 0; i < 20; i++) addEntity(next);
  const { oldToNewId } = deserializeWorld(next, createSystemRegistry(), saved);
  expect(oldToNewId.get(actor)).not.toBe(actor);
  expect([...query(next, [Agent])]).toHaveLength(2);
  expect(getIdentityAnchors(next, oldToNewId.get(actor)!)).toEqual(anchors);
  expect(getIdentityAnchors(next, oldToNewId.get(peer)!)).toEqual([]);
  expect(buildAgentContext(next, oldToNewId.get(peer)!)).not.toContain("PRIVATE_");
  expect(getCommittedEvents(next).events).toEqual([]);
  expect(getWorldSpecification(next)).toEqual(spec);
});

test("legacy snapshots without a specification neither invent one nor clear an existing host specification", () => {
  const saved = snapshot(); delete saved.worldSpecification;
  expect(() => validateSimulationSnapshot(saved)).not.toThrow();
  const blank = createArgosWorld("Legacy blank"); deserializeWorld(blank, createSystemRegistry(), saved);
  expect(getWorldSpecification(blank)).toBeUndefined();
  expect(serializeWorld(blank, createSystemRegistry()).worldSpecification).toBeUndefined();
  const authored = createArgosWorld("Legacy with host context"), spec = specification(); setWorldSpecification(authored, spec);
  deserializeWorld(authored, createSystemRegistry(), saved);
  expect(getWorldSpecification(authored)).toEqual(spec);
});

test.each(["null", "version", "codingDaemons", "authority", "nested runtime", "inhabitant command", "private-past authority", "malformed past"])(
  "invalid specification %s fails at envelope and direct restore before any mutation", mode => {
    const saved = snapshot(), invalid: any = specification();
    if (mode === "version") invalid.version = 2;
    if (mode === "codingDaemons") invalid.codingDaemons = { enabled: true };
    if (mode === "authority") invalid.authority = { hostOfficeTools: true };
    if (mode === "nested runtime") invalid.setting.runtime = { aiEnabled: true };
    if (mode === "inhabitant command") invalid.inhabitants[0].execute = "force a goal";
    if (mode === "private-past authority") invalid.inhabitants[0].past.authority = "operator";
    if (mode === "malformed past") invalid.inhabitants[0].past.memories[0].importance = 100;
    (saved as any).worldSpecification = mode === "null" ? null : invalid;
    expect(() => validateSimulationSnapshot(saved)).toThrow();
    // These extra payloads would visibly mutate other registries if validation
    // were placed after any of the current restoration work.
    saved.runtimePackages = ["must-not-be-imported"];
    saved.constructionBudget = { limit: 9, admitted: 0, byKind: { agent: 0, room: 0, object: 0, stimulus_source: 0, entity: 0 } };
    const next = createArgosWorld("Untouched destination"), registry = createSystemRegistry();
    configureWorldConstructionBudget(next, 9);
    const before = { ids: [...getAllEntities(next)], meta: structuredClone(next.meta), time: structuredClone(next.time),
      budget: snapshotWorldConstructionBudget(next), schema: structuredClone(worldSchema.toJSON()), definitions: structuredClone(listDynamic()) };
    expect(() => deserializeWorld(next, registry, saved)).toThrow();
    expect([...getAllEntities(next)]).toEqual(before.ids); expect(next.meta).toEqual(before.meta); expect(next.time).toEqual(before.time);
    expect(snapshotWorldConstructionBudget(next)).toEqual(before.budget); expect(worldSchema.toJSON()).toEqual(before.schema);
    expect(listDynamic()).toEqual(before.definitions); expect(getRuntimePackageRequirements(next)).toEqual([]);
    expect(getWorldSpecification(next)).toBeUndefined(); expect(registry.systems.size).toBe(0);
  });

test("conflicting immutable destination specification rejects before construction or ECS mutation", () => {
  const saved = snapshot(), next = createArgosWorld("Existing authoring scope"), registry = createSystemRegistry();
  saved.worldSpecification = specification();
  const original = specification(); original.setting.premise = "A different authored world."; setWorldSpecification(next, original);
  const before = [...getAllEntities(next)], meta = structuredClone(next.meta), budget = snapshotWorldConstructionBudget(next);
  saved.runtimePackages = ["must-not-be-imported"];
  expect(() => deserializeWorld(next, registry, saved)).toThrow();
  expect([...getAllEntities(next)]).toEqual(before); expect(next.meta).toEqual(meta);
  expect(snapshotWorldConstructionBudget(next)).toEqual(budget); expect(getRuntimePackageRequirements(next)).toEqual([]);
  expect(getWorldSpecification(next)).toEqual(original);
});

test("identical preinstalled specification is allowed, independently scoped to each world", () => {
  const saved = snapshot(), first = createArgosWorld("Matching host"), second = createArgosWorld("Unrelated host");
  setWorldSpecification(first, specification());
  const different = specification(); different.setting.name = "Another House"; setWorldSpecification(second, different);
  expect(() => deserializeWorld(first, createSystemRegistry(), saved)).not.toThrow();
  expect(getWorldSpecification(first)).toEqual(saved.worldSpecification);
  expect(getWorldSpecification(second)).toEqual(different);
});

test("authored prose and serialized specification do not transfer AI, coding or office-tool authority", () => {
  const source = createArgosWorld("Authorized source"), spec = specification();
  initializeRegistry(source);
  source.meta.aiEnabled = true; setWorldOfficeToolPolicy(source, true);
  spec.constraints.push("Residents may ask the architect to improve their world."); setWorldSpecification(source, spec);
  const saved = JSON.parse(JSON.stringify(serializeWorld(source, createSystemRegistry())));
  const next = createArgosWorld("Host controls restore permissions"), registry = createSystemRegistry();
  setWorldOfficeToolPolicy(next, ["read_notice"]);
  deserializeWorld(next, registry, saved);
  expect(getWorldSpecification(next)).toEqual(spec); expect(next.meta.aiEnabled).toBe(false);
  expect(getCodingDaemon(next)).toBeUndefined(); expect(registry.systems.size).toBe(0);
  expect(isWorldOfficeToolAllowed(next, "read_notice")).toBe(true);
  expect(isWorldOfficeToolAllowed(next, "run_command")).toBe(false);
  expect(getRuntimePackageRequirements(next)).toEqual([]);
});
