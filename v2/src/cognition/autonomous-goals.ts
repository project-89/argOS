/**
 * Autonomous Goal Generation — Phase 3.1
 *
 * When the BT has no action AND no active goals exist, this module
 * asks the LLM to generate a NEW goal for the agent based on:
 *   - Aspirations (long-term wants)
 *   - Needs (hunger, energy, social, comfort)
 *   - Recent memories and observations
 *   - Social context (who's nearby, impressions)
 *   - Available affordances in the current location
 *
 * The generated goal enters the existing goal/planning system.
 * When completed, the action sequence compiles into a skill via goal-learning.ts.
 *
 * This is the key piece that makes agents PROACTIVE instead of reactive.
 */

import { generateText } from "ai";
import { hasComponent, getRelationTargets } from "bitecs";
import { agentModel } from "../llm/config";
import { extractJSON } from "../llm/json-extract";
import type { World } from "../ecs/world";
import {
  Name, Agent, Goal, Needs, Memory, Perception, Description,
  LastAction, BehaviorPolicy,
} from "../ecs/components";
import { HasGoal } from "../ecs/relations";
import { getRoomForEntity, listDirectContents } from "../ecs/location";
import { getAgentMemories, getImpressionOf } from "./knowledge-graph";
import { getAspirations, formatAspirationsForContext } from "./goal-learning";
import { createIntentGoal, getActiveGoals } from "./cognition-system";
import { worldSchema } from "../world/schema";
import { chronicle } from "./simulation-chronicle";
import { formatWorldTimeForContext, getGoalBiases, getClockState } from "../systems/world-clock";

// =============================================================================
// TYPES
// =============================================================================

export interface GeneratedGoal {
  description: string;
  motivation: string;
  priority: number;       // 1-10
  kind: "explore" | "social" | "craft" | "acquire" | "improve" | "survive" | "custom";
  firstAction?: {
    type: string;
    target?: string;
    content?: string;
  };
}

// =============================================================================
// CONFIGURATION
// =============================================================================

/** Minimum ticks between goal generation attempts per agent */
const GOAL_COOLDOWN_TICKS = 5;

/** Max active goals per agent before we stop generating new ones */
const MAX_ACTIVE_GOALS = 3;

/** Track last goal generation tick per agent */
const lastGoalTick: Map<number, number> = new Map();

/** Global tick counter for cooldown tracking */
let currentTick = 0;

// =============================================================================
// MAIN ENTRY POINT
// =============================================================================

/**
 * Attempt to generate an autonomous goal for an agent.
 * Called from agent-mind.ts when BT returns llm_fallback and no active goals exist.
 *
 * Returns a GeneratedGoal if successful, null if skipped or failed.
 */
export async function generateAutonomousGoal(
  world: World,
  agentEid: number,
): Promise<GeneratedGoal | null> {
  // Check cooldown
  const lastTick = lastGoalTick.get(agentEid) ?? -Infinity;
  if (currentTick - lastTick < GOAL_COOLDOWN_TICKS) return null;

  // Check active goal count
  const activeGoals = getActiveGoals(world, agentEid);
  if (activeGoals.length >= MAX_ACTIVE_GOALS) return null;

  lastGoalTick.set(agentEid, currentTick);

  const prompt = buildGoalGenerationPrompt(world, agentEid, activeGoals);
  if (!prompt) return null;

  try {
    const result = await generateText({
      model: agentModel,
      temperature: 0.5, // Between creative (1.0) and deterministic (0.3)
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
    });

    const parsed = parseGoalResponse(result.text);
    if (!parsed) return null;

    // Create the goal in the ECS
    const goalEid = createIntentGoal(world, agentEid, parsed.description, parsed.priority);
    if (goalEid !== undefined && goalEid >= 0) {
      Goal.kind[goalEid] = parsed.kind;
    }

    const agentName = String(Name.value[agentEid] || agentEid);
    console.log(`[AutonomousGoal] ${agentName} sets goal: "${parsed.description}" (${parsed.kind}, priority ${parsed.priority})`);
    console.log(`  Motivation: ${parsed.motivation}`);

    chronicle.record("autonomous_goal", {
      agent: agentName,
      goal: parsed.description,
      kind: parsed.kind,
      priority: parsed.priority,
      motivation: parsed.motivation,
      activeGoalCount: activeGoals.length + 1,
    });

    return parsed;
  } catch (err) {
    console.warn(`[AutonomousGoal] Failed for agent ${agentEid}:`, (err as Error).message);
    return null;
  }
}

// =============================================================================
// PROMPT BUILDING
// =============================================================================

interface GoalPrompt {
  system: string;
  user: string;
}

