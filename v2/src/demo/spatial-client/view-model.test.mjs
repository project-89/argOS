import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { AnimationClip, AnimationMixer, Group, LoopOnce, LoopRepeat, NumberKeyframeTrack } from 'three';
import { animationFor, setPresentationAnimation, createConfirmedMotionPlayback, interpolateConfirmedPosition, latestNativeOutcome, operatorActionTargets, confirmedPhoneHolder, createSceneCueTracker, nativeNeeds, treeStatePresentation, townLifePresentation, weatherPresentation, outdoorRainSites } from './view-model.mjs';

test('tree damage and recovery are presentation of exact native states, never narrative proposals', () => {
  assert.equal(treeStatePresentation({ asset: 'chair', state: 'branch_damage' }), null);
  assert.equal(treeStatePresentation(undefined), null);
  const tree = Object.freeze({ asset: 'tree', state: 'normal', description: 'Narrator proposes a falling tree.', activity: { action: 'clear_branches' } });
  const normal = treeStatePresentation(tree);
  assert.deepEqual(normal, { state: 'normal', canopyHeight: 1, canopyScaleY: 1, leafColor: null, branch: null });
  const damaged = treeStatePresentation({ ...tree, state: 'branch_damage' });
  assert.ok(damaged.canopyHeight < normal.canopyHeight);
  assert.ok(damaged.leafColor);
  assert.ok(damaged.branch);
  const pruned = treeStatePresentation({ ...tree, state: 'pruned' });
  assert.equal(pruned.branch, null);
  assert.equal(pruned.leafColor, null);
  assert.ok(pruned.canopyScaleY < normal.canopyScaleY);
  assert.equal('trunk' in damaged, false, 'native trunk and collider are not replaced');
  assert.equal('collider' in damaged, false);
  assert.deepEqual(treeStatePresentation({ ...tree, state: 'damage proposed' }), normal);
  damaged.branch.position[0] = 100;
  assert.equal(treeStatePresentation({ asset: 'tree', state: 'branch_damage' }).branch.position[0], .2);
});

test('generated mechanic status is a separate operator diagnostic, not an applied physical change', () => {
  const state = { sourceId: 'world-a', atSimMs: 10, townLife: { enabled: true,
    mechanic: { status: 'building', summary: 'Tests pending.', remaining: 0 } } };
  const view = townLifePresentation(state);
  assert.deepEqual(view.mechanic, { status: 'building', summary: 'Tests pending.', remaining: 0 });
  assert.deepEqual(view.changes, []);
  assert.equal(townLifePresentation({ sourceId: 'world-b', atSimMs: 0, townLife: { enabled: true } }).mechanic, null);
  state.townLife.mechanic.remaining = -1; assert.equal(townLifePresentation(state).mechanic.remaining, null);
  state.townLife.mechanic.status = ''; assert.equal(townLifePresentation(state).mechanic, null);
});

test('damaged-tree branch stays inside its existing trunk footprint rather than inventing a blocked path', () => {
  const { branch } = treeStatePresentation({ asset: 'tree', state: 'branch_damage' });
  for (const dx of [-branch.size[0] / 2, branch.size[0] / 2]) {
    for (const dy of [-branch.size[1] / 2, branch.size[1] / 2]) {
      for (const dz of [-branch.size[2] / 2, branch.size[2] / 2]) {
        const x = branch.position[0] + dx * Math.cos(branch.rotationZ) - dy * Math.sin(branch.rotationZ);
        const z = branch.position[2] + dz;
        assert.ok(Math.abs(x) <= .3 && Math.abs(z) <= .3);
        assert.ok(branch.position[1] + dx * Math.sin(branch.rotationZ) + dy * Math.cos(branch.rotationZ) >= 0);
      }
    }
  }
  const client = fs.readFileSync(new URL('./client.mjs', import.meta.url), 'utf8');
  assert.match(client, /\['door', 'supply-box', 'tree'\]\.includes\(entity.asset\) && node.entity.state !== entity.state/);
  assert.match(client, /condition = treeStatePresentation\(entity\)/);
});

test('native need readings follow actual values and never infer eating or rest completion', () => {
  const actor = Object.freeze({ action: 'eating', needs: Object.freeze({ hunger: 81.25, energy: 19.5 }) });
  assert.deepEqual(nativeNeeds(actor), { hunger: 81.25, energy: 19.5 });
  const copy = nativeNeeds(actor); copy.hunger = 0;
  assert.equal(actor.needs.hunger, 81.25);
  assert.deepEqual(nativeNeeds({ ...actor, needs: { hunger: 34, energy: 19.4 } }), { hunger: 34, energy: 19.4 });
  assert.equal(nativeNeeds({ action: 'finished eating', focus: { description: 'Get some rest' } }), null);
});

