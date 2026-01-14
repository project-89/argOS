import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import type { World } from "../ecs/world";
import { addEntity, addComponent, removeEntity, query, getRelationTargets, hasComponent } from "bitecs";
import { Name, Description, Agent, Mind, Room, Thought, Perception, ConversationTurn, Goal, Personality } from "../ecs/components";
import { OccupiesRoom, HasThought, HasPerception, HasConversation, HasGoal } from "../ecs/relations";
import {
  getKnowledgeSummary,
  getRelevantMemories,
  getImpressionOf,
  getAgentMemories
} from "./knowledge-graph";
import { Memory, Plan, Schedule, ReflectionState } from "../ecs/components";
import { HasPlan, HasSchedule, HasReflectionState } from "../ecs/relations";
import { formatPlansForContext, getNextPlannedAction } from "./planning-system";
import { formatInsightsForContext } from "./reflection-system";
import { formatScheduleForContext, getCurrentActivity } from "./schedule-system";
import { formatActionsForPrompt, getValidActionTypes } from "./action-registry";

const model = google("gemini-2.5-flash");

// Valid action types - expanded to match all handlers in cognition-system.ts
export type ValidActionType =
  | "speak" | "observe" | "move" | "interact" | "think" | "wait"  // Core
  | "attack" | "defend"                                           // Combat
  | "pickup" | "drop" | "use" | "give" | "examine"                // Inventory
  | "rest" | "reflect";                                           // Self

export interface AgentAction {
  type: ValidActionType;
  target?: string;
  content?: string;
}

export function getAgentThoughts(world: World, agentEid: number): number[] {
  const thoughtEids = getRelationTargets(world, agentEid, HasThought);
  return thoughtEids.filter(eid => hasComponent(world, eid, Thought));
}

export function getAgentPerceptions(world: World, agentEid: number): number[] {
  const perceptionEids = getRelationTargets(world, agentEid, HasPerception);
  return perceptionEids.filter(eid => hasComponent(world, eid, Perception));
}

export function getAgentConversation(world: World, agentEid: number): number[] {
  const turnEids = getRelationTargets(world, agentEid, HasConversation);
  return turnEids
    .filter(eid => hasComponent(world, eid, ConversationTurn))
    .sort((a, b) => (ConversationTurn.timestamp[a] || 0) - (ConversationTurn.timestamp[b] || 0));
}

export function clearAllAgentMemory(world: World): void {
  const agents = Array.from(query(world, [Agent]));
  for (const agentEid of agents) {
    const thoughts = getAgentThoughts(world, agentEid);
    const perceptions = getAgentPerceptions(world, agentEid);
    const conversation = getAgentConversation(world, agentEid);
    
    for (const eid of [...thoughts, ...perceptions, ...conversation]) {
      removeEntity(world, eid);
    }
  }
}

export function addPerception(
  world: World,
  agentEid: number,
  data: { type: string; content: string; source: string; intensity?: number }
): number {
  const perceptionEid = addEntity(world);
  addComponent(world, perceptionEid, Perception);
  addComponent(world, agentEid, HasPerception(perceptionEid));

  Perception.type[perceptionEid] = data.type;
  Perception.content[perceptionEid] = data.content;
  Perception.source[perceptionEid] = data.source;
  Perception.intensity[perceptionEid] = data.intensity ?? 1;
  Perception.timestamp[perceptionEid] = Date.now();

  prunePerceptions(world, agentEid, 20);

  return perceptionEid;
}

function prunePerceptions(world: World, agentEid: number, maxPerceptions: number): void {
  const perceptionEids = getAgentPerceptions(world, agentEid);
  if (perceptionEids.length <= maxPerceptions) return;

  const sorted = perceptionEids.sort((a, b) => 
    (Perception.timestamp[a] || 0) - (Perception.timestamp[b] || 0)
  );

  const toRemove = sorted.slice(0, sorted.length - maxPerceptions);
  for (const eid of toRemove) {
    removeEntity(world, eid);
  }
}

