import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

// Wall/CPU budgets must use the same Node/tsx execution environment as the
// server, not Jest's VM globals. The original in-VM failed measurement remains
// evidence; this wrapper does not relax any threshold or warm the child cache.
test("ten moving town residents retain a 10Hz clock through real foreground projections and a geometry edit", async () => {
  const harness = fileURLToPath(new URL("./spatial-town-performance.harness.ts", import.meta.url));
  const result = await new Promise<{ error: Error | null; stdout: string; stderr: string }>(resolve => {
    execFile(process.execPath, ["--import", "tsx", harness], {
      timeout: 25_000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => resolve({ error, stdout, stderr }));
  });
  // Keep failures/measurements visible, without printing model prompts. The
  // child blocks fetch before importing the engine and never launches an LLM.
  if (result.stdout.trim()) console.log(result.stdout.trim());
  if (result.stderr.trim()) console.error(result.stderr.trim());
  expect(result.error).toBeNull();
  const line = result.stdout.split("\n").find(row => row.startsWith("TOWN_PERFORMANCE "));
  expect(line).toBeDefined();
  const stats = JSON.parse(line!.slice("TOWN_PERFORMANCE ".length));
  expect(stats).toMatchObject({ actors: 10, ticks: 80, simulatedMs: 8000, geometryEdited: true,
    deadlineReached: false, sourceUnchanged: true, fetchAttempts: 0 });
  expect(stats.realtimeFactor).toBeGreaterThanOrEqual(.85);
  expect(stats.tickGapP95Ms).toBeLessThanOrEqual(160);
  expect(stats.tickGapMaxMs).toBeLessThanOrEqual(1000);
  expect(stats.projectionP95Ms).toBeLessThanOrEqual(60);
  expect(stats.projectionMaxMs).toBeLessThanOrEqual(700);
  expect(stats.tickCpuP95Ms).toBeLessThanOrEqual(80);
  expect(stats.tickCpuMaxMs).toBeLessThanOrEqual(900);
}, 30_000);
