import { World, query } from "bitecs";
import { createSystem } from "./System";
import {
  Agent,
  Goal,
  Plan,
  Memory,
  SingleGoalType,
  Perception,
} from "../components";
import {
  generatePlan,
  evaluateTaskProgress,
  evaluatePlanModifications,
} from "../llm/agent-llm";
import { logger } from "../utils/logger";
import { createCognitiveStimulus } from "../factories/stimulusFactory";
import { SinglePlanType } from "../components/Plans";
import { processConcurrentAgents } from "../utils/system-utils";

// Types
interface TaskEvaluationResult {
  taskCompleted: boolean;
  nextStepId?: string;
  planCompleted?: boolean;
}

interface AgentContext {
  world: World;
  eid: number;
  agentName: string;
  systemPrompt: string;
  role: string;
  currentGoals: SingleGoalType[];
  currentPlans: SinglePlanType[];
  memories: any[];
  recentPerception: any[] | string;
  tools: any[];
}

// Helper Functions
function findCurrentTask(plan: SinglePlanType) {
  return plan.steps.find((step) => step.status === "in_progress");
}

function findNextPendingTask(plan: SinglePlanType) {
  return plan.steps.find((step) => step.status === "pending");
}

async function evaluateCurrentTask(
  world: World,
  eid: number,
  plan: SinglePlanType,
  currentStep: SinglePlanType["steps"][0],
  agentName: string,
  systemPrompt: string,
  memories: any[],
  recentPerception: any[]
): Promise<TaskEvaluationResult> {
  const taskEvaluation = await evaluateTaskProgress({
    name: agentName,
    systemPrompt: systemPrompt,
    agentId: String(eid),
    taskDescription: currentStep.description,
    recentPerception,
    expectedOutcome: currentStep.expectedOutcome || "",
    recentExperiences: memories.slice(-10),
  });

  if (taskEvaluation.complete) {
    currentStep.status = "completed";
    emitTaskCompletionStimulus(world, eid, currentStep);

    const nextStep = findNextPendingTask(plan);
    if (nextStep) {
      nextStep.status = "in_progress";
      return { taskCompleted: true, nextStepId: nextStep.id };
    } else {
      markPlanAsCompleted(world, eid, plan);
      return { taskCompleted: true, planCompleted: true };
    }
  } else if (taskEvaluation.failed) {
    markTaskAsFailed(world, eid, currentStep, plan, taskEvaluation.reason);
    return { taskCompleted: true, planCompleted: true };
  }

  return { taskCompleted: false };
}

function markPlanAsCompleted(world: World, eid: number, plan: SinglePlanType) {
  plan.status = "completed";
  plan.updatedAt = Date.now();

  createCognitiveStimulus(
    world,
    eid,
    `Completed plan: ${plan.steps[0]?.description || "Unknown plan"}`,
    { plan },
    {
      subtype: "plan_completed",
      intensity: 0.7,
      private: true,
    }
  );
}

function markTaskAsFailed(
  world: World,
  eid: number,
  task: SinglePlanType["steps"][0],
  plan: SinglePlanType,
  reason?: string
) {
  task.status = "failed";
  plan.status = "failed";
  plan.updatedAt = Date.now();

  createCognitiveStimulus(
    world,
    eid,
    `Failed task: ${task.description}`,
    { task, reason },
    {
      subtype: "task_failed",
      intensity: 0.6,
      private: true,
    }
  );
}

function emitTaskCompletionStimulus(
  world: World,
  eid: number,
  task: SinglePlanType["steps"][0]
) {
  createCognitiveStimulus(
    world,
    eid,
    `Completed task: ${task.description}`,
    { task },
    {
      subtype: "task_completed",
      intensity: 0.6,
      private: true,
    }
  );
}

async function createNewPlan(
  world: World,
  eid: number,
  goal: SingleGoalType,
  agentName: string,
  systemPrompt: string,
  role: string,
  currentPlans: SinglePlanType[],
  memories: any[],
  tools: any[]
): Promise<void> {
  try {
    const plan = await generatePlan({
      name: agentName,
      role: role,
      systemPrompt: systemPrompt,
      agentId: String(eid),
      goal,
      currentPlans,
      recentExperiences: memories,
      availableTools: tools,
    });

    if (plan.steps.length > 0) {
      plan.steps[0].status = "in_progress";
      plan.currentStepId = plan.steps[0].id;
    }

    Plan.plans[eid] = [...currentPlans, plan];
    Plan.lastUpdate[eid] = Date.now();

    createCognitiveStimulus(
      world,
      eid,
      `Created plan for goal: ${goal.description}`,
      { plan },
      {
        subtype: "plan_created",
        intensity: 0.7,
        private: true,
      }
    );

    logger.agent(
      eid,
      `Created plan with ${plan.steps.length} steps`,
      agentName
    );
  } catch (error) {
    logger.error(`Error generating plan for goal ${goal.id}:`, error);
  }
}

