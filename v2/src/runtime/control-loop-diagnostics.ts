/** Opt-in, process-local operator evidence. Never ECS state, prompt context or
 * an execution capability. Disabling/dropping diagnostics cannot affect control. */
import type { World } from "../ecs/world";
import { readSimulationTime } from "../ecs/simulation-time";
import { getCommittedEvents } from "./committed-events";

type Input = { lane: "foreground" | "reflection"; actorId: number; requestId?: string;
  stage: string; detail: Record<string, unknown> };
type Entry = Input & { sequence: number; atSimMs: number; sourceId: string | null };
const CAPACITY = 512;
const ledgers = new WeakMap<World, { sequence: number; dropped: number; entries: Entry[] }>();
export function enableControlLoopDiagnostics(world: World) {
  if (!ledgers.has(world)) ledgers.set(world, { sequence: 0, dropped: 0, entries: [] });
}
export function recordControlLoopDiagnostic(world: World, input: () => Input) {
  const ledger = ledgers.get(world); if (!ledger) return;
  try {
    // Only module-authored projections belong here; never raw prompts/provider
    // output or exception bodies. Snapshot before mutable admission consumes it.
    const value = input(), encoded = JSON.stringify(value);
    if (Buffer.byteLength(encoded) > 16_000) { ledger.dropped++; return; }
    ledger.entries.push({ ...JSON.parse(encoded), sequence: ++ledger.sequence,
      atSimMs: readSimulationTime(world), sourceId: getCommittedEvents(world).sourceId });
    if (ledger.entries.length > CAPACITY) { ledger.entries.shift(); ledger.dropped++; }
  } catch { ledger.dropped++; /* Observation must not throw into admission. */ }
}
export function getControlLoopDiagnostics(world: World) {
  const ledger = ledgers.get(world);
  return { enabled: !!ledger, latestSequence: ledger?.sequence ?? 0, dropped: ledger?.dropped ?? 0,
    entries: structuredClone(ledger?.entries ?? []) };
}

/** Bounded whitelist, including field presence for invalid/omitted controls.
 * No action content (messages), raw thought, credential or arbitrary extra key. */
export function foregroundChoiceDiagnostic(result: any) {
  const text = (v: unknown) => typeof v === "string" ? v.slice(0, 400) : undefined;
  const id = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : undefined;
  const c = result?.control;
  return { actionType: text(result?.action?.type), purpose: text(c?.purpose), goalId: id(c?.goalId),
    version: id(c?.version), nextPurposePresent: c?.nextPurpose !== undefined,
    nextPurpose: c?.nextPurpose ? { goalId: id(c.nextPurpose.goalId), purpose: text(c.nextPurpose.purpose) } : undefined,
    nextPurposeReviewPresent: c?.nextPurposeReview !== undefined,
    nextPurposeReview: c?.nextPurposeReview ? { id: text(c.nextPurposeReview.id), disposition: text(c.nextPurposeReview.disposition),
      reason: text(c.nextPurposeReview.reason) } : undefined };
}