test('missing or invalid needs are hidden rather than clamped or invented', () => {
  for (const actor of [undefined, {}, { needs: {} }, { needs: { hunger: NaN, energy: 30 } },
    { needs: { hunger: 0, energy: Infinity } }, { needs: { hunger: '20', energy: 30 } },
    { needs: { hunger: -1, energy: 30 } }, { needs: { hunger: 20, energy: 101 } }]) assert.equal(nativeNeeds(actor), null);
  assert.deepEqual(nativeNeeds({ needs: { hunger: 0, energy: 100 } }), { hunger: 0, energy: 100 });
});

const lifeFixture = () => ({ sourceId: 'town-one', atSimMs: 8000,
  weather: { condition: 'clear', revision: 0, changedAtSimMs: 0 }, townLife: {
  enabled: true, summary: 'The spirits are considering local needs.',
  weather: { condition: 'clear', revision: 0, changedAtSimMs: 0 },
  spirits: [{ name: 'Weaver', status: 'Considering a proposal' }, { name: 'Narrator', status: 'Listening' }],
  changes: [{ id: 'proposal-one', atSimMs: 2000, spirit: 'Weaver', status: 'proposed', summary: 'An outdoor reading bench.' }],
  growth: { remaining: 2, summary: 'Only validated spatial additions may be applied.' },
} });
test('living-world projection is optional and preserves proposal, approval, application and use distinctions', () => {
  assert.equal(townLifePresentation({ sourceId: 'legacy', atSimMs: 0 }), null);
  assert.equal(townLifePresentation({ townLife: { enabled: 'yes' } }), null);
  const state = lifeFixture(), before = JSON.stringify(state);
  const view = townLifePresentation(state);
  assert.equal(view.weather.label, 'Clear skies'); assert.equal(view.growth.remaining, 2);
  assert.equal(view.changes[0].label, 'Proposed'); assert.equal(view.changes[0].status, 'proposed');
  for (const status of ['approved', 'applied', 'used', 'rejected', 'failed', 'observed']) {
    state.townLife.changes.push({ id: status, status, spirit: 'Weaver', atSimMs: 3000, summary: `${status} receipt` });
    assert.equal(townLifePresentation(state).changes.find(change => change.id === status).status, status);
  }
  assert.equal(view.changes.length, 1, 'the returned projection is detached from later source edits');
  state.townLife.changes.splice(1); assert.equal(JSON.stringify(state), before);
});
test('living-world feed is bounded, rejects future claims and never carries receipts into another source', () => {
  const state = lifeFixture();
  state.townLife.changes = Array.from({ length: 10 }, (_, i) => ({ id: `change-${i}`, spirit: 'Steward', atSimMs: i * 500, status: 'applied', summary: `Receipt ${i}` }));
  state.townLife.changes.push({ id: 'future', spirit: 'Steward', atSimMs: 9000, status: 'used', summary: 'Not yet observed' });
  state.townLife.changes.push({ id: 'bad-status', spirit: 'Steward', atSimMs: 1000, status: 'probably done', summary: 'Not a receipt' });
  const view = townLifePresentation(state);
  assert.equal(view.changes.length, 6); assert.equal(view.changes[0].id, 'change-9');
  assert.ok(view.changes.every(change => !['future', 'bad-status'].includes(change.id)));
  const next = lifeFixture(); next.sourceId = 'town-two'; next.townLife.enabled = false; next.townLife.changes = []; next.townLife.spirits = [];
  const fresh = townLifePresentation(next);
  assert.equal(fresh.sourceId, 'town-two'); assert.equal(fresh.enabled, false);
  assert.deepEqual(fresh.changes, []); assert.deepEqual(fresh.spirits, []);
  assert.equal(townLifePresentation({ sourceId: 'town-three', atSimMs: 0 }), null);
});
test('story brief and completed narrator judgments remain distinct from physical receipts', () => {
  const state = lifeFixture();
  state.townLife.story = { style: 'Community drama', premise: 'A gathering at the cafe.', lastReviewAtSimMs: 6500,
    phase: 'rising', tension: .42, observedEvents: 12, interventions: 2, remainingEvents: 1 };
  const before = JSON.stringify(state), view = townLifePresentation(state);
  assert.deepEqual(view.story, state.townLife.story);
  assert.equal(view.changes.length, 1);
  assert.equal(view.changes[0].status, 'proposed', 'an interpretation does not become an applied event');
  assert.equal(JSON.stringify(state), before);
  state.townLife.story.phase = 'climax'; assert.equal(view.story.phase, 'rising');
  state.townLife.story.lastReviewAtSimMs = 0;
  assert.equal(townLifePresentation(state).story.lastReviewAtSimMs, 0, 'source time zero is a valid completed review time');
  assert.equal(townLifePresentation(lifeFixture()).story, null);
  const { townLife, ...publicScene } = state;
  assert.equal(townLifePresentation(publicScene), null, 'no story or private interpretation on the public scene feed');
});
test('future or absent review times never display invented phase, tension or counts', () => {
  for (const timestamp of [undefined, NaN, Infinity, -1, 8001, '6000']) {
    const state = lifeFixture();
    state.townLife.story = { style: 'Community drama', premise: 'A gathering.', lastReviewAtSimMs: timestamp,
      phase: 'rising', tension: .5, observedEvents: 99, interventions: 3, remainingEvents: 2 };
    assert.deepEqual(townLifePresentation(state).story, { style: 'Community drama', premise: 'A gathering.',
      lastReviewAtSimMs: null, phase: '', tension: null, observedEvents: null, interventions: null, remainingEvents: 2 });
  }
  const state = lifeFixture(); state.atSimMs = undefined;
  state.townLife.story = { style: 'Drama', premise: 'A gathering.', lastReviewAtSimMs: 0, phase: 'rising', tension: .5, remainingEvents: 2 };
  assert.equal(townLifePresentation(state).story.lastReviewAtSimMs, null);
});
test('story telemetry rejects invalid numbers, caps text and never copies hidden narrative fields', () => {
  const state = lifeFixture();
  state.townLife.story = { style: 'x'.repeat(500), premise: 'p'.repeat(1200), lastReviewAtSimMs: 6000,
    phase: '<script>unsafe</script>', tension: 2, observedEvents: -1, interventions: '3', remainingEvents: Infinity,
    privateMemory: 'This must stay private', rawModelOutput: 'Hidden explanation' };
  const story = townLifePresentation(state).story;
  assert.equal(story.style.length, 80); assert.equal(story.premise.length, 600);
  assert.equal(story.phase, '<script>unsafe</script>', 'view text is rendered with textContent, never interpreted as markup');
  assert.equal(story.tension, null); assert.equal(story.observedEvents, null); assert.equal(story.interventions, null); assert.equal(story.remainingEvents, null);
  assert.equal('privateMemory' in story, false); assert.equal('rawModelOutput' in story, false);
  for (const field of ['style', 'premise']) {
    const bad = structuredClone(state); bad.townLife.story[field] = '';
    assert.equal(townLifePresentation(bad).story, null);
  }
  const client = fs.readFileSync(new URL('./client.mjs', import.meta.url), 'utf8');
  const panel = client.slice(client.indexOf('function syncTownLifePanel()'), client.indexOf('function syncHouseSpirit()'));
  assert.match(panel, /safeText\(card, 'p', story.premise\)/);
  assert.match(panel, /Narrator interpretation/);
  assert.match(panel, /Not a physical world change/);
  assert.doesNotMatch(panel, /innerHTML|insertAdjacentHTML/);
});
test('unreported and future weather stays unknown; proposals cannot create rain', () => {
  const state = lifeFixture();
  state.townLife.changes[0].summary = 'Make it rain';
  assert.equal(townLifePresentation(state).weather.condition, 'clear');
  state.weather = { condition: 'rain', revision: 1, changedAtSimMs: 9000 };
  assert.equal(townLifePresentation(state).weather, null);
  state.weather.changedAtSimMs = 8000;
  assert.equal(townLifePresentation(state).weather.condition, 'rain');
  state.weather.condition = 'tornado'; assert.equal(townLifePresentation(state).weather, null);
  state.townLife.growth.remaining = -1; assert.equal(townLifePresentation(state).growth.remaining, null);
});
test('rain sites honor room-level committed weather and exclude every indoor footprint', () => {
  const rooms = [
    { id: 1, environment: 'outdoor', bounds: { x: 0, z: 0, width: 12, depth: 12 } },
    { id: 2, environment: 'indoor', bounds: { x: 3, z: 3, width: 4, depth: 4 } },
    { id: 3, environment: 'outdoor', bounds: { x: 12, z: 0, width: 12, depth: 12 } },
    { id: 4, environment: 'indoor', bounds: { x: 24, z: 0, width: 12, depth: 12 } },
  ];
  const weather = { condition: 'rain', rooms: [{ roomId: 1, condition: 'rain' }, { roomId: 3, condition: 'clear' }, { roomId: 4, condition: 'rain' }] };
  const before = JSON.stringify(rooms), sites = outdoorRainSites(rooms, weather);
  assert.equal(sites.length, 192); assert.deepEqual(outdoorRainSites(rooms, weather), sites, 'deterministic decoration');
  for (const site of sites) {
    assert.ok(site.x > 0 && site.x < 12 && site.z > 0 && site.z < 12, 'dry outdoor room and indoor-only room receive no drops');
    assert.ok(!(site.x >= 3 && site.x <= 7 && site.z >= 3 && site.z <= 7), 'roof cutaway does not admit rain inside');
    assert.ok(Number.isFinite(site.speed) && site.phase >= 0 && site.phase < 1);
  }
  assert.equal(JSON.stringify(rooms), before);
  assert.deepEqual(outdoorRainSites(rooms, { condition: 'cloudy' }), []);
  assert.deepEqual(outdoorRainSites(rooms, { condition: 'rain', rooms: [] }), []);
  assert.deepEqual(outdoorRainSites(rooms, null), []);
  assert.equal(outdoorRainSites(rooms, { condition: 'rain' }, 10000).length, 240);
  assert.deepEqual(outdoorRainSites(rooms, { condition: 'rain' }, Infinity), []);
});
test('room-level weather projection is detached and malformed entries grant no rain footprint', () => {
  const state = lifeFixture(); state.weather = { condition: 'rain', revision: 2, changedAtSimMs: 5000,
    rooms: [{ roomId: 1, condition: 'rain' }, { roomId: 2, condition: 'clear' }, { roomId: '3', condition: 'rain' }, { roomId: 4, condition: 'snow' }] };
  const view = townLifePresentation(state);
  assert.deepEqual(view.weather.rooms, [{ roomId: 1, condition: 'rain' }, { roomId: 2, condition: 'clear' }]);
  state.weather.rooms[0].condition = 'clear';
  assert.equal(view.weather.rooms[0].condition, 'rain');
});

