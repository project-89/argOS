import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_EARSHOT_METRES, earshotMetres, earshotFade, planarDistance, speakerDistance, selectInhabitCues, prioritizeSubtitles } from './earshot.mjs';
import { createSubtitleQueue } from './subtitles.mjs';

test('earshot comes from the snapshot, defaulting to nine metres', () => {
  assert.equal(earshotMetres(undefined), DEFAULT_EARSHOT_METRES);
  assert.equal(earshotMetres({ earshotMetres: 12 }), 12);
  assert.equal(earshotMetres({ earshotMetres: -1 }), 9);
  assert.equal(earshotMetres({ earshotMetres: 'loud' }), 9);
  assert.equal(planarDistance({ x: 0, y: 5, z: 0 }, { x: 3, y: 0, z: 4 }), 5, 'height is ignored');
  assert.equal(planarDistance(null, { x: 0, z: 0 }), Infinity);
});

test('bubbles fade between 60% and 100% of earshot and vanish beyond', () => {
  assert.equal(earshotFade(0, 9), 1);
  assert.equal(earshotFade(5.4, 9), 1);
  assert.ok(Math.abs(earshotFade(7.2, 9) - 0.5) < 1e-9);
  assert.equal(earshotFade(9, 9), 0);
  assert.equal(earshotFade(30, 9), 0);
  assert.equal(earshotFade(Infinity, 9), 0);
  assert.ok(earshotFade(6, 9) > earshotFade(8, 9));
});

const positions = { me: { x: 0, z: 0 }, near: { x: 2, z: 0 }, mid: { x: 7.2, z: 0 }, far: { x: 30, z: 0 }, edge: { x: 0, z: 8 },
  close: { x: 1, z: 1 }, watcher: { x: 12, z: 0 } };
const positionOf = key => positions[key];
const speech = key => ({ id: `s-${key}`, kind: 'speech', entityKey: key, text: `${key} talks` });

test('Inhabit bubbles: only speakers within earshot, nearest first, capped, fading', () => {
  const cues = ['far', 'mid', 'near', 'edge', 'close', 'me'].map(speech);
  const rows = selectInhabitCues(cues, { bodyKey: 'me', positionOf, earshot: 9, maxSpeech: 3 });
  assert.deepEqual(rows.map(r => r.cue.entityKey), ['me', 'close', 'near'], 'three nearest; the far speaker never shows');
  assert.ok(rows.every(r => r.opacity === 1));
  const all = selectInhabitCues(cues, { bodyKey: 'me', positionOf, earshot: 9, maxSpeech: 10 });
  assert.ok(!all.some(r => r.cue.entityKey === 'far'));
  assert.ok(Math.abs(all.find(r => r.cue.entityKey === 'mid').opacity - 0.5) < 1e-9);
  assert.ok(all.find(r => r.cue.entityKey === 'edge').opacity < 0.5);
});

test('first person hides your own bubble; someone addressing you outranks nearer talk', () => {
  const cues = ['me', 'near', 'close', 'mid'].map(speech);
  const rows = selectInhabitCues(cues, { bodyKey: 'me', positionOf, hideOwn: true, maxSpeech: 2, addressedKeys: new Set(['mid']) });
  assert.deepEqual(rows.map(r => r.cue.entityKey), ['mid', 'close']);
});

test('actions are seen within sight, sounds heard within earshot, speech cap is separate', () => {
  const cues = [{ id: 'a1', kind: 'action', entityKey: 'watcher', text: 'sits' }, { id: 'a2', kind: 'action', entityKey: 'far', text: 'waves' },
    { id: 'b1', kind: 'sound', entityKey: 'watcher', text: 'buzz' }, { id: 'b2', kind: 'sound', entityKey: 'near', text: 'buzz' }, speech('near')];
  const rows = selectInhabitCues(cues, { bodyKey: 'me', positionOf, earshot: 9 });
  assert.deepEqual(rows.map(r => r.cue.id).sort(), ['a1', 'b2', 's-near']);
});

