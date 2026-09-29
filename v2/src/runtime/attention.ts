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
