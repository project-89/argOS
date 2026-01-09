/**
 * Narrator Spirit
 *
 * The Archangel of Narrative - watches story progression, tracks plot threads,
 * identifies dramatic opportunities, and ensures compelling storytelling.
 */

import type { SpiritDefinition, NarrativeState, NarrativePhase } from "./types";
import {
  StoryTemplates,
  StoryTemplate,
  BeatTemplate,
  getNextExpectedBeat,
  getInterventionSuggestions,
  calculateTemplateAlignment,
  suggestRoleAssignments,
} from "./story-templates";

// =============================================================================
// NARRATOR SYSTEM PROMPT
// =============================================================================

const NARRATOR_SYSTEM_PROMPT = `You are THE NARRATOR, an archangel spirit who turns simulation events into vivid, engaging storytelling.

## YOUR PRIMARY ROLE: STORYTELLER

Your most important job is to write the "storyProse" field - 1-3 sentences of beautiful,
immersive narrative that describes what's happening. You are the voice of the story.

Write like a skilled novelist:
- Use present tense for immediacy
- Show, don't tell emotions
- Use sensory details (sounds, smells, textures)
- Make dialogue feel natural when referenced
- Capture the atmosphere and mood
- Use varied sentence structure

## PROSE EXAMPLES

Good: "Maya's hands tremble as she strikes flint against stone, desperation etched across her face. The forest grows darker with each failed spark, and somewhere in the shadows, something moves."

Bad: "Maya is trying to make fire. She seems worried."

Good: "A crack of breaking branches echoes through the clearing. Tom freezes mid-step, his knuckles whitening around the crude spear he spent all morning crafting."

Bad: "Tom heard a noise and stopped walking."

## NARRATIVE TRACKING

Also track story structure:
- **Tension** (0-1): How dramatic is the current moment?
- **Phase**: exposition, inciting, rising, crisis, climax, falling, resolution
- **Plot threads**: What conflicts/goals are active?
- **Protagonists/Antagonists**: Who drives the story?

## WHEN TO INTERVENE

Inject stimuli to create drama:
- During stagnation (nothing interesting happening)
- To escalate conflicts
- To create connections between isolated characters
- To inject atmosphere and tension

## WRITING GUIDELINES

1. Focus on what JUST happened in the recent events
2. Build on previous narrative to create continuity
3. Give each character a distinct voice/presence
4. Create atmosphere appropriate to the setting
5. Make survival situations feel visceral and tense
6. Let character personalities shine through actions

Your prose appears directly in the narrative feed. Make every word count.`;

// =============================================================================
// NARRATOR DEFINITION
// =============================================================================

export const NarratorDefinition: SpiritDefinition = {
  name: "The Narrator",
  domain: "narrative",
  rank: "archangel",
  description: `The Narrator watches over the unfolding story, tracking plot threads,
character arcs, dramatic tension, and pacing. It identifies stagnation,
orchestrates inciting incidents, and ensures the simulation tells a compelling tale.`,

  watchConfig: {
    componentQueries: [
      {
        name: "active_agents",
        components: ["Agent", "Mind"],
        description: "All agents with cognitive activity",
      },
      {
        name: "speaking_agents",
        components: ["Agent", "Speech"],
        description: "Agents engaged in dialogue",
      },
      {
        name: "goal_driven",
        components: ["Agent", "Goal"],
        description: "Agents with active goals",
      },
    ],
    eventTypes: [
      "action_executed",
      "dialogue_spoken",
      "mood_changed",
      "goal_set",
      "goal_completed",
      "conflict_detected",
      "room_entered",
      "room_left",
    ],
    watchEntities: [], // Watches all by default
    watchRooms: [],    // Watches all by default
  },

  canInjectEvents: true,
  canModifyMood: true,
  canCreateEntities: false,
  canBakeSystems: false,

  model: "flash",
  observationInterval: 30000, // 30 seconds between observations

  systemPrompt: NARRATOR_SYSTEM_PROMPT,
};

// =============================================================================
// NARRATOR-SPECIFIC ANALYSIS HELPERS
// =============================================================================

/**
 * Calculate narrative urgency based on recent events
 */