test('public weather renders without private town-life data and never falls back to it', () => {
  const state = lifeFixture(); state.weather = { condition: 'rain', revision: 1, changedAtSimMs: 6000,
    rooms: [{ roomId: 1, condition: 'rain' }] };
  const { townLife, ...publicScene } = state;
  const before = JSON.stringify(publicScene), view = weatherPresentation(publicScene);
  assert.deepEqual(view, townLifePresentation(state).weather);
  assert.equal(view.condition, 'rain');
  assert.equal(JSON.stringify(publicScene), before);
  assert.equal(weatherPresentation({ sourceId: 'private-only', atSimMs: 8000, townLife }), null);
  assert.equal(weatherPresentation({ ...state, weather: undefined }), null);
  assert.equal(weatherPresentation({ sourceId: 'new-source', atSimMs: 0 }), null, 'no former-source weather survives');
  assert.equal(weatherPresentation({ ...publicScene, sourceId: 'new-source', atSimMs: 0 }), null, 'future old-world state is rejected');
  assert.equal(weatherPresentation({ ...publicScene, running: false }).condition, 'rain', 'stopping preserves committed physical weather');
});

test('public weather rejects invalid clocks, revisions and conditions rather than inventing state', () => {
  const valid = { condition: 'cloudy', revision: 2, changedAtSimMs: 8000 };
  for (const now of [undefined, NaN, Infinity, -1, '8000'])
    assert.equal(weatherPresentation({ atSimMs: now, weather: valid }), null);
  for (const patch of [{ condition: 'snow' }, { condition: undefined }, { revision: -1 }, { revision: 1.5 },
    { revision: '2' }, { revision: Infinity }, { changedAtSimMs: -1 }, { changedAtSimMs: 8001 },
    { changedAtSimMs: NaN }, { changedAtSimMs: Infinity }, { changedAtSimMs: '8000' }])
    assert.equal(weatherPresentation({ atSimMs: 8000, weather: { ...valid, ...patch } }), null);
  const weather = { ...valid, rooms: [{ roomId: -1, condition: 'rain' }, { roomId: 0, condition: 'cloudy' }] };
  assert.deepEqual(weatherPresentation({ atSimMs: 8000, weather }).rooms, [{ roomId: 0, condition: 'cloudy' }]);
  assert.equal(weatherPresentation({ atSimMs: 8000, weather: valid }).changedAtSimMs, 8000);
});

