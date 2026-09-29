/** Residents working their trades in the walkable settlement, by habit.
 *
 * The same skill runtime that learns in the headless settlement drives a
 * resident's body here: acts become native actions (walking, timed crafts,
 * receipts), and each resolves when the body finishes. A trade's skill graph
 * trained headless carries over unchanged — kinds of things and places are the
 * same — so residents can walk into the 3D world already knowing their work.
 *
 * The loop is a small will, not a mind: hunger first (eat what you hold, buy,
 * forage), then the trade (make what the stall lacks, sell it; builders raise
 * the town plan), then a pause. Talk, drama and choices stay with the
 * residents' own minds; this is the habit layer that makes the town run. */
import { entityExists } from "bitecs";
import type { World } from "../ecs/world";
import { Name, Needs } from "../ecs/components";
import { getRoomForEntity, listDirectContents } from "../ecs/location";
import { executeActions } from "../cognition/cognition-system";
import { getWorkingMemory } from "../cognition/working-memory";
import { isSimulationResourceBusy } from "../runtime/simulation-timeline";
import type { SystemRegistry } from "../ecs/dynamic-systems";
import type { AgentAction } from "../cognition/agent-mind";
import type { Act, ActResult } from "../learning/homestead/world";
import { SkillGraph, type Ref } from "../learning/skill-graph";
import { SkillSolver, type Planner, type SkillEnv, type SolveStats } from "../learning/skill-runtime";
import type { LandDef } from "../learning/settlement/saltmere-land";
import type { createSpatialRecipes } from "./spatial-recipes";

export type SpatialTradeHost = {
  world: World;
  registry: SystemRegistry;
  land: LandDef;
  recipes: ReturnType<typeof createSpatialRecipes>;
  kindOf(eid: number): string | undefined;
  /** Rooms with their land place kind. */
  rooms(): Array<{ eid: number; name: string; kind: string }>;
  stall(): number | undefined;
  /** Called on every simulation tick while subscribed. */
  onTick(listener: () => void): () => void;
  now(): number;
};

const FAIL_PATTERNS = { scarce: /spent|has no |cannot pay|costs \d+; you have|has enough|already building|no longer|is gone/i,
  missing: /(?:you need|needs) (\d+) more ([a-z][a-z-]*)/i };

