/** Where the observer's attention is, per resident. A host (the spatial demo)
 * registers a provider from the controlled body or camera; engine services use
 * it to spend scarce thinking and voice budget on what the observer perceives.
 * It changes priority and fidelity only, never what is true or permitted.
 *
 * - presence:  within earshot and in view of the observer — full real-time life.
 * - periphery: in the world near enough to matter, not in the observer's scene.
 * - offstage:  out of sight (another building, far away).
 * Without a provider every resident is "presence" (unchanged behaviour). */
import type { World } from "../ecs/world";
import { readSimulationTime } from "../ecs/simulation-time";
import type { TaskPriority } from "./async-task-queue";

export type AttentionTier = "presence" | "periphery" | "offstage";
export type AttentionReading = { tier: AttentionTier; distance?: number; addressedByObserver?: boolean };
type Provider = (eid: number) => AttentionReading;

const providers = new WeakMap<World, Provider>();

export function setAttentionProvider(world: World, provider: Provider | undefined): void {
  if (provider) providers.set(world, provider); else providers.delete(world);
}

export function readAttention(world: World, eid: number): AttentionReading {
  const provider = providers.get(world);
  if (!provider) return { tier: "presence" };
  try { return provider(eid); } catch { return { tier: "presence" }; }
}

/** Lower sorts first. Direct address by the observer outranks everything. */
export function attentionRank(world: World, eid: number): number {
  const reading = readAttention(world, eid);
  if (reading.addressedByObserver) return 0;
  const base = reading.tier === "presence" ? 1 : reading.tier === "periphery" ? 2 : 3;
  return base + Math.min(0.99, (reading.distance ?? 0) / 1000);
}

export function hasAttentionProvider(world: World): boolean { return providers.has(world); }


/** Foreground priority: the resident the observer just addressed, then whoever
 * shares the observer's scene, then the periphery, then offstage. */
export function foregroundPriorityFor(world: World, eid: number): TaskPriority {
  const reading = readAttention(world, eid);
  if (reading.addressedByObserver) return "critical";
  return reading.tier === "presence" ? "high" : reading.tier === "periphery" ? "normal" : "low";
}

/** Minimum simulated gap between foreground decisions by tier. Something that
 * demands attention (heard speech, a due signal) shortens the offstage gap. */
export const ATTENTION_CADENCE_MS = { presence: 0, periphery: 6_000, offstage: 20_000, offstageUrgent: 6_000 } as const;
export function attentionCadenceOpen(world: World, eid: number, lastDecisionSimMs: Map<number, number>, urgent: boolean): boolean {
  const tier = readAttention(world, eid).tier;
  if (tier === "presence") return true;
  const last = lastDecisionSimMs.get(eid);
  if (last === undefined) return true;
  const gap = tier === "periphery" ? (urgent ? 0 : ATTENTION_CADENCE_MS.periphery)
    : urgent ? ATTENTION_CADENCE_MS.offstageUrgent : ATTENTION_CADENCE_MS.offstage;
  return readSimulationTime(world) - last >= gap;
}

/** Background minds (appraisal, planning, reflection) keep their own priority in
 * the observer's scene and yield one step per tier of distance beyond it. */
export function backgroundPriorityFor(world: World, eid: number, base: TaskPriority): TaskPriority {
  const tier = readAttention(world, eid).tier;
  const order: TaskPriority[] = ["critical", "high", "normal", "low"];
  const step = tier === "presence" ? 0 : tier === "periphery" ? 1 : 2;
  return order[Math.min(order.length - 1, order.indexOf(base) + step)];
}

/** Autopilot gate. A host running residents on habit (a skill graph doing their
 * work) can hold their minds back until something salient happens: the
 * foreground decision runs only when the gate allows, and background lanes
 * (appraisal, planning, review, reflection) only while the mind is or was
 * recently awake. Without a gate everything is allowed (unchanged behaviour).
 * A resident spoken to directly is always allowed to answer. */
export type MindGate = { foreground(eid: number): boolean; background(eid: number): boolean;
  /** A foreground decision is starting for this resident (a gate may budget turns). */
  foregroundTurn?(eid: number): void;
  /** Least simulated ms between this resident's fast steps (observe, reconcile, select); undefined = every tick.
   * A habit-driven resident whose mind is not awake need not observe ten times a second: stimuli still arrive every tick. */
  fastCadenceMs?(eid: number): number | undefined };
const gates = new WeakMap<World, MindGate>();
export function setMindGate(world: World, gate: MindGate | undefined): void {
  if (gate) gates.set(world, gate); else gates.delete(world);
}
export function foregroundAllowed(world: World, eid: number): boolean {
  const gate = gates.get(world);
  if (!gate || readAttention(world, eid).addressedByObserver) return true;
  try { return gate.foreground(eid); } catch { return true; }
}
const lastFastStep = new WeakMap<World, Map<number, number>>();
/** Is this resident's fast step due (the gate's cadence, in simulation time)? Records the step when it is. */
export function fastStepDue(world: World, eid: number): boolean {
  let cadence: number | undefined;
  try { cadence = gates.get(world)?.fastCadenceMs?.(eid); } catch { cadence = undefined; }
  if (!cadence || !(cadence > 0)) return true;
  let last = lastFastStep.get(world); if (!last) lastFastStep.set(world, last = new Map());
  const now = readSimulationTime(world), previous = last.get(eid);
  if (previous !== undefined && now >= previous && now - previous < cadence) return false;
  last.set(eid, now);
  return true;
}
/** Tell the gate a foreground decision has begun (the runtime calls this as it dispatches one). */
export function noteForegroundTurn(world: World, eid: number): void {
  try { gates.get(world)?.foregroundTurn?.(eid); } catch { /* A host's bookkeeping never blocks a decision. */ }
}
export function backgroundAllowed(world: World, eid: number): boolean {
  const gate = gates.get(world);
  if (!gate) return true;
  try { return gate.background(eid); } catch { return true; }
}
