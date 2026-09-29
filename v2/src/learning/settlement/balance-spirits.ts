/** The spirits keep the settlement in balance. Each dawn:
 *
 * - The Watcher reads yesterday: how well people ate, which goods ran out or
 *   piled up, how long the limited sources will last, the treasury's runway,
 *   and who stood idle. What is wrong goes on the observation board.
 * - The Lawgiver moves prices: a good people could not buy costs a little
 *   more (so it pays to make it), a good nobody bought while sellers were
 *   turned away costs a little less. It trims or restores the daily share by
 *   the treasury's runway.
 * - The Steward moves hands: when the town ate badly or a good kept running
 *   out, one idle resident takes up the trade that is short (and learns it).
 * - The Weaver is told when a source is running down, and may grow another.
 *
 * All of it is deterministic and bounded (one move a day, prices within
 * [1, 3× their first value]); every intervention is recorded with its reason. */
import type { WovenPatch, WeaverGenerator, WeaverStats } from "../../spirits/recipe-weaver";
import { reportGapObservation } from "../../spirits/observation-aggregator";
import { reportResourceGap, weaveForGap } from "../../spirits/recipe-weaver";
import type { World } from "../../ecs/world";
import type { SettlementTally } from "./settlement";
import type { LandDef, Stock } from "./saltmere-land";

/** What the spirits read and adjust. The headless Settlement meets it; the
 * walkable settlement has an adapter (demo/spatial-balance.ts). Times in
 * game seconds. */
export interface BalanceResident { eid: number; trade: string; hunger: number; coins: number; idleS: number; dead?: boolean }
export interface BalanceTown {
  world: World; def: LandDef; tally: SettlementTally; treasury: number; now: number; builtCount: Stock;
  residents: readonly BalanceResident[]; alive(): BalanceResident[];
  sourceReserves(): Record<string, { left: number; gives: string[] }>;
  equip(eid: number, trade: string): string[];
}
/** A town the Weaver can also grow (both settlements are). */
export type GrowableBalanceTown = BalanceTown & import("../../spirits/recipe-weaver").RecipeWorld;
export interface BalanceLife { me: { eid: number; trade: string; dead?: boolean; name?: string }; changeTrade(trade: string): void }

export type Reading = { day: number; alive: number; foodIndex: number; stockouts: Stock; gluts: Stock; bought: Stock;
  /** What each trade's work failed for want of. */
  lacking?: Record<string, Stock>;
  reserveDays: Record<string, number>; treasury: number; treasuryRunwayDays: number; idleByTrade: Record<string, number> };
export type Intervention = { day: number; spirit: "Watcher" | "Lawgiver" | "Steward" | "Weaver"; what: string };

const FOOD_TRADES: Record<string, string> = { "raw-fish": "fisher", "cooked-fish": "cook", berries: "forager" };
const AWAKE_S = 16 * 3600;
const SELF_GATHERED = new Set(["water", "berries"]);

export class BalanceSpirits {
  readonly interventions: Intervention[] = [];
  private readonly movedAt = new Map<number, number>();
  readonly readings: Reading[] = [];
  private readonly basePrices: Stock;
  private last: { at: number; tally: SettlementTally; treasury: number; idle: Map<number, number>; reserves: Record<string, number> };
  constructor(private readonly town: GrowableBalanceTown, private readonly lives: () => BalanceLife[],
    private readonly options: { weave?: "gemini" | { generate: WeaverGenerator }; weaverStats?: WeaverStats; grown?: WovenPatch[] } = {}) {
    this.basePrices = { ...town.def.prices };
    this.last = this.snapshot();
  }
  private snapshot() {
    return { at: this.town.now, tally: structuredClone(this.town.tally), treasury: this.town.treasury,
      idle: new Map(this.town.residents.map(r => [r.eid, r.idleS])),
      reserves: Object.fromEntries(Object.entries(this.town.sourceReserves()).map(([k, v]) => [k, v.left])) };
  }
  private note(day: number, spirit: Intervention["spirit"], what: string) { this.interventions.push({ day, spirit, what }); }

