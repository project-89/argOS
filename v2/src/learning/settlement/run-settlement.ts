/** Saltmere settlement: residents with needs and trades on bare land with
 * natural resources, a market, and a town to build. Several lives; each
 * trade's skill graph is kept between lives, memories are not. The clock is
 * event-driven: it moves only when everyone alive is busy or waiting, and
 * stands still while anyone is asking the model (thinking costs no sim time).
 *
 *   npx tsx src/learning/settlement/run-settlement.ts [--days 3] [--lives 2] [--live] [--graphs path.json]
 */
import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { Name } from "../../ecs/components";
import { SkillGraph, type SkillGraphJson } from "../skill-graph";
import type { Planner, PlannedStep } from "../skill-runtime";
import { geminiPlanner, type GeminiPlannerStats } from "../homestead/planners";
import { lackedItems, reportResourceGap, weaveForGap, type WeaverGenerator, type WeaverStats, type WovenPatch } from "../../spirits/recipe-weaver";
import { SALTMERE_LAND, type LandDef } from "./saltmere-land";
import { Settlement } from "./settlement";
import { ResidentLife } from "./settlement-life";
import { BalanceSpirits, type Intervention } from "./balance-spirits";

/** Offline stand-in for the model: reads the same manual, stall and layout a resident reads. */
export function settlementManualPlanner(town: () => Settlement, trade: string): Planner {
  return async ({ goal, have }) => {
    const t = town(), def = t.def;
    const rooms = [...t.rooms.values()];
    const find = (kind: string, portable?: boolean) => {
      for (const room of rooms) for (const eid of roomsThings(t, room)) {
        if (t.kindOf(eid) !== kind) continue;
        if (portable !== undefined && portable !== isPortable(t, eid)) continue;
        return { room, eid };
      }
      return undefined;
    };
    const [structureKind] = goal.item.split(".");
    const structure = def.structures.find(s => s.kind === structureKind);
    if (structure) {
      const plot = find(structure.plot);
      if (!plot) return [];
      return [{ verb: "move", target: Name.value[plot.room] }, ...structure.parts.map(p => ({ verb: "build", target: Name.value[plot.eid], arg: p.part }))];
    }
    const mine = def.trades.find(tr => tr.role === trade)?.duties.map(d => d.item) ?? [];
    const price = def.prices[goal.item];
    if (!mine.includes(goal.item) && price !== undefined && (have.coin ?? 0) >= price && (t.stallStock()[goal.item] ?? 0) > 0)
      return [{ verb: "move", target: "Saltmere Common" }, { verb: "buy", target: "Market stall", arg: goal.item }];
    const loose = find(goal.item, true);
    if (loose) return [{ verb: "move", target: Name.value[loose.room] }, { verb: "pickup", target: Name.value[loose.eid] }];
    const recipes = t.manualRecipes().filter(r => (r.gives[goal.item] ?? 0) > 0);
    for (const recipe of recipes) {
      const at = find(recipe.at);
      if (at) return [{ verb: "move", target: Name.value[at.room] }, { verb: recipe.verb, target: Name.value[at.eid], ...(recipe.product ? { arg: recipe.product } : {}) }] as PlannedStep[];
    }
    return [];
  };
}
const roomsThings = (t: Settlement, room: number) => t.thingsInPublic(room);
const isPortable = (t: Settlement, eid: number) => t.isPortable(eid);

const WATCH_S = 6 * 3600;

export type DayReport = { day: number; alive: number; plannerCalls: number; meals: number; made: Record<string, number>; sold: Record<string, number>;
  built: Record<string, number>; treasury: number };
export type LifeReport = { life: number; days: DayReport[]; alive: number; deaths: Array<{ name: string; cause: string; day: number }>;
  plannerCalls: number; plannerByTrade: Record<string, number>; built: Record<string, number>; gaps: string[]; grew: string[]; acts: number; failures: number;
  interventions: Intervention[]; trades: Record<string, string> };

