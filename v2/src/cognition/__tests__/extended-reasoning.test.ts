import { jest } from "@jest/globals";

const ai = await import("ai");
const generateObject = jest.fn<(...args: any[]) => Promise<any>>();
const generateText = jest.fn<(...args: any[]) => Promise<any>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateObject, generateText }));

const { executeExtendedReasoning, createReasoningTask } = await import("../extended-reasoning");
const { createMemoryStore } = await import("../enhanced-memory");
const { reasoningModel } = await import("../../llm/config");
const { withSimulationTask } = await import("../../runtime/task-scope");

const continuingStep = {
  object: {
    stepType: "think",
    content: "I need another bounded step.",
    confidence: 0.2,
    needsMoreInfo: true,
    isConclusion: false,
  },
};

beforeEach(() => {
  generateObject.mockReset();
  generateText.mockReset();
});

test("extended reasoning obeys its total model-call budget", async () => {
  generateObject.mockResolvedValue(continuingStep);
  const store = createMemoryStore();
  const result = await executeExtendedReasoning(
    createReasoningTask(1, "analysis", "What changed?", "Evidence"),
    store,
    "Careful investigator",
    { maxSteps: 10, maxModelCalls: 2, maxTimeMs: 5_000, enableToolUse: false, enableSelfReflection: false },
  );

  expect(generateObject).toHaveBeenCalledTimes(2);
  expect(generateText).not.toHaveBeenCalled();
  expect(result.steps).toHaveLength(2);
  expect(result.suggestedActions).toEqual([]);
  for (const [input] of generateObject.mock.calls) {
    expect(input.maxRetries).toBe(0);
    expect(input.abortSignal).toBeInstanceOf(AbortSignal);
  }
});

test("the pro reasoning path and its nested tools share the central reasoning model", async () => {
  generateObject.mockResolvedValueOnce({ object: {
    ...continuingStep.object,
    toolToUse: "deduce",
    toolInput: "A implies B; A",
  } });
  generateText.mockResolvedValueOnce({ text: "Therefore B." });
  const store = createMemoryStore();
  await executeExtendedReasoning(
    createReasoningTask(2, "problem_solving", "Deduce B", "Evidence"),
    store,
    "Logician",
    { model: "pro", maxSteps: 4, maxModelCalls: 2, maxTimeMs: 5_000, enableToolUse: true, enableSelfReflection: false },
  );

  expect(generateObject).toHaveBeenCalledTimes(1);
  expect(generateText).toHaveBeenCalledTimes(1);
  expect(generateObject.mock.calls[0][0].model).toBe(reasoningModel);
  expect(generateText.mock.calls[0][0].model).toBe(reasoningModel);
});

test("cancelled subconscious reasoning rejects late output before learning commits", async () => {
  let release!: (value: any) => void;
  generateObject.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const store = createMemoryStore();
  const controller = new AbortController();
  const running = withSimulationTask(controller.signal, () => executeExtendedReasoning(
    createReasoningTask(3, "planning", "Make a plan", "Old snapshot"),
    store,
    "Planner",
    { maxSteps: 1, maxModelCalls: 1, maxTimeMs: 5_000, enableToolUse: false, enableSelfReflection: false },
  ));
  await Promise.resolve();
  controller.abort(new Error("world stopped"));
  release({ object: {
    stepType: "conclude",
    content: "A stale conclusion",
    confidence: 0.95,
    needsMoreInfo: false,
    findings: ["STALE_FINDING"],
    uncertainties: [],
    isConclusion: true,
  } });

  await expect(running).rejects.toThrow();
  expect(store.semanticMemories).toHaveLength(0);
  expect(store.proceduralMemories).toHaveLength(0);
  expect(JSON.stringify(store)).not.toContain("STALE_FINDING");
});
