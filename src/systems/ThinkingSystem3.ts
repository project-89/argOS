import { World, query, hasComponent, setComponent } from "bitecs";
import { 
  Agent, 
  Action, 
  Appearance, 
  Thought, 
  Goal, 
  Plan,
  WorkingMemory,
  ReasoningContext,
  Perception 
} from "../components";
import { generateThought } from "../llm/agent-llm";
import { logger } from "../utils/logger";
import { createSystem } from "./System";
import { processConcurrentAgents } from "../utils/system-utils";
import { ThoughtEntry } from "../components/Thought";
import { getActivePlans } from "../components/Plans";
import { getRoomInfo } from "../utils/queries";

/**
 * ThinkingSystem3 - Enhanced thinking system with proper working memory integration
 * and structured chain-of-thought reasoning
 */
export const ThinkingSystem3 = createSystem(
  (runtime) => async (world: World) => {
    // Query for agents with all required components including WorkingMemory and ReasoningContext
    const agents = query(world, [
      Agent,
      Action,
      Appearance,
      Thought,
      Goal,
      Plan,
      WorkingMemory,
      ReasoningContext,
    ]);

    await processConcurrentAgents(
      world,
      agents,
      "ThinkingSystem3",
      async (eid) => {
        if (!Agent.active[eid]) return;

        // Initialize components if needed
        initializeComponents(world, eid);

        // Get all context for reasoning
        const context = gatherReasoningContext(world, eid);
        
        // Determine if we should use the reasoning system first
        const shouldUseReasoningSystem = shouldEngageDeepReasoning(context);
        
        if (shouldUseReasoningSystem) {
          // Trigger the ReasoningSystem for deep analysis
          runtime.eventBus.emitAgentEvent(eid, "reasoning", "requested", {
            reason: "Complex situation requiring deep analysis",
          });
          
          // Skip regular thinking this cycle to let ReasoningSystem work
          return {
            thoughtSkipped: true,
            reason: "Delegated to ReasoningSystem",
          };
        }

        try {
          // Generate thought with enhanced context
          const thoughtResult = await generateThought({
            id: String(eid),
            name: Agent.name[eid],
            role: Agent.role[eid],
            systemPrompt: Agent.systemPrompt[eid],
            active: Boolean(Agent.active[eid]),
            platform: Agent.platform[eid],
            attention: Agent.attention[eid],
            
            // Enhanced context from working memory and reasoning
            reasoningMode: context.reasoningMode,
            reasoningChain: context.reasoningChain,
            workingMemory: context.workingMemory,
            previousInsights: context.previousInsights,
            
            // Standard context
            perceptions: context.perceptions,
            lastAction: Action.lastActionResult[eid],
            timeSinceLastAction: Action.lastActionTime[eid]
              ? Date.now() - Action.lastActionTime[eid]
              : 0,
            thoughtChain: context.thoughtChain,
            availableTools: runtime.getActionManager().getEntityTools(eid),
            goals: context.goals,
            completedGoals: Goal.completed[eid] || [],
            activePlans: context.activePlans,
            appearance: context.appearance,
          });

          // Process the thought result
          const thoughtEntry = createThoughtEntry(eid, thoughtResult, context);
          
          // Update components
          updateThoughtComponent(world, eid, thoughtEntry);
          updateWorkingMemory(world, eid, thoughtResult, thoughtEntry);
          updateReasoningQuality(world, eid, thoughtResult);
          
          // Handle action if present and decision is to act
          if (thoughtResult.action_decision?.should_act && thoughtResult.action) {
            setComponent(world, eid, Action, {
              pendingAction: thoughtResult.action,
              lastActionTime: Date.now(),
              availableTools: Action.availableTools[eid],
            });
          }

          // Update appearance if present
          if (thoughtResult.appearance) {
            updateAppearance(world, eid, thoughtResult.appearance);
          }

          // Emit enhanced thought event
          runtime.eventBus.emitAgentEvent(eid, "thought", "enhanced", {
            content: thoughtResult.thought,
            thoughtEntryId: thoughtEntry.id,
            hasAction: !!thoughtResult.action,
            reasoningQuality: thoughtResult.reasoning_quality,
            confidence: thoughtResult.confidence,
            shouldAct: thoughtResult.action_decision?.should_act,
          });

          logger.debug(`Enhanced thought generated for agent ${Agent.name[eid]}:`, {
            thoughtId: thoughtEntry.id,
            confidence: thoughtResult.confidence,
            reasoningDepth: thoughtResult.reasoning_quality?.depth,
            shouldAct: thoughtResult.action_decision?.should_act,
          });

          return {
            thoughtId: thoughtEntry.id,
            enhanced: true,
            confidence: thoughtResult.confidence,
          };
        } catch (error) {
          logger.error(
            `Error generating enhanced thought for agent ${Agent.name[eid]}:`,
            error
          );
          return { error: true };
        }
      }
    );

    return world;
  }
);

