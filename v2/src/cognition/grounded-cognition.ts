/**
 * Grounded Cognition System
 *
 * Chooses actions from local observations and recorded working memory.
 * The snapshot bounds what is known, not what can exist elsewhere.
 */

import { generateText } from "ai";
import { flashModel } from "../llm/config";
import type { World } from "../ecs/world";
import { query, getRelationTargets, hasComponent } from "bitecs";
import { Name, Description, Agent, Perception } from "../ecs/components";
import { HasPerception } from "../ecs/relations";
import { getRoomForEntity } from "../ecs/location";
import { addThought } from "./agent-mind";
import type { AgentAction, ValidActionType } from "./agent-mind";
import { initializeEnhancedAgent } from "./enhanced-agent";

const model = flashModel;

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
  if (events.length === 0) return "No recent events recorded.";

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
 * Build the agent's current observations and recorded context.
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

  let context = `# Identity
You are ${state.agentName}, ${state.agentRole}.
${state.agentDescription}

${config.systemPrompt || ""}

# Current observations

## Location
- Room: ${state.currentRoom}
- Description: ${state.roomDescription}

## People nearby
${peopleList}
`;

  // Show external messages prominently if there are any
  if (externalMessagesList) {
    context += `
## Incoming messages
${externalMessagesList}

`;
  }

  context += `
## Recent perceptions
${perceptionsList}

## Recent events and thoughts
${eventsList}

${config.additionalContext || ""}

Ground your choice in these observations and recorded context. A thought, intention, or report is not proof that an action succeeded. Missing information is unknown.`;

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

  const hasExternalMessage = state.recentPerceptions.some(p =>
    p.type === "slack_message" || p.source === "slack_external"
  );

  // Build the thinking prompt
  const prompt = buildThinkingPrompt(config, hasExternalMessage);

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
  config: GroundedThinkingConfig,
  hasExternalMessage: boolean
): string {
  const actionsList = config.availableActions?.join(", ") ||
    "speak, observe, think, wait, move, use, reflect";

  let prompt = `Choose one action that fits your situation and priorities.

AVAILABLE ACTIONS: ${actionsList}

`;

  // Describe the existing tool contract without making incoming messages mandatory tasks.
  if (hasExternalMessage && actionsList.split(", ").includes("use")) {
    prompt += `
For a Slack reply, use action type "use" with content "Post to <channel>: <message>". Use the message's channel${config.slackChannels?.length ? ` from the available channels: ${config.slackChannels.join(", ")}` : " when known"}.
`;
  }

  prompt += `
Return JSON:
{
  "situationAnalysis": "Brief account of the current situation",
  "relevantPerceptions": "Observations or events relevant to this choice",
  "reasoning": "Brief reason for the choice",
  "action": {
    "type": "<one of: ${actionsList}>",
    "target": "<name of person/object if relevant>",
    "content": "<what I say/think/do>"
  }
}`;

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
