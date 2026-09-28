/** Evaluation only. These checks never select actions, edit goals or authorize
 * construction. Native travel with a selected intention schedules the bounded probe;
 * its meaning and linkage still require qualitative review. */
import type { ActorIntentionEvidence } from "../spirits/actor-intention-evidence";
import type { PublicCommittedEvent } from "../runtime/committed-events";
import type { SitcomEvent } from "../demo/apartment-sitcom";
import type { ActorContinuation } from "../cognition/actor-continuation";

export const ELAINE_GROWTH_TEXT = "Hey Elaine, I would love to have dinner with you. Could you pick a nearby restaurant and get something to eat there? Text me which place you choose. I am still at work, so do not wait for me to arrive.";
export const ELAINE_GROWTH_CONTACT = Object.freeze({ name: "Alex", relationship: "boyfriend",
  context: "Alex and Elaine are dating. Alex is an outside phone contact, currently at work." });

export function observedDiningIntention(records: readonly ActorIntentionEvidence[], actorKey: string, readAt: number | undefined,
  travel?: { departure: PublicCommittedEvent; sourceId: string; streetKey: string; streetName: string; selected: Readonly<ActorContinuation> | undefined }) {
  if (readAt === undefined || !Number.isFinite(readAt) || readAt < 0 || !travel) return;
  const { selected, departure } = travel;
  if (!selected || !["proposed", "dispatched", "waiting"].includes(selected.status) || selected.actionType !== "move"
    || selected.target !== travel.streetName || !Number.isFinite(selected.observedAtSimMs) || selected.observedAtSimMs < readAt
    || !Number.isFinite(selected.integratedAtSimMs) || selected.integratedAtSimMs < selected.observedAtSimMs
    || departure.startedAtSimMs === undefined || selected.integratedAtSimMs > departure.startedAtSimMs
    || !completedArrival(departure, { sourceId: travel.sourceId, actorKey, destinationKey: travel.streetKey, afterSimMs: readAt, minTravelMs: 3000 })) return;
  // A saved wish or phone-coordination task alone cannot trigger construction.
  // Check the purpose actually served by this observed outward leg. Lexical
  // discovery remains eval-only; Weaver judges need and never owes a proposal.
  const dining = (row: ActorIntentionEvidence) => row.actorKey === actorKey && /\b(restaurant|diner|dinner|meal)\b/i.test(row.description);
  return records.find(row => dining(row) && row.kind === "goal" && !!selected.goalKey && row.goalKey === selected.goalKey)
    ?? records.find(row => dining(row) && row.kind === "selected_purpose" && row.description === selected.purpose && row.goalKey === selected.goalKey);
}
export function completedPhoneRead(events: readonly SitcomEvent[], messageId: number, sentAt: number) {
  return events.find(e => e.actor === "Elaine" && e.kind === "phone_read" && e.messageId === messageId
    && e.atSimMs >= sentAt && e.status === "succeeded");
}
export function completedPhoneReply(events: readonly SitcomEvent[], readAt: number) {
  // Caller additionally binds the outbound message's native replyTo to the
  // original inbound identity. A reply proposal/fragment is never a sent reply.
  return events.filter(e => e.actor === "Elaine" && e.kind === "reply_typed"
    && e.status === "succeeded" && e.atSimMs >= readAt);
}
export function completedArrival(event: PublicCommittedEvent, scope: {
  sourceId: string; actorKey: string; destinationKey: string; afterSimMs: number; minTravelMs: number;
}) {
  return event.sourceId === scope.sourceId && event.actorKey === scope.actorKey
    && event.kind === "action" && event.action === "move" && event.status === "succeeded"
    && event.targetKey === scope.destinationKey && event.startedAtSimMs !== undefined
    && event.completedAtSimMs === event.atSimMs && event.startedAtSimMs >= scope.afterSimMs
    && event.atSimMs - event.startedAtSimMs >= scope.minTravelMs;
}
