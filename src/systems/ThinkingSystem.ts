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
} from "../components";
import { generateThought } from "../llm/agent-llm";
import { AgentState } from "../types/state";
import { logger } from "../utils/logger";
import { createSystem, SystemConfig } from "./System";
import { createVisualStimulus } from "../factories/stimulusFactory";
import { SimulationRuntime } from "../runtime/SimulationRuntime";
import { processConcurrentAgents } from "../utils/system-utils";
import { StimulusSource } from "../types/stimulus";
import { getActivePlans } from "../components/Plans";

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

  const currentPlans = Plan.plans[eid] || [];
  const activePlans = getActivePlans(currentPlans).map((plan) => ({
    id: plan.id,
    goalId: plan.goalId,
    steps: plan.steps.map((step) => ({
      id: step.id,
      description: step.description,
      status: step.status,
      requiredTools: [],
      expectedOutcome: step.expectedOutcome || "Complete the step successfully",
    })),
    currentStepId: plan.currentStepId,
    status: "active" as const,
  }));

  const state: AgentState = {
    id: String(eid),
    name: Agent.name[eid],
    role: Agent.role[eid],
    systemPrompt: Agent.systemPrompt[eid],
    active: Agent.active[eid],
    platform: Agent.platform[eid],
    attention: Agent.attention[eid],
    thoughtHistory: Memory.thoughts[eid] || [],
    perceptions: {
      narrative: Perception.summary[eid] || "",
      raw: Perception.currentStimuli[eid] || [],
    },
    lastAction: Action.lastActionResult[eid],
    timeSinceLastAction: Action.lastActionTime[eid]
      ? Date.now() - Action.lastActionTime[eid]
      : 0,
    experiences: Memory.experiences[eid] || [],
    availableTools: runtime.getActionManager().getEntityTools(eid),
    goals: Goal.current[eid] || [],
    completedGoals: Goal.completed[eid] || [],
    activePlans,
    appearance: {
      description: Appearance.baseDescription[eid],
      facialExpression: Appearance.facialExpression[eid],
      bodyLanguage: Appearance.bodyLanguage[eid],
      currentAction: Appearance.currentAction[eid],
      socialCues: Appearance.socialCues[eid],
    },
  };

  const thought = await generateThought(state);

  logger.agent(
    eid,
    `Thought: ${JSON.stringify(thought, null, 2)}`,
    Agent.name[eid]
  );

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
      `I decided to take the action: ${
        thought.action.tool
      }\nParameters: ${JSON.stringify(thought.action.parameters, null, 2)}`,
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
  createVisualStimulus(
    world,
    roomId,
    appearance.description || Appearance.description[eid],
    {
      metadata: {
        roomId: Room.id[roomId],
        appearance,
        location: {
          roomId: Room.id[roomId],
          roomName: Room.name[roomId],
        },
      },
      source: StimulusSource.ROOM,
    }
  );

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
    // Make sure we have all the components we need
    const agents = query(world, [
      Agent,
      Memory,
      Action,
      Appearance,
      Perception,
      Goal,
    ]);

    await processConcurrentAgents(
      world,
      agents,
      "ThinkingSystem",
      async (eid) => {
        if (!Agent.active[eid]) {
          logger.debug(`Agent ${Agent.name[eid]} is not active, skipping`);
          return;
        }

        // Find agent's room
        const agentRoom = findAgentRoom(world, eid);
        if (!agentRoom) {
          logger.debug(`No room found for ${Agent.name[eid]}`);
          return;
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

        return {
          thought: thought.thought,
          hasAction: !!thought.action,
          hasAppearanceChange: !!thought.appearance,
        };
      }
    );

    return world;
  }
);
