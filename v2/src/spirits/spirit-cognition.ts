/**
 * Spirit Cognition
 *
 * The cognitive loop for spirits - observe, analyze, report, intervene.
 * Spirits use LLMs to reason about what they observe in the ECS.
 */

import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { query, getRelationTargets } from "bitecs";
import type { World } from "../ecs/world";
import { Name, Description, Agent, Mind, Room, Goal, Impression, StimulusSource } from "../ecs/components";
import { OccupiesRoom, HasGoal, HasImpression } from "../ecs/relations";
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
import { reportToSuperior } from "./spirit-registry";
import { broadcastToRoom, queueStimulus } from "../cognition/cognition-system";

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
    const rooms = getRelationTargets(world, eid, OccupiesRoom);
    const location = rooms.length > 0 ? (Name.value[rooms[0]] || "Unknown") : "Nowhere";

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
      recentThoughts: [],  // Would need thought history
    };
  });
}

function collectRoomSnapshots(world: World, registry: EntityRegistry): RoomSnapshot[] {
  const roomEids = Array.from(query(world, [Room]));
  const allStimulusSources = Array.from(query(world, [StimulusSource]));

  return roomEids.map(eid => {
    const name = Name.value[eid] || "Unknown";
    const description = Description.value[eid] || "";
    const ambience = Room.ambience[eid] || "neutral";

    // Find occupants (agents in this room)
    const allAgents = Array.from(query(world, [Agent]));
    const occupants = allAgents
      .filter(aid => {
        const rooms = getRelationTargets(world, aid, OccupiesRoom);
        return rooms.includes(eid);
      })
      .map(aid => Name.value[aid] || "Unknown");

    // Find objects (entities with StimulusSource that are in this room)
    const objects: string[] = [];

    for (const objEid of allStimulusSources) {
      // Skip agents (they're in occupants)
      if (Agent.active[objEid] !== undefined) continue;

      // Check if object is in this room via OccupiesRoom
      const objRooms = getRelationTargets(world, objEid, OccupiesRoom);
      if (objRooms.includes(eid)) {
        const objName = Name.value[objEid];
        if (objName) objects.push(objName);
        continue;
      }

      // Check if room contains this object via Contains relation
      try {
        const { Contains } = require("../ecs/relations");
        const roomContents = getRelationTargets(world, eid, Contains);
        if (roomContents.includes(objEid)) {
          const objName = Name.value[objEid];
          if (objName) objects.push(objName);
        }
      } catch {
        // Contains relation might not be available
      }
    }

    return {
      eid,
      name,
      description,
      occupants,
      objects,
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
  const ecsSnapshot = collectEcsSnapshot(world, registry, recentActions);

  // 2. Prepare input
  const input: SpiritCognitionInput = {
    spirit,
    ecsSnapshot,
    recentEvents: spirit.observations.slice(-20),
    incomingMessages: spirit.inbox,
    activeDirectives: spirit.pendingDirectives.filter(d => d.status === "pending" || d.status === "active"),
  };

  // 3. Build prompt based on spirit type (including global context if available)
  const prompt = buildSpiritPrompt(spirit, input, globalContext);

  // 4. Run LLM
  const model = models[spirit.definition.model];
  let output: SpiritCognitionOutput;

  try {
    const response = await generateText({
      model,
      system: spirit.definition.systemPrompt,
      prompt,
      temperature: 0.7,
    });

    // 5. Parse response
    output = parseSpiritResponse(spirit, response.text, input);
  } catch (error) {
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
  await processOutputs(spirit, output, world, registry, spiritRegistry);

  // 7. Update spirit state
  spirit.lastObservationTime = Date.now();
  spirit.inbox = [];  // Clear processed messages

  // Add thoughts to memory
  if (output.thoughts) {
    spirit.shortTermMemory.push(output.thoughts);
    if (spirit.shortTermMemory.length > 20) {
      spirit.shortTermMemory = spirit.shortTermMemory.slice(-20);
    }
  }

  const duration = Date.now() - startTime;
  console.log(`[Spirit] ${spirit.definition.name} cycle complete (${duration}ms)`);

  return output;
}

// =============================================================================
// PROMPT BUILDING
// =============================================================================

function buildSpiritPrompt(spirit: SpiritState, input: SpiritCognitionInput, globalContext?: string): string {
  const sections: string[] = [];

  // Header
  sections.push(`You are ${spirit.definition.name}, a ${spirit.definition.rank} spirit managing the ${spirit.definition.domain} domain.`);
  sections.push("");

  // GLOBAL CONTEXT (if provided by God)
  // This is the critical "pinned context" that spans all spirits
  if (globalContext) {
    sections.push(globalContext);
    sections.push("");
  }

  // Current state
  sections.push("=== CURRENT WORLD STATE ===");
  sections.push("");

  // Agents
  sections.push("AGENTS:");
  for (const agent of input.ecsSnapshot.agents) {
    sections.push(`  ${agent.name} [${agent.mood}] @ ${agent.location}${agent.active ? "" : " (inactive)"}`);
    if (agent.focus) {
      sections.push(`    Focus: ${agent.focus}`);
    }
  }
  sections.push("");

  // Rooms
  sections.push("LOCATIONS:");
  for (const room of input.ecsSnapshot.rooms) {
    const occupants = room.occupants.length > 0 ? room.occupants.join(", ") : "empty";
    sections.push(`  ${room.name}: [${occupants}]`);
  }
  sections.push("");

  // Recent actions
  if (input.recentEvents.length > 0) {
    sections.push("RECENT EVENTS:");
    for (const event of input.recentEvents.slice(-10)) {
      sections.push(`  - [${event.type}] ${event.content}`);
    }
    sections.push("");
  }

  // Domain-specific state
  if (spirit.definition.domain === "narrative" && spirit.narrativeState) {
    sections.push("=== NARRATIVE STATE ===");
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

    // Add explicit grounding constraints for narrative spirits
    sections.push("=== GROUNDING CONSTRAINTS (CRITICAL) ===");
    sections.push("You may ONLY reference the following in your storyProse:");
    sections.push("");
    sections.push("VALID AGENT NAMES (can mention):");
    for (const agent of input.ecsSnapshot.agents) {
      sections.push(`  - "${agent.name}" (mood: ${agent.mood}, location: ${agent.location})`);
    }
    sections.push("");
    sections.push("VALID LOCATIONS (can mention):");
    for (const room of input.ecsSnapshot.rooms) {
      sections.push(`  - "${room.name}": ${room.description || "(no description)"}`);
    }
    sections.push("");
    sections.push("OBJECTS IN WORLD:");
    let hasObjects = false;
    for (const room of input.ecsSnapshot.rooms) {
      if (room.objects && room.objects.length > 0) {
        sections.push(`  In ${room.name}: ${room.objects.join(", ")}`);
        hasObjects = true;
      }
    }
    if (!hasObjects) {
      sections.push("  (No objects currently exist in the world)");
    }
    sections.push("");
    sections.push("⚠️ DO NOT mention any entities, items, creatures, or locations not listed above!");
    sections.push("⚠️ If you need something to exist, request it via reportToSuperior.");
    sections.push("");

    // Add recent prose to prevent repetition
    if (spirit.narrativeState.recentProse && spirit.narrativeState.recentProse.length > 0) {
      sections.push("=== RECENT PROSE (AVOID REPETITION) ===");
      sections.push("You have recently written these summaries. DO NOT repeat similar ideas or phrasing:");
      for (const prose of spirit.narrativeState.recentProse.slice(-5)) {
        sections.push(`  - "${prose.slice(0, 100)}${prose.length > 100 ? '...' : ''}"`);
      }
      sections.push("");
      sections.push("⚠️ CRITICAL: Write something NEW. Advance the story. If characters are doing the same thing,");
      sections.push("   describe the PROGRESSION or CHANGE, not the same action again.");
      sections.push("   BAD: 'Emma moves toward the forge' (again)");
      sections.push("   GOOD: 'Emma arrives at the forge, her breath catching at the sight of Lars'");
      sections.push("");
    }
  }

  // Messages
  if (input.incomingMessages.length > 0) {
    sections.push("=== MESSAGES ===");
    for (const msg of input.incomingMessages) {
      sections.push(`From superior: ${msg.subject}`);
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
  sections.push('    "type": "inject_stimulus|modify_mood",');
  sections.push('    "target": "agent or room name",');
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
    sections.push('      "reason": "Why this advances the story"');
    sections.push('    }');
    sections.push('  ],');
    sections.push('  "storyProse": "Write 1-3 sentences of engaging narrative prose describing what just happened. Write it like a novel - vivid, immersive, showing not telling. Use present tense. If nothing interesting happened, leave empty string."');
  }

  sections.push("}");
  sections.push("```");

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
            });
            break;

          case "resolve_thread":
          case "escalate":
          case "create_event":
          case "suggest_beat":
            // Report to GodAI with specific suggestion
            output.reports.push({
              id: `dir_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
              timestamp: Date.now(),
              from: spirit.eid,
              to: spirit.superiorEid || -1,
              type: "report",
              domain: "narrative",
              priority: directive.type === "escalate" ? "high" : "normal",
              subject: `[${directive.type.toUpperCase()}] ${directive.target}`,
              content: `Suggested action: ${directive.action}\n\nReason: ${directive.reason}`,
              requiresResponse: false,
            });
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
          const { recordIssue } = require("./consistency-spirit");
          recordIssue({
            id: `hal_${Date.now()}`,
            timestamp: Date.now(),
            severity: "medium",
            category: "narrative_drift",
            description: `Narrator mentioned non-existent entities: ${hallucinations.join(", ")}`,
            evidence: [rawProse.substring(0, 150)],
            affectedEntities: hallucinations,
            recommendation: `Create these entities if needed, or instruct narrator to avoid mentioning them.`,
            autoFixable: true,
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
    console.error(`[Spirit] ${spirit.definition.name} failed to parse response:`, error);
    output.thoughts = `Failed to parse response: ${responseText.slice(0, 200)}...`;
  }

  return output;
}

// =============================================================================
// OUTPUT PROCESSING
// =============================================================================

async function processOutputs(
  spirit: SpiritState,
  output: SpiritCognitionOutput,
  world: World,
  registry: EntityRegistry,
  spiritRegistry: SpiritRegistry
): Promise<void> {
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
    if (spirit.superiorEid !== undefined || spiritRegistry.godAgentEid !== undefined) {
      reportToSuperior(
        spiritRegistry,
        spirit.eid,
        report.subject,
        report.content,
        report.priority
      );
    }
  }

  // Execute interventions
  for (const intervention of output.interventions) {
    await executeIntervention(intervention, world, registry, spirit);
  }

  // Update narrative state
  if (output.updatedNarrativeState && spirit.narrativeState) {
    Object.assign(spirit.narrativeState, output.updatedNarrativeState);
  }

  // Update social state
  if (output.updatedSocialState && spirit.socialState) {
    Object.assign(spirit.socialState, output.updatedSocialState);
  }
}

async function executeIntervention(
  intervention: Intervention,
  world: World,
  registry: EntityRegistry,
  spirit: SpiritState
): Promise<void> {
  console.log(`[Spirit] ${spirit.definition.name} intervening: ${intervention.type} -> ${intervention.target.name}`);

  switch (intervention.type) {
    case "inject_stimulus": {
      const targetName = intervention.target.name;
      if (!targetName) break;

      if (intervention.target.type === "room") {
        const roomEid = registry.byName.get(targetName);
        if (roomEid !== undefined) {
          broadcastToRoom(world, roomEid, {
            type: "environmental",
            content: intervention.content,
            source: "the world",
            modality: "visual",
          });
        }
      } else if (intervention.target.type === "agent") {
        const agentEid = registry.byName.get(targetName);
        if (agentEid !== undefined) {
          queueStimulus({
            targetEid: agentEid,
            type: "intuition",
            content: intervention.content,
            source: "inner sense",
            modality: "cognitive",
          });
        }
      }
      break;
    }

    case "modify_mood": {
      const targetName = intervention.target.name;
      if (!targetName) break;

      const agentEid = registry.byName.get(targetName);
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
