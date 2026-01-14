import { generateText, generateObject } from "ai";
import { google } from "@ai-sdk/google";
import { z } from 'zod/v3';

const model = google("gemini-2.5-flash");

/**
 * Extract first valid JSON object from text using balanced brace matching.
 */
function extractJSON(text: string): any {
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const startIdx = cleaned.indexOf('{');
  if (startIdx === -1) return null;

  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = startIdx; i < cleaned.length; i++) {
    const char = cleaned[i];
    if (escapeNext) { escapeNext = false; continue; }
    if (char === '\\' && inString) { escapeNext = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(cleaned.slice(startIdx, i + 1)); }
        catch { continue; }
      }
    }
  }
  return null;
}

export interface AIContext {
  generateText: (prompt: string, context?: string) => Promise<string>;
  decide: (options: string[], context: string) => Promise<{ choice: string; reasoningText: string }>;
  generate: <T>(schema: z.ZodType<T>, prompt: string, context?: string) => Promise<T>;
  describeEntity: (entityData: Record<string, any>) => Promise<string>;
  generateDialogue: (speaker: string, situation: string, personality: string) => Promise<string>;
  generateEvent: (worldState: string, theme?: string) => Promise<{ type: string; content: string; targets?: string[] }>;
}

export function createAIContext(): AIContext {
  return {
    async generateText(prompt: string, context?: string): Promise<string> {
      try {
        const { text } = await generateText({
          model,
          system: context || "You are a creative assistant for a simulation engine. Be concise and evocative.",
          prompt,
        });
        return text;
      } catch (error) {
        console.error("[AI] generateText error:", error);
        return "";
      }
    },

    async decide(options: string[], context: string): Promise<{ choice: string; reasoningText: string }> {
      try {
        const { text } = await generateText({
          model,
          system: "You are a decision-making assistant. Analyze the context and choose the best option. Respond with JSON: { \"choice\": \"selected option\", \"reasoning\": \"brief explanation\" }",
          prompt: `Context: ${context}\n\nOptions:\n${options.map((o, i) => `${i + 1}. ${o}`).join("\n")}\n\nChoose the most appropriate option.`,
        });
        
        const parsed = extractJSON(text);
        if (parsed) {
          return parsed;
        }
        return { choice: options[0], reasoningText: "Default choice" };
      } catch (error) {
        console.error("[AI] decide error:", error);
        return { choice: options[0], reasoningText: "Error fallback" };
      }
    },

    async generate<T>(schema: z.ZodType<T>, prompt: string, context?: string): Promise<T> {
      try {
        const { object } = await generateObject({
          model,
          schema,
          system: context || "Generate structured data for a simulation engine.",
          prompt,
        });
        return object;
      } catch (error) {
        console.error("[AI] generate error:", error);
        throw error;
      }
    },

    async describeEntity(entityData: Record<string, any>): Promise<string> {
      try {
        const { text } = await generateText({
          model,
          system: "You describe entities in a simulation concisely. One or two sentences max.",
          prompt: `Describe this entity based on its data:\n${JSON.stringify(entityData, null, 2)}`,
        });
        return text;
      } catch (error) {
        console.error("[AI] describeEntity error:", error);
        return "An enigmatic presence.";
      }
    },

    async generateDialogue(speaker: string, situation: string, personality: string): Promise<string> {
      try {
        const { text } = await generateText({
          model,
          system: `You generate dialogue for ${speaker}. Personality: ${personality}. Be concise - one or two sentences.`,
          prompt: `Situation: ${situation}\n\nWhat does ${speaker} say?`,
        });
        return text.replace(/^["']|["']$/g, "").trim();
      } catch (error) {
        console.error("[AI] generateDialogue error:", error);
        return "...";
      }
    },

    async generateEvent(worldState: string, theme?: string): Promise<{ type: string; content: string; targets?: string[] }> {
      try {
        const { text } = await generateText({
          model,
          system: "You generate narrative events for a simulation. Respond with JSON: { \"type\": \"environmental|social|dramatic|mysterious\", \"content\": \"event description\", \"targets\": [\"optional agent names\"] }",
          prompt: `World state:\n${worldState}\n\n${theme ? `Theme: ${theme}\n\n` : ""}Generate an interesting event that could happen.`,
        });
        
        const parsed = extractJSON(text);
        if (parsed) {
          return parsed;
        }
        return { type: "environmental", content: "A moment of quiet settles over the scene." };
      } catch (error) {
        console.error("[AI] generateEvent error:", error);
        return { type: "environmental", content: "The world holds its breath." };
      }
    },
  };
}

export const defaultAIContext = createAIContext();
