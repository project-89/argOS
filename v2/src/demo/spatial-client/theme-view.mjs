import { roomExtents } from './framing-view.mjs';

/** Authored presentation, not weather, time of day, evidence or NPC knowledge.
 * Only the explicit public scenario flag selects a palette. */
export function worldTheme(scenario) {
  if (scenario?.id !== 'town' || scenario.theme !== 'lovecraft') return null;
  return { id: 'lovecraft', groundTint: '#64766e', groundBlend: .28,
    architectureTint: '#65716d', architectureBlend: .18,
    windowColor: '#d8b982', windowGlow: '#d3a366', windowIntensity: .3,
    interiorColor: '#f3c58c', interiorIntensity: 14,
    hazeColor: '#33494d', hazeDensity: .0035, seaColor: '#294e59', seaLine: '#65858a',
    zenith: '#253747', horizon: '#485a5c', cloudColor: '#9eabb2', sunColor: '#e6b78e' };
}

/** Theme changes illumination only. Actual weather keeps its own ordering and
 * remains the sole source of cloud count, rain and native surface wetness. */
export function sceneLighting(scenario, weather) {
  const day = daylightOf(scenario), lit = sceneLightingAtNoon(scenario, weather);
  if (day === undefined) return lit;
  // Night: dim and blue; dawn and dusk blend between.
  return { keyColor: mix(lit.keyColor, '#7f96c8', 1 - day), keyIntensity: lit.keyIntensity * (.12 + .88 * day),
    skyColor: mix(lit.skyColor, '#3c4f78', 1 - day), skyIntensity: lit.skyIntensity * (.3 + .7 * day), groundColor: mix(lit.groundColor, '#2a2f3a', 1 - day) };
}
/** The settlement's daylight (0 night … 1 midday), when the world reports one. */
export function daylightOf(scenario) {
  const d = scenario?.daylight;
  return typeof d === 'number' && Number.isFinite(d) ? Math.max(0, Math.min(1, d)) : undefined;
}
function mix(a, b, t) {
  const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)), x = p(a), y = p(b);
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
function sceneLightingAtNoon(scenario, weather) {
  const condition = weather?.condition ?? 'clear';
  if (worldTheme(scenario)) return {
    keyColor: condition === 'clear' ? '#ecc8a2' : '#a6bbc7',
    keyIntensity: condition === 'rain' ? 1.65 : condition === 'cloudy' ? 2 : 2.45,
    skyColor: '#b1c6ce', skyIntensity: condition === 'rain' ? 1.65 : 1.85, groundColor: '#6b685c',
  };
  return { keyColor: condition === 'clear' ? '#ffe4b7' : '#cedce7',
    keyIntensity: condition === 'rain' ? 2.15 : condition === 'cloudy' ? 2.8 : 3.6,
    skyColor: condition === 'clear' ? '#d4e7e6' : '#c4d1e2',
    skyIntensity: condition === 'rain' ? 1.95 : 2.1, groundColor: '#82704f' };
}

/** A backdrop beyond even the decorative ground apron, never a new room,
 * destination, collider, or input to overview camera fitting. */
export function decorativeCoastBounds(rooms) {
  const bounds = roomExtents(rooms); if (!bounds) return null;
  const depth = Math.max(12, Math.min(30, bounds.depth * .55));
  return { x: bounds.minX - 12, z: bounds.minZ - 3.5 - depth,
    width: bounds.width + 24, depth, y: -.72 };
}
