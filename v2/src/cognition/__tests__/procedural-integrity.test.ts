import { jest } from "@jest/globals";
import { addEntity, addComponent, hasComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { Agent, Goal, Memory, Perception, Plan, ProcedureState } from "../../ecs/components";
import { HasGoal, HasMemory, HasPerception, HasPlan } from "../../ecs/relations";
import { compileCompletedPlanToProceduralMacro } from "../plan-compiler";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { expireStaleGoals } from "../autonomous-goals";
import { readGoalAttemptActivity } from "../goal-attempt";
import { serializeProceduralSkillV1, parseProceduralSkillV1, selectProceduralAction, onProcedureActionResult, tryStartProcedureExecution, type ProceduralSkillV1 } from "../procedural-skills";

function fixture(steps: ProceduralSkillV1["steps"], signature = "test|skill") {
  const world = createArgosWorld("procedure proof"); const agent = addEntity(world); addComponent(world, agent, Agent); Agent.active[agent] = true;
  const skill: ProceduralSkillV1 = { kind: "procedure_v1", signature, name: "test", trigger: { affordance: signature.startsWith("goal:") ? "__goal_macro__" : "test" },
    steps, stats: { successes: 2, failures: 0, createdAt: Date.now(), lastUsedAt: Date.now() } };
  const memory = addEntity(world); addComponent(world, memory, Memory); addComponent(world, agent, HasMemory(memory));
  Memory.type[memory] = "procedural"; Memory.content[memory] = serializeProceduralSkillV1(skill);
  function goal(desc: string, priority: number) {
    const id = addEntity(world); addComponent(world, id, Goal); addComponent(world, agent, HasGoal(id));
    Goal.description[id] = desc; Goal.status[id] = "active"; Goal.priority[id] = priority; Goal.progress[id] = 0; Goal.signature[id] = ""; Goal.kind[id] = ""; Goal.successJson[id] = "";
    return id;
  }
  function perception(content: string, timestamp: number) {
    const id = addEntity(world); addComponent(world, id, Perception); addComponent(world, agent, HasPerception(id));
    Perception.type[id] = "tool_result"; Perception.content[id] = content; Perception.timestamp[id] = timestamp; return id;
  }
  return { world, agent, skill, goal, perception };
}

describe("Procedural replay integrity", () => {
  afterEach(() => jest.useRealTimers());

  test("pauses a lower-priority goal macro, then resumes its cursor", () => {
    const f = fixture([{ type: "think", content: "First" }, { type: "think", content: "Second" }], "goal:investigate|abc");
    f.goal("Investigate", 5); expect(tryStartProcedureExecution(f.world, f.agent, f.skill.signature)).toBe(true);
    onProcedureActionResult(f.world, f.agent, { type: "think", content: "First" }, { success: true });
    const urgent = f.goal("Escape fire", 10);
    expect(selectProceduralAction(f.world, f.agent)).toBeNull(); expect(ProcedureState.stepIndex[f.agent]).toBe(1);
    Goal.status[urgent] = "completed";
    expect(selectProceduralAction(f.world, f.agent)).toEqual({ type: "think", target: undefined, content: "Second" });
  });

  test("macro exhaustion does not fabricate custom-goal success or restart endlessly", () => {
    const f = fixture([{ type: "think", content: "Done" }], "goal:investigate|abc"); const goal = f.goal("Investigate", 5);
    tryStartProcedureExecution(f.world, f.agent, f.skill.signature);
    onProcedureActionResult(f.world, f.agent, { type: "think", content: "Done" }, { success: true });
    expect(Goal.status[goal]).toBe("active"); expect(Goal.progress[goal]).toBe(0);
    expect(selectProceduralAction(f.world, f.agent)).toBeNull(); expect(hasComponent(f.world, f.agent, ProcedureState)).toBe(false);
    expect(tryStartProcedureExecution(f.world, f.agent, f.skill.signature)).toBe(false);
  });

  test("real macro steps renew inactivity separately from objective progress", () => {
    const f = fixture([{ type: "think", content: "First" }, { type: "think", content: "Second" }, { type: "think", content: "Third" }], "goal:investigate|activity");
    const goal = f.goal("Investigate", 5); Goal.createdAt[goal] = Date.now();
    expect(expireStaleGoals(f.world, f.agent, 60_000)).toBe(0);
    tryStartProcedureExecution(f.world, f.agent, f.skill.signature);
    advanceSimulationTime(f.world, 1, 59_000);
    onProcedureActionResult(f.world, f.agent, { type: "think", content: "First" }, { success: true });
    expect(Goal.progress[goal]).toBe(0);
    expect(expireStaleGoals(f.world, f.agent, 60_000)).toBe(0);
    advanceSimulationTime(f.world, 2, 59_000);
    onProcedureActionResult(f.world, f.agent, { type: "think", content: "Second" }, { success: true });
    expect(expireStaleGoals(f.world, f.agent, 60_000)).toBe(0);
    advanceSimulationTime(f.world, 3, 60_001);
    expect(expireStaleGoals(f.world, f.agent, 60_000)).toBe(1);
  });

  test("an exhausted wait-only macro inhibits replay but does not earn activity", () => {
    const f = fixture([{ type: "wait" }], "goal:investigate|waiting"); const goal = f.goal("Investigate", 5);
    expect(tryStartProcedureExecution(f.world, f.agent, f.skill.signature)).toBe(true);
    advanceSimulationTime(f.world, 1, 10_000);
    onProcedureActionResult(f.world, f.agent, { type: "wait" }, { success: true });
    expect(readGoalAttemptActivity(f.world, f.agent, goal)).toBeUndefined();
    expect(Goal.progress[goal]).toBe(0);
    expect(tryStartProcedureExecution(f.world, f.agent, f.skill.signature)).toBe(false);
  });

  test("await ignores old perceptions from before this execution", () => {
    jest.useFakeTimers(); jest.setSystemTime(1_000);
    const f = fixture([{ type: "await", waitFor: { perceptionType: "tool_result", includes: "PASS" } }, { type: "think", content: "Verified" }]);
    f.perception("PASS", 900); tryStartProcedureExecution(f.world, f.agent, f.skill.signature);
    expect(selectProceduralAction(f.world, f.agent)).toEqual({ type: "wait" }); expect(ProcedureState.stepIndex[f.agent]).toBe(0);
    f.perception("PASS", 1_001);
    expect(selectProceduralAction(f.world, f.agent)?.content).toBe("Verified");
  });

  test("a cyclic await graph yields rather than freezing the simulation", () => {
    jest.useFakeTimers(); jest.setSystemTime(1_000);
    const f = fixture([{ type: "await", waitFor: { perceptionType: "tool_result" }, onMatchNext: 0 }]);
    f.perception("PASS", 1_000); tryStartProcedureExecution(f.world, f.agent, f.skill.signature);
    expect(selectProceduralAction(f.world, f.agent)).toBeNull(); expect(hasComponent(f.world, f.agent, ProcedureState)).toBe(false);
  });

  test.each([-1, 1.5, 99])("rejects invalid branch destination %s", next => {
    const f = fixture([{ type: "think", content: "Think", onSuccessNext: next }]);
    expect(parseProceduralSkillV1(serializeProceduralSkillV1(f.skill))).toBeNull();
  });

  test("unverified and mismatched plans cannot be learned as successes", () => {
    const f = fixture([{ type: "think", content: "Think" }]); const goal = f.goal("Verify safety", 5);
    const plan = addEntity(f.world); addComponent(f.world, plan, Plan); addComponent(f.world, f.agent, HasPlan(plan));
    Plan.goalEid[plan] = goal; Plan.status[plan] = "completed"; Plan.steps[plan] = JSON.stringify([
      { actionType: "think", content: "I should check" }, { actionType: "think", content: "I checked" },
    ]);
    expect(compileCompletedPlanToProceduralMacro(f.world, f.agent, goal, plan)).toEqual({ ok: false, reason: "goal success not verified" });
    Goal.status[goal] = "completed"; Plan.goalEid[plan] = goal + 10;
    expect(compileCompletedPlanToProceduralMacro(f.world, f.agent, goal, plan)).toEqual({ ok: false, reason: "plan/goal ownership mismatch" });
  });
});
