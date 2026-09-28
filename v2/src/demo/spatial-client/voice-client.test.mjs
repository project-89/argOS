import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceQueue, classifyVoiceError, pickRecordingType, createPushToTalk, speakableText, encodeWav, createRecorderCapture } from './voice-client.mjs';
import { createSubtitleQueue, subtitleDuration } from './subtitles.mjs';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
function harness(options = {}) {
  let clock = 0; const synthesized = [], played = [], releases = [];
  const queue = createVoiceQueue({ now: () => clock, perMinute: 3, maxPending: 3,
    synthesize: async item => { synthesized.push(item.id); if (options.fail) throw options.fail; return `audio:${item.id}`; },
    play: (audio, item) => new Promise(resolve => { played.push(item.id); releases.push(resolve); }), ...options.queue });
  return { queue, synthesized, played, finish: async () => { releases.shift()?.(); await flush(); }, tick: ms => { clock += ms; } };
}

test('lines play one at a time, in order, and the next is prefetched while one plays', async () => {
  const h = harness();
  h.queue.enqueue({ id: 'a', text: 'First.', speakerKey: 'mara' });
  h.queue.enqueue({ id: 'b', text: 'Second.', speakerKey: 'mara' });
  await flush();
  assert.deepEqual(h.played, ['a']);
  assert.deepEqual(h.synthesized, ['a', 'b'], 'b prefetched during a');
  await h.finish();
  assert.deepEqual(h.played, ['a', 'b']);
  await h.finish();
  assert.equal(h.queue.status().playing, null);
});

test('duplicates are ignored and muting clears the queue', async () => {
  const h = harness();
  assert.equal(h.queue.enqueue({ id: 'a', text: 'Hi.' }), 'queued');
  assert.equal(h.queue.enqueue({ id: 'a', text: 'Hi.' }), 'duplicate');
  h.queue.enqueue({ id: 'b', text: 'There.' });
  await flush();
  h.queue.setMuted(true);
  assert.equal(h.queue.status().pending, 0);
  assert.equal(h.queue.enqueue({ id: 'c', text: 'Muted.' }), 'muted');
});

test('client-side budget caps ordinary lines per minute; priority lines (God, interviews) still play', async () => {
  const h = harness();
  for (const id of ['a', 'b', 'c']) h.queue.enqueue({ id, text: id });
  await flush(); await h.finish(); await h.finish(); await h.finish();
  assert.equal(h.synthesized.length, 3);
  h.queue.enqueue({ id: 'd', text: 'd' }); h.queue.enqueue({ id: 'e', text: 'e' });
  await flush();
  assert.ok(!h.synthesized.includes('d'), 'over budget: not synthesized');
  h.queue.enqueue({ id: 'god', text: 'I see all.', voice: 'god', priority: true });
  await flush();
  assert.ok(h.synthesized.includes('god'));
  h.tick(61000);
  h.queue.enqueue({ id: 'f', text: 'Later.' });
  await flush(); await h.finish(); await flush();
  assert.ok(h.synthesized.includes('f'), 'budget window slides');
});

test('stale ordinary lines are skipped rather than played late', async () => {
  const h = harness();
  h.queue.enqueue({ id: 'a', text: 'Now.' });
  h.queue.enqueue({ id: 'b', text: 'Soon.' });
  h.queue.enqueue({ id: 'c', text: 'Soon too.' });
  await flush();
  h.tick(30000);
  await h.finish(); await flush();
  assert.deepEqual(h.played, ['a'], 'lines that waited too long are dropped, even if prefetched');
  assert.equal(h.queue.status().pending, 0);
});

test('server budget exhaustion stops requests; 503/404 hide voice; 429 backs off for Retry-After', async () => {
  const budget = harness({ fail: Object.assign(new Error('Voice budget exhausted'), { status: 429 }) });
  budget.queue.enqueue({ id: 'a', text: 'x' }); await flush(); await flush();
  assert.equal(budget.queue.status().exhausted, true);
  assert.equal(budget.queue.enqueue({ id: 'b', text: 'y' }), 'budget');
  for (const status of [404, 503]) {
    const missing = harness({ fail: Object.assign(new Error('No voice key'), { status }) });
    missing.queue.enqueue({ id: 'a', text: 'x' }); await flush(); await flush();
    assert.equal(missing.queue.status().available, false, String(status));
  }
  const busy = harness({ fail: Object.assign(new Error('Slow down'), { status: 429, retryAfterSeconds: 5 }) });
  busy.queue.enqueue({ id: 'a', text: 'x' }); await flush(); await flush();
  assert.equal(busy.queue.status().cooling, true);
  assert.equal(busy.queue.status().exhausted, false);
  assert.equal(busy.queue.enqueue({ id: 'b', text: 'y' }), 'cooldown');
  busy.tick(6000);
  assert.equal(busy.queue.status().cooling, false);
  assert.equal(classifyVoiceError({ status: 502, message: 'upstream' }), 'failed');
});

