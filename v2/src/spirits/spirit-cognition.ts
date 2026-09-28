/**
 * Spirit Cognition
 *
 * The cognitive loop for spirits - observe, analyze, report, intervene.
 * Spirits use LLMs to reason about what they observe in the ECS.
 */

import { generateText } from "ai";
import { getWorldAuthoringContext } from "../world/world-specification";
import { reviewNarrativeOpportunity } from "./narrative-opportunities";
import { google } from "@ai-sdk/google";
import { query, getRelationTargets, hasComponent } from "bitecs";
import type { World } from "../ecs/world";
import { Name, Description, Agent, Mind, Room, Goal, Impression, StimulusSource, PhysicalObject, Thought, ObjectState } from "../ecs/components";
import { HasGoal, HasImpression } from "../ecs/relations";
import { getRoomForEntity, getDirectContainer } from "../ecs/location";
import { getDynamicComponentValues } from "../ecs/dynamic-components";
import type { EntityRegistry } from "../ecs/tools";
import type {
  SpiritState,
  SpiritCognitionInput,
  SpiritCognitionOutput,
  EcsSnapshot,
  AgentSnapshot,
  RoomSnapshot,
  ActionSnapshot,
  Observation,
  ObservationType,
  DivineMessage,
  Intervention,
  NarrativeState,
} from "./types";
import type { SpiritRegistry } from "./spirit-registry";
import { sendMessage, pruneSpiritInbox, markSpiritObservationCompleted } from "./spirit-registry";
import { broadcastToRoom, getActiveGoals } from "../cognition/cognition-system";
import { getAgentThoughts } from "../cognition/agent-mind";
import { assertSimulationTaskActive } from "../runtime/task-scope";
import { recordIssue } from "./consistency-spirit";
import { captureSpiritInterventionScope, type SpiritInterventionScope } from "./spirit-intervention-scope";
import { captureSpiritInterventionEvidence, type SpiritInterventionEvidence } from "./spirit-intervention-evidence";
import { captureSpiritCycleScope } from "./spirit-cycle-scope";
import { nudgeNpc } from "../nle/npc-nudge";
import { captureSpiritPhysicalEffects } from "./physical-effect-capabilities";
import { captureSpiritPublicEventReview, type SpiritPublicEventInput } from "./spirit-public-event-review";

// =============================================================================
// MODEL CONFIGURATION - LOCKED MODELS from centralized config
// See src/llm/config.ts for model definitions - DO NOT CHANGE HERE
// =============================================================================

import { spiritModel, proModel } from "../llm/config";

const models = {
  flash: spiritModel,
  haiku: spiritModel,  // Using flash as haiku equivalent
  pro: proModel,
};

// =============================================================================
// ECS OBSERVATION
// =============================================================================

/**
 * Collect a snapshot of the ECS world
 */
export function collectEcsSnapshot(
  world: World,
  registry: EntityRegistry,
  recentActions: ActionSnapshot[] = []
): EcsSnapshot {
  const agents = collectAgentSnapshots(world, registry);
  const rooms = collectRoomSnapshots(world, registry);

  return {
    tick: Date.now(),
    agents,
    rooms,
    recentActions,
  };
}

function collectAgentSnapshots(world: World, registry: EntityRegistry): AgentSnapshot[] {
  const agentEids = Array.from(query(world, [Agent]));

  return agentEids.map(eid => {
    const name = Name.value[eid] || "Unknown";
    const roomEid = getRoomForEntity(world, eid);
    const location = roomEid !== undefined ? (Name.value[roomEid] || "Unknown") : "Nowhere";

    const arousal = Mind.arousal[eid] ?? 0.5;
    const focus = Mind.focus[eid] || "";
    const mode = Mind.mode[eid] || "reactive";
    const active = Agent.active[eid] ?? true;

    // Derive mood
    const mood = arousal > 0.7 ? "agitated" :
                 arousal > 0.5 ? "alert" :
                 arousal > 0.3 ? "calm" : "drowsy";

    return {
      eid,
      name,
      location,
      mood,
      arousal,
      focus,
      mode: mode as string,
      active,
      recentThoughts: getAgentThoughts(world, eid).slice(-3).map(id => Thought.content[id] || "").filter(Boolean),
      goals: getActiveGoals(world, eid),
    };
  });
}

