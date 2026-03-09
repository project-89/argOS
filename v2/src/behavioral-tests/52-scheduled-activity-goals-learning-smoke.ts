/**
 * Behavioral Test: scheduled activity goals (meals/sleep) -> deterministic plans -> procedural learning.
 *
 * Validates:
 * - ScheduledActivityGoals creates a typed scheduled_activity goal + move_to_room subgoal
 * - ScheduledActivityTemplatePlanner creates a 2-step plan (observe -> interact) once in room
 * - AgentThink executes plan steps deterministically (no LLM)
 * - GoalEvaluation completes the goal via contract
 * - Completed plan compiles into a goal macro (procedural memory)
 */
import "dotenv/config";

import { getRelationTargets } from "bitecs";

import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity, createObjectEntity } from "../ecs/prefabs";
import { Agent, Goal, Needs, Plan, ProcedureState } from "../ecs/components";
import { HasGoal, HasPlan } from "../ecs/relations";
import { getRoomForEntity, setLocatedIn } from "../ecs/location";
import { initializeSchedule } from "../cognition/schedule-system";
import { agentThink } from "../cognition/agent-mind";
import { executeActions } from "../cognition/cognition-system";
import { getAgentProceduralSkills } from "../cognition/procedural-skills";

import { createSystemRegistry, registerSystem, runSystems } from "../ecs/dynamic-systems";
import { createGoalEvaluationSystem, createGoalPursuitSystem } from "../systems/builtin-systems";
import { createScheduledActivityGoalSystem, createScheduledActivityTemplatePlannerSystem } from "../systems/scheduled-activity-systems";

function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

async function main() {
  const prevKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  const world = createArgosWorld("ScheduledActivityGoalsLearningSmoke") as any;
  initializePrefabs(world);

  const roomHome = createRoomEntity(world, { name: "Home" });
  const roomTavern = createRoomEntity(world, { name: "The Golden Wheat" });
  const roomElse = createRoomEntity(world, { name: "Road" });

  // Targets for affordances.
  createObjectEntity(world, { name: "Test Cot", roomId: roomHome, portable: false, traits: ["sleepable"] });
  createObjectEntity(world, { name: "Test Bread", roomId: roomTavern, portable: true, traits: ["edible"] });

  const agentEid = createAgentEntity(world, { name: "Ada", role: "baker", systemPrompt: "x", roomId: roomElse });
  Agent.active[agentEid] = true;
  Needs.hunger[agentEid] = 90;
  Needs.energy[agentEid] = 90;

  // Controlled schedule: breakfast at 8, sleep at 22.
  initializeSchedule(
    world,
    agentEid,
    [
      { name: "breakfast", startHour: 8, duration: 1, location: "The Golden Wheat", priority: 7, interruptible: true },
      { name: "sleep", startHour: 22, duration: 2, location: "Home", priority: 9, interruptible: false },
    ],
    0.2
  );

  const registry = createSystemRegistry();

  const scheduledGoals = createScheduledActivityGoalSystem();
  scheduledGoals.frequency = 0;
  registerSystem(registry as any, scheduledGoals as any);

  const scheduledPlanner = createScheduledActivityTemplatePlannerSystem();
  scheduledPlanner.frequency = 0;
  registerSystem(registry as any, scheduledPlanner as any);

  const goalPursuit = createGoalPursuitSystem();
  goalPursuit.frequency = 0;
  registerSystem(registry as any, goalPursuit as any);

  const goalEval = createGoalEvaluationSystem();
  goalEval.frequency = 0;
  registerSystem(registry as any, goalEval as any);

  // === Phase 1: breakfast goal created + executed ===
  world.time.simulationHour = 8;

  let completedBreakfast = false;
  for (let tick = 0; tick < 40; tick++) {
    runSystems(world as any, registry as any, tick, 16);

    // Let the agent execute any planned step.
    const action = await agentThink(world as any, agentEid);
    executeActions(world as any, [{ eid: agentEid, action }], registry as any);

    runSystems(world as any, registry as any, tick, 16);
    const allGoalEids = getRelationTargets(world as any, agentEid, HasGoal as any) as number[];
    const activeScheduled = allGoalEids.filter((g) => String(Goal.kind[g] || "") === "scheduled_activity");
    if (activeScheduled.some((g) => String(Goal.status[g] || "") === "completed")) {
      completedBreakfast = true;
      break;
    }
  }

  assert(completedBreakfast, "expected breakfast scheduled_activity goal to complete");
  assert(getRoomForEntity(world as any, agentEid) === roomTavern, "expected agent to end up at the tavern for breakfast");

  // Confirm procedural macro compiled.
  const macrosAfterBreakfast = getAgentProceduralSkills(world as any, agentEid)
    .map((s) => s.skill)
    .filter((s) => String(s.trigger?.affordance || "") === "__goal_macro__");
  assert(macrosAfterBreakfast.length > 0, "expected at least one goal macro to be learned after breakfast");

  // === Phase 2: re-run breakfast with learned macro (no plan) ===
  // Replenish food so the scheduled activity goal can be created again.
  createObjectEntity(world, { name: "Test Bread 2", roomId: roomTavern, portable: true, traits: ["edible"] });

  // Remove any active plans (template planner should skip if macro exists; this makes the behavior obvious).
  const planEids = getRelationTargets(world as any, agentEid, HasPlan as any) as number[];
  for (const peid of planEids) {
    if (Plan.status[peid] === "active") Plan.status[peid] = "completed";
  }

  // Clear old goals and create a fresh scheduled_activity goal by rerunning systems at the same hour.
  // (In the real sim this happens naturally when time advances.)
  for (const goalEid of getRelationTargets(world as any, agentEid, HasGoal as any) as number[]) {
    if (String(Goal.kind[goalEid] || "") === "scheduled_activity") {
      Goal.status[goalEid] = "completed";
    }
  }

  // Move agent away and reset needs so the goal is meaningful again.
  world.time.simulationHour = 8;
  setLocatedIn(world as any, agentEid, roomElse);
  Needs.hunger[agentEid] = 90;

  // Run a couple ticks: macro should auto-start (ProcedureState set) once the new goal appears and no plan exists.
  let sawProcedure = false;
  for (let tick = 0; tick < 20; tick++) {
    runSystems(world as any, registry as any, 100 + tick, 16);
    const action = await agentThink(world as any, agentEid);
    executeActions(world as any, [{ eid: agentEid, action }], registry as any);
    runSystems(world as any, registry as any, 100 + tick, 16);
    if (ProcedureState.status[agentEid] === "active") {
      sawProcedure = true;
      break;
    }
  }

  assert(sawProcedure, "expected learned goal macro to auto-start (ProcedureState active)");

  if (prevKey) process.env.GOOGLE_GENERATIVE_AI_API_KEY = prevKey;
  console.log("✓ scheduled activity goals learning smoke passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