export function calculateNarrativeUrgency(observations: { type: string; significance: number }[]): number {
  if (observations.length === 0) return 0.5;

  const recentSignificance = observations
    .slice(-10)
    .reduce((sum, obs) => sum + obs.significance, 0) / Math.min(observations.length, 10);

  const hasConflict = observations.some(o => o.type === "conflict");
  const hasStagnation = observations.some(o => o.type === "stagnation");

  let urgency = recentSignificance;

  if (hasConflict) urgency += 0.2;
  if (hasStagnation) urgency += 0.3; // Stagnation increases urgency to intervene

  return Math.min(1, Math.max(0, urgency));
}

/**
 * Identify potential plot threads from observations
 */
export function identifyPotentialPlotThreads(
  observations: { type: string; content: string; entities: string[] }[]
): { name: string; participants: string[]; type: string }[] {
  const threads: { name: string; participants: string[]; type: string }[] = [];

  // Group by entity combinations
  const entityInteractions = new Map<string, { count: number; types: string[] }>();

  for (const obs of observations) {
    if (obs.entities.length >= 2) {
      const key = obs.entities.sort().join("+");
      const existing = entityInteractions.get(key) || { count: 0, types: [] };
      existing.count++;
      existing.types.push(obs.type);
      entityInteractions.set(key, existing);
    }
  }

  // Threads emerge from repeated interactions
  for (const [entities, data] of entityInteractions) {
    if (data.count >= 3) {
      const participants = entities.split("+");
      const hasConflict = data.types.includes("conflict");
      const hasDialogue = data.types.includes("dialogue");

      threads.push({
        name: hasConflict
          ? `Conflict: ${participants.join(" vs ")}`
          : hasDialogue
            ? `Connection: ${participants.join(" & ")}`
            : `Thread: ${participants.join(", ")}`,
        participants,
        type: hasConflict ? "conflict" : hasDialogue ? "relationship" : "interaction",
      });
    }
  }

  return threads;
}

/**
 * Detect narrative stagnation
 */
export function detectStagnation(
  observations: { type: string; timestamp: number }[],
  threshold: number = 60000 // 1 minute
): { stagnating: boolean; duration: number; suggestion: string } {
  if (observations.length === 0) {
    return {
      stagnating: true,
      duration: Infinity,
      suggestion: "No observations yet. The world may be empty or inactive.",
    };
  }

  const now = Date.now();
  const lastSignificant = observations
    .filter(o => o.type !== "stagnation")
    .sort((a, b) => b.timestamp - a.timestamp)[0];

  if (!lastSignificant) {
    return {
      stagnating: true,
      duration: now - observations[0].timestamp,
      suggestion: "No significant events observed. Consider injecting an inciting incident.",
    };
  }

  const timeSinceLast = now - lastSignificant.timestamp;
  const isStagnating = timeSinceLast > threshold;

  return {
    stagnating: isStagnating,
    duration: timeSinceLast,
    suggestion: isStagnating
      ? "Extended quiet period. Consider: environmental interruption, NPC intuition, or external event."
      : "Story progressing normally.",
  };
}

/**
 * Determine appropriate narrative phase based on story progression
 */
export function assessNarrativePhase(
  plotThreads: { status: string; tension: number }[],
  overallTension: number,
  eventsCount: number
): string {
  // Early game - few events
  if (eventsCount < 10) {
    return "exposition";
  }

  // Look at thread states
  const activeThreads = plotThreads.filter(t => t.status === "active");
  const climaxingThreads = plotThreads.filter(t => t.status === "climax");
  const resolvedThreads = plotThreads.filter(t => t.status === "resolved");

  if (climaxingThreads.length > 0) {
    return "climax";
  }

  if (overallTension > 0.8) {
    return "crisis";
  }

  if (overallTension > 0.6) {
    return "rising";
  }

  if (resolvedThreads.length > activeThreads.length && overallTension < 0.3) {
    return "resolution";
  }

  if (activeThreads.length === 0 && plotThreads.length > 0) {
    return "denouement";
  }

  // Check if we need an inciting incident
  if (plotThreads.length === 0 && eventsCount > 5) {
    return "inciting";
  }

  return "exposition";
}

/**
 * Generate intervention suggestions based on current state
 */