function collectRoomSnapshots(world: World, registry: EntityRegistry): RoomSnapshot[] {
  const roomEids = Array.from(query(world, [Room]));
  // A quiet prop is still real. Phones, desks and carried objects need not
  // have StimulusSource, and must not look "missing" to world maintenance.
  const allObjects = [...new Set([...query(world, [StimulusSource]), ...query(world, [PhysicalObject])])];

  return roomEids.map(eid => {
    const name = Name.value[eid] || "Unknown";
    const description = Description.value[eid] || "";
    const ambience = Room.ambience[eid] || "neutral";

    // Find occupants (agents in this room)
    const allAgents = Array.from(query(world, [Agent]));
    const occupants = allAgents
      .filter(aid => {
        return getRoomForEntity(world, aid) === eid;
      })
      .map(aid => Name.value[aid] || "Unknown");

    // Include nested/held physical objects, without exposing private message bodies.
    const objects: string[] = [];
    const objectPlacements: NonNullable<RoomSnapshot["objectPlacements"]> = [];

    for (const objEid of allObjects) {
      // Skip agents (they're in occupants)
      if (hasComponent(world, objEid, Agent)) continue;

      if (getRoomForEntity(world, objEid) === eid) {
        const objName = Name.value[objEid];
        if (objName) {
          objects.push(objName);
          const container = getDirectContainer(world, objEid);
          const state = hasComponent(world, objEid, ObjectState) ? ObjectState.current[objEid] : undefined;
          const description = hasComponent(world, objEid, Description) ? Description.value[objEid] : undefined;
          objectPlacements.push({ eid: objEid, name: objName,
            container: container === undefined ? null : Name.value[container] || `entity:${container}`,
            held: container !== undefined && hasComponent(world, container, Agent),
            ...(typeof state === "string" ? { state: state.slice(0, 128) } : {}),
            ...(typeof description === "string" ? { description: description.slice(0, 1000) } : {}),
          });
        }
      }
    }

    return {
      eid,
      name,
      description,
      occupants,
      objects,
      objectPlacements,
      ambience,
    };
  });
}

// =============================================================================
// SPIRIT COGNITION CYCLE
// =============================================================================

/**
 * Run a single cognition cycle for a spirit
 * @param globalContext - Optional global context from GodAgent (mood, directives, pacing)
 */
export async function runSpiritCognition(
  spirit: SpiritState,
  world: World,
  registry: EntityRegistry,
  spiritRegistry: SpiritRegistry,
  recentActions: ActionSnapshot[] = [],
  globalContext?: string
): Promise<SpiritCognitionOutput> {
  const startTime = Date.now();

  // 1. Collect ECS snapshot
  const cycleScope = captureSpiritCycleScope(world, spirit, spiritRegistry);
  if (!cycleScope.isCurrent()) return discardedCycleOutput();
  const ecsSnapshot = collectEcsSnapshot(world, registry, recentActions);
  const interventionScope = captureSpiritInterventionScope(world, spirit, spiritRegistry, cycleScope.sourceCurrent);
  const physicalEffects = captureSpiritPhysicalEffects(world, spirit, spiritRegistry);
  const publicReview = captureSpiritPublicEventReview(world, spirit, spiritRegistry, cycleScope.isCurrent);

  // 2. Prepare input
  // Keep receipt identity separate from the immutable text offered to this
  // cycle. New reports can arrive while inference or output delivery awaits.
  pruneSpiritInbox(spiritRegistry, spirit);
  const observedMessages = new Map(spirit.inbox.map(message => [message, { ...message }]));
  const interventionEvidence = captureSpiritInterventionEvidence(world, [...observedMessages.values()].map(message => ({
    sender: message.senderLabel ?? `spirit:${message.from}`,
    subject: message.subject, content: message.content,
  })));
  const input: SpiritCognitionInput = {
    spirit,
    ecsSnapshot,
    recentEvents: spirit.observations.slice(-20),
    incomingMessages: [...observedMessages.values()],
    activeDirectives: spirit.pendingDirectives.filter(d => d.status === "pending" || d.status === "active"),
    interventionEvidence: { records: interventionEvidence.records, omittedRecords: interventionEvidence.omittedRecords },
    physicalEffectPolicy: { restricted: physicalEffects.restricted, description: physicalEffects.description },
  };

  // 3. Build prompt based on spirit type (including global context if available)
  const authoringContext = [getWorldAuthoringContext(world), globalContext].filter(Boolean).join("\n\n");
  const prompt = buildSpiritPrompt(spirit, input, authoringContext, publicReview.input);

  // 4. Run LLM
  const model = models[spirit.definition.model];
  let output: SpiritCognitionOutput;
  let acceptedResponse = false;

  try {
    const response = await generateText({
      model,
      system: `${spirit.definition.systemPrompt}\n\nPERSISTENCE AND AGENCY: Live ECS state is authoritative; narrative setup, descriptions and previous reports may be stale. Absence from a remembered starting room is not evidence of a missing entity. Check current location and possession across the whole world before reporting a missing prop. A moved, carried, consumed, depleted, locked or intentionally removed object may be a real player consequence or puzzle condition, not an engine fault. Do not recommend restoring or duplicating it to force a planned beat. Report uncertainty, adapt the narrative, and distinguish genuine missing mechanics from story obstacles. NPC choices and unread/private information must not be fabricated as world events.`,
      prompt,
      temperature: 0.7,
    });

    // 5. Parse response
    assertSimulationTaskActive();
    if (!cycleScope.isCurrent()) return discardedCycleOutput();
    output = parseSpiritResponse(spirit, response.text, input);
    acceptedResponse = true;
  } catch (error) {
    assertSimulationTaskActive();
    if (!cycleScope.isCurrent()) return discardedCycleOutput();
    console.error(`[Spirit] ${spirit.definition.name} cognition error:`, error);
    output = {
      thoughts: `Error during cognition: ${error}`,
      observations: [],
      reports: [],
      interventions: [],
      directiveResponses: [],
    };
  }

  // 6. Process outputs
  assertSimulationTaskActive();
  if (!cycleScope.isCurrent()) return discardedCycleOutput();
  processOutputs(spirit, output, world, spiritRegistry, interventionScope, interventionEvidence, cycleScope, physicalEffects);
  if (!cycleScope.isCurrent()) return discardedCycleOutput();

  // 7. Update spirit state
  if(acceptedResponse) reviewNarrativeOpportunity(world,spirit,[...observedMessages.keys()],output.reports);
  markSpiritObservationCompleted(spiritRegistry, spirit);
  if (acceptedResponse) {
    spirit.inbox = spirit.inbox.filter(message => {
      const observed = observedMessages.get(message);
      // A replacement receipt or amended prompt-visible text needs a fresh read.
      return !observed || observed.id !== message.id || observed.subject !== message.subject || observed.content !== message.content;
    });
  }

  // Add thoughts to memory
  if (output.thoughts) {
    spirit.shortTermMemory.push(output.thoughts);
    if (spirit.shortTermMemory.length > 20) {
      spirit.shortTermMemory = spirit.shortTermMemory.slice(-20);
    }
  }

  publicReview.finish({ accepted: acceptedResponse, interventions: output.interventions,
    phase: spirit.narrativeState?.currentPhase, tension: spirit.narrativeState?.tension });

  const duration = Date.now() - startTime;
  console.log(`[Spirit] ${spirit.definition.name} cycle complete (${duration}ms)`);

  return output;
}

