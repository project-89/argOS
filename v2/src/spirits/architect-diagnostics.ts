/** Operator-only admission telemetry. Never a spirit observation or NPC stimulus. */
import type { World } from "../ecs/world";
import { readSimulationTime } from "../ecs/simulation-time";

export type ArchitectDiagnosticInput = {
  stage: "cycle" | "needs" | "design" | "reobserve";
  outcome: "started" | "completed" | "admitted" | "rejected" | "failed";
  reason?: "no_config" | "provider_or_parse" | "non_object" | "non_array" | "revision" | "duplicate" | "contract" | "submission" | "stale_observation";
  candidates?: number; admitted?: number; durationMs?: number;
  /** Native dependency IDs only; no private purpose or model response text. */
  dependency?: string;
  invalidatedReferences?: readonly string[];
  /** Rejected contract/dependency detail only; bounded and operator-visible. */
  detail?: string;
};
export type ArchitectDiagnostic = ArchitectDiagnosticInput & {
  sequence: number; cycleId: number; architectId: number; atSimMs: number; timestamp: number;
};
const ledgers = new WeakMap<World, { sequence: number; cycles: number; entries: ArchitectDiagnostic[] }>();
export function beginArchitectDiagnostics(world: World, architectId: number) {
  let ledger = ledgers.get(world);
  if (!ledger) { ledger = { sequence: 0, cycles: 0, entries: [] }; ledgers.set(world, ledger); }
  const state = ledger, cycleId = ++state.cycles;
  return (input: ArchitectDiagnosticInput) => {
    state.entries.push({ ...input, detail: input.detail?.slice(0, 600), dependency: input.dependency?.slice(0, 80),
      invalidatedReferences: input.invalidatedReferences?.slice(0, 8).map(ref => ref.slice(0, 100)), sequence: ++state.sequence, cycleId,
      architectId, atSimMs: readSimulationTime(world), timestamp: Date.now() });
    if (state.entries.length > 500) state.entries.splice(0, state.entries.length - 500);
  };
}
export function getArchitectDiagnostics(world: World) {
  const state = ledgers.get(world);
  return { latestSequence: state?.sequence ?? 0, truncated: (state?.sequence ?? 0) > 500,
    entries: state?.entries.map(entry => ({ ...entry,
      ...(entry.invalidatedReferences ? { invalidatedReferences: [...entry.invalidatedReferences] } : {}) })) ?? [] };
}
