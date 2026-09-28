import type { CommittedSceneWindow, SceneWindowAction, SceneWorldState } from "../rendering/committed-scene-history";

/** Room projections can overlap for one execution. Reconcile only against a
 * complete public world timeline; never fill an unseen interval from an end receipt. */
export function projectScreenActions(windows: readonly CommittedSceneWindow[], states?: readonly SceneWorldState[]) {
  const local = windows.flatMap(w => w.actions.map(action => ({ roomId: w.roomId, action })));
  if (!states) return local;
  const groups = new Map<string, typeof local>();
  for (const item of local) {
    const a = item.action;
    const key = JSON.stringify([a.executionId, a.actorId, a.actorKey, a.action, a.operation, a.startedAtSimMs, a.targetId, a.targetKey]);
    const group = groups.get(key) ?? []; group.push(item); groups.set(key, group);
  }
  const result: typeof local = [];
  for (const group of groups.values()) {
    const first = group[0].action;
    const from = Math.min(...group.map(p => p.action.visibleStartSimMs));
    const to = Math.max(...group.map(p => p.action.visibleEndSimMs));
    const evidenceSequences = [...new Set(group.flatMap(p => p.action.evidenceSequences))].sort((a, b) => a - b);
    const boundaries = [...new Set([from, to, ...states.map(s => s.atSimMs),
      ...group.flatMap(p => [p.action.visibleStartSimMs, p.action.visibleEndSimMs])])]
      .filter(t => t >= from && t <= to).sort((a, b) => a - b);
    const ends = [...new Set(group.map(p => p.action.completedAtSimMs).filter(t => t !== undefined))];
    const verdicts = new Set(group.map(p => p.action.status).filter(s => s === "succeeded" || s === "failed"));
    if (ends.length > 1 || verdicts.size > 1) throw new Error("Conflicting public outcomes for one screen action");
    const status: SceneWindowAction["status"] = verdicts.has("failed") ? "failed"
      : verdicts.has("succeeded") ? "succeeded" : first.status;
    let current: (typeof local)[number] | undefined;
    for (let i = 0; i + 1 < boundaries.length; i++) {
      const start = boundaries[i], end = boundaries[i + 1];
      const state = [...states].reverse().find(s => s.atSimMs <= start);
      const actors = state?.scenes.flatMap(s => s.actors).filter(a => a.id === first.actorId
        && (!first.actorKey || a.identityKey === first.actorKey)) ?? [];
      if (actors.length > 1) throw new Error("Ambiguous public actor presence for screen action");
      const actor = actors[0];
      const covered = actor && group.some(p => p.roomId === actor.roomId
        && p.action.visibleStartSimMs <= start && p.action.visibleEndSimMs >= end);
      if (!covered) { current = undefined; continue; }
      if (current && current.action.visibleEndSimMs === start) {
        current.action = { ...current.action, visibleEndSimMs: end };
      } else {
        current = { roomId: actor.roomId, action: { ...first, visibleStartSimMs: start, visibleEndSimMs: end,
          ...(ends.length ? { completedAtSimMs: ends[0] } : {}), status, evidenceSequences } };
        result.push(current);
      }
    }
  }
  return result;
}
