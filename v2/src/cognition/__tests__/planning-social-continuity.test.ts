import { jest } from "@jest/globals";
import { removeComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Goal, Plan } from "../../ecs/components";
import { HasGoal } from "../../ecs/relations";
import { setLocatedIn } from "../../ecs/location";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { addConversationTurn, addThought } from "../agent-mind";
import { createIntentGoal, executeActions } from "../cognition-system";
import { drainPendingStimuli } from "../stimulus-queue";
import { recordCommittedSpeech } from "../social-memory";
import { serializeWorld } from "../../persistence/world-persistence";
import {
  advancePlanStep, createPlanEntity, formatPlansForContext, generatePlanForGoal, getAgentPlans, getNextPlannedAction,
  getPlanForGoal, hasPendingPlanning, runPlanningSystem, type GeneratedPlan, type PlanStep,
} from "../planning-system";

function fixture() {
  const world = createArgosWorld("Social planning continuity");
  world.meta.aiEnabled = false;
  initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Common Room" });
  const remote = createRoomEntity(world, { name: "Utility Room" });
  const mara = createAgentEntity(world, { name: "Mara", role: "resident", systemPrompt: "A curious resident", roomId: room });
  const ivo = createAgentEntity(world, { name: "Ivo", role: "caretaker", systemPrompt: "PRIVATE_IVO_BACKSTORY", roomId: room });
  const goal = createIntentGoal(world, mara, "Coordinate with the caretaker", 5);
  const registry = createSystemRegistry();
  const speak = (actor: number, target: string, content: string) => executeActions(world, [{ eid: actor, action: { type: "speak", target, content } }], registry);
  return { world, room, remote, mara, ivo, goal, registry, speak };
}

const askKey: GeneratedPlan = {
  goalDescription: "Coordinate with the caretaker", estimatedCompletion: "short", potentialObstacles: [],
  steps: [{ description: "I should ask who carries the key.", actionType: "speak", target: "Ivo", content: "Do you have the cupboard key?" }],
};

beforeEach(() => {
  drainPendingStimuli();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Planning tests must not make paid calls"));
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  jest.restoreAllMocks();
  jest.useRealTimers();
  drainPendingStimuli();
});

test("the planner sees actual answered dialogue and its previous actions, not private model exchanges", async () => {
  const f = fixture();
  createPlanEntity(f.world, f.mara, f.goal, askKey);
  f.speak(f.mara, "Ivo", "Do you have the cupboard key?");
  f.speak(f.ivo, "Mara", "I already carry the brass cupboard key.");
  addConversationTurn(f.world, f.mara, "assistant", "PRIVATE_UNEXECUTED_MODEL_SPEECH");
  addThought(f.world, f.ivo, { type: "reflection", content: "PRIVATE_IVO_THOUGHT" });
  const completedGoal = createIntentGoal(f.world, f.mara, "COMPLETED_REPAIR_SHOULD_NOT_RESTART", 3);
  Goal.status[completedGoal] = "completed";
  let context = "";
  const generated = await generatePlanForGoal(f.world, f.mara, f.goal, {
    generateText: (async (options: { system?: string }) => {
      context = options.system || "";
      return { text: JSON.stringify({ ...askKey, steps: [{ ...askKey.steps[0], content: "Good. Shall we check the controls together?" }] }) };
    }) as any,
  });
  expect(generated).not.toBeNull();
  expect(context).toContain("I already carry the brass cupboard key.");
  expect(context).toContain("RECENT PLAN OUTCOMES");
  expect(context).toContain("Do you have the cupboard key?");
  expect(context).not.toContain("PRIVATE_UNEXECUTED_MODEL_SPEECH");
  expect(context).not.toContain("PRIVATE_IVO_THOUGHT");
  expect(context).not.toContain("PRIVATE_IVO_BACKSTORY");
  expect(context).not.toContain("COMPLETED_REPAIR_SHOULD_NOT_RESTART");
});

test("new spoken information invalidates an in-flight question plan before admission", async () => {
  const f = fixture();
  let resolve!: (plan: GeneratedPlan) => void;
  const generated = new Promise<GeneratedPlan>(done => { resolve = done; });
  const planning = runPlanningSystem(f.world, { agentEids: [f.mara], planGenerator: () => generated });
  f.speak(f.ivo, "Mara", "The cupboard key is already in my pocket.");
  resolve(askKey);
  await planning;
  expect(getPlanForGoal(f.world, f.mara, f.goal)).toBeUndefined();
});

