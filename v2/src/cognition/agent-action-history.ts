/**
 * Agent action history tracking.
 * Standalone module to avoid circular dependencies between behavior-policy and watcher-spirit.
 * Both modules can safely import from here.
 */

interface AgentActionRecord {
  lastActions: string[];
}

const actionHistory: Map<number, AgentActionRecord> = new Map();

/**
 * Record an agent's action type into the history buffer (max 20 entries).
 */
export function recordAction(agentEid: number, actionType: string): void {
  let record = actionHistory.get(agentEid);
  if (!record) {
    record = { lastActions: [] };
    actionHistory.set(agentEid, record);
  }
  record.lastActions.push(actionType);
  if (record.lastActions.length > 20) {
    record.lastActions.shift();
  }
}

/**
 * Return a copy of the recent action types for an agent, or empty array if not tracked.
 */
export function getRecentActions(agentEid: number): string[] {
  const record = actionHistory.get(agentEid);
  return record ? [...record.lastActions] : [];
}

/**
 * Clear all tracked action history (useful for tests).
 */
export function clearActionHistory(): void {
  actionHistory.clear();
}
