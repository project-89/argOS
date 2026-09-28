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
import { hasComponent, entityExists } from "bitecs";
import { Name, Description, Agent, Room, StimulusSource, Traits, ObjectState, ObjectType, Container, Surface } from "../ecs/components";
import { getDirectContainer, getRoomForEntity, listDirectContents } from "../ecs/location";
import { isEntityPresent } from "../ecs/entity-presence";
import { getAvailableAffordances } from "../world/affordance-availability";
import { getEffectiveActorTraits } from "../world/effect-executor";
import { worldSchema } from "../world/schema";
import { filterPerceivableStimuli, getAgentSensoryCapabilities, normalizeSensoryEvent, type SensoryCapabilities, type SensoryEvent, type SensoryModality } from "./sensory-capabilities";
import { getAgentVisualEntities, getObservedHeldItemExteriors, getObservedPublicActivity } from "./world-capabilities";
export type { SensoryModality, SensoryCapabilities } from "./sensory-capabilities";

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

function currentObjectState(world: World, eid: number): string {
  return hasComponent(world, eid, ObjectState) ? ObjectState.current[eid] || "" : "";
}
function description(world: World, eid: number): string {
  return hasComponent(world, eid, Description) ? Description.value[eid] || "" : "";
}
function activeTraits(world: World, eid: number): string[] {
  return hasComponent(world, eid, Traits) ? parseTraitsJson(Traits.active[eid]) : [];
}
function visualPlacement(world: World, eid: number, roomEid: number, visible: Set<number>): string {
  const parent = getDirectContainer(world, eid);
  if (parent === undefined || parent === roomEid || !visible.has(parent)) return "";
  const relation = hasComponent(world, parent, Surface) && !hasComponent(world, parent, Container) ? "on" : "inside";
  return ` (${relation} ${Name.value[parent] || "visible surface"})`;
}

// ============================================================================
// SENSORY MODALITIES
// ============================================================================

export interface Stimulus {
  modality: SensoryModality;
  type: string;           // Specific type within modality (e.g., "speech", "footsteps", "smoke")
  content: string;        // The actual perception text
  source: string;         // What/who produced this stimulus
  intensity: number;      // 0-1, affects salience and range
  timestamp: number;
}

// ============================================================================
// STIMULUS GENERATION
// ============================================================================

/**
 * Generate all stimuli an agent would perceive this tick.
 *
 * Environmental stimuli (room, people, objects, sounds, smells)
 * are CACHED and only regenerated when the room state fingerprint changes or
 * the cache TTL expires (10s), avoiding redundant formatting work.
 *
 * Affordances are recomputed because capabilities can change without a visible
 * room change (held tools, new systems, or a world capability port).
 * Event-based stimuli (speech, actions, arrivals) always pass through fresh.
 */
