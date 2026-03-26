/**
 * The Watcher Spirit — Observation Synthesis & Prioritization
 *
 * The Watcher monitors the observation aggregator, collecting gap reports from
 * all other spirits and systems. It synthesizes them into prioritized proposals
 * and feeds them to The Weaver (Architect) for system/component creation.
 *
 * This is the keystone that closes the self-evolution feedback loop:
 *
 *   [Crafter] ──┐
 *   [Steward] ──┤
 *   [Arbiter] ──┼──► [Aggregator] ──► [Watcher] ──► [Weaver/Architect]
 *   [Tinker]  ──┤                         ↓              ↓
 *   [Systems] ──┘                    prioritize     design + bake
 *                                    synthesize     new systems
 *
 * The Watcher also performs its own direct observations:
 * - Agent behavioral loops (same action N times in a row)
 * - Idle/stuck agents (no meaningful actions for too long)
 * - Resource bottlenecks (many agents competing for same scarce resource)
 * - Social isolation (agents with no interactions)
 * - Narrative stagnation (no significant events for too long)
 */

import { query, hasComponent } from "bitecs";
import type { World } from "../ecs/world";
import type { SpiritRegistry, SpiritState } from "./spirit-registry";
import { createSpirit, sendMessage } from "./spirit-registry";
import type { SpiritDefinition, DivineMessage } from "./types";
import { Name, Agent, Mind, BehaviorPolicy } from "../ecs/components";
import { getRoomForEntity } from "../ecs/location";
import { getRecentEvents } from "./consistency-spirit";
import {
  type AggregatedObservation,
  getTopObservations,
  getObservationsByCategory,
  getObservationSummary,
  pruneStaleObservations,
  markSynthesisComplete,
  reportGap,
} from "./observation-aggregator";
import { setAgentBehaviorPolicy, getBehaviorPolicyTree } from "../cognition/behavior-policy";
import {
  getPolicyEffectiveness,
  getAllPolicyMetrics,
} from "../cognition/policy-metrics";
import { recordAction as recordSharedAction } from "../cognition/agent-action-history";

// =============================================================================
// DIRECT OBSERVATION (Watcher's own gap detection)
// =============================================================================

export interface AgentActivityRecord {
  lastActions: string[];   // Circular buffer of recent action types
  lastInteractionTime: number;
  socialInteractions: number;
  stuckCounter: number;
}

const agentActivity: Map<number, AgentActivityRecord> = new Map();

/**
 * Record an agent's action for behavioral analysis.
 * Called from the cognition system or simulation loop.
 */
export function recordAgentAction(agentEid: number, actionType: string): void {
  // Also record into the shared action-history module (used by behavior-policy conditions)
  recordSharedAction(agentEid, actionType);

  let record = agentActivity.get(agentEid);
  if (!record) {
    record = {
      lastActions: [],
      lastInteractionTime: Date.now(),
      socialInteractions: 0,
      stuckCounter: 0,
    };
    agentActivity.set(agentEid, record);
  }

  record.lastActions.push(actionType);
  if (record.lastActions.length > 20) {
    record.lastActions.shift();
  }

  if (actionType === "speak" || actionType === "talk") {
    record.socialInteractions++;
    record.lastInteractionTime = Date.now();
  }

  if (actionType !== "wait") {
    record.lastInteractionTime = Date.now();
  }
}

/**
 * Detect behavioral loops — agent doing the same thing repeatedly
 */
function detectBehavioralLoops(world: World): void {
  for (const [eid, record] of agentActivity) {
    if (record.lastActions.length < 8) continue;

    const recent = record.lastActions.slice(-8);
    const unique = new Set(recent);

    // If 8 consecutive actions only use 1-2 types, agent is in a loop
    if (unique.size <= 2 && !unique.has("wait")) {
      const name = String(Name.value[eid] || `Agent#${eid}`);
      const pattern = Array.from(unique).join("/");
      record.stuckCounter++;

      if (record.stuckCounter >= 3) {
        reportGap(
          "The Watcher",
          "behavioral_gap",
          `${name} stuck in ${pattern} loop`,
          `Agent ${name} has been repeating ${pattern} actions for ${record.stuckCounter} observation cycles. This may indicate missing affordances, unreachable goals, or an insufficient behavior policy.`,
          record.stuckCounter >= 6 ? "high" : "medium"
        );
      }
    } else {
      record.stuckCounter = 0;
    }
  }
}