test('queue keeps the most recent lines when it overflows', async () => {
  let release; const played = [];
  const queue = createVoiceQueue({ now: () => 0, maxPending: 2, perMinute: 99, synthesize: async item => item.id,
    play: (audio, item) => new Promise(resolve => { played.push(item.id); release = resolve; }) });
  for (const id of ['a', 'b', 'c', 'd']) queue.enqueue({ id, text: id });
  await flush();
  for (let i = 0; i < 4; i++) { release?.(); await flush(); }
  assert.deepEqual(played, ['a', 'c', 'd']);
});

test('recording type prefers webm/opus', () => {
  assert.equal(pickRecordingType(type => type.startsWith('audio/webm')), 'audio/webm;codecs=opus');
  assert.equal(pickRecordingType(type => type === 'audio/mp4'), 'audio/mp4');
  assert.equal(pickRecordingType(), '');
});

test('push-to-talk discards short taps and transcribes held speech from the first supported capture', async () => {
  let clock = 0; const states = [];
  const capture = { supported: true, started: 0, async start() { this.started++; }, async stop() { return new Blob(['RIFF'], { type: 'audio/wav' }); }, cancel() {} };
  let received = null;
  const ptt = createPushToTalk({ captures: [{ supported: false }, capture], now: () => clock, onState: state => states.push(state),
    transcribe: async blob => { received = blob; return { text: '  Where were you last night?  ' } } });
  assert.equal(ptt.supported, true);
  await ptt.start(); clock += 100;
  assert.equal(await ptt.stop(), null, 'short tap discarded');
  await ptt.start(); clock += 1500;
  assert.equal(await ptt.stop(), 'Where were you last night?');
  assert.equal(received.type, 'audio/wav');
  assert.deepEqual(states, ['starting', 'recording', 'transcribing', 'idle', 'starting', 'recording', 'transcribing', 'idle']);
  const unsupported = createPushToTalk({ captures: [{ supported: false }], transcribe: async () => ({}) });
  assert.equal(unsupported.supported, false);
  await assert.rejects(unsupported.start());
  const denied = createPushToTalk({ captures: [{ supported: true, async start() { throw Object.assign(new Error('no'), { name: 'NotAllowedError' }); }, cancel() {} }], transcribe: async () => ({}) });
  await assert.rejects(denied.start(), /permission was declined/);
  assert.equal(denied.state, 'idle');
});

test('MediaRecorder fallback records webm/opus', async () => {
  class FakeRecorder {
    static isTypeSupported(type) { return type === 'audio/webm;codecs=opus'; }
    constructor(stream, options) { this.mimeType = options?.mimeType ?? ''; }
    start() {} stop() { this.ondataavailable({ data: new Blob(['voice'], { type: 'audio/webm' }) }); this.onstop(); }
  }
  const capture = createRecorderCapture({ media: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) }, Recorder: FakeRecorder });
  assert.equal(capture.supported, true);
  await capture.start();
  assert.equal((await capture.stop()).type, 'audio/webm');
});

test('WAV encoding: 16-bit mono PCM header, resampled to 16 kHz, clipped', () => {
  const second = new Float32Array(48000).fill(0.5); second[0] = 2; second[1] = -2;
  const wav = encodeWav([second.subarray(0, 24000), second.subarray(24000)], 48000);
  const view = new DataView(wav), tag = offset => String.fromCharCode(...new Uint8Array(wav, offset, 4));
  assert.equal(tag(0), 'RIFF'); assert.equal(tag(8), 'WAVE'); assert.equal(tag(36), 'data');
  assert.equal(view.getUint16(20, true), 1, 'PCM');
  assert.equal(view.getUint16(22, true), 1, 'mono');
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 16000 * 2, 'one second of 16 kHz samples');
  assert.equal(view.getInt16(44, true), 32767, 'clipped high');
  assert.equal(view.getInt16(46, true), 16383, 'a half-scale sample');
  assert.equal(encodeWav([], 44100).byteLength, 44);
});

