import { World, query, setComponent, hasComponent } from "bitecs";
import { Agent, ReasoningContext, Thought, Goal, Action, WorkingMemory } from "../components";
import { createSystem } from "./System";
import { processConcurrentAgents } from "../utils/system-utils";
import { logger } from "../utils/logger";
import { generateMetaCognition } from "../llm/metacognition-llm";
import type { ThoughtEntry } from "../components/Thought";

/**
 * MetaCognitionSystem - Monitors and evaluates agent's own thinking processes
 * 
 * This system:
 * 1. Evaluates reasoning quality over time
 * 2. Detects cognitive patterns and biases
 * 3. Identifies areas for improvement
 * 4. Adjusts reasoning strategies based on effectiveness
 * 5. Maintains meta-cognitive observations
 */
export const MetaCognitionSystem = createSystem(
  (runtime) => async (world: World) => {
    // Query for agents with reasoning context
    const agents = query(world, [Agent, ReasoningContext, Thought, Goal, Action]);

    await processConcurrentAgents(
      world,
      agents,
      "MetaCognitionSystem",
      async (eid) => {
        if (!Agent.active[eid]) return;

        if (!hasComponent(world, eid, ReasoningContext)) return;
        
        const reasoningContext = {
          current_chain: ReasoningContext.current_chain[eid] || [],
          reasoning_threads: ReasoningContext.reasoning_threads[eid] || [],
          quality_history: ReasoningContext.quality_history[eid] || [],
          meta_observations: ReasoningContext.meta_observations[eid] || [],
          mode: ReasoningContext.mode[eid] || "reactive",
          min_stages_required: ReasoningContext.min_stages_required[eid] || 3,
          time_spent_reasoning: ReasoningContext.time_spent_reasoning[eid] || 0,
          last_deep_reasoning: ReasoningContext.last_deep_reasoning[eid] || Date.now(),
        };

        // Check if it's time for meta-cognitive evaluation
        const timeSinceLastEvaluation = Date.now() - (reasoningContext.last_deep_reasoning || 0);
        const recentQualityHistory = reasoningContext.quality_history.slice(-5);
        
        // Evaluate if we need meta-cognition
        if (!shouldRunMetaCognition(timeSinceLastEvaluation, recentQualityHistory, reasoningContext)) {
          return { skipped: true };
        }

        try {
          // Gather cognitive data for analysis
          const cognitiveData = gatherCognitiveData(world, eid);
          
          // Generate meta-cognitive analysis
          const metaAnalysis = await generateMetaCognition({
            agentId: String(eid),
            name: Agent.name[eid],
            role: Agent.role[eid],
            reasoningHistory: cognitiveData.reasoningHistory,
            thoughtPatterns: cognitiveData.thoughtPatterns,
            actionPatterns: cognitiveData.actionPatterns,
            goalProgress: cognitiveData.goalProgress,
            qualityMetrics: cognitiveData.qualityMetrics,
            recentObservations: reasoningContext.meta_observations.slice(-5),
          }, runtime);

          // Process meta-cognitive insights
          processMetaInsights(world, eid, metaAnalysis);
          
          // Adjust cognitive strategies based on analysis
          adjustCognitiveStrategies(world, eid, metaAnalysis);
          
          // Update meta-observations
          updateMetaObservations(world, eid, metaAnalysis);
          
          // Emit meta-cognition event
          runtime.eventBus.emitAgentEvent(eid, "meta_cognition", "complete", {
            insights: metaAnalysis.insights,
            adjustments: metaAnalysis.adjustments,
            effectiveness: metaAnalysis.effectiveness_score,
          });

          logger.debug(`Meta-cognition complete for agent ${Agent.name[eid]}`, {
            insightCount: metaAnalysis.insights.length,
            effectiveness: metaAnalysis.effectiveness_score,
          });

          return {
            complete: true,
            insights: metaAnalysis.insights.length,
            adjustments: metaAnalysis.adjustments.length,
          };
        } catch (error) {
          logger.error(`Meta-cognition error for agent ${Agent.name[eid]}:`, error);
          return { error: true };
        }
      }
    );

    return world;
  }
);

// Helper functions

