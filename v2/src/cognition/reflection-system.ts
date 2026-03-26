/**
 * Reflection System
 *
 * Implements the reflection mechanism from the Generative Agents paper.
 * When accumulated memory importance exceeds a threshold, the agent
 * reflects on recent experiences to generate higher-order insights.
 *
 * These insights are:
 * - Stored as new memories with high importance
 * - Used to update beliefs and impressions
 * - Provide context for future decision-making
 */

import { generateText } from "ai";
import { flashModel } from "../llm/config";
import type { World } from "../ecs/world";
import { addEntity, addComponent, query, getRelationTargets, hasComponent } from "bitecs";
import { Name, Description, Agent, Mind, Memory, ReflectionState, Thought } from "../ecs/components";
import { HasMemory, HasReflectionState, HasThought } from "../ecs/relations";
import { getAgentMemories, addMemory, getKnowledgeSummary } from "./knowledge-graph";
import { addThought } from "./agent-mind";

const model = flashModel;

// Default reflection threshold (accumulated importance before reflecting)
const DEFAULT_REFLECTION_THRESHOLD = 100;

// How many recent memories to consider for reflection
const MEMORIES_TO_CONSIDER = 20;

export interface ReflectionInsight {
  insight: string;
  importance: number;
  relatedMemories: string[];
  category: "self" | "social" | "world" | "goal";
}

export interface ReflectionResult {
  insights: ReflectionInsight[];
  questionsRaised: string[];
  emotionalSummary: string;
}

/**
 * Initialize reflection state for an agent
 */
export function initializeReflectionState(
  world: World,
  agentEid: number,
  threshold: number = DEFAULT_REFLECTION_THRESHOLD
): number {
  // Check if already has reflection state
  const existing = getRelationTargets(world, agentEid, HasReflectionState);
  if (existing.length > 0) {
    return existing[0];
  }

  const stateEid = addEntity(world);
  addComponent(world, stateEid, ReflectionState);
  addComponent(world, agentEid, HasReflectionState(stateEid));

  ReflectionState.lastReflection[stateEid] = Date.now();
  ReflectionState.importanceAccum[stateEid] = 0;
  ReflectionState.reflectionThreshold[stateEid] = threshold;
  ReflectionState.reflectionCount[stateEid] = 0;
  ReflectionState.insights[stateEid] = "[]";

  return stateEid;
}

/**
 * Get the reflection state for an agent
 */
export function getReflectionState(world: World, agentEid: number): number | undefined {
  const targets = getRelationTargets(world, agentEid, HasReflectionState);
  return targets.length > 0 ? targets[0] : undefined;
}

/**
 * Add importance to an agent's reflection accumulator
 * Call this when the agent experiences something
 */
export function accumulateImportance(world: World, agentEid: number, importance: number): void {
  const stateEid = getReflectionState(world, agentEid);
  if (!stateEid) return;

  const current = ReflectionState.importanceAccum[stateEid] || 0;
  ReflectionState.importanceAccum[stateEid] = current + importance;
}

/**
 * Check if an agent should reflect (importance exceeds threshold)
 */
export function shouldReflect(world: World, agentEid: number): boolean {
  const stateEid = getReflectionState(world, agentEid);
  if (!stateEid) return false;

  const accum = ReflectionState.importanceAccum[stateEid] || 0;
  const threshold = ReflectionState.reflectionThreshold[stateEid] || DEFAULT_REFLECTION_THRESHOLD;

  return accum >= threshold;
}

/**
 * Build context for reflection generation
 */
function buildReflectionContext(
  world: World,
  agentEid: number,
  recentMemories: Array<{ content: string; importance: number; type: string; timestamp: number }>
): string {
  const agentName = Name.value[agentEid];
  const agentDesc = Description.value[agentEid];
  const agentRole = Agent.role[agentEid];

  // Format memories for the prompt
  const memoryLines = recentMemories
    .sort((a, b) => b.importance - a.importance)
    .slice(0, MEMORIES_TO_CONSIDER)
    .map((m, i) => {
      const timeAgo = formatTimeAgo(m.timestamp);
      return `${i + 1}. [${m.type}] ${m.content} (importance: ${m.importance.toFixed(1)}, ${timeAgo})`;
    });

  // Get existing knowledge
  const knowledge = getKnowledgeSummary(world, agentEid);

  return `You are generating reflective insights for an agent in a simulation.

AGENT:
- Name: ${agentName}
- Description: ${agentDesc}
- Role: ${agentRole}

RECENT EXPERIENCES (sorted by importance):
${memoryLines.join("\n")}

${knowledge ? `EXISTING KNOWLEDGE:\n${knowledge}` : ""}

Your task is to synthesize these experiences into higher-order insights.
Focus on patterns, learnings, and emotional processing.`;
}

/**
 * Format timestamp as relative time
 */
function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Generate reflective insights using LLM
 */
