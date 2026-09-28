import { copyForegroundProviderStats, foregroundProviderStats } from "../provider-telemetry";

test("provider projection omits unknown counts and all raw content", () => {
  const stats = foregroundProviderStats(12.4, "returned", { text: "PRIVATE", finishReason: "stop",
    usage: { inputTokens: 0, outputTokens: -1, totalTokens: 99, outputTokenDetails: { reasoningTokens: NaN } },
    request: "SECRET", providerMetadata: { secret: "NEVER" } });
  expect(stats).toEqual({ outcome: "returned", durationWallMs: 12, inputTokens: 0, outputCharacters: 7, finishReason: "stop" });
  expect(copyForegroundProviderStats({ ...stats, text: "PRIVATE", finishReason: "PRIVATE_FINISH_REASON" }))
    .toEqual({ outcome: "returned", durationWallMs: 12, inputTokens: 0, outputCharacters: 7 });
});
test.each(["timeout", "cancelled", "error"] as const)("%s cannot report invented successful usage", outcome => {
  expect(copyForegroundProviderStats({ outcome, durationWallMs: 8000, inputTokens: 40, outputTokens: 2, error: "PRIVATE" }))
    .toEqual({ outcome, durationWallMs: 8000 });
});
test("malformed operator metadata fails closed", () => {
  for (const input of [null, [], { outcome: "PRIVATE", durationWallMs: 1 }, { outcome: "returned", durationWallMs: -1 }])
    expect(copyForegroundProviderStats(input)).toBeUndefined();
});
