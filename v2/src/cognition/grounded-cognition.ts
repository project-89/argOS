/**
 * Grounded Cognition System
 *
 * A cognitive system designed to prevent hallucination and produce deep, grounded thinking.
 *
 * Key principles:
 * 1. EXPLICIT GROUNDING - Only reference things that actually exist in the world state
 * 2. PERCEPTION ACKNOWLEDGMENT - Force agents to acknowledge and respond to actual stimuli
 * 3. WORKING MEMORY - Track actual events that happened, not imagined ones
 * 4. DEEP REASONING - Multi-step thinking with self-reflection
 * 5. NO FABRICATION - If something isn't explicitly listed, it doesn't exist
 */

import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import type { World } from "../ecs/world";
import { query, getRelationTargets, hasComponent } from "bitecs";
import { Name, Description, Agent, Mind, Room, Perception } from "../ecs/components";
import { HasPerception } from "../ecs/relations";
import { getRoomForEntity } from "../ecs/location";
import { addThought } from "./agent-mind";
import type { AgentAction, ValidActionType } from "./agent-mind";
import {
  getEnhancedAgentState,
  initializeEnhancedAgent,
} from "./enhanced-agent";
import {
  addEpisodicMemory,
  recallEpisodicMemories,
  generateMemoryContext,
} from "./enhanced-memory";

const model = google("gemini-2.5-flash");

// =============================================================================
// WORKING MEMORY - Track actual events in the current session
// =============================================================================

interface WorkingMemoryEvent {
  tick: number;
  agentEid: number;
  type: "speech" | "action" | "observation" | "slack_message" | "thought";
  actor: string;
  content: string;
  target?: string;
  timestamp: number;
}

// Per-agent working memory for the current session
const sessionMemory = new Map<number, WorkingMemoryEvent[]>();

/**
 * Record an event in working memory
 */
export function recordEvent(
  agentEid: number,
  event: Omit<WorkingMemoryEvent, "timestamp" | "agentEid">
): void {
  if (!sessionMemory.has(agentEid)) {
    sessionMemory.set(agentEid, []);
  }
  const events = sessionMemory.get(agentEid)!;
  events.push({
    ...event,
    agentEid,
    timestamp: Date.now(),
  });

  // Keep last 50 events
  if (events.length > 50) {
    events.shift();
  }
}

/**
 * Get recent events from working memory
 */
export function getRecentEvents(agentEid: number, count: number = 10): WorkingMemoryEvent[] {
  const events = sessionMemory.get(agentEid) || [];
  return events.slice(-count);
}

/**
 * Clear session memory for an agent
 */
export function clearSessionMemory(agentEid: number): void {
  sessionMemory.delete(agentEid);
}

/**
 * Format events for the agent's context
 */
function formatEventsForContext(events: WorkingMemoryEvent[]): string {
  if (events.length === 0) return "Nothing has happened yet.";

  return events.map(e => {
    switch (e.type) {
      case "speech":
        return `- ${e.actor} said: "${e.content}"${e.target ? ` (to ${e.target})` : ""}`;
      case "action":
        return `- ${e.actor} ${e.content}${e.target ? ` (targeting ${e.target})` : ""}`;
      case "observation":
        return `- ${e.actor} observed: ${e.content}`;
      case "slack_message":
        return `- [Slack] ${e.actor}: "${e.content}"`;
      case "thought":
        return `- ${e.actor} thought: "${e.content}"`;
      default:
        return `- ${e.content}`;
    }
  }).join("\n");
}

// =============================================================================
// WORLD STATE EXTRACTION - Get the ACTUAL state of the world
// =============================================================================

interface GroundedWorldState {
  agentName: string;
  agentRole: string;
  agentDescription: string;
  currentRoom: string;
  roomDescription: string;
  presentPeople: { name: string; role: string }[];
  recentPerceptions: { type: string; content: string; source: string }[];
  recentEvents: WorkingMemoryEvent[];
}

/**
 * Extract the actual, verifiable world state for an agent
 */
