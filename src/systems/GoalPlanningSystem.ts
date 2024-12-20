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

// Constants for throttling goal planning
const GOAL_EVALUATION_INTERVAL = 10000; // 10 seconds
const MAX_ACTIVE_GOALS = 3; // Reduced from 10 to 3 for better focus
const MIN_CHANGE_IMPACT = 4; // Increased from 3 to 4 for higher threshold
const MAX_GOALS_PER_CATEGORY = 1; // Maximum goals per category (immediate, short_term, etc.)

interface AgentGoal {
  id: string;
  description: string;
  type: "immediate" | "short_term" | "medium_term" | "long_term";
  status: "pending" | "in_progress" | "completed" | "failed";
  progress: number;
  success_criteria: string[];
  progress_indicators: string[];
  criteria_met?: string[];
  criteria_partial?: string[];
  criteria_blocked?: string[];
  next_steps?: string[];
  created_at?: number;
}

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
        const lastEvalTime = Goal.lastEvaluationTime[eid] ?? 0;
        const currentTime = Date.now();

        // Initialize lastEvaluationTime if not set
        if (!Goal.lastEvaluationTime[eid]) {
          Goal.lastEvaluationTime[eid] = currentTime;
          return; // Skip first run to avoid immediate evaluation
        }

        // Skip if evaluated too recently
        if (currentTime - lastEvalTime < GOAL_EVALUATION_INTERVAL) {
          return;
        }

        logger.agent(eid, "Starting goal planning process", agentName);

        const currentGoals = (Goal.current[eid] || []) as AgentGoal[];
        const memories = Memory.experiences[eid] || [];
        const perceptions = Perception.currentStimuli[eid] || [];

        try {
          let significantChangesDetected = false;

          // Only detect changes if we have room for new goals
          if (
            currentGoals.filter((g) => g.status === "in_progress").length <
            MAX_ACTIVE_GOALS
          ) {
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

            // Only consider changes with high enough impact
            const significantChanges = (changeAnalysis.changes || []).filter(
              (change: ChangeAnalysis["changes"][0]) =>
                change.impact_level >= MIN_CHANGE_IMPACT
            );

            significantChangesDetected = significantChanges.length > 0;

            if (significantChanges.length > 0) {
              logger.agent(
                eid,
                `Significant changes detected: ${JSON.stringify({
                  changes: significantChanges.length,
                  recommendation: changeAnalysis.recommendation,
                })}`,
                agentName
              );

              // Create cognitive stimuli for significant changes
              significantChanges.forEach(
                (change: ChangeAnalysis["changes"][0]) => {
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

              // Generate new goals only if recommended and we have room
              if (
                (changeAnalysis.recommendation === "new_goals" ||
                  changeAnalysis.recommendation === "adjust_goals") &&
                currentGoals.length < MAX_ACTIVE_GOALS
              ) {
                logger.agent(
                  eid,
                  `${
                    changeAnalysis.recommendation === "new_goals"
                      ? "Generating new goals"
                      : "Adjusting goals"
                  }`,
                  agentName
                );
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

                // Filter goals by category limits
                const goalsByCategory = new Map<string, AgentGoal[]>();
                for (const goal of newGoals) {
                  const category = goal.type;
                  if (!goalsByCategory.has(category)) {
                    goalsByCategory.set(category, []);
                  }
                  goalsByCategory.get(category)?.push(goal);
                }

                // Take only the top goal from each category
                const goalsToAdd: AgentGoal[] = [];
                for (const [category, goals] of goalsByCategory) {
                  const existingCount = currentGoals.filter(
                    (g) => g.type === category && g.status === "in_progress"
                  ).length;
                  if (existingCount < MAX_GOALS_PER_CATEGORY) {
                    goalsToAdd.push(goals[0]);
                  }
                }

                // Limit total goals
                const finalGoals = goalsToAdd.slice(
                  0,
                  MAX_ACTIVE_GOALS - currentGoals.length
                );

                if (finalGoals.length > 0) {
                  logger.agent(
                    eid,
                    `Generated ${finalGoals.length} new goals`,
                    agentName
                  );

                  // Create cognitive stimuli for new goals
                  finalGoals.forEach((goal) => {
                    logger.agent(
                      eid,
                      `Processing new goal: ${goal.description}`,
                      agentName
                    );

                    // Set initial status to in_progress
                    goal.status = "in_progress";
                    goal.progress = 0;
                    goal.created_at = Date.now();

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
                  Goal.current[eid] = [...currentGoals, ...finalGoals];
                } else {
                  logger.agent(
                    eid,
                    "No new goals added due to category limits",
                    agentName
                  );
                }
              }
            }
          }

          // Only evaluate in-progress goals
          const inProgressGoals = currentGoals.filter(
            (g: AgentGoal) => g.status === "in_progress"
          );
          logger.agent(
            eid,
            `Evaluating progress on ${inProgressGoals.length} in-progress goals`,
            agentName
          );

          for (const goal of inProgressGoals) {
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

          // Update last evaluation time
          Goal.lastEvaluationTime[eid] = currentTime;

          logger.agent(eid, "Completed goal planning cycle", agentName);
          return {
            changesDetected: significantChangesDetected,
            goalsEvaluated: inProgressGoals.length,
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
  goal: AgentGoal,
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
