/** Explicit opt-in live cognition trial. This never starts H3 or coding agents. */
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { format } from "node:util";
import { MODEL_IDS } from "../llm/config";
import { runSustainedCognitionEvaluation } from "./sustained-cognition";

const args = process.argv.slice(2);
function value(name: string, fallback: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}
function integer(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(value(name, String(fallback)));
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return parsed;
}

if (!args.includes("--live")) {
  process.stdout.write("No model calls made. Pass --live to run the sustained native cognition evaluation. H3, God, spirits and coding daemons remain off.\n");
} else {
  const maxTurns = integer("--max-turns", 45, 12, 80);
  const timeoutMs = integer("--timeout-ms", 180000, 1000, 600000);
  const directory = path.resolve(value("--output", `stress-test-output/sustained-cognition-${new Date().toISOString().replace(/[:.]/g, "-")}`));
  await mkdir(directory, { recursive: true });
  const logs: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...items: unknown[]) => { logs.push(format(...items)); };
  console.error = (...items: unknown[]) => { logs.push(format(...items)); };
  let run: Awaited<ReturnType<typeof runSustainedCognitionEvaluation>> | undefined;
  try {
    process.stdout.write(`${JSON.stringify({ kind: "sustained-cognition-start", model: MODEL_IDS.flash, maxTurns, timeoutMs })}\n`);
    run = await runSustainedCognitionEvaluation({ maxTurns, timeoutMs, onTrace: turn => {
      process.stdout.write(`${JSON.stringify({ kind: "sustained-cognition-turn", turn: turn.turn, phase: turn.phase, actions: turn.actions, state: turn.after,
        procedure: turn.procedure, planningMs: Math.round(turn.planningMs), cognitionMs: Math.round(turn.cognitionMs) })}\n`);
    } });
    await writeFile(path.join(directory, "result.json"), JSON.stringify(run, null, 2));
    process.stdout.write(`${JSON.stringify({ kind: "sustained-cognition-result", passed: run.passed, gates: run.gates, turns: run.turns, error: run.error, directory })}\n`);
    if (!run.passed) process.exitCode = 1;
  } finally {
    console.log = originalLog;
    console.error = originalError;
    await writeFile(path.join(directory, "runtime.log"), logs.join("\n"));
    if (!run) process.exitCode = 1;
  }
}