function shouldRunMetaCognition(
  timeSinceLastEvaluation: number,
  recentQuality: any[],
  context: any
): boolean {
  // Run if it's been more than 10 minutes
  if (timeSinceLastEvaluation > 600000) return true;
  
  // Run if quality has been consistently low
  const avgQuality = recentQuality.reduce((sum, q) => 
    sum + (q.metrics.coherence + q.metrics.goal_alignment + q.metrics.depth) / 3, 0
  ) / Math.max(recentQuality.length, 1);
  
  if (avgQuality < 0.5 && recentQuality.length >= 3) return true;
  
  // Run if there are many unresolved observations
  if (context.meta_observations.filter((o: any) => o.impact === "high").length > 3) return true;
  
  return false;
}

function gatherCognitiveData(world: World, eid: number): any {
  const thoughtEntries = (Thought.entries[eid] || []) as ThoughtEntry[];
  const reasoningContext = {
    current_chain: ReasoningContext.current_chain[eid] || [],
    reasoning_threads: ReasoningContext.reasoning_threads[eid] || [],
    quality_history: ReasoningContext.quality_history[eid] || [],
    meta_observations: ReasoningContext.meta_observations[eid] || [],
    mode: ReasoningContext.mode[eid] || "reactive",
    min_stages_required: ReasoningContext.min_stages_required[eid] || 3,
    time_spent_reasoning: ReasoningContext.time_spent_reasoning[eid] || 0,
    last_deep_reasoning: ReasoningContext.last_deep_reasoning[eid] || Date.now(),
  };
  const goals = Goal.current[eid] || [];
  const completedGoals = Goal.completed[eid] || [];
  
  // Analyze thought patterns
  const thoughtPatterns = analyzeThoughtPatterns(thoughtEntries);
  
  // Analyze action patterns
  const actionPatterns = analyzeActionPatterns(thoughtEntries);
  
  // Calculate goal progress
  const goalProgress = calculateGoalProgress(goals, completedGoals);
  
  // Extract quality metrics
  const qualityMetrics = extractQualityMetrics(reasoningContext.quality_history);
  
  // Get reasoning history
  const reasoningHistory = reasoningContext.reasoning_threads
    .slice(-10)
    .map(thread => ({
      topic: thread.topic,
      stages: thread.stages.length,
      status: thread.status,
      avgConfidence: thread.stages.reduce((sum, s) => sum + s.confidence, 0) / thread.stages.length,
    }));

  return {
    thoughtPatterns,
    actionPatterns,
    goalProgress,
    qualityMetrics,
    reasoningHistory,
  };
}

function analyzeThoughtPatterns(thoughts: ThoughtEntry[]): any {
  const recentThoughts = thoughts.slice(-50);
  
  // Detect repetitive thinking
  const thoughtContents = recentThoughts.map(t => t.content);
  const uniqueThoughts = new Set(thoughtContents);
  const repetitionRatio = 1 - (uniqueThoughts.size / thoughtContents.length);
  
  // Analyze thought types
  const typeDistribution: Record<string, number> = {};
  recentThoughts.forEach(t => {
    typeDistribution[t.type] = (typeDistribution[t.type] || 0) + 1;
  });
  
  // Detect circular patterns
  const circularPatterns = detectCircularPatterns(thoughtContents);
  
  return {
    repetitionRatio,
    typeDistribution,
    circularPatterns,
    diversityScore: uniqueThoughts.size / Math.max(thoughtContents.length, 1),
  };
}

function analyzeActionPatterns(thoughts: ThoughtEntry[]): any {
  const actions = thoughts
    .filter(t => t.context?.metadata?.action)
    .map(t => t.context!.metadata!.action);
  
  // Action frequency
  const actionFrequency: Record<string, number> = {};
  actions.forEach(a => {
    actionFrequency[a.tool] = (actionFrequency[a.tool] || 0) + 1;
  });
  
  // Wait ratio
  const waitRatio = (actionFrequency.wait || 0) / Math.max(actions.length, 1);
  
  // Action diversity
  const uniqueActions = Object.keys(actionFrequency).length;
  
  return {
    actionFrequency,
    waitRatio,
    actionDiversity: uniqueActions,
    totalActions: actions.length,
  };
}

function calculateGoalProgress(current: any[], completed: any[]): any {
  const totalGoals = current.length + completed.length;
  const completionRate = completed.length / Math.max(totalGoals, 1);
  
  const progressByType: Record<string, number> = {};
  current.forEach(g => {
    progressByType[g.type] = (progressByType[g.type] || 0) + (g.progress || 0);
  });
  
  return {
    completionRate,
    activeGoals: current.length,
    completedGoals: completed.length,
    progressByType,
  };
}

