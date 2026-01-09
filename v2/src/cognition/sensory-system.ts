/**
 * Sensory System - Stimulus-based perception for agents
 *
 * Agents perceive the world through different sensory modalities:
 * - VISUAL: What you see (room, people, objects, actions)
 * - AUDITORY: What you hear (speech, sounds, ambient noise)
 * - OLFACTORY: What you smell (food, smoke, decay)
 * - TACTILE: What you feel (touch, temperature, pain)
 * - COGNITIVE: Meta-knowledge (affordances, intuitions, memories, danger sense)
 *
 * Each stimulus has a modality, intensity, source, and content.
 * Agents can have different sensory capabilities (blind, deaf, heightened senses).
 */

import type { World } from "../ecs/world";
import { query, getRelationTargets, hasComponent, entityExists } from "bitecs";
import { Name, Description, Agent, Mind, Room, StimulusSource } from "../ecs/components";
import { OccupiesRoom, Contains } from "../ecs/relations";
import { getDynamicComponentValues } from "../ecs/dynamic-components";
import { getAvailableAffordances } from "./cognition-system";
import { worldSchema } from "../world/schema";
import { safeGetRelationTargets } from "../ecs/dynamic-systems";

// ============================================================================
// SENSORY MODALITIES
// ============================================================================

export type SensoryModality =
  | "visual"      // Sight - room layout, people, objects, visible actions
  | "auditory"    // Hearing - speech, sounds, ambient noise
  | "olfactory"   // Smell - food, smoke, decay, perfume
  | "tactile"     // Touch - physical contact, temperature, pain
  | "cognitive";  // Sixth sense - affordances, intuitions, danger, memories

export interface Stimulus {
  modality: SensoryModality;
  type: string;           // Specific type within modality (e.g., "speech", "footsteps", "smoke")
  content: string;        // The actual perception text
  source: string;         // What/who produced this stimulus
  intensity: number;      // 0-1, affects salience and range
  timestamp: number;
}

export interface SensoryCapabilities {
  visual: number;      // 0 = blind, 1 = normal, >1 = enhanced
  auditory: number;    // 0 = deaf, 1 = normal, >1 = enhanced
  olfactory: number;   // Smell sensitivity
  tactile: number;     // Touch sensitivity
  cognitive: number;   // Intuition/sixth sense strength
}

const DEFAULT_CAPABILITIES: SensoryCapabilities = {
  visual: 1,
  auditory: 1,
  olfactory: 0.5,
  tactile: 1,
  cognitive: 0.5,  // By default, agents have limited cognitive perception
};

// ============================================================================
// STIMULUS GENERATION
// ============================================================================

/**
 * Generate all stimuli an agent would perceive this tick
 */
export function generateStimuliForAgent(
  world: World,
  agentEid: number,
  pendingEvents: Array<{ modality: SensoryModality; type: string; content: string; source: string; intensity?: number }>
): Stimulus[] {
  const stimuli: Stimulus[] = [];

  // Validate agent exists
  if (!entityExists(world, agentEid)) return stimuli;

  const capabilities = getAgentCapabilities(world, agentEid);
  const rooms = safeGetRelationTargets(world, agentEid, OccupiesRoom);
  const roomEid = rooms[0];

  if (roomEid === undefined || !entityExists(world, roomEid)) return stimuli;

  // Visual perception - what the agent sees
  if (capabilities.visual > 0) {
    stimuli.push(...generateVisualStimuli(world, agentEid, roomEid, capabilities.visual));
  }

  // Auditory perception - ambient sounds
  if (capabilities.auditory > 0) {
    stimuli.push(...generateAmbientAuditoryStimuli(world, roomEid, capabilities.auditory));
  }

  // Olfactory perception - smells
  if (capabilities.olfactory > 0) {
    stimuli.push(...generateOlfactoryStimuli(world, roomEid, capabilities.olfactory));
  }

  // Cognitive perception - affordances, intuitions
  if (capabilities.cognitive > 0) {
    stimuli.push(...generateCognitiveStimuli(world, agentEid, roomEid, capabilities.cognitive));
  }

  // Add event-based stimuli (speech, actions, etc.)
  for (const event of pendingEvents) {
    const capabilityLevel = capabilities[event.modality] || 0;
    if (capabilityLevel > 0) {
      stimuli.push({
        modality: event.modality,
        type: event.type,
        content: event.content,
        source: event.source,
        intensity: (event.intensity ?? 1) * capabilityLevel,
        timestamp: Date.now(),
      });
    }
  }

  return stimuli;
}