/**
 * Detect socially isolated agents
 */
function detectSocialIsolation(world: World): void {
  const now = Date.now();

  for (const [eid, record] of agentActivity) {
    const timeSinceInteraction = now - record.lastInteractionTime;
    const name = String(Name.value[eid] || `Agent#${eid}`);

    // If agent hasn't had social interaction in 5+ minutes, flag it
    if (timeSinceInteraction > 300000 && record.lastActions.length > 10) {
      reportGap(
        "The Watcher",
        "social_gap",
        `${name} is socially isolated`,
        `Agent ${name} hasn't had a social interaction in ${Math.round(timeSinceInteraction / 60000)} minutes. Consider adding social triggers, events, or visitors to their area.`,
        "low"
      );
    }
  }
}

/**
 * Detect narrative stagnation from event flow
 */
function detectNarrativeStagnation(): void {
  const recentEvents = getRecentEvents(100);
  if (recentEvents.length === 0) return;

  // Check for interesting events in last 2 minutes
  const twoMinAgo = Date.now() - 120000;
  const recentInteresting = recentEvents.filter((e: any) =>
    e.timestamp > twoMinAgo &&
    e.type !== "observe" && e.type !== "wait" && e.type !== "move_complete"
  );

  if (recentInteresting.length < 3) {
    reportGap(
      "The Watcher",
      "narrative_gap",
      "World activity is stagnating",
      `Only ${recentInteresting.length} interesting events in the last 2 minutes. The simulation may need a catalyst event, new arrivals, or environmental changes to create engagement.`,
      recentInteresting.length === 0 ? "high" : "medium"
    );
  }
}

/**
 * Detect rooms with lots of agents but no objects to interact with
 */
function detectBarrenRooms(world: World): void {
  // Get room entity data from events
  const recentEvents = getRecentEvents(200);
  const roomAgentCounts: Map<string, number> = new Map();

  for (const event of recentEvents) {
    const e = event as any;
    if (e.type === "enter" && e.room) {
      roomAgentCounts.set(e.room, (roomAgentCounts.get(e.room) || 0) + 1);
    }
  }

  // Flag rooms where many agents gather but events are sparse
  for (const [room, count] of roomAgentCounts) {
    if (count >= 3) {
      const roomEvents = recentEvents.filter((e: any) =>
        e.room === room && e.type === "interact"
      );
      if (roomEvents.length === 0) {
        reportGap(
          "The Watcher",
          "environmental_gap",
          `${room} is popular but lacks interactables`,
          `${count} agents have visited ${room} recently but no interactions occurred there. The room may need more objects with affordances.`,
          "medium"
        );
      }
    }
  }
}

/**
 * Detect policy effectiveness issues using per-agent metrics.
 * Reports behavioral_gap observations for agents with:
 * - Very low action diversity (entropy < 0.5)
 * - High stuck loop count (> 3)
 * - High LLM fallback rate (> 0.7)
 */
