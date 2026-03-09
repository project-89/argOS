/**
 * Ambient Stimulus System
 *
 * Processes StimulusSource entities and emits periodic stimuli to nearby agents.
 * Examples:
 * - A fire that crackles (auditory)
 * - A flower that has a scent (olfactory)
 * - A light source that flickers (visual)
 *
 * TEMPLATE VARIATIONS:
 * Templates can include multiple variations separated by "|" to add variety.
 * Example: "The {name} bubbles softly|Water splashes from the {name}|The {name}'s water glistens"
 * One variation is randomly selected each time the stimulus is emitted.
 */

import type { World } from "../ecs/world";
import { query } from "bitecs";
import { Name, StimulusSource } from "../ecs/components";
import { getRoomForEntity } from "../ecs/location";
import { broadcastToRoom } from "../cognition/cognition-system";
import type { SensoryModality } from "../cognition/sensory-system";

export const name = "AmbientStimulusSystem";
export const description = "Emits periodic stimuli from StimulusSource entities with variation support";
export const frequency = 5000; // Every 5 seconds
export const active = true;

// Track recent emissions to avoid immediate repetition
const recentEmissions = new Map<number, string[]>(); // sourceEid -> last N contents
const MAX_RECENT_TRACK = 3;

/**
 * Parse a template that may contain variations (separated by "|")
 * Returns all possible variations
 */
function parseTemplateVariations(template: string): string[] {
  if (!template.includes("|")) {
    return [template];
  }
  return template.split("|").map(v => v.trim()).filter(v => v.length > 0);
}

/**
 * Select a variation, preferring ones not recently used
 */
function selectVariation(sourceEid: number, variations: string[]): string {
  if (variations.length === 1) return variations[0];

  const recent = recentEmissions.get(sourceEid) || [];

  // Filter out recently used variations if possible
  const unused = variations.filter(v => !recent.includes(v));
  const pool = unused.length > 0 ? unused : variations;

  // Pick randomly from the pool
  const selected = pool[Math.floor(Math.random() * pool.length)];

  // Update recent tracking
  recent.push(selected);
  if (recent.length > MAX_RECENT_TRACK) {
    recent.shift();
  }
  recentEmissions.set(sourceEid, recent);

  return selected;
}

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

    // Parse template variations and select one
    const variations = parseTemplateVariations(template);
    const selectedTemplate = selectVariation(sourceEid, variations);

    // Generate content from selected template
    const content = selectedTemplate
      .replace(/\{name\}/g, sourceName)
      .replace(/\{source\}/g, sourceName);

    if (!content) continue;

    const modality = getModality(stimType);

    // Find what room this source is in
    const roomEid = getRoomForEntity(world, sourceEid);

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
