/**
 * LLM Handlers — Official Google Generative AI SDK.
 *
 * Three handlers for the conversation engine:
 *   1. Escalation  — Flash handles novel situations (structured JSON output)
 *   2. Runtime     — Flash Lite fills templates + executes strategies
 *   3. Analysis    — Flash Lite extracts topics/entities/emotion (structured output)
 *
 * Gemini-specific features used:
 *   - responseSchema: guaranteed structured JSON (no regex parsing)
 *   - thinkingConfig: improved reasoning for escalation
 *   - systemInstruction: cached across calls
 */

import { ai, RUNTIME_MODEL, REASONING_MODEL } from "./config.js";
import type { PersonModel } from "../ecs/types.js";
import type { AgentAction } from "../bt/types.js";
import type { EscalationHandler, RuntimeHandler, AnalysisHandler } from "../engine/conversation.js";
import { getRecentMessages, getActiveIntentions } from "../ecs/person-store.js";

// =============================================================================
// ESCALATION — Flash handles novel situations
// =============================================================================

const escalationSchema = {
  type: "object" as const,
  properties: {
    reasoning: { type: "string" as const, description: "Your inner thought about what this person needs" },
    response: { type: "string" as const, description: "Your actual response to them" },
    topics_detected: { type: "array" as const, items: { type: "string" as const } },
    emotional_state: { type: "string" as const, enum: ["neutral", "stressed", "excited", "frustrated", "sad"] },
  },
  required: ["reasoning", "response"],
};

export const escalationHandler: EscalationHandler = async (userMessage, model) => {
  const context = buildFullContext(model);

  const response = await ai.models.generateContent({
    model: REASONING_MODEL,
    config: {
      temperature: 0.5,
      responseMimeType: "application/json",
      responseSchema: escalationSchema,
      systemInstruction: `You are a helpful AI companion. You know this person well and want to help them.

${context}

RULES:
- Respond naturally, matching their communication style.
- Reference things you know about them (from memory and hypotheses).
- Be concise — match their typical message length.
- If they're stressed, be supportive before being practical.
- If they ask a question, try to answer from what you know.`,
    },
    contents: userMessage,
  });

  try {
    const json = JSON.parse(response.text || "{}");
    return {
      response: json.response || response.text?.trim() || "",
      reasoning: json.reasoning || "",
      action: { type: "respond", content: json.response || response.text?.trim() || "" } as AgentAction,
    };
  } catch {
    return {
      response: response.text?.trim() || "",
      reasoning: "",
      action: { type: "respond", content: response.text?.trim() || "" } as AgentAction,
    };
  }
};

// =============================================================================
// RUNTIME — Flash Lite fills templates + executes strategies
// =============================================================================

export const runtimeHandler: RuntimeHandler = async (template, context, model) => {
  const recent = getRecentMessages(model, 4)
    .map(m => `${m.role}: ${m.content}`)
    .join("\n");

  const response = await ai.models.generateContent({
    model: RUNTIME_MODEL,
    config: {
      temperature: 0.6,
      maxOutputTokens: 256,
      systemInstruction: `Fill this response template naturally. Use the context to fill in details.
Keep it concise and conversational. Don't add extra content beyond what the template asks for.

Context:
${context}

Recent conversation:
${recent}`,
    },
    contents: `Template: ${template}\n\nGenerate the response:`,
  });

  return response.text?.trim() || template;
};

// =============================================================================
// ANALYSIS — Flash Lite structured extraction
// =============================================================================

const analysisSchema = {
  type: "object" as const,
  properties: {
    topics: {
      type: "array" as const,
      items: { type: "string" as const },
      description: "Topics discussed: work, creative, health, social, money, tech, etc.",
    },
    entities: {
      type: "array" as const,
      items: { type: "string" as const },
      description: "Named entities: people, places, projects mentioned",
    },
    emotionalState: {
      type: "string" as const,
      enum: ["neutral", "stressed", "excited", "frustrated", "sad"],
      description: "The user's emotional state",
    },
  },
  required: ["topics", "entities", "emotionalState"],
};

export const analysisHandler: AnalysisHandler = async (message, _model) => {
  try {
    const response = await ai.models.generateContent({
      model: RUNTIME_MODEL,
      config: {
        temperature: 0.1,
        maxOutputTokens: 128,
        responseMimeType: "application/json",
        responseSchema: analysisSchema,
      },
      contents: `Analyze this message for topics, named entities, and emotional state:\n\n"${message}"`,
    });

    const json = JSON.parse(response.text || "{}");
    return {
      topics: json.topics || [],
      entities: json.entities || [],
      emotionalState: json.emotionalState || "neutral",
    };
  } catch {
    return { topics: [], entities: [], emotionalState: "neutral" };
  }
};

// =============================================================================
// CONTEXT BUILDER
// =============================================================================

function buildFullContext(model: PersonModel): string {
  const lines: string[] = [];

  lines.push(`Person: ${model.personId}`);
  lines.push(`Total conversations: ${model.totalConversations}`);
  lines.push(`Communication style: ${model.style.formality > 0.6 ? "formal" : "casual"}, ${model.style.humor > 0.5 ? "humorous" : "straightforward"}, ${model.style.messageLength} messages`);

  const topHyps = model.hypotheses
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 10);
  if (topHyps.length > 0) {
    lines.push("\nWhat you know about this person:");
    for (const h of topHyps) {
      lines.push(`  [${(h.confidence * 100).toFixed(0)}%] ${h.content}`);
    }
  }

  const memories = model.memory
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 10);
  if (memories.length > 0) {
    lines.push("\nImportant memories:");
    for (const m of memories) {
      lines.push(`  - ${m.content}`);
    }
  }

  const intentions = getActiveIntentions(model);
  if (intentions.length > 0) {
    lines.push("\nYou're currently working on:");
    for (const i of intentions) {
      lines.push(`  - ${i.claim} (${i.status})`);
    }
  }

  if (model.conversation.emotionalState !== "neutral") {
    lines.push(`\nThey currently seem: ${model.conversation.emotionalState}`);
  }

  return lines.join("\n");
}
