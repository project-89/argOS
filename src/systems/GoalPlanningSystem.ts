import { World, query } from "bitecs";
import { createSystem } from "./System";
import {
  Agent,
  Goal,
  Memory,
  Perception,
  Plan,
  SinglePlanType,
} from "../components";
import {
  generateGoals,
  evaluateGoalProgress,
  detectSignificantChanges,
} from "../llm/agent-llm";

import { logger } from "../utils/logger";
import { ChangeAnalysis } from "../types/cognitive";
import { createCognitiveStimulus } from "../factories/stimulusFactory";
import { processConcurrentAgents } from "../utils/system-utils";

// Constants for throttling goal planning
const GOAL_EVALUATION_INTERVAL = 10000; // 10 seconds
const MAX_ACTIVE_GOALS = 1; // Keep focused on one goal at a time
const MIN_CHANGE_IMPACT = 4; // Only consider significant changes

interface AgentGoal {
  id: string;
  description: string;
  type: "immediate" | "short_term" | "medium_term" | "long_term";
  status: "pending" | "in_progress" | "completed" | "failed";
  priority: number;
  progress: number;
  success_criteria: string[];
  progress_indicators: string[];
  criteria_met?: string[];
  criteria_partial?: string[];
  criteria_blocked?: string[];
  next_steps?: string[];
  created_at: number;
}

export const GoalPlanningSystem = createSystem(
  (runtime) => async (world: World) => {
    const agents = query(world, [Agent, Goal, Plan, Memory, Perception]);

    await processConcurrentAgents(
      world,
      agents,
      "GoalPlanningSystem",
      async (eid) => {
        if (!Agent.active[eid]) return;

        const agentName = Agent.name[eid];
        const lastEvalTime = Goal.lastEvaluationTime[eid] ?? 0;
        const currentTime = Date.now();

        // Initialize lastEvaluationTime if not set
        if (!Goal.lastEvaluationTime[eid]) {
          Goal.lastEvaluationTime[eid] = currentTime;
          return;
        }

        // Skip if evaluated too recently
        if (currentTime - lastEvalTime < GOAL_EVALUATION_INTERVAL) {
          return;
        }

        const currentGoals = (Goal.current[eid] || []) as AgentGoal[];
        const memories = Memory.experiences[eid] || [];
        const perceptions = Perception.summary[eid] || "";

        try {
          // Only check for new goals if we don't have any active ones
          const activeGoals = currentGoals.filter(
            (g) => g.status === "in_progress"
          );
          if (activeGoals.length === 0) {
            const changeAnalysis = await detectSignificantChanges({
              name: agentName,
              role: Agent.role[eid],
              systemPrompt: Agent.systemPrompt[eid],
              agentId: Agent.id[eid],
              currentGoals,
              recentExperiences: memories.slice(-10),
              perceptionSummary: perceptions,
              perceptionContext: getContextSummary(eid, runtime),
            });

            const significantChanges = (changeAnalysis.changes || []).filter(
              (change: ChangeAnalysis["changes"][0]) =>
                change.impact_level >= MIN_CHANGE_IMPACT
            );

            if (
              significantChanges.length > 0 &&
              changeAnalysis.recommendation !== "maintain_goals"
            ) {
              const newGoals = await generateGoals({
                name: agentName,
                role: Agent.role[eid],
                systemPrompt: Agent.systemPrompt[eid],
                agentId: Agent.id[eid],
                currentGoals,
                recentExperiences: memories,
                perceptionSummary: perceptions,
                perceptionContext: getContextSummary(eid, runtime),
              });

              if (newGoals.length > 0) {
                const goalToAdd = newGoals[0]; // Take only the first goal
                goalToAdd.status = "in_progress";
                goalToAdd.progress = 0;
                goalToAdd.created_at = Date.now();

                // Emit cognitive stimulus only when creating a new goal
                createCognitiveStimulus(
                  world,
                  eid,
                  `New goal: ${goalToAdd.description}`,
                  { goal: goalToAdd },
                  {
                    subtype: "goal_created",
                    intensity: 0.8,
                    private: true,
                  }
                );

                Goal.current[eid] = [...currentGoals, goalToAdd];
              }
            }
          }

          // Evaluate progress of the active goal
          const activeGoal = activeGoals[0];
          if (activeGoal) {
            const evaluation = await evaluateGoalProgress({
              name: agentName,
              systemPrompt: Agent.systemPrompt[eid],
              agentId: Agent.id[eid],
              goalDescription: activeGoal.description,
              goalType: activeGoal.type,
              successCriteria: activeGoal.success_criteria,
              progressIndicators: activeGoal.progress_indicators,
              currentProgress: activeGoal.progress,
              recentExperiences: memories,
              perceptionSummary: perceptions,
              perceptionContext: getContextSummary(eid, runtime),
            });

            if (
              evaluation.complete ||
              (evaluation.blockers.length > 0 && activeGoal.progress < 10)
            ) {
              const status = evaluation.complete ? "completed" : "failed";
              activeGoal.status = status;

              // Emit cognitive stimulus only for goal completion/failure
              createCognitiveStimulus(
                world,
                eid,
                `Goal ${status}: ${activeGoal.description}`,
                { goal: activeGoal, evaluation },
                {
                  subtype: `goal_${status}`,
                  intensity: status === "completed" ? 0.9 : 0.8,
                  private: true,
                }
              );

              // Move completed/failed goals to history
              Goal.completed[eid] = [
                ...(Goal.completed[eid] || []),
                activeGoal,
              ];
              Goal.current[eid] = currentGoals.filter(
                (g) => g.id !== activeGoal.id
              );
            } else {
              // Update progress without emitting stimulus
              activeGoal.progress = evaluation.progress;
              activeGoal.criteria_met = evaluation.criteria_met;
              activeGoal.criteria_partial = evaluation.criteria_partial;
              activeGoal.criteria_blocked = evaluation.criteria_blocked;
              activeGoal.next_steps = evaluation.next_steps;
            }
          }

          Goal.lastEvaluationTime[eid] = currentTime;
        } catch (error) {
          logger.error(
            `Error in GoalPlanningSystem for agent ${agentName}:`,
            error
          );
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