export async function runSettlementLife(options: { land?: LandDef; days: number; life: number; graphs: Map<string, SkillGraph>;
  planner: "manual" | "gemini"; weaver?: "none" | "gemini" | { generate: WeaverGenerator }; grown?: WovenPatch[];
  gemini?: GeminiPlannerStats; weaverStats?: WeaverStats; log?: (line: string) => void; maxModelCalls?: number;
  /** The balance spirits watch each dawn (default on). */
  spirits?: boolean }): Promise<LifeReport> {
  const town = new Settlement(structuredClone(options.land ?? SALTMERE_LAND));
  for (const patch of options.grown ?? []) town.apply(patch);
  const gemini = options.gemini ?? { calls: 0, tokensIn: 0, tokensOut: 0, malformed: 0 };
  let planning = 0;
  let calls = 0;
  const cap = options.maxModelCalls ?? Infinity;
  const wrap = (planner: Planner): Planner => async request => {
    if (calls >= cap) return []; // budget spent: residents get by on what they know
    calls++; planning++;
    try { return await planner(request); } finally { planning--; }
  };
  const plannerFor = (trade: string) => wrap(options.planner === "gemini"
    ? geminiPlanner(gemini, { log: options.log, persona: `You plan practical steps for a ${trade} in a small coastal town that must feed and build itself. Be brief and exact.`,
      verbs: "buy <item> / sell <item> at the Market stall (target the stall, arg the item), " })
    : settlementManualPlanner(() => town, trade));
  const gaps: string[] = [], grew: string[] = [];
  const lives = town.residents.map(me => new ResidentLife(town, me, { graphs: options.graphs, planner: plannerFor, life: options.life, log: options.log,
    onGap: (_who, item, detail) => { if (!gaps.includes(item)) gaps.push(item); reportResourceGap(town.world, item, detail, "settlement"); } }));
  const weave = options.weaver && options.weaver !== "none" ? options.weaver : undefined;
  const spirits = options.spirits === false ? undefined : new BalanceSpirits(town, () => lives, { weave, weaverStats: options.weaverStats, grown: options.grown });
  const running = lives.map(l => l.live().catch(error => options.log?.(`${l.me.name} stopped: ${error instanceof Error ? error.stack : error}`)));
  const days: DayReport[] = [];
  const end = options.days * 86_400;
  let dayStart = { calls: 0, meals: 0, made: {} as Record<string, number>, sold: {} as Record<string, number>, built: {} as Record<string, number> };
  const snapshot = () => ({ calls: lives.reduce((n, l) => n + l.stats.plannerCalls, 0), meals: Object.values(town.tally.eaten).reduce((a, b) => a + b, 0) - (town.tally.eaten.water ?? 0),
    made: { ...town.tally.made }, sold: { ...town.tally.sold }, built: { ...town.tally.built } });
  const diff = (a: Record<string, number>, b: Record<string, number>) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v - (b[k] ?? 0)]).filter(([, v]) => (v as number) > 0));
  const flush = () => new Promise(r => setImmediate(r));
  let weaverBusy = false;
  while (town.now < end && town.alive().length) {
    for (let spins = 0; !town.allBlocked() && planning === 0 && !weaverBusy; spins++) {
      await flush();
      if (spins > 5000) throw new Error("A resident is not yielding to the clock");
    }
    if (planning > 0 || weaverBusy) { await new Promise(r => setTimeout(r, 5)); continue; }
    const next = Math.min(town.nextEventAt() ?? end, end);
    const dayBefore = Math.floor(town.now / 86_400), watchBefore = Math.floor(town.now / WATCH_S);
    town.advanceTo(next);
    // Daytime watches: the Steward can act before dawn if the town is eating badly.
    if (spirits && Math.floor(town.now / WATCH_S) > watchBefore && !town.isNight())
      for (const i of spirits.watch(Math.floor(town.now / 86_400) + 1)) options.log?.(`[${i.spirit}] day ${i.day}: ${i.what}`);
    const day = Math.floor(town.now / 86_400);
    if (day > dayBefore || town.now >= end) {
      const now = snapshot();
      days.push({ day: dayBefore + 1, alive: town.alive().length, plannerCalls: now.calls - dayStart.calls, meals: now.meals - dayStart.meals,
        made: diff(now.made, dayStart.made), sold: diff(now.sold, dayStart.sold), built: diff(now.built, dayStart.built), treasury: town.treasury });
      dayStart = now;
      if (spirits && town.now < end) {
        weaverBusy = true;
        for (const i of await spirits.dawn(dayBefore + 1)) options.log?.(`[${i.spirit}] day ${i.day}: ${i.what}`);
        weaverBusy = false;
      }
      // Each morning the Weaver reads the board and grows what the town keeps lacking.
      if (options.weaver && options.weaver !== "none") {
        weaverBusy = true;
        // Only what the world cannot make at all (twine waiting for a workbench is not a gap in the world).
        const unmakeable = (i: string) => !town.obtainableKinds().includes(i) && !town.def.structures.some(s => i === s.kind || i.startsWith(`${s.kind}.`));
        for (const item of lackedItems(town.world).filter(i => !grew.includes(i) && unmakeable(i))) {
          const woven = await weaveForGap(item, `Residents of Saltmere needed ${item} and nothing here gives it.`, town,
            { stats: options.weaverStats, ...(options.weaver === "gemini" ? {} : { generate: options.weaver.generate }) });
          if (woven.ok) { grew.push(item); options.grown?.push(woven.patch); for (const l of lives) l.solver.clearGap(item);
            options.log?.(`the world grew (${item}): ${woven.patch.reason}`); }
        }
        weaverBusy = false;
      }
    }
  }
  for (const e of town.events.filter(e => /collapsed/.test(e.what))) options.log?.(`${e.who} ${e.what} at ${(e.at / 3600).toFixed(1)}h`);
  for (const l of lives) l.stopped = true;
  // Let everyone finish their current await without advancing the world further.
  town.advanceTo(town.now); await flush();
  void running;
  const byTrade: Record<string, number> = {};
  for (const l of lives) byTrade[l.me.trade] = (byTrade[l.me.trade] ?? 0) + l.stats.plannerCalls;
  const report: LifeReport = { life: options.life, days, alive: town.alive().length,
    deaths: town.residents.filter(r => r.dead).map(r => ({ name: r.name, cause: r.causeOfDeath ?? "?", day: Math.floor((r.diedAt ?? 0) / 86_400) + 1 })),
    plannerCalls: lives.reduce((n, l) => n + l.stats.plannerCalls, 0), plannerByTrade: byTrade, built: { ...town.builtCount }, gaps, grew,
    acts: town.tally.acts, failures: town.tally.failures, interventions: spirits?.interventions ?? [],
    trades: Object.fromEntries(town.residents.map(r => [r.name, r.trade])) };
  town.stop();
  return report;
}

