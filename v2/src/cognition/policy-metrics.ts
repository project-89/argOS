/**
 * Policy Metrics — Per-agent behavioral effectiveness tracking
 *
 * Tracks action diversity, stuck loops, LLM fallback rate, and goal completion
 * for each agent. Feeds into the Watcher spirit for automatic behavioral_gap
 * detection and policy evolution.
 *
 * Pure deterministic logic — no LLM calls.
 */

// =============================================================================
// TYPES
// =============================================================================

export interface PolicyMetrics {
  /** Shannon entropy of action type distribution over last N actions.
   *  0 = always same action, higher = more diverse. */
  actionDiversity: number;
  /** Ratio of completed goals to total goals created (0-1). */
  goalCompletionRate: number;
  /** Number of behavioral loops detected (same 3+ actions repeating). */
  stuckLoopCount: number;
  /** Ratio of LLM fallback actions to total actions (0-1). */
  llmFallbackRate: number;
  /** Total actions tracked in the rolling window. */
  totalActions: number;
  /** Timestamp of last update. */
  lastUpdated: number;
}

// =============================================================================
// INTERNAL STATE
// =============================================================================

const ROLLING_WINDOW_SIZE = 50;

interface AgentPolicyState {
  /** Rolling window of recent action types. */
  actions: string[];
  /** Rolling window of LLM fallback flags (parallel to actions). */
  llmFallbacks: boolean[];
  /** Number of stuck loops detected so far. */
  stuckLoopCount: number;
  /** Goals created count. */
  goalsCreated: number;
  /** Goals completed count. */
  goalsCompleted: number;
  /** Timestamp of last update. */
  lastUpdated: number;
}

const agentPolicyState: Map<number, AgentPolicyState> = new Map();

// =============================================================================
// CORE FUNCTIONS
// =============================================================================

/**
 * Compute Shannon entropy of a list of action types.
 * Returns 0 for empty input or single-type input.
 */
export function computeActionDiversity(actions: string[]): number {
  if (actions.length === 0) return 0;

  const counts = new Map<string, number>();
  for (const a of actions) {
    counts.set(a, (counts.get(a) || 0) + 1);
  }

  const total = actions.length;
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / total;
    if (p > 0) {
      entropy -= p * Math.log2(p);
    }
  }

  return entropy;
}

/**
 * Detect if the last actions form a stuck repeating loop.
 *
 * Checks for repeating patterns of length 1, 2, or 3 within the last
 * `windowSize * 2` actions (need at least 2 full repetitions to confirm).
 */
export function detectStuckLoop(actions: string[], windowSize: number = 3): boolean {
  if (actions.length < windowSize * 2) return false;

  // Check pattern lengths 1..windowSize
  for (let patLen = 1; patLen <= windowSize; patLen++) {
    if (actions.length < patLen * 2) continue;

    // Extract the candidate pattern from the tail
    const tail = actions.slice(-patLen);
    // Check how many consecutive repetitions exist going backward
    let reps = 1;
    for (let offset = patLen * 2; offset <= actions.length; offset += patLen) {
      const segment = actions.slice(-offset, -offset + patLen);
      if (segment.length !== patLen) break;
      let match = true;
      for (let i = 0; i < patLen; i++) {
        if (segment[i] !== tail[i]) {
          match = false;
          break;
        }
      }
      if (match) {
        reps++;
      } else {
        break;
      }
    }

    // Need at least 2 full repetitions to count as stuck
    if (reps >= 2) return true;
  }

  return false;
}

/**
 * Record an action taken by an agent's behavior policy (or LLM fallback).
 *
 * Call this from agent-mind.ts after each action decision.
 */
export function recordPolicyAction(
  agentEid: number,
  actionType: string,
  wasLlmFallback: boolean
): void {
  let state = agentPolicyState.get(agentEid);
  if (!state) {
    state = {
      actions: [],
      llmFallbacks: [],
      stuckLoopCount: 0,
      goalsCreated: 0,
      goalsCompleted: 0,
      lastUpdated: Date.now(),
    };
    agentPolicyState.set(agentEid, state);
  }

  state.actions.push(actionType);
  state.llmFallbacks.push(wasLlmFallback);

  // Trim to rolling window
  if (state.actions.length > ROLLING_WINDOW_SIZE) {
    state.actions.shift();
    state.llmFallbacks.shift();
  }

  // Update stuck loop detection
  if (detectStuckLoop(state.actions)) {
    state.stuckLoopCount++;
  }

  state.lastUpdated = Date.now();
}

/**
 * Record a goal creation event for an agent.
 */
export function recordGoalCreated(agentEid: number): void {
  let state = agentPolicyState.get(agentEid);
  if (!state) {
    state = {
      actions: [],
      llmFallbacks: [],
      stuckLoopCount: 0,
      goalsCreated: 0,
      goalsCompleted: 0,
      lastUpdated: Date.now(),
    };
    agentPolicyState.set(agentEid, state);
  }
  state.goalsCreated++;
}

/**
 * Record a goal completion event for an agent.
 */
export function recordGoalCompleted(agentEid: number): void {
  const state = agentPolicyState.get(agentEid);
  if (state) {
    state.goalsCompleted++;
  }
}

/**
 * Get the current policy effectiveness metrics for an agent.
 * Returns undefined for agents that haven't been tracked yet.
 */
export function getPolicyEffectiveness(agentEid: number): PolicyMetrics | undefined {
  const state = agentPolicyState.get(agentEid);
  if (!state) return undefined;

  const totalActions = state.actions.length;
  const llmFallbackCount = state.llmFallbacks.filter(Boolean).length;

  return {
    actionDiversity: computeActionDiversity(state.actions),
    goalCompletionRate:
      state.goalsCreated > 0
        ? state.goalsCompleted / state.goalsCreated
        : 0,
    stuckLoopCount: state.stuckLoopCount,
    llmFallbackRate: totalActions > 0 ? llmFallbackCount / totalActions : 0,
    totalActions,
    lastUpdated: state.lastUpdated,
  };
}

/**
 * Reset all metrics for an agent (e.g., after policy evolution).
 */
export function resetPolicyMetrics(agentEid: number): void {
  agentPolicyState.delete(agentEid);
}

/**
 * Get metrics for all tracked agents.
 */
export function getAllPolicyMetrics(): Map<number, PolicyMetrics> {
  const result = new Map<number, PolicyMetrics>();
  for (const [eid] of agentPolicyState) {
    const m = getPolicyEffectiveness(eid);
    if (m) result.set(eid, m);
  }
  return result;
}

/**
 * Reset all policy metrics state (for testing).
 */
export function resetAllPolicyMetrics(): void {
  agentPolicyState.clear();
}
