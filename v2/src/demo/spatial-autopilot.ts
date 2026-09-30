/** Autopilot in the walkable settlement: habits do the work, attention decides
 * when a resident's mind looks up (cognition/autopilot-attention.ts).
 *
 * - Wake: the habit pauses at its next act, the mind gets the floor (the
 *   foreground gate opens) and is told what caught its attention.
 * - Glance: a small yes/no to the resident's mind ("stop what you're doing?").
 * - Notice: nothing (it passed them by).
 *
 * When things go quiet the floor is handed back: a small choice ("what do you
 * now mean to do?") leaves an errand the habit carries out — bring someone
 * something, go somewhere — before it returns to the day's work. The habit's
 * own surprises (a way of working that no longer works, not a shortage) wake
 * the mind too: stop, look, learn.
 *
 * Being spoken to in passing need not take the whole mind. When a judge and a
 * voice for small replies are configured, the judge reads what was said: if it
 * matters (it grips them, stirs them, or touches what they care about or hide)
 * the mind looks up; if it is routine, they answer in passing — a line from
 * the cheap say leaf — and keep working. Routine that keeps recurring with the
 * same person in the same place becomes a habit (habit-book.ts): answered in
 * passing without asking the judge, checked now and then.
 *
 * A floor is not open-ended. Talk runs in real time while the day runs on the
 * game clock, so a standoff that never goes quiet would eat the whole day: after
 * a spell the resident sets it aside at the next lull (never later than twice
 * the spell) and goes back to their work, and for a
 * while after that only what must be answered (the operator) wakes them — the
 * rest is still felt, remembered and kept as a concern. Night ends every floor
 * once the resident is free of it, and they are left to sleep till dawn. */
import { Name } from "../ecs/components";
import type { World } from "../ecs/world";
import { AttentionFilter, touchesCue, type Percept } from "../cognition/autopilot-attention";
import { requestDecision } from "../cognition/decision-leaves";
import type { MindGate } from "../runtime/attention";
import type { HabitBook } from "../cognition/habit-book";

export type Errand = { kind: "bring"; item: string; to: string } | { kind: "go"; place: string };
/** What a moment stirs and what the resident wants to do about it (from the fast judge). */
export type Appraisal = { wake: number; remember: number; importance: number;
  feeling?: string; valence?: number; arousal?: number; response?: "carry on" | "look into it" | "tell someone" | "confront someone" | "hide it" | "leave" };
/** Something a resident means to act on when the habit next chooses (look into it, tell someone...). */
export type Concern = { response: NonNullable<Appraisal["response"]>; about: string; source: string; atMs: number };

export type AutopilotHost = {
  world: World;
  now(): number;
  /** Residents whose days run on habit. */
  managed(): number[];
  /** What this resident cares about or hides (names, places, words from their past). */
  cuesOf(eid: number): string[];
  /** Tell the resident's mind what caught its attention (a perception that wakes it). */
  inform(eid: number, source: string, text: string): void;
  /** Still busy with the floor (walking, speaking, a pending direct address)? */
  engaged(eid: number): boolean;
  /** People they were just talking with, goods they could fetch, places they could go. */
  errandOptions(eid: number): { people: string[]; items: string[]; places: string[] };
  onErrand(eid: number, errand: Errand): void;
  /** Is there a mind to hand the floor to (a live model)? Without one, perception is only noted. */
  mindAvailable(): boolean;
  /** A fast judge (Jev): does this call for the mind now, is it worth remembering, how much does it matter?
   * Replaces the yes/no glance when present. Probabilities in [0, 1]; importance in [0, 1]. */
  appraise?(eid: number, percept: Percept): Promise<Appraisal | undefined>;
  /** Let the moment colour their feeling (and face). */
  feel?(eid: number, feeling: string, valence: number, arousal: number, reason: string): void;
  /** Keep something as a memory without waking the mind. */
  remember?(eid: number, text: string, importance: number): void;
  record(line: string): void;
  /** Game minutes as real milliseconds (default: a game day per real hour). */
  gameMinutes?(minutes: number): number;
  /** Is it night (bedtime) on the settlement clock? */
  isNight?(): boolean;
  /** Must this be answered even while they have set things aside (the operator speaking to them)? */
  alwaysWakes?(eid: number, percept: Percept): boolean;
  /** Answer in passing (a short line from the say leaf) and carry on. With `situationOf` and `habits`, routine talk becomes habit. */
  answerInPassing?(eid: number, percept: Percept): void;
  /** A routine situation for being spoken to (who, where, when), or undefined when it touches what they care about or hide. */
  situationOf?(eid: number, percept: Percept): string | undefined;
  habits?: HabitBook;
};
/** The habit-book choices for being spoken to. */
export const IN_PASSING = "answer in passing", LOOK_UP = "look up";
type Route = { situation?: string; check: boolean };
/** How long a floor runs before it may be set aside (at the next lull), and how long they keep to their work after, in game minutes.
 * Past twice the spell it is set aside even mid-exchange. */