export function formatLife(r: LifeReport): string {
  const lines = [`Life ${r.life}: ${r.alive}/10 alive · model calls ${r.plannerCalls} (${Object.entries(r.plannerByTrade).map(([k, n]) => `${k} ${n}`).join(", ")}) · acts ${r.acts} (${r.failures} failed)`,
    `  built: ${Object.entries(r.built).map(([k, n]) => `${k} ×${n}`).join(", ") || "nothing"}${r.deaths.length ? ` · deaths: ${r.deaths.map(d => `${d.name} (${d.cause}, day ${d.day})`).join(", ")}` : ""}${r.gaps.length ? ` · lacked: ${r.gaps.join(", ")}` : ""}${r.grew.length ? ` · world grew: ${r.grew.join(", ")}` : ""}`];
  for (const i of r.interventions.filter(i => i.spirit !== "Watcher")) lines.push(`  [${i.spirit}, dawn ${i.day + 1}] ${i.what}`);
  for (const d of r.days) lines.push(`  day ${d.day}: alive ${d.alive}, model calls ${d.plannerCalls}, meals ${d.meals}, treasury ${d.treasury}; made ${Object.entries(d.made).map(([k, n]) => `${k} ${n}`).join(", ")}; built ${Object.entries(d.built).map(([k, n]) => `${k} ${n}`).join(", ") || "-"}`);
  return lines.join("\n");
}

async function main(argv: string[]) {
  const arg = (flag: string, fallback: string) => argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : fallback;
  const live = argv.includes("--live"), days = Number(arg("--days", "3")), livesN = Number(arg("--lives", "2"));
  const graphPath = argv.includes("--graphs") ? resolve(arg("--graphs", "")) : undefined;
  if (live && !process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) { console.log("--live needs GOOGLE_GENERATIVE_AI_API_KEY"); return 2; }
  const graphs = new Map<string, SkillGraph>();
  if (graphPath && existsSync(graphPath)) for (const [trade, json] of Object.entries(JSON.parse(readFileSync(graphPath, "utf8")) as Record<string, SkillGraphJson>)) graphs.set(trade, SkillGraph.fromJson(json));
  const verbose = argv.includes("--verbose"), original = console.log;
  console.log = (...a: unknown[]) => { if (verbose) original(...a); };
  const gemini: GeminiPlannerStats = { calls: 0, tokensIn: 0, tokensOut: 0, malformed: 0 };
  const weaverStats: WeaverStats = { designs: 0, applied: 0, rejected: [], tokensIn: 0, tokensOut: 0 };
  const grown: WovenPatch[] = [];
  const reports: LifeReport[] = [];
  for (let life = 1; life <= livesN; life++)
    reports.push(await runSettlementLife({ days, life, graphs, planner: live ? "gemini" : "manual", weaver: live ? "gemini" : "none", grown, gemini, weaverStats,
      maxModelCalls: live ? Number(arg("--max-calls", "120")) : undefined, spirits: !argv.includes("--no-spirits"),
      log: verbose ? line => original(line) : undefined }));
  console.log = original;
  console.log(`Saltmere settlement — ${days} days × ${livesN} lives — planner: ${live ? "Gemini (live)" : "manual stand-in (offline)"}\n`);
  for (const r of reports) console.log(formatLife(r) + "\n");
  if (live) console.log(`Gemini planner: ${gemini.calls} calls, ${gemini.tokensIn}/${gemini.tokensOut} tokens, ${gemini.malformed} malformed · Weaver: ${weaverStats.applied}/${weaverStats.designs} applied`);
  console.log(`Skills by trade: ${[...graphs.entries()].map(([k, g]) => `${k} ${g.skills.size}`).join(", ")}`);
  if (graphPath) writeFileSync(graphPath, JSON.stringify(Object.fromEntries([...graphs.entries()].map(([k, g]) => [k, g.toJson()])), null, 1) + "\n");
  return 0;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).then(code => process.exit(code));
