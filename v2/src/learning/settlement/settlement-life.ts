/** Residents' days in the settlement. A small deterministic will — needs first,
 * then the trade — decides WHAT to do; the skill graph decides HOW, asking the
 * model only for what the resident's trade does not yet know. Each trade keeps
 * its own graph (a fisher learns fishing, a cook cooking), carried between
 * lives; memories are not.
 *
 * - Thirst or hunger past the mark: drink or eat what is in hand, else buy it
 *   at the stall, else get it (the graph: draw water, pick berries, ...).
 * - Otherwise, the trade: the first duty whose goods the stall is short of —
 *   make one, sell it. Builders raise the town plan's next building.
 * - Nothing to do: rest a while. */
import { Name } from "../../ecs/components";
import { SkillGraph } from "../skill-graph";
import { SkillSolver, type Planner, type SolveStats } from "../skill-runtime";
import type { Settlement, ResidentState } from "./settlement";

export type LifeOptions = { graphs: Map<string, SkillGraph>; planner: (trade: string) => Planner; life: number;
  onGap?: (resident: ResidentState, item: string, detail: string) => void; log?: (line: string) => void };

const FOOD_ORDER = ["cooked-fish", "berries", "raw-fish"];
/** What anyone can get for themselves when the stall cannot help. */
const SELF_PROVIDED = new Set(["water", "berries"]);
const COOLDOWN_S = 3600;
const LARDER = 2;
const URGENT = 75;

export class ResidentLife {
  solver: SkillSolver;
  private readonly earlier: SolveStats[] = [];
  private readonly cooldown = new Map<string, number>();
  /** Getting food or water now: needs must not interrupt it. */
  private meeting = false;
  stopped = false;
  constructor(private readonly town: Settlement, readonly me: ResidentState, private readonly options: LifeOptions) {
    this.solver = this.makeSolver();
  }
  /** A resident given a new trade by the Steward learns it with that trade's graph. */
  changeTrade(trade: string): void {
    this.earlier.push(this.solver.stats);
    this.me.trade = trade;
    this.cooldown.clear();
    this.solver = this.makeSolver();
  }
  private makeSolver(): SkillSolver {
    const { town, me, options } = this;
    let graph = options.graphs.get(me.trade);
    if (!graph) { graph = new SkillGraph(); options.graphs.set(me.trade, graph); }
    return new SkillSolver(town.envFor(me.eid), graph, options.planner(me.trade), { life: options.life, maxPlannerCalls: 60,
      onGap: (item, detail) => options.onGap?.(me, item, detail),
      // Urgent thirst or hunger breaks off work (except the work of getting food or water).
      interrupt: () => !this.meeting && (me.thirst >= URGENT || me.hunger >= URGENT || town.isNight()),
      log: options.log ? line => options.log!(`[${me.name}] ${line}`) : undefined });
  }
  get stats(): SolveStats {
    const all = [...this.earlier, this.solver.stats];
    return { ...this.solver.stats, plannerCalls: all.reduce((n, s) => n + s.plannerCalls, 0), acts: all.reduce((n, s) => n + s.acts, 0),
      skillRuns: all.reduce((n, s) => n + s.skillRuns, 0), skillFailures: all.reduce((n, s) => n + s.skillFailures, 0) };
  }
  private held(kind: string) { return this.town.have(this.me.eid)[kind] ?? 0; }
  private act(verb: string, target?: string, arg?: string) { return this.town.perform(this.me.eid, { verb, ...(target ? { target } : {}), ...(arg ? { arg } : {}) }); }
  private async toStall() {
    const common = this.town.rooms.get("common")!;
    if (this.town.roomOf(this.me.eid) !== common) await this.act("move", Name.value[common]);
  }
  private async buy(kind: string): Promise<boolean> {
    const price = this.town.def.prices[kind];
    if (price === undefined || this.me.coins < price || !(this.town.stallStock()[kind] > 0)) return false;
    await this.toStall();
    return (await this.act("buy", "Market stall", kind)).ok;
  }
  /** Hungry and short of coin: sell whatever the stall will take. */
  private async raiseCoin(price: number): Promise<void> {
    const hand = this.town.have(this.me.eid);
    for (const [kind, n] of Object.entries(hand)) {
      if (this.me.coins >= price) return;
      if (n <= 0 || kind === "coin" || this.town.def.prices[kind] === undefined || this.town.def.foods.some(f => f.kind === kind)) continue;
      await this.toStall();
      for (let i = 0; i < n && this.me.coins < price; i++) if (!(await this.act("sell", "Market stall", kind)).ok) break;
    }
  }
  /** Drink or eat: hand, stall, or make it. */
  private async consume(kinds: string[], verb: "eat" | "drink"): Promise<boolean> {
    this.meeting = true;
    try { return await this.consumeInner(kinds, verb); } finally { this.meeting = false; }
  }
  private async consumeInner(kinds: string[], verb: "eat" | "drink"): Promise<boolean> {
    for (const kind of kinds) if (this.held(kind) > 0) return (await this.act(verb, kind)).ok;
    const cheapest = Math.min(...kinds.filter(k => (this.town.stallStock()[k] ?? 0) > 0).map(k => this.town.def.prices[k] ?? Infinity));
    if (Number.isFinite(cheapest) && this.me.coins < cheapest) await this.raiseCoin(cheapest);
    for (const kind of kinds) if (await this.buy(kind)) return (await this.act(verb, kind)).ok;
    // Feed yourself by what anyone can do (forage, draw water) or by your own trade.
    const duties = this.town.def.trades.find(t => t.role === this.me.trade)?.duties.map(d => d.item) ?? [];
    for (const kind of kinds.filter(k => SELF_PROVIDED.has(k) || duties.includes(k))) {
      if (this.onCooldown(`need:${kind}`)) continue;
      if (await this.solver.solve(kind, this.held(kind) + 1)) return (await this.act(verb, kind)).ok;
      this.cool(`need:${kind}`);
    }
    return false;
  }
  private onCooldown(key: string) { return (this.cooldown.get(key) ?? -Infinity) > this.town.now; }
  private cool(key: string) { this.cooldown.set(key, this.town.now + COOLDOWN_S); }