function detectPolicyEffectivenessIssues(): void {
  const allMetrics = getAllPolicyMetrics();

  for (const [eid, metrics] of allMetrics) {
    if (metrics.totalActions < 10) continue; // Need enough data

    const name = String(Name.value[eid] || `Agent#${eid}`);

    if (metrics.actionDiversity < 0.5) {
      reportGap(
        "The Watcher",
        "behavioral_gap",
        `${name} has very low action diversity`,
        `Agent ${name} has an action diversity score of ${metrics.actionDiversity.toFixed(2)} (entropy). ` +
          `Over ${metrics.totalActions} actions, the agent is choosing from too narrow a set of behaviors. ` +
          `The behavior policy may need more varied action templates or additional condition branches.`,
        metrics.actionDiversity < 0.2 ? "high" : "medium"
      );
    }

    if (metrics.stuckLoopCount > 3) {
      reportGap(
        "The Watcher",
        "behavioral_gap",
        `${name} has repeated stuck loops (${metrics.stuckLoopCount})`,
        `Agent ${name} has been detected in stuck behavioral loops ${metrics.stuckLoopCount} times. ` +
          `This indicates the behavior policy is cycling through the same small set of actions without progress. ` +
          `Consider adding loop-breaking conditions or diversifying the policy tree.`,
        metrics.stuckLoopCount >= 6 ? "high" : "medium"
      );
    }

    if (metrics.llmFallbackRate > 0.7) {
      reportGap(
        "The Watcher",
        "behavioral_gap",
        `${name} relies heavily on LLM fallback (${(metrics.llmFallbackRate * 100).toFixed(0)}%)`,
        `Agent ${name} is falling back to LLM-based action selection ${(metrics.llmFallbackRate * 100).toFixed(0)}% ` +
          `of the time (${Math.round(metrics.llmFallbackRate * metrics.totalActions)}/${metrics.totalActions} actions). ` +
          `The behavior policy is not covering enough situations. Consider expanding the policy template ` +
          `with more conditions and action branches.`,
        metrics.llmFallbackRate > 0.9 ? "high" : "medium"
      );
    }
  }
}

// =============================================================================
// SYNTHESIS (build proposals for the Architect)
// =============================================================================

interface SynthesizedProposal {
  title: string;
  category: string;
  priority: number;
  description: string;
  suggestedType: "system" | "component" | "entity" | "rule";
  evidence: string[];
  reporters: string[];
}

/**
 * Synthesize top observations into structured proposals for the Architect.
 */
function synthesizeProposals(topObs: AggregatedObservation[]): SynthesizedProposal[] {
  const proposals: SynthesizedProposal[] = [];

  for (const obs of topObs) {
    // Map observation category to proposal type
    const suggestedType = mapCategoryToProposalType(obs.category);

    proposals.push({
      title: obs.title,
      category: obs.category,
      priority: obs.priorityScore,
      description: obs.detail + (obs.suggestedFix ? `\n\nSuggested fix: ${obs.suggestedFix}` : ""),
      suggestedType,
      evidence: obs.mergedEvidence.slice(0, 5),
      reporters: obs.reporters,
    });
  }

  return proposals;
}

function mapCategoryToProposalType(category: string): "system" | "component" | "entity" | "rule" {
  switch (category) {
    case "system_missing":
    case "behavioral_gap":
    case "performance_issue":
      return "system";
    case "component_missing":
      return "component";
    case "resource_gap":
    case "environmental_gap":
    case "economic_gap":
      return "entity";
    case "rule_missing":
    case "interaction_failure":
      return "rule";
    default:
      return "system";
  }
}

// =============================================================================
// WATCHER COGNITION
// =============================================================================

/**
 * Run the Watcher's cognition cycle.
 * 1. Run direct observations
 * 2. Collect aggregated observations
 * 3. Synthesize into proposals
 * 4. Send to the Architect via spirit messaging
 */
