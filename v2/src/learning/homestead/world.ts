/** The homestead world in the real ECS: places are rooms, things and items are
 * object entities (kind = ObjectType.typeId), a resident's hand is what is
 * located in them. Its verbs are data (recipes.ts); this executor checks what
 * each needs and reports exactly what is missing, so a resident can learn what
 * a skill needs and gives from what actually happened. */
import { entityExists } from "bitecs";
import { createArgosWorld, type World } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createObjectEntity, createRoomEntity } from "../../ecs/prefabs";
import { Name, ObjectType, PhysicalObject } from "../../ecs/components";
import { getRoomForEntity, listDirectContents, setLocatedIn } from "../../ecs/location";
import { startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import type { HomesteadDef, RecipeDef, Stock, StructureDef } from "./recipes";
import type { Ref } from "../skill-graph";
import type { SkillEnv } from "../skill-runtime";
import type { RecipeWorld, WovenPatch } from "../../spirits/recipe-weaver";

export type Act = { verb: string; target?: string; arg?: string };
export type ActResult = {
  ok: boolean; summary: string;
  /** What was lacking: the kind and how many more were needed. */
  missing?: { kind: string; count: number };
  /** Held tools and standing facts the act relied on (not consumed). */
  used?: string[];
  /** The target stands in another place (walk there and try again). */
  elsewhere?: string;
  /** It failed for want of goods, not of knowing how (a spent source, an empty stall, no coin). */
  scarce?: boolean;
};

const title = (kind: string) => kind.charAt(0).toUpperCase() + kind.slice(1);

export class Homestead implements SkillEnv, RecipeWorld {
  readonly world: World;
  readonly resident: number;
  readonly rooms = new Map<string, number>();       // place id -> room
  readonly placeKinds_ = new Map<number, string>();  // room -> place kind
  private readonly uses = new Map<number, number>(); // thing -> uses left
  /** Structure facts: "cabin.foundation", "cabin". */
  readonly facts = new Set<string>();
  private readonly recipes: RecipeDef[];
  private readonly structures: StructureDef[];
  steps = 0;

  constructor(readonly def: HomesteadDef, residentName = "Wren") {
    this.world = createArgosWorld(`Homestead ${def.id}`);
    initializePrefabs(this.world);
    startCommittedEvents(this.world);
    this.world.meta.aiEnabled = false;
    this.usedUp = createRoomEntity(this.world, { name: "(used up)", description: "Outside the world: consumed materials." });
    for (const place of def.places) {
      const room = createRoomEntity(this.world, { name: place.name, description: place.description });
      this.rooms.set(place.id, room); this.placeKinds_.set(room, place.kind);
    }
    for (const thing of def.things) {
      const eid = createObjectEntity(this.world, { name: thing.name, roomId: this.rooms.get(thing.place)!, portable: !!thing.portable });
      ObjectType.typeId[eid] = thing.kind;
      if (thing.uses !== undefined) this.uses.set(eid, thing.uses);
    }
    this.recipes = def.recipes.map(r => ({ ...r }));
    this.structures = def.structures.map(s => ({ ...s, parts: s.parts.map(p => ({ ...p })) }));
    this.resident = createAgentEntity(this.world, { name: residentName, role: "homesteader", systemPrompt: `You are ${residentName}, making a life on new land.`,
      roomId: this.rooms.get(def.start)! });
  }

  stop(): void { stopCommittedEvents(this.world); }

  // -------------------------------------------------------------------------
  // Growth: the world can gain recipes, things and structures while running.
  // -------------------------------------------------------------------------
  addRecipe(recipe: RecipeDef): void { this.recipes.push({ ...recipe }); }
  addThing(thing: HomesteadDef["things"][number]): number {
    const eid = createObjectEntity(this.world, { name: thing.name, roomId: this.rooms.get(thing.place)!, portable: !!thing.portable });
    ObjectType.typeId[eid] = thing.kind;
    if (thing.uses !== undefined) this.uses.set(eid, thing.uses);
    return eid;
  }
  // RecipeWorld: what the Weaver reads, and how it grows this land.
  placeKinds(): string[] { return [...new Set(this.placeKinds_.values())]; }
  thingKinds(): string[] {
    return [...new Set([...this.rooms.values()].flatMap(r => listDirectContents(this.world, r)).filter(e => !PhysicalObject.portable[e]).map(e => this.kindOf(e)).filter(Boolean))];
  }
  obtainableKinds(): string[] {
    const lying = [...this.rooms.values()].flatMap(r => listDirectContents(this.world, r)).filter(e => PhysicalObject.portable[e]).map(e => this.kindOf(e));
    return [...new Set([...lying, ...this.recipes.flatMap(r => Object.keys(r.gives ?? {}))].filter(Boolean))];
  }
  apply(patch: WovenPatch): void {
    for (const thing of patch.things) {
      const place = this.def.places.find(p => p.kind === thing.placeKind);
      if (place) this.addThing({ id: `${thing.kind}-${this.steps}`, name: thing.name, kind: thing.kind, place: place.id, uses: thing.uses, portable: thing.portable });
    }
    for (const recipe of patch.recipes) this.addRecipe(recipe);
  }
  recipesView(): readonly RecipeDef[] { return this.recipes; }
  structuresView(): readonly StructureDef[] { return this.structures; }
  addStructure(structure: StructureDef): void { this.structures.push({ ...structure, parts: structure.parts.map(p => ({ ...p })) }); }

  // -------------------------------------------------------------------------
  // Reading the world (what a resident can know)
  // -------------------------------------------------------------------------
  kindOf(eid: number): string { return String(ObjectType.typeId[eid] || ""); }
  room(): number { return getRoomForEntity(this.world, this.resident)!; }
  placeKind(room = this.room()): string { return this.placeKinds_.get(room) ?? ""; }
  hand(): number[] { return listDirectContents(this.world, this.resident).filter(eid => entityExists(this.world, eid)); }
  /** Items in hand by kind, plus standing facts (built parts, finished structures). */
  have(): Stock {
    const stock: Stock = {};
    for (const eid of this.hand()) { const kind = this.kindOf(eid); stock[kind] = (stock[kind] ?? 0) + 1; }
    for (const fact of this.facts) stock[fact] = 1;
    return stock;
  }
  count(kind: string): number { return this.have()[kind] ?? 0; }
  thingsHere(): number[] {
    return listDirectContents(this.world, this.room()).filter(eid => eid !== this.resident && entityExists(this.world, eid) && !!this.kindOf(eid));
  }
  usesLeft(eid: number): number | undefined { return this.uses.get(eid); }
  /** Everything a resident may read: where they are, what is here, the places, their hand, and the world's manual. */
  observation(): string {
    const here = this.thingsHere().map(eid => `${Name.value[eid]} (${this.kindOf(eid)}${this.uses.has(eid) ? `, ${this.uses.get(eid)} left` : ""})`);
    const places = [...this.rooms.entries()].map(([, room]) => `${Name.value[room]} (${this.placeKinds_.get(room)})`);
    const have = Object.entries(this.have()).map(([k, n]) => `${k} ×${n}`);
    return [
      `You are in ${Name.value[this.room()]} (${this.placeKind()}). Here: ${here.join(", ") || "nothing"}.`,
      `Places: ${places.join(", ")}.`,
      `You have: ${have.join(", ") || "nothing"}.`,
      `How things are made here: ${this.manual().join("; ")}.`,
    ].join("\n");
  }
  manual(): string[] {
    return [...this.recipes.map(r => r.hint), ...this.structures.flatMap(s => [`${s.name} at a ${s.site}:`, ...s.parts.map(p => p.hint)]),
      "pickup a portable thing; move to a place"];
  }

  // -------------------------------------------------------------------------
  // Skill environment: kinds of things and places, bound to this land
  // -------------------------------------------------------------------------
  private usable(eid: number): boolean { return entityExists(this.world, eid) && (this.uses.get(eid) ?? 1) > 0; }
  private roomsWith(kind: string): number[] {
    const here = this.room();
    return [...this.rooms.values()].filter(room => listDirectContents(this.world, room).some(eid => this.kindOf(eid) === kind && this.usable(eid)))
      .sort((a, b) => (a === here ? -1 : b === here ? 1 : 0));
  }
  bind(ref: Ref): string | undefined {
    if ("thing" in ref) {
      const eid = this.thingsHere().find(id => this.kindOf(id) === ref.thing && this.usable(id));
      return eid === undefined ? undefined : Name.value[eid];
    }
    if ("where" in ref) { const room = this.roomsWith(ref.where)[0]; return room === undefined ? undefined : Name.value[room]; }
    const room = this.placeKind() === ref.place ? this.room() : [...this.rooms.values()].find(r => this.placeKinds_.get(r) === ref.place);
    return room === undefined ? undefined : Name.value[room];
  }
  approach(ref: Ref): boolean {
    if (!("thing" in ref)) return false;
    if (this.bind(ref)) return true;
    const room = this.roomsWith(ref.thing)[0];
    if (room === undefined) return false;
    return this.act({ verb: "move", target: Name.value[room] }).ok;
  }
  private anywhere(name: string | undefined): number | undefined {
    const wanted = name?.trim().toLowerCase();
    if (!wanted) return undefined;
    const here = this.thingsHere().concat(this.hand());
    const all = [...this.rooms.values()].flatMap(room => listDirectContents(this.world, room)).concat(this.hand());
    return this.named(wanted, here) ?? this.named(wanted, all);
  }
  abstract(action: Act, next?: Act): { verb: string; target?: Ref; arg?: string } {
    const verb = action.verb.trim().toLowerCase(), arg = action.arg?.trim() ? { arg: action.arg.trim().toLowerCase() } : {};
    if (verb === "move") {
      const room = this.resolveRoom(action.target);
      const following = next && next.verb !== "move" ? this.anywhere(next.target) : undefined;
      if (following !== undefined && room !== undefined && listDirectContents(this.world, room).includes(following)) return { verb, target: { where: this.kindOf(following) } };
      return { verb, ...(room !== undefined ? { target: { place: this.placeKinds_.get(room)! } } : {}) };
    }
    const target = this.anywhere(action.target);
    return { verb, ...(target !== undefined ? { target: { thing: this.kindOf(target) } } : {}), ...arg };
  }

  // -------------------------------------------------------------------------
  // Acting
  // -------------------------------------------------------------------------
  /** A thing by its name, or else by its kind ("tree" means a tree), preferring one not spent. */
  private named(name: string | undefined, among: number[]): number | undefined {
    const wanted = name?.trim().toLowerCase();
    if (!wanted) return undefined;
    const exact = among.find(eid => String(Name.value[eid] || "").trim().toLowerCase() === wanted);
    if (exact !== undefined) return exact;
    const ofKind = among.filter(eid => this.kindOf(eid) === wanted || this.kindOf(eid) === wanted.replace(/s$/, ""));
    return ofKind.find(eid => this.usable(eid)) ?? ofKind[0];
  }
  /** A place by its name or its kind. */
  resolveRoom(text: string | undefined): number | undefined {
    const wanted = text?.trim().toLowerCase();
    if (!wanted) return undefined;
    const rooms = [...this.rooms.values()];
    return rooms.find(r => String(Name.value[r]).toLowerCase() === wanted) ?? rooms.find(r => this.placeKinds_.get(r) === wanted);
  }
  /** Used up: consumed items go to a sink outside the land (entity ids are not
   * recycled mid-life, which bitecs relations do not tolerate well). */
  private readonly usedUp: number;
  private take(kind: string, count: number): void {
    for (const eid of this.hand().filter(eid => this.kindOf(eid) === kind).slice(0, count)) setLocatedIn(this.world, eid, this.usedUp);
  }
  private give(stock: Stock): void {
    for (const [kind, count] of Object.entries(stock)) for (let i = 0; i < count; i++) {
      const eid = createObjectEntity(this.world, { name: title(kind), roomId: this.room(), portable: true });
      ObjectType.typeId[eid] = kind;
      setLocatedIn(this.world, eid, this.resident);
    }
  }
  private lacking(needs: Stock | undefined, tools: readonly string[] = []): ActResult["missing"] {
    const have = this.have();
    for (const tool of tools) if (!(have[tool] > 0)) return { kind: tool, count: 1 };
    for (const [kind, count] of Object.entries(needs ?? {})) if ((have[kind] ?? 0) < count) return { kind, count: count - (have[kind] ?? 0) };
    return undefined;
  }

  act(action: Act): ActResult {
    this.steps++;
    const verb = action.verb.trim().toLowerCase();
    if (verb === "move") {
      const room = this.resolveRoom(action.target);
      if (room === undefined) return { ok: false, summary: `There is no place called ${action.target}.` };
      setLocatedIn(this.world, this.resident, room);
      return { ok: true, summary: `Walked to ${Name.value[room]}.` };
    }
    const target = this.named(action.target, this.thingsHere());
    if (target === undefined) {
      const room = [...this.rooms.values()].find(r => this.named(action.target, listDirectContents(this.world, r)) !== undefined);
      return { ok: false, summary: `${action.target ?? "That"} is not here${room !== undefined ? ` (it is in ${Name.value[room]})` : ""}.`,
        ...(room !== undefined ? { elsewhere: Name.value[room] } : {}) };
    }
    const kind = this.kindOf(target);
    if (verb === "pickup") {
      if (!PhysicalObject.portable[target]) return { ok: false, summary: `${Name.value[target]} cannot be carried.` };
      setLocatedIn(this.world, target, this.resident);
      return { ok: true, summary: `Picked up ${Name.value[target]}.` };
    }
    if (verb === "build") {
      const wanted = String(action.arg || "").trim().toLowerCase();
      const here = this.structures.filter(s => s.site === kind);
      const structure = here.find(s => s.parts.some(p => p.part === wanted)) ?? here[0];
      if (!structure) return { ok: false, summary: `Nothing is built at ${Name.value[target]}.` };
      const index = structure.parts.findIndex(p => p.part === String(action.arg || "").trim().toLowerCase());
      if (index < 0) return { ok: false, summary: `A ${structure.name} has no part "${action.arg}". Parts: ${structure.parts.map(p => p.part).join(", ")}.` };
      const part = structure.parts[index], fact = `${structure.kind}.${part.part}`;
      if (this.facts.has(fact)) return { ok: true, summary: `The ${part.part} is already built.` };
      const before = structure.parts[index - 1];
      if (before && !this.facts.has(`${structure.kind}.${before.part}`))
        return { ok: false, summary: `Build the ${before.part} first.`, missing: { kind: `${structure.kind}.${before.part}`, count: 1 } };
      const missing = this.lacking(part.needs);
      if (missing) return { ok: false, summary: `Building the ${part.part} needs ${missing.count} more ${missing.kind}.`, missing };
      for (const [k, n] of Object.entries(part.needs)) this.take(k, n);
      this.facts.add(fact);
      const done = structure.parts.every(p => this.facts.has(`${structure.kind}.${p.part}`));
      if (done) this.facts.add(structure.kind);
      return { ok: true, summary: `Built the ${part.part}${done ? `: the ${structure.name} is finished` : ""}.`, used: before ? [`${structure.kind}.${before.part}`] : [] };
    }
    const product = String(action.arg || "").trim().toLowerCase();
    const recipe = this.recipes.find(r => r.verb === verb && r.at === kind && (!r.product || r.product === product));
    if (!recipe) {
      const options = this.recipes.filter(r => r.at === kind).map(r => `${r.verb}${r.product ? ` ${r.product}` : ""}`);
      return { ok: false, summary: `You can't ${verb}${product ? ` ${product}` : ""} at ${Name.value[target]}.${options.length ? ` Here you can: ${options.join(", ")}.` : ""}` };
    }
    if (recipe.spends && (this.uses.get(target) ?? 1) <= 0) return { ok: false, summary: `${Name.value[target]} is spent.` };
    const missing = this.lacking(recipe.needs, recipe.tools);
    if (missing) return { ok: false, summary: `To ${verb}${recipe.product ? ` ${recipe.product}` : ""} you need ${missing.count} more ${missing.kind}.`, missing };
    for (const [k, n] of Object.entries(recipe.needs ?? {})) this.take(k, n);
    if (recipe.spends && this.uses.has(target)) this.uses.set(target, this.uses.get(target)! - 1);
    this.give(recipe.gives ?? {});
    return { ok: true, summary: `${title(verb)}${recipe.product ? ` ${recipe.product}` : ""} at ${Name.value[target]}: got ${Object.entries(recipe.gives ?? {}).map(([k, n]) => `${n} ${k}`).join(", ")}.`,
      used: [...(recipe.tools ?? [])] };
  }
}
