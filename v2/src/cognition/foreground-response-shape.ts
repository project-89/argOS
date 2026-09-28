/** Engine-owned field labels only. Never return rejected model values. */
export type ForegroundActionShapeField = "action" | "action.type" | "action.target" | "action.content"
  | "action.stopSpeaking" | "action.speechMode" | "action.listeningTo" | "action.waitUntil" | "innerThought";
export function foregroundActionShapeIssue(result: any, validTypes: readonly string[], listeningIds: readonly string[]): ForegroundActionShapeField | undefined {
  if (!result || typeof result !== "object" || Array.isArray(result) || !result.action
    || typeof result.action !== "object" || Array.isArray(result.action)) return "action";
  const a = result.action;
  if (typeof a.type !== "string" || !validTypes.includes(a.type)) return "action.type";
  if (a.target !== undefined && (typeof a.target !== "string" || a.target.length > 300)) return "action.target";
  if (a.content !== undefined && (typeof a.content !== "string" || a.content.length > 8000)) return "action.content";
  if (a.stopSpeaking !== undefined && typeof a.stopSpeaking !== "boolean") return "action.stopSpeaking";
  if (a.speechMode !== undefined && (a.type !== "speak" || !["turn", "interrupt"].includes(a.speechMode))) return "action.speechMode";
  if (a.listeningTo !== undefined && (a.type !== "wait" || typeof a.listeningTo !== "string" || !listeningIds.includes(a.listeningTo))) return "action.listeningTo";
  if (result.innerThought !== undefined && (typeof result.innerThought !== "string" || result.innerThought.length > 4000)) return "innerThought";
}

/** Bounded operator-only shape diagnostics. No model prose, object keys, IDs,
 * targets or message contents escape. This does not normalize or admit output. */
export function foregroundControlShape(result: any, field: string): string | undefined {
  if (!result || typeof result !== "object") return;
  const enums = ["retain", "defer", "release", "withdraw", "take", "cancel", "speak", "wait", "move", "pickup", "drop", "interact", "observe", "think"];
  const kind = (value: unknown) => value === null ? "null" : Array.isArray(value) ? `array(${Math.min(value.length, 99)})`
    : typeof value === "string" ? `string(${Math.min(value.length, 9999)})` : typeof value === "number" ? Number.isSafeInteger(value) ? "integer" : "number" : typeof value;
  const shape = (value: any): string => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return kind(value);
    const keys = ["goalId", "purpose", "id", "disposition", "reason", "afterSeconds", "wake", "type", "target", "content"];
    return `object(${keys.filter(k=>Object.hasOwn(value,k)).map(k=>`${k}:${["disposition","type"].includes(k) && enums.includes(value[k]) ? value[k] : kind(value[k])}`).join(",")};extra:${Object.keys(value).filter(k=>!keys.includes(k)).length})`;
  };
  const block = field.startsWith("goalReview") ? `goalReview=${shape(result.goalReview)}`
    : field === "control.nextPurpose" ? `nextPurpose=${shape(result.control?.nextPurpose)};nextPurposeReview=${shape(result.control?.nextPurposeReview)}`
    : field === "motorPlan" ? `motorPlan=${Array.isArray(result.motorPlan) ? result.motorPlan.slice(0,4).map(shape).join("|") : shape(result.motorPlan)}` : undefined;
  if (!block) return;
  return `${block};selectedGoal=${kind(result.control?.goalId)};action=${enums.includes(result.action?.type) ? result.action.type : kind(result.action?.type)}`.slice(0,1000);
}
