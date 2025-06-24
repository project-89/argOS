import { World, query, hasComponent, setComponent } from "bitecs";
import { Agent, Attention, Perception, Goal, WorkingMemory, ReasoningContext } from "../components";
import { createSystem } from "./System";
import { processConcurrentAgents } from "../utils/system-utils";
import { logger } from "../utils/logger";
import type { AttentionFocus } from "../components/Attention";

/**
 * AttentionSystem - Manages agent attention and focus
 * 
 * This system:
 * 1. Filters incoming stimuli based on salience
 * 2. Manages attention focus stack
 * 3. Switches attention based on urgency and relevance
 * 4. Tracks attention patterns for meta-cognition
 * 5. Optimizes cognitive resources
 */
export const AttentionSystem = createSystem(
  (runtime) => async (world: World) => {
    // Query for agents with attention and perception
    const agents = query(world, [Agent, Perception]);

    await processConcurrentAgents(
      world,
      agents,
      "AttentionSystem",
      async (eid) => {
        if (!Agent.active[eid]) return;

        // Initialize Attention component if needed
        if (!hasComponent(world, eid, Attention)) {
          setComponent(world, eid, Attention, {
            focus_stack: [],
            capacity: 5,
            filters: {
              include_types: [],
              exclude_types: [],
              min_relevance: 0.3,
              min_urgency: 0.0,
            },
            mode: "scanning",
            history: [],
            salience_thresholds: {
              novelty: 0.6,
              relevance: 0.5,
              social: 0.4,
              threat: 0.8,
            },
            metrics: {
              focus_switches: 0,
              average_focus_duration: 0,
              missed_important: 0,
              distraction_count: 0,
            },
            last_update: Date.now(),
          });
        }

        const attention = {
          focus_stack: Attention.focus_stack[eid] || [],
          capacity: Attention.capacity[eid] || 5,
          filters: Attention.filters[eid] || {
            include_types: [],
            exclude_types: [],
            min_relevance: 0.3,
            min_urgency: 0.0,
          },
          mode: Attention.mode[eid] || "scanning",
          history: Attention.history[eid] || [],
          salience_thresholds: Attention.salience_thresholds[eid] || {
            novelty: 0.6,
            relevance: 0.5,
            social: 0.4,
            threat: 0.8,
          },
          metrics: Attention.metrics[eid] || {
            focus_switches: 0,
            average_focus_duration: 0,
            missed_important: 0,
            distraction_count: 0,
          },
          last_update: Attention.last_update[eid] || Date.now(),
        };
        const perceptionData = Perception.currentStimuli[eid] || [];
        const goals = Goal.current[eid] || [];
        const workingMemory = hasComponent(world, eid, WorkingMemory) 
          ? [] // TODO: Fix WorkingMemory structure
          : [];

        // Process new stimuli for salience
        const salientItems = processStimuliForSalience(
          perceptionData,
          goals,
          workingMemory,
          attention
        );

        // Update attention focus based on salience
        const updatedFocusStack = updateAttentionFocus(
          attention.focus_stack,
          salientItems,
          attention
        );

        // Determine attention mode based on context
        const newMode = determineAttentionMode(
          updatedFocusStack,
          perceptionData.length,
          goals.length
        );

        // Apply attention filters to perception
        applyAttentionFilters(world, eid, attention, perceptionData);

        // Track attention performance
        const metrics = updateAttentionMetrics(
          attention,
          updatedFocusStack,
          salientItems
        );

        // Update attention component
        setComponent(world, eid, Attention, {
          ...attention,
          focus_stack: updatedFocusStack.slice(0, attention.capacity),
          mode: newMode,
          metrics,
          last_update: Date.now(),
        });

        // Update reasoning context if agent has it
        if (hasComponent(world, eid, ReasoningContext)) {
          updateReasoningMode(world, eid, newMode);
        }

        // Emit attention event
        runtime.eventBus.emitAgentEvent(eid, "attention", "updated", {
          mode: newMode,
          focusCount: updatedFocusStack.length,
          topFocus: updatedFocusStack[0]?.target,
        });

        logger.debug(`Attention updated for agent ${Agent.name[eid]}`, {
          mode: newMode,
          focusItems: updatedFocusStack.length,
          stimuliCount: perceptionData.length,
        });

        return {
          updated: true,
          mode: newMode,
          focusCount: updatedFocusStack.length,
        };
      }
    );

    return world;
  }
);

