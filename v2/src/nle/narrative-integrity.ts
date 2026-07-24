/**
 * Narrative Integrity — Self-Healing Story Engine
 *
 * Westworld model: narrative roles are slots, NPCs fill them.
 * When an NPC is removed (dies, leaves, becomes unavailable),
 * the engine:
 *   1. Detects the gap (critical role unfilled)
 *   2. Evaluates which remaining NPCs could absorb the role
 *   3. Redistributes: transfers secrets, adjusts motivations, reassigns beats
 *   4. Tracks narrative integrity — too many changes = story degradation
 *
 * The integrity score (0-100) measures how much of the original scaffold
 * is still intact. Below 30%, the narrative is considered broken and
 * the system can trigger a full scaffold regeneration.
 */

import { query, hasComponent, entityExists } from "bitecs";
import { generateText } from "ai";
import { agentModel } from "../llm/config";
import { extractJSON } from "../llm/json-extract";
import type { World } from "../ecs/world";
import { Agent, Name, Description } from "../ecs/components";
import { getRoomForEntity } from "../ecs/location";
import { addMemory } from "../cognition/knowledge-graph";
import { getActiveGoals } from "../cognition/cognition-system";
import { getAspirations, setAspirations } from "../cognition/goal-learning";
import { chronicle } from "../cognition/simulation-chronicle";
import {
  getStoryScaffold,
  updateStoryScaffold,
  generateStoryScaffold,
  type StoryScaffoldData,
  type NpcNarrativeRole,
  type NarrativeTension,
} from "./story-scaffold";

// =============================================================================
// INTEGRITY STATE
// =============================================================================

/** History of narrative adaptations for integrity tracking */
interface NarrativeAdaptation {
  timestamp: number;
  type: "role_redistributed" | "beat_reassigned" | "tension_abandoned" | "scaffold_regenerated";
  from: string;    // Original NPC/beat
  to: string;      // New NPC/beat
  reason: string;
  integrityImpact: number;  // How much this adaptation cost (0-20)
}

const adaptationHistory: NarrativeAdaptation[] = [];

// =============================================================================
// INTEGRITY SCORE
// =============================================================================

/**
 * Calculate narrative integrity (0-100).
 *
 * 100 = original scaffold fully intact
 * 70+ = some adaptations, story still coherent
 * 40-70 = significant changes, story holding but strained
 * Below 40 = narrative degradation, consider regeneration
 * Below 20 = story is broken
 */
export function calculateNarrativeIntegrity(world: World): {
  score: number;
  status: "intact" | "adapted" | "strained" | "degraded" | "broken";
  details: string;
} {
  const scaffold = getStoryScaffold(world);
  if (!scaffold) return { score: 0, status: "broken", details: "No scaffold exists" };

  let score = 100;

  // Check role coverage — each unfilled role costs integrity
  const agents = Array.from(query(world as any, [Agent as any, Name as any]));
  const agentNames = new Set(agents.map(eid => (Name.value[eid] || "").toLowerCase()));

  let filledRoles = 0;
  let totalRoles = scaffold.npcRoles.length;
  const missingRoles: string[] = [];

  for (const role of scaffold.npcRoles) {
    if (agentNames.has(role.name.toLowerCase())) {
      filledRoles++;
    } else {
      missingRoles.push(`${role.name} (${role.role})`);
      // Critical roles cost more
      const cost = role.role === "protagonist" ? 25 :
                   role.role === "antagonist" ? 20 :
                   role.role === "catalyst" ? 15 : 10;
      score -= cost;
    }
  }

  // Check tension viability — tensions with all involved NPCs gone are dead
  for (const tension of scaffold.tensions) {
    if (tension.status !== "active") continue;
    const involvedPresent = tension.involvedNpcs.filter(n => agentNames.has(n.toLowerCase()));
    if (involvedPresent.length === 0) {
      score -= 15; // Dead tension
    } else if (involvedPresent.length < tension.involvedNpcs.length * 0.5) {
      score -= 8; // Weakened tension
    }
  }

  // Adaptation cost — each past adaptation reduces integrity slightly
  const adaptationCost = adaptationHistory.reduce((sum, a) => sum + a.integrityImpact, 0);
  score -= Math.min(30, adaptationCost); // Cap at 30 points from adaptations

  score = Math.max(0, Math.min(100, score));

  const status = score >= 70 ? "intact" :
                 score >= 50 ? "adapted" :
                 score >= 30 ? "strained" :
                 score >= 15 ? "degraded" : "broken";

  const details = missingRoles.length > 0
    ? `Missing: ${missingRoles.join(", ")}. ${adaptationHistory.length} adaptations made.`
    : `All roles filled. ${adaptationHistory.length} adaptations made.`;

  return { score, status, details };
}

