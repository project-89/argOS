import { jest } from "@jest/globals";
import { addComponent, addEntity, hasComponent } from "bitecs";
import { Agent, Goal, Memory, Plan, ProcedureState } from "../../ecs/components";
import { HasGoal, HasMemory, HasPlan } from "../../ecs/relations";
import { createArgosWorld } from "../../ecs/world";
import { selectProceduralAction, serializeProceduralSkillV1, tryStartProcedureExecution,
  type ProceduralSkillV1 } from "../procedural-skills";
import { getWorkingMemory } from "../working-memory";

const wait = { description: "Wait for a local signal", actionType: "wait",
  waitUntil: { kind: "physical_fact", subject: "Signal", predicate: "state", slot: "ObjectState.current", equals: "ready" } };
const act = { description: "Work on the task", actionType: "think", content: "Work on the task." };

function fixture() {
  const world = createArgosWorld("Conditional habits"), actor = addEntity(world);
  addComponent(world, actor, Agent); Agent.active[actor] = true;
  const goal = (description = "Investigate", priority = 5) => {
    const id = addEntity(world); addComponent(world, id, Goal); addComponent(world, actor, HasGoal(id));
    Goal.description[id] = description; Goal.status[id] = "active"; Goal.priority[id] = priority;
    Goal.progress[id] = 0; Goal.signature[id] = ""; Goal.kind[id] = ""; Goal.successJson[id] = "";
    return id;
  };
  const mainGoal = goal();
  const plan = (steps: unknown[], status = "active", ownerGoal = mainGoal) => {
    const id = addEntity(world); addComponent(world, id, Plan); addComponent(world, actor, HasPlan(id));
    Plan.goalEid[id] = ownerGoal; Plan.steps[id] = JSON.stringify(steps); Plan.status[id] = status;
    Plan.createdAt[id] = Date.now(); Plan.lastUpdated[id] = Date.now(); Plan.currentStep[id] = 0;
    return id;
  };
  const skill = (signature = "goal:investigate|fixture") => {
    const value: ProceduralSkillV1 = { kind: "procedure_v1", signature, name: "An earlier successful habit",
      trigger: { affordance: signature.startsWith("goal:") ? "__goal_macro__" : "local_skill" },
      steps: [{ type: "think", content: "Old first step" }, { type: "think", content: "Old second step" }],
      stats: { successes: 2, failures: 0, createdAt: Date.now(), lastUsedAt: Date.now() } };
    const id = addEntity(world); addComponent(world, id, Memory); addComponent(world, actor, HasMemory(id));
    Memory.type[id] = "procedural"; Memory.content[id] = serializeProceduralSkillV1(value);
    return { id, signature };
  };
  return { world, actor, mainGoal, goal, plan, skill };
}

beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(100_000);
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline procedural tests cannot call a model"));
});
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); jest.useRealTimers(); });

test.each(["active", "failed", "completed", "awaiting_evidence"])("a selected %s conditional plan cannot auto-start an older flat macro", status => {
  const f = fixture(); f.skill(); const plan = f.plan([wait, act], status);
  const stepsBefore = Plan.steps[plan], memoryBefore = getWorkingMemory(f.world, f.actor);
  for (let i = 0; i < 3; i++) expect(selectProceduralAction(f.world, f.actor)).toBeNull();
  expect(hasComponent(f.world, f.actor, ProcedureState)).toBe(false);
  expect(Plan.steps[plan]).toBe(stepsBefore); expect(Plan.currentStep[plan]).toBe(0);
  expect(Plan.status[plan]).toBe(status); expect(Goal.progress[f.mainGoal]).toBe(0);
  expect(getWorkingMemory(f.world, f.actor)).toEqual(memoryBefore);
});

