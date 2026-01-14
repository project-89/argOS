/**
 * Belief Revision System
 *
 * Manages belief confidence over time based on:
 * - Evidence accumulation (repeated observations increase confidence)
 * - Contradiction detection (conflicting evidence decreases confidence)
 * - Source reliability weighting
 * - Time decay for uncertain beliefs
 *
 * Based on cognitive science models of belief revision:
 * - AGM belief revision theory
 * - Bayesian updating principles
 */

import type { World } from "../ecs/world";
import { addEntity, addComponent, removeEntity, query, getRelationTargets, entityExists } from "bitecs";
import { Name, Agent, Mind, Belief, Memory } from "../ecs/components";
import { HasBelief, HasMemory } from "../ecs/relations";
import type { SystemDefinition } from "../ecs/dynamic-systems";

// ============================================================================
// Configuration
// ============================================================================

/** How often to run belief revision (ms) */
export const BELIEF_REVISION_INTERVAL = 120000; // Every 2 minutes

/** Minimum confidence for a belief to survive */
export const MIN_CONFIDENCE_THRESHOLD = 0.1;

/** Confidence boost from supporting evidence */
export const EVIDENCE_BOOST = 0.1;

/** Confidence penalty from contradictory evidence */
export const CONTRADICTION_PENALTY = 0.2;

/** Time decay rate for uncertain beliefs (per hour) */
export const UNCERTAINTY_DECAY = 0.01;

/** High confidence threshold for "firm" beliefs */
export const FIRM_BELIEF_THRESHOLD = 0.8;

/** Source reliability weights */
export const SOURCE_RELIABILITY: Record<string, number> = {
  observation: 0.9,
  experience: 0.8,
  inference: 0.7,
  testimony: 0.6,
  rumor: 0.4,
  assumption: 0.3,
};

// ============================================================================
// Belief Operations
// ============================================================================

/**
 * Get all beliefs for an agent with their full data.
 */
export function getAgentBeliefsWithData(
  world: World,
  agentEid: number
): Array<{
  eid: number;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  source: string;
  timestamp: number;
}> {
  const beliefEids = getRelationTargets(world, agentEid, HasBelief);
  const beliefs: Array<{
    eid: number;
    subject: string;
    predicate: string;
    object: string;
    confidence: number;
    source: string;
    timestamp: number;
  }> = [];

  for (const beliefEid of beliefEids) {
    if (!entityExists(world, beliefEid)) continue;

    beliefs.push({
      eid: beliefEid,
      subject: Belief.subject[beliefEid] || "",
      predicate: Belief.predicate[beliefEid] || "",
      object: Belief.object[beliefEid] || "",
      confidence: Belief.confidence[beliefEid] ?? 0.5,
      source: Belief.source[beliefEid] || "observation",
      timestamp: Belief.timestamp[beliefEid] || Date.now(),
    });
  }

  return beliefs;
}

/**
 * Check if two beliefs are about the same subject-predicate pair.
 */
export function beliefsMatch(
  belief1: { subject: string; predicate: string },
  belief2: { subject: string; predicate: string }
): boolean {
  const normalize = (s: string) => s.toLowerCase().trim();
  return (
    normalize(belief1.subject) === normalize(belief2.subject) &&
    normalize(belief1.predicate) === normalize(belief2.predicate)
  );
}

/**
 * Check if two beliefs contradict each other.
 * Beliefs contradict if they have the same subject-predicate but different objects.
 */
export function beliefsContradict(
  belief1: { subject: string; predicate: string; object: string },
  belief2: { subject: string; predicate: string; object: string }
): boolean {
  if (!beliefsMatch(belief1, belief2)) return false;

  const normalize = (s: string) => s.toLowerCase().trim();
  return normalize(belief1.object) !== normalize(belief2.object);
}

/**
 * Find beliefs that support a given belief (same subject-predicate-object).
 */
export function findSupportingBeliefs(
  beliefs: Array<{ subject: string; predicate: string; object: string; eid: number }>,
  target: { subject: string; predicate: string; object: string }
): number[] {
  const normalize = (s: string) => s.toLowerCase().trim();
  const targetKey = `${normalize(target.subject)}:${normalize(target.predicate)}:${normalize(target.object)}`;

  return beliefs
    .filter((b) => {
      const key = `${normalize(b.subject)}:${normalize(b.predicate)}:${normalize(b.object)}`;
      return key === targetKey;
    })
    .map((b) => b.eid);
}

/**
 * Find beliefs that contradict a given belief.
 */
export function findContradictingBeliefs(
  beliefs: Array<{ subject: string; predicate: string; object: string; eid: number }>,
  target: { subject: string; predicate: string; object: string }
): number[] {
  return beliefs
    .filter((b) => beliefsContradict(b, target))
    .map((b) => b.eid);
}