// Helper functions

function initializeComponents(world: World, eid: number) {
  // Initialize WorkingMemory if needed
  if (!hasComponent(world, eid, WorkingMemory)) {
    setComponent(world, eid, WorkingMemory, {
      items: [],
      capacity: 20,
    });
  }

  // Initialize ReasoningContext if needed
  if (!hasComponent(world, eid, ReasoningContext)) {
    setComponent(world, eid, ReasoningContext, {
      current_chain: [],
      reasoning_threads: [],
      quality_history: [],
      meta_observations: [],
      mode: "reactive",
      min_stages_required: 3,
      time_spent_reasoning: 0,
      last_deep_reasoning: Date.now(),
    });
  }

  // Initialize Thought if needed
  if (!hasComponent(world, eid, Thought)) {
    setComponent(world, eid, Thought, {
      entries: [],
      lastEntryId: 0,
      lastUpdate: Date.now(),
    });
  }
}

function gatherReasoningContext(world: World, eid: number): any {
  const roomInfo = getRoomInfo(world, eid);
  const thoughtEntries = (Thought.entries[eid] || []) as ThoughtEntry[];
  const workingMemory = hasComponent(world, eid, WorkingMemory) ? (WorkingMemory.items[eid] || []) : [];
  const reasoningContext = hasComponent(world, eid, ReasoningContext) ? {
    current_chain: ReasoningContext.current_chain[eid] || [],
    reasoning_threads: ReasoningContext.reasoning_threads[eid] || [],
    quality_history: ReasoningContext.quality_history[eid] || [],
    meta_observations: ReasoningContext.meta_observations[eid] || [],
    mode: ReasoningContext.mode[eid] || "reactive",
    min_stages_required: ReasoningContext.min_stages_required[eid] || 3,
    time_spent_reasoning: ReasoningContext.time_spent_reasoning[eid] || 0,
    last_deep_reasoning: ReasoningContext.last_deep_reasoning[eid] || Date.now(),
  } : null;
  const perceptionData = Perception.currentStimuli[eid] || [];

  // Extract recent reasoning chain
  const reasoningChain = reasoningContext?.current_chain.map(stage => ({
    stage: stage.stage,
    content: stage.content,
    confidence: stage.confidence,
  })) || [];

  // Extract previous insights from working memory
  const previousInsights = workingMemory
    .filter((item: any) => item.type === "reasoning_insight" || item.type === "observation")
    .slice(-5)
    .map((item: any) => ({
      type: item.type,
      content: item.content,
      importance: item.importance,
    }));

  // Build perceptions context
  const perceptions = {
    narrative: thoughtEntries
      .filter(entry => entry.type === "perception")
      .slice(-5)
      .map(entry => entry.content)
      .join("\n"),
    raw: perceptionData,
    count: perceptionData.length,
  };

  // Get goals and plans
  const goals = (Goal.current[eid] || []).map(goal => ({
    id: goal.id,
    description: goal.description,
    type: goal.type,
    priority: goal.priority,
    progress: goal.progress,
  }));

  const activePlans = getActivePlans(Plan.plans[eid] || []).map(plan => ({
    id: plan.id,
    goalId: plan.goalId,
    steps: plan.steps.map(step => ({
      description: step.description,
      status: step.status,
    })),
    currentStepId: plan.currentStepId,
  }));

  // Get thought chain with more context
  const thoughtChain = thoughtEntries.slice(-15).map(entry => ({
    type: entry.type,
    content: entry.content,
    timestamp: entry.timestamp,
    metadata: entry.context?.metadata,
  }));

  // Get appearance
  const appearance = {
    description: Appearance.baseDescription[eid],
    facialExpression: Appearance.facialExpression[eid],
    bodyLanguage: Appearance.bodyLanguage[eid],
    currentAction: Appearance.currentAction[eid],
    socialCues: Appearance.socialCues[eid],
  };

  return {
    reasoningMode: reasoningContext?.mode || "reactive",
    reasoningChain,
    workingMemory: workingMemory.map((item: any) => ({
      type: item.type,
      content: item.content,
      importance: item.importance,
      age: Date.now() - item.timestamp,
    })),
    previousInsights,
    perceptions,
    goals,
    activePlans,
    thoughtChain,
    appearance,
    roomInfo,
    stimuliCount: perceptionData.length,
  };
}

function shouldEngageDeepReasoning(context: any): boolean {
  // Decide if situation warrants deep reasoning
  
  // High stimulus count suggests complex situation
  if (context.stimuliCount > 5) return true;
  
  // Multiple active goals suggest need for prioritization
  if (context.goals.length > 3) return true;
  
  // Low confidence in recent reasoning
  const recentConfidence = context.reasoningChain
    .slice(-3)
    .reduce((sum: number, r: any) => sum + (r.confidence || 0), 0) / 3;
  if (recentConfidence < 0.6 && context.reasoningChain.length > 0) return true;
  
  // Been too long since deep reasoning
  const reasoningAge = Date.now() - (context.reasoningMode?.last_deep_reasoning || 0);
  if (reasoningAge > 300000) return true; // 5 minutes
  
  return false;
}

