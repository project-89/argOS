import { evaluateForegroundAttempts, nearestRank, type ForegroundTimingEntry } from "../foreground-attempt-evaluation";
const entry = (type: string, requestId: string, more = {}): ForegroundTimingEntry => ({ type, observedWallMs: 100,
  data: { requestId, agent: "Ada", ...more } });
const attempt = (id: string, duration: number, outcome = "returned") => [
  entry("foreground_attempt_started", id, { preparationWallMs: 20 }),
  entry("foreground_provider_result", id, { provider: { outcome, durationWallMs: Math.max(0, duration - 20) } }),
  entry("foreground_attempt_finished", id, { durationWallMs: duration }),
];
test("nearest rank includes slow failed/cancelled attempts and does not use rolling success samples", () => {
  expect(nearestRank([3, 1, 2], .5)).toBe(2); expect(nearestRank([])).toBeNull();
  const events = [...attempt("timeout", 8000, "timeout"), ...attempt("cancel", 7500, "cancelled"),
    ...Array.from({ length: 20 }, (_, i) => attempt(`ok${i}`, 1000)).flat()];
  const result = evaluateForegroundAttempts(events, 9000);
  expect(result.complete).toBe(true); expect(result.p95WallMs).toBe(7500);
  expect(result.latencyWithinFiveSeconds).toBe(false); expect(result.count).toBe(22);
});
test("unfinished requests are censored, not dropped or counted fast", () => {
  const result = evaluateForegroundAttempts([...attempt("ok", 500), entry("foreground_attempt_started", "pending", { preparationWallMs: 20 })], 10_000);
  expect(result.pending).toBe(1); expect(result.complete).toBe(false); expect(result.latencyWithinFiveSeconds).toBe(false);
  expect(result.attempts[1].censoredLowerBoundMs).toBe(9920);
});
test("duplicates, missing provider reports, unmatched and malformed records fail closed", () => {
  for (const events of [[...attempt("a", 1), ...attempt("a", 1)], [attempt("a", 1)[0], attempt("a", 1)[2]],
    [attempt("a", 1)[2]], [entry("foreground_attempt_started", "a", { preparationWallMs: NaN })]])
    expect(evaluateForegroundAttempts(events, 1000).latencyWithinFiveSeconds).toBe(false);
});
test("non-model cheap decisions cannot dilute latency and an empty run is not a pass", () => {
  const events = [...attempt("slow", 7000), ...Array.from({ length: 200 }, () => entry("policy_decision", "fast", { durationWallMs: 0 }))];
  expect(evaluateForegroundAttempts(events, 9000).p95WallMs).toBe(7000);
  expect(evaluateForegroundAttempts([], 9000).latencyWithinFiveSeconds).toBe(false);
});