function extractQualityMetrics(history: any[]): any {
  if (history.length === 0) return { average: 0, trend: "stable" };
  
  const recent = history.slice(-10);
  const avgMetrics = {
    coherence: 0,
    goal_alignment: 0,
    novelty: 0,
    depth: 0,
  };
  
  recent.forEach(h => {
    avgMetrics.coherence += h.metrics.coherence || 0;
    avgMetrics.goal_alignment += h.metrics.goal_alignment || 0;
    avgMetrics.novelty += h.metrics.novelty || 0;
    avgMetrics.depth += h.metrics.depth || 0;
  });
  
  Object.keys(avgMetrics).forEach(key => {
    avgMetrics[key as keyof typeof avgMetrics] /= recent.length;
  });
  
  // Calculate trend
  const firstHalf = recent.slice(0, Math.floor(recent.length / 2));
  const secondHalf = recent.slice(Math.floor(recent.length / 2));
  
  const firstAvg = firstHalf.reduce((sum, h) => 
    sum + (h.metrics.coherence + h.metrics.goal_alignment + h.metrics.depth) / 3, 0
  ) / Math.max(firstHalf.length, 1);
  
  const secondAvg = secondHalf.reduce((sum, h) => 
    sum + (h.metrics.coherence + h.metrics.goal_alignment + h.metrics.depth) / 3, 0
  ) / Math.max(secondHalf.length, 1);
  
  const trend = secondAvg > firstAvg + 0.1 ? "improving" : 
                secondAvg < firstAvg - 0.1 ? "declining" : "stable";
  
  return {
    average: avgMetrics,
    trend,
  };
}

function detectCircularPatterns(thoughts: string[]): number {
  // Simple circular pattern detection
  let circularCount = 0;
  const windowSize = 5;
  
  for (let i = windowSize; i < thoughts.length; i++) {
    const current = thoughts[i];
    const window = thoughts.slice(i - windowSize, i);
    if (window.includes(current)) {
      circularCount++;
    }
  }
  
  return circularCount / Math.max(thoughts.length - windowSize, 1);
}

function processMetaInsights(world: World, eid: number, analysis: any) {
  if (!hasComponent(world, eid, WorkingMemory)) return;
  
  const workingMemoryItems = WorkingMemory.items[eid] || [];
  const workingMemoryCapacity = WorkingMemory.capacity[eid] || 20;
  
  // Add high-impact insights to working memory
  analysis.insights
    .filter((i: any) => i.importance > 0.7)
    .forEach((insight: any) => {
      const memoryItem = {
        type: "meta_insight" as const,
        content: insight.content,
        timestamp: Date.now(),
        importance: insight.importance,
        source: "meta_cognition",
      };
      
      const newItems = [...workingMemoryItems, memoryItem]
        .sort((a: any, b: any) => b.importance - a.importance)
        .slice(0, workingMemoryCapacity);
      
      WorkingMemory.items[eid] = newItems;
    });
}

function adjustCognitiveStrategies(world: World, eid: number, analysis: any) {
  if (!hasComponent(world, eid, ReasoningContext)) return;
  
  // Apply adjustments
  analysis.adjustments.forEach((adjustment: any) => {
    switch (adjustment.type) {
      case "reasoning_mode":
        ReasoningContext.mode[eid] = adjustment.value;
        break;
      case "min_stages":
        ReasoningContext.min_stages_required[eid] = adjustment.value;
        break;
      case "reset_patterns":
        // Clear repetitive patterns
        ReasoningContext.reasoning_threads[eid] = (ReasoningContext.reasoning_threads[eid] || []).slice(-5);
        break;
    }
  });
  
  // Component already updated via direct property access
}

function updateMetaObservations(world: World, eid: number, analysis: any) {
  if (!hasComponent(world, eid, ReasoningContext)) return;
  
  // Add new observations
  const newObservations = analysis.observations.map((obs: any) => ({
    observation: obs.content,
    timestamp: Date.now(),
    impact: obs.impact as "high" | "medium" | "low",
  }));
  
  const existingObservations = ReasoningContext.meta_observations[eid] || [];
  ReasoningContext.meta_observations[eid] = [
    ...existingObservations,
    ...newObservations,
  ].slice(-20); // Keep last 20 observations
}