export function addThought(
  world: World,
  agentEid: number,
  data: { content: string; type?: string; salience?: number }
): number {
  // Check if agent entity still exists before trying to add components
  if (!hasComponent(world, agentEid, Agent)) {
    console.warn(`[AgentMind] Cannot add thought - agent entity ${agentEid} no longer exists`);
    return -1;
  }

  const thoughtEid = addEntity(world);
  addComponent(world, thoughtEid, Thought);
  addComponent(world, agentEid, HasThought(thoughtEid));

  Thought.content[thoughtEid] = data.content;
  Thought.type[thoughtEid] = data.type || "reflection";
  Thought.salience[thoughtEid] = data.salience ?? 0.5;
  Thought.timestamp[thoughtEid] = Date.now();

  pruneThoughts(world, agentEid, 10);

  return thoughtEid;
}

function pruneThoughts(world: World, agentEid: number, maxThoughts: number): void {
  const thoughtEids = getAgentThoughts(world, agentEid);
  if (thoughtEids.length <= maxThoughts) return;

  const sorted = thoughtEids.sort((a, b) => 
    (Thought.timestamp[a] || 0) - (Thought.timestamp[b] || 0)
  );

  const toRemove = sorted.slice(0, sorted.length - maxThoughts);
  for (const eid of toRemove) {
    removeEntity(world, eid);
  }
}

export function addConversationTurn(
  world: World,
  agentEid: number,
  role: "user" | "assistant",
  content: string
): number {
  const turnEid = addEntity(world);
  addComponent(world, turnEid, ConversationTurn);
  addComponent(world, agentEid, HasConversation(turnEid));

  ConversationTurn.role[turnEid] = role;
  ConversationTurn.content[turnEid] = content;
  ConversationTurn.timestamp[turnEid] = Date.now();

  pruneConversation(world, agentEid, 20);

  return turnEid;
}

function pruneConversation(world: World, agentEid: number, maxTurns: number): void {
  const turnEids = getAgentConversation(world, agentEid);
  if (turnEids.length <= maxTurns) return;

  const toRemove = turnEids.slice(0, turnEids.length - maxTurns);
  for (const eid of toRemove) {
    removeEntity(world, eid);
  }
}

function buildKnowledgeContext(world: World, eid: number, othersInRoom: string[]): string {
  const lines: string[] = [];
  
  const knowledgeSummary = getKnowledgeSummary(world, eid);
  if (knowledgeSummary) {
    lines.push("LONG-TERM KNOWLEDGE:");
    lines.push(knowledgeSummary);
  }
  
  if (othersInRoom.length > 0) {
    lines.push("\nIMPRESSIONS OF THOSE PRESENT:");
    for (const otherName of othersInRoom) {
      const impression = getImpressionOf(world, eid, otherName);
      if (impression) {
        const sentiment = impression.overallSentiment > 0.2 ? "positive" : 
                         impression.overallSentiment < -0.2 ? "negative" : "neutral";
        const traits = impression.traits.map(t => t.trait).join(", ");
        lines.push(`  ${otherName}: ${sentiment} (${traits})`);
      } else {
        lines.push(`  ${otherName}: no prior impression`);
      }
    }
  }
  
  return lines.join("\n");
}