function discardedCycleOutput(): SpiritCognitionOutput {
  return { discarded: "stale_cycle", thoughts: "", observations: [], reports: [], interventions: [], directiveResponses: [] };
}

// =============================================================================
// PROMPT BUILDING
// =============================================================================

function buildSpiritPrompt(spirit: SpiritState, input: SpiritCognitionInput, globalContext?: string,
  publicEvents?: SpiritPublicEventInput): string {
  const sections: string[] = [];
  const narrative = spirit.definition.domain === "narrative";
  const physicalPolicy = () => {
    sections.push("PHYSICAL EFFECT POLICY: Room inject_stimulus, mood modification and all unlisted effects are forbidden. inject_stimulus may only offer an optional, evidence-grounded consideration to an agent; it cannot create an event, fact, goal or action. Physical changes require the following host-issued capability, exact JSON and room/place evidence. Unchanged state is a valid outcome; do not claim a suggested effect happened before its native receipt.");
    sections.push(input.physicalEffectPolicy?.description ?? "No physical-effect capability is granted to this spirit; report suggestions only.");
    sections.push("");
  };

  // Header
  sections.push(`You are ${spirit.definition.name}, a ${spirit.definition.rank} spirit managing the ${spirit.definition.domain} domain.`);
  sections.push("");

  // GLOBAL CONTEXT (if provided by God)
  // This is the critical "pinned context" that spans all spirits
  if (globalContext) {
    sections.push(globalContext);
    sections.push("");
  }

  // Put the live capability menu before the evidence, not after a town-sized
  // inventory. This is still the same captured, native authority grant.
  if (narrative && input.physicalEffectPolicy?.restricted) physicalPolicy();

  if (narrative) {
    sections.push("=== PUBLIC SCENE ===");
    sections.push(`Captured at ${publicEvents?.observedAtSimMs ?? "unknown"} simulated milliseconds. The issued current evidence below supplies actor presence and object state, placement and exterior detail. Omitted evidence is unknown, not absence.`);
    sections.push("PLACE CONTEXT (setting descriptions, not new events):");
    for (const room of input.ecsSnapshot.rooms) sections.push(`  ${room.name}: ${(room.description || "").slice(0, 600)}`);
    sections.push("");
  } else {
    // Other supervisory domains retain their existing diagnostic view. The
    // public Narrator above must not turn that private cognition into a story.
    sections.push("=== CURRENT WORLD STATE ===");
    sections.push("");
    sections.push("AGENTS:");
    for (const agent of input.ecsSnapshot.agents) {
      sections.push(`  ${agent.name} [${agent.mood}] @ ${agent.location}${agent.active ? "" : " (inactive)"}`);
      if (agent.focus) sections.push(`    Focus: ${agent.focus}`);
      sections.push(`    Active goals: ${agent.goals?.map(g => `${g.description} (priority ${g.priority})`).join("; ") || "none"}`);
      if (agent.recentThoughts.length) sections.push(`    Recent thoughts: ${JSON.stringify(agent.recentThoughts)}`);
    }
    sections.push("");
    sections.push("LOCATIONS:");
    for (const room of input.ecsSnapshot.rooms) {
      const occupants = room.occupants.length > 0 ? room.occupants.join(", ") : "empty";
      sections.push(`  ${room.name}: [${occupants}]`);
      if (room.objectPlacements?.length) {
        sections.push("    Physical objects (current public state):");
        for (const object of room.objectPlacements) {
          sections.push(`      ${object.name}${object.state ? ` [${object.state}]` : ""} (${object.held ? "held by" : "in/on"} ${object.container})${object.description ? `: ${object.description}` : ""}`);
        }
      }
    }
    sections.push("");
  }

  // Native history is independent of the legacy shared action buffer and the
  // spirit's own interpretations. These receipts cannot authorize an effect.
  if (publicEvents) {
    sections.push("COMMITTED_PUBLIC_EVENTS_SINCE_REVIEW:");
    sections.push(JSON.stringify(publicEvents));
    sections.push("These are historical native receipts, not predictions or current-state guarantees. Pending actions have not completed. Spoken text contains only already-spoken slices; coalescing does not establish that an utterance is finished. Dropped or omitted receipts mean this history is incomplete, not that the world was quiet. Actor, room and target keys identify the historical participants, even if a name or entity slot changes. Use the separate issued current evidence for any intervention.");
    if (narrative) sections.push("Compare the progress window with the previous accepted review in simulated time. Repeated inspection is another attempt, not proof of another discovery; its contents are not available in the public action tape. Spoken claims establish what was said, not that their contents happened. Judge consequences from native outcomes and current evidence, while allowing useful work, rest and listening. These counts inform judgment; they are not a stagnation verdict or an intervention quota.");
    sections.push("");
  }

  // Current, field-scoped intervention authority remains separate.
  if (input.interventionEvidence) {
    sections.push("ISSUED_INTERVENTION_EVIDENCE:");
    sections.push(JSON.stringify(input.interventionEvidence));
    sections.push("For each intervention or nudge_character, cite 1–8 issued evidenceIds covering the facts it relies on. State, placement and description are separate observations; cite each relevant field. Missing or stale citations reject the suggestion. These observations are supervisor context, not proof the character knows them. Attributed reports establish only what was reported, not current physical facts or another character's knowledge. Use current physical observations for physical premises. If the needed evidence is absent, report uncertainty instead of intervening.");
    sections.push("");
  }

  if (input.recentEvents.length > 0) {
    sections.push("PRIOR SPIRIT INTERPRETATIONS (not native event receipts):");
    for (const event of input.recentEvents.slice(narrative ? -3 : -10)) {
      sections.push(`  - [${event.type}] ${event.content}`);
    }
    sections.push("");
  }

  // Domain-specific state
  if (spirit.definition.domain === "narrative" && spirit.narrativeState) {
    sections.push("=== NARRATIVE STATE (previous assessment, not evidence of progress) ===");
    sections.push(`Act: ${spirit.narrativeState.currentAct}`);
    sections.push(`Phase: ${spirit.narrativeState.currentPhase}`);
    sections.push(`Tension: ${(spirit.narrativeState.tension * 100).toFixed(0)}%`);

    if (spirit.narrativeState.plotThreads.length > 0) {
      sections.push("Plot Threads:");
      for (const thread of spirit.narrativeState.plotThreads) {
        sections.push(`  - ${thread.name} [${thread.status}]: ${thread.description}`);
      }
    }

    if (spirit.narrativeState.protagonists.length > 0) {
      sections.push(`Protagonists: ${spirit.narrativeState.protagonists.join(", ")}`);
    }
    if (spirit.narrativeState.antagonists.length > 0) {
      sections.push(`Antagonists: ${spirit.narrativeState.antagonists.join(", ")}`);
    }
    sections.push("");

    sections.push("Ground storyProse in the public receipts and issued current evidence above, using their exact names. Their participants' private minds are not public evidence. A prospective new person, place or mechanism requires a request to God and native construction before it exists.");
    sections.push("");

    // Add recent prose to prevent repetition
    if (spirit.narrativeState.recentProse && spirit.narrativeState.recentProse.length > 0) {
      sections.push("=== RECENT PROSE ===");
      for (const prose of spirit.narrativeState.recentProse.slice(-5)) {
        sections.push(`  - "${prose.slice(0, 100)}${prose.length > 100 ? '...' : ''}"`);
      }
      sections.push("");
      sections.push("Describe only changes supported by current events and state. Movement intent is not evidence of arrival.");
      sections.push("If nothing new is established, leave storyProse empty.");
      sections.push("");
    }
  }

  // Messages
  if (input.incomingMessages.length > 0) {
    sections.push("=== MESSAGES ===");
    for (const msg of input.incomingMessages) {
      sections.push(`From ${msg.senderLabel ?? `spirit:${msg.from}`} (${msg.type}): ${msg.subject}`);
      sections.push(`  ${msg.content}`);
    }
    sections.push("");
  }

  // Directives
  if (input.activeDirectives.length > 0) {
    sections.push("=== ACTIVE DIRECTIVES ===");
    for (const dir of input.activeDirectives) {
      sections.push(`- ${dir.description} [${dir.status}]`);
    }
    sections.push("");
  }

  // Instructions
  sections.push("=== YOUR TASK ===");
  sections.push("Observe the world and respond with your analysis in the following JSON format:");
  sections.push("");
  sections.push("```json");
  sections.push("{");
  sections.push('  "thoughts": "Your internal reasoning about what you observe",');
  sections.push('  "observations": [');
  sections.push('    {');
  sections.push('      "type": "action|dialogue|conflict|stagnation|emergence",');
  sections.push('      "content": "What you observed",');
  sections.push('      "entities": ["entity names involved"],');
  sections.push('      "significance": 0.0-1.0');
  sections.push('    }');
  sections.push('  ],');
  sections.push('  "reportToSuperior": {');
  sections.push('    "needed": true/false,');
  sections.push('    "subject": "Brief subject",');
  sections.push('    "content": "What to report",');
  sections.push('    "priority": "low|normal|high|urgent"');
  sections.push('  },');
  sections.push('  "intervention": {');
  sections.push('    "needed": true/false,');
  sections.push(input.physicalEffectPolicy?.restricted
    ? '    "type": "world_effect|inject_stimulus",' : '    "type": "inject_stimulus|modify_mood",');
  sections.push('    "target": "agent or room name",');
  sections.push('    "targetType": "agent|room",');
  sections.push('    "evidenceIds": ["issued observation ID"],');
  sections.push('    "content": "What to inject or change",');
  sections.push('    "reason": "Why this intervention"');
  sections.push('  },');

  if (spirit.definition.domain === "narrative") {
    sections.push('  "narrativeUpdate": {');
    sections.push('    "tension": 0.0-1.0,');
    sections.push('    "phase": "exposition|inciting|rising|crisis|climax|falling|resolution",');
    sections.push('    "newPlotThread": { "name": "", "description": "" },');
    sections.push('    "protagonists": ["names"],');
    sections.push('    "antagonists": ["names"]');
    sections.push('  },');
    sections.push('  "narrativeDirectives": [');
    sections.push('    {');
    sections.push('      "type": "nudge_character|resolve_thread|escalate|create_event|suggest_beat",');
    sections.push('      "target": "character name or thread name",');
    sections.push('      "action": "What should happen - be specific",');
    sections.push('      "evidenceIds": ["issued observation ID; required for nudge_character"],');
    sections.push('      "reason": "Why this advances the story"');
    sections.push('    }');
    sections.push('  ],');
    sections.push('  "storyProse": "Write 1-3 sentences of engaging narrative prose describing what just happened. Write it like a novel - vivid, immersive, showing not telling. Use present tense. If nothing interesting happened, leave empty string."');
  }

  sections.push("}");
  sections.push("```");
  if (!narrative && input.physicalEffectPolicy?.restricted) physicalPolicy();

  return sections.join("\n");
}