export function suggestInterventions(
  phase: string,
  tension: number,
  stagnating: boolean,
  activeAgents: { name: string; location: string; mood: string }[]
): { type: string; target: string; content: string; reason: string }[] {
  const suggestions: { type: string; target: string; content: string; reason: string }[] = [];

  if (stagnating) {
    // Find an agent to disturb
    const target = activeAgents[Math.floor(Math.random() * activeAgents.length)];
    if (target) {
      suggestions.push({
        type: "inject_stimulus",
        target: target.name,
        content: "A sudden realization strikes you - there's something you've been avoiding thinking about.",
        reason: "Break stagnation by triggering introspection",
      });
    }
  }

  if (phase === "exposition" && tension < 0.3) {
    suggestions.push({
      type: "inject_stimulus",
      target: "room", // Will need to select specific room
      content: "An unexpected sound breaks the silence - something is about to change.",
      reason: "Build anticipation during setup",
    });
  }

  if (phase === "inciting" && tension < 0.4) {
    const target = activeAgents[0];
    if (target) {
      suggestions.push({
        type: "modify_mood",
        target: target.name,
        content: "arousal: 0.7",
        reason: "Heighten protagonist awareness for inciting incident",
      });
    }
  }

  if (phase === "rising" && tension < 0.5) {
    suggestions.push({
      type: "inject_stimulus",
      target: "room",
      content: "The atmosphere grows tense. Something feels different - dangerous, perhaps.",
      reason: "Maintain rising tension curve",
    });
  }

  return suggestions;
}

// =============================================================================
// TEMPLATE-AWARE HELPERS
// =============================================================================

/**
 * Active story template for the current narrative
 */
let activeTemplate: StoryTemplate | null = null;
let completedBeatIds: string[] = [];

/**
 * Set the active story template for the narrative
 */
export function setActiveTemplate(templateId: string): StoryTemplate | null {
  const template = StoryTemplates[templateId];
  if (template) {
    activeTemplate = template;
    completedBeatIds = [];
    console.log(`[Narrator] Active template set: ${template.name}`);
    return template;
  }
  console.log(`[Narrator] Template not found: ${templateId}`);
  return null;
}

/**
 * Get the currently active story template
 */
export function getActiveTemplate(): StoryTemplate | null {
  return activeTemplate;
}

/**
 * Get available story templates
 */
export function getAvailableTemplates(): { id: string; name: string; genre: string; description: string }[] {
  return Object.values(StoryTemplates).map(t => ({
    id: t.id,
    name: t.name,
    genre: t.genre,
    description: t.description,
  }));
}

/**
 * Mark a story beat as completed
 */
export function markBeatCompleted(beatId: string): void {
  if (!completedBeatIds.includes(beatId)) {
    completedBeatIds.push(beatId);
    console.log(`[Narrator] Beat completed: ${beatId}`);
  }
}

/**
 * Get the next expected beat based on current template and state
 */
export function getNextBeat(currentPhase: NarrativePhase): BeatTemplate | null {
  if (!activeTemplate) return null;
  return getNextExpectedBeat(activeTemplate, completedBeatIds, currentPhase);
}

/**
 * Get template-aware intervention suggestions
 */
export function getTemplateInterventions(
  currentTension: number,
  currentPhase: NarrativePhase,
  ticksSinceLastEvent: number
): { trigger: string; type: string; templates: string[] }[] {
  if (!activeTemplate) return [];
  return getInterventionSuggestions(activeTemplate, currentTension, currentPhase, ticksSinceLastEvent);
}

/**
 * Check how well the current narrative aligns with the template
 */
export function checkTemplateAlignment(
  currentTension: number,
  currentPhase: NarrativePhase,
  eventCount: number
): { alignment: number; issues: string[] } {
  if (!activeTemplate) {
    return { alignment: 1.0, issues: ["No template active"] };
  }
  return calculateTemplateAlignment(activeTemplate, currentTension, currentPhase, completedBeatIds, eventCount);
}

/**
 * Get role suggestions for agents based on active template
 */
export function getRoleSuggestions(
  agents: { name: string; traits: string[]; arousal: number }[]
): { role: string; suggestedAgent: string; reason: string }[] {
  if (!activeTemplate) return [];
  return suggestRoleAssignments(activeTemplate, agents);
}