function extractWorldState(world: World, eid: number): GroundedWorldState {
  const agentName = Name.value[eid] || "Unknown";
  const agentRole = Agent.role[eid] || "person";
  const agentDescription = Description.value[eid] || "";

  // Get current room
  const roomEid = getRoomForEntity(world, eid);
  let currentRoom = "unknown location";
  let roomDescription = "";
  const presentPeople: { name: string; role: string }[] = [];

  if (roomEid !== undefined) {
    currentRoom = Name.value[roomEid] || "unknown room";
    roomDescription = Description.value[roomEid] || "";

    // Find others in the same room
    const agents = Array.from(query(world, [Agent]));
    for (const otherEid of agents) {
      if (otherEid === eid) continue;
      if (getRoomForEntity(world, otherEid) === roomEid) {
        presentPeople.push({
          name: Name.value[otherEid] || "Unknown",
          role: Agent.role[otherEid] || "person",
        });
      }
    }
  }

  // Get actual perceptions
  const perceptionEids = getRelationTargets(world, eid, HasPerception)
    .filter(peid => hasComponent(world, peid, Perception));

  const recentPerceptions = perceptionEids
    .sort((a, b) => (Perception.timestamp[b] || 0) - (Perception.timestamp[a] || 0))
    .slice(0, 10)
    .map(peid => ({
      type: Perception.type[peid] || "unknown",
      content: Perception.content[peid] || "",
      source: Perception.source[peid] || "unknown",
    }));

  // Get session memory events
  const recentEvents = getRecentEvents(eid, 15);

  return {
    agentName,
    agentRole,
    agentDescription,
    currentRoom,
    roomDescription,
    presentPeople,
    recentPerceptions,
    recentEvents,
  };
}

// =============================================================================
// GROUNDED THINKING - Deep reasoning without hallucination
// =============================================================================

interface GroundedThinkingConfig {
  systemPrompt?: string;
  availableActions?: string[];
  slackChannels?: string[];
  additionalContext?: string;
}

/**
 * Build a grounded context that explicitly lists what exists
 */
function buildGroundedContext(state: GroundedWorldState, config: GroundedThinkingConfig): string {
  const peopleList = state.presentPeople.length > 0
    ? state.presentPeople.map(p => `  - ${p.name} (${p.role})`).join("\n")
    : "  (no one else)";

  // Separate external messages from other perceptions for visibility
  const externalMessages = state.recentPerceptions.filter(p =>
    p.type === "slack_message" || p.source === "slack_external"
  );
  const otherPerceptions = state.recentPerceptions.filter(p =>
    p.type !== "slack_message" && p.source !== "slack_external"
  );

  const perceptionsList = otherPerceptions.length > 0
    ? otherPerceptions.map(p => `  [${p.type}] ${p.content}`).join("\n")
    : "  (no recent perceptions)";

  const externalMessagesList = externalMessages.length > 0
    ? externalMessages.map(p => `  ${p.content}`).join("\n")
    : null;

  const eventsList = formatEventsForContext(state.recentEvents);

  let context = `# IDENTITY
You are ${state.agentName}, ${state.agentRole}.
${state.agentDescription}

${config.systemPrompt || ""}

# CURRENT REALITY (This is the ONLY truth - do NOT invent anything not listed here)

## Your Location
- Room: ${state.currentRoom}
- Description: ${state.roomDescription}

## People Present With You RIGHT NOW
${peopleList}
`;

  // Show external messages prominently if there are any
  if (externalMessagesList) {
    context += `
## 📬 INCOMING MESSAGES (People are trying to reach you!)
${externalMessagesList}

`;
  }

  context += `
## Your Recent Perceptions (ACTUAL things you saw/heard)
${perceptionsList}

## Recent Events (What ACTUALLY happened)
${eventsList}

${config.additionalContext || ""}

# CRITICAL RULES
1. ONLY reference people listed in "People Present With You RIGHT NOW"
2. ONLY respond to things in "Your Recent Perceptions" or "Recent Events"
3. If someone messaged you or spoke to you, you MUST acknowledge and respond to them
4. Do NOT invent messages, conversations, or events that are not listed above
5. Do NOT assume things happened unless they appear in Recent Events
6. If you don't have information about something, say "I don't know" - don't fabricate`;

  return context;
}

/**
 * Perform grounded thinking - deep reasoning without hallucination
 */
export async function groundedThink(
  world: World,
  eid: number,
  config: GroundedThinkingConfig = {}
): Promise<AgentAction> {
  // Initialize enhanced agent if needed
  initializeEnhancedAgent(eid);

  const state = extractWorldState(world, eid);
  const context = buildGroundedContext(state, config);

  // Check if there's something requiring immediate response
  const speechPerceptions = state.recentPerceptions.filter(p =>
    p.type === "speech" || p.content.toLowerCase().includes("says:")
  );

  // Check for external Slack messages that need responses
  const externalSlackMessages = state.recentPerceptions.filter(p =>
    p.type === "slack_message" || p.source === "slack_external"
  );

  const hasDirectSpeech = speechPerceptions.length > 0;
  const hasExternalMessage = externalSlackMessages.length > 0;

  // Build the thinking prompt
  const prompt = buildThinkingPrompt(state, config, hasDirectSpeech, hasExternalMessage, externalSlackMessages);

  try {
    const { text } = await generateText({
      model,
      system: context,
      messages: [
        {
          role: "user" as const,
          content: prompt,
        },
      ],
      temperature: 0.7,
    });

    // Parse the response
    const result = parseGroundedResponse(text);

    // Record the thought in working memory
    if (result.reasoning) {
      recordEvent(eid, {
        tick: 0,
        type: "thought",
        actor: state.agentName,
        content: result.reasoning.slice(0, 100),
      });
    }

    // Add to ECS thoughts
    if (result.reasoning) {
      addThought(world, eid, { content: result.reasoning, type: "grounded_reasoning" });
    }

    // Log the thinking process
    console.log(`[${state.agentName}] thinks: "${result.reasoning || ""}"`);
    console.log(`[${state.agentName}] action: ${result.action.type}${result.action.content ? ` - "${result.action.content}"` : ""}`);

    return result.action;
  } catch (error) {
    console.error(`[GroundedCognition] Error for ${state.agentName}:`, error);
    return { type: "wait" };
  }
}

