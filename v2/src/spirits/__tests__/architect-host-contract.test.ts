import { jest } from "@jest/globals";
const ai = await import("ai"), generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createAgentEntity, createRoomEntity } = await import("../../ecs/prefabs");
const { createSystemRegistry } = await import("../../ecs/dynamic-systems");
const { startCommittedEvents } = await import("../../runtime/committed-events");
const { createSpiritRegistry } = await import("../spirit-registry");
const { createDynamicSpirit, resetFactoryState } = await import("../spirit-factory");
const { gatherArchitectContext, getArchitectSpecificationPrompt, runArchitectCognition, validateObservedNeeds } = await import("../architect-spirit");
const { createIntentGoal } = await import("../../cognition/cognition-system");
const { CodingDaemon } = await import("../../engineering/coding-daemon");
const { SPATIAL_DEVELOPMENT_BUILDER_CONTEXT } = await import("../../demo/spatial-development-policy");

function fixture(authoringContext?: string) {
  const world = createArgosWorld("Contract test"); initializePrefabs(world); startCommittedEvents(world);
  const room = createRoomEntity(world, { name: "Garden" }), actor = createAgentEntity(world,
    { name: "Ada", role: "neighbor", systemPrompt: "PRIVATE_LIFE_NOT_A_BUILD_INSTRUCTION", roomId: room });
  createIntentGoal(world, actor, "Inspect the garden's physical condition", 5);
  const registry = createSystemRegistry(), spirits = createSpiritRegistry(world);
  const daemon = new CodingDaemon(world, registry, { authoringContext }, async () => { throw Error("No builder calls in prompt tests"); });
  const weaver = createDynamicSpirit(spirits, { name: "Weaver", type: "architect", rank: "archangel", domain: "ecology",
    architectConfig: { canProposeSystems: true, canProposeComponents: false, canProposeEntities: false, canProposeRules: false,
      canExecuteDirectly: false, proposalApproval: "superior", maxProposalsPerCycle: 1 } })!;
  return { world, room, registry, spirits, daemon, weaver };
}
beforeEach(() => { resetFactoryState(); generate.mockReset(); jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("Offline contract tests")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); resetFactoryState(); });

test("host engineering contract is captured per world, not inherited from another daemon", async () => {
  const a = fixture("ALPHA_HOST_CONTRACT"), captured = await gatherArchitectContext(a.world, a.registry);
  const b = fixture("BETA_HOST_CONTRACT"), other = await gatherArchitectContext(b.world, b.registry);
  expect(captured.hostEngineeringContext).toBe("ALPHA_HOST_CONTRACT"); expect(other.hostEngineeringContext).toBe("BETA_HOST_CONTRACT");
  const c = fixture(); expect((await gatherArchitectContext(c.world, c.registry)).hostEngineeringContext).toBe("");
  a.daemon.stop(); b.daemon.stop(); c.daemon.stop();
});

test("host contract is guidance, never admissible evidence of an unmet need", async () => {
  const f = fixture(SPATIAL_DEVELOPMENT_BUILDER_CONTEXT);
  try {
    const context = await gatherArchitectContext(f.world, f.registry);
    expect(validateObservedNeeds([{ type: "system", description: "A new physical mechanic", priority: "medium", rationale: "Host enabled development",
      expectedChange: "A scalar", evidence: ["hostEngineeringContext"] }], context)).toEqual([]);
    expect(f.daemon.getStatus().jobs).toEqual([]);
  } finally { f.daemon.stop(); }
});

test("needs and design receive the same host contract without contradictory native-write example", async () => {
  const f = fixture(SPATIAL_DEVELOPMENT_BUILDER_CONTEXT), prompts: string[] = [];
  try {
    generate.mockImplementation(async ({ prompt }) => {
      prompts.push(prompt); expect(prompt).toContain(SPATIAL_DEVELOPMENT_BUILDER_CONTEXT);
      expect(prompt).not.toContain("PRIVATE_LIFE_NOT_A_BUILD_INSTRUCTION");
      if (prompt.includes("identify 0-3")) {
        const intentions = JSON.parse(prompt.split("- Actor intentions (author-only evidence, not other NPCs' knowledge): ")[1].split("\n")[0]);
        return { text: JSON.stringify([{ type: "system", description: "Observe real moisture in the garden", priority: "medium",
          rationale: "Support the resident's inspection", expectedChange: "Public physical moisture values", evidence: [intentions.find((row: any) => row.kind === "goal").ref] }]) };
      }
      expect(prompt).not.toContain("ExampleGaugeSystem"); expect(prompt).not.toContain("derive Description.value");
      expect(prompt).not.toContain("frequency is simulation milliseconds"); expect(prompt).toContain("Managed frequency is logical ECS ticks");
      return { text: JSON.stringify({ name: "SpatialDevMoistureCycle", description: "Public physical moisture", frequency: 10,
        targetComponents: ["SpatialDevelopmentInput", "SpatialDevMoisture"],
        logic: "Use eligible public rain input. Introduce SpatialDevMoisture level:number default0. Bound0..1, integrate elapsed simulation seconds.",
        requiredCapabilities: ["read_scalar_components", "write_unprotected_scalars", "attach_dynamic_components"], writes: ["SpatialDevMoisture.level"],
        acceptance: [{ name: "Rain changes moisture", system: "SpatialDevMoistureCycle", entities: [{ id: 1, components: {
          SpatialDevelopmentInput: { eligible: true, weather: "rain" }, SpatialDevMoisture: { level: 0 } } }], ticks: 1, deltaMs: 1000,
          expect: [{ entity: 1, component: "SpatialDevMoisture", field: "level", equals: .1 }] },
        { name: "Ineligible remains unchanged", system: "SpatialDevMoistureCycle", entities: [{ id: 1, components: {
          SpatialDevelopmentInput: { eligible: false, weather: "rain" }, SpatialDevMoisture: { level: 0 } } }], ticks: 1, deltaMs: 1000,
          expect: [{ entity: 1, component: "SpatialDevMoisture", field: "level", equals: 0 }] }] }) };
    });
    const proposals = await runArchitectCognition(f.world, f.registry, f.spirits, f.weaver);
    expect(prompts).toHaveLength(2); expect(proposals).toHaveLength(1); expect(proposals[0].status).toBe("pending");
    expect(f.daemon.getStatus().jobs).toEqual([]); expect(f.registry.systems.has("SpatialDevMoistureCycle")).toBe(false);
  } finally { f.daemon.stop(); }
});

test("legacy managed authoring keeps its example and actual logical-tick scheduler units", async () => {
  const f = fixture();
  try {
    const text = getArchitectSpecificationPrompt("system", "A physical quantity", await gatherArchitectContext(f.world, f.registry));
    expect(text).toContain("ExampleGaugeSystem"); expect(text).toContain("frequency is a count of ECS ticks");
    expect(text).not.toContain("frequency is simulation milliseconds");
  } finally { f.daemon.stop(); }
});