/**
 * Calculate new confidence based on evidence.
 */
export function calculateUpdatedConfidence(
  currentConfidence: number,
  source: string,
  supportCount: number,
  contradictionCount: number
): number {
  // Get source reliability
  const reliability = SOURCE_RELIABILITY[source] ?? 0.5;

  // Start with current confidence
  let newConfidence = currentConfidence;

  // Boost from supporting evidence (diminishing returns)
  for (let i = 0; i < supportCount; i++) {
    const boost = EVIDENCE_BOOST * reliability * (1 - newConfidence);
    newConfidence += boost;
  }

  // Penalty from contradicting evidence
  for (let i = 0; i < contradictionCount; i++) {
    newConfidence -= CONTRADICTION_PENALTY;
  }

  return Math.max(0, Math.min(1, newConfidence));
}

// ============================================================================
// Belief Revision Logic
// ============================================================================

/**
 * Apply time decay to uncertain beliefs.
 */
export function applyBeliefDecay(confidence: number, source: string, hoursSinceUpdate: number): number {
  // Firm beliefs (high confidence) don't decay
  if (confidence >= FIRM_BELIEF_THRESHOLD) {
    return confidence;
  }

  // Beliefs from reliable sources decay slower
  const reliability = SOURCE_RELIABILITY[source] ?? 0.5;
  const decayRate = UNCERTAINTY_DECAY * (1 - reliability);

  // Apply decay
  const decay = hoursSinceUpdate * decayRate;
  return Math.max(0, confidence - decay);
}

/**
 * Resolve contradictions between beliefs.
 * The more confident belief wins, but both are weakened.
 */
export function resolveContradiction(
  world: World,
  belief1Eid: number,
  belief2Eid: number
): void {
  if (!entityExists(world, belief1Eid) || !entityExists(world, belief2Eid)) return;

  const conf1 = Belief.confidence[belief1Eid] ?? 0.5;
  const conf2 = Belief.confidence[belief2Eid] ?? 0.5;
  const source1 = Belief.source[belief1Eid] || "observation";
  const source2 = Belief.source[belief2Eid] || "observation";

  // Weight by source reliability
  const rel1 = SOURCE_RELIABILITY[source1] ?? 0.5;
  const rel2 = SOURCE_RELIABILITY[source2] ?? 0.5;

  const weighted1 = conf1 * rel1;
  const weighted2 = conf2 * rel2;

  if (weighted1 > weighted2 * 1.5) {
    // Belief 1 wins strongly - remove belief 2
    removeEntity(world, belief2Eid);
  } else if (weighted2 > weighted1 * 1.5) {
    // Belief 2 wins strongly - remove belief 1
    removeEntity(world, belief1Eid);
  } else {
    // Neither wins clearly - weaken both
    Belief.confidence[belief1Eid] = Math.max(0.1, conf1 - CONTRADICTION_PENALTY);
    Belief.confidence[belief2Eid] = Math.max(0.1, conf2 - CONTRADICTION_PENALTY);
  }
}

/**
 * Run belief revision for a single agent.
 */
export function reviseAgentBeliefs(world: World, agentEid: number): {
  revised: number;
  pruned: number;
  contradictionsResolved: number;
} {
  const now = Date.now();
  const beliefs = getAgentBeliefsWithData(world, agentEid);

  let revised = 0;
  let pruned = 0;
  let contradictionsResolved = 0;

  // First pass: Apply time decay
  for (const belief of beliefs) {
    if (!entityExists(world, belief.eid)) continue;

    const hoursSinceUpdate = (now - belief.timestamp) / (1000 * 60 * 60);
    const newConfidence = applyBeliefDecay(belief.confidence, belief.source, hoursSinceUpdate);

    if (newConfidence !== belief.confidence) {
      Belief.confidence[belief.eid] = newConfidence;
      Belief.timestamp[belief.eid] = now;
      revised++;
    }

    // Prune very low confidence beliefs
    if (newConfidence < MIN_CONFIDENCE_THRESHOLD) {
      removeEntity(world, belief.eid);
      pruned++;
    }
  }

  // Second pass: Detect and resolve contradictions
  const remainingBeliefs = getAgentBeliefsWithData(world, agentEid);
  const processed = new Set<string>();

  for (const belief of remainingBeliefs) {
    if (!entityExists(world, belief.eid)) continue;

    const key = `${belief.subject}:${belief.predicate}`;
    if (processed.has(key)) continue;
    processed.add(key);

    // Find contradicting beliefs
    const contradictions = findContradictingBeliefs(remainingBeliefs, belief);

    for (const contrEid of contradictions) {
      if (contrEid === belief.eid) continue;
      if (!entityExists(world, contrEid)) continue;

      resolveContradiction(world, belief.eid, contrEid);
      contradictionsResolved++;
    }
  }

  return { revised, pruned, contradictionsResolved };
}