// =============================================================================
// ROLE REDISTRIBUTION — the core Westworld mechanism
// =============================================================================

/**
 * Check for missing NPCs and redistribute their narrative roles.
 * Call periodically from the NarrativeDirector.
 *
 * Returns the number of roles redistributed.
 */
export async function healNarrative(world: World): Promise<number> {
  const scaffold = getStoryScaffold(world);
  if (!scaffold) return 0;

  const agents = Array.from(query(world as any, [Agent as any, Name as any]));
  const agentNames = new Set(agents.map(eid => (Name.value[eid] || "").toLowerCase()));

  // Find roles with missing NPCs
  const missingRoles = scaffold.npcRoles.filter(r =>
    !agentNames.has(r.name.toLowerCase()));

  if (missingRoles.length === 0) return 0;

  // Find available NPCs who could absorb roles
  const availableNpcs = scaffold.npcRoles.filter(r =>
    agentNames.has(r.name.toLowerCase()));

  if (availableNpcs.length === 0) {
    // Everyone is gone — story is broken
    chronicle.record("crisis_event", {
      name: "Narrative Collapse",
      description: "All narrative role holders have been removed. Story integrity critical.",
    });
    return 0;
  }

  let redistributed = 0;

  for (const missing of missingRoles) {
    // Check integrity — don't redistribute if we're already too degraded
    const integrity = calculateNarrativeIntegrity(world);
    if (integrity.score < 15) {
      console.log(`[NLE] Narrative integrity too low (${integrity.score}) — cannot redistribute more roles`);
      break;
    }

    // Find the best candidate to absorb this role
    const candidate = await findBestCandidate(world, missing, availableNpcs, scaffold);
    if (!candidate) continue;

    // Redistribute
    await redistributeRole(world, missing, candidate, scaffold);
    redistributed++;

    console.log(`[NLE] Role redistributed: ${missing.name}'s "${missing.role}" role → ${candidate.name}`);

    adaptationHistory.push({
      timestamp: Date.now(),
      type: "role_redistributed",
      from: missing.name,
      to: candidate.name,
      reason: `${missing.name} no longer available`,
      integrityImpact: missing.role === "protagonist" ? 8 :
                       missing.role === "antagonist" ? 7 : 5,
    });

    chronicle.record("spirit_proposal", {
      spirit: "NarrativeIntegrity",
      type: "role_redistribution",
      from: missing.name,
      to: candidate.name,
      role: missing.role,
    });
  }

  // Reassign beats that referenced missing NPCs
  for (const tension of scaffold.tensions) {
    for (const beat of tension.beats) {
      if (beat.status !== "pending") continue;
      if (beat.npcActions) {
        beat.npcActions = beat.npcActions.map(action => {
          for (const missing of missingRoles) {
            if (action.toLowerCase().includes(missing.name.toLowerCase())) {
              const replacement = scaffold.npcRoles.find(r =>
                r.role === missing.role && agentNames.has(r.name.toLowerCase()));
              if (replacement) {
                return action.replace(new RegExp(missing.name, "gi"), replacement.name);
              }
            }
          }
          return action;
        });
      }
    }
  }

  if (redistributed > 0) {
    updateStoryScaffold(world, scaffold);
  }

  // Check if we need a full regeneration
  const finalIntegrity = calculateNarrativeIntegrity(world);
  if (finalIntegrity.score < 20 && agents.length >= 2) {
    console.log(`[NLE] Narrative integrity critical (${finalIntegrity.score}%) — regenerating scaffold`);
    await regenerateScaffold(world, scaffold);
  }

  return redistributed;
}

// =============================================================================
// CANDIDATE SELECTION
// =============================================================================

