/** Operator-only numeric metadata. Never copy provider bodies or arbitrary fields. */
export interface ForegroundProviderStats {
  outcome: "returned" | "timeout" | "cancelled" | "error";
  durationWallMs: number;
  finishReason?: string;
  inputTokens?: number; outputTokens?: number; reasoningTokens?: number;
  cachedInputTokens?: number; outputCharacters?: number;
}
const outcomes = new Set(["returned", "timeout", "cancelled", "error"]);
const finishes = new Set(["stop", "length", "content-filter", "tool-calls", "error", "other", "unknown"]);
const count = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
export function copyForegroundProviderStats(value: unknown): ForegroundProviderStats | undefined {
  const row = object(value);
  if (!outcomes.has(row.outcome as string) || !count(row.durationWallMs)) return;
  const result: ForegroundProviderStats = { outcome: row.outcome as ForegroundProviderStats["outcome"], durationWallMs: row.durationWallMs };
  if (row.outcome !== "returned") return result;
  if (typeof row.finishReason === "string" && finishes.has(row.finishReason)) result.finishReason = row.finishReason;
  for (const key of ["inputTokens", "outputTokens", "reasoningTokens", "cachedInputTokens", "outputCharacters"] as const)
    if (count(row[key])) result[key] = row[key];
  return result;
}
export function foregroundProviderStats(durationWallMs: number, outcome: ForegroundProviderStats["outcome"], response?: unknown): ForegroundProviderStats {
  const row = object(response), usage = object(row.usage);
  return copyForegroundProviderStats({ outcome, durationWallMs: Math.max(0, Math.round(durationWallMs)),
    finishReason: row.finishReason, outputCharacters: typeof row.text === "string" ? row.text.length : undefined,
    inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
    reasoningTokens: object(usage.outputTokenDetails).reasoningTokens,
    cachedInputTokens: object(usage.inputTokenDetails).cacheReadTokens })!;
}