/**
 * Enhanced intervention suggestions that combine phase-based and template-based logic
 */
export function suggestEnhancedInterventions(
  narrativeState: NarrativeState,
  ticksSinceLastEvent: number,
  activeAgents: { name: string; location: string; mood: string; arousal: number }[]
): {
  type: string;
  target: string;
  content: string;
  reason: string;
  source: "phase" | "template" | "stagnation";
}[] {
  const suggestions: {
    type: string;
    target: string;
    content: string;
    reason: string;
    source: "phase" | "template" | "stagnation";
  }[] = [];

  const { currentPhase, tension } = narrativeState;

  // Get basic phase-based suggestions
  const basicSuggestions = suggestInterventions(
    currentPhase,
    tension,
    ticksSinceLastEvent > 60000,
    activeAgents
  );

  for (const s of basicSuggestions) {
    suggestions.push({
      ...s,
      source: s.reason.includes("stagnation") ? "stagnation" : "phase",
    });
  }

  // Add template-based suggestions if template is active
  if (activeTemplate) {
    const templateSuggestions = getInterventionSuggestions(
      activeTemplate,
      tension,
      currentPhase,
      ticksSinceLastEvent
    );

    for (const ts of templateSuggestions) {
      // Pick a random template suggestion
      const content = ts.templates[Math.floor(Math.random() * ts.templates.length)];
      const target = activeAgents.length > 0
        ? activeAgents[Math.floor(Math.random() * activeAgents.length)].name
        : "room";

      suggestions.push({
        type: ts.type,
        target,
        content,
        reason: `Template trigger: ${ts.trigger}`,
        source: "template",
      });
    }

    // Check for missed beats and suggest triggering them
    const nextBeat = getNextExpectedBeat(activeTemplate, completedBeatIds, currentPhase);
    if (nextBeat && !nextBeat.optional) {
      suggestions.push({
        type: "inject_stimulus",
        target: activeAgents[0]?.name || "room",
        content: `[Beat: ${nextBeat.name}] ${nextBeat.description}`,
        reason: `Template requires beat: ${nextBeat.name}`,
        source: "template",
      });
    }
  }

  return suggestions;
}

/**
 * Generate a narrative status report
 */
export function generateNarrativeReport(
  narrativeState: NarrativeState,
  eventCount: number,
  ticksSinceLastEvent: number
): {
  summary: string;
  phase: NarrativePhase;
  tension: number;
  alignment: number;
  issues: string[];
  nextBeat: BeatTemplate | null;
  recommendations: string[];
} {
  const { currentPhase, tension, plotThreads } = narrativeState;

  // Check alignment if template is active
  const { alignment, issues } = activeTemplate
    ? calculateTemplateAlignment(activeTemplate, tension, currentPhase, completedBeatIds, eventCount)
    : { alignment: 1.0, issues: [] };

  // Get next beat
  const nextBeat = activeTemplate
    ? getNextExpectedBeat(activeTemplate, completedBeatIds, currentPhase)
    : null;

  // Generate recommendations
  const recommendations: string[] = [];

  if (ticksSinceLastEvent > 60000) {
    recommendations.push("Story is stagnating - inject an event or stimulus");
  }

  if (alignment < 0.7) {
    recommendations.push("Story deviating from template - consider corrective interventions");
  }

  if (nextBeat && !nextBeat.optional) {
    recommendations.push(`Work toward triggering beat: "${nextBeat.name}"`);
  }

  const activeThreadCount = plotThreads.filter(t => t.status === "active").length;
  if (activeThreadCount === 0 && currentPhase !== "exposition" && currentPhase !== "denouement") {
    recommendations.push("No active plot threads - introduce conflict or complication");
  }

  // Generate summary
  const summary = activeTemplate
    ? `Narrative following "${activeTemplate.name}" template. Currently in ${currentPhase} phase with ${(tension * 100).toFixed(0)}% tension. ${activeThreadCount} active plot threads.`
    : `Free-form narrative in ${currentPhase} phase with ${(tension * 100).toFixed(0)}% tension. ${activeThreadCount} active plot threads.`;

  return {
    summary,
    phase: currentPhase,
    tension,
    alignment,
    issues,
    nextBeat,
    recommendations,
  };
}