export async function generateReflection(
  world: World,
  agentEid: number
): Promise<ReflectionResult | null> {
  const agentName = Name.value[agentEid];

  // Get recent memories (as entity IDs)
  const memoryEids = getAgentMemories(world, agentEid);
  if (memoryEids.length === 0) {
    console.log(`[Reflection] ${agentName} has no memories to reflect on`);
    return null;
  }

  // Convert memory entity IDs to memory objects
  const memories = memoryEids.map(eid => ({
    content: Memory.content[eid],
    importance: Memory.importance[eid],
    type: Memory.type[eid],
    timestamp: Memory.timestamp[eid],
  }));

  const context = buildReflectionContext(world, agentEid, memories);

  const prompt = `Reflect on these recent experiences and generate 2-4 meaningful insights.

Each insight should:
1. Synthesize multiple experiences into a higher-level understanding
2. Be personally meaningful to this specific agent
3. Potentially inform future decisions

Respond with JSON only:
{
  "insights": [
    {
      "insight": "The realization or understanding",
      "importance": 7.5,
      "relatedMemories": ["brief reference to relevant experiences"],
      "category": "self|social|world|goal"
    }
  ],
  "questionsRaised": ["questions the agent might now have"],
  "emotionalSummary": "brief emotional state summary after reflection"
}`;

  try {
    const { text } = await generateText({
      model,
      system: context,
      prompt,
    });

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[Reflection] Failed to parse reflection JSON");
      return null;
    }

    const result = JSON.parse(jsonMatch[0]) as ReflectionResult;
    console.log(`[Reflection] ${agentName} generated ${result.insights.length} insights`);
    return result;
  } catch (error) {
    console.error("[Reflection] Error generating reflection:", error);
    return null;
  }
}

/**
 * Store reflection insights as new memories and thoughts
 */
export function storeReflectionResults(
  world: World,
  agentEid: number,
  result: ReflectionResult
): void {
  const agentName = Name.value[agentEid];

  for (const insight of result.insights) {
    // Add as high-importance semantic memory (reflections are higher-order semantic understanding)
    addMemory(world, agentEid, {
      type: "semantic",
      content: `[Reflection] ${insight.insight}`,
      importance: insight.importance,
      emotionalValence: 0, // Neutral by default
      timestamp: Date.now(),
    });

    // Also add as a thought (for immediate context)
    addThought(world, agentEid, {
      content: insight.insight,
      type: "insight",
      salience: insight.importance / 10,
    });

    console.log(`[Reflection] ${agentName} realized: "${insight.insight.slice(0, 60)}..."`);
  }

  // Update reflection state
  const stateEid = getReflectionState(world, agentEid);
  if (stateEid) {
    ReflectionState.lastReflection[stateEid] = Date.now();
    ReflectionState.importanceAccum[stateEid] = 0; // Reset accumulator
    ReflectionState.reflectionCount[stateEid] = (ReflectionState.reflectionCount[stateEid] || 0) + 1;

    // Store recent insights
    const existingInsights = JSON.parse(ReflectionState.insights[stateEid] || "[]");
    const newInsights = result.insights.map(i => ({
      insight: i.insight,
      timestamp: Date.now(),
      category: i.category,
    }));
    // Keep last 10 insights
    const allInsights = [...newInsights, ...existingInsights].slice(0, 10);
    ReflectionState.insights[stateEid] = JSON.stringify(allInsights);
  }
}

/**
 * Run reflection for an agent if threshold is exceeded
 */
export async function maybeReflect(world: World, agentEid: number): Promise<boolean> {
  if (!shouldReflect(world, agentEid)) {
    return false;
  }

  const agentName = Name.value[agentEid];
  console.log(`[Reflection] ${agentName} is reflecting on recent experiences...`);

  const result = await generateReflection(world, agentEid);
  if (result) {
    storeReflectionResults(world, agentEid, result);
    return true;
  }

  return false;
}

/**
 * Run the reflection system for all agents
 */
export async function runReflectionSystem(world: World): Promise<number> {
  const agents = query(world, [Agent, Mind]);
  let reflectionsTriggered = 0;

  for (const agentEid of agents) {
    if (!Agent.active[agentEid]) continue;

    // Ensure agent has reflection state
    let stateEid = getReflectionState(world, agentEid);
    if (!stateEid) {
      stateEid = initializeReflectionState(world, agentEid);
    }

    // Check and maybe reflect
    if (await maybeReflect(world, agentEid)) {
      reflectionsTriggered++;
    }
  }

  return reflectionsTriggered;
}

/**
 * Get recent insights for inclusion in agent context
 */
export function getRecentInsights(world: World, agentEid: number, count: number = 3): string[] {
  const stateEid = getReflectionState(world, agentEid);
  if (!stateEid) return [];

  try {
    const insightsJson = ReflectionState.insights[stateEid];
    if (!insightsJson) return [];

    const insights = JSON.parse(insightsJson) as Array<{ insight: string; timestamp: number }>;
    return insights.slice(0, count).map(i => i.insight);
  } catch {
    return [];
  }
}

/**
 * Format reflection insights for agent context
 */
export function formatInsightsForContext(world: World, agentEid: number): string {
  const insights = getRecentInsights(world, agentEid, 3);
  if (insights.length === 0) return "";

  return `RECENT REALIZATIONS:\n${insights.map(i => `- ${i}`).join("\n")}`;
}
