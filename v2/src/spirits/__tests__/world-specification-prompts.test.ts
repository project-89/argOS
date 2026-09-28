import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<any>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createRoomEntity, createAgentEntity } = await import("../../ecs/prefabs");
const { createEntityRegistry } = await import("../../ecs/tools");
const { createSystemRegistry, registerSystem } = await import("../../ecs/dynamic-systems");
const { startCommittedEvents, stopCommittedEvents } = await import("../../runtime/committed-events");
const { setWorldSpecification, getWorldAuthoringContext, getWorldTheme } = await import("../../world/world-specification");
const { createSpiritRegistry, createSpirit } = await import("../spirit-registry");
const { createDynamicSpirit, resetFactoryState } = await import("../spirit-factory");
const { runSpiritCognition } = await import("../spirit-cognition");
const { gatherArchitectContext, runArchitectCognition } = await import("../architect-spirit");
const { createIntentGoal } = await import("../../cognition/cognition-system");
const { runArtificerWithTools } = await import("../artificer-spirit");
const { requestRule, generateRuleProposal, resetLawgiverState } = await import("../rules-spirit");
const { requestRoomPopulation, requestRoomPopulationForRoom, generateRoomPopulation, populateRoomViaSchema,
  resetStewardState } = await import("../steward-spirit");

function fixture(name = "Harbor mystery", authored = true) {
  const world = createArgosWorld(name); initializePrefabs(world); startCommittedEvents(world);
  if (authored) setWorldSpecification(world, { version: 1,
    setting: { name, genre: "coastal mystery", premise: `${name}: neighbors investigate ordinary evidence.`, tone: "uneasy warmth" },
    story: { style: "patient discovery", tensions: ["An uncertain shared account"] },
    inhabitants: [{ name: "PRIVATE_UNCREATED_RESIDENT", role: "PRIVATE_ROLE", systemPrompt: "PRIVATE_AUTHOR_HISTORY" }],
    opportunities: ["Public places support rest and investigation"], discovery: ["Evidence must be encountered"],
    constraints: ["Existing clues are not automatically replaced"] });
  const room = createRoomEntity(world, { name: "Hall", description: "An indoor passage." });
  const systems = createSystemRegistry(), spirits = createSpiritRegistry(world);
  return { world, room, systems, spirits };
}
function publicContext(prompt: string, f: ReturnType<typeof fixture>) {
  expect(prompt).toContain(getWorldAuthoringContext(f.world));
  expect(prompt).toContain("patient discovery");
  expect(prompt).toContain("Evidence must be encountered");
  expect(prompt).not.toContain("PRIVATE_UNCREATED_RESIDENT");
  expect(prompt).not.toContain("PRIVATE_AUTHOR_HISTORY");
}
beforeEach(() => {
  generate.mockReset(); resetFactoryState(); resetStewardState(); resetLawgiverState();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("Offline world specification prompt tests"));
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks();
  resetFactoryState(); resetStewardState(); resetLawgiverState();
});

test("generic spirit context follows its own world, not a prior world's global text", async () => {
  const captured: string[] = [];
  for (const name of ["Harbor mystery", "Orbital refuge"]) {
    const f = fixture(name), spirit = createSpirit(f.spirits, { name: "Narrator", domain: "narrative", rank: "archangel",
      model: "flash", systemPrompt: "Observe actual events", observationInterval: 1000 });
    generate.mockResolvedValueOnce({ text: JSON.stringify({ thoughts: "Observe", observations: [], interventions: [] }) });
    await runSpiritCognition(spirit, f.world, createEntityRegistry(), f.spirits);
    // The Narrator is the author: it gets a compact setting brief (its own
    // system prompt carries the story), still world-local and without seeds.
    const prompt = generate.mock.calls.at(-1)![0].prompt; captured.push(prompt);
    expect(prompt).toContain(`SETTING: ${name} · coastal mystery`); expect(prompt).toContain("Tensions: An uncertain shared account");
    expect(prompt).not.toContain("PRIVATE_UNCREATED_RESIDENT"); expect(prompt).not.toContain("PRIVATE_AUTHOR_HISTORY");
  }
  expect(captured[0]).not.toContain("Orbital refuge"); expect(captured[1]).not.toContain("Harbor mystery");
});