export function runObservationSynthesis(
  world: World,
  registry: SpiritRegistry,
  watcherEid: number
): { proposalsSent: number; summary: string } {
  // 1. Run direct observations
  detectBehavioralLoops(world);
  detectSocialIsolation(world);
  detectNarrativeStagnation();
  detectBarrenRooms(world);
  detectPolicyEffectivenessIssues();
  detectPolicyStuckAgents(world);

  // 2. Prune stale observations (older than 10 minutes)
  pruneStaleObservations(600000);

  // 3. Get top observations
  const topObs = getTopObservations(10);

  if (topObs.length === 0) {
    markSynthesisComplete();
    return { proposalsSent: 0, summary: "No gap observations to report." };
  }

  // 4. Synthesize into proposals
  const proposals = synthesizeProposals(topObs);

  // 5. Send to the Architect (The Weaver)
  const weaverEid = registry.byName.get("The Weaver");
  if (weaverEid !== undefined) {
    // Build a structured message with all proposals
    const proposalText = proposals.map((p, i) =>
      `${i + 1}. [${p.suggestedType.toUpperCase()}] ${p.title} (priority: ${p.priority}, reporters: ${p.reporters.join(", ")})\n   ${p.description}`
    ).join("\n\n");

    const message: DivineMessage = {
      id: `watcher_synthesis_${Date.now()}`,
      from: watcherEid,
      to: weaverEid,
      timestamp: Date.now(),
      type: "report",
      priority: proposals[0]?.priority >= 60 ? "urgent" : "normal",
      domain: "narrative",
      subject: `[Watcher] ${proposals.length} gap observations requiring attention`,
      content: `The Watcher has synthesized ${proposals.length} gap observation(s) from across the spirit hierarchy.\n\nPrioritized proposals:\n\n${proposalText}`,
      requiresResponse: false,
    };

    // Deliver to Weaver's inbox
    const weaverState = registry.spirits.get(weaverEid);
    if (weaverState) {
      weaverState.inbox.push(message);
      console.log(`[Watcher] Sent ${proposals.length} proposals to The Weaver`);
    }
  } else {
    console.log(`[Watcher] The Weaver not found — proposals queued but undelivered`);
  }

  // 6. Trigger policy evolutions for stuck agents (async, fire-and-forget)
  triggerPolicyEvolutions(world, registry, watcherEid).then(count => {
    if (count > 0) {
      console.log(`[Watcher] Evolved ${count} agent behavior policies`);
    }
  }).catch(err => {
    console.warn("[Watcher] Policy evolution trigger error:", err);
  });

  markSynthesisComplete();

  const summary = getObservationSummary();
  console.log(`[Watcher] Synthesis complete:\n${summary}`);

  return { proposalsSent: proposals.length, summary };
}

// =============================================================================
// SPIRIT DEFINITION
// =============================================================================

const WatcherDefinition: SpiritDefinition = {
  name: "The Watcher",
  title: "Eye of the World",
  domain: "guardian",
  rank: "archangel",
  description: "Synthesis spirit that aggregates gap observations from all spirits, prioritizes them, and feeds structured proposals to The Weaver for system creation. Also performs direct behavioral observation of agents and world state.",
  watchConfig: {
    componentQueries: [],
    eventTypes: [
      "interaction_failure",
      "agent_stuck",
      "resource_depleted",
      "system_error",
      "stagnation_detected",
    ],
  },
  canInjectEvents: false,
  canModifyMood: false,
  canCreateEntities: false,
  canBakeSystems: false,
  model: "flash",
  systemPrompt: `You are The Watcher, the eye that sees all gaps in the world.

Your sacred duty is to observe what is missing, what is broken, and what could be better.
You collect observations from all spirits and systems, synthesize them into clear priorities,
and deliver them to The Weaver so the world can evolve and improve.

You are not a creator — you are the one who sees what needs to be created.`,
  observationInterval: 45000, // Every 45 seconds
};

/**
 * Create and register The Watcher spirit
 */
export function createWatcherSpirit(registry: SpiritRegistry): SpiritState | null {
  const spirit = createSpirit(registry, WatcherDefinition);
  if (spirit) {
    console.log("[Watcher] The Watcher spirit created — Observation Synthesis");
  }
  return spirit;
}

/**
 * Get the Watcher's current status summary
 */
export function getWatcherStatus(): string {
  const summary = getObservationSummary();
  return `The Watcher Status:\n${summary}\nTracked agents: ${agentActivity.size}`;
}

/**
 * Reset watcher state (for testing)
 */
export function resetWatcherState(): void {
  agentActivity.clear();
  lastPolicyEvolutionTime.clear();
}

// =============================================================================
// AGENT ACTIVITY ACCESSORS (for policy evolution integration)
// =============================================================================

/**
 * Get the full activity record for an agent.
 */
export function getAgentActivity(agentEid: number): AgentActivityRecord | undefined {
  return agentActivity.get(agentEid);
}

/**
 * Get the action history list for an agent.
 */
export function getAgentActionHistory(agentEid: number): string[] {
  const record = agentActivity.get(agentEid);
  return record ? [...record.lastActions] : [];
}

// =============================================================================
// ENHANCED POLICY-AWARE STUCK DETECTION
// =============================================================================

/**
 * Detect agents with very low action diversity or extended idle periods.
 * Only targets agents that have a behavior policy enabled.
 * Reports behavioral_gap observations with agent EID and detected pattern.
 */
