/** Positional voices for Inhabit: residents are heard where they stand.
 *
 * `control.speaking` lists utterances being spoken within the controlled
 * body's earshot. Each new one is requested once (`POST /api/voice/utterance
 * { executionId }` → the full line in the speaker's cast voice) and played as
 * soon as its audio arrives, through an HRTF PannerNode that follows the
 * speaker while the AudioListener follows the camera. Up to three different
 * speakers at once, one line per speaker; audio arriving after most of the
 * utterance has already been spoken is dropped rather than replayed late.
 *
 * Server semantics: 404 = this server has no utterance route (fall back to
 * /api/voice/speak for heard lines), 403 = the body can't hear it (skip),
 * 429 + retryAfterSeconds = cool down, 503 = no provider (voice unavailable),
 * 402/budget = spent, 502/504 = skip that line. God and interview voices in
 * Analysis stay on the non-positional queue in voice-client.mjs. */
import { classifyVoiceError, VOICE_ERRORS } from './voice-client.mjs';
import { DEFAULT_EARSHOT_METRES } from './earshot.mjs';

/** PannerNode parameters for an earshot radius (metres). Inverse distance:
 * full level within 1.5 m, about a seventh of it at nine metres. */
export function pannerSettings(earshot = DEFAULT_EARSHOT_METRES) {
  const maxDistance = Number.isFinite(earshot) && earshot > 0 ? earshot : DEFAULT_EARSHOT_METRES;
  return { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 1.5, maxDistance, rolloffFactor: 1.2,
    coneInnerAngle: 360, coneOuterAngle: 360, coneOuterGain: 1 };
}

/** Apply `pannerSettings` to a PannerNode (or any object with those fields). */
export function applyPannerSettings(panner, settings) {
  for (const [key, value] of Object.entries(settings)) {
    try { panner[key] = value; } catch {}
  }
  return panner;
}

/** Extra gain so a speaker walking out of earshot mid-line fades out instead of
 * cutting: 1 to 75% of earshot, silent at 115%. */
export function voiceEdgeGain(distance, earshot = DEFAULT_EARSHOT_METRES) {
  if (!Number.isFinite(distance)) return 1;
  const start = earshot * 0.75, end = earshot * 1.15;
  if (distance <= start) return 1;
  if (distance >= end) return 0;
  return (end - distance) / (end - start);
}

/** Fraction of an utterance already spoken at `simNow` (0..1). */
export function utteranceProgress(row, simNow) {
  const start = Number(row?.startedAtSimMs), end = Number(row?.expectedEndSimMs);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(simNow)) return 0;
  if (end <= start) return simNow >= end ? 1 : 0;
  return Math.max(0, Math.min(1, (simNow - start) / (end - start)));
}

export const isStaleUtterance = (row, simNow, fraction = 0.7) => utteranceProgress(row, simNow) > fraction;

const validRow = row => row && typeof row.executionId === 'string' && row.executionId
  && typeof row.speakerKey === 'string' && row.speakerKey;

