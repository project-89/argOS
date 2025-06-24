import { z } from "zod";
import { createComponent } from "./index";

// Schema for a single reasoning stage
const ReasoningStageSchema = z.object({
  stage: z.enum([
    "perception_analysis",
    "situation_assessment", 
    "goal_alignment",
    "option_generation",
    "evaluation",
    "decision",
    "meta_reflection"
  ]),
  content: z.string(),
  confidence: z.number().min(0).max(1),
  timestamp: z.number(),
  supporting_evidence: z.array(z.string()).optional(),
  alternatives_considered: z.array(z.string()).optional(),
});

// Schema for reasoning quality metrics
const ReasoningQualitySchema = z.object({
  coherence: z.number().min(0).max(1), // How well thoughts connect
  goal_alignment: z.number().min(0).max(1), // How well aligned with goals
  novelty: z.number().min(0).max(1), // How creative/novel the reasoning
  depth: z.number().min(0).max(1), // How deep the analysis
  effectiveness: z.number().min(0).max(1).optional(), // Measured after action
});

// Main schema for ReasoningContext component
const ReasoningContextSchema = z.object({
  // Current reasoning chain
  current_chain: z.array(ReasoningStageSchema),
  
  // Active reasoning threads (for tracking multiple lines of thought)
  reasoning_threads: z.array(z.object({
    id: z.string(),
    topic: z.string(),
    stages: z.array(ReasoningStageSchema),
    status: z.enum(["active", "suspended", "concluded"]),
    created_at: z.number(),
    updated_at: z.number(),
  })),
  
  // Quality metrics for recent reasoning
  quality_history: z.array(z.object({
    timestamp: z.number(),
    chain_id: z.string(),
    metrics: ReasoningQualitySchema,
    outcome: z.enum(["successful", "failed", "pending"]).optional(),
  })),
  
  // Meta-cognitive observations
  meta_observations: z.array(z.object({
    observation: z.string(),
    timestamp: z.number(),
    impact: z.enum(["high", "medium", "low"]),
  })),
  
  // Current reasoning mode
  mode: z.enum([
    "reactive", // Quick responses to immediate stimuli
    "deliberative", // Careful planning and analysis
    "exploratory", // Curious exploration and learning
    "reflective", // Deep introspection and learning from past
  ]),
  
  // Reasoning depth control
  min_stages_required: z.number().min(1).max(7),
  time_spent_reasoning: z.number(),
  last_deep_reasoning: z.number(),
});

export const ReasoningContextComponent = createComponent(
  "ReasoningContext",
  ReasoningContextSchema,
  {
    current_chain: [],
    reasoning_threads: [],
    quality_history: [],
    meta_observations: [],
    mode: [],
    min_stages_required: [],
    time_spent_reasoning: [],
    last_deep_reasoning: [],
  }
);

export const ReasoningContext = ReasoningContextComponent.component;

export type ReasoningStage = z.infer<typeof ReasoningStageSchema>;
export type ReasoningQuality = z.infer<typeof ReasoningQualitySchema>;
export type ReasoningContextType = z.infer<typeof ReasoningContextSchema>;