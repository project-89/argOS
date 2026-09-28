import type { TestbedEvent } from "../demo/generative-agents";

/** Deterministic transcript diagnostics. These are review candidates, not an
 * embedding/model judgment that two utterances mean exactly the same thing. */
export interface MilestoneRule {
  id: string;
  label: string;
  kind?: string;
  actionType?: string;
  target?: string;
  verb?: string;
  textIncludes?: string;
}
export interface GenerativeAgentsEvaluationOptions {
  actorNames?: Readonly<Record<number, string>>;
  milestoneRules?: readonly MilestoneRule[];
  repetitionWindowMs?: number;
  similarityThreshold?: number;
  minSpeechTurns?: number;
}
export interface EvaluationExcerpt {
  sequence: number;
  elapsedMs: number;
  actorId?: number;
  actor: string;
  target?: string;
  text: string;
}
export interface RepetitionEvidence {
  kind: "lexical_repeat" | "question_topic_return" | "information_check_after_claim" | "gratitude_recurrence";
  previous: EvaluationExcerpt;
  current: EvaluationExcerpt;
  similarity: number;
  reason: string;
  response?: EvaluationExcerpt;
  /** Exact public speech found in the asker's earlier perception record. */
  heardPerceptionSequence?: number;
}

export const STORM_HOUSE_MILESTONES: readonly MilestoneRule[] = [
  { id: "circuit_isolated", label: "Circuit isolated", actionType: "interact", target: "Isolation switch", verb: "switch_off" },
  { id: "cupboard_unlocked", label: "Supply cupboard unlocked", actionType: "interact", target: "Supply cupboard", verb: "unlock" },
  { id: "fuse_acquired", label: "Spare fuse physically acquired", actionType: "pickup", target: "Spare fuse" },
  { id: "relay_repaired", label: "Relay repair committed", actionType: "interact", target: "Lighting relay", verb: "repair" },
  { id: "circuit_energized", label: "Circuit switched on", actionType: "interact", target: "Isolation switch", verb: "switch_on" },
  { id: "lamp_lit", label: "Lamp-on world observation", kind: "observation", textIncludes: "The Reading lamp comes on" },
];

const STOP = new Set("a an the i me my mine we us our ours you your yours he him his she her hers they them their it its this that those these am is are was were be been being do does did have has had having will would shall should could can may might must to of in on at for from with and or but as if then than so just very really much more most all any each both about here there now not no yes too up down out into through how what when where who why which know say said tell let got get go come came first long thanks thank appreciate grateful ivo mara sera".split(" "));
const PHYSICAL = new Set(["move", "pickup", "drop", "give", "use", "interact", "equip", "unequip", "wear", "remove", "attack", "defend"]);
const OBSERVING = new Set(["observe", "examine", "inspect", "look", "read"]);
function normalize(text: string): string { return text.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim(); }
function canonical(text: string): string { return normalize(text).replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim(); }
function words(text: string): string[] { return text.match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu) ?? []; }
function tokens(text: string): Set<string> {
  return new Set(words(normalize(text)).filter(word => word.length > 2 && !STOP.has(word))
    .map(word => word.length > 5 ? word.replace(/(?:ing|ed|s)$/, "") : word));
}
function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0; for (const word of a) if (b.has(word)) shared++;
  return 2 * shared / (a.size + b.size);
}
function rounded(n: number): number { return Math.round(n * 1000) / 1000; }
function ratio(n: number, d: number): number | null { return d > 0 ? rounded(n / d) : null; }
function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function before(a: TestbedEvent, b: TestbedEvent): boolean {
  return a.elapsedMs < b.elapsedMs || (a.elapsedMs === b.elapsedMs && a.sequence < b.sequence);
}
function sameRoom(a: TestbedEvent, b: TestbedEvent): boolean {
  return a.roomId !== undefined && a.roomId === b.roomId;
}
function isSpeech(e: TestbedEvent): boolean { return e.kind === "speech" && e.visibility === "public" && e.status === "succeeded" && !!e.text.trim(); }
function isObservationAction(e: TestbedEvent): boolean {
  return !!e.action && (OBSERVING.has(e.action.type) || (e.action.type === "interact" && OBSERVING.has(normalize(e.action.content ?? ""))));
}
function isPhysical(e: TestbedEvent): boolean { return e.visibility === "public" && !!e.action && PHYSICAL.has(e.action.type) && !isObservationAction(e); }
/** A successful wait-shaped receipt does not identify its decision origin.
 * Historical policy/normalization fallbacks also produced these actions. A
 * serialized decision ID alone cannot prove its matching engine admission. */
