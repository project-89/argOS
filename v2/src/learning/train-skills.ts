/** Skill training: run several short, headless Saltmere sessions in sequence.
 * Every session is a fresh world (memories wiped) seeded from the skill
 * library; every resident is offstage (the cheap driver, scene summaries and
 * background planning run, not per-resident foreground minds); at the end of
 * each session what residents learned is harvested, abstracted and selected.
 *
 *   npx tsx src/learning/train-skills.ts --runs 2 --seconds 240 [--library path] [--scenario lovecraft] [--no-trial] --live
 *
 * Without --live it spends nothing: it prints what it would do and exits. */
import "dotenv/config";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_SKILL_LIBRARY_PATH, loadSkillLibrary, seedableEntries } from "./library";
import { SALTMERE_SCENARIO_ID } from "../demo/spatial-lovecraft-town";

export const TRAINING_LIMITS = Object.freeze({ maxRuns: 10, maxSeconds: 900, minSeconds: 10 });
export type TrainingArgs = { runs: number; seconds: number; library: string; scenario: "lovecraft"; live: boolean; trial: boolean };

export function parseTrainingArgs(argv: readonly string[]): TrainingArgs {
  const value = (flag: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  const runs = Number(value("--runs") ?? 1), seconds = Number(value("--seconds") ?? 240);
  if (!Number.isInteger(runs) || runs < 1 || runs > TRAINING_LIMITS.maxRuns) throw new Error(`--runs must be an integer from 1 to ${TRAINING_LIMITS.maxRuns}`);
  if (!Number.isInteger(seconds) || seconds < TRAINING_LIMITS.minSeconds || seconds > TRAINING_LIMITS.maxSeconds)
    throw new Error(`--seconds must be an integer from ${TRAINING_LIMITS.minSeconds} to ${TRAINING_LIMITS.maxSeconds}`);
  const scenario = (value("--scenario") ?? "lovecraft").toLowerCase();
  if (!["lovecraft", "saltmere", "coastal-mystery"].includes(scenario)) throw new Error("Only the Saltmere (--scenario lovecraft) town is trainable headlessly");
  const library = resolve(value("--library") ?? process.env.ARGOS_SKILL_LIBRARY?.trim() ?? DEFAULT_SKILL_LIBRARY_PATH);
  return { runs, seconds, library, scenario: "lovecraft", live: argv.includes("--live"), trial: !argv.includes("--no-trial") };
}

export function describeTrainingPlan(args: TrainingArgs): string {
  let size = "missing (will be created)", seedable = 0;
  try {
    const library = loadSkillLibrary(args.library);
    if (existsSync(args.library)) size = `${library.entries.length} entries after ${library.runIndex} runs`;
    seedable = seedableEntries(library, { scenarioId: SALTMERE_SCENARIO_ID, includeCandidates: args.trial }).length;
  } catch (error) { size = `unreadable (${error instanceof Error ? error.message : error})`; }
  return [
    `Skill training plan: ${args.runs} sequential Saltmere session(s) × ${args.seconds} s each (wall clock), all residents offstage.`,
    `Library: ${args.library} — ${size}; ${seedable} skill(s) would seed the first world${args.trial ? " (promoted + candidates on trial)" : " (promoted only)"}.`,
    "Each session: fresh world (no memories) → seed → live planning + offstage driver + scene summaries → harvest → select.",
    "Spirits, God autopilot and world evolution are off in training.",
  ].join("\n");
}

type Io = { out: (line: string) => void };

/** Returns the process exit code. Spends nothing without --live. */
export async function runTrainingCli(argv: readonly string[], io: Io = { out: line => process.stdout.write(line + "\n") }): Promise<number> {
  let args: TrainingArgs;
  try { args = parseTrainingArgs(argv); } catch (error) { io.out(`train-skills: ${error instanceof Error ? error.message : error}`); return 2; }
  io.out(describeTrainingPlan(args));
  if (!args.live) {
    io.out("Refusing to spend: no model calls were made. Add --live to run these sessions.");
    return 0;
  }
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) { io.out("train-skills: --live requires GOOGLE_GENERATIVE_AI_API_KEY"); return 2; }
  return runLiveTraining(args, io);
}

