/** The balance spirits in the walkable settlement: the same Watcher,
 * Lawgiver, Steward and Weaver as the headless town (learning/settlement/
 * balance-spirits.ts), reading this world through an adapter. Game time is
 * the settlement clock (a game day per real hour by default), so readings,
 * idleness and "moved today" are in game seconds. Each dawn: the treasury
 * pays the daily share, sources grow back, and the spirits read yesterday and
 * act; through the day, watches let the Steward act on a clear food crisis. */
import { Name, Needs } from "../ecs/components";
import type { World } from "../ecs/world";
import { BalanceSpirits, type BalanceLife, type BalanceResident, type GrowableBalanceTown, type Intervention } from "../learning/settlement/balance-spirits";
import type { LandDef } from "../learning/settlement/saltmere-land";
import type { SkillGraph } from "../learning/skill-graph";
import type { WovenPatch, WeaverGenerator, WeaverStats } from "../spirits/recipe-weaver";
import type { createSpatialRecipes } from "./spatial-recipes";
import type { SpatialTradeLife } from "./spatial-trade-life";

export type SpatialBalanceHost = {
  world: World; land: LandDef;
  recipes: ReturnType<typeof createSpatialRecipes>;
  lives(): SpatialTradeLife[];
  graphFor(trade: string): SkillGraph;
  /** Real milliseconds per game day. */
  dayMs(): number;
  /** Hunger per game hour as residents actually feel it here. */
  hungerPerGameHour(): number;
  realNow(): number;
  /** Give a resident a trade's tools (from what lies about or the stall). */
  equip(eid: number, trade: string): string[];
  /** Weaver hooks (the walkable world as a RecipeWorld). */
  manual(): string[]; placeKinds(): string[]; thingKinds(): string[]; obtainableKinds(): string[]; apply(patch: WovenPatch): void;
  conditionKinds?(): string[];
  /** Sources that grow back each morning. */
  regrowing(): Array<{ eid: number; regrow?: number; cap?: number }>;
  record(line: string): void;
};

export function createSpatialBalance(host: SpatialBalanceHost, options: { weave?: "gemini" | { generate: WeaverGenerator }; weaverStats?: WeaverStats } = {}) {
  const gameSeconds = (realMs: number) => realMs / 1000 * 86_400_000 / host.dayMs();
  const residentOf = (life: SpatialTradeLife): BalanceResident => ({
    eid: life.eid, get trade() { return life.trade; }, get hunger() { return Needs.hunger[life.eid] ?? 0; },
    get coins() { return host.recipes.coinsOf(life.eid); }, get idleS() { return gameSeconds(life.idleMs); } });
  const residents = () => host.lives().map(residentOf);
  // The spirits' accounting uses this world's actual hunger pace; prices and the share stay the land's own (shared objects).
  const def = new Proxy(host.land, { get: (land, key) => key === "needs" ? { ...land.needs, hungerPerHour: host.hungerPerGameHour() } : Reflect.get(land, key) });
  const town: GrowableBalanceTown = {
    world: host.world, def, get tally() { return host.recipes.tally as any; },
    get treasury() { return host.recipes.treasury(); }, set treasury(_v: number) { /* the purse moves only through trades and shares */ },
    get now() { return gameSeconds(host.realNow()); }, get builtCount() { return host.recipes.builtCount(); },
    get residents() { return residents(); }, alive: () => residents(),
    sourceReserves: () => host.recipes.sourceReserves(), equip: host.equip,
    manual: host.manual, placeKinds: host.placeKinds, thingKinds: host.thingKinds, obtainableKinds: host.obtainableKinds, apply: host.apply,
    ...(host.conditionKinds ? { conditionKinds: host.conditionKinds } : {}),
  };
  const lives = (): BalanceLife[] => host.lives().map(life => ({ me: { eid: life.eid, get trade() { return life.trade; }, name: Name.value[life.eid] },
    changeTrade: (trade: string) => life.changeTrade(trade, host.graphFor(trade)),
    press: (reason: string) => life.press(host.dayMs(), reason) }));
  const spirits = new BalanceSpirits(town, lives, { weave: options.weave, weaverStats: options.weaverStats });
  let lastDay = Math.floor(host.realNow() / host.dayMs()), lastWatch = Math.floor(host.realNow() / (host.dayMs() / 4));
  let busy = false;
  return {
    spirits,
    interventions: (): readonly Intervention[] => spirits.interventions,
    /** Call each tick. Dawn once a game day; a watch every quarter day. */
    tick(isNight: boolean): void {
      if (busy) return;
      const day = Math.floor(host.realNow() / host.dayMs()), watch = Math.floor(host.realNow() / (host.dayMs() / 4));
      if (day > lastDay) {
        lastDay = day; lastWatch = watch;
        for (const life of host.lives()) host.recipes.grant(life.eid, host.land.dailyShare);
        host.recipes.regrow(host.regrowing());
        busy = true;
        void spirits.dawn(day).then(done => { for (const i of done.filter(x => x.spirit !== "Watcher")) host.record(`${i.spirit}: ${i.what}`); })
          .catch(() => undefined).finally(() => { busy = false; });
        return;
      }
      if (watch > lastWatch) {
        lastWatch = watch;
        if (!isNight) for (const i of spirits.watch(day + 1)) host.record(`${i.spirit}: ${i.what}`);
      }
    },
  };
}