export const FLOOR_SPELL_GAME_MINUTES = 90, SET_ASIDE_GAME_MINUTES = 60;
/** A lull: this long (real ms) with nothing salient reaching them. An accusation is answered before they walk away. */
export const LULL_MS = 12_000;

/** A floor paces its mind: after a decision it waits for something new (answered at once) or a pause, so an idle mind does not spin. */
type Floor = { since: number; lastSalientAt: number; reason: string; nextThoughtAt: number };
/** Real ms a mind with the floor waits after a decision when nothing new has reached it. */
export const THINK_GAP_MS = 15_000;
const QUIET_MS = 45_000, GLANCE_GAP_MS = 90_000, RECENT_MIND_MS = 10 * 60_000;
const CARRY_ON = "carry on with my work";

export class SettlementAutopilot {
  private readonly filters = new Map<number, AttentionFilter>();
  private readonly floors = new Map<number, Floor>();
  private readonly lastAwake = new Map<number, number>();
  private readonly lastGlance = new Map<number, number>();
  private readonly glances = new Map<number, { slot: string; request: { kind: "yes_no"; question: string }; percept: Percept }>();
  private readonly appraisals = new Map<number, { percept: Percept; result: undefined | Appraisal | null }>();
  /** Spoken-to moments awaiting the judge's routing (look up, or answer in passing). */
  private readonly routes = new WeakMap<Percept, Route>();
  /** The most salient moment that arrived while an appraisal was running: judged next, not dropped. */
  private readonly nextAppraisal = new Map<number, { percept: Percept; score: number }>();
  private readonly concerns = new Map<number, Concern[]>();
  private readonly errandAsks = new Map<number, { slot: string; request: { kind: "pick"; question: string; options: string[] } }>();
  readonly log: Array<{ at: number; who: string; what: string }> = [];
  private sequence = 0;
  constructor(private readonly host: AutopilotHost) {}

  private filter(eid: number) { let f = this.filters.get(eid); if (!f) { f = new AttentionFilter(); this.filters.set(eid, f); } return f; }
  private note(eid: number, what: string) { this.log.push({ at: this.host.now(), who: eid < 0 ? "Saltmere" : Name.value[eid], what }); if (this.log.length > 500) this.log.shift(); }
  holds(eid: number): boolean { return this.floors.has(eid); }
  /** Until when (sim ms) this resident keeps to their work and bed (things are felt, not answered). */
  private readonly setAside = new Map<number, number>();
  private nightNow = false;
  private gameMs(minutes: number) { return this.host.gameMinutes?.(minutes) ?? minutes * 2_500; }
  /** Have they set things aside for now (after a long spell, or for the night)? */
  resting(eid: number): boolean { return this.nightNow || (this.setAside.get(eid) ?? -Infinity) > this.host.now(); }

  /** The mind gate for these residents: the foreground runs only with the floor;
   * background digestion while awake or lately awake. Others are unaffected. */
  readonly gate: MindGate = {
    foreground: eid => { if (!this.host.managed().includes(eid)) return true; const floor = this.floors.get(eid); return !!floor && this.host.now() >= floor.nextThoughtAt; },
    background: eid => !this.host.managed().includes(eid) || this.floors.has(eid) || this.host.now() - (this.lastAwake.get(eid) ?? -Infinity) < RECENT_MIND_MS,
    foregroundTurn: eid => { const floor = this.floors.get(eid); if (floor) floor.nextThoughtAt = this.host.now() + THINK_GAP_MS; },
  };

