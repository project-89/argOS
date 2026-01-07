import { generateText } from "ai";
import { defaultModel } from "./config";
import { buildCognitivePrompt } from "./prompts";
import { getMindContext, serializeStreamForLLM, serializeMindStateForLLM } from "../systems/mind";
import { serializeKnowledgeForLLM } from "../systems/knowledge";
import { serializeActionsForLLM } from "../systems/action";
import type { ArgosWorld } from "../core/ecs";
import type { Stimulus } from "../core/types";

export interface CognitiveOutput {
  perception: {
    interpretation: string;
    relevance: string;
    causedBy: string[];
  } | null;
  thoughts: Array<{
    content: string;
    causedBy: string[];
    confidence: number;
  }>;
  decision: {
    action: string | null;
    parameters: Record<string, any>;
    reasoningText: string;
    causedBy: string[];
  };
  learning: {
    nodes: Array<{
      type: string;
      content: any;
      source: string;
    }>;
    edges: Array<{
      type: string;
      from: string;
      to: string;
    }>;
  };
  stateUpdates: {
    focus: string | null;
    mode: string | null;
    arousalDelta: number;
  };
}

function serializeStimuliForLLM(stimuli: Stimulus[]): string {
  if (stimuli.length === 0) {
    return "No active stimuli.";
  }

  const lines = stimuli.map((s) => {
    const age = Math.round((Date.now() - s.timestamp) / 1000);
    return `[${s.type}] from ${s.source} (${age}s ago, salience: ${s.salience.toFixed(2)})\n  ${s.content}`;
  });

  return lines.join("\n\n");
}

function parseJSON(text: string): any {
  const cleaned = text
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }

  return JSON.parse(cleaned);
}

export async function runCognition(
  world: ArgosWorld,
  eid: number,
  stimuli: Stimulus[]
): Promise<CognitiveOutput> {
  const context = getMindContext(world, eid);

  const prompt = buildCognitivePrompt({
    name: context.name,
    role: context.role,
    systemPrompt: context.systemPrompt,
    mindState: serializeMindStateForLLM(world, eid),
    stimuli: serializeStimuliForLLM(stimuli),
    cognitiveStream: serializeStreamForLLM(world, eid),
    knowledge: serializeKnowledgeForLLM(world, eid),
    actions: serializeActionsForLLM(),
  });

  console.log("\n=== LLM PROMPT ===");
  console.log(prompt.slice(0, 2000) + "...");
  console.log("==================\n");

  try {
    const { text } = await generateText({
      model: defaultModel,
      prompt,
      temperature: 0.8,
      maxOutputTokens: 2000,
    });

    console.log("\n=== LLM RESPONSE ===");
    console.log(text);
    console.log("====================\n");

    const parsed = parseJSON(text);

    return {
      perception: parsed.perception ?? null,
      thoughts: parsed.thoughts ?? [],
      decision: parsed.decision ?? {
        action: null,
        parameters: {},
        reasoningText: "No decision made",
        causedBy: [],
      },
      learning: parsed.learning ?? { nodes: [], edges: [] },
      stateUpdates: parsed.stateUpdates ?? {
        focus: null,
        mode: null,
        arousalDelta: 0,
      },
    };
  } catch (error) {
    console.error("Cognition error:", error);

    return {
      perception: null,
      thoughts: [
        {
          content: "I'm having trouble processing right now...",
          causedBy: [],
          confidence: 0.3,
        },
      ],
      decision: {
        action: "wait",
        parameters: { reason: "Cognitive difficulty" },
        reasoningText: "Unable to process normally",
        causedBy: [],
      },
      learning: { nodes: [], edges: [] },
      stateUpdates: { focus: null, mode: null, arousalDelta: -0.1 },
    };
  }
}