function buildGoalGenerationPrompt(
  world: World,
  agentEid: number,
  activeGoals: Array<{ description: string; priority: number }>,
): GoalPrompt | null {
  const name = String(Name.value[agentEid] || "").trim();
  const role = String(Agent.role[agentEid] || "").trim();
  const desc = String(Description.value[agentEid] || "").trim();
  const systemPrompt = String(Agent.systemPrompt[agentEid] || "").trim();
  if (!name) return null;

  // Needs
  const hunger = Needs.hunger[agentEid] ?? 0;   // 0=full, 100=starving
  const energy = Needs.energy[agentEid] ?? 100;  // 100=rested, 0=exhausted
  const social = Needs.social[agentEid] ?? 50;   // 0=lonely, 100=fulfilled
  const comfort = Needs.comfort[agentEid] ?? 50;

  // Location
  const roomEid = getRoomForEntity(world, agentEid);
  const roomName = roomEid !== undefined ? String(Name.value[roomEid] || "somewhere") : "somewhere";
  const roomDesc = roomEid !== undefined ? String(Description.value[roomEid] || "") : "";

  // Others in room
  const othersInRoom: string[] = [];
  if (roomEid !== undefined) {
    for (const child of listDirectContents(world, roomEid)) {
      if (child === agentEid) continue;
      if (hasComponent(world as any, child, Agent as any)) {
        const otherName = Name.value[child];
        if (otherName) othersInRoom.push(otherName);
      }
    }
  }

  // Objects in room
  const objectsInRoom: string[] = [];
  if (roomEid !== undefined) {
    for (const child of listDirectContents(world, roomEid)) {
      if (child === agentEid) continue;
      if (hasComponent(world as any, child, Agent as any)) continue;
      const objName = Name.value[child];
      if (objName) objectsInRoom.push(objName);
    }
  }

  // Recent memories (top 5 by importance)
  const memoryEids = getAgentMemories(world, agentEid);
  const recentMemories = memoryEids
    .sort((a, b) => (Memory.importance[b] || 0) - (Memory.importance[a] || 0))
    .slice(0, 5)
    .map(mid => Memory.content[mid] || "")
    .filter(Boolean);

  // Impressions of people nearby
  const impressions: string[] = [];
  for (const other of othersInRoom) {
    const imp = getImpressionOf(world, agentEid, other);
    if (imp !== undefined) {
      const s = imp.overallSentiment;
      const sentiment = s > 0.3 ? "positive" : s < -0.3 ? "negative" : "neutral";
      impressions.push(`${other}: ${sentiment} (${s.toFixed(1)})`);
    }
  }

  // Aspirations
  const aspirations = getAspirations(agentEid);

  // Available affordances from world schema
  let affordanceList: string[] = [];
  try {
    const allAffordances = worldSchema.getAllAffordances();
    affordanceList = allAffordances
      .map(a => a.name + (a.description ? ` (${a.description})` : ""))
      .slice(0, 10);
  } catch { /* ok */ }

  // Last action
  const lastType = LastAction.type[agentEid] || "";
  const lastTarget = LastAction.target[agentEid] || "";
  const lastSuccess = LastAction.success[agentEid];
  const lastActionStr = lastType
    ? `${lastType}${lastTarget ? " → " + lastTarget : ""} (${lastSuccess ? "succeeded" : "failed"})`
    : "none";

  const system = `You are the inner voice of ${name}, a ${role}. ${desc}

${systemPrompt}

Your job is to decide what ${name} should focus on next — set a GOAL, not pick an action.
Goals are things like "find food", "visit the market", "forge a sword", "make a friend", "explore the forest".
Think about what matters most right now given your needs, aspirations, and situation.`;

  const needsSection = `NEEDS (0-100):
- Hunger: ${hunger} (${hunger > 70 ? "STARVING - urgent!" : hunger > 40 ? "getting hungry" : "fine"})
- Energy: ${energy} (${energy < 30 ? "EXHAUSTED - urgent!" : energy < 60 ? "getting tired" : "fine"})
- Social: ${social} (${social < 30 ? "LONELY - need company" : social > 70 ? "socially fulfilled" : "okay"})
- Comfort: ${comfort} (${comfort < 30 ? "UNCOMFORTABLE" : "okay"})`;

  const aspirationsSection = aspirations.length > 0
    ? `LONG-TERM ASPIRATIONS (your dreams):\n${aspirations.map(a => `- ${a}`).join("\n")}`
    : "LONG-TERM ASPIRATIONS: None yet — you're finding your way in the world.";

  const activeGoalsSection = activeGoals.length > 0
    ? `CURRENT GOALS (already pursuing):\n${activeGoals.map(g => `- [P${g.priority}] ${g.description}`).join("\n")}\nDo NOT repeat these. Choose something DIFFERENT.`
    : "CURRENT GOALS: None — you need something to work toward!";

  // Time of day and world events
  const timeContext = formatWorldTimeForContext(world);
  const biases = getGoalBiases(world);
  const biasHints = Object.entries(biases)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([kind, v]) => `${kind} (${v > 1 ? "strongly" : "slightly"} favored)`)
    .join(", ");

  const user = `${needsSection}

${aspirationsSection}

${activeGoalsSection}
${timeContext}

LOCATION: ${roomName}${roomDesc ? ` — ${roomDesc}` : ""}
OBJECTS HERE: ${objectsInRoom.length > 0 ? objectsInRoom.join(", ") : "nothing notable"}
PEOPLE HERE: ${othersInRoom.length > 0 ? othersInRoom.join(", ") : "nobody"}
${impressions.length > 0 ? `IMPRESSIONS: ${impressions.join(", ")}` : ""}
THINGS YOU CAN DO: ${affordanceList.length > 0 ? affordanceList.join(", ") : "basic actions (move, speak, observe, interact)"}
LAST ACTION: ${lastActionStr}

RECENT MEMORIES:
${recentMemories.length > 0 ? recentMemories.map(m => `- ${m}`).join("\n") : "- Nothing memorable yet."}

Based on ALL of this, what should ${name} focus on next?

PRIORITY RULES:
1. If STARVING or EXHAUSTED → survival goal (find food, rest) — ALWAYS top priority
2. If there are ACTIVE EVENTS → respond to them (festival → socialize, storm → shelter, crisis → survive)
3. Consider the TIME OF DAY${biasHints ? ` — right now favors: ${biasHints}` : ""}
4. If LONELY and someone is nearby → social goal
5. If an aspiration is achievable → work toward it
6. If nothing urgent → explore, learn, or improve your craft

Respond with JSON only:
{
  "goal": "Short description of the goal (e.g., 'find food at the market')",
  "motivation": "Why this goal matters right now (1 sentence)",
  "priority": <1-10, where 10 is life-or-death>,
  "kind": "<explore|social|craft|acquire|improve|survive|custom>",
  "firstAction": {
    "type": "<move|speak|interact|observe>",
    "target": "optional target name",
    "content": "optional content"
  }
}`;

  return { system, user };
}

