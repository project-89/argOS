/** A settlement in the real ECS where everything takes time. Residents get
 * hungry and thirsty, work their trades, sell at the market stall and buy from
 * it, wear out their tools, and raise buildings on bare plots. Every act is
 * timed on the settlement's clock: `perform` returns a promise that resolves
 * when the act completes in simulated time (materials are committed at the
 * start, products appear at the end). The clock advances only when every
 * living resident is busy or waiting, so what happens is decided by the
 * simulation, not by wall-clock speed.
 *
 * The land is data (saltmere-land.ts); the Weaver can grow it (RecipeWorld). */
import { entityExists } from "bitecs";
import { createArgosWorld, type World } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createObjectEntity, createRoomEntity } from "../../ecs/prefabs";
import { Agent, Name, ObjectType, PhysicalObject } from "../../ecs/components";
import { getRoomForEntity, listDirectContents, setLocatedIn } from "../../ecs/location";
import { startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import type { Act, ActResult } from "../homestead/world";
import type { Ref } from "../skill-graph";
import type { SkillEnv } from "../skill-runtime";
import { recipeHint, type RecipeWorld, type WovenPatch } from "../../spirits/recipe-weaver";
import type { LandDef, LandRecipe, LandStructure, Stock } from "./saltmere-land";

const WALK_MPS = 1.3, FAIL_S = 5, TRADE_S = 20, PICKUP_S = 10, DAY_S = 86_400;
const title = (kind: string) => kind.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

export type ResidentState = { eid: number; name: string; trade: string; hunger: number; thirst: number; coins: number;
  starvingSince?: number; dead?: boolean; diedAt?: number; causeOfDeath?: string };
type Pending = { end: number; finish: () => ActResult; resolve: (result: ActResult) => void; label: string };
export type SettlementEvent = { at: number; who: string; what: string };
export type SettlementTally = { made: Stock; sold: Stock; bought: Stock; eaten: Stock; built: Stock; failures: number; acts: number };

export class Settlement implements RecipeWorld {
  readonly world: World;
  readonly rooms = new Map<string, number>();
  private readonly roomPlace = new Map<number, LandDef["places"][number]>();
  private readonly uses = new Map<number, number>();
  private readonly regrow = new Map<number, { amount: number; cap: number }>();
  private readonly wearLeft = new Map<number, number>();
  private readonly plotParts = new Map<number, string[]>();
  /** Plots with a part under way (one builder per plot at a time). */
  private readonly plotBusy = new Set<number>();
  /** A builder's plot, theirs until the building is finished. */
  private readonly plotOwner = new Map<number, number>();
  private readonly recipes: LandRecipe[];
  private readonly structures: LandStructure[];
  private readonly usedUp: number;
  readonly stall: number;
  readonly residents: ResidentState[] = [];
  private readonly byEid = new Map<number, ResidentState>();
  private readonly pending = new Map<number, Pending>();
  readonly builtCount: Stock = {};
  treasury: number;
  now = 0;
  readonly events: SettlementEvent[] = [];
  readonly tally: SettlementTally = { made: {}, sold: {}, bought: {}, eaten: {}, built: {}, failures: 0, acts: 0 };

  constructor(readonly def: LandDef) {
    this.world = createArgosWorld(`Settlement ${def.id}`);
    initializePrefabs(this.world);
    startCommittedEvents(this.world);
    this.world.meta.aiEnabled = false;
    this.usedUp = createRoomEntity(this.world, { name: "(used up)", description: "Consumed materials." });
    for (const place of def.places) {
      const room = createRoomEntity(this.world, { name: place.name, description: place.description });
      this.rooms.set(place.id, room); this.roomPlace.set(room, place);
    }
    for (const thing of def.things) this.addThing(thing);
    this.stall = this.thingsIn(this.rooms.get("common")!).find(e => this.kindOf(e) === "stall")!;
    this.recipes = def.recipes.map(r => ({ ...r, hint: r.hint ?? recipeHint(r as any) }));
    this.structures = def.structures.map(s => ({ ...s, parts: s.parts.map(p => ({ ...p })) }));
    this.treasury = def.treasury;
    for (const r of def.residents) {
      const eid = createAgentEntity(this.world, { name: r.name, role: r.trade, systemPrompt: `You are ${r.name}, ${r.trade} of Saltmere.`, roomId: this.rooms.get(r.start)! });
      const state: ResidentState = { eid, name: r.name, trade: r.trade, hunger: 20, thirst: 20, coins: r.coins };
      this.residents.push(state); this.byEid.set(eid, state);
      for (const kind of r.carries ?? []) this.giveItem(eid, kind);
    }
  }
  stop(): void { stopCommittedEvents(this.world); }

  // -------------------------------------------------------------------------
  // Things
  // -------------------------------------------------------------------------
  kindOf(eid: number): string { return String(ObjectType.typeId[eid] || ""); }
  addThing(thing: LandDef["things"][number]): number {
    const eid = createObjectEntity(this.world, { name: thing.name, roomId: this.rooms.get(thing.place)!, portable: !!thing.portable });
    ObjectType.typeId[eid] = thing.kind;
    if (thing.uses !== undefined) this.uses.set(eid, thing.uses);
    if (thing.regrow) this.regrow.set(eid, { amount: thing.regrow, cap: thing.uses ?? thing.regrow });
    const wear = this.def.wear.find(w => w.tool === thing.kind);
    if (wear) this.wearLeft.set(eid, wear.uses);
    return eid;
  }
  private thingsIn(room: number): number[] { return listDirectContents(this.world, room).filter(e => entityExists(this.world, e) && !!this.kindOf(e)); }
  private usable(eid: number) { return (this.uses.get(eid) ?? 1) > 0; }
  private giveItem(holder: number, kind: string): number {
    const eid = createObjectEntity(this.world, { name: title(kind), roomId: getRoomForEntity(this.world, holder) ?? this.rooms.get("common")!, portable: true });
    ObjectType.typeId[eid] = kind;
    setLocatedIn(this.world, eid, holder);
    const wear = this.def.wear.find(w => w.tool === kind);
    if (wear) this.wearLeft.set(eid, wear.uses);
    return eid;
  }
  /** Things standing or lying in a place (not residents). */
  thingsInPublic(room: number): number[] { return this.thingsIn(room).filter(e => !this.byEid.has(e)); }
  isPortable(eid: number): boolean { return !!PhysicalObject.portable[eid]; }
  manualRecipes(): readonly LandRecipe[] { return this.recipes; }
  hand(eid: number): number[] { return listDirectContents(this.world, eid).filter(e => entityExists(this.world, e)); }
  roomOf(eid: number): number { return getRoomForEntity(this.world, eid)!; }
  stallStock(): Stock {
    const stock: Stock = {};
    for (const e of listDirectContents(this.world, this.stall)) { const k = this.kindOf(e); stock[k] = (stock[k] ?? 0) + 1; }
    return stock;
  }
  resident(name: string): ResidentState | undefined { return this.residents.find(r => r.name === name); }
  alive(): ResidentState[] { return this.residents.filter(r => !r.dead); }

  /** What a resident has: their hand by kind, their coin, and the town's finished buildings. */
  have(eid: number): Stock {
    const stock: Stock = { ...this.builtCount };
    for (const e of this.hand(eid)) { const k = this.kindOf(e); stock[k] = (stock[k] ?? 0) + 1; }
    stock.coin = this.byEid.get(eid)?.coins ?? 0;
    // Progress on the plot this builder is working (their claim, else the most advanced free one).
    for (const s of this.structures) {
      const plot = this.plotFor(s, eid);
      for (const part of (plot === undefined ? [] : this.plotParts.get(plot) ?? [])) stock[`${s.kind}.${part}`] = 1;
    }
    return stock;
  }
  private plotFor(structure: LandStructure, eid: number): number | undefined {
    const plots = [...this.rooms.values()].flatMap(r => this.thingsIn(r)).filter(e => this.kindOf(e) === structure.plot);
    return plots.find(p => this.plotOwner.get(p) === eid)
      ?? plots.filter(p => !this.plotOwner.has(p)).sort((a, b) => (this.plotParts.get(b)?.length ?? 0) - (this.plotParts.get(a)?.length ?? 0))[0];
  }

  // -------------------------------------------------------------------------
  // The Weaver's view
  // -------------------------------------------------------------------------
  manual(): string[] {
    return [...this.recipes.map(r => r.hint!),
      ...this.structures.map(s => `build a ${s.name} on a ${s.plot}, parts in order: ${s.parts.map(p => `${p.part} (${Object.entries(p.needs).map(([k, n]) => `${n} ${k}`).join(" + ")})`).join(", ")}`),
      "sell <item> or buy <item> at the market stall; eat or drink what you hold"];
  }
  placeKinds(): string[] { return [...new Set(this.def.places.map(p => p.kind))]; }
  thingKinds(): string[] { return [...new Set([...this.rooms.values()].flatMap(r => this.thingsIn(r)).filter(e => !PhysicalObject.portable[e]).map(e => this.kindOf(e)))]; }
  obtainableKinds(): string[] {
    const lying = [...this.rooms.values()].flatMap(r => this.thingsIn(r)).filter(e => PhysicalObject.portable[e]).map(e => this.kindOf(e));
    return [...new Set([...lying, ...this.recipes.flatMap(r => Object.keys(r.gives ?? {})), ...this.def.wear.map(w => w.becomes)])];
  }
  apply(patch: WovenPatch): void {
    for (const thing of patch.things) {
      const place = this.def.places.find(p => p.kind === thing.placeKind);
      if (place) this.addThing({ id: `${thing.kind}-${this.now}`, name: thing.name, kind: thing.kind, place: place.id, uses: thing.uses, portable: thing.portable });
    }
    for (const r of patch.recipes) this.recipes.push({ ...r });
    for (const [k, n] of Object.entries(patch.recipes.flatMap(r => Object.keys(r.gives)).reduce((m, k) => ({ ...m, [k]: 2 }), {} as Stock)))
      if (this.def.prices[k] === undefined) this.def.prices[k] = n; // new goods can be traded
  }

  // -------------------------------------------------------------------------
  // What a resident can read
  // -------------------------------------------------------------------------
  observation(eid: number): string {
    const room = this.roomOf(eid), me = this.byEid.get(eid)!;
    const here = this.thingsIn(room).filter(e => e !== eid && !this.byEid.has(e)).map(e => `${Name.value[e]} (${this.kindOf(e)})`);
    const places = [...this.rooms.values()].map(r => {
      const kinds = [...new Set(this.thingsIn(r).filter(e => !this.byEid.has(e) && !PhysicalObject.portable[e]).map(e => this.kindOf(e)))];
      return `${Name.value[r]} (${this.roomPlace.get(r)!.kind}${kinds.length ? `: ${kinds.join(", ")}` : ""})`;
    });
    const hand = Object.entries(this.have(eid)).filter(([k]) => k !== "coin" && !k.includes(".") && !this.builtCount[k]).map(([k, n]) => `${k} ×${n}`);
    const stall = Object.entries(this.stallStock()).map(([k, n]) => `${k} ×${n} @${this.def.prices[k] ?? "?"}`);
    return [
      `You are ${me.name}, ${me.trade}, in ${Name.value[room]}. Here: ${here.join(", ") || "nothing"}.`,
      `Places: ${places.join("; ")}.`,
      `You hold: ${hand.join(", ") || "nothing"}; ${me.coins} coin. Hunger ${Math.round(me.hunger)}/100, thirst ${Math.round(me.thirst)}/100.`,
      `Market stall (Saltmere Common) has: ${stall.join(", ") || "nothing"}. Prices in coin: ${Object.entries(this.def.prices).map(([k, n]) => `${k} ${n}`).join(", ")}.`,
      `Built so far: ${Object.entries(this.builtCount).map(([k, n]) => `${k} ×${n}`).join(", ") || "nothing"}.`,
      `How things are made here: ${this.manual().join("; ")}.`,
    ].join("\n");
  }

  // -------------------------------------------------------------------------
  // Acting on the clock
  // -------------------------------------------------------------------------
  private named(text: string | undefined, among: number[]): number | undefined {
    const wanted = text?.trim().toLowerCase();
    if (!wanted) return undefined;
    const exact = among.find(e => String(Name.value[e] || "").trim().toLowerCase() === wanted);
    if (exact !== undefined) return exact;
    const ofKind = among.filter(e => this.kindOf(e) === wanted || this.kindOf(e) === wanted.replace(/s$/, ""));
    return ofKind.find(e => this.usable(e)) ?? ofKind[0];
  }
  resolveRoom(text: string | undefined): number | undefined {
    const wanted = text?.trim().toLowerCase();
    if (!wanted) return undefined;
    const rooms = [...this.rooms.values()];
    return rooms.find(r => String(Name.value[r]).toLowerCase() === wanted) ?? rooms.find(r => this.roomPlace.get(r)!.kind === wanted);
  }
  private distance(a: number, b: number): number {
    const p = this.roomPlace.get(a)!, q = this.roomPlace.get(b)!;
    return Math.hypot(p.x - q.x, p.y - q.y);
  }
  private note(eid: number, what: string) { this.events.push({ at: this.now, who: Name.value[eid], what }); if (this.events.length > 5000) this.events.shift(); }
  private add(into: Stock, kind: string, n = 1) { into[kind] = (into[kind] ?? 0) + n; }

  /** Start an act; resolves when it completes on the clock. */
  perform(eid: number, action: Act): Promise<ActResult> {
    const me = this.byEid.get(eid);
    if (!me || me.dead) return Promise.resolve({ ok: false, summary: "No one to act." });
    if (this.pending.has(eid)) return Promise.resolve({ ok: false, summary: "Already busy." });
    this.tally.acts++;
    const plan = this.plan(eid, me, action);
    if (!plan.ok) this.tally.failures++;
    return new Promise(resolve => this.pending.set(eid, { end: this.now + (plan.ok ? plan.durationS : FAIL_S),
      finish: plan.ok ? plan.finish : () => plan.result, resolve, label: `${action.verb} ${action.target ?? ""}` }));
  }
  /** Idle for a while (resting, waiting for goods). */
  wait(eid: number, seconds: number): Promise<ActResult> {
    return new Promise(resolve => this.pending.set(eid, { end: this.now + Math.max(1, seconds), finish: () => ({ ok: true, summary: "Waited." }), resolve, label: "wait" }));
  }
  busy(eid: number): boolean { return this.pending.has(eid); }

  private plan(eid: number, me: ResidentState, action: Act): { ok: true; durationS: number; finish: () => ActResult } | { ok: false; result: ActResult } {
    const verb = action.verb.trim().toLowerCase(), arg = String(action.arg ?? "").trim().toLowerCase();
    const fail = (summary: string, extra: Partial<ActResult> = {}) => ({ ok: false as const, result: { ok: false, summary, ...extra } });
    const hand = this.hand(eid), room = this.roomOf(eid);
    if (verb === "move") {
      const to = this.resolveRoom(action.target);
      if (to === undefined) return fail(`There is no place called ${action.target}.`);
      return { ok: true, durationS: Math.max(10, this.distance(room, to) / WALK_MPS), finish: () => { setLocatedIn(this.world, eid, to); return { ok: true, summary: `Walked to ${Name.value[to]}.` }; } };
    }
    if (verb === "eat" || verb === "drink") {
      const item = this.named(action.target || arg || (verb === "drink" ? "water" : ""), hand);
      const food = item === undefined ? undefined : this.def.foods.find(f => f.kind === this.kindOf(item));
      if (item === undefined || !food) return fail(`You hold nothing like that to ${verb}.`);
      setLocatedIn(this.world, item, this.usedUp);
      return { ok: true, durationS: food.durationS, finish: () => {
        me.hunger = Math.max(0, me.hunger - (food.hunger ?? 0)); me.thirst = Math.max(0, me.thirst - (food.thirst ?? 0));
        this.add(this.tally.eaten, food.kind); return { ok: true, summary: `Had the ${food.kind}.` }; } };
    }
    const here = this.thingsIn(room).filter(e => !this.byEid.has(e));
    let target = this.named(action.target, here);
    if (verb === "sell" || verb === "buy") target = this.named(action.target, here) ?? here.find(e => e === this.stall);
    if (target === undefined) {
      const elsewhere = [...this.rooms.values()].find(r => this.named(action.target, this.thingsIn(r).filter(e => !this.byEid.has(e))) !== undefined);
      return fail(`${action.target ?? "That"} is not here${elsewhere !== undefined ? ` (it is in ${Name.value[elsewhere]})` : ""}.`,
        elsewhere !== undefined ? { elsewhere: Name.value[elsewhere] } : {});
    }
    const kind = this.kindOf(target);
    if (verb === "pickup") {
      if (!PhysicalObject.portable[target]) return fail(`${Name.value[target]} cannot be carried.`);
      return { ok: true, durationS: PICKUP_S, finish: () => { setLocatedIn(this.world, target!, eid); return { ok: true, summary: `Picked up ${Name.value[target!]}.` }; } };
    }
    if (verb === "sell" || verb === "buy") {
      if (target !== this.stall) return fail("Trade happens at the market stall.");
      const item = arg || String(action.target ?? "").toLowerCase();
      const price = this.def.prices[item];
      if (price === undefined) return fail(`The stall does not trade ${item}.`);
      if (verb === "sell") {
        const goods = hand.find(e => this.kindOf(e) === item);
        if (goods === undefined) return fail(`You hold no ${item}.`, { missing: { kind: item, count: 1 } });
        if ((this.stallStock()[item] ?? 0) >= this.def.stallCap) return fail(`The stall has enough ${item}.`, { scarce: true });
        // The stall buys at three quarters of its price (its margin keeps the treasury going).
        const paid = Math.max(1, Math.floor(price * 0.75));
        if (this.treasury < paid) return fail("The town cannot pay today.", { scarce: true });
        setLocatedIn(this.world, goods, this.stall);
        return { ok: true, durationS: TRADE_S, finish: () => { me.coins += paid; this.treasury -= paid; this.add(this.tally.sold, item); return { ok: true, summary: `Sold ${item} for ${paid}.` }; } };
      }
      const goods = listDirectContents(this.world, this.stall).find(e => this.kindOf(e) === item);
      if (goods === undefined) return fail(`The stall has no ${item}.`, { scarce: true });
      if (me.coins < price) return fail(`${item} costs ${price}; you have ${me.coins}.`, { scarce: true });
      me.coins -= price; this.treasury += price;
      setLocatedIn(this.world, goods, eid);
      return { ok: true, durationS: TRADE_S, finish: () => { this.add(this.tally.bought, item); return { ok: true, summary: `Bought ${item} for ${price}.` }; } };
    }
    if (verb === "build") {
      const structure = this.structures.find(s => s.plot === kind);
      if (!structure) return fail(`Nothing is built on ${Name.value[target]}.`);
      const done = this.plotParts.get(target) ?? [];
      const next = structure.parts.find(p => !done.includes(p.part));
      const part = structure.parts.find(p => p.part === arg) ?? next;
      if (!part || !next) return { ok: true, durationS: 1, finish: () => ({ ok: true, summary: "Already built." }) };
      const owner = this.plotOwner.get(target);
      if (this.plotBusy.has(target) || (owner !== undefined && owner !== eid && !this.byEid.get(owner)?.dead))
        return fail(`Someone else is building on ${Name.value[target]}.`, { scarce: true });
      if (part !== next) return fail(`Build the ${next.part} first.`, { missing: { kind: `${structure.kind}.${next.part}`, count: 1 } });
      const lack = this.lacking(eid, part.needs);
      if (lack) return fail(`The ${part.part} needs ${lack.count} more ${lack.kind}.`, { missing: lack });
      this.takeItems(eid, part.needs);
      this.plotBusy.add(target); this.plotOwner.set(target, eid);
      return { ok: true, durationS: part.durationS, finish: () => {
        this.plotBusy.delete(target!);
        const parts = [...(this.plotParts.get(target!) ?? []), part.part];
        this.plotParts.set(target!, parts);
        me.coins += Math.min(this.def.buildPay, this.treasury); this.treasury = Math.max(0, this.treasury - this.def.buildPay);
        if (parts.length === structure.parts.length) {
          this.add(this.builtCount, structure.kind);
          ObjectType.typeId[target!] = structure.becomes;
          Name.value[target!] = `${structure.name} ${this.builtCount[structure.kind]}`;
          this.plotParts.delete(target!); this.plotOwner.delete(target!);
          this.add(this.tally.built, structure.kind);
          this.note(eid, `finished the ${structure.name.toLowerCase()}`);
          return { ok: true, summary: `Built the ${part.part}: the ${structure.name} is finished.` };
        }
        return { ok: true, summary: `Built the ${part.part} of the ${structure.name.toLowerCase()}.` };
      } };
    }
    const recipe = this.recipes.find(r => r.verb === verb && r.at === kind && (!r.product || !arg || r.product === arg || Object.keys(r.gives).includes(arg)));
    if (!recipe) {
      const options = this.recipes.filter(r => r.at === kind).map(r => `${r.verb}${r.product ? ` ${r.product}` : ""}`);
      return fail(`You can't ${verb} at ${Name.value[target]}.${options.length ? ` Here you can: ${options.join(", ")}.` : ""}`);
    }
    if (recipe.spends && !this.usable(target)) return fail(`${Name.value[target]} is spent for now.`, { scarce: true });
    const lack = this.lacking(eid, recipe.needs, recipe.tools);
    if (lack) return fail(`To ${verb}${recipe.product ? ` ${recipe.product}` : ""} you need ${lack.count} more ${lack.kind}.`, { missing: lack });
    this.takeItems(eid, recipe.needs ?? {});
    if (recipe.spends && this.uses.has(target)) this.uses.set(target, this.uses.get(target)! - 1);
    return { ok: true, durationS: recipe.durationS ?? 120, finish: () => {
      for (const [k, n] of Object.entries(recipe.gives)) { for (let i = 0; i < n; i++) this.giveItem(eid, k); this.add(this.tally.made, k, n); }
      for (const tool of recipe.tools ?? []) this.wearTool(eid, tool);
      return { ok: true, summary: `${title(verb)}: got ${Object.entries(recipe.gives).map(([k, n]) => `${n} ${k}`).join(", ")}.`, used: [...(recipe.tools ?? [])] };
    } };
  }
  private lacking(eid: number, needs: Stock = {}, tools: readonly string[] = []): ActResult["missing"] {
    const have = this.have(eid);
    for (const tool of tools) if (!(have[tool] > 0)) return { kind: tool, count: 1 };
    for (const [k, n] of Object.entries(needs)) if ((have[k] ?? 0) < n) return { kind: k, count: n - (have[k] ?? 0) };
    return undefined;
  }
  private takeItems(eid: number, needs: Stock) {
    for (const [k, n] of Object.entries(needs)) for (const e of this.hand(eid).filter(e => this.kindOf(e) === k).slice(0, n)) setLocatedIn(this.world, e, this.usedUp);
  }
  private wearTool(eid: number, tool: string) {
    const wear = this.def.wear.find(w => w.tool === tool);
    const item = this.hand(eid).find(e => this.kindOf(e) === tool);
    if (!wear || item === undefined) return;
    const left = (this.wearLeft.get(item) ?? wear.uses) - 1;
    this.wearLeft.set(item, left);
    if (left <= 0) { ObjectType.typeId[item] = wear.becomes; Name.value[item] = title(wear.becomes); this.note(eid, `${tool} wore out`); }
  }

  // -------------------------------------------------------------------------
  // The clock
  // -------------------------------------------------------------------------
  nextEventAt(): number | undefined {
    let next: number | undefined;
    for (const p of this.pending.values()) if (next === undefined || p.end < next) next = p.end;
    return next;
  }
  /** Everyone alive is busy or waiting (so the clock may move). */
  allBlocked(): boolean { return this.alive().every(r => this.pending.has(r.eid)); }

  advanceTo(t: number): void {
    const dt = Math.max(0, t - this.now);
    const dayBefore = Math.floor(this.now / DAY_S);
    this.now = t;
    const n = this.def.needs;
    for (const r of this.alive()) {
      r.hunger = Math.min(100, r.hunger + n.hungerPerHour * dt / 3600);
      r.thirst = Math.min(100, r.thirst + n.thirstPerHour * dt / 3600);
      if (r.hunger >= 100 || r.thirst >= 100) {
        r.starvingSince ??= t;
        if (t - r.starvingSince >= n.collapseHours * 3600) {
          r.dead = true; r.diedAt = t; r.causeOfDeath = r.thirst >= 100 ? "thirst" : "hunger";
          Agent.active[r.eid] = false;
          this.note(r.eid, `collapsed from ${r.causeOfDeath} (coin ${r.coins}, stall ${JSON.stringify(this.stallStock())}, hand ${JSON.stringify(this.have(r.eid))})`);
          const p = this.pending.get(r.eid);
          if (p) { this.pending.delete(r.eid); p.resolve({ ok: false, summary: "Collapsed." }); }
        }
      } else r.starvingSince = undefined;
    }
    // Each morning: brambles fruit again, the wood grows back a little.
    if (Math.floor(t / DAY_S) > dayBefore) {
      for (const [eid, g] of this.regrow) this.uses.set(eid, Math.min(g.cap, (this.uses.get(eid) ?? 0) + g.amount));
      for (const r of this.alive()) { const share = Math.min(this.def.dailyShare, this.treasury); r.coins += share; this.treasury -= share; }
    }
    for (const [eid, p] of [...this.pending.entries()].sort((a, b) => a[1].end - b[1].end)) {
      if (p.end > t) continue;
      this.pending.delete(eid);
      p.resolve(this.byEid.get(eid)?.dead ? { ok: false, summary: "Collapsed." } : p.finish());
    }
  }

  // -------------------------------------------------------------------------
  // A resident's skill environment
  // -------------------------------------------------------------------------
  envFor(eid: number): SkillEnv {
    const self = this;
    const bind = (ref: Ref): string | undefined => {
      const room = self.roomOf(eid);
      if ("thing" in ref) {
        const claimedByOther = (e: number) => self.plotOwner.has(e) && self.plotOwner.get(e) !== eid && !self.byEid.get(self.plotOwner.get(e)!)?.dead;
        const found = self.thingsIn(room).filter(e => !self.byEid.has(e) && self.kindOf(e) === ref.thing && self.usable(e) && !self.plotBusy.has(e) && !claimedByOther(e))
          .sort((a, b) => Number(self.plotOwner.get(b) === eid) - Number(self.plotOwner.get(a) === eid)
            || (self.plotParts.get(b)?.length ?? 0) - (self.plotParts.get(a)?.length ?? 0))[0];
        return found === undefined ? undefined : Name.value[found];
      }
      const kind = "where" in ref ? ref.where : undefined;
      const rooms = [...self.rooms.values()].sort((a, b) => self.distance(room, a) - self.distance(room, b));
      const r = kind ? rooms.find(r => self.thingsIn(r).some(e => self.kindOf(e) === kind && self.usable(e)))
        : rooms.find(r => self.roomPlace.get(r)!.kind === (ref as { place: string }).place);
      return r === undefined ? undefined : Name.value[r];
    };
    return {
      have: () => self.have(eid),
      act: action => self.perform(eid, action),
      observation: () => self.observation(eid),
      bind,
      approach: async ref => {
        if (!("thing" in ref)) return false;
        if (bind(ref)) return true;
        const place = bind({ where: ref.thing });
        return place ? (await self.perform(eid, { verb: "move", target: place })).ok : false;
      },
      abstract: (action, next) => {
        const verb = action.verb.trim().toLowerCase(), arg = action.arg?.trim() ? { arg: action.arg.trim().toLowerCase() } : {};
        const all = [...self.rooms.values()].flatMap(r => self.thingsIn(r)).filter(e => !self.byEid.has(e));
        if (verb === "move") {
          const room = self.resolveRoom(action.target);
          const following = next && next.verb !== "move" ? self.named(next.target, room === undefined ? [] : self.thingsIn(room)) : undefined;
          if (following !== undefined) return { verb, target: { where: self.kindOf(following) } };
          return { verb, ...(room !== undefined ? { target: { place: self.roomPlace.get(room)!.kind } } : {}) };
        }
        const target = self.named(action.target, self.thingsIn(self.roomOf(eid)).concat(self.hand(eid))) ?? self.named(action.target, all);
        return { verb, ...(target !== undefined ? { target: { thing: self.kindOf(target) } } : {}), ...arg };
      },
      unsolvable: kind => kind === "coin",
      now: () => self.now,
    };
  }
}
