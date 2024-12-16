import { World, query, setComponent } from "bitecs";
import { Agent, Memory, Perception } from "../components";
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
    logger.system("PerceptionSystem", `Processing ${agents.length} agents`);

    for (const eid of agents) {
      try {
        const agentName = Agent.name[eid];

        // Skip inactive agents
        if (!Agent.active[eid]) {
          logger.debug(`Agent ${agentName} is not active, skipping`);
          continue;
        }

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
          continue;
        }

        // Stage 2: Filter and prioritize stimuli
        const prioritizedStimuli = filterAndPrioritizeStimuli(
          rawStimuli,
          0,
          eid
        );
        logger.agent(
          eid,
          `Prioritized ${prioritizedStimuli.length} stimuli for processing`,
          agentName
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

        logger.agent(
          eid,
          `Built perception context with ${context.salientEntities.length} salient entities`,
          agentName
        );

        // Stage 4: Generate narrative perception using processStimulus
        const perceptionState = {
          name: agentName,
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
        logger.agent(
          eid,
          `Generated perception narrative: ${narrative.substring(0, 100)}...`,
          agentName
        );

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

        logger.agent(
          eid,
          `Completed perception cycle: ${prioritizedStimuli.length} stimuli processed`,
          agentName
        );
      } catch (error) {
        const agentName = Agent.name[eid];
        logger.error(
          `Error in PerceptionSystem for agent ${agentName}:`,
          error
        );
      }
    }

    return world;
  }
);