const cueFixture = () => ({ sourceId: 'world-a', atSimMs: 1000, running: true, entities: [{ key: 'mara' }],
  cues: [{ id: 'line-one', kind: 'speech', entityKey: 'mara', text: 'Hello ', atSimMs: 800, updatedAtSimMs: 900, expiresAtSimMs: 3000 }] });
test('duplicate polls cannot renew expired speech; new committed words can update it', () => {
  const tracker = createSceneCueTracker(), state = cueFixture();
  tracker.sync(state, 0); assert.equal(tracker.visible(100).length, 1);
  tracker.sync(state, 1900); assert.equal(tracker.visible(2100).length, 0);
  state.atSimMs = 1200; state.cues[0] = { ...state.cues[0], text: 'Hello Ivo.', updatedAtSimMs: 1200, expiresAtSimMs: 4000 };
  tracker.sync(state, 2200); assert.equal(tracker.visible(2201)[0].text, 'Hello Ivo.');
});
test('bubble source reset, deleted anchors, stop, and simulation expiry clear cues', () => {
  const tracker = createSceneCueTracker(), state = cueFixture();
  tracker.sync(state, 0); tracker.sync({ ...state, entities: [] }, 1); assert.equal(tracker.visible(2).length, 0);
  tracker.sync(state, 3); assert.equal(tracker.visible(4).length, 0);
  tracker.sync({ ...state, sourceId: 'world-b' }, 5); assert.equal(tracker.visible(6).length, 1);
  tracker.sync({ ...state, sourceId: 'world-b', running: false }, 7); assert.equal(tracker.visible(8).length, 0);
  const reloaded = createSceneCueTracker(); reloaded.sync({ ...state, atSimMs: 4000 }, 0); assert.equal(reloaded.visible(1).length, 0);
});
test('cue tracker rejects future speech and invalid timestamps; disconnected cues expire', () => {
  const tracker = createSceneCueTracker(), state = cueFixture();
  tracker.sync({ ...state, cues: [{ ...state.cues[0], updatedAtSimMs: 2000 }] }, 0); assert.equal(tracker.visible(1).length, 0);
  tracker.sync({ ...state, cues: [{ ...state.cues[0], expiresAtSimMs: Infinity }] }, 0); assert.equal(tracker.visible(1).length, 0);
  tracker.sync(state, 1); assert.equal(tracker.visible(10001).length, 0);
});

