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
 * the mind too: stop, look, learn. */
import { Name } from "../ecs/components";
import type { World } from "../ecs/world";
import { AttentionFilter, touchesCue, type Percept } from "../cognition/autopilot-attention";
import { requestDecision } from "../cognition/decision-leaves";
import type { MindGate } from "../runtime/attention";

export type Errand = { kind: "bring"; item: string; to: string } | { kind: "go"; place: string };

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
  record(line: string): void;
};

type Floor = { since: number; lastSalientAt: number; reason: string };
const QUIET_MS = 45_000, GLANCE_GAP_MS = 90_000, RECENT_MIND_MS = 10 * 60_000;
const CARRY_ON = "carry on with my work";

export class SettlementAutopilot {
  private readonly filters = new Map<number, AttentionFilter>();
  private readonly floors = new Map<number, Floor>();
  private readonly lastAwake = new Map<number, number>();
  private readonly lastGlance = new Map<number, number>();
  private readonly glances = new Map<number, { slot: string; request: { kind: "yes_no"; question: string }; percept: Percept }>();
  private readonly errandAsks = new Map<number, { slot: string; request: { kind: "pick"; question: string; options: string[] } }>();
  readonly log: Array<{ at: number; who: string; what: string }> = [];
  private sequence = 0;
  constructor(private readonly host: AutopilotHost) {}

  private filter(eid: number) { let f = this.filters.get(eid); if (!f) { f = new AttentionFilter(); this.filters.set(eid, f); } return f; }
  private note(eid: number, what: string) { this.log.push({ at: this.host.now(), who: Name.value[eid], what }); if (this.log.length > 500) this.log.shift(); }
  holds(eid: number): boolean { return this.floors.has(eid); }

  /** The mind gate for these residents: the foreground runs only with the floor;
   * background digestion while awake or lately awake. Others are unaffected. */
  readonly gate: MindGate = {
    foreground: eid => !this.host.managed().includes(eid) || this.floors.has(eid),
    background: eid => !this.host.managed().includes(eid) || this.floors.has(eid) || this.host.now() - (this.lastAwake.get(eid) ?? -Infinity) < RECENT_MIND_MS,
  };

  /** Something reached this resident. */
  perceive(eid: number, percept: Percept): void {
    if (!this.host.managed().includes(eid)) return;
    const floor = this.floors.get(eid);
    if (floor) { if (percept.kind !== "speech" || this.filter(eid).novelty(percept) > .5) floor.lastSalientAt = percept.atMs; this.filter(eid).perceive(percept); return; }
    const verdict = this.filter(eid).perceive(percept);
    if (!this.host.mindAvailable()) { if (verdict.level !== "notice") this.note(eid, `notices: ${percept.text.slice(0, 100)}`); return; }
    if (verdict.level === "wake") this.wake(eid, percept.text, percept.source);
    else if (verdict.level === "glance" && !this.glances.has(eid) && this.host.now() - (this.lastGlance.get(eid) ?? -Infinity) > GLANCE_GAP_MS) {
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

  private wake(eid: number, text: string, source: string): void {
    const now = this.host.now();
    this.floors.set(eid, { since: now, lastSalientAt: now, reason: text });
    this.lastAwake.set(eid, now);
    this.note(eid, `looks up: ${text}`);
    this.host.inform(eid, source, text);
  }

  /** Each tick: settle glances, hand back quiet floors, settle errands. */
  tick(): void {
    const now = this.host.now();
    for (const [eid, g] of [...this.glances]) {
      const poll = requestDecision(this.host.world, eid, g.slot, g.request);
      if (poll.status === "pending") continue;
      this.glances.delete(eid);
      // No answer (no model, over budget) means carry on.
      if (poll.answer.kind === "yes_no" && poll.answer.yes && poll.answer.source === "model") this.wake(eid, g.percept.text, g.percept.source);
      else this.note(eid, `glances up and carries on (${g.percept.text.slice(0, 80)})`);
    }
    for (const [eid, floor] of [...this.floors]) {
      this.lastAwake.set(eid, now);
      if (now - floor.lastSalientAt < QUIET_MS || this.host.engaged(eid)) continue;
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
