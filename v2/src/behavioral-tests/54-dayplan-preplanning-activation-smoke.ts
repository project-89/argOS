/**
 * Behavioral Test: day preplanning seeds queued activity goals and activates them at the right time.
 *
 * Validates:
 * - DayPlanPreplanner creates queued scheduled_activity goals for the whole schedule
 * - DayPlanActivation flips the right goal to active when its time window starts
 * - The active goal can be completed via deterministic plan execution + goal evaluation
 *
 * Run:
 *   npx tsx src/behavioral-tests/54-dayplan-preplanning-activation-smoke.ts
 */
import "dotenv/config";

import { getRelationTargets } from "bitecs";

import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity, createObjectEntity } from "../ecs/prefabs";
import { Agent, Goal } from "../ecs/components";
import { HasGoal } from "../ecs/relations";
import { initializeSchedule } from "../cognition/schedule-system";
import { agentThink } from "../cognition/agent-mind";
import { executeActions } from "../cognition/cognition-system";

import { createSystemRegistry, registerSystem, runSystems } from "../ecs/dynamic-systems";
import { createGoalEvaluationSystem, createGoalPursuitSystem } from "../systems/builtin-systems";
import { createDayPlanActivationSystem, createDayPlanPreplannerSystem, createScheduledActivityTemplatePlannerSystem } from "../systems/scheduled-activity-systems";

function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

function listScheduledGoals(world: any, agentEid: number): { eid: number; status: string; activityType: string; startHour: number }[] {
  const out: { eid: number; status: string; activityType: string; startHour: number }[] = [];
  const goalEids = getRelationTargets(world as any, agentEid, HasGoal as any) as number[];
  for (const gid of goalEids) {
    if (String(Goal.kind[gid] || "") !== "scheduled_activity") continue;
    let params: any = null;
    try {
      params = JSON.parse(String(Goal.paramsJson[gid] || "{}"));
    } catch {
      params = null;
    }
    out.push({
      eid: gid,
      status: String(Goal.status[gid] || ""),
      activityType: String(params?.activityType || ""),
      startHour: Number(params?.startHour ?? -1),
    });
  }
  return out;
}

async function main() {
  const prevKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  const world = createArgosWorld("DayPlanPreplanningActivationSmoke") as any;
  initializePrefabs(world);

  const home = createRoomEntity(world, { name: "Home" });
  const bakery = createRoomEntity(world, { name: "Bakery" });
  const square = createRoomEntity(world, { name: "Town Square" });

  createObjectEntity(world, { name: "Workstation", roomId: bakery, portable: false, traits: ["searchable"] });
  createObjectEntity(world, { name: "Bench", roomId: square, portable: false, traits: ["sittable"] });

  const agent = createAgentEntity(world, { name: "Ada", role: "baker", systemPrompt: "x", roomId: home });
  Agent.active[agent] = true;

  initializeSchedule(
    world,
    agent,
    [
      { name: "work", startHour: 8, duration: 1, location: "Bakery", priority: 8, interruptible: true },
      { name: "leisure", startHour: 17, duration: 1, location: "Town Square", priority: 4, interruptible: true },
    ],
    0.2
  );

  const registry = createSystemRegistry();
  const preplan = createDayPlanPreplannerSystem();
  preplan.frequency = 0;
  registerSystem(registry as any, preplan as any);

  const activate = createDayPlanActivationSystem();
  activate.frequency = 0;
  registerSystem(registry as any, activate as any);

  const planner = createScheduledActivityTemplatePlannerSystem();
  planner.frequency = 0;
  registerSystem(registry as any, planner as any);

  const goalPursuit = createGoalPursuitSystem();
  goalPursuit.frequency = 0;
  registerSystem(registry as any, goalPursuit as any);

  const goalEval = createGoalEvaluationSystem();
  goalEval.frequency = 0;
  registerSystem(registry as any, goalEval as any);

  // 06:00 -> seed queued goals for the day.
  world.time.simulationDay = 1;
  world.time.simulationHour = 6;
  runSystems(world as any, registry as any, 1, 16);

  const seeded = listScheduledGoals(world as any, agent);
  assert(seeded.length >= 2, `expected at least 2 scheduled_activity goals seeded, got ${seeded.length}`);
  assert(seeded.some((g) => g.status === "queued" && g.activityType === "work_block" && g.startHour === 8), "expected queued work_block@8 goal");
  assert(seeded.some((g) => g.status === "queued" && g.activityType === "leisure_block" && g.startHour === 17), "expected queued leisure_block@17 goal");

  // 08:00 -> activate work goal and complete it deterministically.
  world.time.simulationHour = 8;

  let completedWork = false;
  for (let tick = 0; tick < 60; tick++) {
    runSystems(world as any, registry as any, 100 + tick, 16);
    const action = await agentThink(world as any, agent);
    executeActions(world as any, [{ eid: agent, action }], registry as any);
    runSystems(world as any, registry as any, 100 + tick, 16);

    const goals = listScheduledGoals(world as any, agent);
    const work = goals.find((g) => g.activityType === "work_block" && g.startHour === 8);
    if (work && String(Goal.status[work.eid] || "") === "completed") {
      completedWork = true;
      break;
    }
  }

  assert(completedWork, "expected work_block@8 scheduled_activity goal to complete");

  if (prevKey) process.env.GOOGLE_GENERATIVE_AI_API_KEY = prevKey;
  console.log("✓ dayplan preplanning+activation smoke passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

