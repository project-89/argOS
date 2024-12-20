import { World, query } from "bitecs";
import { createSystem } from "./System";
import { Agent, Goal, Memory, Perception } from "../components";
import {
  generateGoals,
  evaluateGoalProgress,
  detectSignificantChanges,
} from "../llm/agent-llm";
import { StimulusType, StimulusSource } from "../types/stimulus";
import { EventBus } from "../runtime/EventBus";
import { logger } from "../utils/logger";
import { ChangeAnalysis } from "../types/cognitive";
import { createCognitiveStimulus } from "../factories/stimulusFactory";
import { processConcurrentAgents } from "../utils/system-utils";

export const GoalPlanningSystem = createSystem(
  (runtime) => async (world: World) => {
    const agents = query(world, [Agent, Goal, Memory, Perception]);

    await processConcurrentAgents(
      world,
      agents,
      "GoalPlanningSystem",
      async (eid) => {
        if (!Agent.active[eid]) return;

        const agentName = Agent.name[eid];
        logger.agent(eid, "Starting goal planning process", agentName);

        const currentGoals = Goal.current[eid] || [];
        const memories = Memory.experiences[eid] || [];
        const perceptions = Perception.currentStimuli[eid] || [];

        try {
          logger.agent(eid, "Detecting significant changes", agentName);
          const changeAnalysis = await detectSignificantChanges({
            name: agentName,
            role: Agent.role[eid],
            systemPrompt: Agent.systemPrompt[eid],
            agentId: Agent.id[eid],
            currentGoals,
            recentExperiences: memories,
            perceptionSummary: JSON.stringify(perceptions),
            perceptionContext: getContextSummary(eid, runtime),
          });

          if (changeAnalysis.significant_change) {
            logger.agent(
              eid,
              `Significant changes detected: ${JSON.stringify({
                changes: changeAnalysis.changes.length,
                recommendation: changeAnalysis.recommendation,
              })}`,
              agentName
            );

            // Create cognitive stimuli for significant changes
            changeAnalysis.changes.forEach(
              (change: ChangeAnalysis["changes"][0]) => {
                logger.agent(
                  eid,
                  `Processing change: ${JSON.stringify({
                    description: change.description,
                  })}`,
                  agentName
                );

                createCognitiveStimulus(
                  world,
                  eid,
                  change.description,
                  { change },
                  {
                    subtype: "realization",
                    intensity: change.impact_level / 5,
                    private: true,
                  }
                );
              }
            );

            // Generate new goals if recommended
            if (changeAnalysis.recommendation !== "maintain_goals") {
              logger.agent(eid, "Generating new goals", agentName);
              const newGoals = await generateGoals({
                name: agentName,
                role: Agent.role[eid],
                systemPrompt: Agent.systemPrompt[eid],
                agentId: Agent.id[eid],
                currentGoals,
                recentExperiences: memories,
                perceptionSummary: JSON.stringify(perceptions),
                perceptionContext: getContextSummary(eid, runtime),
              });

              logger.agent(
                eid,
                `Generated ${newGoals.length} new goals`,
                agentName
              );

              // Create cognitive stimuli for new goals
              newGoals.forEach((goal) => {
                logger.agent(
                  eid,
                  `Processing new goal: ${goal.description}`,
                  agentName
                );

                createCognitiveStimulus(
                  world,
                  eid,
                  `Created new goal: ${goal.description}`,
                  { goal },
                  {
                    subtype: "goal_created",
                    intensity: 0.8,
                    private: true,
                  }
                );
              });

              // Update agent's goals
              Goal.current[eid] = [...currentGoals, ...newGoals];
            }
          } else {
            logger.agent(eid, "No significant changes detected", agentName);
          }

          // Check progress on current goals
          logger.agent(
            eid,
            `Evaluating progress on ${currentGoals.length} goals`,
            agentName
          );

          for (const goal of currentGoals) {
            if (goal.status === "in_progress") {
              logger.agent(
                eid,
                `Evaluating goal progress: ${JSON.stringify({
                  goalId: goal.id,
                })}`,
                agentName
              );

              const evaluation = await evaluateGoalProgress({
                name: agentName,
                systemPrompt: Agent.systemPrompt[eid],
                agentId: Agent.id[eid],
                goalDescription: goal.description,
                goalType: goal.type,
                successCriteria: goal.success_criteria,
                progressIndicators: goal.progress_indicators,
                currentProgress: goal.progress,
                recentExperiences: memories,
                perceptionSummary: JSON.stringify(perceptions),
                perceptionContext: getContextSummary(eid, runtime),
              });

              if (evaluation.complete) {
                logger.agent(
                  eid,
                  `Goal completed: ${JSON.stringify({ goalId: goal.id })}`,
                  agentName
                );
                goal.status = "completed";
                emitGoalStimulus(world, eid, goal, "goal_complete");
              } else if (evaluation.progress !== goal.progress) {
                logger.agent(
                  eid,
                  `Goal progress updated: ${JSON.stringify({
                    goalId: goal.id,
                    progress: evaluation.progress,
                  })}`,
                  agentName
                );
                goal.progress = evaluation.progress;
                emitGoalStimulus(world, eid, goal, "goal_progress");
              }

              // Update goal details based on evaluation
              goal.criteria_met = evaluation.criteria_met;
              goal.criteria_partial = evaluation.criteria_partial;
              goal.criteria_blocked = evaluation.criteria_blocked;
              goal.next_steps = evaluation.next_steps;
            }
          }

          logger.agent(eid, "Completed goal planning cycle", agentName);
          return {
            changesDetected: changeAnalysis.significant_change,
            goalsEvaluated: currentGoals.length,
          };
        } catch (error) {
          logger.error(
            `Error in GoalPlanningSystem for agent ${agentName}:`,
            error
          );
          return { error: true };
        }
      }
    );

    return world;
  }
);

function getContextSummary(eid: number, runtime: any): string {
  const roomId = runtime.getRoomManager().getAgentRoom(eid);
  const room = roomId ? runtime.getStateManager().getRoomState(roomId) : null;

  return JSON.stringify({
    currentRoom: room?.name || "unknown",
    currentTime: new Date().toISOString(),
    activeAgents: runtime.getStateManager().getWorldState().agents.length,
  });
}

function emitGoalStimulus(
  world: World,
  eid: number,
  goal: any,
  subtype: string
) {
  createCognitiveStimulus(
    world,
    eid,
    `Goal ${subtype}: ${goal.description}`,
    { goal },
    {
      subtype,
      intensity: 0.7,
      private: true,
    }
  );
}
