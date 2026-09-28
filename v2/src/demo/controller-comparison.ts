/** Read-only mechanical summary. Semantic judgment belongs in a separate review
 * of literal events, not keyword scoring of a desired plot. */
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const quantile = (values: number[], p: number) => values.length
  ? [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)] : null;
const directories = process.argv.slice(2);
if (!directories.length) throw new Error("Pass one or more trial artifact directories");
const summaries: unknown[] = [];
for (const path of directories) {
  const directory = resolve(path);
  const configuration = JSON.parse(await readFile(join(directory, "configuration.json"), "utf8"));
  const result = JSON.parse(await readFile(join(directory, "result.json"), "utf8"));
  const events = (await readFile(join(directory, "sitcom-events.jsonl"), "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  const dispositionCounts: Record<string, number> = {};
  for (const e of events) if (e.kind === "foreground_disposition") {
    const key = `${e.disposition.type}:${e.disposition.reason ?? e.disposition.mentalUpdate ?? ""}`;
    dispositionCounts[key] = (dispositionCounts[key] ?? 0) + 1;
  }
  const actors = [...new Set(events.map(e => e.actor).filter(Boolean))].map(actor => {
    const own = events.filter(e => e.actor === actor);
    const durations = own.filter(e => e.kind === "decision_latency" && Number.isFinite(e.durationWallMs)).map(e => e.durationWallMs);
    return { actor, foregroundTasks: durations.length, medianWallMs: quantile(durations, .5), p95WallMs: quantile(durations, .95),
      completedSpeech: own.filter(e => e.kind === "speech" && e.status === "succeeded").map(e => ({ atSimMs: e.atSimMs, text: e.text })),
      admittedMotorPlans: own.filter(e => e.disposition?.type === "motor_plan_admitted").length };
  });
  summaries.push({ directory, label: configuration.label, controller: configuration.controller ?? "priority",
    experienceReconsideration: configuration.experienceReconsideration ?? false,
    narrativeMind: configuration.narrativeMind ?? false,
    condition: configuration.condition, models: configuration.models, fingerprints: configuration.fingerprints,
    completedAtSimMs: result.atSimMs, failed: result.failed, chains: result.chains, actors, dispositionCounts,
    semanticAssessment: "Not automatically scored. Review transcript and personally perceived evidence." });
}
console.log(JSON.stringify(summaries, null, 2));