test('interpolation stays within confirmed endpoints; late playback never predicts ahead', () => {
  const from = { x: 1, y: 0, z: 2 }, to = { x: 3, y: 0, z: 4 };
  assert.deepEqual(interpolateConfirmedPosition(from, to, .5), { x: 2, y: 0, z: 3 });
  assert.deepEqual(interpolateConfirmedPosition(from, to, 100), to);
  assert.deepEqual(interpolateConfirmedPosition(from, to, -1), from);
  assert.throws(() => interpolateConfirmedPosition(from, { ...to, x: Infinity }, 1));
});
const motionFixture = (atSimMs, x, extra = {}) => ({ sourceId: 'world-a', atSimMs, running: true,
  entities: [{ key: 'mara', kind: 'actor', position: { x, y: 0, z: 0 }, activity: { action: 'walking', status: 'pending' } }], ...extra });
/** A walk at 1.25 m/s sampled every 100ms of simulation, polls arriving at the given wall gaps (sim keeps pace with wall). */
function walkWithArrivals(gaps) {
  const playback = createConfirmedMotionPlayback(); let wall = 0;
  playback.sync(motionFixture(0, 0), 0);
  const arrivals = [];
  for (const gap of gaps) { wall += gap; const sim = Math.floor(wall / 100) * 100; arrivals.push({ wall, sim }); playback.sync(motionFixture(sim, sim * 1.25 / 1000), wall); }
  return { playback, arrivals, end: wall };
}
test('irregular polls do not stop a walker: the buffer absorbs late arrivals, and the shown walk never reverses or runs ahead', () => {
  const playback = createConfirmedMotionPlayback(); playback.sync(motionFixture(0, 0), 0);
  let wall = 0, priorX = 0, latestX = 0;
  for (const gap of [250, 300, 520, 250, 260, 580, 250, 300, 250, 540, 250, 250]) {
    for (let t = wall; t < wall + gap; t += 10) {
      const shown = playback.sample('mara', t);
      if (t >= 1100) assert.equal(shown.moving, true, `no stop at ${t}ms`);
      assert.ok(shown.position.x >= priorX - 1e-9, 'never reverses');
      assert.ok(shown.position.x <= latestX + 1e-9, 'never shows an unconfirmed position');
      priorX = shown.position.x;
    }
    wall += gap; const sim = Math.floor(wall / 100) * 100; latestX = sim * 1.25 / 1000;
    playback.sync(motionFixture(sim, latestX), wall);
  }
});
test('a gap longer than the buffer holds at the newest confirmed position, then resumes from it without a jump back', () => {
  const { playback, end } = walkWithArrivals([250, 250, 250, 250]);
  const held = playback.sample('mara', end + 2000);
  assert.equal(held.moving, false);
  assert.equal(held.position.x, 1.25);
  playback.sync(motionFixture(3000, 3.75), end + 2000);
  const resumed = playback.sample('mara', end + 2001);
  assert.ok(resumed.position.x >= 1.25, 'resumes forward from where it held');
});
test('duplicate polls add nothing; a stale poll cannot rewind the view', () => {
  const { playback, end } = walkWithArrivals([250, 250, 250, 250]);
  const before = playback.sample('mara', end + 100);
  playback.sync(motionFixture(1000, 1.25), end + 50); playback.sync(motionFixture(500, 99), end + 60);
  assert.deepEqual(playback.sample('mara', end + 100), before);
});
test('a stationary actor is shown still once the view has passed its last movement', () => {
  const { playback, end } = walkWithArrivals([250, 250, 250, 250]);
  for (let i = 1; i <= 6; i++) playback.sync(motionFixture(1000 + i * 250, 1.25), end + i * 250);
  assert.equal(playback.sample('mara', end + 1500).moving, false);
  assert.equal(playback.sample('mara', end + 1500).position.x, 1.25);
});
test('source replacement, removed/reintroduced identities and stop discard old motion', () => {
  const playback = createConfirmedMotionPlayback(); playback.sync(motionFixture(0, 0), 0);
  playback.sync(motionFixture(200, 1), 250);
  playback.sync(motionFixture(300, 1.1, { running: false }), 300);
  assert.deepEqual(playback.sample('mara', 300).position, { x: 1.1, y: 0, z: 0 });
  assert.equal(playback.sample('mara', 300).moving, false);
  playback.sync(motionFixture(0, 50, { sourceId: 'world-b' }), 310);
  assert.equal(playback.sample('mara', 310).position.x, 50);
  playback.sync(motionFixture(200, 51, { sourceId: 'world-b' }), 500);
  playback.sync(motionFixture(300, 0, { sourceId: 'world-b', entities: [] }), 550);
  assert.equal(playback.sample('mara', 550), null);
  playback.sync(motionFixture(400, 70, { sourceId: 'world-b' }), 600);
  assert.equal(playback.sample('mara', 600).position.x, 70);
  assert.equal(playback.sample('mara', 600).moving, false);
});
test('reduced motion snaps, and committed inputs are immutable', () => {
  const playback = createConfirmedMotionPlayback({ reducedMotion: true });
  const state = motionFixture(200, 1); Object.freeze(state.entities[0].position); Object.freeze(state.entities[0]); Object.freeze(state.entities);
  playback.sync(motionFixture(0, 0), 0); playback.sync(state, 250);
  assert.equal(playback.sample('mara', 250).position.x, 1);
  assert.equal(playback.sample('mara', 250).moving, false);
  playback.sync(motionFixture(100, 99), 260);
  assert.equal(playback.sample('mara', 260).position.x, 1);
  playback.sample('mara', 270).position.x = 400;
  assert.equal(playback.sample('mara', 280).position.x, 1);
  assert.deepEqual(state.entities[0].position, { x: 1, y: 0, z: 0 });
  assert.throws(() => playback.sync(motionFixture(300, NaN), 500), /committed position/);
  assert.throws(() => playback.sync(motionFixture(300, 1), Infinity), /timestamp/);
});
test('real animation mixer preserves walk phase across an incidental idle gap without moving the root', () => {
  const root = new Group(), rig = new Group(); rig.name = 'rig'; root.add(rig);
  const node = { mixer: new AnimationMixer(rig), clips: ['walk', 'idle', 'pick-up'].map(name =>
    new AnimationClip(name, 1, [new NumberKeyframeTrack('.rotation[x]', [0, .5, 1], [0, .4, 0])])) };
  const modes = { loopOnce: LoopOnce, loopRepeat: LoopRepeat };
  setPresentationAnimation(node, 'walk', modes); node.mixer.update(.32);
  const walking = node.action;
  setPresentationAnimation(node, 'idle', modes); node.mixer.update(.2);
  const beforeResume = walking.time;
  assert.ok(beforeResume > .3);
  setPresentationAnimation(node, 'walk', modes);
  assert.equal(node.action, walking); assert.equal(walking.time, beforeResume); assert.equal(walking.enabled, true);
  node.mixer.update(.1); assert.ok(walking.time > beforeResume);
  assert.deepEqual(root.position.toArray(), [0, 0, 0]);
  setPresentationAnimation(node, 'pick-up', modes); node.mixer.update(.4);
  setPresentationAnimation(node, 'idle', modes); setPresentationAnimation(node, 'pick-up', modes);
  assert.equal(node.action.time, 0, 'a genuinely new one-shot interaction restarts');
});
test('planned movement and failed pickup cannot masquerade as completed physical action', () => {
  assert.equal(animationFor({ activity: { action: 'move', status: 'pending', targetId: 99 } }, false), 'idle');
  assert.equal(animationFor({ activity: { action: 'pickup', status: 'failed' } }, false), 'idle');
  assert.equal(animationFor({ activity: { action: 'sit', status: 'failed' } }, false), 'idle');
  assert.equal(animationFor({ activity: { action: 'pickup', status: 'pending' } }, false), 'pick-up');
  assert.equal(animationFor({ activity: { action: 'typing', status: 'pending' } }, false), 'interact-right');
  assert.equal(animationFor({ activity: { action: 'typing', status: 'failed' } }, false), 'idle');
  assert.equal(animationFor({ state: 'seated' }, false), 'sit');
  assert.equal(animationFor({ state: 'standing' }, true), 'walk');
});
test('phone hand presentation requires confirmed ownership and never alters source data', () => {
  const actor = Object.freeze({ id: 7, key: 'mara', kind: 'actor', position: Object.freeze({ x: 1, y: 0, z: 2 }) });
  const phone = Object.freeze({ asset: 'phone', heldBy: 7, position: Object.freeze({ x: 1, y: 0, z: 2 }) });
  assert.equal(confirmedPhoneHolder(phone, [actor]), actor);
  assert.equal(confirmedPhoneHolder({ asset: 'phone', activity: { action: 'pickup', status: 'pending', targetId: 7 } }, [actor]), undefined);
  assert.equal(confirmedPhoneHolder({ ...phone, heldBy: undefined }, [actor]), undefined);
  assert.equal(confirmedPhoneHolder(phone, []), undefined);
  assert.equal(confirmedPhoneHolder(phone, [{ ...actor, kind: 'prop' }]), undefined);
  assert.equal(confirmedPhoneHolder({ ...phone, asset: 'food' }, [actor]), undefined);
  assert.equal(phone.heldBy, 7);
  assert.deepEqual(phone.position, { x: 1, y: 0, z: 2 });
  assert.deepEqual(actor.position, { x: 1, y: 0, z: 2 });
});
test('operator admission is not shown as a native outcome; synchronous failures remain visible', () => {
  const admission = { kind: 'action', text: 'Mara begins pickup Phone' };
  assert.equal(latestNativeOutcome([admission]), undefined);
  assert.equal(latestNativeOutcome([{ kind: 'operator', text: 'Test completed' }]), undefined);
  const failure = { kind: 'action', text: 'Mara: pickup Phone · failed' };
  assert.equal(latestNativeOutcome([failure, admission]), failure);
  const completion = { kind: 'completed', text: 'Mara picked up the phone.' };
  assert.equal(latestNativeOutcome([failure, completion]), completion);
});
test('operator movement offers rooms, while dropping only offers the selected actor inventory', () => {
  const room = { key: 'room', name: 'Apartment' };
  const phone = { key: 'phone', name: 'Phone', kind: 'prop', asset: 'phone', heldBy: 1 };
  const chair = { key: 'chair', name: 'Chair', kind: 'prop', asset: 'chair' };
  const state = { rooms: [room], entities: [phone, chair,
    { key: 'wall', kind: 'prop', asset: 'wall' }, { key: 'actor', kind: 'actor' }] };
  assert.deepEqual(operatorActionTargets(state, 'move', 1), [room]);
  assert.deepEqual(operatorActionTargets(state, 'interact', 1), [phone, chair]);
  assert.deepEqual(operatorActionTargets(state, 'drop', 1), [phone]);
  assert.deepEqual(operatorActionTargets(state, 'drop', 2), []);
});
test('Blackout props use existing native interact targeting, not a new client repair authority', () => {
  const entities = ['power-panel', 'supply-box', 'repair-part'].map((asset, id) => ({ key: `prop-${id}`, kind: 'prop', asset }));
  assert.deepEqual(operatorActionTargets({ rooms: [], entities }, 'interact', 1), entities);
});
test('selected CC0 character assets resolve their local texture dependencies and animation clips', () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets');
  for (const file of ['character-a.glb', 'character-b.glb', 'character-f.glb']) {
    const bytes = fs.readFileSync(path.join(root, 'characters', file));
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
    const data = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    assert.ok(data.nodes.some(node => node.name === 'arm-right' && Number.isInteger(node.mesh)), 'right-hand presentation anchor is present');
    for (const image of data.images ?? []) { assert.ok(image.uri.startsWith('Textures/')); assert.ok(fs.existsSync(path.join(root, 'characters', image.uri))); }
    for (const clip of ['idle', 'walk', 'sit', 'pick-up']) assert.ok(data.animations.some(a => a.name === clip));
  }
  assert.match(fs.readFileSync(path.join(root, 'characters/LICENSE.txt'), 'utf8'), /CC0/);
  assert.match(fs.readFileSync(path.join(root, 'furniture/LICENSE.txt'), 'utf8'), /CC0/);
});

