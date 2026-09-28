/** Operator diagnostics only. These events are never stimuli, memories or NPC context. */
export type PlanningDiscardReason =
  | "parse_failed" | "validation_failed" | "generation_failed" | "generation_error" | "cancelled"
  | "ai_disabled" | "actor_unavailable" | "goal_unavailable" | "goal_detached" | "goal_changed"
  | "room_changed" | "visible_state_changed" | "higher_priority_goal" | "plan_replaced"
  | "dialogue_changed" | "own_speech_changed" | "working_memory_changed" | "coordination_changed"
  | "first_step_unavailable";

type PlanningEventBase = { requestId: string; agentEid: number; goalEid: number; atMs: number };
export type PlanningEvent = PlanningEventBase & (
  | { stage: "requested" }
  | { stage: "validated"; stepCount: number }
  | { stage: "admitted"; planEid: number; stepCount: number }
  | { stage: "discarded"; reason: PlanningDiscardReason; issues?: string[] }
);

export type PlanGenerationOutcome =
  | { ok: true; stepCount: number }
  | { ok: false; reason: "parse_failed" | "validation_failed" | "generation_failed" | "generation_error"; issues?: string[] };