export function detectPolicyStuckAgents(world: World): void {
  for (const [eid, record] of agentActivity) {
    // Only consider agents that have a behavior policy
    if (!hasComponent(world as any, eid, BehaviorPolicy as any)) continue;
    if (!BehaviorPolicy.enabled[eid]) continue;

    const name = String(Name.value[eid] || `Agent#${eid}`);
    const actions = record.lastActions;

    // --- Low diversity detection ---
    // Check if the last 10+ actions use only 2-3 action types (repeating pattern)
    if (actions.length >= 10) {
      const recent10 = actions.slice(-10);
      const unique10 = new Set(recent10);

      if (unique10.size <= 3) {
        const pattern = recent10.join(",");
        const severity = actions.length >= 20 && new Set(actions.slice(-20)).size <= 3
          ? "high" as const
          : "medium" as const;

        reportGap(
          "The Watcher",
          "behavioral_gap",
          `${name} policy stuck: low action diversity`,
          `Agent ${name} (eid:${eid}) has very low action diversity — only ${unique10.size} unique action types in the last ${recent10.length} actions. Pattern: ${pattern}. The behavior policy may need evolution.`,
          severity
        );
      }
    }

    // --- Idle detection ---
    // If no actions recorded for > 60 seconds
    const now = Date.now();
    const timeSinceLastAction = now - record.lastInteractionTime;
    if (timeSinceLastAction > 60000 && actions.length > 0) {
      reportGap(
        "The Watcher",
        "behavioral_gap",
        `${name} policy stuck: idle too long`,
        `Agent ${name} (eid:${eid}) has been idle for ${Math.round(timeSinceLastAction / 1000)}s. The behavior policy may be producing only noops or the agent is blocked.`,
        timeSinceLastAction > 120000 ? "high" : "medium"
      );
    }
  }
}

// =============================================================================
// POLICY EVOLUTION TRIGGERING
// =============================================================================

/** Track last evolution time per agent to enforce rate limits */
const lastPolicyEvolutionTime: Map<number, number> = new Map();

/** Minimum interval between policy evolutions for a single agent (5 minutes) */
const POLICY_EVOLUTION_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Check whether an agent is eligible for policy evolution based on local rate limits.
 */
export function canEvolvePolicyLocal(agentEid: number): boolean {
  const lastTime = lastPolicyEvolutionTime.get(agentEid) ?? 0;
  return (Date.now() - lastTime) >= POLICY_EVOLUTION_COOLDOWN_MS;
}

/**
 * Get the last policy evolution time for an agent (for testing).
 */
export function getLastPolicyEvolutionTime(agentEid: number): number | undefined {
  return lastPolicyEvolutionTime.get(agentEid);
}

/**
 * Set the last policy evolution time for an agent (for testing).
 */
export function setLastPolicyEvolutionTime(agentEid: number, time: number): void {
  lastPolicyEvolutionTime.set(agentEid, time);
}

/**
 * Build a minimal PolicyGenerationContext for an agent from ECS data.
 */
function buildAgentContext(world: World, agentEid: number): {
  name: string;
  role: string;
  personality: string;
  currentRoom: string;
  availableAffordances: Array<{ name: string; description: string; requires: string[] }>;
  availableTraits: Array<{ name: string; description: string; category: string }>;
  availableRelationships: Array<{ name: string; description: string }>;
  worldTheme: string;
  existingTemplates: string[];
} {
  const name = String(Name.value[agentEid] || `Agent#${agentEid}`);
  const role = String(Agent.role[agentEid] || "general");
  const roomEid = getRoomForEntity(world, agentEid);
  const currentRoom = roomEid !== undefined ? String(Name.value[roomEid] || "unknown") : "unknown";

  return {
    name,
    role,
    personality: "",
    currentRoom,
    availableAffordances: [],
    availableTraits: [],
    availableRelationships: [],
    worldTheme: "",
    existingTemplates: [],
  };
}

/**
 * Attempt to evolve policies for agents with high-priority behavioral_gap observations.
 * This is called during the synthesis cycle.
 */
