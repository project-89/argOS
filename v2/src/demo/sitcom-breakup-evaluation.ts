import type { PhoneContactProfile } from "./phone-contact";
import { FACIAL_EXPRESSIONS } from "../cognition/affect-state";

export type BreakupCondition = "breakup" | "neutral" | "logistics" | "writing" | "coffee" | "handoff" | "destination";
export type BreakupContactCondition = "boyfriend" | "neutral";
/** A matched neutral message changes only the messages, not the existing
 * partner/history. The separate unknown-contact control is explicitly opt-in. */
export function breakupTrialInputs(condition: BreakupCondition, contactCondition: BreakupContactCondition = "boyfriend") {
  const contact: PhoneContactProfile = contactCondition === "boyfriend"
    ? { name: "David", relationship: "boyfriend", context: "David and Elaine have been in a serious relationship for two years. They usually spend Friday evenings together and had dinner plans tonight." }
    : { name: "Unknown sender", relationship: "unknown", context: "" };
  const stimuli = condition === "destination" ? [
    { atSimMs: 8000, text: "I'm at The Lantern restaurant on Mercer Street. Would you like to meet me here now for dinner? Take a cab if you'd prefer not to walk. Let me know if tonight no longer works." },
    { atSimMs: 28000, text: "I'm waiting at The Lantern. I'd like to see you, but you can say no. If you are coming, tell me when you're on your way." },
  ] : condition === "handoff" ? [
    { atSimMs: 8000, text: "Could you leave the building manager a handoff in Evening notes for tomorrow, when neither of us will be there? The plumber is booked for 10 AM to check the kitchen sink. Please leave the finished note in the Kitchen and text me once it's ready." },
    { atSimMs: 28000, text: "Correction from the plumber: the visit is now 11 AM, and it is the bathroom tap, not the kitchen sink. Please make sure the final note has the corrected details. If you can't leave it, let me know." },
  ] : condition === "coffee" ? [
    { atSimMs: 8000, text: "Dinner is running a little late. Would you and Jerry like to have a cup of his coffee before you leave? There is no rush." },
    { atSimMs: 28000, text: "I can meet you later. Enjoy the coffee if you want some; just text me when you are ready to head out." },
  ] : condition === "writing" ? [
    { atSimMs: 8000, text: "Before dinner, could you leave Jerry a note in Evening notes? Please write that the spare apartment key is with the downstairs neighbor, review it, and finish the note." },
    { atSimMs: 28000, text: "Leave the finished note in the Kitchen so Jerry can find it, then text me when you have done it. If you cannot, just let me know." },
  ] : condition === "breakup" ? [
    { atSimMs: 8000, text: "Elaine, I'm ending our relationship. This is final. I'm not coming over tonight." },
    { atSimMs: 28000, text: "I mean it. We are no longer together. I will arrange to return your things next week." },
  ] : condition === "logistics" ? [
    { atSimMs: 8000, text: "Elaine, are you still coming to dinner tonight? Please let me know so I can leave work." },
    { atSimMs: 28000, text: "I need to confirm the reservation. Should I keep it for two?" },
  ] : [
    { atSimMs: 8000, text: "Elaine, the restaurant confirmed our dinner reservation for eight tonight. I'll see you there." },
    { atSimMs: 28000, text: "The reservation is under David. The restaurant is on the same corner as last time." },
  ];
  return Object.freeze({ contact: Object.freeze(contact), stimuli: Object.freeze(stimuli.map(value => Object.freeze(value))) });
}

export interface BreakupPerceptionEvidence {
  id: number; type: string; source: string; content: string; timestamp: number;
}
export interface BreakupObservationFrame {
  atSimMs: number;
  actors: Array<{ name: string; affect?: unknown; appraisal?: unknown;
    perceptions?: BreakupPerceptionEvidence[]; visibleExpressions?: Array<{ subject: string; expression: string }> }>;
}
/** This is an observation ledger, not an emotion/narrative success classifier.
 * Private affect, a visible face, and an observer's delivered perception remain
 * separate evidence channels. Text resemblance alone never proves disclosure. */
