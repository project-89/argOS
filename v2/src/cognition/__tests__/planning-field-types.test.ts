import { jest } from "@jest/globals";
import { Goal, Plan } from "../../ecs/components";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { setLocatedIn } from "../../ecs/location";
import { createIntentGoal } from "../cognition-system";
import { canonicalPlanStep, checkStepPrerequisites, createPlanEntity, getNextPlannedAction, validateGeneratedPlan, type PlanStep } from "../planning-system";
import { registerAgentWorldCapabilities } from "../world-capabilities";
import { drainPendingStimuli } from "../stimulus-queue";

function fixture() {
  const world = createArgosWorld("Typed plan fields"); world.meta.aiEnabled = false; initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Study" });
  const actor = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "Use literal named targets.", roomId: room });
  createAgentEntity(world, { name: "Bea", role: "resident", systemPrompt: "Use literal named targets.", roomId: room });
  const item = createObjectEntity(world, { name: "123", roomId: room, portable: true });
  const goal = createIntentGoal(world, actor, "Inspect the study", 8);
  const dispose = registerAgentWorldCapabilities(world, actor, { context: () => "", ready: () => true, busy: () => false,
    execute: () => false, affordances: target => target === item ? [{ name: "123", requires: [] }] : [] });
  const proposal = (step: PlanStep) => ({ goalDescription: Goal.description[goal], estimatedCompletion: "short", potentialObstacles: [],
    steps: [{ description: "Consider the evidence", actionType: "think" as const, content: "What should I do next?" }, step] });
  const validate = (step: PlanStep) => validateGeneratedPlan(world, actor, Goal.description[goal], proposal(step));
  return { world, actor, item, goal, dispose, proposal, validate };
}

beforeEach(() => { drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Plan field tests are offline")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli(); });

test.each([123, false, null, ["123"], { value: "123" }])("a non-string target %p cannot become an executable numeric-named item", target => {
  const f = fixture(), step = { description: "Pick up the item", actionType: "pickup", target } as unknown as PlanStep;
  expect(f.validate(step)).toMatchObject({ ok: false, issues: expect.arrayContaining(["target must be a string when provided"]) });
  expect(checkStepPrerequisites(f.world, f.actor, step)).toBe(false);
  const id = createPlanEntity(f.world, f.actor, f.goal, { ...f.proposal(step), steps: [step] });
  expect(getNextPlannedAction(f.world, f.actor)).toBeNull(); expect(Plan.status[id]).toBe("failed"); expect(Plan.currentStep[id]).toBe(0); f.dispose();
});

test.each([123, false, null, ["123"], { value: "123" }])("non-string command content %p cannot become a literal affordance", content => {
  const f = fixture(), step = { description: "Use the numbered control", actionType: "interact", target: "123", content } as unknown as PlanStep;
  expect(f.validate(step)).toMatchObject({ ok: false, issues: expect.arrayContaining(["content must be a string when provided"]) });
  expect(checkStepPrerequisites(f.world, f.actor, step)).toBe(false); f.dispose();
});

test("field rejection does not invoke implicit string conversion or inspection alias coercion", () => {
  const f = fixture(), convert = jest.fn(() => "examine");
  const step = { description: "Malformed control", actionType: "interact", target: "123", content: { toString: convert } } as unknown as PlanStep;
  expect(canonicalPlanStep(step).actionType).toBe("interact"); expect(f.validate(step).ok).toBe(false);
  expect(checkStepPrerequisites(f.world, f.actor, step)).toBe(false); expect(convert).not.toHaveBeenCalled(); f.dispose();
});

test.each(["move", "observe", "interact", "pickup", "drop", "give"] as const)("%s requires a non-blank string target", actionType => {
  const f = fixture(); setLocatedIn(f.world, f.item, f.actor);
  for (const target of [undefined, "", "   "]) {
    const step = { description: "Act on something", actionType, target, content: "123" };
    expect(f.validate(step).issues).toContain(`${actionType} requires target`);
    expect(checkStepPrerequisites(f.world, f.actor, step)).toBe(false);
  }
  f.dispose();
});

test.each(["speak", "think", "interact", "give"] as const)("%s requires non-blank string content", actionType => {
  const f = fixture(); setLocatedIn(f.world, f.item, f.actor);
  for (const content of [undefined, "", "   "]) {
    const step = { description: "Perform an intention", actionType, target: actionType === "give" ? "Bea" : "123", content };
    expect(f.validate(step).issues).toContain(`${actionType} requires content`);
    expect(checkStepPrerequisites(f.world, f.actor, step)).toBe(false);
  }
  f.dispose();
});

test.each([
  { description: "Pause", actionType: "wait" },
  { description: "Pause", actionType: "wait", target: "", content: "" },
  { description: "Think", actionType: "think", content: "I should pay attention." },
  { description: "Speak aloud", actionType: "speak", content: "Hello." },
  { description: "Pick it up", actionType: "pickup", target: "123" },
  { description: "Pick it up", actionType: "pickup", target: "123", content: "" },
] satisfies PlanStep[])("valid optional fields remain valid: $actionType/$content", step => {
  const f = fixture(); expect(f.validate(step).ok).toBe(true); expect(checkStepPrerequisites(f.world, f.actor, step)).toBe(true); f.dispose();
});

test("optional content still must be a string when provided", () => {
  const f = fixture();
  for (const actionType of ["wait", "pickup"] as const) {
    const step = { description: "Malformed optional content", actionType, target: "123", content: 0 } as unknown as PlanStep;
    expect(f.validate(step).ok).toBe(false); expect(checkStepPrerequisites(f.world, f.actor, step)).toBe(false);
  }
  f.dispose();
});