test("foreground speech already asks a background plan's question before it can be admitted", async () => {
  const f = fixture(); let resolve!: (plan: GeneratedPlan) => void;
  const generated = new Promise<GeneratedPlan>(done => { resolve = done; });
  const planning = runPlanningSystem(f.world, { agentEids: [f.mara], planGenerator: () => generated });
  f.speak(f.mara, "Ivo", "Do you have the cupboard key?");
  resolve(askKey); await planning;
  expect(getPlanForGoal(f.world, f.mara, f.goal)).toBeUndefined();
  expect(Goal.status[f.goal]).toBe("active");
});

test("own uncommitted thoughts and model history cannot invalidate an in-flight question plan", async () => {
  const f = fixture(); let resolve!: (plan: GeneratedPlan) => void;
  const generated = new Promise<GeneratedPlan>(done => { resolve = done; });
  const planning = runPlanningSystem(f.world, { agentEids: [f.mara], planGenerator: () => generated });
  addThought(f.world, f.mara, { type: "reflection", content: "Perhaps I should ask about the key." });
  addConversationTurn(f.world, f.mara, "assistant", "I plan to ask about the key.");
  resolve(askKey); await planning;
  expect(getPlanForGoal(f.world, f.mara, f.goal)).toBeDefined();
});

test("own committed speech does not discard an in-flight physical-only plan", async () => {
  const f = fixture(); let resolve!: (plan: GeneratedPlan) => void;
  const generated = new Promise<GeneratedPlan>(done => { resolve = done; });
  const planning = runPlanningSystem(f.world, { agentEids: [f.mara], planGenerator: () => generated });
  f.speak(f.mara, "Ivo", "I will inspect the utility room.");
  resolve({ ...askKey, steps: [{ actionType: "move", target: "Utility Room", description: "Inspect the utility room." }] });
  await planning;
  expect(getNextPlannedAction(f.world, f.mara)).toMatchObject({ actionType: "move", target: "Utility Room" });
});

test("a queued question is reconsidered after its actor hears an answer", () => {
  const f = fixture();
  const plan = createPlanEntity(f.world, f.mara, f.goal, askKey);
  f.speak(f.ivo, "Mara", "I have the brass key here; I can open the cupboard.");
  expect(getNextPlannedAction(f.world, f.mara)).toBeNull();
  expect(Plan.status[plan]).toBe("failed");
  expect(Goal.status[f.goal]).toBe("active");
});

test("new dialogue does not discard an executable physical step", () => {
  const f = fixture();
  createPlanEntity(f.world, f.mara, f.goal, {
    ...askKey, steps: [{ description: "I should inspect the controls.", actionType: "move", target: "Utility Room" }],
  });
  f.speak(f.ivo, "Mara", "I have the key, and I will follow you.");
  expect(getNextPlannedAction(f.world, f.mara)).toMatchObject({ actionType: "move", target: "Utility Room" });
});

test("private thoughts do not invalidate another character's queued social turn", () => {
  const f = fixture();
  const plan = createPlanEntity(f.world, f.mara, f.goal, askKey);
  addThought(f.world, f.ivo, { type: "reflection", content: "I secretly dislike this question." });
  expect(getNextPlannedAction(f.world, f.mara)).toMatchObject({ actionType: "speak", planEid: plan });
});

test("a planned social turn is no longer executable after the addressee leaves", () => {
  const f = fixture();
  const plan = createPlanEntity(f.world, f.mara, f.goal, askKey);
  setLocatedIn(f.world, f.ivo, f.remote);
  expect(getNextPlannedAction(f.world, f.mara)).toBeNull();
  expect(Plan.status[plan]).toBe("failed");
});

