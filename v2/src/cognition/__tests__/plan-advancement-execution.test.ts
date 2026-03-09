import "dotenv/config";

import { addComponent, addEntity } from "bitecs";

import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { Goal, Plan } from "../../ecs/components";
import { HasGoal } from "../../ecs/relations";
import { createPlanEntity, type GeneratedPlan } from "../planning-system";
import { executeActions } from "../cognition-system";

describe("Plan advancement (execution)", () => {
  test("does not advance an interact step when the target is missing (action failed)", () => {
    const world = createArgosWorld("PlanAdvanceGate") as any;
    initializePrefabs(world);
    const registry = createSystemRegistry();

    const room = createRoomEntity(world, { name: "Room" });
    const agent = createAgentEntity(world, { name: "Noah", role: "npc", systemPrompt: "x", roomId: room });

    const goalEid = addEntity(world);
    addComponent(world, goalEid, Goal);
    addComponent(world, agent, HasGoal(goalEid));
    Goal.description[goalEid] = "Use the workstation.";
    Goal.priority[goalEid] = 10;
    Goal.status[goalEid] = "active";
    Goal.progress[goalEid] = 0;
    Goal.deadline[goalEid] = 0;
    Goal.createdAt[goalEid] = Date.now();

    const generated: GeneratedPlan = {
      goalDescription: Goal.description[goalEid],
      steps: [{ description: "Run a command", actionType: "interact", target: "Workstation", content: "run_command: echo hello" }],
      estimatedCompletion: "short",
      potentialObstacles: [],
    };
    const planEid = createPlanEntity(world, agent, goalEid, generated);

    expect(Plan.status[planEid]).toBe("active");
    expect(Plan.currentStep[planEid]).toBe(0);

    executeActions(world, [{ eid: agent, action: { type: "interact", target: "Workstation", content: "run_command: echo hello" } }], registry as any);

    // Since the target does not exist as an entity, the interact action should fail and should NOT advance the plan step.
    expect(Plan.status[planEid]).toBe("active");
    expect(Plan.currentStep[planEid]).toBe(0);
    expect(Goal.status[goalEid]).toBe("active");
  });
});

