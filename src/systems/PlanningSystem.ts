import { World, query } from "bitecs";
import { createSystem } from "./System";
import { Agent, Goal, Plan, Memory, SingleGoalType } from "../components";
import { generatePlan } from "../llm/agent-llm";
import { logger } from "../utils/logger";
import { createCognitiveStimulus } from "../factories/stimulusFactory";
import { SinglePlanType } from "../components/Plans";
import { processConcurrentAgents } from "../utils/system-utils";

export const PlanningSystem = createSystem(
  (runtime) => async (world: World) => {
    const agents = query(world, [Agent, Goal, Plan, Memory]);

    await processConcurrentAgents(
      world,
      agents,
      "PlanningSystem",
      async (eid) => {
        if (!Agent.active[eid]) return;

        const agentName = Agent.name[eid];
        logger.agent(eid, "Starting planning process", agentName);

        try {
          const currentGoals = Goal.current[eid] || [];
          const currentPlans = Plan.plans[eid] || [];
          const memories = Memory.experiences[eid] || [];

          const goalsNeedingPlans = currentGoals.filter(
            (goal: SingleGoalType) =>
              goal.status === "in_progress" &&
              !currentPlans.some(
                (plan: SinglePlanType) => plan.goalId === goal.id
              )
          );

          await Promise.all(
            goalsNeedingPlans.map(async (goal: SingleGoalType) => {
              logger.agent(
                eid,
                `Generating plan for goal: ${goal.id}`,
                agentName
              );

              try {
                const plan = await generatePlan({
                  name: agentName,
                  role: Agent.role[eid],
                  systemPrompt: Agent.systemPrompt[eid],
                  agentId: Agent.id[eid],
                  goal,
                  currentPlans,
                  recentExperiences: memories,
                  availableTools: runtime
                    .getActionManager()
                    .getEntityTools(eid),
                });

                Plan.plans[eid] = [...currentPlans, plan];
                Plan.activePlanIds[eid] = [
                  ...(Plan.activePlanIds[eid] || []),
                  plan.id,
                ];
                Plan.lastUpdate[eid] = Date.now();

                emitPlanStimulus(world, eid, plan, "plan_created");

                logger.agent(
                  eid,
                  `Created plan ${plan.id} with ${plan.steps.length} steps`,
                  agentName
                );
              } catch (error) {
                logger.error(
                  `Error generating plan for goal ${goal.id}:`,
                  error
                );
              }
            })
          );

          logger.agent(eid, "Completed planning cycle", agentName);
        } catch (error) {
          logger.error(
            `Error in PlanningSystem for agent ${agentName}:`,
            error
          );
        }
      }
    );

    return world;
  }
);

function emitPlanStimulus(
  world: World,
  eid: number,
  plan: SinglePlanType,
  subtype: "plan_created" | "plan_updated" | "plan_completed" | "plan_failed"
) {
  createCognitiveStimulus(
    world,
    eid,
    `Plan ${subtype}: ${plan.description}`,
    { plan },
    {
      subtype,
      intensity: 0.7,
      private: true,
    }
  );
}