  /** What the resident means to act on (newest last); taken when the habit chooses. */
  concernsOf(eid: number): readonly Concern[] { return this.concerns.get(eid) ?? []; }
  dropConcern(eid: number, concern: Concern): void { this.concerns.set(eid, (this.concerns.get(eid) ?? []).filter(c => c !== concern)); }
  /** Hand the floor to a resident's mind for a reason of their own (they came to talk, to look into something). */
  summon(eid: number, reason: string, source = "self"): void { if (this.host.mindAvailable() && !this.floors.has(eid) && !this.resting(eid)) this.wake(eid, reason, source); }

  /** Something reached this resident. */
  perceive(eid: number, percept: Percept): void {
    if (!this.host.managed().includes(eid)) return;
    const floor = this.floors.get(eid);
    if (floor) {
      if (percept.kind !== "speech" || this.filter(eid).novelty(percept) > .5) {
        floor.lastSalientAt = percept.atMs;
        floor.nextThoughtAt = 0; // something new: answer it now
      }
      this.filter(eid).perceive(percept); return;
    }
    const verdict = this.filter(eid).perceive(percept);
    // Set aside: still felt and remembered (the judge reads it), not answered — unless it must be.
    if (this.resting(eid) && !this.host.alwaysWakes?.(eid, percept)) {
      // By day, someone who has set the talk aside still answers when spoken to — in passing, without taking it up again.
      if (!this.nightNow && percept.kind === "addressed" && this.host.answerInPassing && this.host.mindAvailable()) this.passing(eid, percept, "set aside");
      if (verdict.level !== "notice" && this.host.appraise) this.queueAppraisal(eid, percept, verdict.score);
      return;
    }
    // Without a mind to hand the floor to, the judge still reads feeling and memory; nothing is woken.
    if (!this.host.mindAvailable() && !(this.host.appraise && verdict.level !== "notice")) { if (verdict.level !== "notice") this.note(eid, `notices: ${percept.text.slice(0, 100)}`); return; }
    if (verdict.level === "wake" && this.host.appraise && !this.host.mindAvailable()) { this.queueAppraisal(eid, percept, verdict.score); return; }
    if (verdict.level === "wake" && this.routeSpoken(eid, percept, verdict.score)) return;
    if (verdict.level === "wake") this.wake(eid, percept.text, percept.source);
    else if (verdict.level === "glance" && this.host.appraise) this.queueAppraisal(eid, percept, verdict.score);
    else if (verdict.level === "glance" && !this.host.appraise && !this.glances.has(eid) && this.host.now() - (this.lastGlance.get(eid) ?? -Infinity) > GLANCE_GAP_MS) {
      this.lastGlance.set(eid, this.host.now());
      const request = { kind: "yes_no" as const, question: `While you work, you notice: ${percept.text}. Do you stop what you are doing to deal with it?` };
      this.glances.set(eid, { slot: `glance:${++this.sequence}`, request, percept });
    }
  }
  /** Classify heard speech for a listener. */
  heard(listener: number, speaker: number, targetId: number | undefined, text: string): void {
    if (listener === speaker) return;
    const name = Name.value[listener], atMs = this.host.now(), source = Name.value[speaker];
    const cue = touchesCue(text, this.host.cuesOf(listener));
    const kind = targetId === listener ? "addressed" : new RegExp(`\\b${name}\\b`, "i").test(text) ? "named" : cue ? "cue" : "speech";
    this.perceive(listener, { kind, source, atMs, text: `${source} says${targetId === listener ? " to you" : ""}: "${text.slice(0, 200)}"` });
  }
  /** The habit's own surprise: a way of working that no longer works. */
  surprised(eid: number, item: string, detail: string): void {
    this.perceive(eid, { kind: "surprise", source: `habit:${item}`, atMs: this.host.now(), text: `your usual way of getting ${item} did not work — ${detail.slice(0, 200)}` });
  }

