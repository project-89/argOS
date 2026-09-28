import { z } from "zod";
import { generateObject } from "ai";
import { generateWithRetry } from "./llm-utils";
import { Agent } from "../components";
import { logger } from "../utils/logger";
import { composeFromTemplate } from "./agent-llm";
import { gemini25Flash } from "../config/ai-config";
import { 
  PERCEPTION_ANALYSIS_PROMPT,
  SITUATION_ASSESSMENT_PROMPT,
  GOAL_ALIGNMENT_PROMPT,
  OPTION_GENERATION_PROMPT,
  EVALUATION_PROMPT,
  DECISION_PROMPT,
  META_REFLECTION_PROMPT 
} from "../templates/reasoning-prompts";

// Schema for structured reasoning output
const StructuredReasoningSchema = z.object({
  content: z.string().describe("The main reasoning content for this stage"),
  confidence: z.number().min(0).max(1).describe("Confidence level in this reasoning (0-1)"),
  evidence: z.array(z.string()).optional().describe("Supporting evidence or observations"),
  alternatives: z.array(z.string()).optional().describe("Alternative options considered"),
  insights: z.array(z.string()).optional().describe("Key insights discovered"),
});

type StructuredReasoningOutput = z.infer<typeof StructuredReasoningSchema>;

// Prompt templates for each reasoning stage
const REASONING_PROMPTS = {
  perception_analysis: PERCEPTION_ANALYSIS_PROMPT,
  situation_assessment: SITUATION_ASSESSMENT_PROMPT,
  goal_alignment: GOAL_ALIGNMENT_PROMPT,
  option_generation: OPTION_GENERATION_PROMPT,
  evaluation: EVALUATION_PROMPT,
  decision: DECISION_PROMPT,
  meta_reflection: META_REFLECTION_PROMPT,
};

export async function generateStructuredReasoning(
  eid: number,
  stage: keyof typeof REASONING_PROMPTS,
  context: any,
  runtime: any
): Promise<StructuredReasoningOutput> {
  const promptTemplate = REASONING_PROMPTS[stage];
  
  if (!promptTemplate) {
    throw new Error(`Unknown reasoning stage: ${stage}`);
  }

  // Compose the prompt with context
  const prompt = composeFromTemplate(promptTemplate, {
    name: Agent.name[eid],
    role: Agent.role[eid],
    ...context,
  });

  const systemPrompt = `You are ${Agent.name[eid]}, ${Agent.role[eid]}.

You are currently in the ${stage} stage of reasoning. Think carefully and systematically.

Key guidelines:
1. Be specific and concrete in your analysis
2. Reference actual details from the context provided
3. Show your reasoning step by step
4. Consider multiple perspectives when relevant
5. Be honest about uncertainty (reflected in confidence score)
6. Generate insights that connect different pieces of information

${Agent.systemPrompt[eid]}`;

  try {
    const result = await generateWithRetry(
      async () => {
        const { object } = await generateObject({
          model: gemini25Flash,
          system: systemPrompt,
          prompt,
          schema: StructuredReasoningSchema,
          temperature: stage === "option_generation" ? 0.8 : 0.6,
        });

        return object;
      },
      {
        maxRetries: 2,
        delay: 1000,
        onError: (error, attempt) => {
          logger.error(`Reasoning generation attempt ${attempt} failed for ${stage}:`, error);
        },
      }
    );

    logger.debug(`Generated structured reasoning for ${Agent.name[eid]} - ${stage}`, {
      confidence: result.confidence,
      hasEvidence: !!result.evidence?.length,
      hasAlternatives: !!result.alternatives?.length,
      hasInsights: !!result.insights?.length,
    });

    return result;
  } catch (error) {
    logger.error(`Failed to generate structured reasoning for ${stage}:`, error);
    
    // Return a fallback response
    return {
      content: `Unable to complete ${stage} reasoning at this time.`,
      confidence: 0.1,
      evidence: [],
      alternatives: [],
      insights: [],
    };
  }
}