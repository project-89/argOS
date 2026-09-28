/**
 * Brain Stream — Multi-surface state broadcasting.
 *
 * Publishes BrainState snapshots to registered surfaces (CLI, Web, Voice,
 * SMS, Discord, etc.) via a simple pub/sub pattern.
 *
 * Each surface receives:
 *   - Current hypotheses (top N by confidence)
 *   - Active intentions
 *   - Emotional state
 *   - Nudge signals (should the surface prompt the user?)
 */

import type { PersonModel, Hypothesis, Intention } from "../ecs/types.js";

// =============================================================================
// TYPES
// =============================================================================

export interface BrainState {
  personId: string;
  timestamp: number;
  /** Top hypotheses by confidence */
  hypotheses: Array<{ domain: string; content: string; confidence: number }>;
  /** Active intentions */
  intentions: Array<{ id: string; claim: string; status: string }>;
  /** Current emotional state */
  emotionalState: string;
  /** Current topics */
  topics: string[];
  /** Whether the surface should nudge the user */
  nudge: NudgeSignal | null;
}

export interface NudgeSignal {
  type: "check_in" | "intention_ready" | "insight" | "reminder";
  message: string;
  priority: "low" | "medium" | "high";
}

export type SurfaceId = "cli" | "web" | "voice" | "sms" | "discord" | string;

export interface SurfaceAdapter {
  id: SurfaceId;
  /** Called when brain state updates */
  onBrainState: (state: BrainState) => void | Promise<void>;
  /** Called when a nudge should be delivered */
  onNudge: (nudge: NudgeSignal) => void | Promise<void>;
}

// =============================================================================
// STREAM MANAGEMENT
// =============================================================================

const surfaces = new Map<SurfaceId, SurfaceAdapter>();

export function registerSurface(adapter: SurfaceAdapter): void {
  surfaces.set(adapter.id, adapter);
}

export function unregisterSurface(id: SurfaceId): void {
  surfaces.delete(id);
}

/**
 * Broadcast current brain state to all registered surfaces.
 */
export async function broadcastBrainState(model: PersonModel): Promise<void> {
  const state = snapshotBrainState(model);

  const promises = Array.from(surfaces.values()).map(async surface => {
    try {
      await surface.onBrainState(state);
      if (state.nudge) {
        await surface.onNudge(state.nudge);
      }
    } catch {
      // Surface failures are non-fatal
    }
  });

  await Promise.all(promises);
}

/**
 * Create a BrainState snapshot from the current person model.
 */
export function snapshotBrainState(model: PersonModel): BrainState {
  const hypotheses = model.hypotheses
    .filter(h => h.confidence > 0.3)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 10)
    .map(h => ({ domain: h.domain, content: h.content, confidence: h.confidence }));

  const intentions = model.intentions
    .filter(i => i.status !== "completed" && i.status !== "abandoned")
    .map(i => ({ id: i.id, claim: i.claim, status: i.status }));

  // Determine nudge signal
  let nudge: NudgeSignal | null = null;
  const readyIntentions = model.intentions.filter(i => i.status === "forming");
  if (readyIntentions.length > 0) {
    nudge = {
      type: "intention_ready",
      message: `I have an idea: ${readyIntentions[0].claim}`,
      priority: "medium",
    };
  }

  return {
    personId: model.personId,
    timestamp: Date.now(),
    hypotheses,
    intentions,
    emotionalState: model.conversation.emotionalState,
    topics: model.conversation.currentTopics,
    nudge,
  };
}