async function runLiveTraining(args: TrainingArgs, io: Io): Promise<number> {
  const { SpatialDemo } = await import("../demo/spatial-demo");
  const { setAttentionProvider } = await import("../runtime/attention");
  const { getOffstageStats } = await import("../runtime/offstage");
  const { getAgentProceduralSkills, getProcedureOutcomes } = await import("../cognition/procedural-skills");
  const { resetSkillRegistry } = await import("../cognition/skill-registry");
  const { resetGoalLearning } = await import("../cognition/goal-learning");
  const { resetCompilerState } = await import("../cognition/bt-compiler");
  const { resetLearningState } = await import("../cognition/policy-learning");
  const { query } = await import("bitecs");
  const { Agent, Mind } = await import("../ecs/components");

  // Resident chatter goes to a log file; the terminal gets the report.
  mkdirSync(resolve("recordings"), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logPath = resolve("recordings", `skill-training-${stamp}.log`);
  const log = createWriteStream(logPath, { flags: "a" });
  const original = { log: console.log, warn: console.warn, info: console.info, error: console.error };
  const toFile = (...parts: unknown[]) => { log.write(parts.map(p => typeof p === "string" ? p : (() => { try { return JSON.stringify(p); } catch { return String(p); } })()).join(" ") + "\n"); };
  console.log = toFile; console.info = toFile; console.warn = toFile; console.error = toFile;

  let modelCalls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (/googleapis\.com/.test(url)) modelCalls++;
    return realFetch(input, init);
  }) as typeof fetch;

  io.out(`Verbose session log: ${logPath}`);
  try {
    for (let i = 1; i <= args.runs; i++) {
      // A fresh process-wide learning state: nothing but the library carries over.
      resetSkillRegistry(); resetGoalLearning(); resetCompilerState(); resetLearningState();
      const run = `train-${stamp}-r${i}`, callsBefore = modelCalls, startedAt = Date.now();
      const demo = await SpatialDemo.create({ live: true, scenario: "town", story: "coastal-mystery", evolving: true, training: true,
        seconds: args.seconds, skillLibrary: { path: args.library, seed: true, harvest: true, run, seedCandidates: args.trial } });
      const stopped = new Promise<void>(done => demo.onStop(() => done()));
      await demo.start();
      // Training attention: nobody is watched, so everyone lives offstage.
      setAttentionProvider(demo.sim.world, () => ({ tier: "offstage" }));
      const guard = setTimeout(() => { try { demo.stop(); } catch { /* reported below */ } }, args.seconds * 1000 + 60_000);
      await stopped; clearTimeout(guard);
      await demo.sim.drainPendingOperations(20_000).catch(error => toFile("[Training] drain:", String(error)));
      const w = demo.sim.world;
      const seed = demo.sim.skillLibrary?.seedReport, harvest = demo.sim.skillLibrary?.harvestReport;
      const outcomes = getProcedureOutcomes(w);
      const libraryUse = outcomes.filter(o => o.signature.startsWith("lib:"));
      const sum = (rows: typeof outcomes, k: "started" | "completed" | "failed" | "abandoned") => rows.reduce((n, r) => n + r[k], 0);
      let planRecords = 0, goalMacros = 0;
      for (const eid of query(w, [Agent, Mind])) for (const { skill } of getAgentProceduralSkills(w, eid)) {
        if (skill.library) continue;
        if (skill.trigger.affordance === "__plan_macro__") planRecords++;
        else if (skill.trigger.affordance === "__goal_macro__") goalMacros++;
      }
      const stats = getOffstageStats(w);
      const o = stats?.outcomes;
      io.out(`\n── Run ${i}/${args.runs} (${run}) · ${Math.round((Date.now() - startedAt) / 1000)} s wall · model calls ≈ ${modelCalls - callsBefore}`);
      io.out(`  seeded: ${seed ? `${seed.entries} skills (${seed.promoted} promoted, ${seed.trial} trial) → ${seed.memories} procedural memories` : "none"}`);
      io.out(`  library skills used: started ${sum(libraryUse, "started")}, completed ${sum(libraryUse, "completed")}, failed ${sum(libraryUse, "failed")}, set aside ${sum(libraryUse, "abandoned")}`);
      io.out(`  learned this run: ${planRecords} executed-plan record(s), ${goalMacros} verified goal macro(s)`);
      if (o) io.out(`  offstage actions (started/succeeded/failed): learned ${o.learned.started}/${o.learned.succeeded}/${o.learned.failed} · plan ${o.plan.started}/${o.plan.succeeded}/${o.plan.failed} · schedule ${o.schedule.started}/${o.schedule.succeeded}/${o.schedule.failed} · idle ${o.idle.started}/${o.idle.succeeded}/${o.idle.failed} · scene ${o.scene.started}/${o.scene.succeeded}/${o.scene.failed}`);
      if (stats) io.out(`  scenes: ${stats.scenes} (${stats.sceneFailures} failed, ${stats.sceneRejected} rejected) · goals completed offstage: ${stats.goalsCompleted.length}`);
      if (harvest) {
        io.out(`  harvest: ${harvest.harvested} abstracted (${harvest.newEntries.length} new, ${harvest.updated} updated, ${harvest.generalized} generalized), ${harvest.seededUses} seeded in use, ${harvest.skipped.length} non-transferable`);
        for (const entry of harvest.newEntries.slice(0, 8)) io.out(`    + ${entry.name} [${entry.scope === "general" ? "general" : `scenario ${entry.scope.scenario}`}]`);
        for (const skip of harvest.skipped.slice(0, 6)) io.out(`    - skipped ${skip.resident ? `${skip.resident}: ` : ""}${skip.skill.slice(0, 70)} (${skip.reason})`);
        io.out(`  select: promoted ${harvest.promoted.length}${harvest.promoted.length ? ` (${harvest.promoted.map(p => p.name).join("; ").slice(0, 200)})` : ""}, retired ${harvest.retired.length}, pruned ${harvest.pruned + harvest.capped}`);
        io.out(`  library: ${harvest.size} entries (${harvest.statusCounts.promoted} promoted, ${harvest.statusCounts.candidate} candidates, ${harvest.statusCounts.retired} retired)`);
      } else io.out("  harvest: none (session ended without a harvest)");
    }
  } finally {
    globalThis.fetch = realFetch;
    Object.assign(console, original);
    await new Promise<void>(done => log.end(() => done()));
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runTrainingCli(process.argv.slice(2)).then(code => process.exit(code), error => { console.error(error); process.exit(1); });
}
