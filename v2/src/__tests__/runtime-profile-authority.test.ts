import { jest } from "@jest/globals";
import type { SimulationConfig } from "../index";
const ai = await import("ai"), generate = jest.fn<(...args: any[]) => Promise<any>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createSimulation } = await import("../index");
const { createArgosWorld } = await import("../ecs/world");
const { initializePrefabs, createGodAgentEntity } = await import("../ecs/prefabs");
const { createSystemRegistry } = await import("../ecs/dynamic-systems");
const { serializeWorld } = await import("../persistence/world-persistence");
const { setWorldSpecification } = await import("../world/world-specification");
const { createSpiritRegistry, createSpirit } = await import("../spirits/spirit-registry");
const { getSpiritSystemState } = await import("../spirits/spirit-system");
const { runSpiritCognition } = await import("../spirits/spirit-cognition");
const { installSpiritPhysicalEffectProfile, captureSpiritPhysicalEffects } = await import("../spirits/physical-effect-capabilities");
const { getRoomPopulationStatus, getPendingRoomRequests, resetStewardState, runStewardCycle } = await import("../spirits/steward-spirit");
const { drainPendingStimuli } = await import("../cognition/stimulus-queue");
const { Mind } = await import("../ecs/components");
const { query } = await import("bitecs");
const { Agent } = await import("../ecs/components");

const spec = () => ({ version: 1 as const,
  setting: { name: "Harbor", genre: "mystery", premise: "Neighbors share a coastal home.", tone: "uneasy warmth" },
  story: { style: "patient discovery" } });
const simulations: Awaited<ReturnType<typeof createSimulation>>[] = [];
async function create(options: Partial<SimulationConfig> = {}) {
  const simulation = await createSimulation({ name: "Profile fixture", enableAI: false, enableNarrativeEngine: false,
    worldSpecification: spec(), ...options });
  simulations.push(simulation); return simulation;
}
let oldKey: string | undefined;
beforeEach(() => {
  oldKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY; process.env.GOOGLE_GENERATIVE_AI_API_KEY = "offline-fixture";
  generate.mockReset(); resetStewardState(); drainPendingStimuli();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("Offline runtime profile authority tests"));
});
afterEach(async () => {
  for (const simulation of simulations.splice(0)) { simulation.stop(); await simulation.drainPendingOperations(1000); }
  expect(fetch).not.toHaveBeenCalled(); resetStewardState(); drainPendingStimuli(); jest.restoreAllMocks();
  if (oldKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY; else process.env.GOOGLE_GENERATIVE_AI_API_KEY = oldKey;
});

test.each(["modify_mood", "inject_stimulus"])("embodied defaults reject Narrator %s without a native host grant", async type => {
  const simulation = await create({ enableAI: true, rooms: [{ name: "Hall" }],
    agents: [{ name: "Ada", role: "neighbor", startRoom: "Hall" }] });
  const world = simulation.world, registry = getSpiritSystemState(world)!.registry;
  const narrator = registry.spirits.get(registry.byName.get("The Narrator")!)!;
  const actor = [...query(world, [Agent])][0], arousal = Mind.arousal[actor];
  drainPendingStimuli();
  generate.mockImplementation(async ({ prompt }) => {
    const records = JSON.parse(prompt.match(/ISSUED_INTERVENTION_EVIDENCE:\n([^\n]+)/)![1]).records;
    const subject = type === "modify_mood" ? "Ada" : "Hall";
    return { text: JSON.stringify({ intervention: { needed: true, type, targetType: type === "modify_mood" ? "agent" : "room",
      target: subject, content: type === "modify_mood" ? "arousal 0.9" : "An invented crash fills the hall.",
      evidenceIds: records.filter((row: any) => row.subject === subject).slice(0, 1).map((row: any) => row.id), reason: "Attempted ungranted effect" } }) };
  });
  const result = await runSpiritCognition(narrator, world, simulation.god.registry, registry);
  expect(result.interventions[0].result).toBe("rejected_physical_effect_policy"); expect(Mind.arousal[actor]).toBe(arousal);
  expect(drainPendingStimuli()).toEqual([]);
  expect(captureSpiritPhysicalEffects(world, narrator, registry).legacyAllowed()).toBe(false);
});

test("legacy callers do not acquire a new physical-effect restriction", async () => {
  const simulation = await create({ worldSpecification: undefined }), world = simulation.world, registry = createSpiritRegistry(world);
  const narrator = createSpirit(registry, { name: "Legacy narrator", domain: "narrative", rank: "archangel", model: "flash",
    systemPrompt: "Existing host configuration", observationInterval: 1000 });
  const captured = captureSpiritPhysicalEffects(world, narrator, registry);
  expect(captured.restricted).toBe(false); expect(captured.legacyAllowed()).toBe(true);
});

test("a later native host profile can replace the empty restriction and is not overwritten on start", async () => {
  const simulation = await create(), world = simulation.world, registry = createSpiritRegistry(world);
  const narrator = createSpirit(registry, { name: "Host narrator", domain: "narrative", rank: "archangel", model: "flash",
    systemPrompt: "Use only the host operation", observationInterval: 1000 });
  const profile = installSpiritPhysicalEffectProfile(world);
  profile.register(registry, narrator, () => ({ description: "ONE_NATIVE_HOST_GRANT", current: () => true,
    execute: () => ({ status: "unchanged", detail: "Fixture operation does not mutate" }) }));
  await simulation.start();
  const captured = captureSpiritPhysicalEffects(world, narrator, registry);
  expect(captured.description).toBe("ONE_NATIVE_HOST_GRANT"); expect(captured.legacyAllowed()).toBe(false);
  simulation.stop(); await simulation.start();
  expect(captureSpiritPhysicalEffects(world, narrator, registry).description).toBeUndefined();
  expect(captureSpiritPhysicalEffects(world, narrator, registry).legacyAllowed()).toBe(false);
});

test.each([false, true])("restore respects saved false modes unless host explicitly selects profile: %s", async explicit => {
  const source = createArgosWorld("Saved home"); initializePrefabs(source); setWorldSpecification(source, spec());
  createGodAgentEntity(source, { name: "God", worldName: "Saved home", narrative: "A home" });
  source.meta.timedSpeech = false; source.meta.timedActions = false; source.meta.narrativeMind = false;
  const saved = serializeWorld(source, createSystemRegistry());
  const simulation = await create({ worldSpecification: undefined, restoreSnapshot: saved,
    ...(explicit ? { runtimeProfile: "embodied-v1" } : {}) });
  expect(simulation.world.meta.timedSpeech).toBe(explicit);
  expect(simulation.world.meta.timedActions).toBe(explicit);
  expect(simulation.world.meta.narrativeMind).toBe(explicit);
});

test("room type does not override embodied default and explicit furnishing stays world-scoped", async () => {
  const ordinary = await create({ enableAI: true, rooms: [{ name: "Hall", roomType: "general" }] });
  expect(getRoomPopulationStatus(ordinary.world)).toEqual([]); expect(getPendingRoomRequests()).toEqual([]);
  const authored = await create({ enableAI: true, rooms: [{ name: "Hall", roomType: "general", autoPopulate: true }] });
  expect(getRoomPopulationStatus(authored.world)).toHaveLength(1);
  expect(getPendingRoomRequests()[0].observationScopeId).toBeTruthy();
  expect(getRoomPopulationStatus(ordinary.world)).toEqual([]);
  await runStewardCycle(ordinary.world, getSpiritSystemState(ordinary.world)!.registry);
  expect(generate).not.toHaveBeenCalled(); expect(getRoomPopulationStatus(authored.world)).toHaveLength(1);
});