async function findBestCandidate(
  world: World,
  missingRole: NpcNarrativeRole,
  available: NpcNarrativeRole[],
  scaffold: StoryScaffoldData,
): Promise<NpcNarrativeRole | null> {
  if (available.length === 0) return null;
  if (available.length === 1) return available[0];

  // Use LLM to pick the best candidate based on narrative fit
  try {
    const candidateInfo = available.map(c => {
      const eid = Array.from(query(world as any, [Agent as any, Name as any]))
        .find(e => (Name.value[e] || "").toLowerCase() === c.name.toLowerCase());
      const aspirations = eid ? getAspirations(eid) : [];
      return `${c.name} (current role: ${c.role}): aspirations=${aspirations.join("; ")}`;
    }).join("\n");

    const result = await generateText({
      model: agentModel,
      temperature: 0.3,
      messages: [
        { role: "system", content: "You select the best NPC to absorb a missing character's narrative role. Respond with JSON: { \"chosen\": \"NPC name\", \"reason\": \"why\" }" },
        { role: "user", content: `The character "${missingRole.name}" (${missingRole.role}) is gone. Their secrets: ${missingRole.secrets.join("; ")}. Their hidden motivation: ${missingRole.hiddenMotivation || "none"}.\n\nAvailable candidates:\n${candidateInfo}\n\nWho should absorb this role? Consider narrative fit, dramatic potential, and existing role conflicts.` },
      ],
    });

    const raw = extractJSON(result.text);
    if (raw) {
      const json = typeof raw === "string" ? JSON.parse(raw) : raw;
      const chosen = available.find(c =>
        c.name.toLowerCase() === String(json.chosen || "").toLowerCase());
      if (chosen) return chosen;
    }
  } catch {}

  // Fallback: pick the one with the most complementary role
  const roleAffinity: Record<string, string[]> = {
    protagonist: ["ally", "catalyst", "wild_card"],
    antagonist: ["wild_card", "catalyst"],
    catalyst: ["wild_card", "witness"],
    witness: ["ally", "catalyst"],
    ally: ["witness", "catalyst"],
    wild_card: ["catalyst", "witness", "ally"],
  };

  const preferred = roleAffinity[missingRole.role] || [];
  for (const pref of preferred) {
    const match = available.find(c => c.role === pref);
    if (match) return match;
  }

  return available[0];
}

// =============================================================================
// ROLE TRANSFER
// =============================================================================

async function redistributeRole(
  world: World,
  from: NpcNarrativeRole,
  to: NpcNarrativeRole,
  scaffold: StoryScaffoldData,
): Promise<void> {
  // Find the target NPC's ECS entity
  const agents = Array.from(query(world as any, [Agent as any, Name as any]));
  const toEid = agents.find(eid =>
    (Name.value[eid] || "").toLowerCase() === to.name.toLowerCase());

  if (toEid === undefined) return;

  // Transfer secrets as memories
  for (const secret of from.secrets) {
    addMemory(world, toEid, {
      type: "episodic",
      content: `I learned something important: ${secret}`,
      importance: 85,
      emotionalValence: -0.3,
      timestamp: Date.now(),
    });
  }

  // Transfer hidden motivation
  if (from.hiddenMotivation) {
    addMemory(world, toEid, {
      type: "semantic",
      content: `With ${from.name} gone, I feel compelled to: ${from.hiddenMotivation}`,
      importance: 80,
      emotionalValence: 0.4,
      timestamp: Date.now(),
    });
  }

  // Update scaffold — absorb the role
  // The NPC keeps their original role but gains the missing one's narrative weight
  to.secrets = [...to.secrets, ...from.secrets];
  if (from.hiddenMotivation && !to.hiddenMotivation) {
    to.hiddenMotivation = from.hiddenMotivation;
  }

  // Update tension involvement
  for (const tension of scaffold.tensions) {
    const idx = tension.involvedNpcs.findIndex(n =>
      n.toLowerCase() === from.name.toLowerCase());
    if (idx >= 0) {
      tension.involvedNpcs[idx] = to.name;
    }
  }

  // If the missing role was antagonist/protagonist and different from target's role,
  // upgrade the target's role
  if ((from.role === "antagonist" || from.role === "protagonist") && to.role !== from.role) {
    to.role = from.role;
  }
}

// =============================================================================
// SCAFFOLD REGENERATION — when the story is too broken to heal
// =============================================================================

async function regenerateScaffold(world: World, oldScaffold: StoryScaffoldData): Promise<void> {
  console.log(`[NLE] Regenerating story scaffold from current world state...`);

  adaptationHistory.push({
    timestamp: Date.now(),
    type: "scaffold_regenerated",
    from: "old scaffold",
    to: "new scaffold",
    reason: "Narrative integrity below threshold",
    integrityImpact: 0, // Reset — new scaffold starts fresh
  });

  // Generate a new scaffold from the current world state
  await generateStoryScaffold(world, oldScaffold.seed);
}

// =============================================================================
// RESET
// =============================================================================

export function resetNarrativeIntegrity(): void {
  adaptationHistory.length = 0;
}
