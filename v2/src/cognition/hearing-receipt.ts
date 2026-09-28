/** Opaque timed-hearing provenance. Kept below cognition/planning so native
 * effects and mailbox admission can validate receipts without an import cycle. */
import { entityExists, hasComponent } from "bitecs";
import type { World } from "../ecs/world";
import { Agent, WorkingMemoryIdentity } from "../ecs/components";
import { readSimulationTime } from "../ecs/simulation-time";
import { getCommittedEvents } from "../runtime/committed-events";
import { workingMemoryEntityRef } from "./working-memory";

/** An in-process producer receipt, not authority supplied/restored as JSON. */
export interface HeardSpeechProgress { readonly executionId: string; readonly boundary: "progress" | "sentence" | "end" }
export type HeardSpeechNotice = { type: string; content: string; source: string; hearing?: HeardSpeechProgress };
type ProgressIssuance = { world: World; eid: number; owner: string; source: string | null; atSimMs: number; content: string; speaker: string };
const progressIssuances = new WeakMap<HeardSpeechProgress, ProgressIssuance>();
/** Internal producer entry point; only actually heard fragments may issue one. */
export function hearingReceipt(world: World, eid: number, executionId: string, boundary: HeardSpeechProgress["boundary"], content: string, speaker: string): HeardSpeechProgress {
  const receipt = Object.freeze({ executionId, boundary });
  progressIssuances.set(receipt, { world, eid, owner: workingMemoryEntityRef(world, eid)!.key,
    source: getCommittedEvents(world).sourceId, atSimMs: readSimulationTime(world), content, speaker });
  return receipt;
}
/** Unknown metadata grants no authority. A real but stale/corrupted envelope
 * must not become fresh speech in another actor or restarted source. */
export function isInvalidHeardSpeechNotice(world: World, eid: number, notice: HeardSpeechNotice): boolean {
  const issued = notice.hearing && progressIssuances.get(notice.hearing), tape = getCommittedEvents(world);
  if (!issued) return false;
  return issued.world !== world || issued.eid !== eid || tape.stopped || tape.sourceId !== issued.source
    || !entityExists(world, eid) || !hasComponent(world, eid, Agent) || !Agent.active[eid]
    || !hasComponent(world, eid, WorkingMemoryIdentity) || WorkingMemoryIdentity.id[eid] !== issued.owner
    || readSimulationTime(world) < issued.atSimMs || notice.type !== "speech_fragment" || notice.content !== issued.content || notice.source !== issued.speaker;
}
export function readHeardSpeechProgress(world: World, eid: number, notice: HeardSpeechNotice): HeardSpeechProgress | undefined {
  return notice.hearing && progressIssuances.has(notice.hearing) && !isInvalidHeardSpeechNotice(world, eid, notice) ? notice.hearing : undefined;
}