  /** Sell what the trade made (keeping what the trade itself uses). */
  private async sellGoods(): Promise<boolean> {
    const duties = this.town.def.trades.find(t => t.role === this.me.trade)?.duties ?? [];
    for (const duty of duties) {
      if (this.held(duty.item) <= 0 || (this.town.stallStock()[duty.item] ?? 0) >= duty.stock) continue;
      // A producer of food keeps a little of it for themselves.
      const keep = this.town.def.foods.some(f => f.kind === duty.item) ? LARDER : 0;
      if (this.held(duty.item) <= keep) continue;
      await this.toStall();
      let sold = false;
      while (this.held(duty.item) > keep && (this.town.stallStock()[duty.item] ?? 0) < this.town.def.stallCap && !this.me.dead)
        { const r = await this.act("sell", "Market stall", duty.item); if (!r.ok) break; sold = true; }
      if (sold) return true;
    }
    return false;
  }
  private async work(): Promise<boolean> {
    if (this.me.trade === "builder") {
      for (const goal of this.town.def.townPlan) {
        const built = this.town.builtCount[goal.kind] ?? 0;
        if (built >= goal.count) continue;
        if (this.onCooldown(`build:${goal.kind}`)) return false;
        if (await this.solver.solve(goal.kind, built + 1)) return true;
        this.cool(`build:${goal.kind}`);
        return false;
      }
      return false;
    }
    for (const duty of this.town.def.trades.find(t => t.role === this.me.trade)?.duties ?? []) {
      if ((this.town.stallStock()[duty.item] ?? 0) >= duty.stock || this.onCooldown(`duty:${duty.item}`)) continue;
      if (await this.solver.solve(duty.item, this.held(duty.item) + 1)) return true;
      this.cool(`duty:${duty.item}`);
    }
    return false;
  }

  async live(): Promise<void> {
    const mark = this.town.def.needs.eatAt;
    while (!this.stopped && !this.me.dead) {
      if (this.me.thirst >= mark && await this.consume(["water"], "drink")) continue;
      if (this.town.isNight()) {
        // Eat and drink before bed if it will be a long night, then sleep in the tent or house.
        if (this.me.hunger >= mark / 2 && await this.consume(FOOD_ORDER, "eat")) continue;
        await this.toStall();
        if (!(await this.act("sleep")).ok) await this.town.wait(this.me.eid, 600);
        continue;
      }
      if (this.me.hunger >= mark && await this.consume(FOOD_ORDER, "eat")) continue;
      if (await this.sellGoods()) continue;
      if (await this.work()) continue;
      await this.town.wait(this.me.eid, 900);
    }
  }
}
