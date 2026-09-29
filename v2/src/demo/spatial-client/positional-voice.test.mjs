import test from 'node:test';
import assert from 'node:assert/strict';
import { pannerSettings, applyPannerSettings, voiceEdgeGain, utteranceProgress, isStaleUtterance, createUtteranceVoices, createSpatialAudio } from './positional-voice.mjs';

const flush = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
const row = (id, speakerKey, extra = {}) => ({ executionId: id, speakerKey, speaker: speakerKey.toUpperCase(), distance: 3,
  startedAtSimMs: 1000, expectedEndSimMs: 11000, addressedToYou: false, ...extra });

function harness(options = {}) {
  const requests = [], plays = [], stops = [], statuses = [];
  const pending = new Map();
  let sim = options.sim ?? 1000, wall = 0;
  const voices = createUtteranceVoices({
    request: item => { requests.push(item.executionId); return options.request ? options.request(item) : new Promise((resolve, reject) => pending.set(item.executionId, { resolve, reject })); },
    play: (audio, item) => new Promise(resolve => plays.push({ id: item.executionId, speakerKey: item.speakerKey, audio, end: resolve })),
    stop: id => stops.push(id), simNow: () => sim, now: () => wall, onChange: status => statuses.push(status),
    onUnsupported: options.onUnsupported, ...options.config,
  });
  return { voices, requests, plays, stops, statuses, pending,
    arrive: (id, audio = `wav:${id}`) => pending.get(id).resolve(audio), reject: (id, error) => pending.get(id).reject(error),
    setSim: value => { sim = value; }, setWall: value => { wall = value; } };
}

test('panner parameters map the earshot to an HRTF inverse-distance source', () => {
  assert.deepEqual(pannerSettings(9), { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 1.5, maxDistance: 9, rolloffFactor: 1.2,
    coneInnerAngle: 360, coneOuterAngle: 360, coneOuterGain: 1 });
  assert.equal(pannerSettings(12).maxDistance, 12);
  assert.equal(pannerSettings(NaN).maxDistance, 9);
  const panner = applyPannerSettings({}, pannerSettings(9));
  assert.equal(panner.panningModel, 'HRTF'); assert.equal(panner.rolloffFactor, 1.2);
  // Inverse model at the edge of earshot: about a seventh of full level.
  const s = pannerSettings(9), gain = d => s.refDistance / (s.refDistance + s.rolloffFactor * (Math.max(d, s.refDistance) - s.refDistance));
  assert.ok(gain(9) > 0.1 && gain(9) < 0.2);
  assert.equal(voiceEdgeGain(3, 9), 1);
  assert.equal(voiceEdgeGain(9 * 1.15, 9), 0);
  assert.ok(voiceEdgeGain(9, 9) > 0 && voiceEdgeGain(9, 9) < 1, 'walking out of earshot fades rather than cuts');
});

test('utterance progress and staleness use simulation time', () => {
  const u = { startedAtSimMs: 1000, expectedEndSimMs: 3000 };
  assert.equal(utteranceProgress(u, 1000), 0);
  assert.equal(utteranceProgress(u, 2000), 0.5);
  assert.equal(utteranceProgress(u, 9000), 1);
  assert.equal(isStaleUtterance(u, 2400), false);
  assert.equal(isStaleUtterance(u, 2500), true);
  assert.equal(utteranceProgress({}, 5), 0, 'unknown timing is never stale');
});

test('each utterance is requested once, immediately, and played when it arrives', async () => {
  const h = harness();
  h.voices.sync([row('e1', 'leon')]);
  h.voices.sync([row('e1', 'leon')]);
  await flush();
  assert.deepEqual(h.requests, ['e1'], 'deduped by executionId');
  h.arrive('e1'); await flush();
  assert.deepEqual(h.plays.map(p => p.id), ['e1']);
  assert.equal(h.statuses.at(-1).playing[0].speakerKey, 'leon');
  h.plays[0].end(); await flush();
  h.voices.sync([row('e1', 'leon')]); await flush();
  assert.deepEqual(h.requests, ['e1'], 'a finished utterance is not replayed');
  assert.equal(h.statuses.at(-1).playing.length, 0);
});

test('audio arriving after 70% of the utterance has been spoken is dropped', async () => {
  const h = harness();
  h.voices.sync([row('late', 'leon'), row('fresh', 'mara')]);
  await flush();
  h.setSim(1000 + 0.75 * 10000);
  h.voices.sync([row('fresh', 'mara', { startedAtSimMs: 8000, expectedEndSimMs: 16000 })]);
  h.arrive('late'); await flush();
  assert.deepEqual(h.plays, [], 'stale audio is skipped');
  h.arrive('fresh'); await flush();
  assert.deepEqual(h.plays.map(p => p.id), ['fresh']);
  // An utterance first seen when already mostly over is never requested.
  h.voices.sync([row('old', 'tess', { startedAtSimMs: 0, expectedEndSimMs: 2000 })]); await flush();
  assert.ok(!h.requests.includes('old'));
});

test('at most three voices at once, one per speaker; the next waits for a slot', async () => {
  const h = harness();
  h.voices.sync([row('a1', 'a', { distance: 1 }), row('a2', 'a', { distance: 1, startedAtSimMs: 1100 }), row('b1', 'b', { distance: 2 }),
    row('c1', 'c', { distance: 3 }), row('d1', 'd', { distance: 4 })]);
  await flush();
  assert.equal(h.requests.length, 4, 'a few requests in flight at once');
  for (const id of h.requests) h.arrive(id);
  await flush();
  assert.deepEqual(h.plays.map(p => p.id).sort(), ['a1', 'b1', 'c1']);
  h.voices.sync([]); await flush();
  assert.equal(h.requests.length, 5, 'the fifth is requested once a request slot frees');
  h.arrive(h.requests[4]); await flush();
  assert.equal(h.plays.length, 3, 'still three voices');
  h.plays.find(p => p.id === 'a1').end(); await flush();
  assert.deepEqual(h.plays.map(p => p.id).slice(3).sort(), ['a2'].concat(h.plays.length > 4 ? ['d1'] : []).sort());
  assert.ok(h.plays.every((p, i) => h.plays.slice(0, i).every(q => q.speakerKey !== p.speakerKey || q.end)), 'one line per speaker at a time');
});

