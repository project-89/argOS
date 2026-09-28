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
  function repeatedEpisodeFixture() {
    const world = createArgosWorld("Stable procedure identity"); initializePrefabs(world);
    const room = createRoomEntity(world, { name: "Start Room" });
    const actor = createAgentEntity(world, { name: "Maya", role: "resident", systemPrompt: "Act from evidence.", roomId: room });
    const other = createAgentEntity(world, { name: "Noah", role: "resident", systemPrompt: "Act from evidence.", roomId: room });
    function episode(owner: number, source: string, speech = "The delivery is complete.", destination = "Target Room", reconciled = false) {
      const goal = addEntity(world); addComponent(world, goal, Goal); addComponent(world, owner, HasGoal(goal));
      setGoalContract(world, goal, { version: 1, kind: "custom", params: { objective: "deliver", destination },
        success: { type: "in_room", roomName: destination }, description: `Deliver to ${destination}` });
      Goal.status[goal] = "completed";
      const plan = addEntity(world); addComponent(world, plan, Plan); addComponent(world, owner, HasPlan(plan));
      Plan.goalEid[plan] = goal; Plan.status[plan] = "completed"; Plan.currentStep[plan] = 1;
      Plan.steps[plan] = JSON.stringify([
        { description: `Episode ${source}: make the delivery`, actionType: "move", target: "Target Room",
          ...(reconciled ? { resolution: { kind: "already_here", sourceId: "own-location", resolvedAt: 1, summary: "Already here" } } : {}) },
        { description: `Episode ${source}: announce it`, actionType: "speak", target: "Caretaker", content: speech,
          ownSpeechDependency: `speech:${source}`, workingMemoryDependency: `evidence:${source}`, planEid: plan, goalEid: goal, currentStep: 1 },
      ]);
      return compileCompletedPlanToProceduralMacro(world, owner, goal, plan);
    }
    return { world, actor, other, episode };
  }

  test("identical executed plans reinforce one macro despite different episode evidence and descriptions", () => {
    const f = repeatedEpisodeFixture();
    const first = f.episode(f.actor, "episode-one"), second = f.episode(f.actor, "episode-two");
    expect(first.ok).toBe(true); expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("Expected both completed episodes to compile");
    expect(second.signature).toBe(first.signature);
    const skill = getProceduralSkillBySignature(f.world, f.actor, first.signature)!;
    expect(skill.skill.stats.successes).toBe(2);
    expect(skill.skill.steps).toEqual([{ type: "move", target: "Target Room" },
      { type: "speak", target: "Caretaker", content: "The delivery is complete." }]);
    expect(JSON.stringify(skill.skill)).not.toContain("episode-one");
    expect(JSON.stringify(skill.skill)).not.toContain("episode-two");
  });

  test("different executable content or goal criteria still identifies a different procedure", () => {
    const f = repeatedEpisodeFixture();
    const original = f.episode(f.actor, "same"), changedAction = f.episode(f.actor, "same", "The package was damaged."),
      changedGoal = f.episode(f.actor, "same", undefined, "Other Room");
    if (!original.ok || !changedAction.ok || !changedGoal.ok) throw new Error("Expected completed episodes to compile");
    expect(changedAction.signature).not.toBe(original.signature);
    expect(changedGoal.signature).not.toBe(original.signature);
  });

  test("stable macro identity never shares an actor's learned statistics or admits reconciled steps", () => {
    const f = repeatedEpisodeFixture();
    const first = f.episode(f.actor, "one"), other = f.episode(f.other, "two");
    if (!first.ok || !other.ok) throw new Error("Expected both completed episodes to compile");
    expect(other.signature).toBe(first.signature);
    const actorSkill = getProceduralSkillBySignature(f.world, f.actor, first.signature)!;
    const otherSkill = getProceduralSkillBySignature(f.world, f.other, other.signature)!;
    expect(otherSkill.memoryEid).not.toBe(actorSkill.memoryEid);
    f.episode(f.actor, "three");
    expect(getProceduralSkillBySignature(f.world, f.actor, first.signature)!.skill.stats.successes).toBe(2);
    expect(getProceduralSkillBySignature(f.world, f.other, other.signature)!.skill.stats.successes).toBe(1);
    expect(f.episode(f.actor, "covered", undefined, undefined, true)).toEqual({ ok: false, reason: "plan includes reconciled rather than executed steps" });
  });

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

    // Objective verification is independent of merely exhausting the plan.
    Goal.status[goal1] = "completed";
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
