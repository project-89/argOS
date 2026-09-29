/** Inhabit input: keys → walk vectors, the nearby-verb prompt, and a transport
 * facade (`createBodyControls`) that any input device (keyboard/mouse today,
 * WebXR controllers later) drives through the same three verbs:
 *   controls.walk(dx, dy) · controls.interact(verb, targetKey) · controls.say(text, targetKey)
 *
 * Coordinates: the engine's ground plane is (x, y); the renderer draws it as
 * three.js (x, z). So `dx` is three.js +X and `dy` is three.js +Z. */

const FORWARD = new Set(['KeyW', 'ArrowUp']), BACK = new Set(['KeyS', 'ArrowDown']);
const LEFT = new Set(['KeyA', 'ArrowLeft']), RIGHT = new Set(['KeyD', 'ArrowRight']);
export const MOVEMENT_CODES = Object.freeze([...FORWARD, ...BACK, ...LEFT, ...RIGHT]);

/** Held keys (KeyboardEvent.code) → {forward, strafe} in -1..1, or null at rest. */
export function walkIntent(held) {
  let forward = 0, strafe = 0;
  for (const code of held) {
    if (FORWARD.has(code)) forward += 1; else if (BACK.has(code)) forward -= 1;
    else if (LEFT.has(code)) strafe -= 1; else if (RIGHT.has(code)) strafe += 1;
  }
  forward = Math.max(-1, Math.min(1, forward)); strafe = Math.max(-1, Math.min(1, strafe));
  return forward || strafe ? { forward, strafe } : null;
}

/** Camera yaw follows three.js: yaw 0 looks toward -Z; forward = (-sin, -cos). */
export function walkVector(intent, headingYaw) {
  if (!intent || !Number.isFinite(headingYaw)) return null;
  const fx = -Math.sin(headingYaw), fz = -Math.cos(headingYaw);
  const rx = Math.cos(headingYaw), rz = -Math.sin(headingYaw);
  const x = intent.forward * fx + intent.strafe * rx, z = intent.forward * fz + intent.strafe * rz;
  const length = Math.hypot(x, z);
  if (length < 1e-6) return null;
  return { dx: round(x / length), dy: round(z / length) };
}
const round = value => Math.round(value * 1000) / 1000 || 0;

/** Throttled walk requests while keys are held: at most `hz` per second, never
 * two in flight, immediately on a direction change, and nothing at rest. */
export function createWalkSender({ send, hz = 6, turnThreshold = Math.PI / 6 } = {}) {
  const interval = 1000 / hz;
  let lastAt = -Infinity, last = null, inFlight = false;
  return {
    update(vector, now) {
      if (!vector) { last = null; return false; }
      if (inFlight) return false;
      const turned = last && Math.acos(Math.max(-1, Math.min(1, last.dx * vector.dx + last.dy * vector.dy))) > turnThreshold;
      if (!turned && now - lastAt < interval) return false;
      lastAt = now; last = vector; inFlight = true;
      let pending;
      try { pending = send(vector); } catch { pending = null; }
      Promise.resolve(pending).catch(() => {}).finally(() => { inFlight = false; });
      return true;
    },
    get inFlight() { return inFlight; },
    reset() { last = null; lastAt = -Infinity; },
  };
}

const VERB_PHRASES = {
  sit: 'Sit on', stand: 'Stand up from', open: 'Open', close: 'Close', read: 'Read', take: 'Pick up', pickup: 'Pick up',
  drop: 'Put down', examine: 'Examine', inspect: 'Inspect', observe: 'Look at', knock: 'Knock on', eat: 'Eat', drink: 'Drink',
  give: 'Give to', show: 'Show to', talk: 'Talk to', speak: 'Talk to', write_note: 'Write a note at', use: 'Use', search: 'Search',
  sleep: 'Sleep in', rest: 'Rest on', hide: 'Hide in', put: 'Put on', lock: 'Lock', unlock: 'Unlock', move: 'Go to',
  read_phone: 'Read', call: 'Call', light: 'Light', ring: 'Ring',
};
const title = text => text ? text[0].toUpperCase() + text.slice(1) : text;
/** "Sit on Salt-bleached bench" — a human phrase for a native verb. */
export function verbPhrase(verb, targetName) {
  const phrase = VERB_PHRASES[verb] ?? title(String(verb).replace(/_/g, ' '));
  return targetName ? `${phrase} ${targetName}` : phrase;
}

/** Nearby things (from `control.nearby`) → the contextual E prompt.
 * Actors always offer "talk" first (it opens the talk box, not a world action). */
export function interactOptions(nearby, { maxVerbs = 4 } = {}) {
  const rows = (Array.isArray(nearby) ? nearby : [])
    .filter(row => row && typeof row.key === 'string' && typeof row.name === 'string')
    .map(row => ({ ...row, distance: Number.isFinite(row.distance) ? row.distance : Infinity,
      verbs: [...new Set((Array.isArray(row.verbs) ? row.verbs : []).filter(verb => typeof verb === 'string' && verb))] }))
    .map(row => row.kind === 'actor' ? { ...row, verbs: ['talk', ...row.verbs.filter(verb => verb !== 'talk' && verb !== 'speak')] } : row)
    .filter(row => row.verbs.length)
    .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name));
  const target = rows[0];
  if (!target) return null;
  const verbs = target.verbs.slice(0, maxVerbs).map((verb, index) => ({ verb, index: index + 1,
    label: verbPhrase(verb, target.name), short: title(String(verb).replace(/_/g, ' ')) }));
  return { target: { key: target.key, name: target.name, kind: target.kind, distance: target.distance },
    primary: verbs[0], verbs, others: rows.slice(1).map(row => ({ key: row.key, name: row.name, kind: row.kind })) };
}

/** Chosen verb index from a digit key while the chooser is open. */
export function verbFromKey(options, code) {
  const match = /^(?:Digit|Numpad)([1-4])$/.exec(code ?? '');
  if (!options || !match) return null;
  return options.verbs[Number(match[1]) - 1] ?? null;
}

/** Enter's talk target: the nearest resident within earshot, else the room. */
export function talkTarget(nearby, maxDistance = 3.5) {
  const actors = (Array.isArray(nearby) ? nearby : []).filter(row => row?.kind === 'actor' && typeof row.key === 'string'
    && (!Number.isFinite(row.distance) || row.distance <= maxDistance))
    .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  return actors[0] ? { key: actors[0].key, name: actors[0].name } : null;
}

/** Device-independent transport. `api(path, body)` is the authenticated helper. */
export function createBodyControls({ api }) {
  const post = (path, body = {}) => api(path, body);
  return {
    visitor: (details = {}) => post('/api/control/visitor', details),
    take: actorKey => post('/api/control/take', { actorKey }),
    release: () => post('/api/control/release', {}),
    walk: (dx, dy, run = false) => post('/api/control/walk', { dx, dy, ...(run ? { run: true } : {}) }),
    walkTo: (x, y) => post('/api/control/walk', { x, y }),
    interact: (verb, targetKey, content) => post('/api/control/act', { type: verb, ...(targetKey ? { targetKey } : {}), ...(content ? { content } : {}) }),
    say: (text, targetKey) => post('/api/control/say', { text, ...(targetKey ? { targetKey } : {}) }),
    pause: () => post('/api/pause', {}),
    resume: () => post('/api/resume', {}),
  };
}
