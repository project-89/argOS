import type { World } from "../ecs/world";
import { advanceSimulationTime, readSimulationTime } from "../ecs/simulation-time";
import { advanceTimedSpeech } from "../cognition/timed-speech";
import { advanceSimulationTimeline, isAdvancingSimulationTimeline } from "../runtime/simulation-timeline";

/** A package is a physical integrator, never a competing clock owner. Direct
 * fixtures and the full runner enter the same event timeline. */
export function advancePhysicalStep(world: World, deltaMs: number, integrate: (deltaMs: number) => void): void {
  if (isAdvancingSimulationTimeline(world)) integrate(deltaMs);
  else advanceSimulationTimeline(world, deltaMs, { integrate });
}

/** Direct offline fixture advances and runtime-owned ticks share one clock.
 * During a runtime tick the clock is already at this target; never double it.
 * Call after this package's physical mutations, so speech sees real locations. */
export function completePhysicalStep(world: World, targetSimMs: number): void {
  if (isAdvancingSimulationTimeline(world)) return;
  if (targetSimMs > readSimulationTime(world))
    advanceSimulationTime(world, world.time.tick + 1, targetSimMs - readSimulationTime(world));
  advanceTimedSpeech(world);
}
