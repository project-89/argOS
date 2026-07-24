/**
 * Linguistic Integration Layer — Intent Parser
 *
 * Text → Action: Converts natural language player input into structured
 * ECS actions. This is one half of the LIL from the LSE architecture.
 *
 * Features:
 *   - Natural language intent extraction via LLM
 *   - Entity resolution against actual world state (fuzzy matching)
 *   - Action validation (target exists, affordance available)
 *   - Compound action support ("go to the market and buy bread")
 *   - Conversation history for context-aware parsing
 */

import { generateText } from "ai";
import { intentModel } from "../llm/config";
import { extractJSON } from "../llm/json-extract";
import type { WorldSnapshot } from "./world-snapshot";

// =============================================================================
// TYPES
// =============================================================================

export interface ParsedAction {
  type: "move" | "speak" | "interact" | "observe" | "wait";
  target?: string;
  content?: string;
}

export interface ParsedIntent {
  actions: ParsedAction[];
  interpretation: string;
  confidence: number;
  impossible?: string;
}

export interface ConversationEntry {
  role: "player" | "dm";
  content: string;
}

// =============================================================================
// INTENT PARSER
// =============================================================================

/**
 * Parse natural language player input into structured ECS actions.
 *
 * Uses the world snapshot to ground entity references and validate actions.
 * Conversation history provides context for ambiguous inputs.
 */
export async function parsePlayerIntent(
  input: string,
  snapshot: WorldSnapshot,
  history: ConversationEntry[] = [],
): Promise<ParsedIntent> {

  const systemPrompt = `You parse natural language into simulation actions. Respond with JSON only.

WORLD STATE:
${formatSnapshotForParser(snapshot)}

ACTION TYPES:
- move: travel to a location. Target must be an exact room name from the exits list.
- speak: say something. Target is a person's name (optional — omit to speak to the room). Content is what to say.
- interact: use an affordance on an object. Target is the object name. Content is the EXACT affordance name from the list below.
- observe: look at something. Target is what to look at (or omit for the whole room).
- wait: do nothing, let time pass.

AVAILABLE AFFORDANCES (use these exact names as "content" for interact actions):
${snapshot.affordances.map(a => `  - ${a}`).join("\n") || "  (none)"}

IMPORTANT: When the player wants to DO something to an object (read it, investigate it, use it, examine it closely), check if an affordance matches. For example:
- "read the forbidden text" → interact, target: the text object, content: "read_forbidden_text"
- "investigate the clue" → interact, target: the clue object, content: "investigate_clue"
- "interrogate the witness" → interact, target: the person, content: "interrogate_witness"
If no affordance matches, fall back to "observe" for looking or "speak" for talking.

RULES:
1. Only reference rooms, people, and objects that exist in the world state above.
2. If the player wants to talk to someone, use "speak" with their exact name as target.
3. If the player wants to go somewhere, fuzzy-match against the exits list.
4. If the action is impossible (person not here, object doesn't exist), set "impossible" to explain why.
5. For compound actions ("go to market and buy bread"), produce multiple actions in order.
6. If the input is a question directed at an NPC, treat it as speech.
7. PREFER affordance-based interact over generic observe when the player actively does something to an object.

Respond with:
{
  "actions": [{ "type": "...", "target": "...", "content": "..." }],
  "interpretation": "Brief description of what you understood",
  "confidence": 0.0-1.0,
  "impossible": null or "reason"
}`;

  const recentHistory = history.slice(-4).map(h =>
    `${h.role === "player" ? "Player" : "DM"}: ${h.content.slice(0, 100)}`
  ).join("\n");

  try {
    const result = await generateText({
      model: intentModel,
      temperature: 0.2, // Low temp for reliable parsing
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `${recentHistory ? `Recent conversation:\n${recentHistory}\n\n` : ""}Player: ${input}` },
      ],
    });

    const raw = extractJSON(result.text);
    if (!raw) {
      return { actions: [{ type: "observe" }], interpretation: input, confidence: 0.3 };
    }
    const json = typeof raw === "string" ? JSON.parse(raw) : raw;

    return {
      actions: (json.actions || []).map((a: any) => ({
        type: String(a.type || "observe"),
        target: a.target ? String(a.target) : undefined,
        content: a.content ? String(a.content) : undefined,
      })),
      interpretation: String(json.interpretation || input),
      confidence: Number(json.confidence) || 0.5,
      impossible: json.impossible ? String(json.impossible) : undefined,
    };
  } catch {
    return { actions: [{ type: "observe" }], interpretation: input, confidence: 0.1 };
  }
}

// =============================================================================
// SNAPSHOT FORMATTING FOR PARSER
// =============================================================================

function formatSnapshotForParser(snapshot: WorldSnapshot): string {
  const lines: string[] = [];
  lines.push(`Location: ${snapshot.roomName}`);
  lines.push(`People here: ${snapshot.people.map(p => p.name).join(", ") || "nobody"}`);
  lines.push(`Objects here: ${snapshot.objects.map(o => `${o.name} [${o.traits.join(",")}]`).join(", ") || "nothing"}`);
  lines.push(`Exits: ${snapshot.exits.join(", ") || "none"}`);
  lines.push(`Affordances: ${snapshot.affordances.join(", ") || "none"}`);
  return lines.join("\n");
}