test('subtitles show only newly heard lines and never replay a new body\'s backlog', () => {
  const subtitles = createSubtitleQueue({ maxVisible: 2 });
  const control = (heard, actorKey = 'eli', name = 'Eli') => ({ actorKey, name, heard });
  assert.deepEqual(subtitles.ingest(control([{ id: '1', speaker: 'Mara', text: 'Old news.', atSimMs: 1 }]), 0), [], 'backlog primed');
  const fresh = subtitles.ingest(control([{ id: '1', speaker: 'Mara', text: 'Old news.' }, { id: '2', speaker: 'Mara', text: 'Where is Leon?' }, { id: '3', speaker: 'Eli', text: 'Not here.' }]), 1000);
  assert.deepEqual(fresh.map(line => [line.id, line.self]), [['2', false], ['3', true]]);
  assert.deepEqual(subtitles.visible(1500).map(line => line.id), ['2', '3']);
  assert.deepEqual(subtitles.visible(1000 + subtitleDuration('Where is Leon?') + 1).map(l => l.id), ['3'].filter(() => subtitleDuration('Not here.') > subtitleDuration('Where is Leon?')));
  subtitles.hold('3', 60000);
  assert.deepEqual(subtitles.visible(59000).map(line => line.id), ['3']);
  assert.deepEqual(subtitles.ingest(control([{ id: '9', speaker: 'Tess', text: 'Hm.' }], 'mara', 'Mara'), 2000), [], 'new body primes again');
  assert.deepEqual(subtitles.ingest(null, 3000), []);
  assert.equal(subtitles.bodyKey, null);
});

test('subtitle durations scale with length within cinematic bounds', () => {
  assert.equal(subtitleDuration('Hi'), 2600);
  assert.equal(subtitleDuration('x'.repeat(1000)), 9000);
  assert.ok(subtitleDuration('x'.repeat(80)) > subtitleDuration('x'.repeat(20)));
});

test('own speech shows at once and the server echo is not duplicated', () => {
  const subtitles = createSubtitleQueue();
  const control = heard => ({ actorKey: 'eli', name: 'Eli', heard });
  subtitles.ingest(control([]), 0);
  subtitles.echo('Hello, Mara.', 'You', 10);
  assert.deepEqual(subtitles.visible(20).map(line => line.text), ['Hello, Mara.']);
  const fresh = subtitles.ingest(control([{ id: 's1', speaker: 'Eli', text: 'Hello, Mara.' }, { id: 's2', speaker: 'Mara', text: 'Eli.' }]), 50);
  assert.deepEqual(fresh.map(line => line.id), ['s2']);
});

test('a voiced subtitle lingers while speaking, then fades shortly after', () => {
  const subtitles = createSubtitleQueue();
  const control = heard => ({ actorKey: 'eli', name: 'Eli', heard });
  subtitles.ingest(control([]), 0);
  subtitles.ingest(control([{ id: 'a', speaker: 'Leon', text: 'Sit.' }]), 0);
  subtitles.speaking('a', true, 1000);
  assert.equal(subtitles.visible(20000)[0]?.speaking, true);
  subtitles.speaking('a', false, 20000);
  assert.equal(subtitles.visible(21000).length, 1);
  assert.equal(subtitles.visible(21500).length, 0);
});

test('speakable text trims to whole sentences', () => {
  assert.equal(speakableText('**Mara** is in the _Net House_.'), 'Mara is in the Net House.');
  const long = 'One sentence here. '.repeat(60);
  const spoken = speakableText(long, 100);
  assert.ok(spoken.length <= 100 && spoken.endsWith('.'));
  assert.ok(speakableText('x'.repeat(50) + ' ' + 'y'.repeat(200), 100).endsWith('…'));
});

test('excerpts grow in place, are not voiced, and are replaced by their completed turn', () => {
  const subtitles = createSubtitleQueue();
  const control = heard => ({ actorKey: 'visitor', name: 'Visitor', heard });
  subtitles.ingest(control([]), 0);
  assert.deepEqual(subtitles.ingest(control([{ id: 'speech-fragment:1', speaker: 'Eli', text: 'You came' }]), 10), [], 'excerpts are not voiced');
  assert.deepEqual(subtitles.visible(20).map(l => l.text), ['You came']);
  subtitles.ingest(control([{ id: 'speech-fragment:1', speaker: 'Eli', text: 'You came in on the evening bus?' }]), 30);
  assert.deepEqual(subtitles.visible(40).map(l => l.text), ['You came in on the evening bus?']);
  const done = subtitles.ingest(control([{ id: 'turn-7', speaker: 'Eli', text: 'You came in on the evening bus? Nobody comes this late.' }]), 50);
  assert.deepEqual(done.map(l => l.id), ['turn-7'], 'the completed turn is voiced');
  assert.deepEqual(subtitles.visible(60).map(l => [l.id, l.text]), [['turn-7', 'You came in on the evening bus? Nobody comes this late.']], 'one line on screen');
});