// Helper functions

function processStimuliForSalience(
  stimuli: any[],
  goals: any[],
  workingMemory: any[],
  attention: any
): AttentionFocus[] {
  const salientItems: AttentionFocus[] = [];
  const now = Date.now();

  // Process each stimulus
  stimuli.forEach(stimulus => {
    let relevance = 0;
    let urgency = 0;
    let type: AttentionFocus["type"] = "stimulus";

    // Check goal relevance
    goals.forEach(goal => {
      if (stimulusRelatedToGoal(stimulus, goal)) {
        relevance = Math.max(relevance, 0.8);
        if (goal.priority > 0.7) urgency = Math.max(urgency, 0.6);
      }
    });

    // Check novelty
    const isNovel = !workingMemory.some(mem => 
      mem.content.includes(stimulus.content)
    );
    if (isNovel && relevance < attention.salience_thresholds.novelty) {
      relevance = Math.max(relevance, attention.salience_thresholds.novelty);
    }

    // Check for social stimuli
    if (stimulus.type === "speech" || stimulus.source !== "environment") {
      relevance = Math.max(relevance, attention.salience_thresholds.social);
      type = "agent";
      urgency = Math.max(urgency, 0.5); // Social stimuli are moderately urgent
    }

    // Check for threat indicators
    if (containsThreatIndicators(stimulus)) {
      relevance = Math.max(relevance, attention.salience_thresholds.threat);
      urgency = Math.max(urgency, 0.9);
    }

    // Add if meets thresholds
    if (relevance >= attention.filters.min_relevance || 
        urgency >= attention.filters.min_urgency) {
      salientItems.push({
        target: stimulus.content,
        type,
        relevance,
        urgency,
        timestamp: now,
        decay_rate: 0.1, // Default decay
        metadata: {
          stimulusId: stimulus.id,
          source: stimulus.source,
        },
      });
    }
  });

  // Sort by combined salience score
  salientItems.sort((a, b) => {
    const scoreA = a.relevance * 0.6 + a.urgency * 0.4;
    const scoreB = b.relevance * 0.6 + b.urgency * 0.4;
    return scoreB - scoreA;
  });

  return salientItems;
}

function updateAttentionFocus(
  currentFocus: AttentionFocus[],
  newSalient: AttentionFocus[],
  attention: any
): AttentionFocus[] {
  const now = Date.now();
  
  // Decay existing focus items
  const decayedFocus = currentFocus.map(focus => {
    const age = now - focus.timestamp;
    const decayFactor = Math.exp(-focus.decay_rate * age / 1000);
    return {
      ...focus,
      relevance: focus.relevance * decayFactor,
      urgency: focus.urgency * decayFactor,
    };
  }).filter(focus => 
    focus.relevance > 0.1 || focus.urgency > 0.1
  );

  // Merge with new salient items
  const merged = [...decayedFocus];
  
  newSalient.forEach(newItem => {
    // Check if already in focus
    const existing = merged.findIndex(f => 
      f.target === newItem.target && f.type === newItem.type
    );
    
    if (existing >= 0) {
      // Update existing focus
      merged[existing] = {
        ...merged[existing],
        relevance: Math.max(merged[existing].relevance, newItem.relevance),
        urgency: Math.max(merged[existing].urgency, newItem.urgency),
        timestamp: now,
      };
    } else {
      // Add new focus
      merged.push(newItem);
    }
  });

  // Re-sort by combined score
  merged.sort((a, b) => {
    const scoreA = a.relevance * 0.6 + a.urgency * 0.4;
    const scoreB = b.relevance * 0.6 + b.urgency * 0.4;
    return scoreB - scoreA;
  });

  return merged;
}

