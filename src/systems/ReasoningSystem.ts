import { World, query, hasComponent, setComponent } from "bitecs";
import { Agent, ReasoningContext, Perception, Goal, Plan, WorkingMemory, Thought } from "../components";
import { createSystem } from "./System";
import { processConcurrentAgents } from "../utils/system-utils";
import { logger } from "../utils/logger";
import { getActivePlans } from "../components/Plans";
import { getRoomInfo } from "../utils/queries";
import { generateStructuredReasoning } from "../llm/reasoning-llm";
import type { ReasoningStage } from "../components/ReasoningContext";

/**
 * ReasoningSystem - Implements multi-stage reasoning for agents
 * 
 * This system processes agents through structured reasoning stages:
 * 1. Perception Analysis - Understanding what's happening
 * 2. Situation Assessment - Evaluating context and relevance
 * 3. Goal Alignment - Checking against objectives
 * 4. Option Generation - Considering possible actions
 * 5. Evaluation - Analyzing trade-offs
 * 6. Decision - Selecting best option
 * 7. Meta Reflection - Learning from the process
 */
export const ReasoningSystem = createSystem(
  (runtime) => async (world: World) => {
    // Query for agents that need reasoning
    const agents = query(world, [Agent, ReasoningContext, Perception, Goal, Plan, WorkingMemory]);

    await processConcurrentAgents(
      world,
      agents,
      "ReasoningSystem",
      async (eid) => {
        if (!Agent.active[eid]) return;

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

        const startTime = Date.now();
        const roomInfo = getRoomInfo(world, eid);
        
        // Get current context
        const perceptionData = Perception.currentStimuli[eid] || [];
        const workingMemoryData = WorkingMemory.items[eid] || [];
        const currentGoals = Goal.current[eid] || [];
        const activePlans = getActivePlans(Plan.plans[eid] || []);
        const thoughtEntries = Thought.entries[eid] || [];
        
        // Determine reasoning mode based on context
        const reasoningMode = determineReasoningMode(
          perceptionData.length,
          currentGoals.length,
          Date.now() - ReasoningContext.last_deep_reasoning[eid]
        );

        // Update reasoning mode
        // Update reasoning mode
        ReasoningContext.mode[eid] = reasoningMode;

        // Process through reasoning stages
        const reasoningChain: ReasoningStage[] = [];

        // Stage 1: Perception Analysis
        const perceptionAnalysis = await processPerceptionAnalysis(
          eid,
          perceptionData,
          workingMemoryData,
          runtime
        );
        reasoningChain.push(perceptionAnalysis);

        // Stage 2: Situation Assessment
        const situationAssessment = await processSituationAssessment(
          eid,
          perceptionAnalysis,
          roomInfo,
          thoughtEntries,
          runtime
        );
        reasoningChain.push(situationAssessment);

        // Stage 3: Goal Alignment
        const goalAlignment = await processGoalAlignment(
          eid,
          situationAssessment,
          currentGoals,
          activePlans,
          runtime
        );
        reasoningChain.push(goalAlignment);

        // Only continue to action stages if needed
        if (reasoningMode !== "reflective" || goalAlignment.confidence < 0.7) {
          // Stage 4: Option Generation
          const options = await generateOptions(
            eid,
            goalAlignment,
            runtime.getActionManager().getEntityTools(eid).map((t: any) => t.name),
            runtime
          );
          reasoningChain.push(options);

          // Stage 5: Evaluation
          const evaluation = await evaluateOptions(
            eid,
            options,
            currentGoals,
            runtime
          );
          reasoningChain.push(evaluation);

          // Stage 6: Decision
          const decision = await makeDecision(
            eid,
            evaluation,
            runtime
          );
          reasoningChain.push(decision);
        }

        // Stage 7: Meta Reflection (if enough time has passed)
        if (reasoningMode === "reflective" || reasoningChain.length >= 5) {
          const metaReflection = await processMetaReflection(
            eid,
            reasoningChain,
            runtime
          );
          reasoningChain.push(metaReflection);
        }

        // Update ReasoningContext with the new chain
        const timeSpent = Date.now() - startTime;
        updateReasoningContext(world, eid, reasoningChain, timeSpent, reasoningMode);

        // Update WorkingMemory with key insights
        updateWorkingMemoryWithInsights(world, eid, reasoningChain);

        // Emit reasoning event
        runtime.eventBus.emitAgentEvent(eid, "reasoning", "complete", {
          mode: reasoningMode,
          stages: reasoningChain.length,
          timeSpent,
          decision: reasoningChain.find(s => s.stage === "decision")?.content,
        });

        logger.debug(`Reasoning complete for agent ${Agent.name[eid]}`, {
          mode: reasoningMode,
          stages: reasoningChain.length,
          timeSpent,
        });

        return {
          reasoningComplete: true,
          stagesProcessed: reasoningChain.length,
          mode: reasoningMode,
        };
      }
    );

    return world;
  }
);