function waitReceiptMetrics(events: readonly TestbedEvent[]) {
  const rawWaitOrRestReceipts = events.filter(e => e.status === "succeeded" && ["wait", "rest"].includes(e.action?.type ?? "")).length;
  return {
    rawWaitOrRestReceipts,
    /** @deprecated Raw receipt count only; never evidence of deliberate intent. */
    explicitWaitOrRestActions: rawWaitOrRestReceipts,
    intentionalModelWaits: null as number | null,
    waitIntentAttribution: "unavailable_without_matching_admission_provenance" as const,
    unattributedWaitOrRestReceipts: rawWaitOrRestReceipts,
  };
}
function handoffRequest(text: string): boolean { return /\b(?:give|pass|lend|hand|borrow)\b/i.test(text); }
function questionTopic(text: string): string | null {
  const t = normalize(text);
  if (!t.includes("?")) return null;
  if (/\bkey\b/.test(t) && !handoffRequest(t) && /\b(?:do you have|have you got|where|know)\b/.test(t)) return "key_possession_or_location";
  if (/\b(?:spare|parts|bulbs|fuse)\b/.test(t) && /\b(?:where|do we have|do you have|stocked)\b/.test(t)) return "spare_supplies";
  if (/\bhow\b.*\b(?:holding up|feeling|doing)\b/.test(t)) return "wellbeing";
  if (/\b(?:what brought|how did|how.*come to|how.*end up)\b/.test(t) && /\b(?:here|house|place|care|caring|looking after)\b/.test(t)) return "arrival_or_house_history";
  if (/\bhow long\b/.test(t) && /\b(?:here|house|place|care|caring|looking after|supplies|meals|area|stocking)\b/.test(t)) return "tenure_or_house_history";
  return null;
}
function isGratitude(text: string): boolean {
  return /\b(?:thanks|thank you|appreciate|grateful|means a lot|means a great deal|fortunate|lucky to share)\b/i.test(text);
}
function informationClaim(text: string, topic: string): boolean {
  const t = normalize(text);
  if (t.includes("?") || /\b(?:don't|do not|no longer|not carrying|haven't)\b/.test(t)) return false;
  if (topic === "key_possession_or_location") return /\bkey\b/.test(t) && /\b(?:i have|i've got|i am carrying|i'm carrying|i hold|i carry)\b/.test(t);
  if (topic === "spare_supplies") return /\b(?:spares|spare(?:\s+\w+){0,2}\s+(?:fuse|parts|bulbs))\b/.test(t) && /\b(?:inside|cupboard|shelf|drawer)\b/.test(t);
  return false;
}

