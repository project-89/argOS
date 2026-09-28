/** One modality boundary for queued input, sensory descriptions and dialogue recall. */
import { entityExists, hasComponent } from "bitecs";
import type { World } from "../ecs/world";
import { Traits } from "../ecs/components";

export type SensoryModality = "visual" | "auditory" | "olfactory" | "tactile" | "cognitive";
export interface SensoryCapabilities {
  visual: number; auditory: number; olfactory: number; tactile: number; cognitive: number;
}
export interface SensoryEvent {
  type: string; content: string; source: string;
  modality?: SensoryModality; intensity?: number; timestamp?: number;
}

export function getAgentSensoryCapabilities(world: World, eid: number): SensoryCapabilities {
  const caps: SensoryCapabilities = { visual: 1, auditory: 1, olfactory: 0.5, tactile: 1, cognitive: 0.5 };
  if (!entityExists(world, eid)) return { visual: 0, auditory: 0, olfactory: 0, tactile: 0, cognitive: 0 };
  let traits: string[] = [];
  try {
    const raw = hasComponent(world, eid, Traits) ? JSON.parse(Traits.active[eid] || "[]") : [];
    if (Array.isArray(raw)) traits = raw.filter((t): t is string => typeof t === "string").map(t => t.trim().toLowerCase());
  } catch { /* A malformed trait list grants no special capability. */ }
  if (traits.includes("keen_sight")) caps.visual = 1.5;
  if (traits.includes("keen_hearing")) caps.auditory = 1.5;
  if (traits.includes("intuitive")) caps.cognitive = 1;
  if (traits.includes("psychic")) caps.cognitive = 1.5;
  // A disabled channel stays disabled; enhanced hearing is not a cure for deafness.
  if (traits.includes("blind")) caps.visual = 0;
  if (traits.includes("deaf")) caps.auditory = 0;
  return caps;
}

export function inferStimulusModality(type: string): SensoryModality {
  switch (type) {
    case "speech": case "directed_speech": case "sound": case "noise": return "auditory";
    case "smell": case "odor": return "olfactory";
    case "touch": case "pain": case "temperature": return "tactile";
    // Explicit mental input and executor feedback do not require eyes or ears.
    case "cognitive": case "thought": case "injected_thought": case "message": case "tool_result":
    case "attention": case "daemon_whisper": case "daemon_challenge":
    case "intuition": case "memory": case "affordances": case "danger":
    case "action_result": case "action_failed": return "cognitive";
    default: return "visual";
  }
}

/** Preserve the emitter's source, intensity and time. Requeueing is not a new event. */
export function normalizeSensoryEvent<T extends SensoryEvent>(event: T): T & { modality: SensoryModality; intensity: number } {
  const modality = event.modality ?? inferStimulusModality(event.type);
  const fallback = modality === "auditory" ? 0.9 : modality === "olfactory" ? 0.7 : 0.8;
  return inheritStimulusGuard(event, { ...event, modality, intensity: Number.isFinite(event.intensity) ? Math.max(0, event.intensity!) : fallback });
}

/** Filter once before memory, attention or cognition admission. Scaling is presentation-only. */
export function filterPerceivableStimuli<T extends SensoryEvent>(world: World, eid: number, events: readonly T[]): Array<T & { modality: SensoryModality; intensity: number }> {
  const capabilities = getAgentSensoryCapabilities(world, eid);
  return events.map(normalizeSensoryEvent).filter(event => capabilities[event.modality] > 0 && event.intensity > 0);
}
import { inheritStimulusGuard } from "./stimulus-guard";
