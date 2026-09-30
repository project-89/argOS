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
import type { Concern, Errand } from "./spatial-autopilot";

export type SpatialTradeHost = {
  world: World;
  registry: SystemRegistry;
  land: LandDef;
  recipes: ReturnType<typeof createSpatialRecipes>;
  kindOf(eid: number): string | undefined;
  /** Rooms with their land place kind. */
  rooms(): Array<{ eid: number; name: string; kind: string }>;
  stall(): number | undefined;
  personNamed(name: string): number | undefined;
  /** Night falls: residents go to their shelter and sleep till dawn. */
  isNight?(): boolean;
  /** The settlement clock's hour and day (supper at the campfire in the evening). */
  hour?(): number;
  day?(): number;
  /** Real milliseconds per game day (waits and rests are in game time). */
  dayMs?(): number;
  /** Where supper is: the campfire. */
  campfire?(): number | undefined;
  /** What their own mind wants (active goals, not the day's trade), most pressing first. */
  goalsOf?(eid: number): Array<{ id: number; description: string; priority: number; paused?: boolean }>;
  /** Take up again an intention that was set aside for review (their choice to retain it; not a claim of progress). */
  takeUp?(eid: number, goal: number): boolean;
  /** People close by (same place, within a few metres), nearest first. */
  peopleNear?(eid: number, metres: number): Array<{ eid: number; name: string; distance: number }>;
  shelter?(eid: number): number | undefined;
  /** Called on every simulation tick while subscribed. */
  onTick(listener: () => void): () => void;
  now(): number;
};

// Shortages and transient hiccups (an interrupted walk, a busy body) are not surprises about how the world works.
const FAIL_PATTERNS = { scarce: /spent|has no |cannot pay|costs \d+; you have|has enough|already building|no longer|is gone|invalidated|changed before completion|already occupied|No reachable path|hands are full/i,
  missing: /(?:you need|needs) (\d+) more ([a-z][a-z-]*)/i,
  /** "You hold no firewood." (selling or giving what you have not got): one missing. */
  holdNone: /you hold no ([a-z][a-z-]*)/i };

/** What a failed act's words say: short of something (and how many), or scarce. */
export function readFailure(summary: string): { missing?: { kind: string; count: number }; scarce?: true } {
  const counted = FAIL_PATTERNS.missing.exec(summary), none = FAIL_PATTERNS.holdNone.exec(summary);
  const missing = counted ? { kind: counted[2], count: Number(counted[1]) } : none ? { kind: none[1], count: 1 } : undefined;
  return { ...(missing ? { missing } : {}), ...(FAIL_PATTERNS.scarce.test(summary) ? { scarce: true as const } : {}) };
}

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
    // A kind of plot means the one furthest along: carry on the house already begun, not a second one.
    return among.find(e => String(Name.value[e] || "").toLowerCase() === wanted)
      ?? among.filter(e => host.kindOf(e) === wanted).sort((a, b) => host.recipes.partsOn(b).length - host.recipes.partsOn(a).length)[0];
  };
  const roomWith = (kind: string) => host.rooms().find(r => usableThings(r.eid).some(e => host.kindOf(e) === kind));
  const env: SkillEnv = {
    have() {
      const stock: Record<string, number> = { ...host.recipes.builtCount(), ...host.recipes.progress() };
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
      if ("thing" in ref) { const e = named(ref.thing, usableThings(roomOf())); return e === undefined ? undefined : Name.value[e]; }
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
    if (/not currently accessible|not here/i.test(summary) && action.target) {
      const room = host.rooms().find(r => named(action.target, things(r.eid)) !== undefined);
      if (room) return { ok, summary, elsewhere: room.name };
    }
    return { ok, summary, ...readFailure(summary) };
  };
  return env;
}