/** A resident's body as a skill environment. */
export function createSpatialSkillEnv(host: SpatialTradeHost, eid: number): SkillEnv {
  const w = host.world;
  const things = (room: number) => listDirectContents(w, room).filter(e => entityExists(w, e) && host.kindOf(e) !== undefined);
  /** Things worth going to: sources with uses left. */
  const usableThings = (room: number) => things(room).filter(e => host.recipes.usable(e));
  const hand = () => listDirectContents(w, eid).filter(e => entityExists(w, e));
  const kindOfRoom = (room: number) => host.rooms().find(r => r.eid === room)?.kind ?? "";
  const roomOf = () => getRoomForEntity(w, eid)!;
  const named = (text: string | undefined, among: number[]) => {
    const wanted = text?.trim().toLowerCase();
    if (!wanted) return undefined;
    return among.find(e => String(Name.value[e] || "").toLowerCase() === wanted) ?? among.find(e => host.kindOf(e) === wanted);
  };
  const roomWith = (kind: string) => host.rooms().find(r => usableThings(r.eid).some(e => host.kindOf(e) === kind));
  const env: SkillEnv = {
    have() {
      const stock: Record<string, number> = { ...host.recipes.builtCount() };
      for (const e of hand()) { const k = host.kindOf(e); if (k) stock[k] = (stock[k] ?? 0) + 1; }
      stock.coin = host.recipes.coinsOf(eid);
      return stock;
    },
    act(action: Act): Promise<ActResult> {
      const verb = action.verb.trim().toLowerCase();
      // Kinds name the nearest such thing (in hand, here, then anywhere); places by name or kind.
      const target = verb === "move" ? (host.rooms().find(r => r.name.toLowerCase() === String(action.target ?? "").toLowerCase() || r.kind === action.target)?.name ?? action.target)
        : (() => { const e = named(action.target, hand()) ?? named(action.target, usableThings(roomOf())) ?? named(action.target, things(roomOf()))
            ?? named(action.target, host.rooms().flatMap(r => usableThings(r.eid)));
          return e === undefined ? action.target : Name.value[e]; })();
      // Already there: walking to where you stand is done.
      if (verb === "move" && host.rooms().find(r => r.name === target)?.eid === roomOf()) return Promise.resolve({ ok: true, summary: "Already here." });
      const native: AgentAction = verb === "move" || verb === "pickup" ? { type: verb, target } as AgentAction
        : { type: "interact", target, content: `${verb}${action.arg ? ` ${action.arg}` : ""}` } as AgentAction;
      const known = new Set(getWorkingMemory(w, eid).receipts.map(r => r.id));
      executeActions(w, [{ eid, action: native }], host.registry);
      return new Promise(resolve => {
        const started = host.now();
        const check = () => {
          const fresh = getWorkingMemory(w, eid).receipts.filter(r => r.kind === "action" && !known.has(r.id)).at(-1);
          if (fresh && !isSimulationResourceBusy(w, eid, "body")) { stop(); resolve(toResult(fresh.summary, fresh.succeeded === true, action)); return; }
          if (host.now() - started > 10 * 60_000) { stop(); resolve({ ok: false, summary: "Nothing came of it.", scarce: true }); }
        };
        const stop = host.onTick(check);
        check();
      });
    },
    observation() {
      const room = roomOf();
      const here = things(room).map(e => `${Name.value[e]} (${host.kindOf(e)})`);
      const places = host.rooms().map(r => `${r.name} (${r.kind}${things(r.eid).length ? `: ${[...new Set(things(r.eid).map(e => host.kindOf(e)))].join(", ")}` : ""})`);
      const held = Object.entries(env.have()).filter(([k]) => k !== "coin").map(([k, n]) => `${k} ×${n}`);
      const stall = host.stall();
      const stock = stall === undefined ? [] : listDirectContents(w, stall).map(e => host.kindOf(e)).filter(Boolean);
      return [`You are ${Name.value[eid]} in ${Name.value[room]}. Here: ${here.join(", ") || "nothing"}.`, `Places: ${places.join("; ")}.`,
        `You hold: ${held.join(", ") || "nothing"}; ${host.recipes.coinsOf(eid)} coin.`, `Market stall has: ${stock.join(", ") || "nothing"}.`,
        host.recipes.context(eid)].join("\n");
    },
    bind(ref: Ref) {
      if ("thing" in ref) { const e = usableThings(roomOf()).find(x => host.kindOf(x) === ref.thing); return e === undefined ? undefined : Name.value[e]; }
      const room = "where" in ref ? (usableThings(roomOf()).some(e => host.kindOf(e) === ref.where) ? host.rooms().find(r => r.eid === roomOf()) : roomWith(ref.where))
        : host.rooms().find(r => r.kind === ref.place);
      return room?.name;
    },
    async approach(ref: Ref) {
      if (!("thing" in ref)) return false;
      if (env.bind(ref)) return true;
      const room = roomWith(ref.thing);
      return room ? (await env.act({ verb: "move", target: room.name })).ok : false;
    },
    abstract(action: Act, next?: Act) {
      const verb = action.verb.trim().toLowerCase(), arg = action.arg?.trim() ? { arg: action.arg.trim().toLowerCase() } : {};
      if (verb === "move") {
        const room = host.rooms().find(r => r.name.toLowerCase() === String(action.target ?? "").toLowerCase() || r.kind === action.target);
        const following = next && next.verb !== "move" && room ? named(next.target, things(room.eid)) : undefined;
        if (following !== undefined) return { verb, target: { where: host.kindOf(following)! } };
        return { verb, ...(room ? { target: { place: room.kind } } : {}) };
      }
      const all = host.rooms().flatMap(r => things(r.eid));
      const target = named(action.target, things(roomOf()).concat(hand())) ?? named(action.target, all);
      return { verb, ...(target !== undefined ? { target: { thing: host.kindOf(target)! } } : {}), ...arg };
    },
    unsolvable: kind => kind === "coin",
    now: () => host.now() / 1000,
  };
  const toResult = (summary: string, ok: boolean, action: Act): ActResult => {
    if (ok) return { ok, summary };
    const miss = FAIL_PATTERNS.missing.exec(summary);
    if (/not currently accessible|not here/i.test(summary) && action.target) {
      const room = host.rooms().find(r => named(action.target, things(r.eid)) !== undefined);
      if (room) return { ok, summary, elsewhere: room.name };
    }
    return { ok, summary, ...(miss ? { missing: { kind: miss[2], count: Number(miss[1]) } } : {}), ...(FAIL_PATTERNS.scarce.test(summary) ? { scarce: true } : {}) };
  };
  return env;
}

const FOOD = ["cooked-fish", "berries", "raw-fish"];

