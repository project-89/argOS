import { World, query, hasComponent, setComponent } from "bitecs";
import { Agent, Perception, WorkingMemory, Thought, Stimulus, Attention } from "../components";
import { getAgentRoom } from "../utils/queries";
import { getRoomStimuli } from "../utils/room-queries";
import { createSystem } from "./System";
import { processConcurrentAgents } from "../utils/system-utils";
import { logger } from "../utils/logger";
import { generateStructuredPerception } from "../llm/perception-llm";
import { ThoughtEntry } from "../components/Thought";

/**
 * PerceptionSystem3 - Enhanced perception with structured analysis
 * 
 * This system:
 * 1. Analyzes stimuli for patterns and meaning
 * 2. Categorizes perceptions by type and importance
 * 3. Detects changes and anomalies
 * 4. Integrates with attention system for filtering
 * 5. Maintains perceptual memory
 */
export const PerceptionSystem3 = createSystem(
  (runtime) => async (world: World) => {
    // Query for agents with perception capability
    const agents = query(world, [Agent, Perception]);

    await processConcurrentAgents(
      world,
      agents,
      "PerceptionSystem3",
      async (eid) => {
        if (!Agent.active[eid]) return;

        const roomId = getAgentRoom(world, eid);
        if (!roomId) return;

        // Get room stimuli
        const roomStimuli = getRoomStimuli(world, roomId);
        if (roomStimuli.length === 0) {
          // No stimuli to process
          setComponent(world, eid, Perception, {
            currentStimuli: [],
            lastUpdate: Date.now(),
          });
          return { processed: 0 };
        }

        // Get agent's attention state if available
        const attention = hasComponent(world, eid, Attention) 
          ? {
              focus_stack: Attention.focus_stack[eid] || [],
              capacity: Attention.capacity[eid] || 5,
              mode: Attention.mode[eid] || "scanning",
            }
          : null;

        // Get working memory for context
        const workingMemory = hasComponent(world, eid, WorkingMemory)
          ? (WorkingMemory.items[eid] || [])
          : [];

        // Get recent perceptions for comparison
        const recentPerceptions = getRecentPerceptions(world, eid);

        try {
          // Generate structured perception analysis
          const perceptionAnalysis = await generateStructuredPerception({
            agentId: String(eid),
            name: Agent.name[eid],
            role: Agent.role[eid],
            stimuli: roomStimuli,
            workingMemory,
            recentPerceptions,
            attentionMode: attention?.mode,
            attentionFocus: attention?.focus_stack[0],
          }, runtime);

          // Process the perception analysis
          const processedStimuli = processPerceptionAnalysis(
            roomStimuli,
            perceptionAnalysis,
            attention
          );

          // Update perception component
          setComponent(world, eid, Perception, {
            currentStimuli: processedStimuli,
            lastUpdate: Date.now(),
          });

          // Create perception thought entries
          createPerceptionEntries(world, eid, perceptionAnalysis);

          // Update working memory with important perceptions
          updateWorkingMemoryWithPerceptions(world, eid, perceptionAnalysis);

          // Emit perception event
          runtime.eventBus.emitAgentEvent(eid, "perception", "analyzed", {
            stimuliCount: roomStimuli.length,
            processedCount: processedStimuli.length,
            patterns: perceptionAnalysis.patterns,
            changes: perceptionAnalysis.changes,
          });

          logger.debug(`Enhanced perception for agent ${Agent.name[eid]}`, {
            stimuliCount: roomStimuli.length,
            patternsFound: perceptionAnalysis.patterns.length,
            changesDetected: perceptionAnalysis.changes.length,
          });

          return {
            processed: processedStimuli.length,
            patterns: perceptionAnalysis.patterns.length,
            changes: perceptionAnalysis.changes.length,
          };
        } catch (error) {
          logger.error(`Perception error for agent ${Agent.name[eid]}:`, error);
          
          // Fallback to basic perception
          setComponent(world, eid, Perception, {
            currentStimuli: roomStimuli,
            lastUpdate: Date.now(),
          });
          
          return { error: true, processed: roomStimuli.length };
        }
      }
    );

    return world;
  }
);

// Helper functions

function getRecentPerceptions(world: World, eid: number): any[] {
  if (!hasComponent(world, eid, Thought)) return [];
  
  const thoughtEntries = (Thought.entries[eid] || []) as ThoughtEntry[];
  
  return thoughtEntries
    .filter(entry => entry.type === "perception")
    .slice(-10)
    .map(entry => ({
      content: entry.content,
      timestamp: entry.timestamp,
      metadata: entry.context?.metadata,
    }));
}

