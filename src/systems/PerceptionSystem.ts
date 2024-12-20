import { World, query, setComponent } from "bitecs";
import { Agent, Memory, Perception } from "../components";
import { logger } from "../utils/logger";
import { createSystem } from "./System";
import {
  gatherStimuliForAgent,
  filterAndPrioritizeStimuli,
  extractSalientEntities,
  buildRoomContext,
} from "../factories/perceptionFactory";
import { processStimulus } from "../llm/agent-llm";
import { PerceptionContext } from "../types/perception";
import { processConcurrentAgents } from "../utils/system-utils";
import {
  MAX_STIMULI_PER_TICK,
  STIMULUS_BATCH_SIZE,
} from "../constants/stimulus";

export const PerceptionSystem = createSystem(
  (runtime) => async (world: World) => {
    const agents = query(world, [Agent, Memory, Perception]);

    await processConcurrentAgents(
      world,
      agents,
      "PerceptionSystem",
      async (eid) => {
        if (!Agent.active[eid]) {
          logger.debug(`Agent ${Agent.name[eid]} is not active, skipping`);
          return;
        }

        const agentName = Agent.name[eid];

        // Stage 1: Gather all relevant stimuli for the agent
        const rawStimuli = gatherStimuliForAgent(world, eid);
        logger.agent(
          eid,
          `Gathered ${rawStimuli.length} raw stimuli`,
          agentName
        );

        // Skip if no new stimuli and last process was recent
        const lastProcessTime = Perception.lastProcessedTime[eid] || 0;
        if (
          rawStimuli.length === 0 &&
          Date.now() - lastProcessTime < 1000 // Only process if more than 1 second has passed
        ) {
          return;
        }

        // Stage 2: Filter and prioritize stimuli
        const prioritizedStimuli = filterAndPrioritizeStimuli(
          world,
          rawStimuli,
          0,
          eid
        ).slice(0, MAX_STIMULI_PER_TICK); // Limit number of stimuli processed per tick

        logger.agent(
          eid,
          `Prioritized ${prioritizedStimuli.length} stimuli for processing`,
          agentName
        );

        // Process stimuli in batches if there are too many
        const stimuliBatches = [];
        for (
          let i = 0;
          i < prioritizedStimuli.length;
          i += STIMULUS_BATCH_SIZE
        ) {
          stimuliBatches.push(
            prioritizedStimuli.slice(i, i + STIMULUS_BATCH_SIZE)
          );
        }

        let narratives = [];
        for (const batch of stimuliBatches) {
          // Stage 3: Build perception context for batch
          const context: PerceptionContext = {
            salientEntities: extractSalientEntities(world, batch),
            roomContext: buildRoomContext(batch),
            recentEvents: [], // Will be populated from Memory if needed
            agentRole: Agent.role[eid],
            agentPrompt: Agent.systemPrompt[eid],
            stats: {
              totalStimuli: batch.length,
              processedTimestamp: Date.now(),
            },
          };

          logger.agent(
            eid,
            `Processing batch of ${batch.length} stimuli with ${context.salientEntities.length} salient entities`,
            agentName
          );

          // Stage 4: Generate narrative perception for batch
          const perceptionState = {
            name: agentName,
            role: Agent.role[eid],
            systemPrompt: Agent.systemPrompt[eid],
            recentPerceptions: Memory.perceptions[eid] || "",
            timeSinceLastPerception: Date.now() - lastProcessTime,
            currentTimestamp: Date.now(),
            lastAction: undefined, // Can be added if needed
            stimulus: batch,
            context,
          };

          const batchNarrative = await processStimulus(perceptionState);
          narratives.push(batchNarrative);
        }

        const combinedNarrative = narratives.join(" ");
        logger.agent(
          eid,
          `Generated combined perception narrative: ${combinedNarrative.substring(
            0,
            100
          )}...`,
          agentName
        );

        // Stage 5: Update agent's perception component
        setComponent(world, eid, Perception, {
          currentStimuli: prioritizedStimuli,
          context: {
            salientEntities: extractSalientEntities(world, prioritizedStimuli),
            roomContext: buildRoomContext(prioritizedStimuli),
            recentEvents: [],
            agentRole: Agent.role[eid],
            agentPrompt: Agent.systemPrompt[eid],
            stats: {
              totalStimuli: prioritizedStimuli.length,
              processedTimestamp: Date.now(),
            },
          },
          summary: combinedNarrative,
          lastProcessedTime: Date.now(),
          lastUpdate: Date.now(),
        });

        // Stage 6: Update Memory with new perception
        setComponent(world, eid, Memory, {
          perceptions: [...Memory.perceptions[eid], combinedNarrative],
        });

        // Emit perception event
        runtime.eventBus.emitAgentEvent(eid, "perception", "perception", {
          stimuliCount: prioritizedStimuli.length,
          salientEntities: extractSalientEntities(world, prioritizedStimuli),
          roomContext: buildRoomContext(prioritizedStimuli),
          narrative: combinedNarrative,
          timestamp: Date.now(),
        });

        logger.agent(
          eid,
          `Completed perception cycle: ${prioritizedStimuli.length} stimuli processed`,
          agentName
        );

        return {
          stimuliCount: prioritizedStimuli.length,
          narrative: combinedNarrative,
        };
      }
    );

    return world;
  }
);
