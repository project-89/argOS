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
import { Name, Description, Agent, Mind, Room, StimulusSource, Traits, Inventory, ObjectState, ObjectType } from "../ecs/components";
import { getRoomForEntity, listDirectContents } from "../ecs/location";
import { getAvailableAffordances } from "../world/affordance-availability";
import { getEffectiveActorTraits } from "../world/effect-executor";
import { worldSchema } from "../world/schema";
import { safeGetRelationTargets } from "../ecs/dynamic-systems";

function parseTraitsJson(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((t) => String(t)).map((t) => t.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function hasTrait(world: World, eid: number, trait: string): boolean {
  const wanted = String(trait || "").trim().toLowerCase();
  if (!wanted) return false;
  if (!hasComponent(world, eid, Traits)) return false;
  return parseTraitsJson(Traits.active[eid]).some((t) => t.toLowerCase() === wanted);
}

function isOpenContainer(world: World, eid: number): boolean {
  const state = String(ObjectState?.current?.[eid] || "").toLowerCase();
  if (state === "open") return true;
  return hasTrait(world, eid, "open");
}

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
  const roomEid = getRoomForEntity(world, agentEid);

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

  // Add awareness of notable object states (things that might need fixing)
  const notableStates = getNotableObjectStates(world, roomEid);
  if (notableStates.length > 0) {
    stimuli.push({
      modality: "cognitive",
      type: "awareness",
      content: `Objects needing attention: ${notableStates.join(", ")}`,
      source: "intuition",
      intensity: 0.7,
      timestamp: Date.now(),
    });
  }

  return stimuli;
}

/**
 * Get agent's sensory capabilities (can be modified by traits, items, conditions)
 */
function getAgentCapabilities(world: World, agentEid: number): SensoryCapabilities {
  // Start with defaults
  const caps = { ...DEFAULT_CAPABILITIES };

  // Check for modifying traits - read from ECS Traits.active component
  const traitsJson = Traits?.active?.[agentEid];
  if (traitsJson) {
    try {
      const traits = JSON.parse(traitsJson) as string[];

      // Trait-based modifications
      if (traits.includes("blind")) caps.visual = 0;
      if (traits.includes("deaf")) caps.auditory = 0;
      if (traits.includes("keen_sight")) caps.visual = 1.5;
      if (traits.includes("keen_hearing")) caps.auditory = 1.5;
      if (traits.includes("intuitive")) caps.cognitive = 1;
      if (traits.includes("psychic")) caps.cognitive = 1.5;
    } catch { /* ignore parse errors */ }
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

    const otherRoom = getRoomForEntity(world, otherEid);
    if (otherRoom === roomEid) {
      const otherName = Name.value[otherEid] || "someone";
      const otherDesc = Description.value[otherEid];
      // Read state from ECS ObjectState component (not ObjectMeta)
      const currentState = ObjectState?.current?.[otherEid];
      const state = currentState && currentState !== "normal" ? ` (${currentState})` : "";

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
  const contents = listDirectContents(world, roomEid);
  const objectLines: string[] = [];

  for (const contentEid of contents) {
    if (!entityExists(world, contentEid)) continue;
    if (hasComponent(world, contentEid, Agent)) continue;

    const objName = Name.value[contentEid];
    if (objName) {
      // Description.value is updated from WorldSchema by ObjectManager.transitionState()
      const objDesc = Description.value[contentEid];
      // Read state from ECS ObjectState component (not ObjectMeta)
      const currentState = ObjectState?.current?.[contentEid];
      const state = currentState && currentState !== "normal" ? ` [${currentState}]` : "";

      if (objDesc) {
        // Show full description - it contains important state info from WorldSchema
        objectLines.push(`- ${objName}${state}: ${objDesc}`);
      } else {
        objectLines.push(`- ${objName}${state}`);
      }

      // If this is an open container, show a small sample of its direct contents (grounding for container tasks).
      if (isOpenContainer(world, contentEid)) {
        const inner = listDirectContents(world, contentEid)
          .filter((eid) => entityExists(world, eid) && !hasComponent(world, eid, Agent))
          .slice(0, 6);
        if (inner.length > 0) {
          const innerNames = inner.map((eid) => Name.value[eid]).filter((n): n is string => typeof n === "string" && n.trim().length > 0);
          if (innerNames.length > 0) {
            objectLines.push(`  (inside ${objName}): ${innerNames.join(", ")}`);
          }
        }
      }
    }
  }

  if (objectLines.length > 0) {
    stimuli.push({
      modality: "visual",
      type: "objects",
      content: `Objects here:\n${objectLines.join("\n")}`,
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
  const contents = listDirectContents(world, roomEid);

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
  const contents = listDirectContents(world, roomEid);

  for (const contentEid of contents) {
    if (!entityExists(world, contentEid)) continue;

    // Read traits from ECS Traits.active component (not ObjectMeta)
    const traitsJson = Traits?.active?.[contentEid];
    if (!traitsJson) continue;

    let traits: string[] = [];
    try {
      traits = JSON.parse(traitsJson) as string[];
    } catch { continue; }

    const sourceName = Name.value[contentEid] || "something";
    // Read state from ECS ObjectState component
    const currentState = ObjectState?.current?.[contentEid];

    // Things that typically have smells
    if (traits.includes("edible") && currentState === "fresh") {
      stimuli.push({
        modality: "olfactory",
        type: "food",
        content: `You smell fresh ${sourceName}.`,
        source: sourceName,
        intensity: 0.6 * sensitivity,
        timestamp: Date.now(),
      });
    } else if (traits.includes("edible") && currentState === "rotten") {
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
  const contents = listDirectContents(world, roomEid);
  const affordanceAwareness: string[] = [];

  // Check other agents for interaction possibilities
  const allAgents = Array.from(query(world, [Agent])).filter(eid => entityExists(world, eid));
  for (const otherEid of allAgents) {
    if (otherEid === agentEid) continue;
    if (!entityExists(world, otherEid)) continue;

    const otherRoom = getRoomForEntity(world, otherEid);
    if (otherRoom === roomEid) {
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

    // Read traits from ECS Traits.active component (not ObjectMeta)
    const traitsJson = Traits?.active?.[contentEid];
    if (!traitsJson) continue;

    let traits: string[] = [];
    try {
      traits = JSON.parse(traitsJson) as string[];
    } catch { continue; }

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
// AGENT SELF-AWARENESS - Capabilities and Action History
// ============================================================================

/**
 * Get agent's current tool/resource capabilities (traits starting with "has")
 * Uses DYNAMIC TRAIT RESOLUTION - capabilities come from held items, not copied traits
 *
 * Example: Holding a sharp knife gives "knife" capability
 * Example: Holding an open spice jar gives "spices" capability
 */
export function getAgentToolCapabilities(agentEid: number): string[];
export function getAgentToolCapabilities(world: World, agentEid: number): string[];
export function getAgentToolCapabilities(arg1: World | number, arg2?: number): string[] {
  // Canonical capability resolution requires the ECS `world` (traits/state/type are ECS components).
  // If callers don't have a world (e.g. some unit tests), omit capabilities rather than guessing.
  if (typeof arg1 === "number") return [];
  if (arg2 === undefined) return [];

  const effectiveTraits = getEffectiveActorTraits(arg1, arg2);

  return Array.from(effectiveTraits)
    .filter(t => t.startsWith("has"))
    .map(t => {
      // Convert "hasCrowbar" -> "crowbar", "hasOil" -> "oil"
      return t.slice(3).charAt(0).toLowerCase() + t.slice(4);
    });
}

/**
 * Get the names of items in an agent's inventory
 * Critical for preventing hallucination about what agent has
 */
export function getInventoryItemNames(agentEid: number): string[];
export function getInventoryItemNames(world: World, agentEid: number): string[];
export function getInventoryItemNames(arg1: World | number, arg2?: number): string[] {
  if (typeof arg1 === "number") return [];
  if (arg2 === undefined) return [];

  const itemIds = listDirectContents(arg1, arg2);
  return itemIds
    .map(eid => Name?.value?.[eid])
    .filter((n): n is string => typeof n === "string" && n.length > 0);
}

// Track recent successful actions per agent for better memory
const recentSuccesses = new Map<number, string[]>();
const MAX_RECENT_ACTIONS = 5;

/**
 * Get notable object states in a room (things that might need action)
 * Shows: locked, wet, dull, rusty, empty, etc.
 * Also shows what's BLOCKING certain actions (prerequisites)
 */
export function getNotableObjectStates(world: World, roomEid: number): string[] {
  const notable: string[] = [];
  const contents = listDirectContents(world, roomEid);

  for (const eid of contents) {
    if (!entityExists(world, eid)) continue;
    if (hasComponent(world, eid, Agent)) continue;

    const objName = Name.value[eid];
    if (!objName) continue;

    // Check object state from ECS ObjectState component (not ObjectMeta)
    const state = ObjectState?.current?.[eid];

    // Check traits for blocked actions - from ECS Traits.active
    const traitsJson = Traits?.active?.[eid];
    let traits: string[] = [];
    if (traitsJson) {
      try {
        traits = JSON.parse(traitsJson) as string[];
      } catch { }
    }

    // Build a status string showing state and any blockers
    const statuses: string[] = [];

    // DYNAMIC: Check if current state has blockedTraits in WorldSchema
    // A state is "notable" if it's blocking some capability
    const typeId = ObjectType?.typeId?.[eid];
    if (state && typeId) {
      const typeDef = worldSchema.getObjectType(typeId);
      if (typeDef) {
        const stateDef = typeDef.states[state];
        // If this state has blockedTraits, it's notable (something is blocked)
        if (stateDef?.blockedTraits && stateDef.blockedTraits.length > 0) {
          statuses.push(state.toUpperCase());
        }
      }
    }

    // Check for blocked capabilities based on current traits
    // If object should be takeable but currently isn't, note it
    if (!traits.includes("takeable") && traits.includes("unreachable")) {
      statuses.push("can't take yet");
    }
    // If object is locked, note it needs unlocking
    if (traits.includes("locked")) {
      statuses.push("needs unlocking");
    }

    if (statuses.length > 0) {
      notable.push(`${objName}: ${statuses.join(", ")}`);
    }
  }

  return notable;
}

export function recordSuccessfulAction(agentEid: number, action: string): void {
  if (!recentSuccesses.has(agentEid)) {
    recentSuccesses.set(agentEid, []);
  }
  const actions = recentSuccesses.get(agentEid)!;
  actions.push(action);
  if (actions.length > MAX_RECENT_ACTIONS) {
    actions.shift();
  }
}

export function getRecentSuccesses(agentEid: number): string[] {
  return recentSuccesses.get(agentEid) || [];
}

// ============================================================================
// STIMULUS FORMATTING FOR AGENT PROMPT
// ============================================================================

/**
 * Format stimuli into a prompt-friendly text for the agent
 * Action results/failures are shown FIRST and prominently to prevent hallucination
 * Optional agentEid enables showing current capabilities
 */
export function formatStimuliForPrompt(stimuli: Stimulus[], agentEid?: number, world?: World): string {
  if (stimuli.length === 0 && !agentEid) return "You perceive nothing unusual.";

  // Group by modality
  const byModality = new Map<SensoryModality, Stimulus[]>();
  for (const stim of stimuli) {
    if (!byModality.has(stim.modality)) {
      byModality.set(stim.modality, []);
    }
    byModality.get(stim.modality)!.push(stim);
  }

  const sections: string[] = [];

  // ⚠️ ACTION FEEDBACK FIRST - This is critical for preventing hallucination
  // Pull out action_result and action_failed from cognitive stimuli and show them prominently
  const cognitive = byModality.get("cognitive") || [];
  const actionFeedback = cognitive.filter(s => s.type === "action_result" || s.type === "action_failed");
  const otherCognitive = cognitive.filter(s => s.type !== "action_result" && s.type !== "action_failed");

  if (actionFeedback.length > 0) {
    // Check if there are failures - if so, make them VERY prominent
    const failures = actionFeedback.filter(s => s.type === "action_failed");
    const successes = actionFeedback.filter(s => s.type === "action_result");

    if (failures.length > 0) {
      sections.push("🚨🚨🚨 CRITICAL - YOUR LAST ACTION FAILED 🚨🚨🚨");
      sections.push("════════════════════════════════════════════");
      for (const stim of failures) {
        sections.push(`❌ ${stim.content}`);
      }
      sections.push("════════════════════════════════════════════");
      sections.push("⛔ DO NOT proceed as if this action succeeded!");
      sections.push("⛔ You must try a DIFFERENT approach.");
      sections.push("");
    }

    if (successes.length > 0) {
      sections.push("✅ YOUR LAST ACTION SUCCEEDED:");
      for (const stim of successes) {
        sections.push(`  ${stim.content}`);
      }
      sections.push("");
    }
  }

  // 🎒 SELF-AWARENESS - Show agent their ACTUAL state (prevents hallucination)
  // This section is CRITICAL - it shows undeniable facts about what the agent has
  if (agentEid !== undefined) {
    const inventoryItems = world ? getInventoryItemNames(world, agentEid) : [];
    const capabilities = world ? getAgentToolCapabilities(world, agentEid) : [];
    const recentActions = getRecentSuccesses(agentEid);

    // Always show inventory section - even if empty
    sections.push("🎒 YOUR INVENTORY (THIS IS WHAT YOU ACTUALLY HAVE):");
    if (inventoryItems.length > 0) {
      sections.push(`  You are holding: ${inventoryItems.join(", ")}`);
    } else {
      sections.push(`  You are NOT holding anything. Your hands are empty.`);
    }

    // Show derived capabilities from items
    if (capabilities.length > 0) {
      sections.push(`  Your capabilities (from tools): ${capabilities.join(", ")}`);
    }

    // Show recent actions
    if (recentActions.length > 0) {
      sections.push(`  Recent actions: ${recentActions.join(" → ")}`);
    }
    sections.push(""); // Empty line for separation
  }

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

  // ⚠️ OBJECT STATES - Show what needs attention (locked, unreachable, etc.)
  const awarenessStimuli = otherCognitive.filter(s => s.type === "awareness");
  const remainingCognitive = otherCognitive.filter(s => s.type !== "awareness");

  if (awarenessStimuli.length > 0) {
    sections.push("⚠️ IMPORTANT - OBJECTS NEEDING ACTION:");
    for (const stim of awarenessStimuli) {
      // Parse out the objects and show them individually for clarity
      const content = stim.content.replace("Objects needing attention: ", "");
      sections.push(`  ${content}`);
    }
    sections.push("  (You must resolve these states before certain actions work)");
    sections.push("");
  }

  // Other Cognitive (affordances, intuition, etc)
  if (remainingCognitive.length > 0) {
    sections.push("🧠 INTUITION:");
    for (const stim of remainingCognitive) {
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