const FOOD = ["cooked-fish", "berries", "raw-fish"];
/** Game minutes a resident goes without turning a hand to their trade before it calls them back. */
export const WORK_RHYTHM_GAME_MINUTES = 120;
/** ...and when the Steward has pressed them (the town is waiting on their work). */
export const PRESSED_RHYTHM_GAME_MINUTES = 45;

export class SpatialTradeLife {
  solver: SkillSolver;
  trade: string;
  stopped = false;
  private readonly env: SkillEnv;
  private readonly cooldown = new Map<string, number>();
  /** Errands the resident's mind chose (bring someone something, go somewhere): done before the day's work. */
  readonly errands: Errand[] = [];
  constructor(private readonly host: SpatialTradeHost, readonly eid: number, trade: string, graph: SkillGraph, private readonly planner: Planner,
    private readonly log?: (line: string) => void,
    private readonly attention?: { holds(eid: number): boolean; surprised(eid: number, item: string, detail: string): void;
      concernsOf?(eid: number): readonly Concern[]; dropConcern?(eid: number, c: Concern): void; summon?(eid: number, reason: string): void;
      /** Set things aside for now (after a long spell of talk, or for the night): no talk or pursuits, just the work. */
      resting?(eid: number): boolean },
    /** A fast judge choosing what to do next from the menu (given who they are and how they feel). */
    private readonly chooser?: (eid: number, menu: string[]) => Promise<number | undefined>) {
    this.trade = trade;
    const env = createSpatialSkillEnv(host, eid), act = env.act.bind(env);
    // Failures for want of something tell the spirits where the chain is short.
    env.act = async action => { const r = await act(action); if (!r.ok && r.missing) host.recipes.lacked(this.trade, r.missing.kind); return r; };
    this.env = env;
    this.solver = this.makeSolver(graph, planner);
  }
  private makeSolver(graph: SkillGraph, planner: Planner): SkillSolver {
    const eid = this.eid, log = this.log;
    return new SkillSolver(this.env, graph, planner, { maxPlannerCalls: 40, log: log ? line => log(`[${Name.value[eid]}] ${line}`) : undefined,
      // The habit yields at its next act when the mind has the floor (or hunger bites, or night falls).
      // Getting food is exempt from hunger's own break-off (else the starving could never forage).
      interrupt: () => this.interrupted(),
      // What they could not get at all, and why (the spirits also see it through the lacking tally).
      onGap: (item, detail) => log?.(`[${Name.value[eid]}] gap: ${item} — ${detail.slice(0, 220)}`),
      onSurprise: (item, _skill, detail) => this.attention?.surprised(eid, item, detail) });
  }
  /** The habit yields at its next act: the mind has the floor, hunger bites, night falls. A solve broken off this way is not a failure. */
  private interrupted(): boolean {
    return this.stopped || (!this.feeding && (Needs.hunger[this.eid] ?? 0) >= 85) || !!this.attention?.holds(this.eid) || !!this.host.isNight?.();
  }
  /** The Steward moved them: they take up another trade and learn it with that trade's graph. */
  private readonly earlierStats: SolveStats[] = [];
  changeTrade(trade: string, graph: SkillGraph, planner: Planner = this.planner): void {
    this.earlierStats.push(this.solver.stats);
    this.trade = trade; this.cooldown.clear();
    this.solver = this.makeSolver(graph, planner);
  }
  get stats(): SolveStats {
    const all = [...this.earlierStats, this.solver.stats];
    return { ...this.solver.stats, plannerCalls: all.reduce((n, x) => n + x.plannerCalls, 0), acts: all.reduce((n, x) => n + x.acts, 0),
      skillRuns: all.reduce((n, x) => n + x.skillRuns, 0), skillFailures: all.reduce((n, x) => n + x.skillFailures, 0) };
  }
  private held(kind: string) { return this.env.have()[kind] ?? 0; }
  /** Game minutes as real milliseconds (a game day per real hour by default). */
  private gameMinutes(minutes: number): number { return minutes * (this.host.dayMs?.() ?? 3_600_000) / 1440; }
  /** Real milliseconds spent waiting with nothing to do (the spirits watch idleness). Talk, supper, rest
   * and bed are not idleness: a fisher caught up in the day's drama has not run out of work. */
  idleMs = 0;
  private wait(ms: number, idle = false): Promise<void> {
    const until = this.host.now() + ms;
    if (idle) this.idleMs += ms;
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

  private feeding = false;
  private async eat(): Promise<boolean> {
    this.feeding = true;
    try { return await this.eatInner(); } finally { this.feeding = false; }
  }
  private async eatInner(): Promise<boolean> {
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
    if (!this.interrupted()) this.cool("forage");
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
        // Broken off (someone spoke to them, night fell) is not a failure: no cooling, they take it up again.
        if (!this.interrupted()) this.cool(`build:${goal.kind}`);
        return false;
      }
      return false;
    }
    for (const duty of this.host.land.trades.find(t => t.role === this.trade)?.duties ?? []) {
      if (this.stallStock(duty.item) >= duty.stock || this.cooling(`duty:${duty.item}`)) continue;
      if (await this.solver.solve(duty.item, this.held(duty.item) + 1)) return true;
      if (this.interrupted()) return false;
      this.cool(`duty:${duty.item}`);
    }
    return false;
  }
  /** Carry out an errand the mind chose. */
  private async errand(errand: Errand): Promise<void> {
    if (errand.kind === "go") { await this.env.act({ verb: "move", target: errand.place }); return; }
    if (!(await this.solver.solve(errand.item, this.held(errand.item) + 1))) return;
    const person = this.host.personNamed(errand.to);
    if (person === undefined) return;
    const room = getRoomForEntity(this.host.world, person);
    if (room !== undefined && room !== getRoomForEntity(this.host.world, this.eid)) await this.env.act({ verb: "move", target: Name.value[room] });
    await this.env.act({ verb: "give", target: errand.item, arg: errand.to });
  }
  private lastChoiceAt = -Infinity;
  /** When they last turned their hand to their trade (made, sold, built — or tried to). */
  private lastWorkAt = -Infinity;
  private hasWork(): boolean {
    if (this.trade === "builder") return this.host.land.townPlan.some(g => (this.host.recipes.builtCount()[g.kind] ?? 0) < g.count && !this.cooling(`build:${g.kind}`));
    return (this.host.land.trades.find(t => t.role === this.trade)?.duties ?? []).some(d => this.stallStock(d.item) < d.stock && !this.cooling(`duty:${d.item}`));
  }
  /** A livelihood presses: however gripping the day's talk, a few hours without turning a hand to the trade sends them back to it. */
  private workDue(): boolean {
    const rhythm = this.host.now() < this.pressedUntil ? PRESSED_RHYTHM_GAME_MINUTES : WORK_RHYTHM_GAME_MINUTES;
    return this.host.now() - this.lastWorkAt >= this.gameMinutes(rhythm) && this.hasWork();
  }
  private pressedUntil = -Infinity;
  /** The Steward presses: for this long (real ms), the trade calls them back sooner. */
  press(forMs: number, reason: string): void {
    this.pressedUntil = this.host.now() + forMs;
    this.log?.(`[${Name.value[this.eid]}] pressed to put ${this.trade === "builder" ? "building" : "the trade"} first: ${reason}`);
  }
  private async turnToWork(): Promise<boolean> {
    this.lastWorkAt = this.host.now();
    return await this.sell() || await this.work();
  }
  /** What could be done next, as the judge sees it: the day's work, needs, and what they mean to act on. */
  private menu(): Array<{ label: string; run: () => Promise<boolean> }> {
    const out: Array<{ label: string; run: () => Promise<boolean> }> = [];
    const hunger = Needs.hunger[this.eid] ?? 0;
    if (hunger >= 35) out.push({ label: "eat something", run: () => this.eat() });
    const duties = this.host.land.trades.find(t => t.role === this.trade)?.duties ?? [];
    if (duties.some(d => this.held(d.item) > (FOOD.includes(d.item) ? 1 : 0))) out.push({ label: "sell what I've made at the stall", run: () => { this.lastWorkAt = this.host.now(); return this.sell(); } });
    for (const d of duties) if (this.stallStock(d.item) < d.stock) out.push({ label: `make ${d.item.replace(/-/g, " ")} for the stall`, run: () => { this.lastWorkAt = this.host.now(); return this.solver.solve(d.item, this.held(d.item) + 1); } });
    if (this.trade === "builder") for (const g of this.host.land.townPlan) {
      const built = this.host.recipes.builtCount()[g.kind] ?? 0;
      if (built < g.count) { out.push({ label: `build the ${g.kind}`, run: () => { this.lastWorkAt = this.host.now(); return this.solver.solve(g.kind, built + 1); } }); break; }
    }
    // Things set aside for now: the menu is the day's work and needs, not more of the drama.
    if (this.attention?.resting?.(this.eid)) { out.push({ label: "rest a while", run: async () => { await this.wait(this.gameMinutes(30)); return true; } }); return out; }
    for (const c of this.attention?.concernsOf?.(this.eid) ?? [])
      out.push({ label: `${c.response}: ${c.about.slice(0, 140)}`, run: async () => {
        this.attention?.dropConcern?.(this.eid, c);
        this.attention?.summon?.(this.eid, `You mean to ${c.response}: ${c.about}`);
        return true; } });
    // What their own mind set out to do (a conversation's resolve outlives the conversation).
    for (const goal of (this.host.goalsOf?.(this.eid) ?? []).slice(0, 3))
      if (!this.cooling(`goal:${goal.id}`)) out.push({ label: `pursue: ${goal.description.slice(0, 140)}`, run: () => this.pursue(goal) });
    // People nearby can fall into talk.
    if (!this.cooling("talk")) for (const p of (this.host.peopleNear?.(this.eid, 12) ?? []).slice(0, 3))
      out.push({ label: `talk with ${p.name}`, run: () => this.talk(p) });
    out.push({ label: "rest a while", run: async () => { await this.wait(this.gameMinutes(60)); return true; } });
    return out;
  }
  private supperTime() { const h = this.host.hour?.(); return h !== undefined && h >= 18 && h < 21.5; }
  private atSupper = -1;
  /** Walk to the campfire and eat there, where others gather. */
  private async supper(): Promise<boolean> {
    const fire = this.host.campfire?.(), room = fire === undefined ? undefined : getRoomForEntity(this.host.world, fire);
    if (room !== undefined && room !== getRoomForEntity(this.host.world, this.eid)) await this.env.act({ verb: "move", target: Name.value[room] });
    this.atSupper = this.host.day?.() ?? -1;
    if ((Needs.hunger[this.eid] ?? 0) >= this.host.land.needs.eatAt / 2) await this.eat();
    await this.wait(this.gameMinutes(45));
    return true;
  }
  /** Fall into talk: the mind takes the floor with someone at hand. */
  private async talk(p: { eid: number; name: string }): Promise<boolean> {
    this.cool("talk", 15 * 60_000);
    this.attention?.summon?.(this.eid, `${p.name} is right here with you. You fall into talk; say what is on your mind to ${p.name}.`);
    return true;
  }
  /** Pursue one of their own goals: what the habit can do itself (fetch, make, go), it does; the rest wakes the mind for its next step. */
  private async pursue(goal: { id: number; description: string; paused?: boolean }): Promise<boolean> {
    this.cool(`goal:${goal.id}`, 5 * 60_000);
    if (goal.paused && !this.host.takeUp?.(this.eid, goal.id)) return false;
    if (goal.paused) this.log?.(`[${Name.value[this.eid]}] takes up again: ${goal.description.slice(0, 140)}`);
    const text = goal.description.toLowerCase();
    // Goods named as whole words, not inside a place's name ("the Net House" is not a net).
    const bare = this.host.rooms().reduce((t, r) => t.replaceAll(r.name.toLowerCase(), " ").replaceAll(r.name.toLowerCase().replace(/^the /, ""), " "), text);
    const item = Object.keys(this.host.land.prices).find(k => new RegExp(`\\b(${k}|${k.replace(/-/g, " ")})s?\\b`).test(bare));
    const person = this.host.peopleNear?.(this.eid, 999)?.find(p => text.includes(p.name.toLowerCase()))
      ?? (this.host.personNamed ? [...this.host.land.residents.map(r => r.name)].map(n => ({ name: n, eid: this.host.personNamed(n) })).find(p => p.eid !== undefined && text.includes(p.name.toLowerCase())) : undefined);
    const room = this.host.rooms().find(r => text.includes(r.name.toLowerCase()));
    if (item && person && /\b(bring|give|take|fetch|hand)\b/.test(text)) { this.errands.push({ kind: "bring", item, to: person.name }); return true; }
    if (item && /\b(make|get|gather|catch|chop|cook|fetch|find)\b/.test(text)) return this.solver.solve(item, this.held(item) + 1);
    if (room && /\b(go|walk|return|head)\b/.test(text) && !person) { await this.env.act({ verb: "move", target: room.name }); return true; }
    this.attention?.summon?.(this.eid, `You set out to ${goal.description}. Take your next step toward it.`);
    return true;
  }
  /** Let the judge pick when there is a real choice (something on their mind, or several things to do); at most every few minutes. */
  private async chooseNext(): Promise<boolean> {
    if (!this.chooser || this.host.now() - this.lastChoiceAt < 3 * 60_000) return false;
    const menu = this.menu();
    const concerns = this.attention?.concernsOf?.(this.eid).length ?? 0;
    if (!concerns && menu.length < 4) return false;
    this.lastChoiceAt = this.host.now();
    const index = await this.chooser(this.eid, menu.map(m => m.label));
    const pick = index === undefined ? undefined : menu[index];
    if (!pick) return false;
    this.log?.(`[${Name.value[this.eid]}] chooses: ${pick.label}`);
    await pick.run();
    return true;
  }
  /** Bed: walk to your tent (or house) and sleep till dawn. */
  private async sleep(): Promise<void> {
    const shelter = this.host.shelter?.(this.eid);
    if (shelter === undefined) { await this.wait(60_000); return; }
    const room = getRoomForEntity(this.host.world, shelter);
    if (room !== undefined && room !== getRoomForEntity(this.host.world, this.eid)) await this.env.act({ verb: "move", target: Name.value[room] });
    const slept = await this.env.act({ verb: "sleep", target: Name.value[shelter] });
    if (!slept.ok) await this.wait(60_000);
  }
  async live(): Promise<void> {
    while (!this.stopped && entityExists(this.host.world, this.eid)) {
      // The mind has the floor: the habit waits.
      if (this.attention?.holds(this.eid)) { await this.wait(2_000); continue; }
      if (this.host.isNight?.()) { await this.sleep(); continue; }
      // Supper at the fire once each evening is a habit, not a choice (a judge weighing errands never picks it).
      if (this.supperTime() && this.atSupper !== (this.host.day?.() ?? -1)) { await this.supper(); continue; }
      const errand = this.errands.shift();
      if (errand) { await this.errand(errand); continue; }
      if (this.workDue() && await this.turnToWork()) continue;
      if (await this.chooseNext()) continue;
      if ((Needs.hunger[this.eid] ?? 0) >= this.host.land.needs.eatAt && await this.eat()) continue;
      if (await this.turnToWork()) continue;
      await this.wait(this.gameMinutes(20), true); // nothing to do: this is idleness
    }
  }
}
