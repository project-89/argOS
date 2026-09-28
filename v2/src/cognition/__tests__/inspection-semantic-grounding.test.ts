import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { hasComponent } = await import("bitecs");
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createAgentEntity, createRoomEntity } = await import("../../ecs/prefabs");
const { Belief, Container, Memory, ObjectState } = await import("../../ecs/components");
const { ObjectManager } = await import("../../world/object-manager");
const { recordInspectionResult, getCurrentInspection } = await import("../inspection-memory");
const { getWorkingMemory, formatWorkingMemoryContext } = await import("../working-memory");
const { addMemory, extractKnowledgeFromInteraction, getAgentBeliefs, getAgentMemories, getKnowledgeSummary } = await import("../knowledge-graph");
const { generateReflection, storeReflectionResults } = await import("../reflection-system");
const { formatReflectionSources } = await import("../reflection-retrieval");
const { recordCommittedSpeech } = await import("../social-memory");
const { copyActorGoalCondition, actorKnowsGoalCondition } = await import("../actor-goal-evidence");
const { evaluateCurrentStateCondition } = await import("../../systems/goal-evaluation-system");

let oldKey: string | undefined, oldEnable: string | undefined, oldDisable: string | undefined;
beforeEach(() => {
  oldKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY; oldEnable = process.env.ARGOS_ENABLE_LLM_IN_TESTS; oldDisable = process.env.ARGOS_DISABLE_KNOWLEDGE_EXTRACTION;
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "mock-only"; process.env.ARGOS_ENABLE_LLM_IN_TESTS = "1"; delete process.env.ARGOS_DISABLE_KNOWLEDGE_EXTRACTION;
  generate.mockReset();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("Semantic grounding regressions are offline"));
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled(); jest.restoreAllMocks();
  for (const [key, value] of [["GOOGLE_GENERATIVE_AI_API_KEY", oldKey], ["ARGOS_ENABLE_LLM_IN_TESTS", oldEnable], ["ARGOS_DISABLE_KNOWLEDGE_EXTRACTION", oldDisable]]) {
    if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
  }
});

function fixture() {
  const world = createArgosWorld("Wall inspection semantics"); initializePrefabs(world); world.meta.aiEnabled = true;
  const room = createRoomEntity(world, { name: "Kitchen" });
  const actor = createAgentEntity(world, { name: "Ivo", role: "resident", systemPrompt: "Reflect on your own evidence.", roomId: room });
  const peer = createAgentEntity(world, { name: "Tess", role: "resident", systemPrompt: "PRIVATE_PERSONA", roomId: room });
  const wall = new ObjectManager(world).spawn("structural_wall", { name: "household-utility-north", containedIn: room })!;
  expect(wall).not.toBeNull();
  const inspection = recordInspectionResult(world, actor, wall)!;
  const receipt = getWorkingMemory(world, actor).receipts.find(r => r.id === inspection.sourceId)!;
  addMemory(world, actor, { content: "I went to the kitchen to look around.", type: "episodic", importance: .5, emotionalValence: 0, timestamp: Date.now() });
  return { world, actor, peer, wall, inspection, receipt };
}

test("reflection receives exact inspected structural identity with source keys, not a renamed storage unit", async () => {
  const f = fixture();
  const catalogue = formatReflectionSources([{ kind: "physical_receipt", receipt: f.receipt }]);
  expect(catalogue).toContain(f.inspection.subject);
  expect(catalogue).toContain("ObjectType.typeId"); expect(catalogue).toContain("structural_wall");
  expect(catalogue).toContain("Container.present"); expect(catalogue).not.toContain("Inspection.basis");
  generate.mockResolvedValue({ text: JSON.stringify({ insights: [], questionsRaised: [], emotionalSummary: "Curious" }) });
  expect(await generateReflection(f.world, f.actor)).not.toBeNull();
  expect(generate.mock.calls[0][0].system).toContain(catalogue);
  expect(generate.mock.calls[0][0].system).not.toContain("PRIVATE_PERSONA");
});

test("a false reflected cupboard interpretation and learned claim remain subjective, never current physical evidence", async () => {
  const f = fixture();
  generate.mockResolvedValueOnce({ text: JSON.stringify({ insights: [{ insight: "I think those kitchen cupboards were empty; perhaps I should find food elsewhere.",
    importance: 6, category: "world", relatedMemories: [], temporalScope: "historical", sourceIds: [`receipt:${f.receipt.id}`] }], questionsRaised: [], emotionalSummary: "Unsure" }) });
  const reflection = await generateReflection(f.world, f.actor);
  expect(reflection).not.toBeNull(); expect(storeReflectionResults(f.world, f.actor, reflection!)).toBe(true);
  expect(getAgentMemories(f.world, f.actor).some(id => Memory.content[id].includes("cupboards were empty"))).toBe(true);
  const speech = recordCommittedSpeech(f.world, f.actor, "I think the kitchen cupboards are empty.", "Tess")!;
  generate.mockResolvedValueOnce({ text: JSON.stringify({ memories: [{ content: "I told Tess I thought the cupboards were empty.", type: "episodic", importance: .5, emotionalValence: 0 }],
    beliefs: [{ subject: "kitchen cupboards", predicate: "are", object: "empty", confidence: .9 }] }) });
  await extractKnowledgeFromInteraction(f.world, f.actor, { type: "speech", content: speech.content, otherParty: "Tess", perspective: "own_speech", speechId: speech.id, context: "My own spoken claim after inspecting a wall." });
  const belief = getAgentBeliefs(f.world, f.actor).find(id => Belief.subject[id] === "kitchen cupboards")!;
  expect(belief).toBeDefined(); expect(Belief.source[belief]).toBe("Ivo (spoken claim)");
  expect(getKnowledgeSummary(f.world, f.actor)).toContain("confidence expresses conviction, not verification");
  expect(hasComponent(f.world, f.wall, Container)).toBe(false); expect(ObjectState.current[f.wall]).toBe("solid");
  expect(getCurrentInspection(f.world, f.actor, f.inspection.subject)?.outcome).toBe("observed");
  const physical = getWorkingMemory(f.world, f.actor);
  expect(physical.facts.some(fact => fact.subject === f.inspection.subject && fact.slot === "Entity.kind" && fact.value === "structural_geometry")).toBe(true);
  expect(physical.facts.some(fact => fact.subject === f.inspection.subject && fact.slot === "Container.visibleContents")).toBe(false);
  expect(formatWorkingMemoryContext(f.world, f.actor)).not.toContain("cupboards");
  for (const entityName of ["household-utility-north", "kitchen cupboards"]) {
    const success = { type: "entity_component_equals" as const, entityName, component: "ObjectState", field: "current", equals: "empty" };
    expect(evaluateCurrentStateCondition(f.world, f.actor, success)).toBe(false);
    expect(actorKnowsGoalCondition(f.world, f.actor, copyActorGoalCondition(success)!, 0, [...physical.facts])).toBe(false);
  }
});
