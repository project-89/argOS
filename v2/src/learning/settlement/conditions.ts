/** Body conditions: what something consumed does to a person for a while —
 * drink going to your head, a bitter tea that makes you sleepy. Defined as land
 * data (the Weaver may add them), enforced in code: a condition rises when its
 * food or drink is consumed, wears off by the game hour, and its effects come
 * from a fixed vocabulary the world applies itself —
 *
 * - work:      how fast crafts go (−0.6 … +0.3 at full strength)
 * - walk:      how fast they walk (−0.6 … +0.3)
 * - attention: how readily they look up when something happens (−0.6 … +0.6)
 *
 * At a level, the effect is 1 + effect × level. Crossing into "mild" (≥ 0.2)
 * or "strong" (≥ 0.6), or back to nothing, is what the person feels and is told;
 * the model never has to be asked to act drunk. Pure bookkeeping. */

export type ConditionEffect = "work" | "walk" | "attention";
export type LandCondition = {
  kind: string; name: string;
  /** Level lost per game hour (levels run 0..1). */
  wearsOffPerHour: number;
  effects: Partial<Record<ConditionEffect, number>>;
  /** What it is called at each stage (for the viewer and the town's talk), and how it feels. */
  labels: { mild: string; strong: string };
  feels: { mild: string; strong: string; gone: string };
};
export type ConditionStage = "none" | "mild" | "strong";
export type ConditionCrossing = { actor: number; kind: string; from: ConditionStage; to: ConditionStage; level: number };

export const EFFECT_BOUNDS: Record<ConditionEffect, [number, number]> = { work: [-.6, .3], walk: [-.6, .3], attention: [-.6, .6] };
const KIND = /^[a-z][a-z-]{1,23}$/;
export const stageOf = (level: number): ConditionStage => level >= .6 ? "strong" : level >= .2 ? "mild" : "none";

/** Check a condition someone (a spirit) proposed; effects outside the vocabulary or its bounds are refused. */
export function validateCondition(raw: unknown): { ok: true; condition: LandCondition } | { ok: false; reason: string } {
  const v = raw as any;
  const kind = String(v?.kind ?? "").trim().toLowerCase(), name = String(v?.name ?? "").trim().slice(0, 30);
  if (!KIND.test(kind) || !name) return { ok: false, reason: `bad condition ${JSON.stringify(v)?.slice(0, 120)}` };
  const wearsOffPerHour = Number(v.wearsOffPerHour);
  if (!(wearsOffPerHour >= .02 && wearsOffPerHour <= 1)) return { ok: false, reason: "a condition wears off by 0.02–1 per game hour" };
  const effects: LandCondition["effects"] = {};
  for (const [effect, value] of Object.entries(v.effects ?? {})) {
    const bounds = EFFECT_BOUNDS[effect as ConditionEffect];
    if (!bounds) return { ok: false, reason: `unknown effect "${effect}" (effects: ${Object.keys(EFFECT_BOUNDS).join(", ")})` };
    const n = Number(value);
    if (!(n >= bounds[0] && n <= bounds[1])) return { ok: false, reason: `${effect} must be within ${bounds[0]}…${bounds[1]}` };
    if (n !== 0) effects[effect as ConditionEffect] = n;
  }
  if (!Object.keys(effects).length) return { ok: false, reason: "a condition must do something (work, walk or attention)" };
  const text = (s: unknown, max: number) => String(s ?? "").trim().slice(0, max);
  const labels = { mild: text(v.labels?.mild, 20), strong: text(v.labels?.strong, 20) };
  const feels = { mild: text(v.feels?.mild, 160), strong: text(v.feels?.strong, 160), gone: text(v.feels?.gone, 160) };
  if (!labels.mild || !labels.strong || !feels.mild || !feels.strong || !feels.gone) return { ok: false, reason: "a condition needs labels (mild, strong) and feels (mild, strong, gone)" };
  return { ok: true, condition: { kind, name, wearsOffPerHour, effects, labels, feels } };
}

export class ConditionTracker {
  private readonly levels = new Map<number, Map<string, number>>();
  constructor(private readonly definitions: () => readonly LandCondition[]) {}
  private def(kind: string) { return this.definitions().find(c => c.kind === kind); }

  /** Consuming raises a condition; returns the crossing if its stage changed. */
  add(actor: number, kind: string, amount: number): ConditionCrossing | undefined {
    if (!this.def(kind) || !(amount > 0)) return undefined;
    const mine = this.levels.get(actor) ?? new Map<string, number>(); this.levels.set(actor, mine);
    const before = mine.get(kind) ?? 0, after = Math.min(1, before + amount);
    mine.set(kind, after);
    return stageOf(before) !== stageOf(after) ? { actor, kind, from: stageOf(before), to: stageOf(after), level: after } : undefined;
  }
  /** Game hours pass: every condition wears off; returns the stage changes. */
  wearOff(gameHours: number): ConditionCrossing[] {
    const out: ConditionCrossing[] = [];
    if (!(gameHours > 0)) return out;
    for (const [actor, mine] of this.levels) for (const [kind, before] of mine) {
      const rate = this.def(kind)?.wearsOffPerHour ?? 1, after = Math.max(0, before - rate * gameHours);
      if (after <= 0) mine.delete(kind); else mine.set(kind, after);
      if (stageOf(before) !== stageOf(after)) out.push({ actor, kind, from: stageOf(before), to: stageOf(after), level: after });
    }
    return out;
  }
  level(actor: number, kind: string): number { return this.levels.get(actor)?.get(kind) ?? 0; }
  /** The multiplier on one effect from everything they are under (1 = unaffected). */
  factor(actor: number, effect: ConditionEffect): number {
    let f = 1;
    for (const [kind, level] of this.levels.get(actor) ?? []) f *= 1 + (this.def(kind)?.effects[effect] ?? 0) * level;
    return Math.max(.2, f);
  }
  /** What shows on them now ("tipsy"), strongest first. */
  labelOf(actor: number): string | undefined {
    const shown = [...(this.levels.get(actor) ?? [])].map(([kind, level]) => ({ def: this.def(kind), level, stage: stageOf(level) }))
      .filter(c => c.def && c.stage !== "none").sort((a, b) => b.level - a.level)[0];
    return shown ? shown.def!.labels[shown.stage as "mild" | "strong"] : undefined;
  }
  /** What a crossing feels like, for the person's own perception. */
  feeling(crossing: ConditionCrossing): string | undefined {
    const def = this.def(crossing.kind); if (!def) return undefined;
    return crossing.to === "none" ? def.feels.gone : def.feels[crossing.to];
  }
  of(actor: number): Record<string, number> { return Object.fromEntries(this.levels.get(actor) ?? []); }
  restore(actor: number, levels: Record<string, number>): void {
    const mine = new Map<string, number>();
    for (const [kind, level] of Object.entries(levels)) if (this.def(kind) && level > 0) mine.set(kind, Math.min(1, level));
    if (mine.size) this.levels.set(actor, mine);
  }
}