// =============================================================================
// NARRATIVE DEDUPLICATION
// =============================================================================

/**
 * Calculate similarity between new prose and recent prose entries.
 * Uses word overlap (Jaccard similarity) to detect repetition.
 * Returns max similarity score (0-1) against any recent prose.
 */
function calculateProseSimilarity(newProse: string, recentProse: string[]): number {
  if (recentProse.length === 0) return 0;

  // Tokenize and normalize
  const tokenize = (text: string): Set<string> => {
    return new Set(
      text.toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 3)  // Skip short words
    );
  };

  const newTokens = tokenize(newProse);
  if (newTokens.size === 0) return 0;

  let maxSimilarity = 0;

  for (const oldProse of recentProse) {
    const oldTokens = tokenize(oldProse);
    if (oldTokens.size === 0) continue;

    // Jaccard similarity: intersection / union
    const intersection = new Set([...newTokens].filter(x => oldTokens.has(x)));
    const union = new Set([...newTokens, ...oldTokens]);
    const similarity = intersection.size / union.size;

    maxSimilarity = Math.max(maxSimilarity, similarity);
  }

  return maxSimilarity;
}

// =============================================================================
// NARRATIVE GROUNDING VALIDATION
// =============================================================================

/**
 * Check if storyProse contains entities that don't exist in ECS
 * Returns cleaned prose and list of hallucinated terms
 */
