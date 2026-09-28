/** Explicit opt-in: this command spends model credits, but never starts video or engineering. */
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { format } from "node:util";
import { COGNITION_SCENARIOS, runCognitionPuzzle, type CognitionScenario } from "./cognition-puzzle";
import { MODEL_IDS } from "../llm/config";

const args = process.argv.slice(2);
function value(name: string, fallback: string) { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; }
function integer(name: string, fallback: number, min: number, max: number) {
    const raw = Number(value(name, String(fallback)));
    if (!Number.isInteger(raw) || raw < min || raw > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
    return raw;
}
if (!args.includes("--live")) {
    process.stdout.write("No model calls made. Pass --live to run native cognition evaluations, or run Jest cognition-evaluation.test.ts for deterministic model-boundary replay.\n");
} else {
    const selected = value("--scenario", "all");
    if (selected !== "all" && !COGNITION_SCENARIOS.includes(selected as CognitionScenario)) throw new Error(`Unknown scenario: ${selected}`);
    const scenarios = selected === "all" ? [...COGNITION_SCENARIOS] : [selected as CognitionScenario];
    const trials = integer("--trials", 1, 1, 10);
    const maxTurns = integer("--max-turns", 20, 1, 100);
    const timeoutMs = integer("--timeout-ms", 90000, 1000, 600000);
    const backgroundPlanning = args.includes("--background-planning");
    const directory = path.resolve(value("--output", `stress-test-output/cognition-${new Date().toISOString().replace(/[:.]/g, "-")}`));
    await mkdir(directory, { recursive: true });
    const originalLog = console.log; const originalError = console.error;
    const logs: string[] = [];
    console.log = (...items: unknown[]) => { logs.push(format(...items)); };
    console.error = (...items: unknown[]) => { logs.push(format(...items)); };
    const runs: Awaited<ReturnType<typeof runCognitionPuzzle>>[] = [];
    try {
        for (const scenario of scenarios) for (let trial = 1; trial <= trials; trial++) {
            process.stdout.write(`${JSON.stringify({ kind: "cognition-eval-start", scenario, trial, maxTurns, timeoutMs, backgroundPlanning })}\n`);
            const run = await runCognitionPuzzle({ scenario, trial, maxTurns, timeoutMs, backgroundPlanning, onTrace: trace => {
                process.stdout.write(`${JSON.stringify({ kind: "cognition-turn", scenario, trial, turn: trace.turn, actions: trace.actions, state: trace.after,
                    planningMs: Math.round(trace.planningMs), cognitionMs: Math.round(trace.cognitionMs), planningPending: trace.planningPending })}\n`);
            } });
            runs.push(run);
            await writeFile(path.join(directory, `${scenario}-${trial}.json`), JSON.stringify(run, null, 2));
            process.stdout.write(`${JSON.stringify({ kind: "cognition-eval-result", scenario, trial, passed: run.passed, gates: run.gates, turns: run.turns, error: run.error })}\n`);
        }
    } finally {
        console.log = originalLog; console.error = originalError;
        const summary = { passed: runs.length === scenarios.length * trials && runs.every(r => r.passed), model: MODEL_IDS.flash, scenarios, trials, maxTurns, timeoutMs, backgroundPlanning,
            completedRuns: runs.length, expectedRuns: scenarios.length * trials, directory,
            results: runs.map(({ trace: _trace, events: _events, ...run }) => run),
            note: "Planning/cognition operation duration includes native deterministic paths; it is not an exact model-call count. Replay tests are infrastructure evidence, not evidence of live model quality." };
        await writeFile(path.join(directory, "summary.json"), JSON.stringify(summary, null, 2));
        await writeFile(path.join(directory, "runtime.log"), logs.join("\n"));
        process.stdout.write(`${JSON.stringify({ kind: "cognition-eval-summary", passed: summary.passed, completedRuns: runs.length, directory })}\n`);
        if (!summary.passed) process.exitCode = 1;
    }
}
