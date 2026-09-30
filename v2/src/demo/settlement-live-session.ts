/** Watch a live Saltmere Settlement session headless (no viewer):
 *   npx tsx src/demo/settlement-live-session.ts [minutes=40] [skills.json]
 * Spends model calls: Gemini minds (only when attention wakes them), Jev, the Gemini planner for gaps.
 * A live Saltmere Settlement session, headless: Gemini minds (woken by attention), Jev (appraisal, choices),
 * Gemini planner for gaps, trained trade skills. Writes a running log and a summary. */
import "dotenv/config";
import { appendFileSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { SpatialDemo } from "./spatial-demo";
import { runSettlementLife } from "../learning/settlement/run-settlement";
import { SkillGraph } from "../learning/skill-graph";
import { JevClient } from "../llm/jev";
import { HabitBook } from "../cognition/habit-book";
import { geminiPlanner } from "../learning/homestead/planners";
import { Goal, Name, Needs } from "../ecs/components";
import { HasGoal } from "../ecs/relations";
import { getRelationTargets, hasComponent } from "bitecs";
import { snapshotAffect } from "../cognition/affect-state";
import { getDecisionStats } from "../cognition/decision-leaves";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
const MINUTES = Number(process.argv[2] ?? 40), DIR = resolve("recordings", `settlement-live-${new Date().toISOString().replace(/[:.]/g, "-")}`);
mkdirSync(DIR, { recursive: true });
const LOG = `${DIR}/session.log`, SKILLS = process.argv[3] ? resolve(process.argv[3]) : resolve("recordings", "settlement-skills.json");
writeFileSync(LOG, "");
const out = (line: string) => appendFileSync(LOG, line + "\n");
const quiet = console.log; console.log = () => {}; console.warn = () => {}; console.error = () => {};
const graphs = new Map<string, SkillGraph>();
if (existsSync(SKILLS)) for (const [t, j] of Object.entries(JSON.parse(readFileSync(SKILLS, "utf8")))) graphs.set(t, SkillGraph.fromJson(j as any));
else { await runSettlementLife({ days: 3, life: 1, graphs, planner: "manual" }); }
const HABITS = SKILLS.replace(/(\.json)?$/, ".habits.json");
const habits = existsSync(HABITS) ? HabitBook.fromJson(JSON.parse(readFileSync(HABITS, "utf8"))) : new HabitBook();
const jev = JevClient.fromEnv(); if (!jev) { quiet("no TYPESAFE key"); process.exit(1); }
const plannerStats = { calls: 0, tokensIn: 0, tokensOut: 0, malformed: 0 };
// Every Gemini request (minds, decision leaves, planner, Weaver) passes through global fetch: count them all.
const gemini = { calls: 0, failures: 0, tokensIn: 0, tokensOut: 0, thinking: 0 };
const realFetch = globalThis.fetch;
const ATTRIBUTE = process.env.ARGOS_ATTRIBUTE_LLM === "1";
const byCaller = new Map<string, { calls: number; tokensIn: number }>();
const callerOf = (stack: string, body: unknown) => {
  const frames = stack.split("\n").map(l => /src\/((?!llm\/)[\w\-/]+\.ts):(\d+)/.exec(l)).filter(Boolean).map(m => `${m![1]}:${m![2]}`)
    .filter(f => !f.startsWith("demo/settlement-live-session"));
  let head = "";
  try { const j = JSON.parse(String(body)); head = String(j?.systemInstruction?.parts?.[0]?.text ?? j?.contents?.[0]?.parts?.[0]?.text ?? "").replace(/\s+/g, " ").slice(0, 70); } catch { /* not JSON */ }
  return `${frames.slice(0, 2).join(" < ") || "?"} | ${head}`;
};
globalThis.fetch = (async (input: any, init?: any) => {
  const stack = ATTRIBUTE ? new Error().stack ?? "" : "";
  const response = await realFetch(input, init);
  if (!String(input?.url ?? input).includes("generativelanguage.googleapis.com")) return response;
  gemini.calls++; if (!response.ok) gemini.failures++;
  // Who asked: the nearest caller in our source (outside the LLM plumbing) and how its instructions open.
  const key = ATTRIBUTE ? callerOf(stack, init?.body) : "";
  void response.clone().json().then((j: any) => { const u = j?.usageMetadata ?? {};
    gemini.tokensIn += u.promptTokenCount ?? 0; gemini.tokensOut += u.candidatesTokenCount ?? 0; gemini.thinking += u.thoughtsTokenCount ?? 0;
    if (ATTRIBUTE) { const b = byCaller.get(key) ?? { calls: 0, tokensIn: 0 }; b.calls++; b.tokensIn += u.promptTokenCount ?? 0; byCaller.set(key, b); } }).catch(() => undefined);
  return response;
}) as typeof fetch;
const d = await SpatialDemo.create({ scenario: "town", story: "settlement", evolving: true, live: true, seconds: MINUTES * 60 + 120,
  settlementWork: { graphs, jev, habits, log: (l: string) => { if (/chooses|plan for|learned|intention|habit|pressed|takes up|gap:/.test(l)) out(`${stamp()} ${l}`); },
    planner: (trade: string) => geminiPlanner(plannerStats, { persona: `You plan practical steps for a ${trade} in a small coastal town rebuilding after the sea took it. Be brief and exact.`,
      verbs: "buy <item> / sell <item> at the Market stall (target the stall, arg the item), " }) } } as any);
const stamp = () => `[${(d.atSimMs / 60000).toFixed(1)}m ${d.settlementHour().toFixed(1)}h]`;
let loggedId = 0, seenAuto = 0, seenSpirit = 0;
// Timed speech grows word by word in its row: log a row once its text has held still for a flush (or at the end).
const lastText = new Map<number, string>();
const flush = (final = false) => {
  let settled = true;
  for (const e of d.snapshot().events) {
    if (e.id <= loggedId) continue;
    settled &&= final || lastText.get(e.id) === e.text;
    if (!settled) { lastText.set(e.id, e.text); continue; }
    loggedId = e.id; lastText.delete(e.id);
    if (/speech|thought|world|scene/.test(e.kind)) out(`${stamp()} ${e.kind}: ${e.text.slice(0, 600)}`);
  }
  const auto = d.autopilot?.log ?? []; for (const l of auto.slice(seenAuto)) out(`${stamp()} attention ${l.who}: ${l.what.slice(0, 300)}`); seenAuto = auto.length;
  const sp = d.settlementBalance?.interventions() ?? []; for (const i of sp.slice(seenSpirit)) out(`${stamp()} SPIRIT ${i.spirit}: ${i.what}`); seenSpirit = sp.length;
};
await d.start();
const started = Date.now();
quiet(`live settlement running for ${MINUTES} min; log ${LOG}`);
while (Date.now() - started < MINUTES * 60_000) {
  await new Promise(r => setTimeout(r, 15_000));
  try { flush(); } catch (e) { out(`flush error ${e}`); }
}
flush(true);
const w = d.sim.world;
const summary: string[] = [`== ${MINUTES} min live, game ${d.settlementHour().toFixed(1)}h ==`];
for (const a of d.actors) {
  const goals = getRelationTargets(w, a, HasGoal).filter(g => hasComponent(w, g, Goal) && Goal.status[g] === "active").map(g => `${Goal.description[g]} (${Goal.priority[g]})`);
  const f = snapshotAffect(w, a);
  summary.push(`${Name.value[a]} (${d.tradeLives.find(l => l.eid === a)?.trade}): hunger ${Math.round(Needs.hunger[a])}, coin ${d.recipes!.coinsOf(a)}, feels ${f ? `${f.feeling} (${f.valence.toFixed(2)}/${f.arousal.toFixed(2)})` : "-"}\n   goals: ${goals.join(" | ") || "-"}`);
}
summary.push(`built ${JSON.stringify(d.recipes!.builtCount())}; made ${JSON.stringify(d.recipes!.tally.made)}; eaten ${JSON.stringify(d.recipes!.tally.eaten)}`);
summary.push(`Jev ${JSON.stringify(jev.stats)}; planner ${JSON.stringify(plannerStats)}; leaves ${JSON.stringify(getDecisionStats(w))}`);
summary.push(`Gemini, all uses ${JSON.stringify(gemini)}`);
const passing = (d.autopilot?.log ?? []).filter(l => l.what.startsWith("answers in passing"));
summary.push(`habits ${habits.count()} written (${JSON.stringify(habits.stats)}); answered in passing ${passing.length} (${passing.filter(l => /by habit/.test(l.what)).length} by habit); God triage ${JSON.stringify(d.godTriage)}`);
if (ATTRIBUTE) summary.push("Gemini by caller:\n" + [...byCaller].sort((a, b) => b[1].tokensIn - a[1].tokensIn).slice(0, 25)
  .map(([k, v]) => `  ${v.calls} calls, ${(v.tokensIn / 1e6).toFixed(2)}M in — ${k}`).join("\n"));
summary.push(`skills ${[...graphs].map(([t, g]) => `${t} ${g.skills.size}`).join(", ")}`);
writeFileSync(SKILLS, JSON.stringify(Object.fromEntries([...graphs].map(([t, g]) => [t, g.toJson()])), null, 1));
writeFileSync(HABITS, JSON.stringify(habits.toJson(), null, 1));
out(summary.join("\n")); quiet(summary.join("\n"));
d.stop(); process.exit(0);