// =============================================================================
// RESPONSE PARSING
// =============================================================================

function parseGoalResponse(text: string): GeneratedGoal | null {
  try {
    const raw = extractJSON(text);
    if (!raw) return null;
    const json = typeof raw === "string" ? JSON.parse(raw) : raw;

    const goal = String(json.goal || json.description || "").trim();
    if (!goal || goal.length < 3) return null;

    const motivation = String(json.motivation || json.reason || json.why || "").trim();
    const priority = Math.min(10, Math.max(1, Number(json.priority) || 5));
    const kind = validateKind(String(json.kind || json.type || "custom"));

    let firstAction: GeneratedGoal["firstAction"] | undefined;
    if (json.firstAction && typeof json.firstAction === "object") {
      const fa = json.firstAction;
      const actionType = String(fa.type || fa.actionType || fa.action_type || "").trim();
      if (actionType) {
        firstAction = {
          type: actionType,
          target: fa.target ? String(fa.target).trim() : undefined,
          content: fa.content ? String(fa.content).trim() : undefined,
        };
      }
    }

    return {
      description: goal,
      motivation,
      priority,
      kind,
      firstAction,
    };
  } catch {
    return null;
  }
}

function validateKind(kind: string): GeneratedGoal["kind"] {
  const valid: GeneratedGoal["kind"][] = ["explore", "social", "craft", "acquire", "improve", "survive", "custom"];
  const normalized = kind.toLowerCase().trim();
  return valid.includes(normalized as any) ? (normalized as GeneratedGoal["kind"]) : "custom";
}

// =============================================================================
// DETERMINISTIC ASPIRATION GENERATION
// =============================================================================

/**
 * Generate aspirations for an agent based on their role/identity via LLM.
 * Called at agent creation or simulation start.
 */