export function evaluateGenerativeAgentsRun(events: readonly TestbedEvent[], elapsedMs: number, options: GenerativeAgentsEvaluationOptions = {}) {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new Error("Evaluation requires nonnegative finite elapsedMs.");
  const windowMs = options.repetitionWindowMs ?? 120000, threshold = options.similarityThreshold ?? .55;
  const minSpeechTurns = options.minSpeechTurns ?? 12;
  if (!Number.isFinite(windowMs) || windowMs <= 0 || !Number.isFinite(threshold) || threshold <= 0 || threshold > 1 ||
      !Number.isSafeInteger(minSpeechTurns) || minSpeechTurns < 1) throw new Error("Invalid generative evaluation thresholds.");
  const names = options.actorNames ?? {};
  const valid = events.filter(e => Number.isFinite(e.elapsedMs) && e.elapsedMs >= 0 && e.elapsedMs <= elapsedMs &&
    Number.isSafeInteger(e.sequence) && e.sequence >= 0 && typeof e.text === "string")
    .sort((a, b) => a.elapsedMs - b.elapsedMs || a.sequence - b.sequence);
  const seen = new Set<number>();
  const tape = valid.filter(e => !seen.has(e.sequence) && !!seen.add(e.sequence));
  const speech = tape.filter(isSpeech), thoughts = tape.filter(e => e.kind === "thought");
  const terminalActions = tape.filter(e => e.action && (e.status === "succeeded" || e.status === "failed"));
  const successful = terminalActions.filter(e => e.status === "succeeded");
  const physical = successful.filter(isPhysical), failed = terminalActions.filter(e => e.status === "failed");
  const excerpt = (e: TestbedEvent): EvaluationExcerpt => ({ sequence: e.sequence, elapsedMs: e.elapsedMs, actorId: e.actorId,
    actor: e.actorId === undefined ? "World" : names[e.actorId] ?? `Actor ${e.actorId}`,
    ...(e.action?.target ? { target: e.action.target } : {}), text: e.text.slice(0, 500) });
  const evidence: RepetitionEvidence[] = [];
  const allTokens = new Map(speech.map(e => [e.sequence, tokens(e.text)]));
  const flagged = new Set<number>();
  let exactDuplicates = 0, lexicalRepeats = 0, questionReturns = 0, questionsAfterResponse = 0, infoChecks = 0, heardInfoChecks = 0, gratitudeReturns = 0;
  const earlier = (at: number) => speech.slice(0, at).filter(e => speech[at].elapsedMs - e.elapsedMs <= windowMs);
  const addEvidence = (kind: RepetitionEvidence["kind"], previous: TestbedEvent, current: TestbedEvent, reason: string,
    extra: Pick<RepetitionEvidence, "response" | "heardPerceptionSequence"> = {}) => {
    flagged.add(current.sequence);
    evidence.push({ kind, previous: excerpt(previous), current: excerpt(current),
      similarity: rounded(overlap(allTokens.get(previous.sequence)!, allTokens.get(current.sequence)!)), reason, ...extra });
  };

  for (let index = 0; index < speech.length; index++) {
    const current = speech[index], prior = earlier(index), own = prior.filter(e => e.actorId === current.actorId);
    if (own.some(e => canonical(e.text) === canonical(current.text))) exactDuplicates++;
    const similar = own.map(event => ({ event, score: overlap(allTokens.get(event.sequence)!, allTokens.get(current.sequence)!) }))
      .filter(x => Math.min(allTokens.get(x.event.sequence)!.size, allTokens.get(current.sequence)!.size) >= 4 && x.score >= threshold)
      .sort((a, b) => b.score - a.score)[0];
    if (similar) { lexicalRepeats++; addEvidence("lexical_repeat", similar.event, current, "Same speaker; content-token Dice overlap exceeded the stated threshold. Shared subject matter can produce false positives."); }

    const topic = questionTopic(current.text);
    if (topic) {
      const previous = own.filter(e => normalize(e.action?.target ?? "") === normalize(current.action?.target ?? "") &&
        questionTopic(e.text) === topic).at(-1);
      if (previous) {
        questionReturns++;
        const response = prior.find(e => before(previous, e) && e.actorId !== previous.actorId && sameRoom(e, previous) &&
          e.actorId !== undefined && names[e.actorId] && normalize(names[e.actorId]) === normalize(previous.action?.target ?? "") &&
          previous.actorId !== undefined && names[previous.actorId] && normalize(e.action?.target ?? "") === normalize(names[previous.actorId]) &&
          (!e.text.includes("?") || /[.!](?:\s|$)/.test(e.text)));
        if (response) questionsAfterResponse++;
        addEvidence("question_topic_return", previous, current, `Question topic returned: ${topic}. A new detail may make this reasonable; an intervening response with a declarative clause is structural evidence, not proof that it fully answered the question.`,
          response ? { response: excerpt(response) } : {});
      }
      if (["key_possession_or_location", "spare_supplies"].includes(topic)) {
        const claim = prior.filter(e => e.actorId !== current.actorId && sameRoom(e, current) && informationClaim(e.text, topic))
          .filter(e => topic !== "key_possession_or_location" || e.actorId !== undefined && !!names[e.actorId] &&
            normalize(names[e.actorId]) === normalize(current.action?.target ?? ""))
          .filter(e => !successful.some(action => before(e, action) && before(action, current) &&
            ["give", "drop", "pickup"].includes(action.action?.type ?? "") &&
            /\b(?:key|fuse|spare|parts)\b/i.test(`${action.action?.target ?? ""} ${action.action?.content ?? ""}`))).at(-1);
        if (claim) {
          infoChecks++;
          const heard = tape.find(e => e.kind === "perception" && e.actorId === current.actorId && before(claim, e) && before(e, current) &&
            normalize(e.text).includes(normalize(claim.text)));
          if (heard) heardInfoChecks++;
          addEvidence("information_check_after_claim", claim, current,
            `A local ${topic} statement preceded this information check. Explicit handoff requests and intervening item transfers are excluded. The statement's truth is not independently proved.`,
            heard ? { heardPerceptionSequence: heard.sequence } : {});
        }
      }
    }
    if (isGratitude(current.text) && !current.text.includes("?")) {
      const previous = own.filter(e => current.elapsedMs - e.elapsedMs <= Math.min(windowMs, 30000) &&
        isGratitude(e.text) && !e.text.includes("?") && sameRoom(e, current)).at(-1);
      if (previous) { gratitudeReturns++; addEvidence("gratitude_recurrence", previous, current,
        "Another gratitude/appreciation turn by this speaker within 30 seconds. This catches paraphrased social loops but may also be appropriate politeness; it is not a semantic duplicate claim."); }
    }
  }

  const gaps = speech.slice(1).map((e, i) => e.elapsedMs - speech[i].elapsedMs);
  const rapidSwitches = speech.slice(1).filter((e, i) => e.actorId !== speech[i].actorId && sameRoom(e, speech[i]) && gaps[i] <= 2000).length;
  const rapidAlternations = speech.slice(2).filter((e, i) => e.actorId === speech[i].actorId && e.actorId !== speech[i + 1].actorId &&
    sameRoom(e, speech[i + 1]) && sameRoom(e, speech[i]) && e.elapsedMs - speech[i + 1].elapsedMs <= 2000 &&
    speech[i + 1].elapsedMs - speech[i].elapsedMs <= 2000).length;
  let peakTurnsIn10s = 0, left = 0;
  for (let right = 0; right < speech.length; right++) {
    while (speech[right].elapsedMs - speech[left].elapsedMs >= 10000) left++;
    peakTurnsIn10s = Math.max(peakTurnsIn10s, right - left + 1);
  }
  const speechWords = speech.reduce((sum, e) => sum + words(e.text).length, 0);
  const goalEvents = tape.filter(e => e.kind === "goal_completed" && e.visibility !== "private");
  const firstGoal = goalEvents[0] ?? null, post = firstGoal ? tape.filter(e => before(firstGoal, e)) : [];
  const postPhysical = post.filter(e => e.status === "succeeded" && isPhysical(e));
  const ids = [...new Set([...Object.keys(names).map(Number), ...tape.flatMap(e => e.actorId === undefined ? [] : [e.actorId])])].sort((a, b) => a - b);
  const rules = options.milestoneRules ?? STORM_HOUSE_MILESTONES;
  const milestones = rules.map(rule => {
    if (!rule.id || (!rule.kind && !rule.actionType)) throw new Error("Milestone rules require an id and event kind or action type.");
    const matches = tape.filter(e => e.visibility !== "private" && e.status === "succeeded" && e.kind !== "speech" &&
      (!rule.kind || e.kind === rule.kind) && (!rule.actionType || e.action?.type === rule.actionType) &&
      (!rule.target || e.action?.target === rule.target) && (!rule.verb || e.action?.content === rule.verb) &&
      (!rule.textIncludes || e.text.includes(rule.textIncludes)));
    return { id: rule.id, label: rule.label, observed: matches.length > 0, occurrences: matches.length,
      first: matches[0] ? excerpt(matches[0]) : null, actorIds: [...new Set(matches.flatMap(e => e.actorId === undefined ? [] : [e.actorId]))] };
  });
  const thoughtTokens = thoughts.map(e => ({ event: e, tokens: tokens(e.text) }));
  const thoughtRepeats = thoughtTokens.filter((current, index) => thoughtTokens.slice(0, index).some(prior =>
    current.event.actorId === prior.event.actorId && current.event.elapsedMs - prior.event.elapsedMs <= windowMs &&
    Math.min(current.tokens.size, prior.tokens.size) >= 4 && overlap(current.tokens, prior.tokens) >= threshold)).length;
  const sufficient = elapsedMs >= 30000 && speech.length >= minSpeechTurns && thoughts.length >= 3;
  const repetitionFlag = flagged.size >= 3 && flagged.size / Math.max(1, speech.length) >= .2;
  const longPhysicalGap = firstGoal !== null && elapsedMs - (postPhysical.at(-1)?.elapsedMs ?? firstGoal.elapsedMs) >= 30000;
  return {
    version: 1 as const,
    thresholds: { repetitionWindowMs: windowMs, similarityThreshold: threshold, minSpeechTurns, minObservationMs: 30000, gratitudeWindowMs: Math.min(windowMs, 30000) },
    metrics: {
      observation: { elapsedMs, receivedEvents: events.length, acceptedEvents: tape.length, droppedInvalidOrDuplicateEvents: events.length - tape.length,
        observedActors: new Set(tape.flatMap(e => e.actorId === undefined ? [] : [e.actorId])).size,
        namedExpectedActors: Object.keys(names).length, decisionLatencySamples: tape.filter(e => e.kind === "decision_latency").length },
      thoughts: { count: thoughts.length, lexicalRepeatCandidates: thoughtRepeats, repeatCandidateFraction: ratio(thoughtRepeats, thoughts.length) },
      speech: { turns: speech.length, words: speechWords, turnsPerMinute: ratio(speech.length * 60000, elapsedMs), wordsPerMinute: ratio(speechWords * 60000, elapsedMs) },
      repetition: { exactSameSpeakerDuplicates: exactDuplicates, lexicalRepeatCandidates: lexicalRepeats,
        repeatedQuestionTopicCandidates: questionReturns, questionReturnsAfterTargetResponse: questionsAfterResponse,
        informationChecksAfterLocalClaim: infoChecks, informationChecksAfterRecordedHearing: heardInfoChecks,
        gratitudeRecurrenceCandidates: gratitudeReturns, flaggedSpeechTurns: flagged.size, flaggedSpeechFraction: ratio(flagged.size, speech.length) },
      pacing: { medianGapMs: median(gaps), rapidSpeakerSwitchesWithin2s: rapidSwitches, rapidABAAlternations: rapidAlternations, peakTurnsIn10s,
        estimatedVocalizationLoadAt150Wpm: ratio(speechWords * 60000, elapsedMs * 150) },
      actions: { terminalReceipts: terminalActions.length, succeeded: successful.length, failed: failed.length,
        failedFraction: ratio(failed.length, terminalActions.length), pendingReceipts: tape.filter(e => e.action && e.status === "pending").length,
        successfulPhysical: physical.length, distinctPhysicalTasks: new Set(physical.map(e => `${e.action!.type}:${e.action!.target ?? ""}:${e.action!.content ?? ""}`)).size,
        observationActions: successful.filter(isObservationAction).length, ...waitReceiptMetrics(successful) },
      postGoal: { firstGoalMs: firstGoal?.elapsedMs ?? null, durationMs: firstGoal ? elapsedMs - firstGoal.elapsedMs : null,
        speechTurns: post.filter(isSpeech).length, successfulPhysicalActions: postPhysical.length,
        successfulObservationActions: post.filter(e => e.status === "succeeded" && isObservationAction(e)).length,
        ...waitReceiptMetrics(post),
        failedActions: post.filter(e => e.action && e.status === "failed").length,
        physicalActionFreeTailMs: firstGoal ? elapsedMs - (postPhysical.at(-1)?.elapsedMs ?? firstGoal.elapsedMs) : null },
      collaboration: { committedGoalReceipts: goalEvents.length, successfulItemHandoffs: successful.filter(e => e.action!.type === "give").length,
        physicalContributorIds: [...new Set(physical.flatMap(e => e.actorId === undefined ? [] : [e.actorId]))],
        milestoneContributorIds: [...new Set(milestones.flatMap(m => m.actorIds))], observedMilestones: milestones.filter(m => m.observed).length },
    },
    byActor: ids.map(id => ({ id, name: names[id] ?? `Actor ${id}`, thoughts: thoughts.filter(e => e.actorId === id).length,
      speechTurns: speech.filter(e => e.actorId === id).length, successfulPhysicalActions: physical.filter(e => e.actorId === id).length,
      failedActions: failed.filter(e => e.actorId === id).length })),
    milestones,
    evidence,
    assessment: { socialEvidence: !sufficient ? "insufficient_observation" : repetitionFlag ? "repetition_review_needed" : "no_repetition_flag_at_current_threshold",
      postGoalPhysicalEngagement: !firstGoal ? "no_goal_boundary_observed" : longPhysicalGap ? "long_gap_without_physical_action_receipts" : "recent_physical_action_receipts",
      doesNotEstablish: "Social naturalness, durable memory, challenge difficulty, or renderer/audio fidelity." },
    limitations: [
      "This evaluator has no semantic model. Token overlap, recurring question topics and gratitude vocabulary produce candidates for human review, including false positives and missed paraphrases.",
      "A response after a question is not proof it answered it. Information-check evidence distinguishes exact recorded hearing from merely being in the same room; public statements are not independent proof of their truth.",
      "Silence and absent thoughts are insufficient observation, never a success. Lower speech/repetition counts must be compared alongside duration, thought coverage and physical engagement.",
      "No physical action receipts does not establish idleness: rest, listening or activity may be uninstrumented. Successful receipts can be redundant and are not necessarily novel progress.",
      "Wait/rest counts are raw successful receipts, not intentional model waits: policy or normalization fallbacks can produce the same action. Intent attribution is unavailable without matching admission provenance; a serialized decision ID, nearby thought or timestamp is insufficient. The deprecated explicitWaitOrRestActions field is an alias of rawWaitOrRestReceipts.",
      "Milestones require successful non-speech records. Multiple contributors do not establish that collaboration was necessary, and one repair does not establish a difficult or general reasoning benchmark.",
      "Vocalization load estimates requested words at 150 words/minute, not actual synthesized speech or overlapping audio. Thought metrics are operator diagnostics; private thought/perception bodies are never quoted in this report.",
    ],
  };
}