/**
 * Build the thinking prompt based on current state
 */
function buildThinkingPrompt(
  state: GroundedWorldState,
  config: GroundedThinkingConfig,
  hasDirectSpeech: boolean,
  hasExternalMessage: boolean,
  externalSlackMessages: { type: string; content: string; source: string }[]
): string {
  const actionsList = config.availableActions?.join(", ") ||
    "speak, observe, think, wait, move, use, reflect";

  let prompt = `Think carefully about your current situation.

AVAILABLE ACTIONS: ${actionsList}

`;

  // External Slack messages from real users need PRIORITY attention
  if (hasExternalMessage) {
    prompt += `
## 🚨 PRIORITY: EXTERNAL MESSAGES REQUIRE YOUR RESPONSE!
${externalSlackMessages.map(m => `${m.content}`).join("\n")}

Someone from OUTSIDE your team is trying to communicate with you via Slack!
YOU MUST respond to these messages. To reply via Slack, use:
  action type: "use"
  content: "Post to #general: Your reply message here"
This takes precedence over internal team conversations.

`;
  }

  // If someone spoke to us in person, emphasize responding
  if (hasDirectSpeech) {
    const speeches = state.recentPerceptions.filter(p =>
      p.type === "speech" || p.content.toLowerCase().includes("says:")
    );

    prompt += `
## IMPORTANT: Someone spoke to you!
${speeches.map(s => `"${s.content}"`).join("\n")}

You should respond to what was said to you.

`;
  }

  prompt += `
## Your Task
1. First, analyze what just happened based on Recent Events and Perceptions
2. Consider: Is someone waiting for a response from you?
3. Think about what would be the most natural, appropriate thing to do
4. Choose ONE action from the available actions

## Response Format
Respond with this EXACT JSON structure:
{
  "situationAnalysis": "What is actually happening right now based on the facts above",
  "relevantPerceptions": "What perceptions/events am I responding to",
  "reasoning": "My thought process for deciding what to do",
  "action": {
    "type": "<one of: ${actionsList}>",
    "target": "<name of person/object if relevant>",
    "content": "<what I say/think/do>"
  }
}

Remember:
- ONLY reference things that appear in the CURRENT REALITY section
- If someone spoke to you or messaged you, respond to WHAT THEY ACTUALLY SAID
- Be specific and grounded in your response`;

  return prompt;
}

/**
 * Parse the LLM response into a structured result
 */
function parseGroundedResponse(text: string): {
  reasoning: string;
  action: AgentAction;
} {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        reasoning: "Could not parse response",
        action: { type: "wait" },
      };
    }

    const result = JSON.parse(jsonMatch[0]);

    return {
      reasoning: result.reasoning || result.situationAnalysis || "",
      action: {
        type: (result.action?.type || "wait") as ValidActionType,
        target: result.action?.target,
        content: result.action?.content,
      },
    };
  } catch (error) {
    console.error("[GroundedCognition] Parse error:", error);
    return {
      reasoning: "Parse error",
      action: { type: "wait" },
    };
  }
}

// =============================================================================
// EVENT RECORDING HELPERS
// =============================================================================

/**
 * Record that an agent spoke
 */
export function recordSpeech(agentEid: number, agentName: string, content: string, target?: string): void {
  recordEvent(agentEid, {
    tick: 0,
    type: "speech",
    actor: agentName,
    content,
    target,
  });
}

/**
 * Record that an agent performed an action
 */
export function recordAction(agentEid: number, agentName: string, actionDesc: string, target?: string): void {
  recordEvent(agentEid, {
    tick: 0,
    type: "action",
    actor: agentName,
    content: actionDesc,
    target,
  });
}

/**
 * Record a Slack message
 */
export function recordSlackMessage(agentEid: number, authorName: string, content: string): void {
  recordEvent(agentEid, {
    tick: 0,
    type: "slack_message",
    actor: authorName,
    content,
  });
}

/**
 * Record that someone spoke to an agent (add to their memory)
 */
export function recordHeardSpeech(listenerEid: number, speakerName: string, content: string): void {
  recordEvent(listenerEid, {
    tick: 0,
    type: "speech",
    actor: speakerName,
    content,
  });
}