function validateNarratorProse(
  prose: string,
  ecsSnapshot: EcsSnapshot
): { cleanedProse: string; hallucinations: string[] } {
  const hallucinations: string[] = [];
  let cleanedProse = prose;

  // Build set of valid names
  const validAgentNames = new Set(ecsSnapshot.agents.map(a => a.name.toLowerCase()));
  const validRoomNames = new Set(ecsSnapshot.rooms.map(r => r.name.toLowerCase()));
  const validObjectNames = new Set<string>();
  for (const room of ecsSnapshot.rooms) {
    if (room.objects) {
      for (const obj of room.objects) {
        validObjectNames.add(obj.toLowerCase());
      }
    }
  }

  // Common hallucinated creatures/items to check for
  const suspectTerms = [
    // Animals
    "wolf", "wolves", "bear", "bears", "deer", "bird", "birds", "snake", "fox", "rabbit",
    // Weapons
    "sword", "knife", "dagger", "spear", "bow", "arrow", "axe",
    // Instruments
    "lute", "flute", "harp", "drum", "guitar",
    // Items
    "torch", "lantern", "key", "book", "scroll", "potion", "gem",
    // Fictional entities
    "stranger", "figure", "shadow creature", "monster", "beast",
  ];

  for (const term of suspectTerms) {
    const regex = new RegExp(`\\b${term}s?\\b`, "gi");
    if (regex.test(prose)) {
      // Check if this term is a valid entity
      if (!validObjectNames.has(term.toLowerCase()) &&
          !validAgentNames.has(term.toLowerCase())) {
        hallucinations.push(term);
      }
    }
  }

  // Check for names that look like they could be hallucinated characters
  const namePattern = /\b[A-Z][a-z]+\b/g;
  const possibleNames = prose.match(namePattern) || [];
  for (const name of possibleNames) {
    const lower = name.toLowerCase();
    // Skip common words
    if (["the", "a", "an", "he", "she", "it", "they", "something", "someone"].includes(lower)) {
      continue;
    }
    if (!validAgentNames.has(lower) &&
        !validRoomNames.has(lower) &&
        !validObjectNames.has(lower)) {
      // Could be a hallucinated character name - check if it looks like one
      // Skip generic descriptive words
      const genericWords = [
        "morning", "evening", "afternoon", "night", "day", "sun", "moon",
        "wind", "breeze", "air", "sky", "ground", "earth", "water",
        "light", "dark", "shadow", "silence", "sound", "voice",
      ];
      if (!genericWords.includes(lower) && name.length > 2) {
        // This might be a hallucinated character - flag but don't remove
        // (could be a legitimate reference we missed)
      }
    }
  }

  return { cleanedProse, hallucinations };
}

