/** Descriptive diagnostics, not a classifier of good dialogue or redundant
 * thought. In particular, a new stimulus while listening may be important. */
interface Event {
  atSimMs: number; actor?: string; kind: string; thoughtType?: string;
  status?: string; durationWallMs?: number;
  disposition?: { type: string; reason?: string; actionType?: string };
}
interface ActorFrame {
  name: string;
  foregroundDiagnostics?: { admissions: number; counts: Partial<Record<string, number>>;
    lastAdmission?: { atSimMs: number; reason: string; listening?: { untilSimMs: number; executionIds: string[] } } };
}
interface Frame { atSimMs: number; actors: ActorFrame[] }

export function summarizeContinuityEvidence(events: readonly Event[], frames: readonly Frame[]) {
  const names = [...new Set(frames.flatMap(f => f.actors.map(a => a.name)))];
  return {
    actors: names.map(name => {
      const ownEvents = events.filter(e => e.actor === name);
      const samples = frames.flatMap(f => f.actors.filter(a => a.name === name && a.foregroundDiagnostics)
        .map(a => ({ at: f.atSimMs, diagnostics: a.foregroundDiagnostics! }))).sort((a, b) => a.at - b.at);
      const latest = samples.at(-1)?.diagnostics;
      const admissions = new Map<number, NonNullable<ActorFrame["foregroundDiagnostics"]>["lastAdmission"]>();
      // The cumulative admission count identifies repeated frame samples of the
      // same dispatch. Stop-time absent diagnostics are not zero admissions.
      for (const sample of samples) if (sample.diagnostics.lastAdmission)
        admissions.set(sample.diagnostics.admissions, sample.diagnostics.lastAdmission);
      const latencies = ownEvents.filter(e => e.kind === "decision_latency" && typeof e.durationWallMs === "number"
        && Number.isFinite(e.durationWallMs) && e.durationWallMs >= 0).map(e => e.durationWallMs!).sort((a, b) => a - b);
      const percentile = (p: number) => latencies.length ? latencies[Math.max(0, Math.ceil(latencies.length * p) - 1)] : null;
      const dispositions: Record<string, number> = {};
      for (const event of ownEvents) if (event.disposition) {
        const key = JSON.stringify([event.disposition.type, event.disposition.reason ?? null, event.disposition.actionType ?? null]);
        dispositions[key] = (dispositions[key] ?? 0) + 1;
      }
      return { name, integratedDecisions: ownEvents.filter(e => e.disposition?.type === "cognition_integrated").length,
        expressedReasoningThoughts: ownEvents.filter(e => e.kind === "thought" && e.thoughtType === "reasoning").length,
        completedSpokenTurns: ownEvents.filter(e => e.kind === "speech" && e.status === "succeeded").length,
        foregroundAdmissions: latest?.admissions ?? null, admissionReasons: latest ? { ...latest.counts } : null,
        sampledAdmissions: admissions.size,
        newStimulusAdmissionsDuringListening: [...admissions.values()].filter(a => a?.reason === "new_stimulus"
          && a.listening && a.atSimMs < a.listening.untilSimMs).length,
        decisionLatency: { samples: latencies.length, medianMs: percentile(.5), p95Ms: percentile(.95), method: "nearest_rank" },
        dispositions };
    }),
    interpretation: "Counts describe execution and scheduling, not semantic quality. Listening admissions can be legitimate interruptions. Thought count is not a novelty or repetition score. Missing historical diagnostics remain unavailable; sampling can miss intermediate admissions. No H3/audio behavior is inferred.",
  };
}