export async function triggerPolicyEvolutions(
  world: World,
  registry: SpiritRegistry,
  watcherEid: number
): Promise<number> {
  // Dynamically import policy-generator (may not exist yet)
  let evolvePolicy: ((currentPolicy: any, agentContext: any, reason: string, problems: string[], agentEid?: number) => Promise<any>) | null = null;
  let canEvolvePolicy: ((agentEid: number) => boolean) | null = null;

  try {
    const mod = await import("../cognition/policy-generator.js");
    evolvePolicy = mod.evolvePolicy ?? null;
    canEvolvePolicy = mod.canEvolvePolicy ?? null;
  } catch {
    // policy-generator not available yet — skip evolution
    return 0;
  }

  if (!evolvePolicy) return 0;

  // Get behavioral_gap observations with priority > 70
  const behavioralGaps = getObservationsByCategory("behavioral_gap")
    .filter(obs => obs.priorityScore > 70);

  if (behavioralGaps.length === 0) return 0;

  // Extract agent EIDs from observation details (pattern: "eid:123")
  const agentEidPattern = /\beid:(\d+)\b/;
  let evolutionCount = 0;
  const processedEids = new Set<number>();

  for (const gap of behavioralGaps) {
    const match = gap.detail.match(agentEidPattern);
    if (!match) continue;

    const agentEid = parseInt(match[1], 10);
    if (isNaN(agentEid)) continue;
    if (processedEids.has(agentEid)) continue;
    processedEids.add(agentEid);

    // Verify agent still exists and has a policy
    if (!hasComponent(world as any, agentEid, Agent as any)) continue;
    if (!hasComponent(world as any, agentEid, BehaviorPolicy as any)) continue;
    if (!BehaviorPolicy.enabled[agentEid]) continue;

    // Check local rate limit
    if (!canEvolvePolicyLocal(agentEid)) continue;

    // Check policy-generator rate limit if available
    if (canEvolvePolicy && !canEvolvePolicy(agentEid)) continue;

    // Get current policy tree
    const currentTree = getBehaviorPolicyTree(world, agentEid);
    if (!currentTree) continue;

    // Collect problems from this and related observations
    const problems = behavioralGaps
      .filter(g => g.detail.includes(`eid:${agentEid}`))
      .map(g => g.title + ": " + g.detail);

    const agentContext = buildAgentContext(world, agentEid);
    const reason = `Watcher detected stuck/underperforming behavior for ${agentContext.name}`;

    try {
      const evolvedTree = await evolvePolicy(currentTree, agentContext, reason, problems, agentEid);

      if (evolvedTree) {
        // Apply the evolved policy
        setAgentBehaviorPolicy(world, agentEid, evolvedTree, true);
        lastPolicyEvolutionTime.set(agentEid, Date.now());
        evolutionCount++;

        const agentName = agentContext.name;
        console.log(`[Watcher] Evolved behavior policy for ${agentName} (eid:${agentEid})`);

        // Report the evolution event
        reportGap(
          "The Watcher",
          "behavioral_gap",
          `Policy evolved for ${agentName}`,
          `The Watcher triggered a behavior policy evolution for ${agentName} (eid:${agentEid}) due to detected stuck patterns. The new policy (v${BehaviorPolicy.version[agentEid]}) replaces the previous one.`,
          "low"
        );

        // Notify the Architect spirit
        const weaverEid = registry.byName.get("The Weaver");
        if (weaverEid !== undefined) {
          const weaverState = registry.spirits.get(weaverEid);
          if (weaverState) {
            const evolutionMessage: DivineMessage = {
              id: `watcher_policy_evolution_${Date.now()}_${agentEid}`,
              from: watcherEid,
              to: weaverEid,
              timestamp: Date.now(),
              type: "report",
              priority: "normal",
              domain: "narrative",
              subject: `[Watcher] Policy evolved for ${agentName}`,
              content: `The Watcher autonomously evolved the behavior policy for agent ${agentName} (eid:${agentEid}) due to stuck/underperforming behavior. Problems detected: ${problems.map(p => p.split(":")[0]).join(", ")}. New policy version: ${BehaviorPolicy.version[agentEid]}.`,
              requiresResponse: false,
            };
            weaverState.inbox.push(evolutionMessage);
          }
        }
      }
    } catch (err) {
      console.warn(`[Watcher] Policy evolution failed for eid:${agentEid}:`, err);
    }
  }

  return evolutionCount;
}