test('every selected asset matches its checked-in provenance manifest', () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.license, 'CC0-1.0');
  assert.equal(manifest.files.length, 16);
  for (const file of manifest.files) {
    assert.ok(!path.isAbsolute(file.path) && !file.path.includes('..'));
    const bytes = fs.readFileSync(path.join(root, file.path));
    assert.equal(bytes.length, file.bytes);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), file.sha256);
  }
  assert.ok(manifest.totalBytes < 500_000);
});

test('a building goes up part by part: what stands, the next part as an outline, scaffolding only while someone builds', async () => {
  const { constructionStages } = await import('./view-model.mjs');
  assert.equal(constructionStages(undefined), null);
  const house = { structure: 'house', stages: ['foundation', 'frame', 'walls', 'roof'], standing: 1, building: true };
  assert.deepEqual(constructionStages(house), { finished: false, scaffold: true, parts: [
    { part: 'foundation', state: 'standing' }, { part: 'frame', state: 'next' }, { part: 'walls', state: 'planned' }, { part: 'roof', state: 'planned' }] });
  assert.equal(constructionStages({ ...house, building: false }).scaffold, false);
  const done = constructionStages({ ...house, standing: 4, building: true });
  assert.equal(done.finished, true); assert.equal(done.scaffold, false);
  assert.ok(done.parts.every(p => p.state === 'standing'));
  assert.equal(constructionStages({ ...house, standing: 99 }).finished, true); // clamped
});

