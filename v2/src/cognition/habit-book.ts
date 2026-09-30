/** Habits: what a fast judge keeps deciding the same way becomes a habit, and
 * a habit is done without asking.
 *
 * The judge (Jev) is cheap but not free, and the full mind is dear. Every
 * routine decision it makes is recorded against a *situation* — a coarse
 * description of the moment (who, where, what time of day, how they feel,
 * what is on offer). When one choice keeps winning in one situation, it is a
 * candidate; when the judge agrees it is settled (a habit of theirs, done
 * without deciding), it is written down. From then on that situation is met
 * by the habit alone — checked against the judge now and then, and dropped if
 * the judge twice disagrees. Novelty is never habitual: callers only record
 * and use habits for routine moments (no secrets touched, nothing gripping).
 *
 * Keyed by resident name so habits carry across sessions (memories do not).
 * Pure bookkeeping: no world writes, no model calls. */

export type HabitConfig = {
  /** Times a choice must have won in a situation, and its share of all choices there, to be a candidate. */
  minCount: number; minShare: number;
  /** Every n-th use is checked against the judge instead of done blind. */
  checkEvery: number;
  /** Disagreements on a check before the habit is dropped. */
  maxMisses: number;
};
export const DEFAULT_HABITS: HabitConfig = { minCount: 3, minShare: .8, checkEvery: 6, maxMisses: 2 };

export type Habit = { choice: string; writtenAt: number; uses: number; misses: number };
export type HabitStats = { recorded: number; written: number; used: number; checked: number; dropped: number };
export type HabitBookJson = { version: 1; tallies: Record<string, Record<string, Record<string, number>>>; habits: Record<string, Record<string, Habit>> };

export class HabitBook {
  /** resident → situation → choice → count */
  private readonly tallies = new Map<string, Map<string, Map<string, number>>>();
  /** resident → situation → habit */
  private readonly habits = new Map<string, Map<string, Habit>>();
  readonly stats: HabitStats = { recorded: 0, written: 0, used: 0, checked: 0, dropped: 0 };
  constructor(private readonly config: HabitConfig = DEFAULT_HABITS) {}

  private tally(who: string, situation: string) {
    let byWho = this.tallies.get(who); if (!byWho) { byWho = new Map(); this.tallies.set(who, byWho); }
    let bySituation = byWho.get(situation); if (!bySituation) { bySituation = new Map(); byWho.set(situation, bySituation); }
    return bySituation;
  }
  /** The judge chose this in this situation. */
  record(who: string, situation: string, choice: string): void {
    const t = this.tally(who, situation);
    t.set(choice, (t.get(choice) ?? 0) + 1);
    this.stats.recorded++;
  }
  /** A choice that keeps winning here and is not yet a habit: worth asking the judge whether it is settled. */
  candidate(who: string, situation: string): string | undefined {
    if (this.habitFor(who, situation)) return undefined;
    const t = this.tallies.get(who)?.get(situation);
    if (!t) return undefined;
    const total = [...t.values()].reduce((a, b) => a + b, 0);
    const [choice, count] = [...t].sort((a, b) => b[1] - a[1])[0] ?? [];
    return choice !== undefined && count >= this.config.minCount && count / total >= this.config.minShare ? choice : undefined;
  }
  /** Write the habit (the judge agreed it is settled). */
  write(who: string, situation: string, choice: string, at: number): void {
    let byWho = this.habits.get(who); if (!byWho) { byWho = new Map(); this.habits.set(who, byWho); }
    byWho.set(situation, { choice, writtenAt: at, uses: 0, misses: 0 });
    this.stats.written++;
  }
  habitFor(who: string, situation: string): Habit | undefined { return this.habits.get(who)?.get(situation); }
  /** Meet this situation by habit? Returns the choice to make blind, or "check" (ask the judge this time), or undefined (no habit). */
  use(who: string, situation: string): { choice: string } | "check" | undefined {
    const habit = this.habitFor(who, situation);
    if (!habit) return undefined;
    habit.uses++;
    if (habit.uses % this.config.checkEvery === 0) { this.stats.checked++; return "check"; }
    this.stats.used++;
    return { choice: habit.choice };
  }
  /** The judge was asked on a check: agreeing keeps the habit; disagreeing twice drops it. */
  checked(who: string, situation: string, judged: string): void {
    const habit = this.habitFor(who, situation);
    if (!habit) return;
    if (judged === habit.choice) { habit.misses = 0; return; }
    if (++habit.misses >= this.config.maxMisses) { this.habits.get(who)!.delete(situation); this.stats.dropped++; }
  }
  /** A habit that failed in the world (the reply fell flat, the choice could not be done): drop it. */
  broke(who: string, situation: string): void {
    if (this.habits.get(who)?.delete(situation)) this.stats.dropped++;
  }
  /** Habits written for one resident (situation → choice). */
  of(who: string): Record<string, string> {
    return Object.fromEntries([...(this.habits.get(who) ?? [])].map(([s, h]) => [s, h.choice]));
  }
  count(): number { return [...this.habits.values()].reduce((n, m) => n + m.size, 0); }

  toJson(): HabitBookJson {
    const obj = <V, W>(m: Map<string, V>, f: (v: V) => W) => Object.fromEntries([...m].map(([k, v]) => [k, f(v)]));
    return { version: 1, tallies: obj(this.tallies, s => obj(s, c => Object.fromEntries(c))), habits: obj(this.habits, s => obj(s, h => ({ ...h }))) };
  }
  static fromJson(json: HabitBookJson, config: HabitConfig = DEFAULT_HABITS): HabitBook {
    const book = new HabitBook(config);
    if (json?.version !== 1) return book;
    for (const [who, situations] of Object.entries(json.tallies ?? {}))
      for (const [situation, choices] of Object.entries(situations)) for (const [choice, n] of Object.entries(choices)) book.tally(who, situation).set(choice, n);
    for (const [who, situations] of Object.entries(json.habits ?? {})) {
      const m = new Map<string, Habit>();
      for (const [situation, h] of Object.entries(situations)) if (h && typeof h.choice === "string") m.set(situation, { choice: h.choice, writtenAt: h.writtenAt ?? 0, uses: 0, misses: 0 });
      book.habits.set(who, m);
    }
    return book;
  }
}