/**
 * Get agent's sensory capabilities (can be modified by traits, items, conditions)
 */
function getAgentCapabilities(world: World, agentEid: number): SensoryCapabilities {
  // Start with defaults
  const caps = { ...DEFAULT_CAPABILITIES };

  // Check for modifying traits
  const meta = getDynamicComponentValues("ObjectMeta", agentEid);
  if (meta?.traits) {
    const traits = meta.traits.split(",");

    // Trait-based modifications
    if (traits.includes("blind")) caps.visual = 0;
    if (traits.includes("deaf")) caps.auditory = 0;
    if (traits.includes("keen_sight")) caps.visual = 1.5;
    if (traits.includes("keen_hearing")) caps.auditory = 1.5;
    if (traits.includes("intuitive")) caps.cognitive = 1;
    if (traits.includes("psychic")) caps.cognitive = 1.5;
  }

  return caps;
}

// ============================================================================
// VISUAL STIMULI
// ============================================================================

function generateVisualStimuli(
  world: World,
  agentEid: number,
  roomEid: number,
  sensitivity: number
): Stimulus[] {
  const stimuli: Stimulus[] = [];
  const roomName = Name.value[roomEid] || "Unknown Location";
  const roomDesc = Description.value[roomEid] || "";
  const roomAmbience = Room.ambience[roomEid] || "";

  // Room environment
  const envLines: string[] = [];
  envLines.push(`You are in ${roomName}.`);
  if (roomDesc) envLines.push(roomDesc);
  if (roomAmbience) envLines.push(roomAmbience);

  stimuli.push({
    modality: "visual",
    type: "environment",
    content: envLines.join(" "),
    source: "environment",
    intensity: 1 * sensitivity,
    timestamp: Date.now(),
  });

  // Other people present
  const allAgents = Array.from(query(world, [Agent])).filter(eid => entityExists(world, eid));
  const peopleLines: string[] = [];

  for (const otherEid of allAgents) {
    if (otherEid === agentEid) continue;
    if (!entityExists(world, otherEid)) continue;

    const otherRooms = safeGetRelationTargets(world, otherEid, OccupiesRoom);
    if (otherRooms.includes(roomEid)) {
      const otherName = Name.value[otherEid] || "someone";
      const otherDesc = Description.value[otherEid];
      const meta = getDynamicComponentValues("ObjectMeta", otherEid);
      const state = meta?.state ? ` (${meta.state})` : "";

      if (otherDesc) {
        peopleLines.push(`${otherName}${state}: ${otherDesc.slice(0, 80)}`);
      } else {
        peopleLines.push(`${otherName}${state} is here.`);
      }
    }
  }

  if (peopleLines.length > 0) {
    stimuli.push({
      modality: "visual",
      type: "people",
      content: peopleLines.join(" "),
      source: "environment",
      intensity: 0.9 * sensitivity,
      timestamp: Date.now(),
    });
  }

  // Objects in room
  const contents = safeGetRelationTargets(world, roomEid, Contains);
  const objectLines: string[] = [];

  for (const contentEid of contents) {
    if (!entityExists(world, contentEid)) continue;
    if (hasComponent(world, contentEid, Agent)) continue;

    const objName = Name.value[contentEid];
    if (objName) {
      const objDesc = Description.value[contentEid];
      const meta = getDynamicComponentValues("ObjectMeta", contentEid);
      const state = meta?.state && meta.state !== "normal" ? ` (${meta.state})` : "";

      if (objDesc) {
        objectLines.push(`${objName}${state}: ${objDesc.slice(0, 60)}`);
      } else {
        objectLines.push(`${objName}${state}`);
      }
    }
  }

  if (objectLines.length > 0) {
    stimuli.push({
      modality: "visual",
      type: "objects",
      content: `You see: ${objectLines.join("; ")}`,
      source: "environment",
      intensity: 0.7 * sensitivity,
      timestamp: Date.now(),
    });
  }

  return stimuli;
}

// ============================================================================
// AUDITORY STIMULI
// ============================================================================

