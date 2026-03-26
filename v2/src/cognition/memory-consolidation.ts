/**
 * Memory Consolidation System
 *
 * Implements memory consolidation and forgetting curves based on the
 * Generative Agents paper and cognitive psychology principles.
 *
 * Key features:
 * - Short-term to long-term memory promotion based on importance & recall
 * - Forgetting curves (memories fade over time if not recalled)
 * - Memory pruning (very old, unimportant memories are removed)
 * - Semantic memory extraction (facts derived from episodic memories)
 *
 * The forgetting curve follows Ebbinghaus:
 * R = e^(-t/S) where:
 * - R = retention strength
 * - t = time since encoding/last recall
 * - S = memory stability (importance * recallBoost)
 */

import { generateText } from "ai";
import { flashModel } from "../llm/config";
import type { World } from "../ecs/world";
import { addEntity, addComponent, removeEntity, query, getRelationTargets, entityExists } from "bitecs";
import { Name, Agent, Mind, Memory } from "../ecs/components";
import { HasMemory } from "../ecs/relations";

const model = flashModel;

// ============================================================================
// Configuration
// ============================================================================

/** How often to run consolidation (ms) */
export const CONSOLIDATION_INTERVAL = 60000; // Every minute

/** Minimum importance for a memory to survive pruning */
export const MIN_IMPORTANCE_THRESHOLD = 0.1;

/** Importance boost per recall */
export const RECALL_BOOST = 0.05;

/** Base decay rate per hour for unrecalled memories */
export const BASE_DECAY_RATE = 0.02;

/** High importance threshold for "long-term" memories */
export const LONG_TERM_THRESHOLD = 0.7;

/** Maximum memories per agent (prune oldest/least important beyond this) */
export const MAX_MEMORIES_PER_AGENT = 100;

/** Time threshold for considering memory "old" (12 hours in ms) */
export const OLD_MEMORY_THRESHOLD = 12 * 60 * 60 * 1000;

// ============================================================================
// Forgetting Curve
// ============================================================================

/**
 * Calculate retention factor using Ebbinghaus forgetting curve.
 *
 * @param timeSinceRecall - Time since last recall (ms)
 * @param stability - Memory stability (higher = more resistant to forgetting)
 * @returns Retention factor between 0 and 1
 */
export function calculateRetention(timeSinceRecall: number, stability: number): number {
  // Convert to hours for more intuitive decay rates
  const hours = timeSinceRecall / (1000 * 60 * 60);

  // Stability affects how quickly memories fade
  // Higher stability = slower decay
  const effectiveStability = Math.max(0.1, stability) * 10; // Scale for better control

  // Ebbinghaus forgetting curve: R = e^(-t/S)
  const retention = Math.exp(-hours / effectiveStability);

  return Math.max(0, Math.min(1, retention));
}

/**
 * Calculate memory stability based on importance and recall count.
 *
 * Memories that are:
 * - More important have higher stability
 * - Recalled more often have higher stability (spaced repetition effect)
 * - Emotionally significant have higher stability
 */
export function calculateStability(
  importance: number,
  recallCount: number,
  emotionalValence: number
): number {
  // Base stability from importance (0.1 - 1.0)
  let stability = importance;

  // Boost from recall count (each recall adds stability, diminishing returns)
  const recallBoost = Math.log2(1 + recallCount) * RECALL_BOOST;
  stability += recallBoost;

  // Emotional memories are more stable (both positive and negative)
  const emotionalBoost = Math.abs(emotionalValence) * 0.2;
  stability += emotionalBoost;

  return Math.min(1.5, stability); // Cap at 1.5 for very stable memories
}

// ============================================================================
// Memory Operations
// ============================================================================

/**
 * Get all memories for an agent with their full data.
 */
export function getAgentMemoriesWithData(
  world: World,
  agentEid: number
): Array<{
  eid: number;
  type: string;
  content: string;
  importance: number;
  emotionalValence: number;
  timestamp: number;
  lastRecalled: number;
  recallCount: number;
}> {
  const memoryEids = getRelationTargets(world, agentEid, HasMemory);
  const memories: Array<{
    eid: number;
    type: string;
    content: string;
    importance: number;
    emotionalValence: number;
    timestamp: number;
    lastRecalled: number;
    recallCount: number;
  }> = [];

  for (const memEid of memoryEids) {
    if (!entityExists(world, memEid)) continue;

    memories.push({
      eid: memEid,
      type: Memory.type[memEid] || "episodic",
      content: Memory.content[memEid] || "",
      importance: Memory.importance[memEid] || 0.5,
      emotionalValence: Memory.emotionalValence[memEid] || 0,
      timestamp: Memory.timestamp[memEid] || Date.now(),
      lastRecalled: Memory.lastRecalled[memEid] || Memory.timestamp[memEid] || Date.now(),
      recallCount: Memory.recallCount[memEid] || 0,
    });
  }

  return memories;
}