// Helper functions

function determineReasoningMode(
  stimuliCount: number,
  goalCount: number,
  timeSinceDeepReasoning: number
): "reactive" | "deliberative" | "exploratory" | "reflective" {
  // Reflective mode if it's been a while
  if (timeSinceDeepReasoning > 300000) return "reflective"; // 5 minutes
  
  // Exploratory if few goals
  if (goalCount < 2) return "exploratory";
  
  // Deliberative if complex situation
  if (stimuliCount > 5 || goalCount > 3) return "deliberative";
  
  // Default to reactive
  return "reactive";
}

async function processPerceptionAnalysis(
  eid: number,
  perceptions: any[],
  workingMemory: any[],
  runtime: any
): Promise<ReasoningStage> {
  const analysis = await generateStructuredReasoning(
    eid,
    "perception_analysis",
    {
      perceptions,
      workingMemory,
      prompt: "Analyze current perceptions and identify key information"
    },
    runtime
  );

  return {
    stage: "perception_analysis",
    content: analysis.content,
    confidence: analysis.confidence || 0.8,
    timestamp: Date.now(),
    supporting_evidence: analysis.evidence,
  };
}

async function processSituationAssessment(
  eid: number,
  perceptionAnalysis: ReasoningStage,
  roomInfo: any,
  thoughtHistory: any[],
  runtime: any
): Promise<ReasoningStage> {
  const assessment = await generateStructuredReasoning(
    eid,
    "situation_assessment",
    {
      perceptionAnalysis,
      roomInfo,
      thoughtHistory: thoughtHistory.slice(-5),
      prompt: "Assess the current situation and its implications"
    },
    runtime
  );

  return {
    stage: "situation_assessment",
    content: assessment.content,
    confidence: assessment.confidence || 0.8,
    timestamp: Date.now(),
    supporting_evidence: assessment.evidence,
  };
}

async function processGoalAlignment(
  eid: number,
  situationAssessment: ReasoningStage,
  goals: any[],
  plans: any[],
  runtime: any
): Promise<ReasoningStage> {
  const alignment = await generateStructuredReasoning(
    eid,
    "goal_alignment",
    {
      situationAssessment,
      goals,
      plans,
      prompt: "Analyze how the current situation relates to goals and plans"
    },
    runtime
  );

  return {
    stage: "goal_alignment",
    content: alignment.content,
    confidence: alignment.confidence || 0.8,
    timestamp: Date.now(),
    supporting_evidence: alignment.evidence,
  };
}

async function generateOptions(
  eid: number,
  goalAlignment: ReasoningStage,
  availableTools: string[],
  runtime: any
): Promise<ReasoningStage> {
  const options = await generateStructuredReasoning(
    eid,
    "option_generation",
    {
      goalAlignment,
      availableTools,
      prompt: "Generate possible actions to take, including creative alternatives"
    },
    runtime
  );

  return {
    stage: "option_generation",
    content: options.content,
    confidence: options.confidence || 0.7,
    timestamp: Date.now(),
    alternatives_considered: options.alternatives,
  };
}