function buildAgentContext(world: World, eid: number): string {
  const name = Name.value[eid];
  const description = Description.value[eid];
  const role = Agent.role[eid];
  const systemPrompt = Agent.systemPrompt[eid];
  const mode = Mind.mode[eid];
  const arousal = Mind.arousal[eid];
  const focus = Mind.focus[eid];

  const roomTargets = getRelationTargets(world, eid, OccupiesRoom);
  let roomContext = "nowhere in particular";
  let roomAmbience = "";
  let othersInRoom: string[] = [];

  if (roomTargets.length > 0) {
    const roomEid = roomTargets[0];
    roomContext = Name.value[roomEid] || "an unknown room";
    roomAmbience = Room.ambience[roomEid] || "";

    const agents = Array.from(query(world, [Agent]));
    for (const otherEid of agents) {
      if (otherEid === eid) continue;
      const otherRooms = getRelationTargets(world, otherEid, OccupiesRoom);
      if (otherRooms.includes(roomEid)) {
        othersInRoom.push(Name.value[otherEid]);
      }
    }
  }

  const perceptionEids = getAgentPerceptions(world, eid);
  const recentPerceptions = perceptionEids
    .sort((a, b) => (Perception.timestamp[b] || 0) - (Perception.timestamp[a] || 0))
    .slice(0, 5);

  const thoughtEids = getAgentThoughts(world, eid);
  const recentThoughts = thoughtEids
    .sort((a, b) => (Thought.timestamp[b] || 0) - (Thought.timestamp[a] || 0))
    .slice(0, 3);

  // Get active goals
  const goalTargets = getRelationTargets(world, eid, HasGoal);
  const activeGoals = goalTargets
    .filter(gid => hasComponent(world, gid, Goal) && Goal.status[gid] === "active")
    .sort((a, b) => (Goal.priority[b] || 0) - (Goal.priority[a] || 0))
    .slice(0, 5);

  // Get personality traits if present
  const hasPersonality = hasComponent(world, eid, Personality);
  const personalityTraits = hasPersonality ? {
    openness: Personality.openness[eid] ?? 0.5,
    conscientiousness: Personality.conscientiousness[eid] ?? 0.5,
    extraversion: Personality.extraversion[eid] ?? 0.5,
    agreeableness: Personality.agreeableness[eid] ?? 0.5,
    neuroticism: Personality.neuroticism[eid] ?? 0.5,
  } : null;

  // Format personality as natural language
  const formatPersonality = (traits: typeof personalityTraits): string => {
    if (!traits) return "";
    const descriptions: string[] = [];
    if (traits.openness > 0.7) descriptions.push("curious and creative");
    else if (traits.openness < 0.3) descriptions.push("practical and conventional");
    if (traits.conscientiousness > 0.7) descriptions.push("organized and disciplined");
    else if (traits.conscientiousness < 0.3) descriptions.push("flexible and spontaneous");
    if (traits.extraversion > 0.7) descriptions.push("outgoing and energetic");
    else if (traits.extraversion < 0.3) descriptions.push("reserved and reflective");
    if (traits.agreeableness > 0.7) descriptions.push("cooperative and trusting");
    else if (traits.agreeableness < 0.3) descriptions.push("competitive and skeptical");
    if (traits.neuroticism > 0.7) descriptions.push("sensitive and prone to worry");
    else if (traits.neuroticism < 0.3) descriptions.push("calm and emotionally stable");
    return descriptions.length > 0 ? descriptions.join(", ") : "balanced temperament";
  };

  return `You are ${name}.

IDENTITY:
${description}

ROLE: ${role}

BEHAVIORAL GUIDELINES:
${systemPrompt}

CURRENT STATE:
- Location: ${roomContext}
- Ambience: ${roomAmbience}
- Mental Mode: ${mode}
- Arousal Level: ${(arousal * 100).toFixed(0)}%
- Current Focus: ${focus || "nothing specific"}
- Others Present: ${othersInRoom.length > 0 ? othersInRoom.join(", ") : "no one else"}
${personalityTraits ? `- Temperament: ${formatPersonality(personalityTraits)}` : ""}

ACTIVE GOALS:
${activeGoals.length > 0
  ? activeGoals.map(gid => {
      const progress = Goal.progress[gid] || 0;
      const priority = Goal.priority[gid] || 5;
      return `- [Priority ${priority}] ${Goal.description[gid]} (${progress}% complete)`;
    }).join("\n")
  : "No specific goals right now."}

RECENT PERCEPTIONS:
${recentPerceptions.length > 0 
  ? recentPerceptions.map(eid => `[${Perception.type[eid]}] ${Perception.content[eid]} (from: ${Perception.source[eid]})`).join("\n")
  : "Nothing notable recently."}

RECENT THOUGHTS:
${recentThoughts.length > 0
  ? recentThoughts.map(eid => `- ${Thought.content[eid]}`).join("\n")
  : "Mind is clear."}

${buildKnowledgeContext(world, eid, othersInRoom)}

${formatPlansForContext(world, eid)}

${formatScheduleForContext(world, eid)}

${formatInsightsForContext(world, eid)}`;
}

