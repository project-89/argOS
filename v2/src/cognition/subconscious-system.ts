/**
 * Slow, scheduled cognition. Callers own/await its lifetime; never detach it from
 * agentThink. Runtime gives each actor a single-flight task in the reserved
 * subconscious lane. Planning has its own higher-priority task in that lane.
 */
import { entityExists, hasComponent } from "bitecs";
import type { World } from "../ecs/world";
import { Agent, Mind } from "../ecs/components";
import { generateAutonomousGoal, shouldGenerateGoal } from "./autonomous-goals";
import { hasPendingImageReflection, maybeAddImageReflectionThought } from "./agent-mind";
import { hasPendingReflection, initializeReflectionState, maybeReflect } from "./reflection-system";
import { assertSimulationTaskActive } from "../runtime/task-scope";

export interface SubconsciousOptions { enableReflection?: boolean }
function eligible(world: World, eid: number): boolean {
  return world.meta.aiEnabled !== false && entityExists(world, eid) && hasComponent(world, eid, Agent) &&
    hasComponent(world, eid, Mind) && Agent.active[eid] &&
    Boolean(String(process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim());
}

export function hasSubconsciousWork(world: World, eid: number, options: SubconsciousOptions = {}): boolean {
  return eligible(world, eid) && (shouldGenerateGoal(world, eid) ||
    (options.enableReflection !== false && (hasPendingReflection(world, eid) || hasPendingImageReflection(world, eid))));
}

const inFlight = new WeakMap<World, Set<number>>();
export async function runAgentSubconscious(world: World, eid: number, options: SubconsciousOptions = {}): Promise<void> {
  if (!eligible(world, eid)) return;
  let pending = inFlight.get(world);
  if (!pending) { pending = new Set(); inFlight.set(world, pending); }
  if (pending.has(eid)) return;
  pending.add(eid);
  try {
    assertSimulationTaskActive();
    // Integrating accumulated experience should not be starved by repeatedly
    // filling the goal list. This remains background, single-flight work.
    if (world.meta.narrativeMind && options.enableReflection !== false) {
      initializeReflectionState(world, eid);
      if (hasPendingReflection(world, eid)) { await maybeReflect(world, eid); return; }
    }
    if (shouldGenerateGoal(world, eid)) {
      await generateAutonomousGoal(world, eid);
      return; // Yield the lane: a newly formed goal should be planned next.
    }
    if (options.enableReflection !== false && eligible(world, eid)) {
      initializeReflectionState(world, eid);
      if (hasPendingReflection(world, eid)) {
        await maybeReflect(world, eid);
        return; // One expensive faculty per task, not a 30-second chain.
      }
      await maybeAddImageReflectionThought(world, eid);
    }
  } finally { pending.delete(eid); }
}
