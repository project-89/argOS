import type { AgentAction } from "../cognition/agent-mind";
import type { EscapeRoomEvent } from "../demo/escape-room";

const canonical = (value: string | undefined) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const sameAction = (a: AgentAction | undefined, b: AgentAction) => a?.type === b.type
  && canonical(a.target) === canonical(b.target) && canonical(a.content) === canonical(b.content);
const isEntry = (action: AgentAction | undefined) => action?.type === "interact"
  && canonical(action.target) === "exit keypad" && /^enter \d{4}$/.test(canonical(action.content));
const terminal = (event: EscapeRoomEvent) => event.kind === "action" && ["succeeded", "failed"].includes(event.status ?? "");

/** Consume the evaluator's validated, ordered tape. Operator intent or an old
 * stage marker does not prove that an in-flight action was actually disrupted.
 * The runtime's causal snapshot must join to the original pending/failed action,
 * a real power restoration and a fresh two-second successful physical attempt. */
export function findInterruptedUnlockRecovery(tape: readonly EscapeRoomEvent[]) {
  for (const trip of tape) {
    const evidence = trip.powerTrip, original = evidence?.pendingUnlock;
    if (trip.kind !== "operator_edit" || trip.visibility !== "operator" || !original
      || evidence?.fromPower !== "exit" || evidence.exitOpen !== false || !isEntry(original.action)
      || original.actorId === original.helperId || original.untilMs <= trip.elapsedMs
      || original.untilMs > trip.elapsedMs + 2000 || original.helperUntilMs <= trip.elapsedMs) continue;
    const start = tape.find(event => event.sequence < trip.sequence && event.kind === "action" && event.status === "pending"
      && event.actorId === original.actorId && sameAction(event.action, original.action)
      && event.elapsedMs + 2000 === original.untilMs);
    const held = tape.find(event => event.sequence < trip.sequence && event.kind === "action" && event.status === "pending"
      && event.actorId === original.helperId && event.action?.type === "interact"
      && canonical(event.action.target) === "exit release" && canonical(event.action.content) === "hold"
      && event.elapsedMs + 45_000 === original.helperUntilMs);
    if (!start || !held || tape.some(event => event.sequence > start.sequence && event.sequence < trip.sequence
      && terminal(event) && event.actorId === original.actorId && sameAction(event.action, original.action))
      || tape.some(event => event.sequence > held.sequence && event.sequence < trip.sequence && terminal(event)
        && event.actorId === original.helperId && sameAction(event.action, held.action!))) continue;
    const failed = tape.find(event => event.sequence > trip.sequence && terminal(event)
      && event.actorId === original.actorId && sameAction(event.action, original.action));
    if (failed?.status !== "failed" || failed.elapsedMs !== trip.elapsedMs) continue;
    const interrupted = tape.find(event => event.sequence > failed.sequence && event.kind === "milestone"
      && event.text === "exit_unlock_interrupted" && event.elapsedMs === trip.elapsedMs);
    if (!interrupted) continue;
    for (const retry of tape) {
      if (retry.sequence <= interrupted.sequence || retry.kind !== "action" || retry.status !== "pending"
        || retry.actorId === undefined || !sameAction(retry.action, original.action)) continue;
      const restored = tape.some(event => event.sequence > failed.sequence && event.sequence < retry.sequence
        && terminal(event) && event.status === "succeeded" && event.action?.type === "interact"
        && canonical(event.action.target) === "power router" && canonical(event.action.content) === "route exit");
      const completed = tape.find(event => event.sequence > retry.sequence && terminal(event)
        && event.actorId === retry.actorId && sameAction(event.action, original.action));
      if (!restored || completed?.status !== "succeeded" || completed.elapsedMs !== retry.elapsedMs + 2000) continue;
      const opened = tape.some(event => event.sequence > retry.sequence && event.sequence < completed.sequence
        && event.kind === "milestone" && event.text === "exit_open" && event.elapsedMs === completed.elapsedMs);
      if (opened) return { observed: true, tripSequence: trip.sequence, originalStartSequence: start.sequence,
        originalFailureSequence: failed.sequence, interruptedActorId: original.actorId, helperId: original.helperId,
        retryStartSequence: retry.sequence, retryCompletionSequence: completed.sequence, retryActorId: retry.actorId };
    }
  }
  return { observed: false };
}