export async function agentThink(world: World, eid: number): Promise<AgentAction> {
  const context = buildAgentContext(world, eid);
  const name = Name.value[eid];

  const conversationEids = getAgentConversation(world, eid);
  const conversationHistory = conversationEids.slice(-6).map(turnEid => ({
    role: ConversationTurn.role[turnEid] as "user" | "assistant",
    content: ConversationTurn.content[turnEid],
  }));

  // Get dynamic actions based on agent's components, location, and environment
  const actionsContext = formatActionsForPrompt(world, eid);
  const validTypes = getValidActionTypes(world, eid);

  const prompt = `Based on your current situation, perceptions, goals, plans, schedule, and character, decide what to do next.

${actionsContext}

DECISION PRIORITIES:
1. FIRST check your RECENT PERCEPTIONS for action feedback (🚨 CRITICAL failures, ✅ successes)
   - If your last action FAILED, you MUST acknowledge it and try something DIFFERENT
   - Do NOT repeat failed actions or assume they succeeded
2. Check your INVENTORY to know what you actually have - don't assume you picked something up
3. If you have CRITICAL NEEDS (hunger/energy), address them
4. If you have an ACTIVE PLAN, follow the current step
5. Consider your SCHEDULE - what activity should you be doing now?
6. Work toward your ACTIVE GOALS
7. React naturally to your perceptions and surroundings

CRITICAL RULE:
- If your perception shows "🚨 CRITICAL - YOUR LAST ACTION FAILED", you MUST acknowledge this failure
- Never say "I have X" unless X appears in your INVENTORY
- Never say "I did X" unless your perception shows "✅ SUCCESS"

IMPORTANT:
- Only use actions from the list above
- When moving, use exact location names from "PLACES YOU CAN GO"
- When interacting with objects or people, use their exact names
- Your action type MUST be one of: ${validTypes.join(", ")}

Respond with JSON only:
{
  "innerThought": "Your internal reasoning about what to do",
  "action": {
    "type": "<action_type>",
    "target": "optional - exact name of who/what from the lists above",
    "content": "optional - what you say/think/do"
  }
}

Stay in character. Be concise. React naturally to your perceptions and surroundings.`;

  try {
    const { text } = await generateText({
      model,
      system: context,
      messages: [
        ...conversationHistory,
        {
          role: "user" as const,
          content: prompt,
        },
      ],
    });

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { type: "wait" };
    }

    const result = JSON.parse(jsonMatch[0]);
    
    if (result.innerThought) {
      addThought(world, eid, { content: result.innerThought, type: "reasoning" });
    }

    const action: AgentAction = {
      type: result.action?.type || "wait",
      target: result.action?.target,
      content: result.action?.content,
    };

    addConversationTurn(world, eid, "user", prompt);
    addConversationTurn(world, eid, "assistant", text);

    console.log(`[${name}] thinks: "${result.innerThought || ""}"`);
    console.log(`[${name}] action: ${action.type}${action.content ? ` - "${action.content}"` : ""}`);

    return action;
  } catch (error) {
    console.error(`[${name}] cognition error:`, error);
    return { type: "wait" };
  }
}

export async function processAgentCognition(
  world: World,
  eid: number,
  stimuli: Array<{ type: string; content: string; source: string }>
): Promise<AgentAction> {
  for (const stimulus of stimuli) {
    addPerception(world, eid, {
      type: stimulus.type,
      content: stimulus.content,
      source: stimulus.source,
    });
  }

  if (stimuli.length > 0) {
    Mind.arousal[eid] = Math.min(1, Mind.arousal[eid] + 0.1 * stimuli.length);
  }

  return agentThink(world, eid);
}

export function getAgentMemory(world: World, eid: number): {
  perceptions: Array<{ type: string; content: string; source: string; timestamp: number }>;
  thoughts: Array<{ content: string; timestamp: number }>;
  recentActions: AgentAction[];
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
} {
  const perceptionEids = getAgentPerceptions(world, eid);
  const perceptions = perceptionEids.map(peid => ({
    type: Perception.type[peid],
    content: Perception.content[peid],
    source: Perception.source[peid],
    timestamp: Perception.timestamp[peid],
  }));

  const thoughtEids = getAgentThoughts(world, eid);
  const thoughts = thoughtEids.map(teid => ({
    content: Thought.content[teid],
    timestamp: Thought.timestamp[teid],
  }));

  const conversationEids = getAgentConversation(world, eid);
  const conversationHistory = conversationEids.map(ceid => ({
    role: ConversationTurn.role[ceid] as "user" | "assistant",
    content: ConversationTurn.content[ceid],
  }));

  return {
    perceptions,
    thoughts,
    recentActions: [],
    conversationHistory,
  };
}