export async function generateAspirations(
  world: World,
  agentEid: number,
): Promise<string[]> {
  const name = String(Name.value[agentEid] || "").trim();
  const role = String(Agent.role[agentEid] || "").trim();
  const desc = String(Description.value[agentEid] || "").trim();
  if (!name || !role) return [];

  try {
    const result = await generateText({
      model: agentModel,
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content: `You generate character aspirations for simulation agents. Aspirations are long-term dreams and goals that define what a character wants from life.`,
        },
        {
          role: "user",
          content: `Generate 3-5 aspirations for this character:

Name: ${name}
Role: ${role}
Description: ${desc}

Aspirations should be:
- Specific to their role and identity (a blacksmith wants to master their craft, not become a scholar)
- A mix of achievable and ambitious
- Personal (relationships, mastery) AND practical (build something, earn something)

Respond with JSON only:
{ "aspirations": ["aspiration 1", "aspiration 2", "aspiration 3"] }`,
        },
      ],
    });

    const raw = extractJSON(result.text);
    if (!raw) return [];
    const json = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!json?.aspirations || !Array.isArray(json.aspirations)) return [];

    const aspirations = json.aspirations
      .map((a: any) => String(a).trim())
      .filter((a: string) => a.length > 3)
      .slice(0, 5);

    return aspirations;
  } catch (err) {
    console.warn(`[AutonomousGoal] Failed to generate aspirations for ${name}:`, (err as Error).message);
    return [];
  }
}

/**
 * Generate deterministic aspirations from role keywords (no LLM needed).
 * Used for testing and as a fallback.
 */
export function generateDeterministicAspirations(role: string): string[] {
  const r = role.toLowerCase();

  const roleAspirations: Record<string, string[]> = {
    blacksmith: [
      "Master the art of forging legendary weapons",
      "Build a larger, better-equipped forge",
      "Earn the respect of the village through my craft",
    ],
    innkeeper: [
      "Make my inn the most popular gathering place",
      "Collect stories from every traveler who passes through",
      "Save enough coin to expand the inn",
    ],
    farmer: [
      "Grow the finest crops in the region",
      "Own a larger plot of fertile land",
      "Provide for my family through good harvests",
    ],
    merchant: [
      "Build a profitable trade network",
      "Acquire rare and valuable goods",
      "Become the wealthiest trader in the village",
    ],
    monk: [
      "Achieve inner peace through meditation and study",
      "Help others find wisdom and guidance",
      "Preserve and copy important texts",
    ],
    guard: [
      "Keep the village safe from all threats",
      "Become captain of the guard",
      "Master combat techniques",
    ],
    scholar: [
      "Uncover ancient knowledge",
      "Write a comprehensive history of the region",
      "Teach the next generation",
    ],
    healer: [
      "Learn to cure every ailment known",
      "Gather rare medicinal herbs",
      "Establish a proper healing house",
    ],
  };

  // Try exact match first, then partial
  if (roleAspirations[r]) return roleAspirations[r];

  for (const [key, aspirations] of Object.entries(roleAspirations)) {
    if (r.includes(key) || key.includes(r)) return aspirations;
  }

  // Generic fallback
  return [
    "Find purpose and meaning in daily work",
    "Build lasting friendships with others",
    "Improve skills and knowledge over time",
  ];
}

// =============================================================================
// TICK MANAGEMENT
// =============================================================================

/** Call once per simulation tick to advance the cooldown counter */
export function advanceGoalTick(): void {
  currentTick++;
}

/** Check if an agent should attempt goal generation (has no active goals, off cooldown) */
export function shouldGenerateGoal(world: World, agentEid: number): boolean {
  const activeGoals = getActiveGoals(world, agentEid);
  if (activeGoals.length >= MAX_ACTIVE_GOALS) return false;

  // Only generate if NO active goals — agents with goals should pursue them
  if (activeGoals.length > 0) return false;

  const lastTick = lastGoalTick.get(agentEid) ?? -Infinity;
  if (currentTick - lastTick < GOAL_COOLDOWN_TICKS) return false;

  return true;
}

/**
 * Expire stale goals that have been active too long without completion.
 * Call periodically from the simulation loop.
 * This keeps agents from getting stuck on impossible goals forever.
 *
 * @param maxAgeMs Maximum age in milliseconds before a goal expires (default: 2 minutes)
 */
export function expireStaleGoals(world: World, agentEid: number, maxAgeMs: number = 2 * 60 * 1000): number {
  const goalEids = getRelationTargets(world as any, agentEid, HasGoal as any)
    .filter((gid: number) => hasComponent(world as any, gid, Goal as any))
    .filter((gid: number) => String(Goal.status[gid] || "") === "active");

  let expired = 0;
  const now = Date.now();
  for (const gid of goalEids) {
    const createdAt = Goal.createdAt[gid] || 0;
    if (createdAt > 0 && (now - createdAt) > maxAgeMs) {
      Goal.status[gid] = "expired";
      expired++;
    }
  }
  return expired;
}

// =============================================================================
// RESET (for testing)
// =============================================================================

export function resetAutonomousGoals(): void {
  lastGoalTick.clear();
  currentTick = 0;
}