  /** Spoken to while working: by habit, answer in passing; otherwise let the judge route it. True when handled here. */
  private routeSpoken(eid: number, percept: Percept, score: number): boolean {
    if (!["addressed", "named"].includes(percept.kind) || !this.host.appraise || !this.host.answerInPassing || this.host.alwaysWakes?.(eid, percept)) return false;
    const situation = this.host.situationOf?.(eid, percept), who = Name.value[eid];
    const habit = situation && this.host.habits ? this.host.habits.use(who, situation) : undefined;
    if (habit && habit !== "check" && habit.choice === IN_PASSING) { this.passing(eid, percept, "by habit"); return true; }
    this.routes.set(percept, { situation, check: habit === "check" });
    this.queueAppraisal(eid, percept, score);
    return true;
  }
  private passing(eid: number, percept: Percept, how: string): void {
    this.note(eid, `answers in passing${how ? ` (${how})` : ""}: ${percept.text.slice(0, 100)}`);
    this.host.answerInPassing!(eid, percept);
  }
  private queueAppraisal(eid: number, percept: Percept, score: number): void {
    if (!this.appraisals.has(eid)) { this.startAppraisal(eid, percept); return; }
    const waiting = this.nextAppraisal.get(eid);
    if (!waiting || score >= waiting.score) this.nextAppraisal.set(eid, { percept, score });
  }
  private startAppraisal(eid: number, percept: Percept): void {
    const pending = { percept, result: undefined as undefined | Appraisal | null };
    this.appraisals.set(eid, pending);
    this.host.appraise!(eid, percept).then(r => { pending.result = r ?? null; }, () => { pending.result = null; });
  }
  private wake(eid: number, text: string, source: string): void {
    if (!this.host.mindAvailable()) return;
    const now = this.host.now();
    this.floors.set(eid, { since: now, lastSalientAt: now, reason: text, nextThoughtAt: 0 });
    this.lastAwake.set(eid, now);
    this.note(eid, `looks up: ${text}`);
    this.host.inform(eid, source, text);
  }

