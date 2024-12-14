import { World, query, setComponent } from "bitecs";
import { Agent, Memory, Perception } from "../components/agent/Agent";
import { logger } from "../utils/logger";
import { createSystem } from "./System";
import {
  gatherStimuliForAgent,
  filterAndPrioritizeStimuli,
  extractSalientEntities,
  buildRoomContext,
} from "../utils/perception-utils";
import { processStimulus } from "../llm/agent-llm";
import { PerceptionContext } from "../types/perception";

export const PerceptionSystem = createSystem(
  (runtime) => async (world: World) => {
    const agents = query(world, [Agent, Memory, Perception]);
    logger.system(`PerceptionSystem processing ${agents.length} agents`);

    for (const eid of agents) {
      try {
        // Skip inactive agents
        if (!Agent.active[eid]) {
          logger.debug(`Agent ${Agent.name[eid]} is not active, skipping`);
          continue;
        }

        // Stage 1: Gather all relevant stimuli for the agent
        const rawStimuli = gatherStimuliForAgent(world, eid);

        // Skip if no new stimuli and last process was recent
        const lastProcessTime = Perception.lastProcessedTime[eid] || 0;
        if (
          rawStimuli.length === 0 &&
          Date.now() - lastProcessTime < 1000 // Only process if more than 1 second has passed
        ) {
          continue;
        }

        // Stage 2: Filter and prioritize stimuli
        const prioritizedStimuli = filterAndPrioritizeStimuli(
          rawStimuli,
          0,
          eid
        );

        // Stage 3: Build perception context
        const context: PerceptionContext = {
          salientEntities: extractSalientEntities(prioritizedStimuli),
          roomContext: buildRoomContext(prioritizedStimuli),
          recentEvents: [], // Will be populated from Memory if needed
          agentRole: Agent.role[eid],
          agentPrompt: Agent.systemPrompt[eid],
          stats: {
            totalStimuli: prioritizedStimuli.length,
            processedTimestamp: Date.now(),
          },
        };

        // Stage 4: Generate narrative perception using processStimulus
        const perceptionState = {
          name: Agent.name[eid],
          role: Agent.role[eid],
          systemPrompt: Agent.systemPrompt[eid],
          recentPerceptions: Memory.perceptions[eid] || "",
          timeSinceLastPerception: Date.now() - lastProcessTime,
          currentTimestamp: Date.now(),
          lastAction: undefined, // Can be added if needed
          stimulus: prioritizedStimuli.map((s) => ({
            type: s.type,
            source: s.sourceEntity,
            data: JSON.parse(s.content),
            timestamp: s.timestamp,
          })),
          context,
        };

        const narrative = await processStimulus(perceptionState);

        // Stage 5: Update agent's perception component
        setComponent(world, eid, Perception, {
          currentStimuli: prioritizedStimuli,
          context,
          summary: narrative,
          lastProcessedTime: Date.now(),
          lastUpdate: Date.now(),
        });

        // Stage 6: Update Memory with new perception
        setComponent(world, eid, Memory, {
          perceptions: [...Memory.perceptions[eid], narrative],
        });

        // Emit perception event
        runtime.eventBus.emitAgentEvent(eid, "perception", "perception", {
          stimuliCount: prioritizedStimuli.length,
          salientEntities: context.salientEntities,
          roomContext: context.roomContext,
          narrative,
          timestamp: Date.now(),
        });

        logger.debug(
          `Updated perception for ${Agent.name[eid]}: ${prioritizedStimuli.length} stimuli processed`
        );
      } catch (error) {
        logger.error(`Error in PerceptionSystem for agent ${eid}:`, error);
      }
    }

    return world;
  }
);