/** Scheduling (pure around injected `request`/`play`/`stop`). */
export function createUtteranceVoices({ request, play, stop = () => {}, simNow = () => 0, now = () => Date.now(),
  maxConcurrent = 3, maxInFlight = 4, staleFraction = 0.7, perMinute = 30, maxSeen = 400,
  onChange = () => {}, onUnsupported = () => {} } = {}) {
  let muted = false, available = true, supported = true, exhausted = false, cooldownUntil = 0, generation = 0;
  let seen = new Set();
  const items = new Map(), requests = [];
  const emit = () => { try { onChange(status()); } catch {} };
  const remember = id => { seen.add(id); if (seen.size > maxSeen) seen = new Set([...seen].slice(-Math.floor(maxSeen / 2))); };
  const playing = () => [...items.values()].filter(item => item.phase === 'playing');
  const inFlight = () => [...items.values()].filter(item => item.phase === 'requesting').length;
  const withinBudget = priority => {
    const cutoff = now() - 60000;
    while (requests.length && requests[0] < cutoff) requests.shift();
    return priority || requests.length < perMinute;
  };
  const order = (a, b) => (Number(!!b.addressedToYou) - Number(!!a.addressedToYou))
    || ((Number.isFinite(a.distance) ? a.distance : 99) - (Number.isFinite(b.distance) ? b.distance : 99))
    || ((a.startedAtSimMs ?? 0) - (b.startedAtSimMs ?? 0));
  const blocked = () => muted || !available || !supported || exhausted;
  function status() {
    return { muted, available, supported, exhausted, cooling: now() < cooldownUntil,
      playing: playing().map(item => ({ executionId: item.executionId, speakerKey: item.speakerKey, speaker: item.speaker })),
      pending: [...items.values()].filter(item => item.phase !== 'playing').length };
  }
  function fail(item, error, mine) {
    if (mine !== generation) return;
    items.delete(item.executionId);
    if (error?.status === 403) return; // Out of earshot now: never heard it.
    if (error?.status === 404) { supported = false; items.clear(); try { onUnsupported(); } catch {} return; }
    const kind = classifyVoiceError(error);
    if (kind === VOICE_ERRORS.unavailable) { available = false; items.clear(); }
    else if (kind === VOICE_ERRORS.budget) { exhausted = true; items.clear(); }
    else if (kind === VOICE_ERRORS.cooldown) cooldownUntil = now() + Math.max(2, Number(error?.retryAfterSeconds) || 10) * 1000;
  }
  function pump() {
    const mine = generation, at = simNow();
    for (const item of [...items.values()]) {
      if (item.phase !== 'playing' && isStaleUtterance(item, at, staleFraction)) items.delete(item.executionId);
    }
    if (blocked()) { emit(); return; }
    // Request the most important waiting lines, a few at a time.
    const waiting = [...items.values()].filter(item => item.phase === 'waiting').sort(order);
    for (const item of waiting) {
      if (inFlight() >= maxInFlight) break;
      if (now() < cooldownUntil) break;
      if (!withinBudget(item.addressedToYou)) { items.delete(item.executionId); continue; }
      requests.push(now()); item.phase = 'requesting';
      Promise.resolve().then(() => request(item)).then(audio => {
        if (mine !== generation || items.get(item.executionId) !== item) return;
        item.audio = audio; item.phase = 'ready'; pump();
      }, error => { fail(item, error, mine); pump(); });
    }
    // Play what has arrived: one line per speaker, a few speakers at once.
    const ready = [...items.values()].filter(item => item.phase === 'ready').sort(order);
    for (const item of ready) {
      const active = playing();
      if (active.length >= maxConcurrent) break;
      if (active.some(row => row.speakerKey === item.speakerKey)) continue;
      item.phase = 'playing';
      Promise.resolve().then(() => play(item.audio, item)).catch(() => {}).finally(() => {
        if (items.get(item.executionId) === item) items.delete(item.executionId);
        if (mine === generation) pump(); else emit();
      });
    }
    emit();
  }
  return {
    /** `speaking`: the snapshot's `control.speaking` rows (feature-detected). */
    sync(speaking) {
      if (!Array.isArray(speaking)) return;
      for (const row of speaking) {
        if (!validRow(row)) continue;
        const known = items.get(row.executionId);
        // A voice-gated line reports its real start once its audio is ready
        // (it "draws breath" first), so timing is refreshed, not fixed at first sight.
        if (known) { known.distance = row.distance; known.addressedToYou = !!row.addressedToYou;
          if (Number.isFinite(row.startedAtSimMs)) known.startedAtSimMs = row.startedAtSimMs;
          if (Number.isFinite(row.expectedEndSimMs)) known.expectedEndSimMs = row.expectedEndSimMs; continue; }
        if (seen.has(row.executionId)) continue;
        remember(row.executionId);
        if (blocked()) continue;
        if (!row.addressedToYou && now() < cooldownUntil) continue;
        items.set(row.executionId, { executionId: row.executionId, speakerKey: row.speakerKey, speaker: String(row.speaker ?? ''),
          distance: row.distance, addressedToYou: !!row.addressedToYou, startedAtSimMs: row.startedAtSimMs,
          expectedEndSimMs: row.expectedEndSimMs, phase: 'waiting' });
      }
      pump();
    },
    setMuted(value) {
      muted = !!value;
      if (muted) this.interrupt(); else emit();
    },
    /** Stop everything now (leaving Inhabit, changing body) without muting. */
    interrupt() {
      generation++;
      for (const item of items.values()) if (item.phase === 'playing') { try { stop(item.executionId); } catch {} }
      items.clear(); emit();
    },
    setAvailable(value) { available = !!value; if (!available) this.interrupt(); else emit(); },
    get supported() { return supported; },
    status,
  };
}

