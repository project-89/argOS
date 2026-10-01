import "dotenv/config";
import { randomBytes } from "node:crypto";
import * as nodeFs from "node:fs";
const require_fs = () => nodeFs;
import * as townModule from "./demo/settlement-town";
const require_town = () => townModule;
import { appendFile, mkdir, mkdtemp } from "node:fs/promises";
import { getRunningTaskNames } from "./runtime/async-task-queue";
import { resolve } from "node:path";
import { SpatialDemo } from "./demo/spatial-demo";
import { createSpatialDemoApp } from "./demo/spatial-server";

const live = process.argv.includes("--live");
const development = process.argv.includes("--develop");
const lovecraft = process.argv.includes("--lovecraft");
// Saltmere Settlement: bare land, tents and trades (optionally a trained skill file: --settlement graphs.json).
const settlementFlag = process.argv.indexOf("--settlement"), settlement = settlementFlag >= 0;
const settlementGraphs = settlement && process.argv[settlementFlag + 1] && !process.argv[settlementFlag + 1].startsWith("--") ? process.argv[settlementFlag + 1] : undefined;
const town = process.argv.includes("--town") || lovecraft || development || settlement;
const householdChallenge = process.argv.includes("--household-challenge");
const household = process.argv.includes("--household") || householdChallenge;
const evolving = process.argv.includes("--evolving") || lovecraft || development || settlement;
const story = process.argv.includes("--story") || lovecraft || settlement;
const weatherMechanic = process.argv.includes("--weather-mechanic");
if (development && weatherMechanic) throw Error("Choose broader --develop or the --weather-mechanic canary, not both");
if (weatherMechanic && (!(town || householdChallenge) || !evolving)) throw Error("--weather-mechanic requires --town or --household-challenge with --evolving");
if (story && (!(town || household) || !evolving)) throw Error("--story requires --town or --household, with --evolving");
if (evolving && !(town || household)) throw Error("--evolving requires --town or --household; other spatial worlds retain their existing authority");
if (town && household || (town || household) && (process.argv.includes("--blackout") || process.argv.includes("--extended-blackout"))) throw Error("Choose one town, household or Blackout scenario");
if (live && !process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) throw new Error("Live NPC cognition requires GOOGLE_GENERATIVE_AI_API_KEY. Omit --live for manual physics testing.");
// Cross-session skill library (src/learning): off unless --skills [path] or
// ARGOS_SKILL_LIBRARY is given. Seeds residents with promoted skills at start
// and harvests what they learned at stop; memories never carry over.
const skillsFlag = process.argv.indexOf("--skills");
const skillsArg = skillsFlag >= 0 && process.argv[skillsFlag + 1] && !process.argv[skillsFlag + 1].startsWith("--") ? process.argv[skillsFlag + 1] : undefined;
const skillLibraryPath = skillsFlag >= 0 ? skillsArg ?? process.env.ARGOS_SKILL_LIBRARY?.trim() ?? "" : process.env.ARGOS_SKILL_LIBRARY?.trim() || undefined;
/** Trade skill graphs (e.g. from `npm run settlement -- --graphs <path>`); with --live, Gemini fills gaps. */
let settlementSkills: Map<string, import("./learning/skill-graph").SkillGraph> | undefined;
let settlementHabits: import("./cognition/habit-book").HabitBook | undefined;
/** --fresh-town starts the settlement over (tents and bare plots); otherwise the town carries on from its last session. */
const freshTown = process.argv.includes("--fresh-town");
/** Habits live beside the skills file (residents' routines, by name). */
const habitsPath = (skills: string) => skills.replace(/(\.json)?$/, ".habits.json");
async function settlementWork() {
  const { existsSync, readFileSync } = await import("node:fs");
  const { SkillGraph } = await import("./learning/skill-graph");
  const graphs = settlementSkills = new Map<string, InstanceType<typeof SkillGraph>>();
  if (settlementGraphs && existsSync(settlementGraphs))
    for (const [trade, json] of Object.entries(JSON.parse(readFileSync(settlementGraphs, "utf8")))) graphs.set(trade, SkillGraph.fromJson(json as any));
  console.log(`[Settlement] ${graphs.size ? `trade skills from ${settlementGraphs}: ${[...graphs].map(([t, g]) => `${t} ${g.skills.size}`).join(", ")}` : "no trained skills; residents learn as they go"}`);
  const { HabitBook } = await import("./cognition/habit-book");
  const habits = settlementHabits = settlementGraphs && existsSync(habitsPath(settlementGraphs))
    ? HabitBook.fromJson(JSON.parse(readFileSync(habitsPath(settlementGraphs), "utf8"))) : new HabitBook();
  if (habits.count()) console.log(`[Settlement] ${habits.count()} habits carried over`);
  const { readSettlementTown, townPathFor } = townModule;
  const town = !freshTown && settlementGraphs ? readSettlementTown(townPathFor(settlementGraphs)) : undefined;
  console.log(`[Settlement] ${town ? `the town carries on: day ${town.days + 1}, built ${JSON.stringify(town.builtCount)}` : "a fresh town: tents and bare plots"}`);
  if (!live) return { graphs, habits, ...(town ? { town } : {}) };
  const { geminiPlanner } = await import("./learning/homestead/planners");
  const stats = { calls: 0, tokensIn: 0, tokensOut: 0, malformed: 0 };
  return { graphs, habits, ...(town ? { town } : {}), planner: (trade: string) => geminiPlanner(stats, { persona: `You plan practical steps for a ${trade} in a small coastal town that must feed and build itself. Be brief and exact.`,
    verbs: "buy <item> / sell <item> at the Market stall (target the stall, arg the item), " }) };
}
const token = randomBytes(24).toString("hex"), port = Number(process.env.ARGOS_SPATIAL_PORT ?? 0);
if (!Number.isSafeInteger(port) || port < 0 || port > 65535 || port > 0 && port < 1024) throw new Error("Invalid local port");
await mkdir(resolve("recordings"), { recursive: true });
const directory = await mkdtemp(resolve("recordings", "spatial-"));
const demo = await SpatialDemo.create({ live, evolving, seconds: Number(process.env.ARGOS_SPATIAL_SECONDS ?? (development ? 1800 : 600)),
  ...(development ? { development: { directory: resolve(directory, "development-builds") } } : {}),
  ...(householdChallenge ? { householdChallenge: true } : {}),
  ...(weatherMechanic ? { weatherMechanic: { directory: process.env.ARGOS_WEATHER_RELEASE_DIRECTORY?.trim() || resolve(directory, "weather-build") } } : {}),
  ...(story ? { story: settlement ? "settlement" as const : lovecraft ? "coastal-mystery" as const : household ? "household" as const : "community-drama" as const } : {}),
  ...(settlement ? { settlementWork: await settlementWork() } : {}),
  ...(town ? { scenario: "town" as const } : {}),
  ...(household ? { scenario: "household" as const } : {}),
  ...(process.argv.includes("--blackout") || process.argv.includes("--extended-blackout") ? { scenario: "blackout" as const } : {}),
  ...(process.argv.includes("--extended-blackout") ? { layout: "extended" as const } : {}),
  ...(skillLibraryPath !== undefined ? { skillLibrary: { path: skillLibraryPath || undefined, seed: true, harvest: true } } : {}) });
