import { World, query, setComponent, hasComponent } from "bitecs";
import {
  Agent,
  Memory,
  Goal,
  Plan,
  Action,
  SinglePlanType,
  GoalType,
  SingleGoalType,
} from "../components";
import { createSystem, SystemConfig } from "./System";
import { logger } from "../utils/logger";
import { SimulationRuntime } from "../runtime/SimulationRuntime";
import { v4 as uuidv4 } from "uuid";

// Helper to generate goals based on agent state
async function generateGoals(
  world: World,
  eid: number,
  runtime: SimulationRuntime
) {
  const agentState = {
    name: Agent.name[eid],
    role: Agent.role[eid],
    systemPrompt: Agent.systemPrompt[eid],
    thoughts: Memory.thoughts[eid] || [],
    experiences: Memory.experiences[eid] || [],
    currentGoals: Goal.goals[eid] || [],
  };

  // TODO: Use LLM to generate appropriate goals based on agent state
  // For now, return a simple goal if none exist
  if (!Goal.goals[eid] || Goal.goals[eid].length === 0) {
    return [
      {
        id: uuidv4(),
        description: `Understand my role as ${Agent.role[eid]}`,
        priority: 1,
        type: "long_term",
        status: "active",
        progress: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];
  }

  return Goal.goals[eid];
}

// Helper to create plans for active goals
async function createPlans(
  world: World,
  eid: number,
  goals: any[],
  runtime: SimulationRuntime
) {
  const existingPlans: SinglePlanType[] = Plan.plans[eid] || [];
  const newPlans: SinglePlanType[] = [];

  for (const goal of goals) {
    // Skip if goal already has an active plan
    if (
      existingPlans.some((p) => p.goalId === goal.id && p.status === "active")
    ) {
      continue;
    }

    // TODO: Use LLM to generate appropriate plan steps
    // For now, create a simple plan
    newPlans.push({
      id: uuidv4(),
      goalId: goal.id,
      description: `Plan to achieve: ${goal.description}`,
      priority: goal.priority || 1,
      steps: [
        {
          id: uuidv4(),
          description: `Think about how to achieve: ${goal.description}`,
          status: "pending",
          order: 0,
          expectedOutcome: "Better understanding of the goal",
        },
      ],
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  return [...existingPlans, ...newPlans];
}

// Helper to update goal and plan progress
function updateProgress(world: World, eid: number, runtime: SimulationRuntime) {
  const goals = Goal.goals[eid] || [];
  const plans = Plan.plans[eid] || [];
  const updatedGoals = [...goals];
  const updatedPlans = [...plans];

  for (const plan of updatedPlans) {
    if (plan.status !== "active") continue;

    // Update plan progress
    const completedSteps = plan.steps.filter(
      (s: SinglePlanType) => s.status === "completed"
    ).length;
    const progress = completedSteps / plan.steps.length;

    // Update corresponding goal progress
    const goalIndex = updatedGoals.findIndex((g) => g.id === plan.goalId);
    if (goalIndex >= 0) {
      updatedGoals[goalIndex] = {
        ...updatedGoals[goalIndex],
        progress,
        status: progress >= 1 ? "completed" : "active",
        updatedAt: Date.now(),
      };
    }

    // Update plan status if all steps complete
    if (progress >= 1) {
      plan.status = "completed";
      plan.updatedAt = Date.now();
    }
  }

  return { updatedGoals, updatedPlans };
}

export const GoalPlanningSystem = createSystem<SystemConfig>(
  (runtime) => async (world: World) => {
    const agents = query(world, [Agent, Memory, Goal, Plan]);
    logger.debug(`GoalPlanningSystem processing ${agents.length} agents`);

    for (const eid of agents) {
      try {
        // Skip inactive agents
        if (!Agent.active[eid]) continue;

        // Stage 1: Generate/update goals
        const goals = await generateGoals(world, eid, runtime);

        // Stage 2: Create/update plans for active goals
        const activeGoals = goals.filter(
          (g: SingleGoalType) => g.status === "active"
        );
        const plans = await createPlans(world, eid, activeGoals, runtime);

        // Stage 3: Update progress
        const { updatedGoals, updatedPlans } = updateProgress(
          world,
          eid,
          runtime
        );

        // Stage 4: Update components
        setComponent(world, eid, Goal, {
          goals: updatedGoals,
          activeGoalIds: updatedGoals
            .filter((g) => g.status === "active")
            .map((g) => g.id),
          lastUpdate: Date.now(),
        });

        setComponent(world, eid, Plan, {
          plans: updatedPlans,
          activePlanIds: updatedPlans
            .filter((p) => p.status === "active")
            .map((p) => p.id),
          lastUpdate: Date.now(),
        });

        // Emit events for goal/plan updates
        // runtime.eventBus.emitAgentEvent(eid, "goals", "goals_updated", {
        //   goals: updatedGoals,
        //   plans: updatedPlans,
        // });
      } catch (error) {
        logger.error(`Error in GoalPlanningSystem for agent ${eid}`, error);
      }
    }

    return world;
  }
);