function generateAmbientAuditoryStimuli(
  world: World,
  roomEid: number,
  sensitivity: number
): Stimulus[] {
  const stimuli: Stimulus[] = [];
  if (!entityExists(world, roomEid)) return stimuli;

  // Find stimulus sources in room that emit sounds
  const contents = safeGetRelationTargets(world, roomEid, Contains);

  for (const contentEid of contents) {
    if (!entityExists(world, contentEid)) continue;
    if (!hasComponent(world, contentEid, StimulusSource)) continue;

    const stimType = StimulusSource.stimulusType[contentEid];
    if (stimType !== "sound" && stimType !== "auditory") continue;

    const template = StimulusSource.template[contentEid];
    const sourceName = Name.value[contentEid] || "something";
    const content = template?.replace("{name}", sourceName) || `You hear ${sourceName}.`;

    stimuli.push({
      modality: "auditory",
      type: "ambient",
      content,
      source: sourceName,
      intensity: 0.5 * sensitivity,
      timestamp: Date.now(),
    });
  }

  // Room ambience could also produce sounds
  const ambience = Room.ambience[roomEid];
  if (ambience && (ambience.includes("sound") || ambience.includes("hear") || ambience.includes("noise"))) {
    stimuli.push({
      modality: "auditory",
      type: "ambience",
      content: ambience,
      source: "environment",
      intensity: 0.3 * sensitivity,
      timestamp: Date.now(),
    });
  }

  return stimuli;
}

// ============================================================================
// OLFACTORY STIMULI
// ============================================================================

function generateOlfactoryStimuli(
  world: World,
  roomEid: number,
  sensitivity: number
): Stimulus[] {
  const stimuli: Stimulus[] = [];
  if (!entityExists(world, roomEid)) return stimuli;

  // Find things that smell
  const contents = safeGetRelationTargets(world, roomEid, Contains);

  for (const contentEid of contents) {
    if (!entityExists(world, contentEid)) continue;
    const meta = getDynamicComponentValues("ObjectMeta", contentEid);
    if (!meta?.traits) continue;

    const traits = meta.traits.split(",");
    const sourceName = Name.value[contentEid] || "something";

    // Things that typically have smells
    if (traits.includes("edible") && meta.state === "fresh") {
      stimuli.push({
        modality: "olfactory",
        type: "food",
        content: `You smell fresh ${sourceName}.`,
        source: sourceName,
        intensity: 0.6 * sensitivity,
        timestamp: Date.now(),
      });
    } else if (traits.includes("edible") && meta.state === "rotten") {
      stimuli.push({
        modality: "olfactory",
        type: "decay",
        content: `A foul smell emanates from the ${sourceName}.`,
        source: sourceName,
        intensity: 0.9 * sensitivity,
        timestamp: Date.now(),
      });
    } else if (traits.includes("burning")) {
      stimuli.push({
        modality: "olfactory",
        type: "smoke",
        content: `You smell smoke from ${sourceName}.`,
        source: sourceName,
        intensity: 0.8 * sensitivity,
        timestamp: Date.now(),
      });
    }
  }

  return stimuli;
}

// ============================================================================
// COGNITIVE STIMULI - THE SIXTH SENSE
// ============================================================================

function generateCognitiveStimuli(
  world: World,
  agentEid: number,
  roomEid: number,
  sensitivity: number
): Stimulus[] {
  const stimuli: Stimulus[] = [];

  // Only generate cognitive stimuli if sensitivity is high enough
  if (sensitivity < 0.3) return stimuli;
  if (!entityExists(world, agentEid) || !entityExists(world, roomEid)) return stimuli;

  // Affordance awareness - what actions are possible
  const contents = safeGetRelationTargets(world, roomEid, Contains);
  const affordanceAwareness: string[] = [];

  // Check other agents for interaction possibilities
  const allAgents = Array.from(query(world, [Agent])).filter(eid => entityExists(world, eid));
  for (const otherEid of allAgents) {
    if (otherEid === agentEid) continue;
    if (!entityExists(world, otherEid)) continue;

    const otherRooms = safeGetRelationTargets(world, otherEid, OccupiesRoom);
    if (otherRooms.includes(roomEid)) {
      const otherName = Name.value[otherEid] || "someone";
      const affordances = getAvailableAffordances(world, agentEid, otherEid);
      if (affordances.length > 0) {
        affordanceAwareness.push(`${otherName}: ${affordances.map(a => a.name).join(", ")}`);
      }
    }
  }

  // Check objects for interaction possibilities
  for (const contentEid of contents) {
    if (!entityExists(world, contentEid)) continue;
    if (hasComponent(world, contentEid, Agent)) continue;

    const objName = Name.value[contentEid];
    if (!objName) continue;

    const affordances = getAvailableAffordances(world, agentEid, contentEid);
    if (affordances.length > 0) {
      affordanceAwareness.push(`${objName}: ${affordances.map(a => a.name).join(", ")}`);
    }
  }

  if (affordanceAwareness.length > 0) {
    stimuli.push({
      modality: "cognitive",
      type: "affordances",
      content: `You sense possible actions: ${affordanceAwareness.join("; ")}`,
      source: "intuition",
      intensity: sensitivity,
      timestamp: Date.now(),
    });
  }

  // Danger sense - if there are hostile entities
  const dangerSources: string[] = [];
  for (const contentEid of [...contents, ...allAgents]) {
    if (contentEid === agentEid) continue;
    if (!entityExists(world, contentEid)) continue;

    const meta = getDynamicComponentValues("ObjectMeta", contentEid);
    if (!meta?.traits) continue;

    const traits = meta.traits.split(",");
    const name = Name.value[contentEid] || "something";

    if (traits.includes("hostile") || traits.includes("predator") || traits.includes("dangerous")) {
      dangerSources.push(name);
    }
  }

  if (dangerSources.length > 0 && sensitivity >= 0.5) {
    stimuli.push({
      modality: "cognitive",
      type: "danger",
      content: `You sense danger from: ${dangerSources.join(", ")}`,
      source: "intuition",
      intensity: 0.9 * sensitivity,
      timestamp: Date.now(),
    });
  }

  return stimuli;
}

