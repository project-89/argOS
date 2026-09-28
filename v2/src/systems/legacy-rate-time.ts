/** Compatibility for historical discrete laws whose constants were per-run.
 * Each module declares its authored physical step duration. Accumulating lived
 * time preserves fractional credit and the old nonlinear/threshold equation;
 * polling frequency and wall latency no longer change the amount of physics. */
import { addComponent, addEntity, query } from "bitecs";
import type { World } from "../ecs/world";
import type { SystemContext } from "./system-loader";
import { LegacySystemTime } from "../ecs/components";
import { hasSimulationClock, readSimulationTime, validateSimulationDelta } from "../ecs/simulation-time";

type Cadence = { periodMs: number; creditMs: number; sequence: number; lastSimMs: number };
const MAX_STEPS = 10_000;

export function integrateLegacyRateSteps(world: World, ctx: SystemContext, key: string, periodMs: number,
  law: (world: World, ctx: SystemContext) => void): void {
  validateSimulationDelta(ctx.delta);
  if (!Number.isFinite(periodMs) || periodMs <= 0) throw new RangeError("Legacy physical step must have a positive duration");
  let eid = Array.from(query(world, [LegacySystemTime]))[0];
  let states: Record<string, Cadence> = {};
  if (eid !== undefined) {
    try { states = JSON.parse(LegacySystemTime.stateJson[eid] || "{}"); } catch { /* malformed metadata starts with no accumulated credit */ }
  }
  if (!states || typeof states !== "object" || Array.isArray(states)) states = {};
  const now = readSimulationTime(world), old = states[key];
  const valid = old && old.periodMs === periodMs && Number.isFinite(old.creditMs) && old.creditMs >= 0
    && Number.isSafeInteger(old.sequence) && old.sequence >= 0 && Number.isFinite(old.lastSimMs) && old.lastSimMs <= now;
  const delta = hasSimulationClock(world) && valid ? now - old.lastSimMs : ctx.delta;
  const credit = (valid ? old.creditMs : 0) + delta;
  const steps = Math.floor((credit + 1e-7) / periodMs);
  if (steps > MAX_STEPS) throw new RangeError("Historical physical law needs smaller simulation steps (over 10,000 substeps)");
  if (delta === 0 && !steps) return;
  if (eid === undefined) { eid = addEntity(world); addComponent(world, eid, LegacySystemTime); }
  const state: Cadence = { periodMs, creditMs: credit, sequence: valid ? old.sequence : 0, lastSimMs: now };
  states[key] = state;
  // Commit credit before invoking a law. If it fails, monitoring sees failure;
  // already-run substeps cannot be replayed as if they never happened.
  for (let i = 0; i < steps; i++) {
    state.creditMs = Math.max(0, state.creditMs - periodMs); state.sequence++;
    LegacySystemTime.stateJson[eid] = JSON.stringify(states);
    law(world, { ...ctx, delta: periodMs, tick: state.sequence, elapsed: state.sequence * periodMs });
  }
  LegacySystemTime.stateJson[eid] = JSON.stringify(states);
}