export type GenerativeAgentsEvaluation = ReturnType<typeof evaluateGenerativeAgentsRun>;

/** Rates and observation coverage travel together; a quieter or shorter run is
 * never automatically promoted to a better social outcome. */
export function compareGenerativeAgentsEvaluations(baseline: GenerativeAgentsEvaluation, candidate: GenerativeAgentsEvaluation) {
  const delta = (before: number | null, after: number | null) => before === null || after === null ? null : rounded(after - before);
  return {
    baselineElapsedMs: baseline.metrics.observation.elapsedMs, candidateElapsedMs: candidate.metrics.observation.elapsedMs,
    comparableObservation: baseline.assessment.socialEvidence !== "insufficient_observation" && candidate.assessment.socialEvidence !== "insufficient_observation",
    deltas: {
      speechTurnsPerMinute: delta(baseline.metrics.speech.turnsPerMinute, candidate.metrics.speech.turnsPerMinute),
      flaggedSpeechFraction: delta(baseline.metrics.repetition.flaggedSpeechFraction, candidate.metrics.repetition.flaggedSpeechFraction),
      informationChecksAfterRecordedHearing: candidate.metrics.repetition.informationChecksAfterRecordedHearing - baseline.metrics.repetition.informationChecksAfterRecordedHearing,
      successfulPhysicalActions: candidate.metrics.actions.successfulPhysical - baseline.metrics.actions.successfulPhysical,
      observedMilestones: candidate.metrics.collaboration.observedMilestones - baseline.metrics.collaboration.observedMilestones,
    },
    interpretation: "Diagnostic comparison only. Check matched duration, actor thought/speech coverage, milestone difficulty and physical receipts before interpreting lower repetition as an improvement.",
  };
}