test.each(["goal:investigate|fixture", "local_skill|fixture"])("an already-running %s pauses before any cursor or progress mutation", signature => {
  const f = fixture(), skill = f.skill(signature); tryStartProcedureExecution(f.world, f.actor, skill.signature);
  ProcedureState.stepIndex[f.actor] = 1;
  const oldPlan = f.plan([act, wait, act]);
  const before = Memory.content[skill.id], startedAt = ProcedureState.startedAt[f.actor], updatedAt = ProcedureState.lastUpdatedAt[f.actor];
  const progressBefore = Goal.progress[f.mainGoal];
  expect(selectProceduralAction(f.world, f.actor)).toBeNull();
  expect(ProcedureState.stepIndex[f.actor]).toBe(1); expect(ProcedureState.startedAt[f.actor]).toBe(startedAt);
  expect(ProcedureState.lastUpdatedAt[f.actor]).toBe(updatedAt); expect(Memory.content[skill.id]).toBe(before);
  expect(Plan.currentStep[oldPlan]).toBe(0); expect(Goal.progress[f.mainGoal]).toBe(progressBefore);
  // Fresh deliberation can replace the conditional episode. The earlier
  // procedure remains intact, rather than being misrecorded as a failed action.
  Plan.status[oldPlan] = "failed"; jest.setSystemTime(101_000); f.plan([act]);
  expect(selectProceduralAction(f.world, f.actor)).toMatchObject({ type: "think", content: "Old second step" });
});

test.each([{ steps: [{ description: "Uncertainty", actionType: "wait" }] }, { steps: [act, wait] }, { steps: [wait, act] }])("past, future and untyped waits all preserve the condition boundary (%j)", ({ steps }) => {
  const f = fixture(), skill = f.skill(); tryStartProcedureExecution(f.world, f.actor, skill.signature);
  const plan = f.plan(steps); Plan.currentStep[plan] = steps.length - 1;
  expect(selectProceduralAction(f.world, f.actor)).toBeNull();
  expect(ProcedureState.stepIndex[f.actor]).toBe(0); expect(Plan.currentStep[plan]).toBe(steps.length - 1);
});

test("a conditional plan on a lower-priority goal does not block the selected urgent goal's habit", () => {
  const f = fixture(); f.plan([wait]); const urgent = f.goal("Leave danger", 10);
  const skill = f.skill("goal:leave danger|fixture"); tryStartProcedureExecution(f.world, f.actor, skill.signature);
  const progressBefore = Goal.progress[urgent];
  expect(selectProceduralAction(f.world, f.actor)).toMatchObject({ type: "think", content: "Old first step" });
  expect(Goal.progress[urgent]).toBe(progressBefore);
});

test("a failed old conditional plan stops blocking after an unconditional replacement is selected", () => {
  const f = fixture(), skill = f.skill(); f.plan([wait], "failed");
  expect(selectProceduralAction(f.world, f.actor)).toBeNull();
  jest.setSystemTime(101_000); f.plan([], "failed");
  expect(selectProceduralAction(f.world, f.actor)).toMatchObject({ type: "think", content: "Old first step" });
  expect(ProcedureState.signature[f.actor]).toBe(skill.signature);
});

test("a policy cannot start a blocked macro and turn reconsideration into a native wait", () => {
  const f = fixture(), skill = f.skill(), plan = f.plan([wait, act]);
  const stepsBefore = Plan.steps[plan], memoryBefore = Memory.content[skill.id];
  expect(tryStartProcedureExecution(f.world, f.actor, skill.signature)).toBe(false);
  expect(hasComponent(f.world, f.actor, ProcedureState)).toBe(false);
  expect(Goal.progress[f.mainGoal]).toBe(0); expect(Plan.steps[plan]).toBe(stepsBefore);
  expect(Memory.content[skill.id]).toBe(memoryBefore);
});

test("malformed selected plan metadata cannot authorize a flat fallback", () => {
  const f = fixture(), skill = f.skill(); tryStartProcedureExecution(f.world, f.actor, skill.signature);
  const plan = f.plan([]);
  for (const invalid of ["{", "null", '{"waitUntil":{}}', '[null]', JSON.stringify([{ ...act, waitUntil: { forged: true } }])]) {
    Plan.steps[plan] = invalid;
    expect(selectProceduralAction(f.world, f.actor)).toBeNull(); expect(Plan.steps[plan]).toBe(invalid);
    expect(ProcedureState.stepIndex[f.actor]).toBe(0);
  }
});