function processPerceptionAnalysis(
  stimuli: any[],
  analysis: any,
  attention: any | null
): any[] {
  // Enrich stimuli with analysis data
  const enrichedStimuli = stimuli.map(stimulus => {
    // Find categorization for this stimulus
    const category = analysis.categorized_stimuli.find((cat: any) =>
      cat.stimuli.some((s: any) => s.id === stimulus.id)
    );
    
    // Find if this stimulus is part of a pattern
    const inPattern = analysis.patterns.some((pattern: any) =>
      pattern.evidence.includes(stimulus.content)
    );
    
    // Calculate importance based on analysis
    const importance = calculateStimulusImportance(
      stimulus,
      category,
      inPattern,
      analysis,
      attention
    );
    
    return {
      ...stimulus,
      category: category?.type || "uncategorized",
      importance,
      inPattern,
      processed: true,
      metadata: {
        ...stimulus.metadata,
        perceptionAnalysis: {
          category: category?.type,
          significance: category?.significance,
          inPattern,
        },
      },
    };
  });

  // Sort by importance
  enrichedStimuli.sort((a, b) => b.importance - a.importance);
  
  // If attention is focused, limit to top items
  if (attention?.mode === "focused") {
    return enrichedStimuli.slice(0, 5);
  }
  
  return enrichedStimuli;
}

function calculateStimulusImportance(
  stimulus: any,
  category: any,
  inPattern: boolean,
  analysis: any,
  attention: any
): number {
  let importance = 0.5; // Base importance
  
  // Category significance
  if (category) {
    importance += category.significance * 0.3;
  }
  
  // Pattern membership
  if (inPattern) {
    importance += 0.2;
  }
  
  // Anomaly detection
  const isAnomaly = analysis.anomalies.some((a: any) => 
    a.description.includes(stimulus.content)
  );
  if (isAnomaly) {
    importance += 0.3;
  }
  
  // Social stimuli get bonus
  if (stimulus.type === "speech" || category?.type === "social") {
    importance += 0.2;
  }
  
  // Attention focus alignment
  if (attention?.focus_stack[0]) {
    const focus = attention.focus_stack[0];
    if (stimulus.content.includes(focus.target) || 
        stimulus.source === focus.metadata?.source) {
      importance += 0.3;
    }
  }
  
  return Math.min(importance, 1.0);
}

function createPerceptionEntries(world: World, eid: number, analysis: any) {
  if (!hasComponent(world, eid, Thought)) return;
  
  const thoughtEntries = Thought.entries[eid] || [];
  const lastId = Thought.lastEntryId[eid] || 0;
  
  // Create main perception entry
  const mainEntry: ThoughtEntry = {
    id: lastId + 1,
    timestamp: Date.now(),
    type: "perception",
    content: analysis.summary,
    context: {
      roomId: getAgentRoom(world, eid),
      metadata: {
        categories: analysis.categorized_stimuli.map((c: any) => c.type),
        patterns: analysis.patterns,
        changes: analysis.changes,
        anomalies: analysis.anomalies,
      },
    },
  };
  
  // Create entries for significant patterns
  const patternEntries = analysis.patterns
    .filter((p: any) => p.confidence > 0.7)
    .map((pattern: any, index: number): ThoughtEntry => ({
      id: lastId + 2 + index,
      timestamp: Date.now() + index,
      type: "perception",
      content: `Pattern detected: ${pattern.description}`,
      context: {
        roomId: getAgentRoom(world, eid),
        metadata: {
          patternType: pattern.type,
          confidence: pattern.confidence,
          evidence: pattern.evidence,
        },
      },
    }));
  
  // Update thought component
  const allEntries = [...thoughtEntries, mainEntry, ...patternEntries];
  setComponent(world, eid, Thought, {
    entries: allEntries.slice(-100), // Keep last 100
    lastEntryId: lastId + 1 + patternEntries.length,
    lastUpdate: Date.now(),
  });
}

function updateWorkingMemoryWithPerceptions(world: World, eid: number, analysis: any) {
  if (!hasComponent(world, eid, WorkingMemory)) return;
  
  const workingMemoryItems = WorkingMemory.items[eid] || [];
  const workingMemoryCapacity = WorkingMemory.capacity[eid] || 20;
  const newItems: any[] = [];
  
  // Add high-confidence patterns
  analysis.patterns
    .filter((p: any) => p.confidence > 0.7)
    .forEach((pattern: any) => {
      newItems.push({
        type: "perception" as const,
        content: `Pattern: ${pattern.description}`,
        timestamp: Date.now(),
        importance: pattern.confidence,
        source: "perception",
      });
    });
  
  // Add significant changes
  analysis.changes
    .filter((c: any) => c.significance > 0.6)
    .forEach((change: any) => {
      newItems.push({
        type: "perception" as const,
        content: `Change: ${change.description}`,
        timestamp: Date.now(),
        importance: change.significance,
        source: "perception",
      });
    });
  
  // Add anomalies
  analysis.anomalies.forEach((anomaly: any) => {
    newItems.push({
      type: "perception" as const,
      content: `Anomaly: ${anomaly.description}`,
      timestamp: Date.now(),
      importance: 0.8,
      source: "perception",
    });
  });
  
  // Update working memory
  WorkingMemory.items[eid] = [...workingMemoryItems, ...newItems]
    .sort((a: any, b: any) => b.importance - a.importance)
    .slice(0, workingMemoryCapacity);
}