export function formatGenerativeAgentsEvaluation(e: GenerativeAgentsEvaluation): string {
  const m = e.metrics;
  const examples = ["information_check_after_claim", "question_topic_return", "gratitude_recurrence", "lexical_repeat"]
    .flatMap(kind => e.evidence.filter(item => item.kind === kind).slice(0, 2));
  return [
    "## Transcript and behavior diagnostics", "",
    `${m.observation.elapsedMs / 1000}s observed; ${m.thoughts.count} thoughts; ${m.speech.turns} public speech turns (${m.speech.turnsPerMinute ?? "n/a"}/min). Social evidence: ${e.assessment.socialEvidence}.`, "",
    `Exact repeated utterances: ${m.repetition.exactSameSpeakerDuplicates}; token-overlap candidates: ${m.repetition.lexicalRepeatCandidates}; question-topic returns: ${m.repetition.repeatedQuestionTopicCandidates}; information checks after a local claim: ${m.repetition.informationChecksAfterLocalClaim} (${m.repetition.informationChecksAfterRecordedHearing} with exact recorded hearing); gratitude recurrences: ${m.repetition.gratitudeRecurrenceCandidates}. These categories overlap and are not semantic judgments.`, "",
    `Median speech gap: ${m.pacing.medianGapMs ?? "n/a"}ms; rapid speaker changes: ${m.pacing.rapidSpeakerSwitchesWithin2s}; peak turns/10s: ${m.pacing.peakTurnsIn10s}; estimated vocalization load at 150 words/minute: ${m.pacing.estimatedVocalizationLoadAt150Wpm ?? "n/a"}× available time.`, "",
    `Successful physical action receipts: ${m.actions.successfulPhysical}; failed action receipts: ${m.actions.failed}; raw successful wait/rest receipts: ${m.actions.rawWaitOrRestReceipts}. Intentional model-wait attribution: unavailable. After first goal completion: ${m.postGoal.successfulPhysicalActions} physical actions, ${m.postGoal.successfulObservationActions} observation actions, ${m.postGoal.rawWaitOrRestReceipts} raw wait/rest receipts; physical-action-free tail ${m.postGoal.physicalActionFreeTailMs === null ? "n/a" : m.postGoal.physicalActionFreeTailMs / 1000 + "s"}. Absence of physical receipts alone is not proof of idleness.`, "",
    `Committed milestones: ${e.milestones.filter(milestone => milestone.observed).map(milestone => `${milestone.label} at ${milestone.first!.elapsedMs / 1000}s`).join("; ") || "none"}.`, "",
    ...examples.flatMap(item => [
      `- ${item.kind}: #${item.previous.sequence} (${item.previous.elapsedMs / 1000}s) ${item.previous.actor}: ${JSON.stringify(item.previous.text)} → #${item.current.sequence} (${item.current.elapsedMs / 1000}s) ${item.current.actor}: ${JSON.stringify(item.current.text)}${item.heardPerceptionSequence === undefined ? "" : `; recorded hearing #${item.heardPerceptionSequence}`}${item.response ? `; intervening response #${item.response.sequence}` : ""}.`,
    ]), "", ...e.limitations.map(limit => `- ${limit}`), "",
  ].join("\n");
}
