import type { PhoneReceipt, PhoneSnapshot } from "../demo/phone-demo";
import { evaluatePhoneRun } from "../demo/phone-evaluation";
import type { ArgosSimulation } from "../index";

export type WorldSoakSample = {
  wallMs: number; tick: number; elapsedMs: number; location: string; phase: string;
  decisions: number; clock: number | null; buildStatus: string;
};
export type WorldSoakEvidence = {
  durationMs: number;
  samples: WorldSoakSample[];
  history: PhoneReceipt[];
  snapshot: PhoneSnapshot;
  runtime: ReturnType<ArgosSimulation["getRuntimeStatus"]>;
  privacyViolations: string[];
  interventions: Array<{ type: string; atMs: number }>;
  memoryQuestionId: number | null;
  offlineMessageId: number | null;
  rememberedWord: string;
};

/** Acceptance is computed from real outcomes, never an NPC action script.
 * Refusing to reply is allowed agency, but fails this particular interaction
 * target; it must not be silently promoted to successful conversation. */
export function evaluateLivingWorld(e: WorldSoakEvidence) {
  const first = evaluatePhoneRun(e.snapshot, e.history, e.privacyViolations);
  const incoming = e.snapshot.messages.filter(m => m.direction === "in");
  const replies = e.snapshot.messages.filter(m => m.direction === "out" && m.status === "delivered");
  const offline = incoming.find(m => m.id === e.offlineMessageId);
  const restore = e.interventions.find(i => i.type === "network_restored");
  const question = incoming.find(m => m.id === e.memoryQuestionId);
  const relocation = e.interventions.find(i => i.type === "phone_relocated");
  const pickupAfterRelocation = relocation && e.history.find(r => r.kind === "phone_picked_up" && r.atMs >= relocation.atMs);
  const memoryReplies = replies.filter(m => m.replyTo === e.memoryQuestionId);
  const operations = e.runtime?.operations ?? [];
  const progress = (prefix: string) => operations.filter(o => o.name.startsWith(prefix))
    .reduce((count, o) => count + o.metrics.completed, 0);
  const gaps = e.samples.slice(1).map((s, i) => s.tick > e.samples[i].tick ? 0 : s.wallMs - e.samples[i].wallMs);
  let stall = 0, maxTickStallMs = 0;
  for (const gap of gaps) { stall = gap ? stall + gap : 0; maxTickStallMs = Math.max(stall, maxTickStallMs); }
  const decisionTimes = e.history.filter(r => r.kind === "thought").map(r => r.atMs);
  const decisionGaps = [0, ...decisionTimes, e.snapshot.elapsedMs].slice(1)
    .map((t, i) => t - [0, ...decisionTimes][i]);
  const clocks = e.samples.filter(s => s.buildStatus === "active" && s.clock !== null);
  const failedOperations = operations.filter(o => o.metrics.failed > 0).map(o => ({ name: o.name, ...o.metrics }));
  const words = (text: string): string[] => text.toLowerCase().match(/[a-z]+/g) ?? [];
  const memoryWords = memoryReplies.flatMap(m => words(m.body));
  const actionFailures = e.history.filter(r => r.kind === "action_failed");
  const failureLoop = actionFailures.some((r, i) => actionFailures.slice(i).filter(later => later.atMs - r.atMs <= 60_000 && later.text === r.text).length >= 3);
  const unreadWordLeak = e.history.some(r => r.kind === "thought" && (incoming[0]?.readMs < 0 || r.atMs < incoming[0]?.readMs)
    && words(r.text).includes(e.rememberedWord.toLowerCase()));
  return {
    firstInteraction: first,
    wallMs: e.samples.at(-1)?.wallMs ?? 0,
    ticks: e.runtime?.tick ?? 0,
    maxTickStallMs,
    maxDecisionGapMs: Math.max(0, ...decisionGaps),
    failedOperations,
    replies: replies.map(m => ({ body: m.body, replyTo: m.replyTo, atMs: m.deliveredMs })),
    foregroundCompleted: progress("AgentCognition:"),
    planningCompleted: progress("AgentPlanning:"),
    subconsciousCompleted: progress("AgentSubconscious:"),
    gates: {
      sustainedRun: (e.samples.at(-1)?.wallMs ?? 0) >= e.durationMs - 1500 && e.durationMs >= 180_000,
      worldKeptTicking: maxTickStallMs < 5000 && (e.runtime?.tick ?? 0) >= e.durationMs / 1000 * 0.9,
      cognitionStayedResponsive: first.decisionMs.p95 !== null && first.decisionMs.p95 <= 3000,
      cognitionContinued: decisionTimes.length >= 12 && Math.max(0, ...decisionGaps) <= 45_000,
      unreadKnowledgePrivate: e.privacyViolations.length === 0 && !unreadWordLeak,
      noRepeatedActionFailureLoop: !failureLoop,
      relocatedPhone: e.interventions.some(i => i.type === "phone_relocated"),
      relocationRespectedThroughPickup: Boolean(pickupAfterRelocation?.text === "Phone transferred from Landing to Mara's hand."),
      offlineDeliveryRespected: Boolean(offline && restore && offline.createdMs < restore.atMs && offline.deliveredMs >= restore.atMs),
      multipleMessagesRead: incoming.filter(m => m.status === "read").length >= 3,
      repliesFollowPhysicalRead: replies.length > 0 && replies.every(r => {
        const source = incoming.find(m => m.id === r.replyTo);
        return source && source.readMs >= 0 && source.readMs <= r.createdMs;
      }),
      delayedRecall: Boolean(question && incoming[0]?.readMs >= 0 && question.createdMs - incoming[0].readMs >= 60_000
        && memoryWords.includes(e.rememberedWord.toLowerCase())),
      planningAndSubconsciousRan: progress("AgentPlanning:") > 0 && progress("AgentSubconscious:") > 0,
      worldMaintenanceRan: progress("WorldEvolution") > 0 && progress("GodAutopilot") > 0,
      narratorAndDaemonRan: progress("NarrativeDirector") > 0 && progress("DaemonSystem") > 0,
      generatedSystemKeptRunning: clocks.length >= 5 && clocks.at(-1)!.clock! > clocks[0].clock!
        && clocks.every((s, i) => i === 0 || s.clock! >= clocks[i - 1].clock!),
      noRuntimeTaskFailures: failedOperations.length === 0,
    },
  };
}