/**
 * Run belief revision for all agents.
 */
export function runBeliefRevision(world: World): {
  agentsProcessed: number;
  totalRevised: number;
  totalPruned: number;
  totalContradictionsResolved: number;
} {
  const agents = Array.from(query(world, [Agent, Mind]));
  let totalRevised = 0;
  let totalPruned = 0;
  let totalContradictionsResolved = 0;

  for (const agentEid of agents) {
    if (!entityExists(world, agentEid)) continue;
    if (!Agent.active[agentEid]) continue;

    const result = reviseAgentBeliefs(world, agentEid);
    totalRevised += result.revised;
    totalPruned += result.pruned;
    totalContradictionsResolved += result.contradictionsResolved;
  }

  if (totalRevised > 0 || totalPruned > 0 || totalContradictionsResolved > 0) {
    console.log(
      `[BeliefRevision] Processed ${agents.length} agents: ` +
        `${totalRevised} revised, ${totalPruned} pruned, ${totalContradictionsResolved} contradictions resolved`
    );
  }

  return {
    agentsProcessed: agents.length,
    totalRevised,
    totalPruned,
    totalContradictionsResolved,
  };
}

// ============================================================================
// Evidence Integration
// ============================================================================

/**
 * Update a belief based on new evidence.
 * Call this when an agent observes something related to an existing belief.
 */
export function updateBeliefWithEvidence(
  world: World,
  agentEid: number,
  subject: string,
  predicate: string,
  observedObject: string,
  source: string = "observation"
): void {
  const beliefs = getAgentBeliefsWithData(world, agentEid);
  const normalize = (s: string) => s.toLowerCase().trim();

  // Find existing belief about this subject-predicate
  const existing = beliefs.find(
    (b) =>
      normalize(b.subject) === normalize(subject) &&
      normalize(b.predicate) === normalize(predicate)
  );

  if (existing) {
    if (normalize(existing.object) === normalize(observedObject)) {
      // Supporting evidence - boost confidence
      const newConfidence = calculateUpdatedConfidence(
        existing.confidence,
        existing.source,
        1, // One supporting evidence
        0 // No contradictions
      );
      Belief.confidence[existing.eid] = newConfidence;
      Belief.timestamp[existing.eid] = Date.now();
    } else {
      // Contradicting evidence - create new belief or weaken existing
      const reliability = SOURCE_RELIABILITY[source] ?? 0.5;
      const existingReliability = SOURCE_RELIABILITY[existing.source] ?? 0.5;

      if (reliability > existingReliability) {
        // New evidence is more reliable - update the belief
        Belief.object[existing.eid] = observedObject;
        Belief.source[existing.eid] = source;
        Belief.confidence[existing.eid] = Math.min(existing.confidence, 0.6);
        Belief.timestamp[existing.eid] = Date.now();
      } else {
        // Existing belief is more reliable - weaken it slightly
        Belief.confidence[existing.eid] = Math.max(
          MIN_CONFIDENCE_THRESHOLD,
          existing.confidence - CONTRADICTION_PENALTY * 0.5
        );
      }
    }
  } else {
    // No existing belief - create new one
    const beliefEid = addEntity(world);
    addComponent(world, beliefEid, Belief);
    addComponent(world, agentEid, HasBelief(beliefEid));

    Belief.subject[beliefEid] = subject;
    Belief.predicate[beliefEid] = predicate;
    Belief.object[beliefEid] = observedObject;
    Belief.confidence[beliefEid] = SOURCE_RELIABILITY[source] ?? 0.5;
    Belief.source[beliefEid] = source;
    Belief.timestamp[beliefEid] = Date.now();
  }
}

// ============================================================================
// System Integration
// ============================================================================

/**
 * Create a belief revision system for registration with the system registry.
 */
export function createBeliefRevisionSystem(): SystemDefinition {
  return {
    name: "BeliefRevision",
    description: "Revises belief confidence based on evidence and time",
    pseudocode: `
FOR EACH agent WITH Agent, Mind:
  FOR EACH belief:
    Apply time decay to uncertain beliefs
    IF confidence < threshold:
      Prune belief
  FOR EACH pair of beliefs:
    IF contradicting:
      Resolve contradiction (more confident wins)
`,
    frequency: BELIEF_REVISION_INTERVAL,
    active: true,
    lastRun: 0,
    compiledFn: (world: World) => {
      runBeliefRevision(world);
    },
  };
}
