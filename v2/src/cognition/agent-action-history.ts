/**
 * Agent action history tracking.
 * Standalone module to avoid circular dependencies between behavior-policy and watcher-spirit.
 * Both modules can safely import from here.
 */

interface AgentActionRecord {
  lastActions: string[];
}

let actionHistoryByWorld = new WeakMap<object, Map<number, AgentActionRecord>>();
const legacyActionHistory: Map<number, AgentActionRecord> = new Map();
/**
 * Compatibility bridge for callers of the original world-less API.
 *
 * An EID alone cannot identify an entity across multiple BitECS worlds. Keep
 * new writes world-scoped, but allow an old unscoped history to be adopted by
 * the first world that consumes it. Once adopted it is removed from the
 * process-global staging map, so another world reusing the same EID cannot see
 * it. Weak references avoid keeping completed simulations alive.
 */
const compatibilityWorldByAgent = new Map<number, WeakRef<object>>();

function historyFor(world?: object): Map<number, AgentActionRecord> {
  if (!world) return legacyActionHistory;
  let history = actionHistoryByWorld.get(world);
  if (!history) {
    history = new Map();
    actionHistoryByWorld.set(world, history);
  }
  return history;
}

function liveCompatibilityWorld(agentEid: number): object | undefined {
  const ref = compatibilityWorldByAgent.get(agentEid);
  const world = ref?.deref();
  if (ref && !world) compatibilityWorldByAgent.delete(agentEid);
  return world;
}

function appendAction(history: Map<number, AgentActionRecord>, agentEid: number, actionType: string): void {
  let record = history.get(agentEid);
  if (!record) {
    record = { lastActions: [] };
    history.set(agentEid, record);
  }
  record.lastActions.push(actionType);
  if (record.lastActions.length > 20) record.lastActions.shift();
}

/**
 * Record an agent's action type into the history buffer (max 20 entries).
 */
export function recordAction(agentEid: number, actionType: string, world?: object): void {
  if (world) {
    const scopedHistory = historyFor(world);
    // If legacy callers recorded actions before this module learned the world,
    // preserve that sequence when the first world-aware write arrives.
    if (!liveCompatibilityWorld(agentEid) && !scopedHistory.has(agentEid)) {
      const staged = legacyActionHistory.get(agentEid);
      if (staged) {
        legacyActionHistory.delete(agentEid);
        scopedHistory.set(agentEid, staged);
      }
    }
    compatibilityWorldByAgent.set(agentEid, new WeakRef(world));
    appendAction(scopedHistory, agentEid, actionType);
    return;
  }

  // Preserve the original public API. If a prior world-aware operation has
  // established an owner, keep subsequent legacy writes in that world.
  const compatibilityWorld = liveCompatibilityWorld(agentEid);
  appendAction(historyFor(compatibilityWorld), agentEid, actionType);
}

/**
 * Return a copy of the recent action types for an agent, or empty array if not tracked.
 */
export function getRecentActions(agentEid: number, world?: object): string[] {
  if (world) {
    const scopedHistory = historyFor(world);
    let record = scopedHistory.get(agentEid);

    // An unscoped record is only a staging record for backwards compatibility.
    // Adopt it exactly once; subsequent worlds with the same numeric EID see
    // their own empty/scoped history rather than process-global state.
    if (!record && !liveCompatibilityWorld(agentEid)) {
      const legacyRecord = legacyActionHistory.get(agentEid);
      if (legacyRecord) {
        legacyActionHistory.delete(agentEid);
        scopedHistory.set(agentEid, legacyRecord);
        compatibilityWorldByAgent.set(agentEid, new WeakRef(world));
        record = legacyRecord;
      }
    }
    return record ? [...record.lastActions] : [];
  }

  const compatibilityWorld = liveCompatibilityWorld(agentEid);
  const record = historyFor(compatibilityWorld).get(agentEid);
  return record ? [...record.lastActions] : [];
}

/**
 * Clear all tracked action history (useful for tests).
 */
export function clearActionHistory(): void {
  actionHistoryByWorld = new WeakMap<object, Map<number, AgentActionRecord>>();
  legacyActionHistory.clear();
  compatibilityWorldByAgent.clear();
}
