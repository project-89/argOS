/** Operator-only full-attempt audit. Never fed back into actor cognition. */
export type ForegroundTimingEntry = { type: string; observedWallMs: number; data: Record<string, unknown> };
export function nearestRank(values: readonly number[], fraction = .95): number | null {
  if (!values.length) return null;
  return [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * fraction) - 1)]!;
}
export function evaluateForegroundAttempts(entries: readonly ForegroundTimingEntry[], endWallMs: number) {
  const rows = new Map<string, { requestId: string; actor: string; startWallMs: number;
    durationWallMs?: number; providerOutcome?: string; providerWallMs?: number }>();
  const issues: string[] = [];
  const numeric = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
  for (const entry of entries) {
    if (!["foreground_attempt_started", "foreground_attempt_finished", "foreground_provider_result"].includes(entry.type)) continue;
    const { requestId, agent } = entry.data;
    if (typeof requestId !== "string" || !requestId || typeof agent !== "string" || !agent || !numeric(entry.observedWallMs)) {
      issues.push("invalid_identity_or_time"); continue;
    }
    if (entry.type === "foreground_attempt_started") {
      if (rows.has(requestId)) { issues.push(`duplicate_start:${requestId}`); continue; }
      if (!numeric(entry.data.preparationWallMs)) { issues.push(`invalid_preparation:${requestId}`); continue; }
      rows.set(requestId, { requestId, actor: agent, startWallMs: entry.observedWallMs - entry.data.preparationWallMs });
      continue;
    }
    const row = rows.get(requestId);
    if (!row || row.actor !== agent) { issues.push(`unmatched_event:${requestId}`); continue; }
    if (entry.type === "foreground_attempt_finished") {
      if (row.durationWallMs !== undefined) issues.push(`duplicate_finish:${requestId}`);
      else if (!numeric(entry.data.durationWallMs)) issues.push(`invalid_duration:${requestId}`);
      else row.durationWallMs = entry.data.durationWallMs;
    } else {
      const p = entry.data.provider as { outcome?: unknown; durationWallMs?: unknown } | undefined;
      if (row.providerOutcome !== undefined) issues.push(`duplicate_provider:${requestId}`);
      else if (!p || !["returned", "timeout", "error", "cancelled"].includes(String(p.outcome)) || !numeric(p.durationWallMs)) issues.push(`invalid_provider:${requestId}`);
      else { row.providerOutcome = String(p.outcome); row.providerWallMs = p.durationWallMs; }
    }
  }
  const attempts = [...rows.values()].map(row => ({ ...row,
    ...(row.durationWallMs === undefined ? { censoredLowerBoundMs: Math.max(0, endWallMs - row.startWallMs) } : {}) }));
  const pending = attempts.filter(row => row.durationWallMs === undefined || row.providerOutcome === undefined);
  const durations = attempts.flatMap(row => row.durationWallMs === undefined ? [] : [row.durationWallMs]);
  const complete = issues.length === 0 && pending.length === 0;
  const byActor = [...new Set(attempts.map(row => row.actor))].map(actor => {
    const owned = attempts.filter(row => row.actor === actor);
    return { actor, count: owned.length, completed: owned.filter(row => row.durationWallMs !== undefined).length,
      p95WallMs: nearestRank(owned.flatMap(row => row.durationWallMs === undefined ? [] : [row.durationWallMs])) };
  });
  const p95WallMs = nearestRank(durations);
  return { definition: "agentThink entry to proposal/rejection, model-backed attempts only; includes all outcomes", attempts,
    complete, issues, pending: pending.length, count: attempts.length, completed: durations.length,
    p50WallMs: nearestRank(durations, .5), p95WallMs, byActor,
    latencyWithinFiveSeconds: complete && p95WallMs !== null && p95WallMs <= 5000,
    note: "Per-trial latency alone is not the cohort gate: minimum actor coverage and per-world/pooled p95 are also required." };
}
