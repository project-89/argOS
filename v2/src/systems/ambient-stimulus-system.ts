/**
 * Ambient Stimulus System
 *
 * Processes StimulusSource entities and emits periodic stimuli to nearby agents.
 * Examples:
 * - A fire that crackles (auditory)
 * - A flower that has a scent (olfactory)
 * - A light source that flickers (visual)
 */

import type { World } from "../ecs/world";
import { query, getRelationTargets, hasComponent } from "bitecs";
import { Name, StimulusSource, Agent } from "../ecs/components";
import { OccupiesRoom, Contains } from "../ecs/relations";
import { broadcastToRoom, queueStimulus } from "../cognition/cognition-system";
import type { SensoryModality } from "../cognition/sensory-system";

export const name = "AmbientStimulusSystem";
export const description = "Emits periodic stimuli from StimulusSource entities";
export const frequency = 5000; // Every 5 seconds
export const active = true;

/**
 * Map stimulus type strings to sensory modalities
 */
function getModality(stimType: string): SensoryModality {
  const type = stimType.toLowerCase();

  if (type.includes("sound") || type.includes("audio") || type.includes("crackle") ||
      type.includes("noise") || type.includes("whisper") || type.includes("hum")) {
    return "auditory";
  }

  if (type.includes("smell") || type.includes("odor") || type.includes("scent") ||
      type.includes("aroma") || type.includes("stench")) {
    return "olfactory";
  }

  if (type.includes("touch") || type.includes("vibration") || type.includes("temperature") ||
      type.includes("heat") || type.includes("cold")) {
    return "tactile";
  }

  if (type.includes("sense") || type.includes("feeling") || type.includes("intuition") ||
      type.includes("presence")) {
    return "cognitive";
  }

  // Default to visual
  return "visual";
}

export function run(world: World, tick: number): void {
  const now = Date.now();

  // Find all stimulus sources
  const sources = Array.from(query(world, [StimulusSource]));

  for (const sourceEid of sources) {
    const interval = StimulusSource.interval[sourceEid] || 10000;
    const lastEmit = StimulusSource.lastEmit[sourceEid] || 0;

    // Check if it's time to emit
    if (now - lastEmit < interval) continue;

    // Update last emit time
    StimulusSource.lastEmit[sourceEid] = now;

    const stimType = StimulusSource.stimulusType[sourceEid] || "ambient";
    const template = StimulusSource.template[sourceEid] || "";
    const sourceName = Name.value[sourceEid] || "something";

    // Generate content from template
    const content = template
      .replace(/\{name\}/g, sourceName)
      .replace(/\{source\}/g, sourceName);

    if (!content) continue;

    const modality = getModality(stimType);

    // Find what room this source is in
    const roomEid = findRoomContaining(world, sourceEid);

    if (roomEid !== undefined) {
      // Broadcast to all agents in the room
      broadcastToRoom(world, roomEid, {
        type: stimType,
        modality,
        content,
        source: sourceName,
      });
    }
  }
}

/**
 * Find what room contains this entity
 */
function findRoomContaining(world: World, eid: number): number | undefined {
  // Check if entity occupies a room directly
  const occupiedRooms = getRelationTargets(world, eid, OccupiesRoom);
  if (occupiedRooms.length > 0) {
    return occupiedRooms[0];
  }

  // Check if entity is contained in a room
  // We need to find rooms and check their Contains relation
  // For simplicity, query all entities and check Contains
  const allEntities = Array.from(query(world, []));

  for (const containerEid of allEntities) {
    const contents = getRelationTargets(world, containerEid, Contains);
    if (contents.includes(eid)) {
      // This container has our entity - is it a room?
      // For now, assume containers with Contains relation to stimulus sources are rooms
      return containerEid;
    }
  }

  return undefined;
}

/**
 * Helper to create a stimulus source entity configuration
 */
export interface StimulusSourceConfig {
  stimulusType: string;  // "sound", "smell", "visual", etc.
  template: string;      // "{name} crackles softly" - {name} is replaced with entity name
  interval: number;      // Milliseconds between emissions
}

/**
 * Set up a stimulus source on an entity
 */
export function configureStimulusSource(
  eid: number,
  config: StimulusSourceConfig
): void {
  StimulusSource.stimulusType[eid] = config.stimulusType;
  StimulusSource.template[eid] = config.template;
  StimulusSource.interval[eid] = config.interval;
  StimulusSource.lastEmit[eid] = 0;
}
