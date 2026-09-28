import { jest } from "@jest/globals";

const ai = await import("ai");
const generateObject = jest.fn<(...args: any[]) => Promise<any>>();
const generateText = jest.fn<(...args: any[]) => Promise<any>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateObject, generateText }));

const { createArgosWorld, addEntity, addComponent } = await import("../../ecs/world");
const { Agent, Name } = await import("../../ecs/components");
const { addMemory, addBelief, getKnowledgeSummary, extractKnowledgeFromInteraction } = await import("../knowledge-graph");
const { extractSemanticMemory } = await import("../memory-consolidation");
const { createMemoryStore, addToWorkingMemory, addSemanticMemory, formatWorkingMemoryForPrompt, generateMemoryContext } = await import("../enhanced-memory");
const { executeExtendedReasoning, createReasoningTask } = await import("../extended-reasoning");
const { createResearchProject, analyzeAndConclude } = await import("../research-agent");
const { createTask, generateTasksFromGoal, autoPrioritizeTasks, getTaskQueue } = await import("../task-queue");
const { generateBehaviorPolicy, _setLLMCallOverride } = await import("../policy-generator");

beforeEach(() => { generateObject.mockReset(); generateText.mockReset(); });
afterEach(() => { _setLLMCallOverride(null); });

test("working and recalled memories retain available sources without promoting a hypothesis to a verified result", () => {
  const store = createMemoryStore();
  addToWorkingMemory(store, "task", "hypothesis", "Perhaps the relay is damaged.", ["observation:12"]);
  addToWorkingMemory(store, "task", "conclusion", "Ivo said the key was in his pocket.", ["speech:Ivo:14"]);
  addSemanticMemory(store, { category: "fact", subject: "Ivo", content: "Ivo said he had the key.", confidence: .8, sources: ["speech:Ivo:14"] });
  const working = formatWorkingMemoryForPrompt(store, "task");
  expect(working).toContain("Working Hypotheses");
  expect(working).toContain("observation:12");
  expect(working).toContain("speech:Ivo:14");
  expect(working).toContain("labels do not establish verification");
  const recalled = generateMemoryContext(store, { currentTask: "task", topic: "Ivo", peoplePresent: ["Ivo"] });
  expect(recalled).toContain("Stored knowledge");
  expect(recalled).toContain("sources: speech:Ivo:14");
  expect(recalled).not.toContain("What I Know");
});

test("belief summaries preserve the recorded speaker rather than dropping provenance", () => {
  const world = createArgosWorld("belief provenance"), actor = addEntity(world);
  addComponent(world, actor, Agent); addComponent(world, actor, Name); Name.value[actor] = "Mara";
  addBelief(world, actor, { subject: "Ivo", predicate: "says he has", object: "the key", confidence: .7, source: "heard Ivo at 2s", timestamp: 2000 });
  expect(getKnowledgeSummary(world, actor)).toContain("source: heard Ivo at 2s");
});

test("legacy recall distinguishes memory types and conviction from verified world facts", () => {
  const world = createArgosWorld("unknown answers"), actor = addEntity(world);
  addComponent(world, actor, Agent); addComponent(world, actor, Name); Name.value[actor] = "Mara";
  addMemory(world, actor, { type: "episodic", content: "I said I had porridge for breakfast.", importance: .7, emotionalValence: 0, timestamp: 1000 });
  addMemory(world, actor, { type: "semantic", content: "I suspect Lin wears the same patterned shirt often.", importance: .5, emotionalValence: 0, timestamp: 2000 });
  addBelief(world, actor, { subject: "Mara", predicate: "ate", object: "porridge", confidence: 1, source: "Mara (spoken claim)", timestamp: 3000 });
  for (const options of [{}, { context: "breakfast and clothing" }]) {
    const summary = getKnowledgeSummary(world, actor, options);
    expect(summary).toContain("recollections and interpretations");
    expect(summary).toContain("episodic"); expect(summary).toContain("semantic");
    expect(summary).toContain("I said I had porridge");
    expect(summary).toContain("confidence expresses conviction, not verification");
    expect(summary).toContain("source: Mara (spoken claim)");
    expect(summary).not.toContain("past experiences;");
  }
});

