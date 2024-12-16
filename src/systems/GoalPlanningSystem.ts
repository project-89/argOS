import { World, query } from "bitecs";
import { createSystem } from "./System";
import { Agent, Goal, Memory, Perception } from "../components";
import {
  generateGoals,
  evaluateGoalProgress,
  detectSignificantChanges,
} from "../llm/agent-llm";
import { CognitiveStimulus } from "../types/stimulus";
import { EventBus } from "../runtime/EventBus";
import { logger } from "../utils/logger";
import { ChangeAnalysis } from "../types/cognitive";

export const GoalPlanningSystem = createSystem(
  (runtime) => async (world: World) => {
    logger.system("GoalPlanningSystem", "Starting goal planning cycle");
    const agents = query(world, [Agent, Goal, Memory, Perception]);
    logger.system("GoalPlanningSystem", `Processing ${agents.length} agents`);

    for (const eid of agents) {
      if (!Agent.active[eid]) continue;

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

          // Emit cognitive stimuli for significant changes
          changeAnalysis.changes.forEach(
            (change: ChangeAnalysis["changes"][0]) => {
              logger.agent(
                eid,
                `Processing change: ${JSON.stringify({
                  description: change.description,
                })}`,
                agentName
              );
              const stimulus: CognitiveStimulus = {
                type: "cognitive",
                subtype: "realization",
                intensity: change.impact_level / 5,
                content: {
                  description: change.description,
                  metadata: { change },
                },
                private: true,
              };

              runtime.eventBus.emitAgentEvent(
                eid,
                "perception",
                "cognitive",
                stimulus
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

            // Emit cognitive stimuli for new goals
            newGoals.forEach((goal) => {
              logger.agent(
                eid,
                `Processing new goal: ${JSON.stringify({ goalId: goal.id })}`,
                agentName
              );
              const stimulus: CognitiveStimulus = {
                type: "cognitive",
                subtype: "goal_created",
                intensity: 0.8,
                content: {
                  goalId: goal.id,
                  description: `Created new goal: ${goal.description}`,
                  metadata: { goal },
                },
                private: true,
              };

              runtime.eventBus.emitAgentEvent(
                eid,
                "perception",
                "cognitive",
                stimulus
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
              emitGoalStimulus(eid, goal, "goal_complete", runtime.eventBus);
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
              emitGoalStimulus(eid, goal, "goal_progress", runtime.eventBus);
            }

            // Update goal details based on evaluation
            goal.criteria_met = evaluation.criteria_met;
            goal.criteria_partial = evaluation.criteria_partial;
            goal.criteria_blocked = evaluation.criteria_blocked;
            goal.next_steps = evaluation.next_steps;
          }
        }

        logger.agent(eid, "Completed goal planning cycle", agentName);
      } catch (error) {
        logger.error(
          `Error in GoalPlanningSystem for agent ${agentName}:`,
          error
        );
      }
    }

    logger.system("GoalPlanningSystem", "Completed goal planning cycle");
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
  eid: number,
  goal: any,
  subtype: CognitiveStimulus["subtype"],
  eventBus: EventBus
) {
  const stimulus: CognitiveStimulus = {
    type: "cognitive",
    subtype,
    intensity: 0.7,
    content: {
      goalId: goal.id,
      description: `Goal ${subtype}: ${goal.description}`,
      metadata: { goal },
    },
    private: true,
  };

  eventBus.emitAgentEvent(eid, "perception", "cognitive", stimulus);
}