export function generateStimuliForAgent(
  world: World,
  agentEid: number,
  pendingEvents: readonly SensoryEvent[]
): Stimulus[] {
  // Validate agent exists
  if (!isEntityPresent(world, agentEid)) return [];

  const capabilities = getAgentSensoryCapabilities(world, agentEid);
  const roomEid = getRoomForEntity(world, agentEid);
  const hasRoom = roomEid !== undefined && isEntityPresent(world, roomEid);
  // A detached actor can still receive mental input and its own execution feedback.
  const stimuli = hasRoom ? [...getCachedEnvironmentalStimuli(world, agentEid, roomEid, capabilities)] : [];
  // Local object affordances and state are derived from sight, not an omniscient
  // fallback channel. Explicit cognitive input remains available without sight.
  if (hasRoom && capabilities.cognitive > 0 && capabilities.visual > 0) {
    stimuli.push(...generateCognitiveStimuli(world, agentEid, roomEid, capabilities.cognitive));
    const notableStates = getNotableObjectStates(world, agentEid);
    if (notableStates.length > 0) {
      stimuli.push({
        modality: "cognitive", type: "awareness",
        content: `Objects needing attention: ${notableStates.join(", ")}`,
        source: "intuition", intensity: 0.7, timestamp: Date.now(),
      });
    }
  }

  // Event-based stimuli — always fresh, never cached
  for (const event of filterPerceivableStimuli(world, agentEid, pendingEvents)) {
    const capabilityLevel = capabilities[event.modality];
    stimuli.push({
      modality: event.modality,
      type: event.type,
      content: event.content,
      source: event.source,
      intensity: event.intensity * capabilityLevel,
      timestamp: Number.isFinite(event.timestamp) ? event.timestamp! : Date.now(),
    });
  }

  return stimuli;
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
  const roomDesc = description(world, roomEid);
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
  const visible = getAgentVisualEntities(world, agentEid);
  const visibleSet = new Set(visible);
  const peopleLines: string[] = [];
  const heldExteriors = getObservedHeldItemExteriors(world, agentEid);

  for (const otherEid of visible) {
    if (hasComponent(world, otherEid, Agent)) {
      const otherName = Name.value[otherEid] || "someone";
      const otherDesc = description(world, otherEid);
      // Generic Agent ObjectState may be mental prose or stale 'idle'. Only
      // explicitly public physical activity describes what a person is doing.
      const currentState = getObservedPublicActivity(world, agentEid, otherEid);
      const state = currentState && currentState !== "normal" ? ` (${currentState})` : "";
      const held = heldExteriors.filter(item => item.holderEid === otherEid).map(item => item.name);
      if (held.length) peopleLines.push(`${otherName} is holding ${held.join(" and ")}.`);

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

  // The shared resolver admits native open-container contents and rejects
  // concealed leaves/ancestors, closed interiors and foreign inventories.
  const objectLines: string[] = [];

  for (const contentEid of visible) {
    if (hasComponent(world, contentEid, Agent)) continue;

    const objName = Name.value[contentEid];
    if (objName) {
      // Description.value is updated from WorldSchema by ObjectManager.transitionState()
      const objDesc = description(world, contentEid);
      // Read state from ECS ObjectState component (not ObjectMeta)
      const currentState = currentObjectState(world, contentEid);
      const state = currentState && currentState !== "normal" ? ` [${currentState}]` : "";
      const placement = visualPlacement(world, contentEid, roomEid, visibleSet);

      if (objDesc) {
        // Show full description - it contains important state info from WorldSchema
        objectLines.push(`- ${objName}${state}${placement}: ${objDesc}`);
      } else {
        objectLines.push(`- ${objName}${state}${placement}`);
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
  if (!isEntityPresent(world, roomEid)) return stimuli;

  // Find stimulus sources in room that emit sounds
  const contents = listDirectContents(world, roomEid);

  for (const contentEid of contents) {
    if (!isEntityPresent(world, contentEid)) continue;
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
  if (!isEntityPresent(world, roomEid)) return stimuli;

  // Find things that smell
  const contents = listDirectContents(world, roomEid);

  for (const contentEid of contents) {
    if (!isEntityPresent(world, contentEid)) continue;

    // Read traits from ECS Traits.active component (not ObjectMeta)
    const traits = activeTraits(world, contentEid);

    const sourceName = Name.value[contentEid] || "something";
    // Read state from ECS ObjectState component
    const currentState = currentObjectState(world, contentEid);

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
  if (!isEntityPresent(world, agentEid) || !isEntityPresent(world, roomEid)) return stimuli;

  // Affordance awareness - what actions are possible
  const contents = getAgentVisualEntities(world, agentEid);
  const affordanceAwareness: string[] = [];

  // This default intuition is sight-derived, not a second way to discover
  // concealed targets. Explicit mental events retain their own admission path.
  for (const contentEid of contents) {
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
  for (const contentEid of contents) {
    // Read traits from ECS Traits.active component (not ObjectMeta)
    const traits = activeTraits(world, contentEid);

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
    .filter(eid=>isEntityPresent(arg1,eid))
    .map(eid => Name?.value?.[eid])
    .filter((n): n is string => typeof n === "string" && n.length > 0);
}

// ==========================================================================
// STIMULUS DEDUPLICATION CACHE
// ==========================================================================

interface CachedStimuli {
  roomEid: number;
  fingerprint: string;
  stimuli: Stimulus[];
  timestamp: number;
}

let stimulusCaches = new WeakMap<World, Map<number, CachedStimuli>>();
const CACHE_TTL_MS = 10_000; // Force refresh every 10s even if unchanged

/**
 * Compute a lightweight fingerprint of a room's state.
 * If the fingerprint hasn't changed, we can reuse cached stimuli.
 */
function computeRoomFingerprint(world: World, agentEid: number, roomEid: number, capabilities: SensoryCapabilities): string {
  const parts: unknown[] = [capabilities];
  if (capabilities.visual > 0) {
    parts.push([Name.value[roomEid] || "", description(world, roomEid), Room.ambience[roomEid] || ""]);
    const visible = getAgentVisualEntities(world, agentEid);
    const visibleSet = new Set(visible);
    parts.push(getObservedHeldItemExteriors(world, agentEid));
    parts.push(visible.map(eid => {
      if (hasComponent(world, eid, Agent)) {
        return [eid, Name.value[eid], description(world, eid).slice(0, 80), getObservedPublicActivity(world, agentEid, eid)];
      }
      return [eid, Name.value[eid], currentObjectState(world, eid), description(world, eid),
        visualPlacement(world, eid, roomEid, visibleSet)];
    }).sort((a, b) => Number(a[0]) - Number(b[0])));
  }
  // These small source projections deliberately share their actual emission
  // rules with the output. Hidden is not silent; irrelevant raw traits, sealed
  // contents and disabled modalities must not affect cache invalidation.
  const emission = (stimuli: Stimulus[]) => stimuli.map(s => [s.type, s.source, s.content, s.intensity]);
  if (capabilities.auditory > 0) parts.push(emission(generateAmbientAuditoryStimuli(world, roomEid, capabilities.auditory)));
  if (capabilities.olfactory > 0) parts.push(emission(generateOlfactoryStimuli(world, roomEid, capabilities.olfactory)));
  return JSON.stringify(parts);
}

/**
 * Get environmental stimuli for an agent, using cache when possible.
 * Event-based stimuli (pendingEvents) are NEVER cached.
 */
function getCachedEnvironmentalStimuli(
  world: World,
  agentEid: number,
  roomEid: number,
  capabilities: SensoryCapabilities,
): Stimulus[] {
  const now = Date.now();
  let stimulusCache = stimulusCaches.get(world);
  if (!stimulusCache) {
    stimulusCache = new Map();
    stimulusCaches.set(world, stimulusCache);
  }
  const fingerprint = computeRoomFingerprint(world, agentEid, roomEid, capabilities);
  const cached = stimulusCache.get(agentEid);

  if (
    cached &&
    cached.roomEid === roomEid &&
    cached.fingerprint === fingerprint &&
    (now - cached.timestamp) < CACHE_TTL_MS
  ) {
    return cached.stimuli.map(stimulus => ({ ...stimulus, timestamp: now }));
  }

  // Regenerate
  const stimuli: Stimulus[] = [];
  if (capabilities.visual > 0) {
    stimuli.push(...generateVisualStimuli(world, agentEid, roomEid, capabilities.visual));
  }
  if (capabilities.auditory > 0) {
    stimuli.push(...generateAmbientAuditoryStimuli(world, roomEid, capabilities.auditory));
  }
  if (capabilities.olfactory > 0) {
    stimuli.push(...generateOlfactoryStimuli(world, roomEid, capabilities.olfactory));
  }

  stimulusCache.set(agentEid, { roomEid, fingerprint, stimuli, timestamp: now });
  return stimuli.map(stimulus => ({ ...stimulus }));
}

/** Evict cache for a removed agent */
export function evictStimulusCache(agentEid: number): void;
export function evictStimulusCache(world: World, agentEid: number): void;
export function evictStimulusCache(worldOrEid: World | number, agentEid?: number): void {
  if (typeof worldOrEid === "number") {
    // Legacy callers do not supply a world. Invalidate rather than guess which
    // world's similarly numbered actor owns the cache entry.
    stimulusCaches = new WeakMap();
  } else if (agentEid !== undefined) {
    stimulusCaches.get(worldOrEid)?.delete(agentEid);
  }
}

// Track recent successful actions per agent for better memory
const recentSuccesses = new Map<number, string[]>();
const worldRecentSuccesses = new WeakMap<World, Map<number, string[]>>();
const MAX_RECENT_ACTIONS = 5;

/**
 * Get notable object states visible to this actor (things that might need action).
 * Shows: locked, wet, dull, rusty, empty, etc.
 * Also shows what's BLOCKING certain actions (prerequisites)
 */
export function getNotableObjectStates(world: World, agentEid: number): string[] {
  const notable: string[] = [];
  const contents = getAgentVisualEntities(world, agentEid);

  for (const eid of contents) {
    if (!entityExists(world, eid)) continue;
    if (hasComponent(world, eid, Agent)) continue;

    const objName = Name.value[eid];
    if (!objName) continue;

    // Check object state from ECS ObjectState component (not ObjectMeta)
    const state = currentObjectState(world, eid);

    // Check traits for blocked actions - from ECS Traits.active
    const traits = activeTraits(world, eid);

    // Build a status string showing state and any blockers
    const statuses: string[] = [];

    // DYNAMIC: Check if current state has blockedTraits in WorldSchema
    // A state is "notable" if it's blocking some capability
    const typeId = hasComponent(world, eid, ObjectType) ? ObjectType.typeId[eid] : undefined;
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

export function recordSuccessfulAction(agentEid: number, action: string): void;
export function recordSuccessfulAction(world: World, agentEid: number, action: string): void;
export function recordSuccessfulAction(worldOrEid: World | number, eidOrAction: number | string, actionArg?: string): void {
  const agentEid = typeof worldOrEid === "number" ? worldOrEid : eidOrAction as number;
  const action = typeof worldOrEid === "number" ? eidOrAction as string : actionArg!;
  let histories = recentSuccesses;
  if (typeof worldOrEid !== "number") {
    histories = worldRecentSuccesses.get(worldOrEid) ?? new Map();
    worldRecentSuccesses.set(worldOrEid, histories);
  }
  if (!histories.has(agentEid)) {
    histories.set(agentEid, []);
  }
  const actions = histories.get(agentEid)!;
  actions.push(action);
  if (actions.length > MAX_RECENT_ACTIONS) {
    actions.shift();
  }
}

export function getRecentSuccesses(agentEid: number): string[];
export function getRecentSuccesses(world: World, agentEid: number): string[];
export function getRecentSuccesses(worldOrEid: World | number, agentEid?: number): string[] {
  const actions = typeof worldOrEid === "number"
    ? recentSuccesses.get(worldOrEid)
    : worldRecentSuccesses.get(worldOrEid)?.get(agentEid!);
  return [...(actions ?? [])];
}

// ============================================================================
// STIMULUS FORMATTING FOR AGENT PROMPT
// ============================================================================

/**
 * Format stimuli into a prompt-friendly text for the agent
 * Action feedback comes before observations; inventory is separate from hand occupancy.
 * Optional agentEid enables showing current capabilities
 */
export function formatStimuliForPrompt(stimuli: Stimulus[], agentEid?: number, world?: World): string {
  if (stimuli.length === 0 && agentEid === undefined) return "No current perceptions.";

  // Group by modality
  const byModality = new Map<SensoryModality, Stimulus[]>();
  for (const stim of stimuli) {
    if (!byModality.has(stim.modality)) {
      byModality.set(stim.modality, []);
    }
    const ageSeconds = Math.max(0, Math.floor((Date.now() - stim.timestamp) / 1000));
    // A delayed event stays past evidence inside an otherwise current room view.
    byModality.get(stim.modality)!.push(ageSeconds > 0
      ? { ...stim, content: `${stim.content} [${stim.source}, ${ageSeconds}s ago]` }
      : stim);
  }

  const sections: string[] = [];

  // Keep feedback before sensory context. The failure heading is also a legacy reader marker.
  const cognitive = byModality.get("cognitive") || [];
  const actionFeedback = cognitive.filter(s => s.type === "action_result" || s.type === "action_failed");
  const otherCognitive = cognitive.filter(s => s.type !== "action_result" && s.type !== "action_failed");

  if (actionFeedback.length > 0) {
    const failures = actionFeedback.filter(s => s.type === "action_failed");
    const successes = actionFeedback.filter(s => s.type === "action_result");

    if (failures.length > 0) {
      sections.push("🚨 CRITICAL - YOUR LAST ACTION FAILED");
      for (const stim of failures) {
        sections.push(`  ${stim.content}`);
      }
      sections.push("");
    }

    if (successes.length > 0) {
      sections.push("YOUR LAST ACTION SUCCEEDED:");
      for (const stim of successes) {
        sections.push(`  ${stim.content}`);
      }
      sections.push("");
    }
  }

  // Inventory comes from the canonical world relationship when available.
  if (agentEid !== undefined) {
    const inventoryItems = world ? getInventoryItemNames(world, agentEid) : [];
    const capabilities = world ? getAgentToolCapabilities(world, agentEid) : [];
    const recentActions = world ? getRecentSuccesses(world, agentEid) : getRecentSuccesses(agentEid);

    // Always show inventory section - even if empty
    sections.push("YOUR INVENTORY:");
    if (!world) {
      sections.push("  Inventory unavailable in this snapshot.");
    } else if (inventoryItems.length > 0) {
      sections.push(`  Possessions: ${inventoryItems.join(", ")}`);
    } else {
      sections.push("  Inventory is empty.");
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
    sections.push("SIGHT:");
    for (const stim of visual) {
      sections.push(`  ${stim.content}`);
    }
  }

  // Auditory
  const auditory = byModality.get("auditory");
  if (auditory && auditory.length > 0) {
    sections.push("SOUND:");
    for (const stim of auditory) {
      sections.push(`  ${stim.content}`);
    }
  } else {
    // Absence in this sample is not a claim about earlier samples, unheard
    // rooms, or absolute silence. Object descriptions are not sound events.
    sections.push("SOUND:", "  No auditory events supplied in this sensory sample.");
  }

  // Olfactory
  const olfactory = byModality.get("olfactory");
  if (olfactory && olfactory.length > 0) {
    sections.push("SMELL:");
    for (const stim of olfactory) {
      sections.push(`  ${stim.content}`);
    }
  }

  // Tactile
  const tactile = byModality.get("tactile");
  if (tactile && tactile.length > 0) {
    sections.push("TOUCH:");
    for (const stim of tactile) {
      sections.push(`  ${stim.content}`);
    }
  }

  // Observed object states, such as locked or unreachable.
  const awarenessStimuli = otherCognitive.filter(s => s.type === "awareness");
  const remainingCognitive = otherCognitive.filter(s => s.type !== "awareness");

  if (awarenessStimuli.length > 0) {
    sections.push("OBJECT STATES:");
    for (const stim of awarenessStimuli) {
      // Parse out the objects and show them individually for clarity
      const content = stim.content.replace("Objects needing attention: ", "");
      sections.push(`  ${content}`);
    }
    sections.push("");
  }

  // Other Cognitive (affordances, intuition, etc)
  if (remainingCognitive.length > 0) {
    sections.push("OTHER PERCEPTIONS:");
    for (const stim of remainingCognitive) {
      sections.push(`  ${stim.content}`);
    }
  }

  return sections.join("\n");
}

/**
 * Convert a simple event into a stimulus with appropriate modality
 */
export function eventToStimulus<T extends SensoryEvent>(event: T): T & { modality: SensoryModality; intensity: number } {
  return normalizeSensoryEvent(event);
}

/** Stable observable signature for idle scheduling; clocks and private minds are absent. */
export function getAgentSensoryFingerprint(world: World, eid: number): string {
  return JSON.stringify({
    room: getRoomForEntity(world, eid) ?? null,
    senses: getAgentSensoryCapabilities(world, eid),
    inventory: getInventoryItemNames(world, eid),
    tools: getAgentToolCapabilities(world, eid),
    observations: generateStimuliForAgent(world, eid, []).map(s => [s.modality, s.type, s.source, s.content, s.intensity]),
  });
}