/**
 * Apply decay to a single memory based on time and stability.
 * Returns the new importance value.
 */
export function applyMemoryDecay(
  currentImportance: number,
  timeSinceRecall: number,
  stability: number
): number {
  const retention = calculateRetention(timeSinceRecall, stability);

  // New importance is weighted by retention
  // We don't want importance to drop too fast, so we use a gentler curve
  const decayFactor = 0.3 + 0.7 * retention; // Min 30% retention
  const newImportance = currentImportance * decayFactor;

  return Math.max(0, newImportance);
}

/**
 * Record that a memory was recalled, boosting its importance.
 */
export function recallMemory(world: World, memoryEid: number): void {
  if (!entityExists(world, memoryEid)) return;

  // Update recall count and timestamp
  const currentCount = Memory.recallCount[memoryEid] || 0;
  Memory.recallCount[memoryEid] = currentCount + 1;
  Memory.lastRecalled[memoryEid] = Date.now();

  // Boost importance slightly (spaced repetition effect)
  const currentImportance = Memory.importance[memoryEid] || 0.5;
  const boost = RECALL_BOOST * (1 - currentImportance); // Diminishing returns
  Memory.importance[memoryEid] = Math.min(1.0, currentImportance + boost);
}

// ============================================================================
// Consolidation Logic
// ============================================================================

/**
 * Run memory consolidation for a single agent.
 * - Apply forgetting curves
 * - Prune very low importance memories
 * - Limit total memory count
 */
export function consolidateAgentMemories(world: World, agentEid: number): {
  decayed: number;
  pruned: number;
  promoted: number;
} {
  const now = Date.now();
  const memories = getAgentMemoriesWithData(world, agentEid);

  let decayed = 0;
  let pruned = 0;
  let promoted = 0;

  // Process each memory
  for (const mem of memories) {
    const timeSinceRecall = now - mem.lastRecalled;
    const stability = calculateStability(mem.importance, mem.recallCount, mem.emotionalValence);

    // Apply decay
    const newImportance = applyMemoryDecay(mem.importance, timeSinceRecall, stability);

    if (newImportance < mem.importance) {
      decayed++;
    }

    // Check for promotion to "long-term" (high importance + multiple recalls)
    if (newImportance >= LONG_TERM_THRESHOLD && mem.recallCount >= 3) {
      // Long-term memories are marked by type change to "semantic" if episodic
      if (mem.type === "episodic") {
        // Keep episodic memories as-is but boost importance
        Memory.importance[mem.eid] = Math.min(1.0, newImportance + 0.1);
        promoted++;
      }
    } else {
      // Update importance
      Memory.importance[mem.eid] = newImportance;
    }

    // Prune very low importance memories that are old
    const age = now - mem.timestamp;
    if (newImportance < MIN_IMPORTANCE_THRESHOLD && age > OLD_MEMORY_THRESHOLD) {
      removeEntity(world, mem.eid);
      pruned++;
    }
  }

  // If still over max, prune oldest low-importance memories
  const remainingMemories = getAgentMemoriesWithData(world, agentEid);
  if (remainingMemories.length > MAX_MEMORIES_PER_AGENT) {
    // Sort by importance, then by age (keep important and recent)
    const sorted = remainingMemories.sort((a, b) => {
      // Combine importance and recency into a "keep score"
      const scoreA = a.importance * 0.7 + (1 - (now - a.timestamp) / OLD_MEMORY_THRESHOLD) * 0.3;
      const scoreB = b.importance * 0.7 + (1 - (now - b.timestamp) / OLD_MEMORY_THRESHOLD) * 0.3;
      return scoreB - scoreA; // Higher scores first
    });

    // Remove memories beyond the max
    const toRemove = sorted.slice(MAX_MEMORIES_PER_AGENT);
    for (const mem of toRemove) {
      if (entityExists(world, mem.eid)) {
        removeEntity(world, mem.eid);
        pruned++;
      }
    }
  }

  return { decayed, pruned, promoted };
}

/**
 * Run memory consolidation for all agents.
 */