// ============================================================================
// STIMULUS FORMATTING FOR AGENT PROMPT
// ============================================================================

/**
 * Format stimuli into a prompt-friendly text for the agent
 */
export function formatStimuliForPrompt(stimuli: Stimulus[]): string {
  if (stimuli.length === 0) return "You perceive nothing unusual.";

  // Group by modality
  const byModality = new Map<SensoryModality, Stimulus[]>();
  for (const stim of stimuli) {
    if (!byModality.has(stim.modality)) {
      byModality.set(stim.modality, []);
    }
    byModality.get(stim.modality)!.push(stim);
  }

  const sections: string[] = [];

  // Visual
  const visual = byModality.get("visual");
  if (visual && visual.length > 0) {
    sections.push("👁️ SIGHT:");
    for (const stim of visual) {
      sections.push(`  ${stim.content}`);
    }
  }

  // Auditory
  const auditory = byModality.get("auditory");
  if (auditory && auditory.length > 0) {
    sections.push("👂 SOUND:");
    for (const stim of auditory) {
      sections.push(`  ${stim.content}`);
    }
  }

  // Olfactory
  const olfactory = byModality.get("olfactory");
  if (olfactory && olfactory.length > 0) {
    sections.push("👃 SMELL:");
    for (const stim of olfactory) {
      sections.push(`  ${stim.content}`);
    }
  }

  // Tactile
  const tactile = byModality.get("tactile");
  if (tactile && tactile.length > 0) {
    sections.push("✋ TOUCH:");
    for (const stim of tactile) {
      sections.push(`  ${stim.content}`);
    }
  }

  // Cognitive
  const cognitive = byModality.get("cognitive");
  if (cognitive && cognitive.length > 0) {
    sections.push("🧠 INTUITION:");
    for (const stim of cognitive) {
      sections.push(`  ${stim.content}`);
    }
  }

  return sections.join("\n");
}

/**
 * Convert a simple event into a stimulus with appropriate modality
 */
export function eventToStimulus(
  event: { type: string; content: string; source: string }
): { modality: SensoryModality; type: string; content: string; source: string; intensity: number } {
  // Map event types to modalities
  let modality: SensoryModality = "visual";
  let intensity = 1;

  switch (event.type) {
    case "speech":
    case "sound":
    case "noise":
      modality = "auditory";
      intensity = 0.9;
      break;

    case "smell":
    case "odor":
      modality = "olfactory";
      intensity = 0.7;
      break;

    case "touch":
    case "pain":
    case "temperature":
      modality = "tactile";
      intensity = 0.8;
      break;

    case "intuition":
    case "memory":
    case "affordances":
    case "danger":
    case "action_result":
    case "action_failed":
      modality = "cognitive";
      intensity = 0.8;
      break;

    case "action":
    case "arrival":
    case "departure":
    case "movement":
    default:
      modality = "visual";
      intensity = 0.8;
      break;
  }

  return {
    modality,
    type: event.type,
    content: event.content,
    source: event.source,
    intensity,
  };
}
