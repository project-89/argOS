/** Check-runner configuration only: no cognition or world-state authority. */
export function parseAfterRepairTail(args: readonly string[]): { tailMs: number; httpAttempts: number } {
  const matching = args.filter(arg => arg === "--after-repair-tail" || arg.startsWith("--after-repair-tail="));
  if (!matching.length) return { tailMs: 0, httpAttempts: 100 };
  if (matching.length !== 1) throw new Error("Specify --after-repair-tail only once");
  const raw = matching[0].slice("--after-repair-tail=".length);
  const seconds = Number(raw);
  if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(seconds) || seconds > 120)
    throw new Error("--after-repair-tail requires a positive whole number of seconds, at most 120");
  if (args.includes("--second-outage")) throw new Error("After-repair tail and second-outage checks cannot be combined");
  return { tailMs: seconds * 1000, httpAttempts: 160 };
}

/** A bound is not behavioral success. Only the observed stable repair starts
 * the tail, and the global runner deadline remains authoritative. */
export function afterRepairTailEvidence(tailMs: number, startedAtSimMs: number | undefined, atSimMs: number) {
  const elapsedMs = startedAtSimMs === undefined ? 0 : Math.max(0, atSimMs - startedAtSimMs);
  return { requestedMs: tailMs, startedAtSimMs: startedAtSimMs ?? null, elapsedMs,
    observedEntireTail: tailMs > 0 && startedAtSimMs !== undefined && elapsedMs >= tailMs,
    behavioralSuccess: "not automatically judged" as const };
}