test("an exhausted speak-and-observe plan is reconsidered at a bounded cadence rather than restarted every two seconds", async () => {
  jest.useFakeTimers(); jest.setSystemTime(100_000);
  const f = fixture();
  const social = createPlanEntity(f.world, f.mara, f.goal, {
    ...askKey, steps: [...askKey.steps, { description: "I should listen to Ivo's response.", actionType: "observe", target: "Ivo" }],
  });
  advancePlanStep(social); advancePlanStep(social);
  const generate = jest.fn(async () => askKey);
  jest.setSystemTime(102_001);
  await runPlanningSystem(f.world, { agentEids: [f.mara], planGenerator: generate });
  expect(generate).not.toHaveBeenCalled();
  expect(Goal.status[f.goal]).toBe("active");
  jest.setSystemTime(130_001);
  await runPlanningSystem(f.world, { agentEids: [f.mara], planGenerator: generate });
  expect(generate).toHaveBeenCalledTimes(1);
});

test.each(["completed", "detached"])("plans stop appearing active when their goal is %s", state => {
  const f = fixture();
  createPlanEntity(f.world, f.mara, f.goal, askKey);
  if (state === "completed") Goal.status[f.goal] = "completed";
  else removeComponent(f.world, f.mara, HasGoal(f.goal));
  expect(getAgentPlans(f.world, f.mara)).toEqual([]);
  expect(getNextPlannedAction(f.world, f.mara)).toBeNull();
});

test.each<PlanStep["actionType"]>(["speak", "observe", "think", "wait"])("new heard dialogue retires a stale social %s step before it enters context", actionType => {
  const f = fixture();
  const id = createPlanEntity(f.world, f.mara, f.goal, { ...askKey, steps: [askKey.steps[0], {
    description: "STALE: wait for Ivo's answer", actionType,
    ...(actionType === "observe" || actionType === "speak" ? { target: "Ivo" } : {}),
    ...(actionType === "think" || actionType === "speak" ? { content: "I am waiting for his answer." } : {}),
  }] });
  advancePlanStep(id);
  recordCommittedSpeech(f.world, f.ivo, "I have the key already.", "Mara");
  expect(formatPlansForContext(f.world, f.mara)).not.toContain("STALE: wait for Ivo's answer");
  expect(Plan.status[id]).toBe("active"); // Context projection has no authority to retire plans.
  expect(getNextPlannedAction(f.world, f.mara)).toBeNull();
  expect(Plan.status[id]).toBe("failed");
  expect(Goal.status[f.goal]).toBe("active");
});

test("own planned speech does not invalidate the following listening step", () => {
  const f = fixture();
  const id = createPlanEntity(f.world, f.mara, f.goal, { ...askKey, steps: [...askKey.steps, {
    description: "I should listen to Ivo.", actionType: "observe", target: "Ivo",
  }] });
  f.speak(f.mara, "Ivo", askKey.steps[0].content!);
  expect(Plan.currentStep[id]).toBe(1);
  expect(getNextPlannedAction(f.world, f.mara)).toMatchObject({ actionType: "observe", target: "Ivo" });
  expect(Plan.status[id]).toBe("active");
});

test("own speech and history trimming do not masquerade as newly heard dialogue", () => {
  const f = fixture();
  recordCommittedSpeech(f.world, f.ivo, "I heard you.", "Mara");
  const id = createPlanEntity(f.world, f.mara, f.goal, { ...askKey, steps: [
    { description: "Listen for Ivo's next response", actionType: "observe", target: "Ivo" },
  ] });
  for (let index = 0; index < 50; index++) recordCommittedSpeech(f.world, f.mara, `My own turn ${index}.`, "Ivo");
  expect(getNextPlannedAction(f.world, f.mara)).toMatchObject({ actionType: "observe", planEid: id });
  recordCommittedSpeech(f.world, f.ivo, "Here is my new answer.", "Mara");
  expect(getNextPlannedAction(f.world, f.mara)).toBeNull();
});

test.each<PlanStep>([
  { description: "Inspect this room.", actionType: "observe", target: "Common Room" },
  { description: "Go to the utility room.", actionType: "move", target: "Utility Room" },
])("new heard dialogue preserves physical step $actionType $target", step => {
  const f = fixture();
  const id = createPlanEntity(f.world, f.mara, f.goal, { ...askKey, steps: [step] });
  recordCommittedSpeech(f.world, f.ivo, "I have the key.", "Mara");
  expect(getNextPlannedAction(f.world, f.mara)).toMatchObject({ actionType: step.actionType, target: step.target, planEid: id });
  expect(Plan.status[id]).toBe("active");
});