test('speaker distance uses speakerKey, else the speaker name, from snapshot positions', () => {
  const state = { entities: [{ key: 'me', kind: 'actor', name: 'Visitor', position: { x: 0, y: 0, z: 0 } },
    { key: 'leon', kind: 'actor', name: 'Leon', position: { x: 6, y: 0, z: 8 } }], actors: [{ key: 'leon', name: 'Leon' }] };
  assert.equal(speakerDistance(state, 'me', { speakerKey: 'leon' }), 10);
  assert.equal(speakerDistance(state, 'me', { speaker: 'Leon' }), 10);
  assert.equal(speakerDistance(state, 'me', { speaker: 'Nobody' }), undefined);
  assert.equal(speakerDistance(state, 'ghost', { speaker: 'Leon' }), undefined);
});

test('subtitle priority: addressed, then voiced, then nearest (own words count as nearest), then newest', () => {
  const lines = [
    { id: 'a', distance: 8, shownAt: 1 }, { id: 'b', distance: 2, shownAt: 2 }, { id: 'c', distance: 5, shownAt: 3, addressed: true },
    { id: 'd', distance: 7, shownAt: 4, speaking: true }, { id: 'e', self: true, shownAt: 5 },
  ];
  assert.deepEqual(prioritizeSubtitles(lines, 2).map(l => l.id), ['c', 'd'], 'kept in on-screen order');
  assert.deepEqual(prioritizeSubtitles(lines.filter(l => !l.addressed && !l.speaking), 2).map(l => l.id), ['b', 'e']);
  assert.deepEqual(prioritizeSubtitles([{ id: 'x', shownAt: 1 }, { id: 'y', shownAt: 2 }, { id: 'z', shownAt: 3 }], 2).map(l => l.id), ['y', 'z'], 'unknown distance → newest');
});

test('subtitles drop lines from beyond earshot and never voice them; at most two on screen', () => {
  const subtitles = createSubtitleQueue();
  const control = heard => ({ actorKey: 'me', name: 'Visitor', earshotMetres: 9, heard });
  subtitles.ingest(control([]), 0);
  const distances = { Leon: 3, Mara: 20, Tess: 6, Ada: 1 };
  const fresh = subtitles.ingest(control([
    { id: '1', speaker: 'Leon', text: 'Evening.' },
    { id: '2', speaker: 'Mara', text: 'Across the square.' },
    { id: '3', speaker: 'Tess', text: 'Stranger.', distance: 4 },
    { id: '4', speaker: 'Ada', text: 'Too far to hear.', distance: 12 },
  ]), 100, { distanceOf: line => distances[line.speaker] });
  assert.deepEqual(fresh.map(l => l.id), ['1', '3'], 'server distance wins over the computed one; far lines are not voiced');
  assert.deepEqual(subtitles.visible(200).map(l => l.id), ['1', '3']);
  // A far line never appears later when it grows.
  subtitles.ingest(control([{ id: '2', speaker: 'Mara', text: 'Across the square, you hear?' }]), 300, { distanceOf: line => distances[line.speaker] });
  assert.ok(!subtitles.visible(400).some(l => l.id === '2'));
  // Addressed lines take a slot first.
  subtitles.ingest(control([{ id: '5', speaker: 'Tess', text: 'You. Yes, you.', distance: 8 }]), 500, { addressedOf: line => line.speaker === 'Tess' });
  const shown = subtitles.visible(600).map(l => l.id);
  assert.equal(shown.length, 2);
  assert.ok(shown.includes('5'));
});

test('subtitles without distance information still show (server already filtered)', () => {
  const subtitles = createSubtitleQueue();
  const control = heard => ({ actorKey: 'me', name: 'Visitor', heard });
  subtitles.ingest(control([]), 0);
  assert.deepEqual(subtitles.ingest(control([{ id: 'q', speaker: 'Leon', text: 'Hello.' }]), 10).map(l => l.id), ['q']);
});