export class SpatialTradeLife {
  readonly solver: SkillSolver;
  stopped = false;
  private readonly env: SkillEnv;
  private readonly cooldown = new Map<string, number>();
  constructor(private readonly host: SpatialTradeHost, readonly eid: number, readonly trade: string, graph: SkillGraph, planner: Planner,
    private readonly log?: (line: string) => void) {
    this.env = createSpatialSkillEnv(host, eid);
    this.solver = new SkillSolver(this.env, graph, planner, { maxPlannerCalls: 40, log: log ? line => log(`[${Name.value[eid]}] ${line}`) : undefined,
      interrupt: () => this.stopped || (Needs.hunger[eid] ?? 0) >= 85 });
  }
  get stats(): SolveStats { return this.solver.stats; }
  private held(kind: string) { return this.env.have()[kind] ?? 0; }
  private wait(ms: number): Promise<void> {
    const until = this.host.now() + ms;
    return new Promise(resolve => { const stop = this.host.onTick(() => { if (this.stopped || this.host.now() >= until) { stop(); resolve(); } }); });
  }
  private cooling(key: string) { return (this.cooldown.get(key) ?? -Infinity) > this.host.now(); }
  private cool(key: string, ms = 10 * 60_000) { this.cooldown.set(key, this.host.now() + ms); }
  private stallStock(kind: string) { const s = this.host.stall(); return s === undefined ? 0 : listDirectContents(this.host.world, s).filter(e => this.host.kindOf(e) === kind).length; }
  private stallName() { const s = this.host.stall(); return s === undefined ? "Market stall" : Name.value[s]; }
  /** Walk to the stall's place (trade happens there). */
  private async toStall(): Promise<void> {
    const s = this.host.stall(), room = s === undefined ? undefined : getRoomForEntity(this.host.world, s);
    if (room !== undefined && getRoomForEntity(this.host.world, this.eid) !== room) await this.env.act({ verb: "move", target: Name.value[room] });
  }

  private async eat(): Promise<boolean> {
    for (const kind of FOOD) if (this.held(kind) > 0) return (await this.env.act({ verb: "eat", target: kind })).ok;
    for (const kind of FOOD) {
      const price = this.host.land.prices[kind] ?? Infinity;
      if (this.stallStock(kind) > 0 && this.host.recipes.coinsOf(this.eid) >= price) {
        await this.toStall();
        const bought = await this.env.act({ verb: "buy", target: this.stallName(), arg: kind });
        if (bought.ok) return (await this.env.act({ verb: "eat", target: kind })).ok;
      }
    }
    if (!this.cooling("forage") && await this.solver.solve("berries", this.held("berries") + 1)) return (await this.env.act({ verb: "eat", target: "berries" })).ok;
    this.cool("forage");
    return false;
  }
  private async sell(): Promise<boolean> {
    let sold = false;
    for (const duty of this.host.land.trades.find(t => t.role === this.trade)?.duties ?? []) {
      const keep = FOOD.includes(duty.item) ? 1 : 0;
      if (this.held(duty.item) > keep && this.stallStock(duty.item) < duty.stock) await this.toStall();
      while (this.held(duty.item) > keep && this.stallStock(duty.item) < duty.stock && !this.stopped) {
        const r = await this.env.act({ verb: "sell", target: this.stallName(), arg: duty.item });
        if (!r.ok) break;
        sold = true;
      }
    }
    return sold;
  }
  private async work(): Promise<boolean> {
    if (this.trade === "builder") {
      for (const goal of this.host.land.townPlan) {
        const built = this.host.recipes.builtCount()[goal.kind] ?? 0;
        if (built >= goal.count) continue;
        if (this.cooling(`build:${goal.kind}`)) return false;
        if (await this.solver.solve(goal.kind, built + 1)) return true;
        this.cool(`build:${goal.kind}`);
        return false;
      }
      return false;
    }
    for (const duty of this.host.land.trades.find(t => t.role === this.trade)?.duties ?? []) {
      if (this.stallStock(duty.item) >= duty.stock || this.cooling(`duty:${duty.item}`)) continue;
      if (await this.solver.solve(duty.item, this.held(duty.item) + 1)) return true;
      this.cool(`duty:${duty.item}`);
    }
    return false;
  }
  async live(): Promise<void> {
    while (!this.stopped && entityExists(this.host.world, this.eid)) {
      if ((Needs.hunger[this.eid] ?? 0) >= 55 && await this.eat()) continue;
      if (await this.sell()) continue;
      if (await this.work()) continue;
      await this.wait(60_000);
    }
  }
}