// =============================================================================
// RESPONSE PARSING
// =============================================================================

function parseSpiritResponse(
  spirit: SpiritState,
  responseText: string,
  input: SpiritCognitionInput
): SpiritCognitionOutput {
  const output: SpiritCognitionOutput = {
    thoughts: "",
    observations: [],
    reports: [],
    interventions: [],
    directiveResponses: [],
  };

  try {
    // Extract JSON from response
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : responseText;
    const parsed = JSON.parse(jsonStr);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Spirit response must be a JSON object");

    // Extract thoughts
    output.thoughts = parsed.thoughts || "";

    // Extract observations
    if (parsed.observations && Array.isArray(parsed.observations)) {
      for (const obs of parsed.observations) {
        output.observations.push({
          id: `obs_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          timestamp: Date.now(),
          domain: spirit.definition.domain,
          type: obs.type as ObservationType || "action",
          content: obs.content || "",
          entities: obs.entities || [],
          location: obs.location,
          significance: obs.significance || 0.5,
        });
      }
    }

    // Extract report
    if (parsed.reportToSuperior?.needed) {
      const report: DivineMessage = {
        id: `msg_${Date.now()}`,
        timestamp: Date.now(),
        from: spirit.eid,
        to: spirit.superiorEid || -1,
        type: "report",
        domain: spirit.definition.domain,
        priority: parsed.reportToSuperior.priority || "normal",
        subject: parsed.reportToSuperior.subject || "Observation Report",
        content: parsed.reportToSuperior.content || "",
        requiresResponse: false,
      };
      output.reports.push(report);
    }

    // Extract intervention
    if (parsed.intervention?.needed && spirit.definition.canInjectEvents) {
      output.interventions.push({
        id: `int_${Date.now()}`,
        spiritEid: spirit.eid,
        timestamp: Date.now(),
        type: parsed.intervention.type || "inject_stimulus",
        target: {
          type: parsed.intervention.targetType || "room",
          name: parsed.intervention.target,
        },
        content: parsed.intervention.content || "",
        reason: parsed.intervention.reason || "",
        evidenceIds: parsed.intervention.evidenceIds,
      });
    }

    // Extract narrative update
    if (parsed.narrativeUpdate && spirit.narrativeState) {
      output.updatedNarrativeState = {};

      if (parsed.narrativeUpdate.tension !== undefined) {
        output.updatedNarrativeState.tension = parsed.narrativeUpdate.tension;
      }
      if (parsed.narrativeUpdate.phase) {
        output.updatedNarrativeState.currentPhase = parsed.narrativeUpdate.phase;
      }
      if (parsed.narrativeUpdate.protagonists) {
        output.updatedNarrativeState.protagonists = parsed.narrativeUpdate.protagonists;
      }
      if (parsed.narrativeUpdate.antagonists) {
        output.updatedNarrativeState.antagonists = parsed.narrativeUpdate.antagonists;
      }

      // New plot thread
      if (parsed.narrativeUpdate.newPlotThread?.name) {
        const newThread = {
          id: `plot_${Date.now()}`,
          name: parsed.narrativeUpdate.newPlotThread.name,
          description: parsed.narrativeUpdate.newPlotThread.description || "",
          participants: [],
          status: "setup" as const,
          tension: 0.3,
          events: [],
          startedAt: Date.now(),
        };

        if (!output.updatedNarrativeState.plotThreads) {
          output.updatedNarrativeState.plotThreads = [...(spirit.narrativeState?.plotThreads || [])];
        }
        output.updatedNarrativeState.plotThreads.push(newThread);
      }
    }

    // Process narrative directives - send to appropriate handlers via messaging
    if (parsed.narrativeDirectives && Array.isArray(parsed.narrativeDirectives)) {
      for (const directive of parsed.narrativeDirectives) {
        if (!directive.type || !directive.target) continue;

        console.log(`[Narrator] Directive: ${directive.type} -> ${directive.target}: ${directive.action}`);

        // Convert directive to appropriate message/intervention
        switch (directive.type) {
          case "nudge_character":
            // Create intervention to inject stimulus to character
            output.interventions.push({
              id: `dir_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
              spiritEid: spirit.eid,
              timestamp: Date.now(),
              type: "inject_stimulus",
              target: { type: "agent", name: directive.target },
              content: `[Narrative nudge] ${directive.action}`,
              reason: directive.reason || "Story progression",
              evidenceIds: directive.evidenceIds,
            });
            break;

          case "resolve_thread":
          case "escalate":
          case "create_event":
          case "suggest_beat":
            {
              const directiveType = String(directive.type || "").toLowerCase();
              const priority: DivineMessage["priority"] =
                directiveType === "escalate" || directiveType === "resolve_thread" || directiveType === "create_event"
                  ? "high"
                  : "normal";
              const subject = `[NARRATIVE_DIRECTIVE:${directiveType}] ${directive.target}`;

              // Report to GodAI with specific suggestion
              output.reports.push({
                id: `dir_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                timestamp: Date.now(),
                from: spirit.eid,
                to: spirit.superiorEid || -1,
                type: "report",
                domain: "narrative",
                priority,
                subject,
                content: `Target: ${directive.target}\nAction: ${directive.action}\nReason: ${directive.reason}`,
                requiresResponse: false,
                data: {
                  source: "narrative_directive",
                  directiveType,
                  target: directive.target,
                  action: directive.action,
                  reason: directive.reason,
                },
              });
            }
            break;
        }
      }
    }

    // Extract story prose from narrative spirits - with validation and deduplication
    if (parsed.storyProse && typeof parsed.storyProse === "string" && parsed.storyProse.trim()) {
      const rawProse = parsed.storyProse.trim();

      // Validate narrator prose against ECS state
      const { cleanedProse, hallucinations } = validateNarratorProse(rawProse, input.ecsSnapshot);

      if (hallucinations.length > 0) {
        console.warn(`[Spirit] Narrator hallucinations detected: ${hallucinations.join(", ")}`);

        // Import and use consistency reporting if available
        try {
          recordIssue({
            id: `hal_${Date.now()}`,
            timestamp: Date.now(),
            severity: "medium",
            category: "narrative_drift",
            description: `Narrator mentioned non-existent entities: ${hallucinations.join(", ")}`,
            evidence: [rawProse.substring(0, 150)],
            affectedEntities: hallucinations,
            recommendation: `Ground narration in verified entities and events; do not create entities merely to justify prose.`,
            autoFixable: false,
          });
        } catch {
          // Consistency spirit not available
        }
      }

      // Check for prose similarity/repetition
      const recentProse = spirit.narrativeState?.recentProse || [];
      const similarity = calculateProseSimilarity(cleanedProse, recentProse);

      if (similarity > 0.6) {
        console.warn(`[Spirit] Narrative repetition detected (${(similarity * 100).toFixed(0)}% similar). Skipping prose.`);
        // Don't output repetitive prose
      } else {
        output.storyProse = cleanedProse;

        // Track this prose for future deduplication
        if (!output.updatedNarrativeState) {
          output.updatedNarrativeState = {};
        }
        const updatedRecentProse = [...recentProse, cleanedProse].slice(-10);
        output.updatedNarrativeState.recentProse = updatedRecentProse;
      }
    }

  } catch (error) {
    // Never apply a partially parsed response or acknowledge its input. The
    // cognition caller handles this as a failed cycle with empty effects.
    throw new Error("Invalid spirit response", { cause: error });
  }

  return output;
}

// =============================================================================
// OUTPUT PROCESSING
// =============================================================================

function processOutputs(
  spirit: SpiritState,
  output: SpiritCognitionOutput,
  world: World,
  spiritRegistry: SpiritRegistry,
  interventionScope: SpiritInterventionScope,
  interventionEvidence: SpiritInterventionEvidence,
  cycleScope: ReturnType<typeof captureSpiritCycleScope>,
  physicalEffects: ReturnType<typeof captureSpiritPhysicalEffects>
): void {
  // Add observations to spirit's history
  for (const obs of output.observations) {
    spirit.observations.push(obs);
    // Keep only recent observations
    if (spirit.observations.length > 100) {
      spirit.observations = spirit.observations.slice(-100);
    }
  }

  // Send reports
  for (const report of output.reports) {
    if (!cycleScope.isCurrent()) return;
    if (cycleScope.destination !== undefined) {
      sendMessage(
        spiritRegistry,
        spirit.eid,
        cycleScope.destination,
        "report",
        report.subject,
        report.content,
        { priority: report.priority }
      );
    }
  }

  // Execute interventions
  for (const intervention of output.interventions) {
    if (!cycleScope.isCurrent()) return;
    executeIntervention(intervention, world, spirit, interventionScope, interventionEvidence, physicalEffects);
  }
  if (!cycleScope.isCurrent()) return;

  // Update narrative state
  if (output.updatedNarrativeState && spirit.narrativeState) {
    Object.assign(spirit.narrativeState, output.updatedNarrativeState);
  }

  // Update social state
  if (output.updatedSocialState && spirit.socialState) {
    Object.assign(spirit.socialState, output.updatedSocialState);
  }
}

function executeIntervention(
  intervention: Intervention,
  world: World,
  spirit: SpiritState,
  scope: SpiritInterventionScope,
  evidence: SpiritInterventionEvidence,
  physicalEffects: ReturnType<typeof captureSpiritPhysicalEffects>
): void {
  const advice = intervention.type === "inject_stimulus" && intervention.target.type === "agent";
  if (intervention.type !== "world_effect" && !advice && !physicalEffects.legacyAllowed()) {
    intervention.result = "rejected_physical_effect_policy"; return;
  }
  const binding = scope(intervention.target);
  if (!binding?.isCurrent()) { intervention.result = "stale_or_invalid_target"; return; }
  const evidenceCurrent = evidence.bind(intervention.evidenceIds);
  if (!evidenceCurrent?.()) { intervention.result = "stale_or_invalid_evidence"; return; }
  const isCurrent = () => binding.isCurrent() && evidenceCurrent();
  if (intervention.type === "world_effect") {
    const ids = Array.isArray(intervention.evidenceIds) ? intervention.evidenceIds : [];
    if (intervention.target.type !== "room" || !evidence.records.some(record => record.kind === "place"
      && record.subject === intervention.target.name && ids.includes(record.id))) {
      intervention.result = "rejected_physical_effect_evidence"; return;
    }
    intervention.result = physicalEffects.execute(intervention.content, binding.eid, isCurrent).status;
    return;
  }
  console.log(`[Spirit] ${spirit.definition.name} intervening: ${intervention.type} -> ${intervention.target.name}`);

  switch (intervention.type) {
    case "inject_stimulus": {
      const targetName = intervention.target.name;
      if (!targetName) break;

      if (intervention.target.type === "room") {
        const roomEid = binding.eid;
        if (roomEid !== undefined) {
          broadcastToRoom(world, roomEid, {
            type: "environmental",
            content: intervention.content,
            source: "the world",
            modality: "visual",
          });
        }
      } else if (intervention.target.type === "agent") {
        intervention.result = nudgeNpc(world, targetName, {
          type: "reflect", action: intervention.content, reason: intervention.reason,
        }, isCurrent) ? "accepted" : "rejected";
        return; // Accepted advice is not proof of delivery or an executed action.
      }
      break;
    }

    case "modify_mood": {
      const targetName = intervention.target.name;
      if (!targetName) break;

      const agentEid = intervention.target.type === "agent" ? binding.eid : undefined;
      if (agentEid !== undefined) {
        // Parse content for arousal value
        const arousalMatch = intervention.content.match(/arousal[:\s]+(\d+\.?\d*)/i);
        if (arousalMatch) {
          Mind.arousal[agentEid] = parseFloat(arousalMatch[1]);
        }
      }
      break;
    }
  }

  intervention.result = "executed";
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Generate a summary of a spirit's current understanding
 */
export function getSpiritSummary(spirit: SpiritState): string {
  const lines: string[] = [];

  lines.push(`=== ${spirit.definition.name} (${spirit.definition.domain}) ===`);
  lines.push(`Rank: ${spirit.definition.rank}`);
  lines.push(`Observations: ${spirit.observations.length}`);
  lines.push(`Significant Events: ${spirit.significantEvents.length}`);

  if (spirit.narrativeState) {
    lines.push("");
    lines.push("Narrative State:");
    lines.push(`  Act ${spirit.narrativeState.currentAct}, Phase: ${spirit.narrativeState.currentPhase}`);
    lines.push(`  Tension: ${(spirit.narrativeState.tension * 100).toFixed(0)}%`);
    lines.push(`  Plot Threads: ${spirit.narrativeState.plotThreads.length}`);
  }

  if (spirit.shortTermMemory.length > 0) {
    lines.push("");
    lines.push("Recent Thoughts:");
    for (const thought of spirit.shortTermMemory.slice(-3)) {
      lines.push(`  "${thought.slice(0, 100)}..."`);
    }
  }

  return lines.join("\n");
}
