import "dotenv/config";

import { addComponent, addEntity, hasComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { Goal, Plan, ProcedureState } from "../../ecs/components";
import { HasGoal, HasPlan } from "../../ecs/relations";
import { setGoalContract } from "../goal-contract";
import { compileCompletedPlanToProceduralMacro } from "../plan-compiler";
import { agentThink } from "../agent-mind";
import { getProceduralSkillBySignature } from "../procedural-skills";

describe("Plan compiler → procedural macro learning", () => {
  test("compiles a completed plan and auto-starts it for the same goal later", async () => {
    const prevKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

    const world = createArgosWorld("PlanCompilerTest") as any;
    initializePrefabs(world);

    const startRoom = createRoomEntity(world, { name: "Start Room" });
    const targetRoom = createRoomEntity(world, { name: "Target Room" });

    const agentEid = createAgentEntity(world, { name: "Maya", role: "npc", systemPrompt: "x", roomId: startRoom });

    // First run: a goal + a completed plan.
    const goal1 = addEntity(world);
    addComponent(world, goal1, Goal as any);
    addComponent(world, agentEid, HasGoal(goal1) as any);
    Goal.description[goal1] = "Deliver the package to Target Room";
    Goal.priority[goal1] = 9;
    Goal.status[goal1] = "active";
    Goal.progress[goal1] = 0;
    setGoalContract(world, goal1, {
      version: 1,
      kind: "custom",
      params: { objective: "deliver_package", destination: "Target Room" },
      success: { type: "custom", description: "delivery confirmed" },
      description: Goal.description[goal1],
    });

    const plan1 = addEntity(world);
    addComponent(world, plan1, Plan as any);
    addComponent(world, agentEid, HasPlan(plan1) as any);
    Plan.goalEid[plan1] = goal1;
    Plan.steps[plan1] = JSON.stringify([
      { description: "Go to the Target Room", actionType: "move", target: "Target Room" },
      { description: "Mentally confirm delivery", actionType: "think", content: "Delivered." },
    ]);
    Plan.currentStep[plan1] = 1;
    Plan.status[plan1] = "completed";

    const compiled = compileCompletedPlanToProceduralMacro(world, agentEid, goal1, plan1);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error("compile failed");
    expect(String(compiled.signature)).toMatch(/^goal(id)?:/);

    const found = getProceduralSkillBySignature(world, agentEid, compiled.signature);
    expect(found).toBeDefined();

    // Mark the old goal completed and create a new active goal with the same description.
    Goal.status[goal1] = "completed";
    const goal2 = addEntity(world);
    addComponent(world, goal2, Goal as any);
    addComponent(world, agentEid, HasGoal(goal2) as any);
    Goal.description[goal2] = "Deliver the package to Target Room";
    Goal.priority[goal2] = 9;
    Goal.status[goal2] = "active";
    Goal.progress[goal2] = 0;
    setGoalContract(world, goal2, {
      version: 1,
      kind: "custom",
      params: { objective: "deliver_package", destination: "Target Room" },
      success: { type: "custom", description: "delivery confirmed" },
      description: Goal.description[goal2],
    });

    // No active plan for goal2, so macro should auto-start and emit the first step.
    const action = await agentThink(world, agentEid);
    expect(action.type).toBe("move");
    expect(action.target).toBe("Target Room");
    expect(hasComponent(world, agentEid, ProcedureState as any)).toBe(true);

    if (prevKey) process.env.GOOGLE_GENERATIVE_AI_API_KEY = prevKey;
  });
});
