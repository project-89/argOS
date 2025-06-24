import {
  query,
  setComponent,
  addEntity,
  addComponent,
  World,
  hasComponent,
} from "bitecs";
import {
  Agent,
  Action,
  Room,
  OccupiesRoom,
  Memory,
  ActionResultType,
  Thought,
  Goal,
  Plan,
} from "../components";
import { logger } from "../utils/logger";
import { createSystem, SystemConfig } from "./System";
import { getAgentRoom } from "../utils/queries";
import { Experience } from "../llm/agent-llm";
import { getActivePlans } from "../components/Plans";

// Helper to get or create private room for agent
async function getOrCreatePrivateRoom(world: World, eid: number, runtime: any) {
  const privateRoomId = `private_${eid}`;
  const agentName = Agent.name[eid];

  // Check if private room exists
  const rooms = query(world, [Room]);
  const privateRoom = rooms.find((rid) => Room.id[rid] === privateRoomId);

  if (privateRoom) {
    logger.agent(eid, "Using existing private room", agentName);
    return privateRoom;
  }

  // Create new private room
  const roomEid = addEntity(world);
  addComponent(world, roomEid, Room);

  setComponent(world, roomEid, Room, {
    id: privateRoomId,
    name: `${agentName}'s Private Space`,
    description: `Private space for ${agentName}'s independent activities`,
    type: "private",
  });

  logger.agent(eid, "Created new private room", agentName);
  return roomEid;
}

// System for handling agent actions and tool usage
export const ActionSystem = createSystem<SystemConfig>(
  (runtime) => async (world: World) => {
    const agents = query(world, [Agent, Action]);
    logger.system("ActionSystem", `Processing ${agents.length} agents`);

    for (const eid of agents) {
      if (!Agent.active[eid]) continue;

      const agentName = Agent.name[eid];

      // Initialize available tools if not set
      if (!Action.availableTools[eid]) {
        logger.agent(eid, "Initializing available tools", agentName);
        setComponent(world, eid, Action, {
          availableTools: Action.availableTools[eid],
          pendingAction: Action.pendingAction[eid],
          lastActionTime: Action.lastActionTime[eid],
        });
      }

      // Process pending actions
      const pendingAction = Action.pendingAction[eid];
      if (!pendingAction) continue;

      let roomEid = getAgentRoom(world, eid);

      if (!roomEid) {
        logger.agent(
          eid,
          `No room found - required for action: ${pendingAction.tool}`,
          agentName
        );
        continue;
      }

      logger.agent(
        eid,
        `Executing action: ${pendingAction.tool} with params: ${JSON.stringify(
          pendingAction.parameters
        )}`,
        agentName
      );

      // Execute the action
      const result = await runtime
        .getActionManager()
        .executeAction(
          pendingAction.tool,
          eid,
          pendingAction.parameters,
          runtime
        );

      logger.agent(
        eid,
        `Action completed: ${pendingAction.tool}\nParameters: ${JSON.stringify(
          pendingAction.parameters,
          null,
          2
        )}\nResult: ${result?.result}`,
        agentName
      );

      // Check for goal completions after action
      const completedGoals: any[] = [];
      if (hasComponent(world, eid, Goal)) {
        const currentGoals = Goal.current[eid] || [];
        const newCurrentGoals = [...currentGoals];

        // Check each goal to see if it's been completed
        for (let i = currentGoals.length - 1; i >= 0; i--) {
          const goal = currentGoals[i];
          if (goal.status === "completed") {
            completedGoals.push(goal);
            newCurrentGoals.splice(i, 1);
          }
        }

        // If any goals were completed, update the Goal component
        if (completedGoals.length > 0) {
          setComponent(world, eid, Goal, {
            current: newCurrentGoals,
            completed: [...(Goal.completed[eid] || []), ...completedGoals],
            lastUpdate: Date.now(),
            lastEvaluationTime: Goal.lastEvaluationTime[eid] || Date.now(),
          });

          logger.agent(
            eid,
            `Completed ${completedGoals.length} goals after action: ${pendingAction.tool}`,
            agentName
          );
        }
      }

      // Check for plan completions after action
      const completedPlans: any[] = [];
      if (hasComponent(world, eid, Plan)) {
        const plans = Plan.plans[eid] || [];
        const activePlans = getActivePlans(plans);

        // Check each active plan to see if it's been completed
        for (const plan of activePlans) {
          const allStepsCompleted = plan.steps.every(
            (step) => step.status === "completed"
          );
          if (allStepsCompleted && plan.status === "active") {
            plan.status = "completed";
            completedPlans.push(plan);
          }
        }

        // If any plans were completed, update the Plan component
        if (completedPlans.length > 0) {
          setComponent(world, eid, Plan, {
            plans: plans,
            lastUpdate: Date.now(),
          });

          logger.agent(
            eid,
            `Completed ${completedPlans.length} plans after action: ${pendingAction.tool}`,
            agentName
          );
        }
      }

      // Add completion data to the result
      if (result) {
        result.data = {
          ...(result.data || {}),
          completedGoals,
          completedPlans,
        };
      }

      // Broadcast action result to room
      runtime.eventBus.emitRoomEvent(
        roomEid,
        "action",
        {
          action: pendingAction.tool,
          parameters: pendingAction.parameters,
          result: result?.result,
          success: result?.success,
          agentName,
          context: "room",
          timestamp: Date.now(),
        },
        String(eid)
      );

      // Store full result in Action component
      setComponent(world, eid, Action, {
        pendingAction: null,
        lastActionTime: Date.now(),
        lastActionResult: result,
        availableTools: Action.availableTools[eid],
      });

      // Add action result to thought chain
      if (hasComponent(world, eid, Thought)) {
        const currentEntries = Thought.entries[eid] || [];
        const newEntry = {
          id: Thought.lastEntryId[eid] + 1,
          timestamp: Date.now(),
          type: "result",
          content: result?.result || "Action completed with no result",
          context: {
            roomId: Room.id[roomEid],
            metadata: {
              action: pendingAction.tool,
              parameters: pendingAction.parameters,
              success: result?.success,
              completedGoals,
              completedPlans,
            },
          },
        };

        setComponent(world, eid, Thought, {
          entries: [...currentEntries, newEntry],
          lastEntryId: newEntry.id,
          lastUpdate: Date.now(),
        });
      }

      logger.agent(eid, "Action cycle completed", agentName);
    }

    return world;
  }
);
