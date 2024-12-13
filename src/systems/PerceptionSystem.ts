import { hasComponent, query, setComponent, World } from "bitecs";
import { SimulationRuntime } from "../runtime/SimulationRuntime";
import {
  Agent,
  OccupiesRoom,
  Perception,
  Perceptions,
  Room,
  Stimulus,
} from "../components/agent/Agent";
import { findRoomByStringId } from "../utils/queries";
import { createSystem, SystemConfig } from "./System";
import { logger } from "../utils/logger";

// System for managing agent perception of the world
export const PerceptionSystem = createSystem<SystemConfig>(
  (runtime) => async (world: World) => {
    const agents = query(world, [Agent, Perception]);
    logger.system(`PerceptionSystem processing ${agents.length} agents`);

    for (const eid of agents) {
      if (!Agent.active[eid]) {
        logger.debug(`Agent ${Agent.name[eid]} is not active, skipping`);
        continue;
      }

      // Get rooms the agent is in (both physical and virtual)
      const roomIds = query(world, [Room]).filter((r) =>
        hasComponent(world, eid, OccupiesRoom(r))
      );

      // Combine all Stimuli into an array
      let allStimuli: Array<any> = [];

      for (const roomId of roomIds) {
        allStimuli.push(
          ...Object.keys(Stimulus.type)
            .map(Number)
            .filter((stimuliId) => {
              return (
                Stimulus.roomId[stimuliId] ===
                (Room.id[roomId] || String(roomId))
              );
            })
            .map((stimuliId) => ({
              type: Stimulus.type[stimuliId],
              sourceEntity: Stimulus.sourceEntity[stimuliId],
              source: Stimulus.source[stimuliId],
              content: Stimulus.content[stimuliId]
                ? JSON.parse(Stimulus.content[stimuliId])
                : {},
              timestamp: Stimulus.timestamp[stimuliId],
              roomId: Stimulus.roomId[stimuliId],
            }))
        );
      }

      // Get any stimuli in perception component that are high priority
      const perceptionStimuli = Perception.currentStimuli[eid] || [];

      // Combine these into a single array
      const combinedStimuli = [...perceptionStimuli, ...allStimuli];

      // Implement Prioritization based on type and source of stimuli, with direct being most important
      const prioritizedStimuli = combinedStimuli.sort((a, b) => {
        const priorityA = getStimuliPriority(a.type, a.source);
        const priorityB = getStimuliPriority(b.type, b.source);
        return priorityB - priorityA;
      });

      // Filter based on context, if any
      const filteredStimuli = prioritizedStimuli.filter((stimuli) => {
        // If not a direct interaction, only read from the current room
        return (
          stimuli.source === "USER" ||
          !!findRoomByStringId(world, stimuli.roomId)
        );
      });

      // Generate perceptions based on the new stimuli and queue
      const result = await processPerception(
        eid,
        filteredStimuli,
        world,
        runtime
      );
      setComponent(world, eid, Perceptions, result);

      // Clear current stimulus queue to prevent duplicate processing
      setComponent(world, eid, Perception, {
        currentStimuli: [],
        lastProcessedTime: Date.now(),
      });
    }
    return world;
  }
);

function getStimuliPriority(type: string, source: string) {
  if (source === "USER") return 5;
  if (type === "AUDITORY") return 4; // Highest
  if (type === "COGNITIVE") return 3; // Next
  if (type === "VISUAL") return 2; // Lower
  return 1; // Lowest
}
async function processPerception(
  eid: number,
  stimuli: any[],
  world: World,
  runtime: SimulationRuntime
): Promise<Perceptions> {
  const agentName = Agent.name[eid];
  const systemPrompt = Agent.systemPrompt[eid];

  // If there is nothing to process, just return null
  if (!stimuli || stimuli.length === 0) {
    return { summary: "I perceive nothing of note." };
  }

  const perceptionString = stimuli
    .map((stim: any) => {
      const str = JSON.stringify(stim.content);
      return `[${new Date(stim.timestamp).toLocaleTimeString()}] <${
        stim.type
      }> ${str}`;
    })
    .join("\n");

  return {
    summary: perceptionString,
    context: {
      agentName,
      systemPrompt,
      timestamp: Date.now(),
    },
  };
}