test('someone addressing you plays before nearer chatter', async () => {
  const h = harness({ config: { maxConcurrent: 1 } });
  h.voices.sync([row('first', 'z', { distance: 2 })]); await flush();
  h.arrive('first'); await flush();
  h.voices.sync([row('near', 'a', { distance: 1 }), row('you', 'b', { distance: 8, addressedToYou: true })]);
  await flush();
  h.arrive('near'); h.arrive('you'); await flush();
  assert.deepEqual(h.plays.map(p => p.id), ['first'], 'the slot is taken');
  h.plays[0].end(); await flush();
  assert.deepEqual(h.plays.map(p => p.id), ['first', 'you']);
});

test('404 → unsupported (fall back), 403 skipped, 429 cools down, 503 unavailable, budget exhausted', async () => {
  let fallback = 0;
  const h = harness({ onUnsupported: () => fallback++ });
  h.voices.sync([row('x', 'a')]); await flush();
  h.reject('x', Object.assign(new Error('nope'), { status: 403 })); await flush();
  assert.equal(h.voices.status().available, true);
  h.voices.sync([row('y', 'a')]); await flush();
  h.reject('y', Object.assign(new Error('slow down'), { status: 429, retryAfterSeconds: 5 })); await flush();
  assert.equal(h.voices.status().cooling, true);
  h.voices.sync([row('z', 'b')]); await flush();
  assert.ok(!h.requests.includes('z'), 'no requests during cooldown');
  h.voices.sync([row('z2', 'b', { addressedToYou: true })]); await flush();
  assert.ok(!h.requests.includes('z2'), 'cooldown holds for addressed lines too');
  h.setWall(6000);
  h.voices.sync([row('w', 'c')]); await flush();
  h.reject('w', Object.assign(new Error('gone'), { status: 404 })); await flush();
  assert.equal(h.voices.supported, false); assert.equal(fallback, 1);

  const u = harness();
  u.voices.sync([row('q', 'a')]); await flush();
  u.reject('q', Object.assign(new Error('no key'), { status: 503 })); await flush();
  assert.equal(u.voices.status().available, false);
  const b = harness();
  b.voices.sync([row('q', 'a')]); await flush();
  b.reject('q', Object.assign(new Error('Voice budget spent'), { status: 402 })); await flush();
  assert.equal(b.voices.status().exhausted, true);
  b.voices.sync([row('r', 'a')]); await flush();
  assert.deepEqual(b.requests, ['q']);
});

test('muting stops playing voices and spends nothing while muted; per-minute cap holds', async () => {
  const h = harness({ config: { perMinute: 2 } });
  h.voices.sync([row('a', 'a'), row('b', 'b'), row('c', 'c')]); await flush();
  assert.deepEqual(h.requests, ['a', 'b'], 'third over the per-minute cap is skipped');
  h.arrive('a'); await flush();
  h.voices.setMuted(true);
  assert.deepEqual(h.stops, ['a']);
  h.voices.sync([row('d', 'd', { addressedToYou: true })]); await flush();
  assert.ok(!h.requests.includes('d'));
  h.arrive('b'); await flush();
  assert.equal(h.plays.length, 1, 'late audio after mute does not play');
});

test('spatial audio places each voice at its speaker and the listener at the camera', async () => {
  const param = () => ({ value: 0, setTargetAtTime(v) { this.value = v; } });
  const nodes = [];
  const context = {
    state: 'running', currentTime: 0, destination: {},
    listener: { positionX: param(), positionY: param(), positionZ: param(), forwardX: param(), forwardY: param(), forwardZ: param(), upX: param(), upY: param(), upZ: param() },
    createGain() { const node = { gain: param(), connect() {}, disconnect() {} }; nodes.push(node); return node; },
    createPanner() { const node = { positionX: param(), positionY: param(), positionZ: param(), connect() {}, disconnect() {} }; nodes.push(node); return node; },
    createBufferSource() { const node = { connect() {}, disconnect() {}, start() { this.started = true; }, stop() { this.stopped = true; } }; nodes.push(node); return node; },
    decodeAudioData: async () => ({ duration: 1 }),
  };
  const audio = createSpatialAudio({ getContext: () => context });
  const done = audio.play(new ArrayBuffer(4), { id: 'e1', speakerKey: 'leon', position: { x: 1, y: 1.5, z: 2 } });
  await flush();
  const panner = nodes.find(n => 'panningModel' in n);
  assert.equal(panner.panningModel, 'HRTF'); assert.equal(panner.maxDistance, 9);
  assert.equal(panner.positionX.value, 1);
  audio.frame({ listener: { position: { x: 0, y: 1.6, z: 0 }, forward: { x: 0, y: 0, z: -1 }, up: { x: 0, y: 1, z: 0 } },
    positionOf: () => ({ x: 4, y: 1.5, z: -3 }), earshot: 9 });
  assert.equal(panner.positionX.value, 4); assert.equal(panner.positionZ.value, -3);
  assert.equal(context.listener.forwardZ.value, -1); assert.equal(context.listener.positionY.value, 1.6);
  assert.equal(audio.size, 1);
  audio.stop('e1');
  assert.equal(await done, 0);
  assert.equal(audio.size, 0);
});
