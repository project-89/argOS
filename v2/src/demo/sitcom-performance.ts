import type { ScreenBeat } from "./sitcom-screenplay";

export type PerformancePoint = Readonly<{ mediaMs: number; sourceMs: number }>;
export type PerformanceCue = Readonly<{ beat: number; startMs: number; endMs: number; evidence: readonly number[] }>;
export type PerformanceShot = Readonly<{ startMs: number; endMs: number; actorId?: number; roomId?: number;
  /** phone_hands is read-only compatibility for saved scripts, never newly emitted. */
  kind: "phone_hands" | "interaction_insert" | "object_hands" | "pickup" | "speaker" | "action" | "establish"; beat?: number }>;
export type SitcomPerformance = Readonly<{ durationMs: number; endingSilenceMs: number;
  clock?: "realtime";
  coverage?: readonly Readonly<{beat:number;disposition:"prompted"|"off_camera"|"competing_audio"}>[];
  sourceMap: readonly PerformancePoint[]; cues: readonly PerformanceCue[]; shots: readonly PerformanceShot[] }>;
export class PerformanceBudgetError extends Error {
  constructor(readonly reason: "performance_overflow" | "incomplete_utterance" | "incomplete_action" | "underspecified_opening" | "underfilled_continuation", message: string) { super(message); }
}
const interactionInsert = (b: ScreenBeat) => ["reading", "typing"].includes(b.operation ?? "");
export const ESSENTIAL_PHYSICAL_OPERATIONS = Object.freeze(["reading", "typing", "pickup", "pouring", "drinking"] as const);
const essential = (b: ScreenBeat) => b.kind === "action" && (b.endSimMs ?? b.atSimMs) > b.atSimMs
  && ESSENTIAL_PHYSICAL_OPERATIONS.some(operation => operation === b.operation);
const words = (s: string) => s.trim().split(/\s+/u).filter(Boolean).length;

/** An editorial clock chosen BEFORE issuing a prompt. Source time stays immutable.
 * Empty waits may be compressed, but speech and legible physical gestures have
 * minimum performance budgets. Impossible coverage fails instead of rushing a
 * line, cutting words, inventing a reply, or silently dropping an event. */