  /** Yesterday, as the Watcher sees it. */
  read(day: number): Reading {
    const t = this.town, prev = this.last.tally, diff = (a: Stock, b: Stock) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v - (b[k] ?? 0)]).filter(([, v]) => (v as number) > 0)) as Stock;
    const eaten = diff(t.tally.eaten, prev.eaten);
    const hungerMet = Object.entries(eaten).reduce((n, [k, c]) => n + c * (t.def.foods.find(f => f.kind === k)?.hunger ?? 0), 0);
    const n = t.def.needs, sleepH = 24 - AWAKE_S / 3600;
    const need = t.alive().length * n.hungerPerHour * (AWAKE_S / 3600 + sleepH * t.def.night.asleepNeedFactor);
    const spent = diff(t.tally.spent, prev.spent), reserves = t.sourceReserves();
    const reserveDays = Object.fromEntries(Object.entries(reserves).filter(([k]) => (spent[k] ?? 0) > 0).map(([k, v]) => [k, +(v.left / spent[k]).toFixed(1)]));
    const idleByTrade: Record<string, number> = {}, counts: Record<string, number> = {};
    for (const r of t.alive()) {
      idleByTrade[r.trade] = (idleByTrade[r.trade] ?? 0) + (r.idleS - (this.last.idle.get(r.eid) ?? 0)) / AWAKE_S;
      counts[r.trade] = (counts[r.trade] ?? 0) + 1;
    }
    for (const k of Object.keys(idleByTrade)) idleByTrade[k] = +Math.min(1, idleByTrade[k] / counts[k]).toFixed(2);
    const drop = this.last.treasury - t.treasury;
    const reading: Reading = { day, alive: t.alive().length, foodIndex: +this.fed(need ? hungerMet / need : 1).toFixed(2),
      stockouts: diff(t.tally.stockouts, prev.stockouts), gluts: diff(t.tally.gluts, prev.gluts), bought: diff(t.tally.bought, prev.bought),
      lacking: Object.fromEntries(Object.entries(t.tally.lacking).map(([trade, k]) => [trade, diff(k, prev.lacking?.[trade] ?? {})])),
      reserveDays, treasury: t.treasury, treasuryRunwayDays: drop > 0 ? +(t.treasury / drop).toFixed(1) : Infinity, idleByTrade };
    this.readings.push(reading);
    return reading;
  }

  private lastWatch?: { eaten: Stock; stockouts: Stock; lacking: Record<string, Stock>; idle: Map<number, number>; at: number };
  /** A daytime watch (every few hours): if the town is eating badly now, the
   * Steward need not wait for dawn. */
  watch(day: number): Intervention[] {
    const t = this.town, before = this.interventions.length;
    const last = this.lastWatch ?? { eaten: this.last.tally.eaten, stockouts: this.last.tally.stockouts, lacking: this.last.tally.lacking, idle: this.last.idle, at: this.last.at };
    const hours = (t.now - last.at) / 3600;
    this.lastWatch = { eaten: { ...t.tally.eaten }, stockouts: { ...t.tally.stockouts }, lacking: structuredClone(t.tally.lacking), idle: new Map(t.residents.map(r => [r.eid, r.idleS])), at: t.now };
    if (hours < 3) return [];
    const diff = (a: Stock, b: Stock) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v - (b[k] ?? 0)]).filter(([, v]) => (v as number) > 0)) as Stock;
    const eaten = diff(t.tally.eaten, last.eaten);
    const met = Object.entries(eaten).reduce((n, [k, c]) => n + c * (t.def.foods.find(f => f.kind === k)?.hunger ?? 0), 0);
    const need = t.alive().length * t.def.needs.hungerPerHour * hours;
    const idleByTrade: Record<string, number> = {}, counts: Record<string, number> = {};
    for (const r of t.alive()) { idleByTrade[r.trade] = (idleByTrade[r.trade] ?? 0) + (r.idleS - (last.idle.get(r.eid) ?? 0)) / (hours * 3600); counts[r.trade] = (counts[r.trade] ?? 0) + 1; }
    for (const k of Object.keys(idleByTrade)) idleByTrade[k] = Math.min(1, idleByTrade[k] / counts[k]);
    const reading: Reading = { day, alive: t.alive().length, foodIndex: this.fed(need ? met / need : 1), stockouts: diff(t.tally.stockouts, last.stockouts), gluts: {}, bought: {},
      lacking: Object.fromEntries(Object.entries(t.tally.lacking).map(([trade, k]) => [trade, diff(k, last.lacking?.[trade] ?? {})])),
      reserveDays: {}, treasury: t.treasury, treasuryRunwayDays: Infinity, idleByTrade };
    // A few hours are noisy (meals come in bursts): act only on a clear crisis, food eaten well below need and food running out.
    const foodOuts = ["raw-fish", "cooked-fish"].reduce((n, k) => n + (reading.stockouts[k] ?? 0), 0);
    if (reading.foodIndex < 0.6 && foodOuts >= 2) this.steward(day, reading);
    return this.interventions.slice(before);
  }

  /** Eating less than the day's need is no crisis while people are not hungry (they eat when hunger comes). */
  private fed(index: number): number {
    const alive = this.town.alive();
    const hungry = alive.length ? alive.reduce((n, r) => n + r.hunger, 0) / alive.length : 0;
    return hungry < this.town.def.needs.eatAt ? Math.max(index, 1) : index;
  }
  /** Dawn: read yesterday, then act on it. */
  async dawn(day: number): Promise<Intervention[]> {
    const before = this.interventions.length, r = this.read(day), t = this.town;
    this.last = this.snapshot(); this.lastWatch = undefined;
    this.note(day, "Watcher", `ate ${Math.round(r.foodIndex * 100)}% of need · ran out: ${Object.entries(r.stockouts).map(([k, n]) => `${k}×${n}`).join(", ") || "nothing"}`
      + ` · treasury ${r.treasury} (${Number.isFinite(r.treasuryRunwayDays) ? `${r.treasuryRunwayDays} days` : "steady"}) · idle ${Object.entries(r.idleByTrade).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(", ")}`);
    if (r.foodIndex < 0.9) reportGapObservation({ source: "Watcher", category: "agent_distress", severity: r.foodIndex < 0.7 ? "high" : "medium",
      title: "The town is not eating enough", detail: `Yesterday people ate ${Math.round(r.foodIndex * 100)}% of what they need.` }, t.world);

    // The Lawgiver: prices follow shortage and glut; the share follows the treasury.
    for (const [item, misses] of Object.entries(r.stockouts)) {
      if (misses < 2 || t.def.prices[item] === undefined) continue;
      const cap = Math.max(2, (this.basePrices[item] ?? t.def.prices[item]) * 3);
      if (t.def.prices[item] < cap) { t.def.prices[item]++; this.note(day, "Lawgiver", `${item} ran out ${misses}× — price up to ${t.def.prices[item]}`); }
    }
    for (const [item, turned] of Object.entries(r.gluts)) {
      if (turned < 3 || (r.bought[item] ?? 0) > 0 || !(t.def.prices[item] > 1)) continue;
      t.def.prices[item]--; this.note(day, "Lawgiver", `${item} piled up unsold — price down to ${t.def.prices[item]}`);
    }
    // Never cut what feeds the poorest while anyone is going hungry.
    const hungryPoor = t.alive().some(p => p.hunger >= t.def.needs.eatAt && p.coins < (t.def.prices["cooked-fish"] ?? 5));
    // Subsistence: a day's hunger bought at the best food's current price. The share never goes below it.
    const n = t.def.needs, best = t.def.foods.filter(f => (f.hunger ?? 0) > 0 && t.def.prices[f.kind] !== undefined)
      .sort((a, b) => (b.hunger! / t.def.prices[b.kind]) - (a.hunger! / t.def.prices[a.kind]))[0];
    const dayNeed = n.hungerPerHour * (16 + 8 * t.def.night.asleepNeedFactor);
    const subsistence = best ? Math.ceil(dayNeed / best.hunger! * t.def.prices[best.kind]) : 8;
    if (r.treasuryRunwayDays < 3 && t.def.dailyShare - 2 >= subsistence && r.foodIndex >= 1 && !hungryPoor) { t.def.dailyShare -= 2; this.note(day, "Lawgiver", `treasury has ${r.treasuryRunwayDays} days left — daily share down to ${t.def.dailyShare}`); }
    else if (t.def.dailyShare < subsistence && r.treasuryRunwayDays > 4) { t.def.dailyShare = subsistence; this.note(day, "Lawgiver", `food costs more now — daily share up to subsistence (${subsistence})`); }
    else if (r.treasuryRunwayDays > 12 && r.foodIndex < 0.85) { t.def.dailyShare += 2; this.note(day, "Lawgiver", `people are going hungry and the treasury can bear it — daily share up to ${t.def.dailyShare}`); }

    this.steward(day, r);

    // The Weaver: a source running down.
    for (const [kind, days] of Object.entries(r.reserveDays)) {
      if (days >= 2) continue;
      const gives = t.sourceReserves()[kind]?.gives ?? [];
      for (const item of gives) {
        reportResourceGap(t.world, item, `${kind} will be spent in about ${days} days at yesterday's rate.`, "Watcher");
        if (!this.options.weave) { this.note(day, "Weaver", `${kind} (${item}) running out in ${days} days — reported`); continue; }
        const woven = await weaveForGap(item, `The ${kind} that gives ${item} is running out (about ${days} days left). Provide another source of ${item}.`, t,
          { stats: this.options.weaverStats, ...(this.options.weave === "gemini" ? {} : { generate: this.options.weave.generate }) });
        if (woven.ok) { this.options.grown?.push(woven.patch); this.note(day, "Weaver", `grew another source of ${item}: ${woven.patch.reason}`); }
        else this.note(day, "Weaver", `could not provide more ${item}: ${woven.reason}`);
      }
    }
    return this.interventions.slice(before);
  }

  /** The Steward: one idle pair of hands to the trade that is short. */
  private steward(day: number, r: Reading): void {
    const t = this.town;
    const short = this.shortTrade(r);
    if (short) {
      const plan = t.def.townPlan.some(g => (t.builtCount[g.kind] ?? 0) < g.count);
      // Builders stay while the town plan is unfinished; food trades stay unless food is plentiful; nobody leaves a trade empty.
      const food = new Set(Object.values(FOOD_TRADES));
      // Nor out of a trade others are waiting on, nor someone just moved.
      const waitedOn = new Set(Object.values(r.lacking ?? {}).flatMap(k => Object.entries(k).filter(([, n]) => n >= 2).map(([item]) => this.producerOf(item))).filter(Boolean) as string[]);
      const lives = this.lives().filter(l => !l.me.dead && l.me.trade !== short.trade && !(plan && l.me.trade === "builder")
        && !(food.has(l.me.trade) && r.foodIndex < 1.2) && !waitedOn.has(l.me.trade) && (this.movedAt.get(l.me.eid) ?? -Infinity) < t.now - 86_400);
      const candidate = lives.filter(l => this.lives().filter(o => !o.me.dead && o.me.trade === l.me.trade).length > 1)
        .sort((a, b) => (r.idleByTrade[b.me.trade] ?? 0) - (r.idleByTrade[a.me.trade] ?? 0))[0];
      if (candidate && (r.idleByTrade[candidate.me.trade] ?? 0) >= 0.3) {
        const from = candidate.me.trade;
        candidate.changeTrade(short.trade);
        this.movedAt.set(candidate.me.eid, t.now);
        const tools = t.equip(candidate.me.eid, short.trade);
        this.note(day, "Steward", `${candidate.me.name} leaves ${from} (${Math.round((r.idleByTrade[from] ?? 0) * 100)}% idle) to ${short.trade}: ${short.why}${tools.length ? ` (given ${tools.join(", ")})` : ""}`);
      }
    }
  }

  /** The trade whose goods these are. */
  private producerOf(item: string): string | undefined {
    return this.town.def.trades.find(tr => tr.duties.some(d => d.item === item))?.role;
  }
  /** Follow the chain: a short trade already standing idle is short of
   * something else; send hands to whoever makes that. */
  private bottleneck(trade: string, r: Reading, why: string, depth = 0): { trade: string; why: string } {
    const peopleIn = this.lives().filter(l => !l.me.dead && l.me.trade === trade).length;
    if (depth > 3 || peopleIn === 0 || (r.idleByTrade[trade] ?? 0) < 0.6) return { trade, why };
    const lacked = Object.entries(r.lacking?.[trade] ?? {}).sort((a, b) => b[1] - a[1])[0];
    const upstream = lacked && lacked[1] >= 2 ? this.producerOf(lacked[0]) : undefined;
    if (!upstream || upstream === trade) return { trade, why };
    return this.bottleneck(upstream, r, `${trade}s stood idle for want of ${lacked![0]} (${lacked![1]}×)`, depth + 1);
  }
  private shortTrade(r: Reading): { trade: string; why: string } | undefined {
    if (r.foodIndex < 0.9) {
      const fishOut = (r.stockouts["raw-fish"] ?? 0) >= (r.stockouts["cooked-fish"] ?? 0);
      const trade = fishOut ? "fisher" : "cook";
      return this.bottleneck(trade, r, `the town ate ${Math.round(r.foodIndex * 100)}% of need and ${fishOut ? "raw" : "cooked"} fish ran short`);
    }
    // What anyone can fetch for themselves (spring water, brambles) is not a trade's shortage.
    const worst = Object.entries(r.stockouts).filter(([item]) => !SELF_GATHERED.has(item)).sort((a, b) => b[1] - a[1])[0];
    if (!worst || worst[1] < 3) return undefined;
    const trade = FOOD_TRADES[worst[0]] ?? this.town.def.trades.find(tr => tr.duties.some(d => d.item === worst[0]))?.role;
    return trade ? { trade, why: `${worst[0]} ran out ${worst[1]} times` } : undefined;
  }
}