const setParam = (param, value, context) => {
  if (!param) return false;
  if (typeof param.setTargetAtTime === 'function' && context) param.setTargetAtTime(value, context.currentTime, 0.04);
  else param.value = value;
  return true;
};

/** Web Audio rendering: per voice BufferSource → edge gain → HRTF panner →
 * master gain; `frame()` moves the listener with the camera and each panner
 * with its speaker. `getContext()` shares the page's AudioContext. */
export function createSpatialAudio({ getContext, masterGain = 1 } = {}) {
  const voices = new Map();
  let master = null, context = null, earshot = DEFAULT_EARSHOT_METRES;
  const ensure = () => {
    const ctx = getContext();
    if (ctx !== context) { context = ctx; master = ctx.createGain(); master.gain.value = masterGain; master.connect(ctx.destination); }
    return ctx;
  };
  return {
    /** Resolves when the line ends (or is stopped). */
    async play(bytes, { id, speakerKey, position } = {}) {
      const ctx = ensure();
      if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
      const buffer = await ctx.decodeAudioData(bytes.slice(0));
      return new Promise(resolve => {
        const source = ctx.createBufferSource(), gain = ctx.createGain(), panner = applyPannerSettings(ctx.createPanner(), pannerSettings(earshot));
        source.buffer = buffer; source.connect(gain); gain.connect(panner); panner.connect(master);
        if (position) { setParam(panner.positionX, position.x) || panner.setPosition?.(position.x, position.y, position.z); setParam(panner.positionY, position.y); setParam(panner.positionZ, position.z); }
        const voice = { source, gain, panner, speakerKey, resolve };
        source.onended = () => { if (voices.get(id) === voice) voices.delete(id); try { source.disconnect(); gain.disconnect(); panner.disconnect(); } catch {} resolve(buffer.duration); };
        voices.set(id, voice); source.start();
      });
    },
    /** listener: { position, forward, up } in world metres; positionOf(speakerKey) → {x,y,z} | null. */
    frame({ listener, positionOf, earshot: radius = earshot } = {}) {
      earshot = Number.isFinite(radius) && radius > 0 ? radius : DEFAULT_EARSHOT_METRES;
      if (!context || !voices.size) return;
      const l = context.listener;
      if (listener && l) {
        const { position: p, forward: f, up: u } = listener;
        if (l.positionX) { setParam(l.positionX, p.x, context); setParam(l.positionY, p.y, context); setParam(l.positionZ, p.z, context);
          setParam(l.forwardX, f.x, context); setParam(l.forwardY, f.y, context); setParam(l.forwardZ, f.z, context);
          setParam(l.upX, u.x, context); setParam(l.upY, u.y, context); setParam(l.upZ, u.z, context); }
        else { l.setPosition?.(p.x, p.y, p.z); l.setOrientation?.(f.x, f.y, f.z, u.x, u.y, u.z); }
      }
      for (const voice of voices.values()) {
        const at = positionOf?.(voice.speakerKey);
        if (!at) continue;
        if (voice.panner.maxDistance !== earshot) voice.panner.maxDistance = earshot;
        if (voice.panner.positionX) { setParam(voice.panner.positionX, at.x, context); setParam(voice.panner.positionY, at.y, context); setParam(voice.panner.positionZ, at.z, context); }
        else voice.panner.setPosition?.(at.x, at.y, at.z);
        if (listener) setParam(voice.gain.gain, voiceEdgeGain(Math.hypot(at.x - listener.position.x, at.z - listener.position.z), earshot), context);
      }
    },
    stop(id) { const voice = voices.get(id); if (!voice) return; voices.delete(id); try { voice.source.stop(); } catch {} voice.resolve(0); },
    stopAll() { for (const id of [...voices.keys()]) this.stop(id); },
    get size() { return voices.size; },
  };
}