export function runMemoryConsolidation(world: World): {
  agentsProcessed: number;
  totalDecayed: number;
  totalPruned: number;
  totalPromoted: number;
} {
  const agents = Array.from(query(world, [Agent, Mind]));
  let totalDecayed = 0;
  let totalPruned = 0;
  let totalPromoted = 0;

  for (const agentEid of agents) {
    if (!entityExists(world, agentEid)) continue;
    if (!Agent.active[agentEid]) continue;

    const result = consolidateAgentMemories(world, agentEid);
    totalDecayed += result.decayed;
    totalPruned += result.pruned;
    totalPromoted += result.promoted;
  }

  if (totalDecayed > 0 || totalPruned > 0 || totalPromoted > 0) {
    console.log(
      `[MemoryConsolidation] Processed ${agents.length} agents: ` +
        `${totalDecayed} decayed, ${totalPruned} pruned, ${totalPromoted} promoted`
    );
  }

  return {
    agentsProcessed: agents.length,
    totalDecayed,
    totalPruned,
    totalPromoted,
  };
}

// ============================================================================
// Semantic Memory Extraction
// ============================================================================

/**
 * Extract semantic knowledge from multiple episodic memories.
 * Uses LLM to identify patterns and facts.
 */
export async function extractSemanticMemory(
  world: World,
  agentEid: number
): Promise<string[]> {
  const agentName = Name.value[agentEid];
  const memories = getAgentMemoriesWithData(world, agentEid);

  // Filter to episodic memories that are important
  const episodic = memories
    .filter((m) => m.type === "episodic" && m.importance > 0.5)
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 20);

  if (episodic.length < 5) {
    // Not enough memories to extract patterns
    return [];
  }

  const memoryList = episodic
    .map((m) => `- ${m.content}`)
    .join("\n");

  const prompt = `You are extracting factual knowledge from an agent's experiences.

Agent: ${agentName}

Recent important experiences:
${memoryList}

Extract 2-5 factual statements that can be inferred from these experiences.
Focus on:
- Facts about people (who is friendly, who is dangerous, etc.)
- Facts about places (what can be found where)
- Facts about routines (what happens at certain times)
- General knowledge (how things work)

Output ONLY a JSON array of strings:
["Fact 1", "Fact 2", "Fact 3"]`;

  try {
    const { text } = await generateText({
      model,
      prompt,
    });

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const facts = JSON.parse(jsonMatch[0]) as string[];
    return facts;
  } catch {
    return [];
  }
}

// ============================================================================
// System Integration
// ============================================================================

import type { SystemDefinition } from "../ecs/dynamic-systems";

/**
 * Create a memory consolidation system for registration with the system registry.
 */
export function createMemoryConsolidationSystem(): SystemDefinition {
  return {
    name: "MemoryConsolidation",
    description: "Applies forgetting curves and consolidates agent memories",
    pseudocode: `
FOR EACH agent WITH Agent, Mind:
  FOR EACH memory:
    Calculate stability from importance, recall count, emotional valence
    Apply Ebbinghaus forgetting curve based on time since recall
    IF importance < threshold AND memory is old:
      Prune memory
    IF importance > long-term threshold AND recall count >= 3:
      Mark as consolidated
  IF memory count > max:
    Prune lowest-value memories
`,
    frequency: CONSOLIDATION_INTERVAL,
    active: true,
    lastRun: 0,
    compiledFn: (world: World) => {
      runMemoryConsolidation(world);
    },
  };
}

/**
 * Create a semantic extraction system that periodically extracts facts.
 * This runs less frequently than consolidation.
 */
export function createSemanticExtractionSystem(): SystemDefinition {
  return {
    name: "SemanticExtraction",
    description: "Extracts semantic facts from episodic memories",
    pseudocode: `
FOR EACH agent WITH many episodic memories:
  Use LLM to identify patterns and facts
  Create semantic memory entities for extracted facts
`,
    frequency: 300000, // Every 5 minutes
    active: false, // Disabled by default (expensive)
    async: true,
    lastRun: 0,
    compiledFn: async (world: World) => {
      const agents = Array.from(query(world, [Agent, Mind]));

      for (const agentEid of agents) {
        if (!entityExists(world, agentEid)) continue;
        if (!Agent.active[agentEid]) continue;

        const facts = await extractSemanticMemory(world, agentEid);
        const agentName = Name.value[agentEid];

        for (const fact of facts) {
          // Create semantic memory
          const memEid = addEntity(world);
          addComponent(world, memEid, Memory);
          addComponent(world, agentEid, HasMemory(memEid));

          Memory.type[memEid] = "semantic";
          Memory.content[memEid] = fact;
          Memory.importance[memEid] = 0.7; // Semantic facts are important
          Memory.emotionalValence[memEid] = 0;
          Memory.timestamp[memEid] = Date.now();
          Memory.lastRecalled[memEid] = Date.now();
          Memory.recallCount[memEid] = 0;

          console.log(`[SemanticExtraction] ${agentName} learned: ${fact}`);
        }
      }
    },
  };
}
