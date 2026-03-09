/**
 * Behavioral Test: day-plan activities become accomplishment goals (work/leisure/socialize) with deterministic execution.
 *
 * Validates:
 * - ScheduledActivityGoals creates scheduled_activity goals beyond meals/sleep (work/leisure/socialize)
 * - ScheduledActivityTemplatePlanner creates simple grounded plans for each activity
 * - AgentThink executes the plan deterministically (no LLM)
 * - GoalEvaluation completes each activity goal via contract
 * - Completed plans compile into goal macros (procedural learning)
 *
 * Run:
 *   npx tsx src/behavioral-tests/53-scheduled-activity-dayplan-smoke.ts
 */
import "dotenv/config";

import { getRelationTargets } from "bitecs";

import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity, createObjectEntity } from "../ecs/prefabs";
import { Agent, Goal, Needs } from "../ecs/components";
import { HasGoal } from "../ecs/relations";
import { getRoomForEntity } from "../ecs/location";
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

function hasCompletedScheduledActivity(world: any, agentEid: number, activityType: string, labelIncludes?: string): boolean {
  const goalEids = getRelationTargets(world as any, agentEid, HasGoal as any) as number[];
  for (const gid of goalEids) {
    if (String(Goal.kind[gid] || "") !== "scheduled_activity") continue;
    if (String(Goal.status[gid] || "") !== "completed") continue;
    try {
      const params = JSON.parse(String(Goal.paramsJson[gid] || "{}"));
      if (String(params?.activityType || "") !== activityType) continue;
      if (labelIncludes) {
        const label = String(params?.label || "");
        if (!label.toLowerCase().includes(labelIncludes.toLowerCase())) continue;
      }
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

async function runUntilCompleted(world: any, registry: any, agentEid: number, opts: { hour: number; activityType: string; labelIncludes?: string }): Promise<void> {
  world.time.simulationHour = opts.hour;
  for (let tick = 0; tick < 60; tick++) {
    runSystems(world as any, registry as any, tick + opts.hour * 100, 16);
    const action = await agentThink(world as any, agentEid);
    executeActions(world as any, [{ eid: agentEid, action }], registry as any);
    runSystems(world as any, registry as any, tick + opts.hour * 100, 16);
    if (hasCompletedScheduledActivity(world, agentEid, opts.activityType, opts.labelIncludes)) return;
  }
  throw new Error(`expected scheduled_activity to complete: ${opts.activityType} @ hour=${opts.hour}`);
}

async function main() {
  const prevKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  const world = createArgosWorld("ScheduledActivityDayplanSmoke") as any;
  initializePrefabs(world);

  const home = createRoomEntity(world, { name: "Home" });
  const bakery = createRoomEntity(world, { name: "Bakery" });
  const square = createRoomEntity(world, { name: "Town Square" });

  // Objects to ground activities.
  createObjectEntity(world, { name: "Workstation", roomId: bakery, portable: false, traits: ["searchable"] });
  createObjectEntity(world, { name: "Bench", roomId: square, portable: false, traits: ["sittable"] });

  // Social partner present in the square.
  const ben = createAgentEntity(world, { name: "Ben", role: "villager", systemPrompt: "x", roomId: square });
  Agent.active[ben] = true;

  const ada = createAgentEntity(world, { name: "Ada", role: "baker", systemPrompt: "x", roomId: home });
  Agent.active[ada] = true;
  Needs.social[ada] = 10;

  initializeSchedule(
    world,
    ada,
    [
      { name: "work", startHour: 8, duration: 1, location: "Bakery", priority: 8, interruptible: true },
      { name: "leisure", startHour: 17, duration: 1, location: "Town Square", priority: 4, interruptible: true },
      { name: "socialize", startHour: 18, duration: 1, location: "Town Square", priority: 5, interruptible: true },
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

  await runUntilCompleted(world, registry, ada, { hour: 8, activityType: "work_block", labelIncludes: "work" });
  assert(getRoomForEntity(world as any, ada) === bakery, "expected Ada to end up in Bakery for work");

  await runUntilCompleted(world, registry, ada, { hour: 17, activityType: "leisure_block", labelIncludes: "leisure" });
  assert(getRoomForEntity(world as any, ada) === square, "expected Ada to end up in Town Square for leisure");

  await runUntilCompleted(world, registry, ada, { hour: 18, activityType: "socialize_block", labelIncludes: "social" });
  assert(getRoomForEntity(world as any, ada) === square, "expected Ada to be in Town Square for socialize");

  const macros = getAgentProceduralSkills(world as any, ada)
    .map((s) => s.skill)
    .filter((s) => String(s.trigger?.affordance || "") === "__goal_macro__");
  assert(macros.length >= 2, "expected at least two goal macros to be learned across the day-plan activities");

  if (prevKey) process.env.GOOGLE_GENERATIVE_AI_API_KEY = prevKey;
  console.log("✓ scheduled activity day-plan smoke passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

