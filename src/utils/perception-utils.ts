import { World, query, hasComponent } from "bitecs";
import {
  Room,
  Stimulus,
  OccupiesRoom,
  StimulusTypes,
  StimulusType,
  SourceType,
} from "../components";
import { logger } from "./logger";
import { StimulusData } from "../types/stimulus";

// Priority mapping for different stimulus types
export const STIMULUS_PRIORITIES = {
  AUDITORY: 4,
  COGNITIVE: 3,
  VISUAL: 2,
  ENVIRONMENTAL: 1,
  TECHNICAL: 1,
} as const;

/**
 * Gather all relevant stimuli for an agent
 */
export function gatherStimuliForAgent(
  world: World,
  eid: number
): StimulusData[] {
  // Get rooms the agent occupies
  const agentRooms = query(world, [Room])
    .filter((roomId) => hasComponent(world, eid, OccupiesRoom(roomId)))
    .map((roomId) => Room.id[roomId]);

  const allStimuli: StimulusData[] = [];
  const stimuliEntities = query(world, [Stimulus]);

  for (const stimulusId of stimuliEntities) {
    try {
      // Skip stimuli not in agent's rooms
      if (!agentRooms.includes(Stimulus.roomId[stimulusId])) {
        continue;
      }

      const stimulusData: StimulusData = {
        type: Stimulus.type[stimulusId] as StimulusType,
        sourceEntity: Stimulus.sourceEntity[stimulusId],
        source: Stimulus.source[stimulusId] as SourceType,
        timestamp: Stimulus.timestamp[stimulusId],
        roomId: Stimulus.roomId[stimulusId],
        content: Stimulus.content[stimulusId],
        decay: Stimulus.decay[stimulusId],
        priority: calculateStimulusPriority({
          type: Stimulus.type[stimulusId] as StimulusType,
          timestamp: Stimulus.timestamp[stimulusId],
        }),
      };

      allStimuli.push(stimulusData);
    } catch (error) {
      logger.error(`Error processing stimulus ${stimulusId}:`, error);
    }
  }

  return allStimuli;
}

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
  const agePenalty = Math.min(age / 1000, 5); // Penalty increases with age, caps at 5 seconds

  return Math.max(0, basePriority - agePenalty);
}

/**
 * Filter and prioritize stimuli based on type and relevance
 */
export function filterAndPrioritizeStimuli(
  stimuli: StimulusData[],
  threshold = 0,
  agentId?: number
): StimulusData[] {
  return stimuli
    .filter((stimulus) => {
      // Filter out self-generated visual stimuli
      if (
        agentId &&
        stimulus.type === StimulusTypes.VISUAL &&
        stimulus.sourceEntity === agentId
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
export function extractSalientEntities(stimuli: StimulusData[]) {
  const entities = new Map<
    number,
    { type: string; mentions: number; lastSeen: number }
  >();

  stimuli.forEach((stimulus) => {
    if (!entities.has(stimulus.sourceEntity)) {
      entities.set(stimulus.sourceEntity, {
        type: stimulus.type,
        mentions: 0,
        lastSeen: stimulus.timestamp,
      });
    }

    const entity = entities.get(stimulus.sourceEntity)!;
    entity.mentions++;
    entity.lastSeen = Math.max(entity.lastSeen, stimulus.timestamp);
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
    if (!stimulus.roomId) return;

    context[stimulus.roomId] = context[stimulus.roomId] || {
      stimuliCount: 0,
      lastUpdate: 0,
      content: "",
    };

    const roomContext = context[stimulus.roomId];
    roomContext.stimuliCount++;
    roomContext.lastUpdate = Math.max(
      roomContext.lastUpdate,
      stimulus.timestamp
    );
    roomContext.content = stimulus.content;
  });

  return context;
}
