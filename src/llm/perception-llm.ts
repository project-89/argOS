import { z } from "zod";
import { generateObject } from "ai";
import { generateWithRetry } from "./llm-utils";
import { Agent } from "../components";
import { logger } from "../utils/logger";
import { composeFromTemplate } from "./agent-llm";
import { STRUCTURED_PERCEPTION_PROMPT } from "../templates/perception-prompt";
import { gemini25Flash } from "../config/ai-config";

// Schema for categorized stimuli
const CategorizedStimuliSchema = z.object({
  type: z.enum(["social", "environmental", "action", "informational", "emotional", "novel"]),
  stimuli: z.array(z.object({
    id: z.string(),
    content: z.string(),
  })),
  significance: z.number().min(0).max(1).describe("Significance of this category (0-1)"),
  interpretation: z.string().describe("What this category of stimuli means"),
});

// Schema for detected patterns
const PatternSchema = z.object({
  type: z.enum(["temporal", "causal", "social", "behavioral", "environmental"]),
  description: z.string().describe("Description of the pattern"),
  confidence: z.number().min(0).max(1).describe("Confidence in this pattern (0-1)"),
  evidence: z.array(z.string()).describe("Evidence supporting this pattern"),
});

// Schema for changes
const ChangeSchema = z.object({
  type: z.enum(["new", "missing", "altered", "intensified", "diminished"]),
  description: z.string().describe("What changed"),
  from: z.string().optional().describe("Previous state"),
  to: z.string().optional().describe("New state"),
  significance: z.number().min(0).max(1).describe("How significant this change is"),
});

// Schema for anomalies
const AnomalySchema = z.object({
  description: z.string().describe("Description of the anomaly"),
  unusualness: z.number().min(0).max(1).describe("How unusual this is (0-1)"),
  possible_explanations: z.array(z.string()).describe("Possible explanations"),
});

// Main perception analysis schema
const PerceptionAnalysisSchema = z.object({
  summary: z.string().describe("High-level summary of what is perceived"),
  
  categorized_stimuli: z.array(CategorizedStimuliSchema)
    .describe("Stimuli organized by category"),
  
  patterns: z.array(PatternSchema)
    .describe("Patterns detected across stimuli"),
  
  changes: z.array(ChangeSchema)
    .describe("Changes from previous perceptions"),
  
  anomalies: z.array(AnomalySchema)
    .describe("Unusual or unexpected perceptions"),
  
  focus_recommendation: z.object({
    primary: z.string().describe("What to focus on primarily"),
    secondary: z.array(z.string()).describe("Secondary focus areas"),
    ignore: z.array(z.string()).describe("What can be safely ignored"),
  }).describe("Recommendations for attention focus"),
  
  emotional_tone: z.enum(["positive", "negative", "neutral", "mixed", "tense", "relaxed"])
    .describe("Overall emotional tone of the environment"),
  
  urgency_level: z.number().min(0).max(1)
    .describe("Overall urgency level of the situation (0-1)"),
});

type PerceptionAnalysisOutput = z.infer<typeof PerceptionAnalysisSchema>;

export async function generateStructuredPerception(
  context: {
    agentId: string;
    name: string;
    role: string;
    stimuli: any[];
    workingMemory: any[];
    recentPerceptions: any[];
    attentionMode?: string;
    attentionFocus?: any;
  },
  runtime: any
): Promise<PerceptionAnalysisOutput> {
  // Prepare stimuli for analysis
  const stimuliForAnalysis = context.stimuli.map(s => ({
    id: s.id || `stim_${Date.now()}_${Math.random()}`,
    type: s.type,
    content: s.content,
    source: s.source,
    timestamp: s.timestamp,
    age: Date.now() - s.timestamp,
  }));

  const prompt = composeFromTemplate(STRUCTURED_PERCEPTION_PROMPT, {
    name: context.name,
    role: context.role,
    stimuli: JSON.stringify(stimuliForAnalysis, null, 2),
    workingMemory: context.workingMemory.slice(-10).map(m => m.content).join("\n"),
    recentPerceptions: context.recentPerceptions.map(p => p.content).join("\n"),
    attentionMode: context.attentionMode || "scanning",
    attentionFocus: context.attentionFocus?.target || "none",
  });

  const systemPrompt = `You are ${context.name}, ${context.role}.

You are analyzing sensory stimuli to understand your environment. Your task is to:
1. Categorize stimuli by type and significance
2. Detect patterns across multiple stimuli
3. Identify changes from previous perceptions
4. Spot anomalies or unusual occurrences
5. Recommend what deserves attention

Consider your current attention mode (${context.attentionMode || "scanning"}) when analyzing.
Be specific and analytical, not just descriptive.`;

  try {
    const result = await generateWithRetry(
      async () => {
        const { object } = await generateObject({
          model: gemini25Flash,
          system: systemPrompt,
          prompt,
          schema: PerceptionAnalysisSchema,
          temperature: 0.6,
        });

        return object;
      },
      {
        maxRetries: 2,
        delay: 1000,
        onError: (error, attempt) => {
          logger.error(`Perception analysis attempt ${attempt} failed:`, error);
        },
      }
    );

    logger.debug(`Generated structured perception for ${context.name}`, {
      categories: result.categorized_stimuli.length,
      patterns: result.patterns.length,
      changes: result.changes.length,
      anomalies: result.anomalies.length,
      urgency: result.urgency_level,
    });

    return result;
  } catch (error) {
    logger.error(`Failed to generate structured perception:`, error);
    
    // Return basic analysis on failure
    return {
      summary: "Basic perception of environment",
      categorized_stimuli: [{
        type: "environmental",
        stimuli: stimuliForAnalysis.slice(0, 3),
        significance: 0.5,
        interpretation: "General environmental stimuli",
      }],
      patterns: [],
      changes: [],
      anomalies: [],
      focus_recommendation: {
        primary: "General awareness",
        secondary: [],
        ignore: [],
      },
      emotional_tone: "neutral",
      urgency_level: 0.3,
    };
  }
}