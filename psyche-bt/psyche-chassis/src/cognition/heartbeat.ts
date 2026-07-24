/**
 * Heartbeat — Proactive background loop.
 *
 * While the nightly trainer handles deep "dreaming" (batch consolidation),
 * the heartbeat handles real-time proactive behavior:
 *
 *   - Intention wakeup checks (any intention with a scheduled follow-up?)
 *   - Proactive BT evaluation (should I reach out?)
 *   - Lightweight hypothesis decay
 *   - Memory consolidation (merge similar memories)
 *   - Brain state broadcasting (notify surfaces)
 *
 * Tick frequency adapts to state:
 *   - Active conversation: every 30 seconds
 *   - Recently idle (< 5 min): every 60 seconds
 *   - Idle (5+ min): every 5 minutes
 *   - Sleeping (30+ min): every 30 minutes (dreaming mode)
 */

import type { PersonModel } from "../ecs/types.js";
import { decayHypotheses } from "./hypothesis-bt.js";
import { quickReflection, type ReflectionResult } from "./metacognition.js";

// =============================================================================
// HEARTBEAT STATE
// =============================================================================

export type AgentState = "active" | "idle" | "sleeping";

export interface HeartbeatResult {
  state: AgentState;
  /** Intentions that are ready to execute or propose */
  intentionWakeups: string[];
  /** Whether a proactive outreach should happen */
  shouldReachOut: boolean;
  /** Reason for outreach (if any) */
  outreachReason?: string;
  /** Reflection results (if reflection was triggered) */
  reflection?: ReflectionResult;
  /** Number of memories consolidated */
  memoriesConsolidated: number;
}

// =============================================================================
// STATE MANAGEMENT
// =============================================================================

let lastMessageTime = Date.now();
let tickCount = 0;
const REFLECTION_INTERVAL = 10; // Reflect every 10 ticks

export function recordActivity(): void {
  lastMessageTime = Date.now();
}

export function getAgentState(): AgentState {
  const idleMs = Date.now() - lastMessageTime;
  if (idleMs < 5 * 60 * 1000) return "active";
  if (idleMs < 30 * 60 * 1000) return "idle";
  return "sleeping";
}

export function getTickIntervalMs(): number {
  switch (getAgentState()) {
    case "active": return 30_000;
    case "idle": return 5 * 60_000;
    case "sleeping": return 30 * 60_000;
  }
}

// =============================================================================
// HEARTBEAT TICK
// =============================================================================

/**
 * Run one heartbeat tick. Called periodically by the engine.
 */
export async function heartbeatTick(model: PersonModel): Promise<HeartbeatResult> {
  tickCount++;
  const state = getAgentState();

  const result: HeartbeatResult = {
    state,
    intentionWakeups: [],
    shouldReachOut: false,
    memoriesConsolidated: 0,
  };

  // 1. Check intention wakeups
  const now = Date.now();
  for (const intention of model.intentions) {
    if (intention.status === "forming" || intention.status === "active") {
      result.intentionWakeups.push(intention.id);
    }
  }

  // 2. Lightweight hypothesis decay (in idle/sleeping states)
  if (state !== "active") {
    decayHypotheses(model, state === "sleeping" ? 0.01 : 0.003);
  }

  // 3. Periodic reflection
  if (tickCount % REFLECTION_INTERVAL === 0) {
    result.reflection = quickReflection(model);
  }

  // 4. Proactive outreach evaluation (only in idle/sleeping)
  if (state !== "active" && result.intentionWakeups.length > 0) {
    // Simple heuristic: reach out if there's an active intention
    // and enough time has passed since last interaction
    const idleHours = (now - lastMessageTime) / (1000 * 60 * 60);
    if (idleHours >= 2 && idleHours <= 72) { // 2-72 hour window
      result.shouldReachOut = true;
      result.outreachReason = `${result.intentionWakeups.length} intention(s) ready`;
    }
  }

  // 5. Memory consolidation (in sleeping state)
  if (state === "sleeping") {
    result.memoriesConsolidated = consolidateMemories(model);
  }

  return result;
}

// =============================================================================
// MEMORY CONSOLIDATION
// =============================================================================

/**
 * Merge similar memories and decay low-importance ones.
 * Returns count of memories consolidated.
 */
function consolidateMemories(model: PersonModel): number {
  let consolidated = 0;
  const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;

  // Decay importance of old, low-importance memories
  for (const mem of model.memory) {
    if (mem.importance < 0.3 && (Date.now() - mem.timestamp) > ONE_WEEK) {
      mem.importance *= 0.9;
    }
  }

  // Remove memories below threshold
  const before = model.memory.length;
  model.memory = model.memory.filter(m => m.importance > 0.05);
  consolidated = before - model.memory.length;

  return consolidated;
}
