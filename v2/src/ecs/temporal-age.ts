/** Aging is lived time; a wall/source timestamp is never rewritten as elapsed
 * simulation time. Marks are ECS data, so pause/save/reload retain their age. */
import { addComponent, entityExists, hasComponent } from "bitecs";
import type { World } from "./world";
import { Goal, SimulationAge } from "./components";
import { readSimulationTime } from "./simulation-time";

type Mark = { sourceAt: number; simAt: number; episode?: string };
function marks(world: World, eid: number): Record<string, Mark> {
  if (!entityExists(world, eid) || !hasComponent(world, eid, SimulationAge)) return {};
  try {
    const value = JSON.parse(SimulationAge.marksJson[eid] || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

/** Explicit writes only. Matching the source timestamp prevents stale metadata
 * from becoming the age of a replacement episode or a direct external edit. */
export function stampSimulationTime(world: World, eid: number, key: string, sourceAt: number, simAt = readSimulationTime(world), episode?: string): void {
  if (!entityExists(world, eid) || !Number.isFinite(sourceAt) || !Number.isFinite(simAt)) return;
  const current = marks(world, eid);
  if (!hasComponent(world, eid, SimulationAge)) addComponent(world, eid, SimulationAge);
  current[key] = { sourceAt, simAt, ...(episode === undefined ? {} : { episode }) };
  SimulationAge.marksJson[eid] = JSON.stringify(current);
}

/** Old data cannot recover historical acceleration. Preserve its age at the
 * save baseline, then advance only with this world's elapsed time. A legacy
 * save's offline interval therefore does not age cognition or expire goals. */
export function legacySimulationTimestamp(world: World, sourceAt: number): number {
  const baseline = world.meta.temporalBaseline;
  const wallAt = baseline?.wallAtMs ?? world.meta.createdAt;
  const simAt = baseline?.simAtMs ?? 0;
  return simAt + (sourceAt - wallAt);
}

export function getStampedSimulationTime(world: World, eid: number, key: string, sourceAt: number, episode?: string): number | undefined {
  const mark = marks(world, eid)[key];
  return mark && mark.sourceAt === sourceAt && Number.isFinite(mark.simAt) && (episode === undefined || mark.episode === episode)
    ? mark.simAt : undefined;
}

export function readStampedSimulationTime(world: World, eid: number, key: string, sourceAt: number): number {
  return getStampedSimulationTime(world, eid, key, sourceAt) ?? legacySimulationTimestamp(world, sourceAt);
}

/** Read-only: context/retrieval must not manufacture new temporal evidence. */
export function simulationAge(world: World, eid: number, key: string, sourceAt: number): number {
  return Math.max(0, readSimulationTime(world) - readStampedSimulationTime(world, eid, key, sourceAt));
}

export function simulationDeadlinePassed(world: World, eid: number, key: string, deadline: number): boolean {
  return deadline > 0 && readSimulationTime(world) >= readStampedSimulationTime(world, eid, key, deadline);
}

/** New authored/generated goals retain their original wall-domain fields. */
export function stampGoalTiming(world: World, goal: number, simAt = readSimulationTime(world)): void {
  const birth = Goal.createdAt[goal];
  if (!Number.isFinite(birth) || birth <= 0) return;
  stampSimulationTime(world, goal, "Goal.createdAt", birth, simAt);
  const deadline = Goal.deadline[goal];
  if (Number.isFinite(deadline) && deadline > 0) stampSimulationTime(world, goal, "Goal.deadline", deadline, simAt + (deadline - birth));
}