test("Weaver captures the same public guidance for need and design without granting construction", async () => {
  const f = fixture(), actor = createAgentEntity(f.world, { name: "Ada", role: "visitor", systemPrompt: "Choose freely", roomId: f.room });
  createIntentGoal(f.world, actor, "Rest indoors", 5);
  const architect = createDynamicSpirit(f.spirits, { name: "Weaver", type: "architect", rank: "archangel", domain: "narrative",
    architectConfig: { canProposeSystems: false, canProposeComponents: false, canProposeEntities: true,
      canProposeRules: false, canExecuteDirectly: false, proposalApproval: "superior", maxProposalsPerCycle: 1 } })!;
  expect((await gatherArchitectContext(f.world, f.systems)).worldAuthoringContext).toBe(getWorldAuthoringContext(f.world));
  generate.mockImplementation(async ({ prompt }) => {
    publicContext(prompt, f);
    if (prompt.includes("identify 0-3")) {
      const records = JSON.parse(prompt.split("- Actor intentions (author-only evidence, not other NPCs' knowledge): ")[1].split("\n")[0]);
      return { text: JSON.stringify([{ type: "entity", description: "One indoor chair", priority: "medium",
        rationale: "An indoor seat supports rest", expectedChange: "A usable seat", evidence: [records.find((row: any) => row.kind === "goal").ref] }]) };
    }
    return { text: JSON.stringify({ name: "Indoor chair", type: "object", description: "A wooden chair", roomEid: f.room,
      components: [{ name: "ObjectType", values: { typeId: "chair" } }] }) };
  });
  const proposals = await runArchitectCognition(f.world, f.systems, f.spirits, architect);
  expect(generate).toHaveBeenCalledTimes(2); expect(proposals).toHaveLength(1); expect(proposals[0].status).toBe("pending");
});

test.each([undefined, "explicit local maritime style"])("scoped Steward inherits theme unless explicitly overridden: %s", async theme => {
  const f = fixture();
  const request = requestRoomPopulationForRoom(f.world, f.room, { context: theme ? { worldTheme: theme } : {} });
  expect(request.context.worldTheme).toBe(theme ?? getWorldTheme(f.world));
  generate.mockResolvedValue({ text: JSON.stringify({ newTypes: [], entities: [], ambientStimuli: [] }) });
  await populateRoomViaSchema(f.world, request, f.room);
  const prompt = generate.mock.calls[0][0].prompt; publicContext(prompt, f);
  expect(prompt).toContain(`World theme: ${theme ?? getWorldTheme(f.world)}`); expect(prompt).not.toContain("medieval fantasy");
});

test("unscoped legacy Steward authoring has a neutral unspecified default", async () => {
  generate.mockResolvedValue({ text: "{}" });
  await generateRoomPopulation(requestRoomPopulation("general", "Hall"));
  expect(generate.mock.calls[0][0].prompt).toContain("World theme: unspecified setting");
  expect(generate.mock.calls[0][0].prompt).not.toContain("medieval fantasy");
});

test("Lawgiver receives world guidance through its existing grant and stale source still prevents inference", async () => {
  const f = fixture();
  const request = requestRule("Describe a local rule", { desiredBehavior: "An authored local effect" }, "test", f.world);
  generate.mockResolvedValue({ text: "{}" });
  await generateRuleProposal(request); publicContext(generate.mock.calls[0][0].prompt, f);
  const stale = requestRule("Another local rule", { desiredBehavior: "Still needs authority" }, "test", f.world);
  stopCommittedEvents(f.world); generate.mockClear();
  expect(await generateRuleProposal(stale)).toBeNull(); expect(generate).not.toHaveBeenCalled();
});

test("Tinker sees setting guidance without changing its native fault/repair tools", async () => {
  const f = fixture(), tinker = createDynamicSpirit(f.spirits, { name: "Tinker", type: "artificer", rank: "archangel", domain: "guardian" })!;
  // A system in scope: with none, the Tinker now skips its model call entirely.
  registerSystem(f.systems, { name: "FixtureTide", description: "Fixture", pseudocode: "Noop", code: "fixture", frequency: 0, active: true, lastRun: 0, compiledFn: () => {} });
  generate.mockResolvedValue({ text: "", steps: [], toolResults: [] });
  const report = await runArtificerWithTools(f.world, f.systems, f.spirits, tinker);
  publicContext(generate.mock.calls[0][0].system, f); expect(report.repairsAttempted).toEqual([]);
});