// Process Steps
async function processActivePlansAndTasks(context: AgentContext) {
  const activePlans = context.currentPlans.filter(
    (plan) => plan.status === "active"
  );

  for (const plan of activePlans) {
    const currentStep = findCurrentTask(plan);

    if (currentStep) {
      await evaluateCurrentTask(
        context.world,
        context.eid,
        plan,
        currentStep,
        context.agentName,
        context.systemPrompt,
        context.memories,
        Array.isArray(context.recentPerception) ? context.recentPerception : []
      );
    } else if (!plan.currentStepId) {
      const firstPendingStep = findNextPendingTask(plan);
      if (firstPendingStep) {
        firstPendingStep.status = "in_progress";
        plan.currentStepId = firstPendingStep.id;
      }
    }
  }
}

async function createPlansForNewGoals(context: AgentContext) {
  const goalsNeedingPlans = context.currentGoals.filter(
    (goal: SingleGoalType) =>
      goal.status === "in_progress" &&
      !context.currentPlans.some(
        (plan: SinglePlanType) =>
          plan.goalId === goal.id && plan.status === "active"
      )
  );

  if (goalsNeedingPlans.length > 0) {
    logger.agent(context.eid, "Starting planning process", context.agentName);

    await Promise.all(
      goalsNeedingPlans.map((goal) =>
        createNewPlan(
          context.world,
          context.eid,
          goal,
          context.agentName,
          context.systemPrompt,
          context.role,
          context.currentPlans,
          context.memories,
          context.tools
        )
      )
    );
  }

  return goalsNeedingPlans.length;
}

function getAgentContext(
  world: World,
  eid: number,
  runtime: any
): AgentContext {
  return {
    world,
    eid,
    agentName: Agent.name[eid],
    systemPrompt: Agent.systemPrompt[eid],
    role: Agent.role[eid],
    currentGoals: Goal.current[eid] || [],
    currentPlans: Plan.plans[eid] || [],
    memories: Memory.experiences[eid] || [],
    recentPerception: Perception.summary[eid] || [],
    tools: runtime.getActionManager().getEntityTools(eid),
  };
}

async function evaluateAndReprioritizeTasks(context: AgentContext) {
  const activePlan = context.currentPlans.find(
    (plan) => plan.status === "active"
  );
  if (!activePlan) return;

  // Get current task and remaining tasks
  const currentTask = findCurrentTask(activePlan);
  const remainingTasks = activePlan.steps.filter(
    (step) => step.status === "pending"
  );

  // Skip if no tasks to reprioritize
  if (!currentTask || remainingTasks.length === 0) return;

  // Evaluate if task order needs to change based on recent experiences
  const taskEvaluation = await evaluateTaskProgress({
    name: context.agentName,
    systemPrompt: context.systemPrompt,
    agentId: String(context.eid),
    taskDescription: currentTask.description,
    recentPerception: Array.isArray(context.recentPerception)
      ? context.recentPerception
      : [],
    expectedOutcome: currentTask.expectedOutcome || "",
    recentExperiences: context.memories.slice(-10),
  });

  // If current task is blocked or inefficient, consider reordering
  if (taskEvaluation.failed || taskEvaluation.reason?.includes("blocked")) {
    // Move current task to end of queue if blocked
    currentTask.status = "pending";
    const nextTask = remainingTasks[0];
    if (nextTask) {
      nextTask.status = "in_progress";
      activePlan.currentStepId = nextTask.id;

      createCognitiveStimulus(
        context.world,
        context.eid,
        `Reordered tasks: ${currentTask.description} is blocked, moving to ${nextTask.description}`,
        { previousTask: currentTask, nextTask },
        {
          subtype: "task_reordered",
          intensity: 0.5,
          private: true,
        }
      );
    }
  }
}