test('a timed craft fills its ring from the confirmed due time; nothing timed, no ring', async () => {
  const { workProgress } = await import('./view-model.mjs');
  const chopping = { action: 'chop', status: 'pending', work: { dueAtSimMs: 10_000, durationMs: 4_000 } };
  assert.equal(workProgress(chopping, 6_000), 0);
  assert.equal(workProgress(chopping, 8_000), .5);
  assert.equal(workProgress(chopping, 12_000), 1);
  assert.equal(workProgress({ action: 'walking', status: 'pending' }, 8_000), null);
  assert.equal(workProgress({ ...chopping, status: 'succeeded' }, 8_000), null);
});

test('a craft under way plays its own work motion, looped at its pace; it ends with the work', async () => {
  const { WORK_CLIPS } = await import('./view-model.mjs');
  const chopping = { activity: { action: 'chop', status: 'pending' } };
  assert.equal(animationFor(chopping, false), 'work:chop');
  assert.equal(animationFor(chopping, true), 'walk'); // walking to the tree is walking
  assert.equal(animationFor({ activity: { action: 'chop', status: 'succeeded' } }, false), 'idle');
  assert.equal(animationFor({ activity: { action: 'build', status: 'pending' } }, false), 'work:build');
  const modes = { loopOnce: LoopOnce, loopRepeat: LoopRepeat };
  const clips = ['idle', 'walk', 'attack-melee-right', 'pick-up', 'holding-both', 'interact-left', 'interact-right'].map(name =>
    new AnimationClip(name, 1, [new NumberKeyframeTrack('.rotation[x]', [0, .5, 1], [0, .4, 0])]));
  const rig = new Group(), node = { mixer: new AnimationMixer(rig), clips };
  setPresentationAnimation(node, 'work:chop', modes);
  assert.equal(node.action.getClip().name, 'attack-melee-right');
  assert.equal(node.action.timeScale, WORK_CLIPS.chop.speed);
  assert.equal(node.action.loop, LoopRepeat);
  setPresentationAnimation(node, 'work:gather', modes); // gathering repeats the stoop, it does not stop after one
  assert.equal(node.action.getClip().name, 'pick-up');
  assert.equal(node.action.loop, LoopRepeat);
  setPresentationAnimation(node, 'idle', modes);
  assert.equal(node.action.timeScale, 1);
  // Every work motion is a clip the shipped characters actually carry.
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets', 'characters');
  for (const file of ['character-a.glb', 'character-b.glb', 'character-f.glb']) {
    const glb = fs.readFileSync(path.join(root, file)).toString('latin1');
    for (const { clip } of Object.values(WORK_CLIPS)) assert.ok(glb.includes(`"name":"${clip}"`), `${file} carries ${clip}`);
  }
});