export function breakupObservationEvidence(frames: readonly BreakupObservationFrame[], firstReadAtSimMs: number | null,
  events: ReadonlyArray<{ kind: string; actor?: string; text: string; atSimMs: number; sequence: number }> = []) {
  const affects: Array<{ actor: string; sampledAtSimMs: number; value: unknown }> = [];
  const appraisals: Array<{ actor: string; sampledAtSimMs: number; value: unknown }> = [];
  const views: Array<{ observer: string; sampledAtSimMs: number; expressions: Array<{ subject: string; expression: string }> }> = [];
  const delivered: Array<{ observer: string; firstSampledAtSimMs: number; perception: BreakupPerceptionEvidence }> = [];
  const previousAffect = new Map<string, string>(), previousAppraisal = new Map<string, string>(), previousView = new Map<string, string>(), seenPerceptions = new Set<string>();
  for (const frame of frames) for (const actor of frame.actors) {
    for (const [value, previous, output] of [[actor.affect, previousAffect, affects], [actor.appraisal, previousAppraisal, appraisals]] as const) {
      const signature = JSON.stringify(value ?? null);
      if (previous.get(actor.name) !== signature) {
        previous.set(actor.name, signature);
        if (value !== undefined && value !== null) output.push({ actor: actor.name, sampledAtSimMs: frame.atSimMs, value });
      }
    }
    const expressions = actor.visibleExpressions ?? [], signature = JSON.stringify(expressions);
    if (previousView.get(actor.name) !== signature) { previousView.set(actor.name, signature); views.push({ observer: actor.name, sampledAtSimMs: frame.atSimMs, expressions }); }
    for (const perception of actor.perceptions ?? []) {
      const key = JSON.stringify([actor.name, perception.id, perception.timestamp, perception.type, perception.source, perception.content]);
      if (!seenPerceptions.has(key)) { seenPerceptions.add(key); delivered.push({ observer: actor.name, firstSampledAtSimMs: frame.atSimMs, perception }); }
    }
  }
  const actorNames = new Set(frames.flatMap(frame => frame.actors.map(actor => actor.name)));
  const facialObservations = delivered.flatMap(row => {
    const { perception } = row;
    if (perception.type !== "action" || !actorNames.has(perception.source) || perception.source === row.observer) return [];
    // Exact engine-emitter envelope, not an arbitrary mention of an expression
    // in speech, a private feeling, a read message or an operator-visible view.
    const found = FACIAL_EXPRESSIONS.flatMap(expression => {
      if (perception.content === `${perception.source}'s expression shifts to ${expression}.`) return [{ expression, cue: "expression_transition" }];
      if (perception.content.startsWith(`${perception.source}'s appearance has changed: expression: ${expression}, `)) return [{ expression, cue: "multi_property_transition" }];
      if (perception.content.startsWith(`You notice ${perception.source}: expression: ${expression}; `)) return [{ expression, cue: "appearance_refresh" }];
      return [];
    })[0];
    if (!found) return [];
    const event = [...events].reverse().find(value => value.kind === "perception" && value.actor === row.observer
      && value.text === perception.content && value.atSimMs <= row.firstSampledAtSimMs && value.atSimMs >= row.firstSampledAtSimMs - 500);
    return [{ observer: row.observer, subject: perception.source, ...found, perceptionId: perception.id,
      atSimMs: event?.atSimMs ?? row.firstSampledAtSimMs, eventSequence: event?.sequence ?? null,
      timing: event ? "exact_delivered_perception_event" : "first_sample_of_delivered_perception" }];
  });
  return { privateAffectChanges: affects, privateAppraisalDiagnostics: appraisals,
    sightGatedExpressionAvailability: views,
    deliveredPerceptions: delivered,
    deliveredFacialExpressionObservations: facialObservations,
    elaineExpressionDeliveredToPeersAfterRead: facialObservations.filter(row => row.subject === "Elaine" && firstReadAtSimMs !== null && row.atSimMs >= firstReadAtSimMs),
    deliveredPeerPerceptionsAfterRead: delivered.filter(row => firstReadAtSimMs !== null && row.observer !== "Elaine" && row.firstSampledAtSimMs >= firstReadAtSimMs),
    interpretation: "Affect/appraisal are private. Sight-gated views are availability, not proof of attention. Delivered perceptions preserve source/type and literal content; semantic cause or knowledge disclosure requires reviewing the actual speech/perception evidence. Sampling timestamps bound observation to the 250ms capture cadence, not exact stimulus delivery." };
}
