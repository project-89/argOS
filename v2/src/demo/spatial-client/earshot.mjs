/** Earshot (pure): what a controlled body can hear. Speech carries about nine
 * metres in the spatial world (`control.earshotMetres`); beyond that you see
 * people talking but neither hear nor read them. Distances are planar (x/z). */

export const DEFAULT_EARSHOT_METRES = 9;
/** Actions are seen rather than heard: roughly the distance names are shown at. */
export const SIGHT_METRES = 16;

export function earshotMetres(control) {
  const value = Number(control?.earshotMetres);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_EARSHOT_METRES;
}

export function planarDistance(a, b) {
  if (!a || !b || ![a.x, a.z, b.x, b.z].every(Number.isFinite)) return Infinity;
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Full opacity up to `fadeFrom` × earshot, linear to zero at earshot, none beyond. */
export function earshotFade(distance, earshot = DEFAULT_EARSHOT_METRES, fadeFrom = 0.6) {
  if (!Number.isFinite(distance) || distance < 0) return 0;
  const edge = Math.max(0.01, earshot), start = edge * Math.min(0.99, Math.max(0, fadeFrom));
  if (distance <= start + 1e-9) return 1;
  if (distance >= edge) return 0;
  return (edge - distance) / (edge - start);
}

/** Planar distance from the controlled body to whoever said `line`, from the
 * snapshot's positions: `speakerKey` when the server supplies it, else by name. */
export function speakerDistance(state, bodyKey, line) {
  const entities = state?.entities ?? [];
  const body = entities.find(e => e.key === bodyKey);
  if (!body) return undefined;
  let key = typeof line?.speakerKey === 'string' ? line.speakerKey : null;
  if (!key && typeof line?.speaker === 'string') {
    key = state?.actors?.find(a => a.name === line.speaker)?.key
      ?? entities.find(e => e.kind === 'actor' && e.name === line.speaker)?.key ?? null;
  }
  const speaker = key ? entities.find(e => e.key === key) : null;
  return speaker ? planarDistance(body.position, speaker.position) : undefined;
}

/** Which scene cues a body in Inhabit perceives. Speech (and sounds) only within
 * earshot, fading toward its edge; actions within sight. Nearest first (anyone
 * addressing you before that), at most `maxSpeech` bubbles and `maxOther`
 * captions. `positionOf(key)` → {x, z} (the shown, interpolated position).
 * Returns `[{ cue, distance, opacity }]`. */
export function selectInhabitCues(cues, { bodyKey, positionOf, earshot = DEFAULT_EARSHOT_METRES, hideOwn = false,
  addressedKeys = new Set(), maxSpeech = 3, maxOther = 3, sight = SIGHT_METRES, fadeFrom = 0.6 } = {}) {
  const here = bodyKey ? positionOf?.(bodyKey) : null;
  const speech = [], other = [];
  for (const cue of cues ?? []) {
    if (!cue || typeof cue.entityKey !== 'string') continue;
    const own = cue.entityKey === bodyKey;
    if (own && hideOwn && cue.kind === 'speech') continue;
    const distance = own ? 0 : planarDistance(here, positionOf?.(cue.entityKey));
    if (!Number.isFinite(distance)) continue;
    if (cue.kind === 'speech' || cue.kind === 'sound') {
      const opacity = own ? 1 : earshotFade(distance, earshot, fadeFrom);
      if (opacity <= 0) continue;
      (cue.kind === 'speech' ? speech : other).push({ cue, distance, opacity, addressed: addressedKeys.has(cue.entityKey) });
    } else if (distance <= sight) other.push({ cue, distance, opacity: 1, addressed: false });
  }
  const order = (a, b) => (b.addressed - a.addressed) || (a.distance - b.distance);
  return [...speech.sort(order).slice(0, maxSpeech), ...other.sort(order).slice(0, maxOther)]
    .map(({ cue, distance, opacity }) => ({ cue, distance, opacity }));
}

/** At most `max` subtitles on screen: anyone addressing you, then the line
 * being voiced, then the nearest (your own words count as nearest), then the
 * newest. Returned in the order they were shown so the reading order is stable. */
export function prioritizeSubtitles(lines, max = 2) {
  const rank = line => [line.addressed ? 0 : 1, line.speaking ? 0 : 1,
    line.self ? 0 : Number.isFinite(line.distance) ? line.distance : 1e6, -(line.shownAt ?? 0)];
  const compare = (a, b) => { const x = rank(a), y = rank(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
  const chosen = new Set([...lines].sort(compare).slice(0, Math.max(0, max)));
  return lines.filter(line => chosen.has(line));
}