async function evaluateTaskAdditionsOrRemovals(context: AgentContext) {
  const activePlan = context.currentPlans.find(
    (plan) => plan.status === "active"
  );
  if (!activePlan) return;

  // Evaluate if plan needs modifications
  const modifications = await evaluatePlanModifications({
    name: context.agentName,
    systemPrompt: context.systemPrompt,
    agentId: String(context.eid),
    currentPlan: activePlan,
    recentExperiences: context.memories.slice(-10),
    recentPerception: Array.isArray(context.recentPerception)
      ? context.recentPerception
      : [],
  });

  if (!modifications.shouldModify) return;

  // Handle task additions
  if (modifications.newTasks?.length) {
    const currentTaskDescriptions = new Set(
      activePlan.steps.map((step) => step.description)
    );

    for (const newTask of modifications.newTasks) {
      // Skip if task already exists
      if (currentTaskDescriptions.has(newTask.description)) continue;

      const taskToAdd = {
        id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        description: newTask.description,
        status: "pending" as const,
        expectedOutcome: "",
        order: activePlan.steps.length + 1,
      };

      if (newTask.insertAfter) {
        // Insert after specified task
        const insertIndex = activePlan.steps.findIndex(
          (step) => step.description === newTask.insertAfter
        );
        if (insertIndex !== -1) {
          activePlan.steps.splice(insertIndex + 1, 0, taskToAdd);
        } else {
          activePlan.steps.push(taskToAdd);
        }
      } else {
        // Add to end
        activePlan.steps.push(taskToAdd);
      }

      createCognitiveStimulus(
        context.world,
        context.eid,
        `Added new task: ${newTask.description} - ${newTask.reason}`,
        { task: taskToAdd, reason: newTask.reason },
        {
          subtype: "task_added",
          intensity: 0.6,
          private: true,
        }
      );
    }
  }

  // Handle task removals
  if (modifications.tasksToRemove?.length) {
    for (const removal of modifications.tasksToRemove) {
      const taskIndex = activePlan.steps.findIndex(
        (step) =>
          step.description === removal.description && step.status === "pending"
      );

      if (taskIndex !== -1) {
        const removedTask = activePlan.steps[taskIndex];
        activePlan.steps.splice(taskIndex, 1);

        createCognitiveStimulus(
          context.world,
          context.eid,
          `Removed task: ${removal.description} - ${removal.reason}`,
          { task: removedTask, reason: removal.reason },
          {
            subtype: "task_removed",
            intensity: 0.5,
            private: true,
          }
        );
      }
    }
  }

  // Handle task reordering
  if (modifications.tasksToReorder?.length) {
    for (const reorder of modifications.tasksToReorder) {
      const taskToMove = activePlan.steps.find(
        (step) =>
          step.description === reorder.description && step.status === "pending"
      );
      const targetTask = activePlan.steps.find(
        (step) => step.description === reorder.moveAfter
      );

      if (taskToMove && targetTask) {
        // Remove task from current position
        activePlan.steps = activePlan.steps.filter(
          (step) => step !== taskToMove
        );

        // Insert after target position
        const targetIndex = activePlan.steps.indexOf(targetTask);
        activePlan.steps.splice(targetIndex + 1, 0, taskToMove);

        createCognitiveStimulus(
          context.world,
          context.eid,
          `Reordered task: ${reorder.description} - ${reorder.reason}`,
          { task: taskToMove, reason: reorder.reason },
          {
            subtype: "task_reordered",
            intensity: 0.5,
            private: true,
          }
        );
      }
    }
  }

  // Update plan if any modifications were made
  if (
    modifications.newTasks?.length ||
    modifications.tasksToRemove?.length ||
    modifications.tasksToReorder?.length
  ) {
    Plan.lastUpdate[context.eid] = Date.now();
  }
}

// Main System
export const PlanningSystem = createSystem(
  (runtime) => async (world: World) => {
    const agents = query(world, [Agent, Goal, Plan, Memory]);

    await processConcurrentAgents(
      world,
      agents,
      "PlanningSystem",
      async (eid) => {
        if (!Agent.active[eid]) return;

        const context = getAgentContext(world, eid, runtime);

        // Step 1: Process and update all active plans and their tasks
        await processActivePlansAndTasks(context);

        // Step 2: Evaluate if tasks need to be reordered based on current conditions
        await evaluateAndReprioritizeTasks(context);

        // Step 3: Check if new tasks need to be added or existing ones removed
        await evaluateTaskAdditionsOrRemovals(context);

        // Step 4: Create new plans for goals that need them
        const plansCreated = await createPlansForNewGoals(context);

        return {
          eid,
          agentName: context.agentName,
          plansCreated,
        };
      }
    );

    return world;
  }
);
