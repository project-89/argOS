import { World, query, hasComponent, addComponent } from "bitecs";
import { Room, Stimulus, OccupiesRoom, Cleanup } from "../components";
import { logger } from "../utils/logger";
import { StimulusType, StimulusData, StimulusContent } from "../types/stimulus";
import { STIMULUS_PRIORITIES } from "../constants/stimulus";
import {
  getStimuliInRoom,
  getStimuliFromSource,
  hasStimulusSource,
  isStimulusInRoom,
  getStimulusRoomMetadata,
  getStimulusSourceMetadata,
} from "../components/relationships/stimulus";

interface StimulusContext {
  type: StimulusType;
  timestamp: number;
}

/**
 * Calculate priority score for a stimulus
 */
function calculateStimulusPriority(context: StimulusContext): number {
  const basePriority = STIMULUS_PRIORITIES[context.type] || 0;
  const age = Date.now() - context.timestamp;
  // Reduce age penalty: only subtract 0.1 per second, max 1 point
  const agePenalty = Math.min(age / 10000, 1);

  return Math.max(0, basePriority - agePenalty);
}

/**
 * Gather all relevant stimuli for an agent
 */
export function gatherStimuliForAgent(
  world: World,
  eid: number
): StimulusData[] {
  const allStimuli: StimulusData[] = [];

  // Get agent's current room
  const rooms = query(world, [Room]).filter((roomId) =>
    hasComponent(world, eid, OccupiesRoom(roomId))
  );
  const currentRoom = rooms[0];

  if (!currentRoom) {
    logger.debug(`Agent ${eid} is not in any room`);
    return [];
  }

  // Get all stimuli in the room
  const roomStimuli = getStimuliInRoom(world, currentRoom);
  logger.debug(`Found room stimuli IDs:`, roomStimuli);

  // Get all stimuli directly related to agent
  const agentStimuli = getStimuliFromSource(world, eid);
  logger.debug(`Found agent stimuli IDs:`, agentStimuli);

  // Combine and deduplicate stimuli
  const stimuliSet = new Set([...roomStimuli, ...agentStimuli]);
  logger.debug(`Combined unique stimuli IDs:`, Array.from(stimuliSet));

  for (const stimulusId of stimuliSet) {
    try {
      // Check if stimulus component exists and has required data
      if (!Stimulus.type[stimulusId] || !Stimulus.source[stimulusId]) {
        // Mark for cleanup instead of removing directly
        if (
          isStimulusInRoom(world, stimulusId, currentRoom) ||
          hasStimulusSource(world, stimulusId, eid)
        ) {
          logger.warn(
            `Found orphaned stimulus ${stimulusId}, marking for cleanup`
          );
          addComponent(world, stimulusId, Cleanup);
        }
        continue;
      }

      // Get relationship metadata
      const roomMetadata = isStimulusInRoom(world, stimulusId, currentRoom)
        ? getStimulusRoomMetadata(world, stimulusId, currentRoom)
        : null;

      const sourceMetadata = hasStimulusSource(world, stimulusId, eid)
        ? getStimulusSourceMetadata(world, stimulusId, eid)
        : null;

      // Parse content metadata
      let contentMetadata;
      try {
        const content = Stimulus.content[stimulusId];
        if (content) {
          const parsed = JSON.parse(content) as StimulusContent;
          contentMetadata = parsed.metadata;
        }
      } catch (e) {
        logger.error("Error parsing stimulus content:", e);
      }

      // Combine metadata from all sources
      const combinedMetadata = {
        ...contentMetadata,
        ...(roomMetadata?.metadata || {}),
        ...(sourceMetadata?.metadata || {}),
      };

      const stimulusData: StimulusData = {
        eid: stimulusId,
        type: Stimulus.type[stimulusId] as StimulusType,
        source: Stimulus.source[stimulusId],
        timestamp: Stimulus.timestamp[stimulusId],
        content: Stimulus.content[stimulusId],
        subtype: Stimulus.subtype[stimulusId],
        intensity:
          roomMetadata?.intensity ||
          sourceMetadata?.strength ||
          Stimulus.intensity[stimulusId],
        private: Stimulus.private[stimulusId],
        decay: Stimulus.decay[stimulusId],
        priority: calculateStimulusPriority({
          type: Stimulus.type[stimulusId] as StimulusType,
          timestamp: Stimulus.timestamp[stimulusId],
        }),
        metadata: combinedMetadata,
      };

      // Mark stimulus for cleanup after processing
      addComponent(world, stimulusId, Cleanup);

      allStimuli.push(stimulusData);
    } catch (error) {
      logger.error(`Error processing stimulus ${stimulusId}:`, error);
    }
  }

  logger.debug(
    `Gathered ${allStimuli.length} relevant stimuli for agent ${eid}`
  );
  return allStimuli;
}

/**
 * Filter and prioritize stimuli based on type and relevance
 */
export function filterAndPrioritizeStimuli(
  world: World,
  stimuli: StimulusData[],
  threshold = 0,
  agentId?: number
): StimulusData[] {
  return stimuli
    .filter((stimulus) => {
      // Filter out self-generated visual stimuli using relationships
      if (
        agentId &&
        stimulus.type === StimulusType.VISUAL &&
        hasStimulusSource(world, stimulus.eid, agentId)
      ) {
        return false;
      }

      // Keep stimuli above priority threshold
      return (stimulus.priority || 0) > threshold;
    })
    .sort((a, b) => (b.priority || 0) - (a.priority || 0));
}

/**
 * Extract salient entities from stimuli
 */
export function extractSalientEntities(world: World, stimuli: StimulusData[]) {
  const entities = new Map<
    number,
    { type: string; mentions: number; lastSeen: number }
  >();

  stimuli.forEach((stimulus) => {
    // Get source entities from relationships
    const sourceEntities = getStimuliFromSource(world, stimulus.eid);
    sourceEntities.forEach((sourceId) => {
      if (!entities.has(sourceId)) {
        entities.set(sourceId, {
          type: stimulus.type,
          mentions: 0,
          lastSeen: stimulus.timestamp,
        });
      }

      const entity = entities.get(sourceId)!;
      entity.mentions++;
      entity.lastSeen = Math.max(entity.lastSeen, stimulus.timestamp);
    });
  });

  return Array.from(entities.entries())
    .map(([id, data]) => ({
      id,
      type: data.type,
      relevance: data.mentions,
    }))
    .sort((a, b) => b.relevance - a.relevance);
}

/**
 * Build room context from stimuli
 */
export function buildRoomContext(stimuli: StimulusData[]) {
  const context: Record<
    string,
    {
      stimuliCount: number;
      lastUpdate: number;
      content: string;
    }
  > = {};

  stimuli.forEach((stimulus) => {
    if (!stimulus.metadata?.roomId) return;

    const roomId = stimulus.metadata.roomId;
    context[roomId] = context[roomId] || {
      stimuliCount: 0,
      lastUpdate: 0,
      content: "",
    };

    const roomContext = context[roomId];
    roomContext.stimuliCount++;
    roomContext.lastUpdate = Math.max(
      roomContext.lastUpdate,
      stimulus.timestamp
    );
    roomContext.content = stimulus.content;
  });

  return context;
}