async function evaluateOptions(
  eid: number,
  options: ReasoningStage,
  goals: any[],
  runtime: any
): Promise<ReasoningStage> {
  const evaluation = await generateStructuredReasoning(
    eid,
    "evaluation",
    {
      options,
      goals,
      prompt: "Evaluate each option considering goals, risks, and benefits"
    },
    runtime
  );

  return {
    stage: "evaluation",
    content: evaluation.content,
    confidence: evaluation.confidence || 0.8,
    timestamp: Date.now(),
    supporting_evidence: evaluation.evidence,
  };
}

async function makeDecision(
  eid: number,
  evaluation: ReasoningStage,
  runtime: any
): Promise<ReasoningStage> {
  const decision = await generateStructuredReasoning(
    eid,
    "decision",
    {
      evaluation,
      prompt: "Make a decision based on the evaluation"
    },
    runtime
  );

  return {
    stage: "decision",
    content: decision.content,
    confidence: decision.confidence || 0.9,
    timestamp: Date.now(),
    supporting_evidence: decision.evidence,
  };
}

async function processMetaReflection(
  eid: number,
  reasoningChain: ReasoningStage[],
  runtime: any
): Promise<ReasoningStage> {
  const reflection = await generateStructuredReasoning(
    eid,
    "meta_reflection",
    {
      reasoningChain,
      prompt: "Reflect on the reasoning process and identify improvements"
    },
    runtime
  );

  return {
    stage: "meta_reflection",
    content: reflection.content,
    confidence: reflection.confidence || 0.9,
    timestamp: Date.now(),
    supporting_evidence: reflection.evidence,
  };
}

function updateReasoningContext(
  world: World,
  eid: number,
  chain: ReasoningStage[],
  timeSpent: number,
  mode: string
) {
  const context = getComponent(world, eid, ReasoningContext);
  if (!context) return;

  // Update current chain
  context.current_chain = chain;
  context.time_spent_reasoning += timeSpent;
  
  if (mode === "reflective" || mode === "deliberative") {
    context.last_deep_reasoning = Date.now();
  }

  // Add to reasoning threads if significant
  if (chain.length >= 5) {
    const thread = {
      id: `thread_${Date.now()}`,
      topic: chain[0].content.substring(0, 50),
      stages: chain,
      status: "concluded" as const,
      created_at: chain[0].timestamp,
      updated_at: Date.now(),
    };
    context.reasoning_threads.push(thread);
    
    // Keep only last 10 threads
    if (context.reasoning_threads.length > 10) {
      context.reasoning_threads = context.reasoning_threads.slice(-10);
    }
  }

  // Already handled above
}

function calculateReasoningQuality(chain: ReasoningStage[]): any {
  const avgConfidence = chain.reduce((sum, s) => sum + s.confidence, 0) / chain.length;
  
  return {
    coherence: avgConfidence,
    goal_alignment: chain.find(s => s.stage === "goal_alignment")?.confidence || 0.5,
    novelty: chain.find(s => s.stage === "option_generation")?.alternatives_considered?.length ? 0.8 : 0.3,
    depth: Math.min(chain.length / 7, 1),
    effectiveness: undefined, // Will be set after action results
  };
}

function updateWorkingMemoryWithInsights(
  world: World,
  eid: number,
  chain: ReasoningStage[]
) {
  const insights = chain
    .filter(s => s.confidence > 0.8)
    .map(s => ({
      type: "reasoning_insight" as const,
      content: s.content,
      timestamp: s.timestamp,
      importance: s.confidence,
      source: s.stage,
    }));

  if (insights.length > 0) {
    const workingMemory = getComponent(world, eid, WorkingMemory);
    if (workingMemory) {
      workingMemory.items = [...workingMemory.items, ...insights].slice(-20);
      setComponent(world, eid, WorkingMemory, workingMemory);
    }
  }
}