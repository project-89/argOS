/** Private, read-only evidence for the bounded crisis harness. None of this
 * feeds cognition or grants execution. The process hosts only this one world. */
import type { World } from "../ecs/world";
import { getCommittedEvents } from "../runtime/committed-events";
import { readSimulationTime } from "../ecs/simulation-time";
import { enableControlLoopDiagnostics, getControlLoopDiagnostics } from "../runtime/control-loop-diagnostics";
import { chronicle } from "../cognition/simulation-chronicle";
import type { WorkingMemoryReceipt } from "../cognition/working-memory";

export function recordCrisisControlEvidence(world: World, append: (file: string, value: unknown) => void) {
  enableControlLoopDiagnostics(world);
  const chronicleCoverageAtStart = chronicle.getCoverage();
  let lastSequence = 0, missingSequences = 0, archivedEntries = 0;
  const dispose = chronicle.subscribe(entry => append("chronicle.jsonl", {
    // Chronicle is process-global, unlike the world-scoped control ledger.
    // This is observation context, not proof of an entry's source authority.
    scope: "process", observedSourceId: getCommittedEvents(world).sourceId,
    observedAtSimMs: readSimulationTime(world), entry,
  }));
  const collect = () => {
    const ledger = getControlLoopDiagnostics(world);
    for (const entry of ledger.entries) {
      if (entry.sequence <= lastSequence) continue;
      if (entry.sequence > lastSequence + 1) missingSequences += entry.sequence - lastSequence - 1;
      append("control-ledger.jsonl", entry); lastSequence = entry.sequence; archivedEntries++;
    }
    return { enabled: ledger.enabled, latestSequence: ledger.latestSequence, archivedThroughSequence: lastSequence,
      archivedEntries, missingSequences, nativeDropped: ledger.dropped,
      chronicleCoverageAtStart, chronicleCoverageNow: chronicle.getCoverage() };
  };
  return { collect, dispose };
}

/** Retain one bounded native receipt tail per actor, not the history of every
 * snapshot. Upserts/removals reconstruct each sampled tail; final full memory
 * is also saved separately. Never treat an observer sample as execution. */
export class CrisisReceiptDeltas {
  private tails = new Map<string, Map<string, string>>();
  capture(actorKey: string, receipts: WorkingMemoryReceipt[]) {
    const previous = this.tails.get(actorKey) ?? new Map<string, string>();
    const current = new Map(receipts.map(receipt => [receipt.id, JSON.stringify(receipt)]));
    const upsert = receipts.filter(receipt => previous.get(receipt.id) !== current.get(receipt.id));
    const removed = [...previous.keys()].filter(id => !current.has(id));
    this.tails.set(actorKey, current);
    return { upsert, removed, retained: current.size };
  }
}