export function buildSitcomPerformance(beats: readonly ScreenBeat[], start: number, end: number,
  durationMs: number, opening = false): SitcomPerformance {
  if (![start, end, durationMs].every(Number.isFinite) || end <= start || durationMs < 1000 || durationMs > 30_000)
    throw new Error("Invalid bounded media performance interval");
  if (opening && !beats.length && end - start < durationMs * .8)
    throw new PerformanceBudgetError("underspecified_opening", `An empty ${end - start}ms source opening cannot fill a ${durationMs}ms first chunk; await a meaningful opening or a full lived establishing interval.`);
  const leadingHoldMs = Math.max(0, ...beats.filter(b => b.atSimMs <= start).map(b => b.notBeforeMediaMs ?? 0));
  const endingSilenceMs = 500, usable = durationMs - endingSilenceMs - leadingHoldMs;
  const effectiveEnd = (b: ScreenBeat) => b.kind === "sound" ? Math.min(end, b.atSimMs + (b.audibleDurationMs ?? 800)) : b.endSimMs ?? b.atSimMs;
  const boundaries = [...new Set([start, end, ...beats.flatMap(b => [b.atSimMs, effectiveEnd(b)])]
    .map(at => Math.min(end, Math.max(start, at))))].sort((a, b) => a - b);
  const constraints = beats.map((b, index) => {
    const from = Math.max(start, b.atSimMs), to = Math.min(end, effectiveEnd(b));
    const span = to - from;
    const minimum = b.kind === "speech" ? Math.max(700, words(b.text ?? "") / 2.5 * 1000 + 200)
      : b.kind === "sound" ? b.audibleDurationMs ?? 800
        : essential(b) ? b.operation === "pickup" ? 1600 : 1800
        : b.kind === "action" && span > 0 ? Math.min(1000, span) : 0;
    if (b.kind === "speech" && span <= 0)
      throw new PerformanceBudgetError("performance_overflow", "A spoken line has no observed performance interval.");
    return { index, from, to, minimum, span };
  });
  // Recurring sounds carry rhythm. Compressing the six seconds between two
  // phone notifications into150ms makes a different sound, even if both IDs
  // survive. Preserve onset separation within the source interval; overflow
  // must choose another source cut, not merge notifications into a burst.
  const recentSound = new Map<string, ScreenBeat>();
  for (const b of beats.filter(b => b.kind === "sound").sort((a, b) => a.atSimMs - b.atSimMs)) {
    const key = b.soundKey ?? `sound:${b.roomId ?? "unknown"}`;
    const prior = recentSound.get(key);
    if (prior && b.atSimMs > prior.atSimMs) constraints.push({ index: -1, from: prior.atSimMs, to: b.atSimMs,
      minimum: b.atSimMs - prior.atSimMs, span: b.atSimMs - prior.atSimMs });
    recentSound.set(key, b);
  }
  for (const b of beats) if ((b.notBeforeMediaMs ?? 0) > leadingHoldMs && b.atSimMs > start) constraints.push({
    index: -1, from: start, to: b.atSimMs, span: b.atSimMs - start, minimum: b.notBeforeMediaMs! - leadingHoldMs,
  });
  const atoms = boundaries.slice(0, -1).map((from, index) => {
    const to = boundaries[index + 1], span = to - from;
    const active = constraints.filter(c => c.span > 0 && c.from < to && c.to > from);
    if (active.filter(c => beats[c.index]?.kind === "speech").length > 1)
      throw new PerformanceBudgetError("performance_overflow", "Overlapping committed utterances need separate editorial coverage; a single clear-dialogue performance cannot silently omit or overlap speakers.");
    const rates = active.map(c => c.minimum / c.span);
    const minimum = rates.length ? span * Math.max(...rates) : Math.min(150, span);
    return { from, to, span, active, minimum, duration: minimum };
  });
  const minimum = atoms.reduce((sum, a) => sum + a.minimum, 0);
  if (minimum > usable + .001)
    throw new PerformanceBudgetError("performance_overflow", `Committed speech and gestures require ${(minimum + endingSilenceMs).toFixed(0)}ms, exceeding the ${durationMs}ms media budget. Split at a complete utterance/action boundary; do not truncate or speed up dialogue.`);
  // Restore natural source pacing where possible. Never spend spare capacity
  // stretching a brief idle opening or slowing a completed phone gesture.
  let remaining = usable - minimum;
  const wanted = atoms.map(a => a.active.length ? Math.max(0, a.span - a.minimum) : 0);
  const totalWanted = wanted.reduce((sum, n) => sum + n, 0);
  atoms.forEach((a, i) => { const extra = totalWanted ? Math.min(remaining, totalWanted) * wanted[i] / totalWanted : 0; a.duration += extra; });
  remaining = usable - atoms.reduce((sum, a) => sum + a.duration, 0);
  if (!beats.length) {
    // An actually lived establishing interval is not a synthetic fast-forward.
    for (const atom of atoms) atom.duration = usable * atom.span / (end - start);
    remaining = 0;
  }
  const sourceMap: PerformancePoint[] = [{ mediaMs: 0, sourceMs: start }];
  if (leadingHoldMs) sourceMap.push({ mediaMs: leadingHoldMs, sourceMs: start });
  const mapOffset = leadingHoldMs ? 1 : 0;
  let media = leadingHoldMs;
  for (const a of atoms) { media += a.duration; sourceMap.push({ mediaMs: media, sourceMs: a.to }); }
  const endingAt = media;
  sourceMap.push({ mediaMs: durationMs, sourceMs: end });
  const mediaAt = (at: number) => {
    if (at <= start) return leadingHoldMs;
    for (let i = 0; i < atoms.length; i++) if (at <= atoms[i].to) {
      const a = atoms[i]; return sourceMap[i + mapOffset].mediaMs + (at - a.from) / a.span * a.duration;
    }
    return endingAt;
  };
  const cues: PerformanceCue[] = beats.map((b, beat) => ({ beat, startMs: mediaAt(b.atSimMs),
    endMs: mediaAt(effectiveEnd(b)), evidence: Object.freeze([...b.evidence]) }));
  const shots: PerformanceShot[] = [];
  for (let i = 0; i < atoms.length; i++) {
    const atom = atoms[i], candidates = atom.active.map(c => c.index).filter(index => beats[index]?.actorId !== undefined);
    candidates.sort((a, b) => (essential(beats[b]) ? 3 : beats[b].kind === "speech" ? 2 : 1)
      - (essential(beats[a]) ? 3 : beats[a].kind === "speech" ? 2 : 1));
    const beat = candidates[0], chosen = beat === undefined ? undefined : beats[beat];
    const shot: PerformanceShot = { startMs: sourceMap[i + mapOffset].mediaMs, endMs: sourceMap[i + 1 + mapOffset].mediaMs,
      ...(chosen ? { beat, actorId: chosen.actorId } : {}), kind: chosen ? chosen.operation === "pickup" ? "pickup"
        : interactionInsert(chosen) ? "interaction_insert" : essential(chosen) ? "object_hands" : chosen.kind === "speech" ? "speaker" : "action" : "establish" };
    const prior = shots.at(-1);
    if (prior && prior.beat === shot.beat && prior.kind === shot.kind) shots[shots.length - 1] = { ...prior, endMs: shot.endMs };
    else shots.push(shot);
  }
  // Essential physical actions cannot hide behind another focal actor's speech.
  for (const c of constraints.filter(c => c.index >= 0 && essential(beats[c.index]))) {
    const visible = shots.filter(s => s.beat === c.index).reduce((sum, s) => sum + s.endMs - s.startMs, 0);
    if (visible + .001 < c.minimum) throw new PerformanceBudgetError("performance_overflow", "Overlapping essential physical gestures cannot both receive visible coverage in this shot deck.");
  }
  return Object.freeze({ durationMs, endingSilenceMs: durationMs - endingAt,
    sourceMap: Object.freeze(sourceMap.map(p => Object.freeze(p))), cues: Object.freeze(cues.map(c => Object.freeze(c))),
    shots: Object.freeze(shots.map(s => Object.freeze(s))) });
}
