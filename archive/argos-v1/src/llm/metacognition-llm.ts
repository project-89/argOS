import { z } from "zod";
import { generateObject } from "ai";
import { generateWithRetry } from "./llm-utils";
import { Agent } from "../components";
import { logger } from "../utils/logger";
import { composeFromTemplate } from "./agent-llm";
import { META_COGNITION_PROMPT } from "../templates/meta-cognition-prompt";
import { gemini25Flash } from "../config/ai-config";

// Schema for meta-cognitive analysis
const MetaCognitionSchema = z.object({
  insights: z.array(z.object({
    content: z.string().describe("The meta-cognitive insight"),
    importance: z.number().min(0).max(1).describe("Importance of this insight (0-1)"),
    category: z.enum(["pattern", "bias", "improvement", "strategy", "effectiveness"]),
  })).describe("Key insights about cognitive processes"),
  
  observations: z.array(z.object({
    content: z.string().describe("Observation about thinking patterns"),
    impact: z.enum(["high", "medium", "low"]).describe("Impact on performance"),
  })).describe("Observations about cognitive behavior"),
  
  adjustments: z.array(z.object({
    type: z.enum(["reasoning_mode", "min_stages", "reset_patterns", "strategy"]),
    value: z.any().describe("The adjustment value"),
    rationale: z.string().describe("Why this adjustment is needed"),
  })).describe("Recommended cognitive adjustments"),
  
  effectiveness_score: z.number().min(0).max(1).describe("Overall cognitive effectiveness (0-1)"),
  
  cognitive_strengths: z.array(z.string()).describe("Identified cognitive strengths"),
  
  areas_for_improvement: z.array(z.string()).describe("Areas needing improvement"),
  
  self_assessment: z.string().describe("Overall self-assessment of cognitive performance"),
});

type MetaCognitionOutput = z.infer<typeof MetaCognitionSchema>;

export async function generateMetaCognition(
  context: {
    agentId: string;
    name: string;
    role: string;
    reasoningHistory: any[];
    thoughtPatterns: any;
    actionPatterns: any;
    goalProgress: any;
    qualityMetrics: any;
    recentObservations: any[];
  },
  runtime: any
): Promise<MetaCognitionOutput> {
  const prompt = composeFromTemplate(META_COGNITION_PROMPT, {
    name: context.name,
    role: context.role,
    reasoningHistory: JSON.stringify(context.reasoningHistory, null, 2),
    thoughtPatterns: JSON.stringify(context.thoughtPatterns, null, 2),
    actionPatterns: JSON.stringify(context.actionPatterns, null, 2),
    goalProgress: JSON.stringify(context.goalProgress, null, 2),
    qualityMetrics: JSON.stringify(context.qualityMetrics, null, 2),
    recentObservations: context.recentObservations.map(o => o.observation).join("\n"),
  });

  const systemPrompt = `You are ${context.name}, ${context.role}.

You are engaging in meta-cognition - thinking about your own thinking processes.

Your task is to:
1. Analyze your cognitive patterns objectively
2. Identify strengths and weaknesses in your reasoning
3. Detect any biases or repetitive patterns
4. Suggest improvements to your thinking strategies
5. Assess your overall cognitive effectiveness

Be honest and self-critical. The goal is continuous improvement of your cognitive abilities.`;

  try {
    const result = await generateWithRetry(
      async () => {
        const { object } = await generateObject({
          model: gemini25Flash,
          system: systemPrompt,
          prompt,
          schema: MetaCognitionSchema,
          temperature: 0.6,
        });

        return object;
      },
      {
        maxRetries: 2,
        delay: 1000,
        onError: (error, attempt) => {
          logger.error(`Meta-cognition attempt ${attempt} failed:`, error);
        },
      }
    );

    logger.debug(`Generated meta-cognition for ${context.name}`, {
      insights: result.insights.length,
      adjustments: result.adjustments.length,
      effectiveness: result.effectiveness_score,
    });

    return result;
  } catch (error) {
    logger.error(`Failed to generate meta-cognition:`, error);
    
    // Return a basic analysis on failure
    return {
      insights: [{
        content: "Unable to perform deep meta-cognitive analysis at this time",
        importance: 0.5,
        category: "pattern",
      }],
      observations: [],
      adjustments: [],
      effectiveness_score: 0.5,
      cognitive_strengths: ["Persistence"],
      areas_for_improvement: ["Meta-cognitive analysis"],
      self_assessment: "Meta-cognitive capabilities temporarily limited",
    };
  }
}