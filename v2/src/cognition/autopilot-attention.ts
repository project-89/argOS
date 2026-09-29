/** Autopilot and attention: habits run the day; perception decides when the
 * mind must look up.
 *
 * A resident on autopilot (a skill graph / behaviour tree doing their work)
 * does not run their LLM mind. Everything they perceive passes through this
 * cheap filter, which scores how much it matters to *them*, now:
 *
 * - being spoken to, or hearing their own name;
 * - talk touching what they care about or hide (their cues);
 * - someone coming up to them;
 * - their habit failing in a way it never has (a surprise, not a shortage):
 *   stop, look, learn;
 * - something uncanny happening where they are.
 *
 * Repetition habituates: the tenth time the same neighbour walks past, it is
 * not news. Scores accumulate briefly, so three small things can add up. Past
 * the wake mark the mind takes the floor (the habit pauses at its next act);
 * in between, a small yes/no glance may be asked; below, it is only noticed.
 * Pure bookkeeping: no world writes, no model calls. */

export type PerceptKind = "addressed" | "named" | "cue" | "speech" | "approach" | "surprise" | "uncanny" | "completion";
export type Percept = { kind: PerceptKind; source: string; text: string; atMs: number };
export type Salience = { score: number; novelty: number; percept: Percept };
export type AttentionVerdict = { level: "wake" | "glance" | "notice"; score: number; because: Percept[] };

/** How much each kind of thing matters before habituation. */
export const PERCEPT_WEIGHT: Record<PerceptKind, number> = {
  addressed: 1, surprise: .8, uncanny: .7, named: .6, cue: .55, approach: .3, completion: .3, speech: .15,
};
export type AttentionConfig = {
  /** Scores at or above wake the mind; at or above glance ask a small yes/no. */
  wake: number; glance: number;
  /** How quickly repetition fades (ms) and how long recent scores add up (ms). */
  habituationMs: number; accumulateMs: number;
};
export const DEFAULT_ATTENTION: AttentionConfig = { wake: .6, glance: .35, habituationMs: 10 * 60_000, accumulateMs: 20_000 };

export class AttentionFilter {
  private readonly seen = new Map<string, number[]>();
  private recent: Salience[] = [];
  constructor(private readonly config: AttentionConfig = DEFAULT_ATTENTION) {}

  /** 1 for the first time, fading with each repeat of the same kind from the same source. */
  novelty(p: Percept): number {
    const key = `${p.kind}:${p.source}`;
    const times = (this.seen.get(key) ?? []).filter(t => p.atMs - t < this.config.habituationMs);
    return Math.exp(-times.length / 2);
  }

  /** Take in one percept; return what attention makes of it. Being addressed
   * and surprises never habituate away entirely (you still turn when spoken to). */
  perceive(p: Percept): AttentionVerdict {
    const novelty = this.novelty(p);
    const floor = p.kind === "addressed" || p.kind === "surprise" ? .75 : 0;
    const score = PERCEPT_WEIGHT[p.kind] * Math.max(floor, novelty);
    const key = `${p.kind}:${p.source}`;
    this.seen.set(key, [...(this.seen.get(key) ?? []).filter(t => p.atMs - t < this.config.habituationMs), p.atMs].slice(-20));
    this.recent = [...this.recent.filter(s => p.atMs - s.percept.atMs < this.config.accumulateMs), { score, novelty, percept: p }];
    // Small things add up, but with diminishing returns.
    const total = 1 - this.recent.reduce((keep, s) => keep * (1 - Math.min(.99, s.score)), 1);
    const because = [...this.recent].sort((a, b) => b.score - a.score).slice(0, 3).map(s => s.percept);
    const level = total >= this.config.wake ? "wake" : total >= this.config.glance ? "glance" : "notice";
    if (level === "wake") this.recent = []; // attended to: start afresh
    return { level, score: +total.toFixed(3), because };
  }
}

/** Does this text touch any of these cues (names, places, secrets)? */
export function touchesCue(text: string, cues: readonly string[]): string | undefined {
  const lower = text.toLowerCase();
  return cues.find(cue => cue.trim().length >= 3 && new RegExp(`(^|[^a-z])${cue.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(lower));
}
