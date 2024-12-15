import { World, query, setComponent, hasComponent } from "bitecs";
import {
  Agent,
  Memory,
  Action,
  Appearance,
  Room,
  OccupiesRoom,
  Perception,
  Goal,
  Plan,
  PlanStepType,
  SinglePlanType,
  SingleGoalType,
} from "../components";
import { generateThought, AgentState, Experience } from "../llm/agent-llm";
import { logger } from "../utils/logger";
import { createSystem, SystemConfig } from "./System";
import { createVisualStimulus } from "../utils/stimulus-utils";
import { EventCategory } from "../types";
import { SimulationRuntime } from "../runtime/SimulationRuntime";

interface ThoughtResult {
  thought: string;
  action?: {
    tool: string;
    parameters: Record<string, unknown>;
  };
  appearance?: Record<string, string>;
}

// Helper to find agent's current room
function findAgentRoom(world: World, agentId: number): number | null {
  const rooms = query(world, [Room]).filter((roomId) =>
    hasComponent(world, agentId, OccupiesRoom(roomId))
  );
  return rooms[0] || null;
}

// Stage 1: Generate thought based on state
async function generateAgentThought(
  world: World,
  eid: number,
  runtime: SimulationRuntime
): Promise<ThoughtResult> {
  logger.debug(`Generating thought for ${Agent.name[eid]}`);

  const agentState: AgentState = {
    name: Agent.name[eid],
    role: Agent.role[eid],
    systemPrompt: Agent.systemPrompt[eid],
    thoughtHistory: Memory.thoughts[eid] || [],
    perceptions: {
      narrative: Perception.summary[eid],
      raw: Perception.context[eid],
    },
    experiences: Memory.experiences[eid] || [],
    availableTools: runtime.getActionManager().getEntityTools(eid),
    lastAction: Action.lastActionResult[eid]
      ? {
          success: Action.lastActionResult[eid].success,
          message: Action.lastActionResult[eid].message,
          actionName: Action.lastActionResult[eid].actionName,
          timestamp: Action.lastActionResult[eid].timestamp,
          parameters: Action.lastActionResult[eid].parameters,
          data: Action.lastActionResult[eid].data,
        }
      : undefined,
    timeSinceLastAction: Action.lastActionTime[eid]
      ? Date.now() - Action.lastActionTime[eid]
      : undefined,
    goals: Goal.goals[eid] || [],
    activeGoals: (Goal.goals[eid] || []).filter(
      (g: SingleGoalType) => g.status === "active"
    ),
    activePlans: (Plan.plans[eid] || []).filter(
      (p: SinglePlanType) => p.status === "active"
    ),
    currentPlanSteps: (Plan.plans[eid] || ([] as SinglePlanType[]))
      .filter((p: SinglePlanType) => p.status === "active")
      .map((p: SinglePlanType) => {
        const currentStep = p.steps.find(
          (s: PlanStepType) => s.id === p.currentStepId
        );
        return currentStep
          ? {
              planId: p.id,
              goalId: p.goalId,
              step: currentStep,
            }
          : null;
      })
      .filter(Boolean),
  };

  const thought = await generateThought(agentState);
  logger.agent(eid, `Thought: ${thought.thought}`, Agent.name[eid]);

  // Emit thought event
  runtime.eventBus.emitAgentEvent(eid, "thought", "thought", thought.thought);

  return thought;
}

// Stage 2: Update agent memory with new thought
function updateAgentMemory(world: World, eid: number, thought: ThoughtResult) {
  const currentThoughts = Memory.thoughts[eid] || [];
  const lastThought = Memory.lastThought[eid];

  // Only add thought if it's different from last one or enough time has passed
  const shouldAddThought =
    thought.thought !== lastThought ||
    (currentThoughts.length > 0 && Date.now() - Memory.lastUpdate[eid] > 5000);

  if (shouldAddThought) {
    const updatedThoughts = [...currentThoughts, thought.thought].slice(-150);

    setComponent(world, eid, Memory, {
      lastThought: thought.thought,
      thoughts: updatedThoughts,
      lastUpdate: Date.now(),
    });
  }
}

// Stage 3: Handle agent actions
function handleAgentAction(world: World, eid: number, thought: ThoughtResult) {
  if (thought.action) {
    logger.agent(
      eid,
      `I decided to take the action: ${thought.action.tool}`,
      Agent.name[eid]
    );

    setComponent(world, eid, Action, {
      pendingAction: thought.action,
      lastActionTime: Date.now(),
      availableTools: Action.availableTools[eid],
    });
  }
}

// Stage 4: Update agent appearance
function updateAgentAppearance(
  world: World,
  eid: number,
  roomId: number,
  appearance: Record<string, string>,
  runtime: SimulationRuntime
) {
  setComponent(world, eid, Appearance, {
    description: appearance.description || Appearance.description[eid],
    baseDescription: Appearance.baseDescription[eid],
    facialExpression:
      appearance.facialExpression || Appearance.facialExpression[eid],
    bodyLanguage: appearance.bodyLanguage || Appearance.bodyLanguage[eid],
    currentAction: appearance.currentAction || Appearance.currentAction[eid],
    socialCues: appearance.socialCues || Appearance.socialCues[eid],
    lastUpdate: Date.now(),
  });

  // Create visual stimulus for appearance change
  createVisualStimulus(world, {
    sourceEntity: eid,
    roomId: Room.id[roomId],
    appearance: true,
    data: {
      ...appearance,
      location: {
        roomId: Room.id[roomId],
        roomName: Room.name[roomId],
      },
    },
  });

  // Emit appearance event
  runtime.eventBus.emitAgentEvent(eid, "appearance", "appearance", {
    description: appearance.description || Appearance.description[eid],
    facialExpression:
      appearance.facialExpression || Appearance.facialExpression[eid],
    bodyLanguage: appearance.bodyLanguage || Appearance.bodyLanguage[eid],
    currentAction: appearance.currentAction || Appearance.currentAction[eid],
    socialCues: appearance.socialCues || Appearance.socialCues[eid],
    lastUpdate: Date.now(),
  });
}

export const ThinkingSystem = createSystem<SystemConfig>(
  (runtime) => async (world: World) => {
    const agents = query(world, [Agent, Memory]);
    logger.debug(`ThinkingSystem processing ${agents.length} agents`);

    for (const eid of agents) {
      try {
        // Skip inactive agents
        if (!Agent.active[eid]) {
          logger.debug(`Agent ${Agent.name[eid]} is not active, skipping`);
          continue;
        }

        // Find agent's room
        const agentRoom = findAgentRoom(world, eid);
        if (!agentRoom) {
          logger.debug(`No room found for ${Agent.name[eid]}`);
          continue;
        }

        // Stage 1: Generate thought based on current state
        const thought = await generateAgentThought(world, eid, runtime);

        // Stage 2: Update agent memory with new thought
        updateAgentMemory(world, eid, thought);

        // Stage 3: Handle agent actions
        handleAgentAction(world, eid, thought);

        // Stage 4: Update agent appearance if needed
        if (thought.appearance) {
          updateAgentAppearance(
            world,
            eid,
            agentRoom,
            thought.appearance,
            runtime
          );
        }
      } catch (error) {
        logger.error(`Error in ThinkingSystem for agent ${eid}}`, error);
        // Continue with next agent
      }
    }

    return world;
  }
);