function createThoughtEntry(
  eid: number,
  thoughtResult: any,
  context: any
): ThoughtEntry {
  return {
    id: (Thought.lastEntryId[eid] || 0) + 1,
    timestamp: Date.now(),
    type: "thought",
    content: thoughtResult.thought,
    context: {
      roomId: context.roomInfo.id,
      metadata: {
        action: thoughtResult.action,
        appearance: thoughtResult.appearance,
        reasoning_process: thoughtResult.reasoning_process,
        confidence: thoughtResult.confidence,
        reasoning_quality: thoughtResult.reasoning_quality,
        action_decision: thoughtResult.action_decision,
        goals: context.goals,
        activePlans: context.activePlans,
      },
    },
  };
}

function updateThoughtComponent(world: World, eid: number, entry: ThoughtEntry) {
  const updatedEntries = [...(Thought.entries[eid] || []), entry];
  
  // Keep reasonable history (last 100 entries)
  const trimmedEntries = updatedEntries.slice(-100);
  
  setComponent(world, eid, Thought, {
    entries: trimmedEntries,
    lastEntryId: entry.id,
    lastUpdate: Date.now(),
  });
}

function updateWorkingMemory(
  world: World,
  eid: number,
  thoughtResult: any,
  thoughtEntry: ThoughtEntry
) {
  if (!hasComponent(world, eid, WorkingMemory)) return;
  
  const workingMemoryItems = WorkingMemory.items[eid] || [];
  const workingMemoryCapacity = WorkingMemory.capacity[eid] || 20;

  const newItems: any[] = [];

  // Add key insights from reasoning
  if (thoughtResult.reasoning_process?.key_insights) {
    thoughtResult.reasoning_process.key_insights.forEach((insight: string) => {
      newItems.push({
        type: "reasoning_insight",
        content: insight,
        timestamp: Date.now(),
        importance: 0.8,
        source: "thinking",
      });
    });
  }

  // Add important thoughts
  if (thoughtResult.confidence > 0.7) {
    newItems.push({
      type: "thought",
      content: thoughtResult.thought,
      timestamp: Date.now(),
      importance: thoughtResult.confidence,
      source: "thinking",
    });
  }

  // Add action decisions
  if (thoughtResult.action_decision?.should_act) {
    newItems.push({
      type: "decision",
      content: `Decided to ${thoughtResult.action.tool}: ${thoughtResult.action_decision.reasoning}`,
      timestamp: Date.now(),
      importance: 0.9,
      source: "thinking",
    });
  }

  // Update working memory with new items
  WorkingMemory.items[eid] = [...workingMemoryItems, ...newItems]
    .sort((a: any, b: any) => b.importance - a.importance)
    .slice(0, workingMemoryCapacity);
}

function updateReasoningQuality(world: World, eid: number, thoughtResult: any) {
  if (!thoughtResult.reasoning_quality) return;

  if (!hasComponent(world, eid, ReasoningContext)) return;

  // Add quality metrics to history
  const qualityEntry = {
    timestamp: Date.now(),
    chain_id: `thought_${Date.now()}`,
    metrics: {
      coherence: thoughtResult.reasoning_quality.coherence || 0.5,
      goal_alignment: thoughtResult.reasoning_quality.goal_alignment || 0.5,
      novelty: 0.5, // Could be calculated based on uniqueness
      depth: thoughtResult.reasoning_quality.depth || 0.5,
      effectiveness: undefined, // Will be determined after action
    },
    outcome: "pending" as const,
  };

  const existingHistory = ReasoningContext.quality_history[eid] || [];
  ReasoningContext.quality_history[eid] = [
    ...existingHistory,
    qualityEntry,
  ].slice(-20);

  // Update reasoning mode based on quality
  if (thoughtResult.reasoning_quality.depth > 0.7) {
    ReasoningContext.mode[eid] = "deliberative";
  }
}

function updateAppearance(world: World, eid: number, appearance: any) {
  if (!appearance) return;

  setComponent(world, eid, Appearance, {
    description: appearance.description || Appearance.description[eid],
    baseDescription: Appearance.baseDescription[eid],
    facialExpression: appearance.facialExpression || Appearance.facialExpression[eid],
    bodyLanguage: appearance.bodyLanguage || Appearance.bodyLanguage[eid],
    currentAction: appearance.currentAction || Appearance.currentAction[eid],
    socialCues: appearance.socialCues || Appearance.socialCues[eid],
    lastUpdate: Date.now(),
  });
}