test("knowledge extraction and consolidation permit empty results without inventing fact quotas", async () => {
  const world = createArgosWorld("empty extraction"), actor = addEntity(world);
  addComponent(world, actor, Agent); addComponent(world, actor, Name); Name.value[actor] = "Mara";
  Agent.active[actor] = true;
  world.meta.aiEnabled = true;
  const previousOverride = process.env.ARGOS_ENABLE_LLM_IN_TESTS, previousKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  const previousDisabled = process.env.ARGOS_DISABLE_KNOWLEDGE_EXTRACTION;
  try {
    process.env.ARGOS_ENABLE_LLM_IN_TESTS = "1";
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "offline-mock-only";
    delete process.env.ARGOS_DISABLE_KNOWLEDGE_EXTRACTION;
    generateText.mockResolvedValueOnce({ text: '{"memories":[],"beliefs":[],"impressions":[]}' });
    await extractKnowledgeFromInteraction(world, actor, { type: "speech", content: "Maybe the key is upstairs.", otherParty: "Ivo", context: "A heard suggestion." });
    expect(generateText.mock.calls[0][0].system).toContain("Empty arrays are appropriate");
    expect(generateText.mock.calls[0][0].system).toContain("not independent verification");
  } finally {
    if (previousOverride === undefined) delete process.env.ARGOS_ENABLE_LLM_IN_TESTS; else process.env.ARGOS_ENABLE_LLM_IN_TESTS = previousOverride;
    if (previousKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY; else process.env.GOOGLE_GENERATIVE_AI_API_KEY = previousKey;
    if (previousDisabled === undefined) delete process.env.ARGOS_DISABLE_KNOWLEDGE_EXTRACTION; else process.env.ARGOS_DISABLE_KNOWLEDGE_EXTRACTION = previousDisabled;
  }
  for (let i = 0; i < 5; i++) addMemory(world, actor, { type: "episodic", content: `Ivo repeated an unverified suggestion, occasion ${i}.`, importance: .7, emotionalValence: 0, timestamp: 1000 + i });
  generateText.mockResolvedValueOnce({ text: "[]" });
  expect(await extractSemanticMemory(world, actor)).toEqual([]);
  expect(generateText.mock.calls[1][0].prompt).toContain("repeated retellings are not independent evidence");
  expect(generateText.mock.calls[1][0].prompt).not.toContain("Extract 2-5 factual statements");
});

test("extended reasoning receives its supplied task context and can conclude unresolved without fabricated findings", async () => {
  generateObject.mockResolvedValueOnce({ object: { stepType: "conclude", content: "The available evidence does not establish whether the relay is damaged.",
    confidence: .1, needsMoreInfo: true, findings: [], uncertainties: ["No inspection result"], isConclusion: true } });
  const store = createMemoryStore();
  const result = await executeExtendedReasoning(createReasoningTask(8001, "analysis", "Is the relay damaged?",
    "Agent context\nA unique tool receipt: TEST_RECEIPT_1138 says the inspection never ran."), store, "Agent context",
    { maxSteps: 3, maxModelCalls: 1, maxTimeMs: 5000, enableToolUse: false, enableSelfReflection: false });
  const input = generateObject.mock.calls[0][0];
  expect(input.prompt).toContain("TEST_RECEIPT_1138");
  expect(input.prompt.match(/Agent context/g)).toHaveLength(1);
  expect(input.system).toContain("cannot be resolved");
  expect(result.success).toBe(false);
  expect(result.findings).toEqual([]);
  expect(store.semanticMemories).toHaveLength(0);
});

test("research can report no further questions or supported conclusions", async () => {
  generateObject.mockResolvedValueOnce({ object: { title: "Unresolved relay condition", questions: [] } });
  const project = await createResearchProject(8002, "Determine whether an unavailable relay is damaged", "No inspection result exists.");
  expect(project.questions).toEqual([]);
  expect(generateObject.mock.calls[0][0].prompt).toContain("empty questions array");
  generateObject.mockResolvedValueOnce({ object: { executiveSummary: "No inspection evidence is available.", keyFindings: [], conclusions: [], recommendations: [],
    limitations: ["No inspection result"], overallConfidence: 0 } });
  const result = await analyzeAndConclude(project, "No inspection result exists.");
  expect(result.confidence).toBe(0);
  expect(project.conclusions).toEqual([]);
  expect(generateObject.mock.calls[1][0].prompt).toContain("either array may be empty");
});

test("task proposals and reprioritization accept no-op results and receive real deadline/dependency metadata", async () => {
  generateObject.mockResolvedValueOnce({ object: { tasks: [] } });
  expect(await generateTasksFromGoal(8003, "The lamp is already restored", "No remaining work")).toEqual([]);
  const task = createTask(8003, { title: "Check after access is restored", description: "Wait for access", type: "maintenance", priority: "low", deadline: 123456, blockedBy: ["access-task"] });
  // This fixture inspects pending-task reprioritization; it does not resolve the dependency.
  task.status = "pending";
  generateObject.mockResolvedValueOnce({ object: { priorities: [] } });
  await autoPrioritizeTasks(8003, "No new evidence");
  expect(generateObject.mock.calls[1][0].prompt).toContain('"deadline":123456');
  expect(generateObject.mock.calls[1][0].prompt).toContain('"blockedBy":["access-task"]');
  expect(getTaskQueue(8003).tasks[0].priority).toBe("low");
});

test("a sparse policy world allows valid quiet behavior without inventing affordances or activity quotas", async () => {
  let captured = "";
  _setLLMCallOverride(async input => {
    captured = input.system + input.prompt;
    return JSON.stringify({ type: "selector", children: [{ type: "action", action: { type: "wait" } }] });
  });
  const policy = await generateBehaviorPolicy({ name: "Mara", role: "guest", personality: "quiet and curious", currentRoom: "Common Room",
    worldTheme: "storm house", availableAffordances: [], availableTraits: [], availableRelationships: [], existingTemplates: [], roomNames: [] });
  expect(policy).toEqual({ type: "selector", children: [{ type: "action", action: { type: "wait" } }] });
  expect(captured).toContain("Waiting is valid");
  expect(captured).toContain("do not invent a movement target");
  expect(captured).not.toContain("MUST include at least 2");
  expect(captured).not.toContain("20-50 nodes");
});