test("a plain character-inspection alias has the same dialogue invalidation as observing that character", () => {
  const f = fixture();
  const id = createPlanEntity(f.world, f.mara, f.goal, { ...askKey, steps: [
    { description: "Examine Ivo's visible appearance.", actionType: "interact", target: "Ivo", content: "examine" },
  ] });
  expect(getNextPlannedAction(f.world, f.mara)).toMatchObject({ actionType: "observe", target: "Ivo", planEid: id });
  recordCommittedSpeech(f.world, f.ivo, "I have the key.", "Mara");
  expect(getNextPlannedAction(f.world, f.mara)).toBeNull();
  expect(Plan.status[id]).toBe("failed");
  expect(Goal.status[f.goal]).toBe("active");
});

test("new heard dialogue does not invalidate thinking within a physical plan", () => {
  const f = fixture();
  const id = createPlanEntity(f.world, f.mara, f.goal, { ...askKey, steps: [
    { description: "Inspect the room.", actionType: "observe", target: "Common Room" },
    { description: "Consider the physical inspection.", actionType: "think", content: "The lamp needs a closer look." },
  ] });
  advancePlanStep(id);
  recordCommittedSpeech(f.world, f.ivo, "I have the key.", "Mara");
  expect(getNextPlannedAction(f.world, f.mara)).toMatchObject({ actionType: "think", planEid: id });
});

test.each(["heard", "own"])("an in-flight observe-only social plan reacts to %s speech", async source => {
  const f = fixture();
  let resolve!: (plan: GeneratedPlan) => void;
  const pending = new Promise<GeneratedPlan>(done => { resolve = done; });
  const running = runPlanningSystem(f.world, { agentEids: [f.mara], planGenerator: () => pending });
  recordCommittedSpeech(f.world, source === "heard" ? f.ivo : f.mara, "A new spoken turn.", source === "heard" ? "Mara" : "Ivo");
  resolve({ ...askKey, steps: [{ description: "Listen for Ivo's answer.", actionType: "observe", target: "Ivo" }] });
  await running;
  expect(getPlanForGoal(f.world, f.mara, f.goal)).toBeUndefined();
});

test("plan evidence serializes as an event ID, without another copy of private dialogue", () => {
  const f = fixture();
  const heard = recordCommittedSpeech(f.world, f.ivo, "A spoken planning fact.", "Mara")!;
  const id = createPlanEntity(f.world, f.mara, f.goal, askKey);
  const saved = serializeWorld(f.world, createSystemRegistry());
  const data = saved.entities.find(entity => entity.id === id)!.components.Plan;
  expect(data.heardDialogueId).toBe(heard.id);
  expect(data.heardDialogueId).not.toContain("A spoken planning fact");
});

test.each(["social", "physical"])("legacy %s plan with absent heard-turn evidence is handled safely", kind => {
  const f = fixture();
  const id = createPlanEntity(f.world, f.mara, f.goal, kind === "social" ? askKey : { ...askKey, steps: [
    { description: "Go inspect.", actionType: "move", target: "Utility Room" },
  ] });
  delete Plan.heardDialogueId[id]; // Older saved Plan data predates this field.
  if (kind === "social") {
    expect(getNextPlannedAction(f.world, f.mara)).toBeNull();
    expect(Plan.status[id]).toBe("failed");
  } else {
    expect(getNextPlannedAction(f.world, f.mara)).toMatchObject({ actionType: "move" });
    expect(Plan.status[id]).toBe("active");
  }
});

test("readiness is pure while the planning scheduler can retire stale social work without an inference call", async () => {
  const f = fixture(); f.world.meta.aiEnabled = true;
  const id = createPlanEntity(f.world, f.mara, f.goal, askKey);
  const updated = Plan.lastUpdated[id];
  recordCommittedSpeech(f.world, f.ivo, "I already have the key.", "Mara");
  expect(hasPendingPlanning(f.world, f.mara)).toBe(true);
  expect(formatPlansForContext(f.world, f.mara)).toContain("needs reconsideration");
  expect(Plan.status[id]).toBe("active");
  expect(Plan.lastUpdated[id]).toBe(updated);
  const generate = jest.fn(async () => askKey);
  await runPlanningSystem(f.world, { agentEids: [f.mara], planGenerator: generate });
  expect(Plan.status[id]).toBe("failed");
  expect(generate).not.toHaveBeenCalled();
});