  /** Each tick: settle glances, hand back quiet floors, settle errands. */
  tick(): void {
    const now = this.host.now();
    for (const [eid, a] of [...this.appraisals]) {
      if (a.result === undefined) continue;
      this.appraisals.delete(eid);
      const waiting = this.nextAppraisal.get(eid);
      if (waiting) { this.nextAppraisal.delete(eid); this.startAppraisal(eid, waiting.percept); }
      if (!a.result) continue;
      const r = a.result;
      // A bare meeting carries no content: it may be remembered, but it does not by itself stir feelings or intentions.
      const contentful = a.percept.kind !== "approach";
      if (contentful && r.feeling && r.valence !== undefined && r.arousal !== undefined && r.importance >= .5) {
        this.host.feel?.(eid, r.feeling, r.valence, r.arousal, a.percept.text.slice(0, 200));
        this.note(eid, `feels ${r.feeling} (valence ${r.valence.toFixed(2)}, arousal ${r.arousal.toFixed(2)})`);
      }
      if (contentful && r.response && r.response !== "carry on" && r.importance >= .6) {
        const list = [...(this.concerns.get(eid) ?? []), { response: r.response, about: a.percept.text, source: a.percept.source, atMs: now }].slice(-4);
        this.concerns.set(eid, list);
        this.note(eid, `means to ${r.response}: ${a.percept.text.slice(0, 80)}`);
      }
      // A bare meeting has to be more memorable than words or surprises to be kept.
      if (a.result.remember >= (contentful ? .5 : .75)) { this.host.remember?.(eid, a.percept.text, a.result.importance); this.note(eid, `remembers: ${a.percept.text.slice(0, 80)} (${a.result.importance.toFixed(2)})`); }
      // Two ways to look up: it demands attention now, or it plainly matters a great deal to them
      // (an overheard word about their own secret may not demand attention, but it grips them).
      // Strong feeling demands attention too.
      const gripping = a.result.importance >= .85 && a.result.remember >= .7 || (r.arousal ?? 0) >= .8;
      const route = this.routes.get(a.percept);
      if (route) {
        // Spoken to: it matters, or it is routine talk to answer in passing. The judge's reading is recorded toward a habit.
        const matters = a.result.wake >= .6 || gripping || a.result.importance >= .6;
        const choice = matters ? LOOK_UP : IN_PASSING, who = Name.value[eid], habits = this.host.habits;
        if (route.situation && habits) {
          if (route.check) habits.checked(who, route.situation, choice);
          habits.record(who, route.situation, choice);
          if (habits.candidate(who, route.situation) === IN_PASSING) { habits.write(who, route.situation, IN_PASSING, now); this.note(eid, `makes a habit of answering in passing (${route.situation})`); }
        }
        if (!matters && !this.floors.has(eid)) { this.passing(eid, a.percept, ""); continue; }
        if (matters && !this.floors.has(eid) && !this.resting(eid)) { this.wake(eid, a.percept.text, a.percept.source); continue; }
      }
      if ((a.result.wake >= .6 || gripping) && !this.floors.has(eid) && !this.resting(eid)) this.wake(eid, a.percept.text, a.percept.source);
      else if (a.result.remember < (contentful ? .5 : .75)) this.note(eid, `lets it pass (${a.percept.text.slice(0, 80)})`);
    }
    for (const [eid, g] of [...this.glances]) {
      const poll = requestDecision(this.host.world, eid, g.slot, g.request);
      if (poll.status === "pending") continue;
      this.glances.delete(eid);
      // No answer (no model, over budget) means carry on.
      if (poll.answer.kind === "yes_no" && poll.answer.yes && poll.answer.source === "model" && !this.resting(eid)) this.wake(eid, g.percept.text, g.percept.source);
      else this.note(eid, `glances up and carries on (${g.percept.text.slice(0, 80)})`);
    }
    const night = !!this.host.isNight?.();
    if (night && !this.nightNow) this.note(-1, "night falls");
    this.nightNow = night;
    for (const [eid, floor] of [...this.floors]) {
      this.lastAwake.set(eid, now);
      if (this.host.engaged(eid)) continue;
      // Night: bed, not more talk. A long spell: set it aside and get back to work.
      const spell = now - floor.since, lull = now - floor.lastSalientAt >= LULL_MS;
      if (night || spell >= this.gameMs(FLOOR_SPELL_GAME_MINUTES) && lull || spell >= 2 * this.gameMs(FLOOR_SPELL_GAME_MINUTES)) {
        this.floors.delete(eid);
        if (!night) this.setAside.set(eid, now + this.gameMs(SET_ASIDE_GAME_MINUTES));
        this.note(eid, night ? "turns in for the night" : "sets it aside for now and goes back to work");
        continue;
      }
      if (now - floor.lastSalientAt < QUIET_MS) continue;
      this.floors.delete(eid);
      const { people, items, places } = this.host.errandOptions(eid);
      const options = [CARRY_ON, ...people.flatMap(p => items.map(i => `bring ${i} to ${p}`)), ...places.map(p => `go to ${p}`)].slice(0, 60);
      if (options.length > 1) this.errandAsks.set(eid, { slot: `errand:${++this.sequence}`,
        request: { kind: "pick", question: "That is over for now. What do you now mean to do?", options } });
      else this.note(eid, "goes back to work");
    }
    for (const [eid, ask] of [...this.errandAsks]) {
      const poll = requestDecision(this.host.world, eid, ask.slot, ask.request);
      if (poll.status === "pending") continue;
      this.errandAsks.delete(eid);
      const choice = poll.answer.kind === "pick" ? ask.request.options[poll.answer.index] : CARRY_ON;
      const bring = /^bring (.+) to (.+)$/.exec(choice), go = /^go to (.+)$/.exec(choice);
      if (bring) this.host.onErrand(eid, { kind: "bring", item: bring[1], to: bring[2] });
      else if (go) this.host.onErrand(eid, { kind: "go", place: go[1] });
      this.note(eid, choice === CARRY_ON ? "goes back to work" : `means to ${choice}`);
    }
  }
}
