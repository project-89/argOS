/** Pure wire contract shared by prompt examples and evidence-wait admission.
 * Parsing is not grounding, observation, action execution or condition success. */
export type PlanWaitUntil =
  | { kind: "physical_fact"; subject: string; predicate: "state" | "location" | "possession";
      slot?: string; equals: string; timeoutMs?: number }
  | { kind: "heard_evidence"; speaker?: string; timeoutMs?: number };
export const PLAN_WAIT_TIMEOUT_LIMITS = Object.freeze({ defaultTimeoutMs: 15_000, minTimeoutMs: 1_000, maxTimeoutMs: 60_000 });
export const PLAN_WAIT_SCHEMA_ERRORS = Object.freeze({
  null_condition: "waitUntil cannot be null. Omit the field for an ordinary wait.",
  condition_type: "waitUntil must be one condition object, not a string, array or primitive.",
  condition_kind: "waitUntil.kind must be physical_fact or heard_evidence.",
  condition_timeout: "waitUntil.timeoutMs must be a finite number in the 1000–60000 millisecond timeout range, or omitted.",
  condition_fields: "waitUntil has additional fields or conjunctions. Copy only the condition object, not its surrounding catalog metadata.",
  condition_speaker: "waitUntil.speaker must be a nonempty string of at most 240 characters, or omitted.",
  condition_subject: "waitUntil.subject must be a nonempty string of at most 240 characters identifying the observed subject.",
  condition_predicate: "waitUntil.predicate must be state, location or possession.",
  condition_slot: "waitUntil.slot must be a nonempty string of at most 100 characters, or omitted.",
  condition_equals: "waitUntil.equals must be a nonempty string of at most 240 characters. Boolean state values use the strings \"true\" and \"false\".",
});
export type PlanWaitSchemaIssue = keyof typeof PLAN_WAIT_SCHEMA_ERRORS;
const text = (value: unknown, limit = 240): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= limit;

/** Never drop unsupported fields: doing so could weaken a requested condition. */
export function parsePlanWaitUntil(input: unknown): { condition: PlanWaitUntil } | { issueCode: PlanWaitSchemaIssue } {
  if (input === null) return { issueCode: "null_condition" };
  if (!input || typeof input !== "object" || Array.isArray(input)) return { issueCode: "condition_type" };
  const value = input as Record<string, unknown>;
  if (value.kind !== "heard_evidence" && value.kind !== "physical_fact") return { issueCode: "condition_kind" };
  if (value.timeoutMs !== undefined && (typeof value.timeoutMs !== "number" || !Number.isFinite(value.timeoutMs)
    || value.timeoutMs < PLAN_WAIT_TIMEOUT_LIMITS.minTimeoutMs || value.timeoutMs > PLAN_WAIT_TIMEOUT_LIMITS.maxTimeoutMs))
    return { issueCode: "condition_timeout" };
  const timeout = value.timeoutMs === undefined ? {} : { timeoutMs: value.timeoutMs as number };
  const allowed = value.kind === "heard_evidence" ? ["kind", "speaker", "timeoutMs"] : ["kind", "subject", "predicate", "slot", "equals", "timeoutMs"];
  if (Object.keys(value).some(key => !allowed.includes(key))) return { issueCode: "condition_fields" };
  if (value.kind === "heard_evidence") {
    if (value.speaker !== undefined && !text(value.speaker)) return { issueCode: "condition_speaker" };
    return { condition: { kind: value.kind, ...(value.speaker === undefined ? {} : { speaker: (value.speaker as string).trim() }), ...timeout } };
  }
  if (!text(value.subject)) return { issueCode: "condition_subject" };
  if (!["state", "location", "possession"].includes(value.predicate as string)) return { issueCode: "condition_predicate" };
  if (value.slot !== undefined && !text(value.slot, 100)) return { issueCode: "condition_slot" };
  if (!text(value.equals)) return { issueCode: "condition_equals" };
  return { condition: { kind: value.kind, subject: value.subject.trim(), predicate: value.predicate as "state" | "location" | "possession",
    ...(value.slot === undefined ? {} : { slot: (value.slot as string).trim() }), equals: value.equals.trim(), ...timeout } };
}
export function copyPlanWaitUntil(input: unknown): PlanWaitUntil | undefined {
  const result = parsePlanWaitUntil(input);
  return "condition" in result ? result.condition : undefined;
}