function determineAttentionMode(
  focusStack: AttentionFocus[],
  stimuliCount: number,
  goalCount: number
): "focused" | "scanning" | "alert" | "divided" | "wandering" {
  // No focus items - wandering
  if (focusStack.length === 0) return "wandering";
  
  // Single high-priority item - focused
  if (focusStack.length === 1 || 
      (focusStack[0]?.urgency > 0.8 && focusStack[0]?.relevance > 0.8)) {
    return "focused";
  }
  
  // Many urgent items - alert
  const urgentCount = focusStack.filter(f => f.urgency > 0.6).length;
  if (urgentCount > 3) return "alert";
  
  // Multiple important items - divided
  if (focusStack.length > 3 && focusStack[2].relevance > 0.5) {
    return "divided";
  }
  
  // High stimuli count - scanning
  if (stimuliCount > 10) return "scanning";
  
  // Default to scanning
  return "scanning";
}

function applyAttentionFilters(
  world: World,
  eid: number,
  attention: any,
  perceptions: any[]
) {
  // Filter perceptions based on attention
  const filtered = perceptions.filter(p => {
    // Check include/exclude filters
    if (attention.filters.exclude_types.includes(p.type)) return false;
    if (attention.filters.include_types.length > 0 && 
        !attention.filters.include_types.includes(p.type)) return false;
    
    // In focused mode, only keep items related to focus
    if (attention.mode === "focused" && attention.focus_stack.length > 0) {
      const topFocus = attention.focus_stack[0];
      return p.content.includes(topFocus.target) || 
             p.source === topFocus.metadata?.source;
    }
    
    return true;
  });

  // Update perception with filtered stimuli
  setComponent(world, eid, Perception, {
    currentStimuli: filtered,
    lastUpdate: Date.now(),
  });
}

function updateAttentionMetrics(
  attention: any,
  newFocusStack: AttentionFocus[],
  salientItems: AttentionFocus[]
): any {
  const metrics = { ...attention.metrics };
  
  // Track focus switches
  if (attention.focus_stack[0]?.target !== newFocusStack[0]?.target) {
    metrics.focus_switches++;
  }
  
  // Update average focus duration
  if (attention.history.length > 0) {
    const totalDuration = attention.history.reduce((sum: number, h: any) => sum + h.duration, 0);
    metrics.average_focus_duration = totalDuration / attention.history.length;
  }
  
  // Check for missed important items
  const importantMissed = salientItems.filter(s => 
    s.urgency > 0.8 && !newFocusStack.some(f => f.target === s.target)
  );
  metrics.missed_important += importantMissed.length;
  
  return metrics;
}

function updateReasoningMode(world: World, eid: number, attentionMode: string) {
  if (!hasComponent(world, eid, ReasoningContext)) return;
  
  // Map attention modes to reasoning modes
  const modeMap: Record<string, any> = {
    focused: "deliberative",
    scanning: "exploratory",
    alert: "reactive",
    divided: "reactive",
    wandering: "reflective",
  };
  
  if (modeMap[attentionMode]) {
    ReasoningContext.mode[eid] = modeMap[attentionMode];
  }
}

function stimulusRelatedToGoal(stimulus: any, goal: any): boolean {
  // Simple keyword matching - could be enhanced
  const goalKeywords = goal.description.toLowerCase().split(" ");
  const stimulusContent = stimulus.content.toLowerCase();
  
  return goalKeywords.some(keyword => 
    keyword.length > 3 && stimulusContent.includes(keyword)
  );
}

function containsThreatIndicators(stimulus: any): boolean {
  const threatWords = ["danger", "threat", "attack", "hurt", "damage", "emergency"];
  const content = stimulus.content.toLowerCase();
  
  return threatWords.some(word => content.includes(word));
}