const receiver = await createSpatialDemoApp({ demo, token, directory });
// What residents learned in this walkable session (gaps Gemini filled) goes back to the skills file.
if (settlementSkills) {
  const target = settlementGraphs ?? resolve(directory, "settlement-skills.json");
  demo.onStop(() => {
    try {
      const { writeFileSync } = require_fs();
      writeFileSync(target, JSON.stringify(Object.fromEntries([...settlementSkills!].map(([trade, g]) => [trade, g.toJson()])), null, 1) + "\n");
      console.log(`[Settlement] trade skills saved to ${target}: ${[...settlementSkills!].map(([t, g]) => `${t} ${g.skills.size}`).join(", ")}`);
      if (settlementHabits) { writeFileSync(habitsPath(target), JSON.stringify(settlementHabits.toJson(), null, 1) + "\n"); console.log(`[Settlement] ${settlementHabits.count()} habits saved`); }
      const town = demo.settlementTown();
      if (town) { const { writeSettlementTown, townPathFor } = require_town(); writeSettlementTown(townPathFor(target), town); console.log(`[Settlement] the town is saved (day ${town.days})`); }
    } catch (error) { console.warn(`[Settlement] could not save trade skills: ${error instanceof Error ? error.message : error}`); }
  });
}
// Stall log: if the server thread is ever blocked long enough to freeze the
// viewer, the session's recording folder says when, for how long, and what ran.
{
  let last = performance.now();
  setInterval(() => {
    const now = performance.now(), lag = now - last - 250; last = now;
    if (lag < 750) return;
    const row = { at: new Date().toISOString(), lagMs: Math.round(lag), simMs: demo.snapshot().atSimMs, running: getRunningTaskNames() };
    console.warn(`[Stall] server thread blocked ${row.lagMs} ms (running: ${row.running.join(", ") || "none"})`);
    void appendFile(resolve(directory, "stalls.jsonl"), JSON.stringify(row) + "\n").catch(() => {});
  }, 250).unref();
}
const server = receiver.app.listen(port, "127.0.0.1", () => {
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing local address");
  console.log(`SPATIAL_DEMO_READY http://127.0.0.1:${address.port}/#${token}`);
  console.log(`SPATIAL_MODE ${live ? "Live native Argos cognition, starts only after Start" : development
    ? "Manual NPCs; operator God requests and coding jobs use AI when requested"
    : weatherMechanic
    ? "Manual ECS physics with one approved coding-model build; no autonomous NPC decisions"
    : "Manual ECS physics, no AI calls or scripted autonomous behavior"}`);
  console.log(`SPATIAL_RECORDINGS ${directory}`);
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  void receiver.stop().finally(() => server.close());
  setTimeout(() => process.exit(0), 5000).unref();
});
