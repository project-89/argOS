import test from 'node:test';
import assert from 'node:assert/strict';
import { walkIntent, walkVector, createWalkSender, interactOptions, verbFromKey, verbPhrase, talkTarget, createBodyControls } from './inhabit-controls.mjs';
import { createLookState, applyLook, cameraPose, toggleView, yawBehind, wrapAngle, smoothing, pullIn } from './inhabit-camera.mjs';

const close = (a, b, epsilon = 1e-3) => assert.ok(Math.abs(a - b) < epsilon, `${a} ≈ ${b}`);

test('held keys become a walk intent; opposing keys cancel', () => {
  assert.deepEqual(walkIntent(new Set(['KeyW'])), { forward: 1, strafe: 0 });
  assert.deepEqual(walkIntent(new Set(['ArrowUp', 'ArrowRight'])), { forward: 1, strafe: 1 });
  assert.equal(walkIntent(new Set(['KeyW', 'KeyS'])), null);
  assert.equal(walkIntent(new Set(['KeyE'])), null);
});

test('walk vectors are relative to the camera heading, in engine (dx, dy) = three (x, z)', () => {
  // Yaw 0 looks toward -Z: W walks toward -dy.
  assert.deepEqual(walkVector({ forward: 1, strafe: 0 }, 0), { dx: 0, dy: -1 });
  // D strafes to the camera's right (+X at yaw 0).
  assert.deepEqual(walkVector({ forward: 0, strafe: 1 }, 0), { dx: 1, dy: 0 });
  // Turned to face -X (yaw +90°), forward walks toward -dx.
  const turned = walkVector({ forward: 1, strafe: 0 }, Math.PI / 2);
  close(turned.dx, -1); close(turned.dy, 0);
  // Diagonals are normalised to a unit direction.
  const diagonal = walkVector({ forward: 1, strafe: 1 }, 0);
  close(Math.hypot(diagonal.dx, diagonal.dy), 1);
  assert.equal(walkVector(null, 0), null);
});

test('walk sender throttles to ~6 Hz, never overlaps, reacts to turns, and stops at rest', async () => {
  const sent = [];
  let release;
  const sender = createWalkSender({ hz: 6, send: vector => { sent.push(vector); return new Promise(resolve => { release = resolve; }); } });
  assert.equal(sender.update({ dx: 0, dy: -1 }, 0), true);
  await Promise.resolve();
  assert.equal(sender.update({ dx: 0, dy: -1 }, 400), false, 'in flight');
  release(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(sender.update({ dx: 0, dy: -1 }, 100), false, 'throttled below 166ms');
  assert.equal(sender.update({ dx: 1, dy: 0 }, 110), true, 'a sharp turn sends immediately');
  release(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(sender.update(null, 500), false, 'nothing is sent at rest');
  assert.equal(sender.update({ dx: 1, dy: 0 }, 520), true);
  assert.equal(sent.length, 3);
});

test('interaction prompt picks the nearest thing and phrases its verbs', () => {
  const options = interactOptions([
    { key: 'lamp', name: 'Brass lamp', kind: 'prop', distance: 2.4, verbs: ['examine'] },
    { key: 'bench', name: 'Salt-bleached bench', kind: 'prop', distance: 1.1, verbs: ['sit', 'examine', 'sit'] },
    { key: 'nothing', name: 'Wall', kind: 'prop', distance: 0.2, verbs: [] },
  ]);
  assert.equal(options.target.key, 'bench');
  assert.equal(options.primary.label, 'Sit on Salt-bleached bench');
  assert.deepEqual(options.verbs.map(v => [v.index, v.verb]), [[1, 'sit'], [2, 'examine']]);
  assert.deepEqual(options.others.map(o => o.key), ['lamp']);
  assert.equal(interactOptions([]), null);
  assert.equal(interactOptions(undefined), null);
});

test('residents always offer talk first; at most four verbs', () => {
  const options = interactOptions([{ key: 'mara', name: 'Mara', kind: 'actor', distance: 1, verbs: ['give', 'show', 'speak', 'knock', 'examine'] }]);
  assert.deepEqual(options.verbs.map(v => v.verb), ['talk', 'give', 'show', 'knock']);
  assert.equal(options.primary.label, 'Talk to Mara');
  assert.equal(verbFromKey(options, 'Digit2').verb, 'give');
  assert.equal(verbFromKey(options, 'Digit9'), null);
  assert.equal(verbFromKey(null, 'Digit1'), null);
});

test('unknown verbs still read naturally', () => {
  assert.equal(verbPhrase('write_note', 'Cafe table 1'), 'Write a note at Cafe table 1');
  assert.equal(verbPhrase('polish_brass', 'Bell'), 'Polish brass Bell');
});

test('talk target is the nearest resident in earshot, else the room', () => {
  const nearby = [{ key: 'ivo', name: 'Ivo', kind: 'actor', distance: 2.8 }, { key: 'tess', name: 'Tess', kind: 'actor', distance: 1.2 }, { key: 'cup', name: 'Cup', kind: 'prop', distance: 0.3 }];
  assert.deepEqual(talkTarget(nearby), { key: 'tess', name: 'Tess' });
  assert.equal(talkTarget([{ key: 'far', name: 'Far', kind: 'actor', distance: 9 }]), null);
});

test('body controls route every device through the contract endpoints', async () => {
  const calls = [];
  const controls = createBodyControls({ api: async (path, body) => { calls.push([path, body]); return { ok: true }; } });
  await controls.walk(0, -1); await controls.interact('sit', 'bench'); await controls.say('Hello?', 'mara'); await controls.say('Anyone?');
  await controls.take('eli'); await controls.visitor({ name: 'Stranger' }); await controls.release(); await controls.pause(); await controls.resume();
  assert.deepEqual(calls, [
    ['/api/control/walk', { dx: 0, dy: -1 }], ['/api/control/act', { type: 'sit', targetKey: 'bench' }],
    ['/api/control/say', { text: 'Hello?', targetKey: 'mara' }], ['/api/control/say', { text: 'Anyone?' }],
    ['/api/control/take', { actorKey: 'eli' }], ['/api/control/visitor', { name: 'Stranger' }], ['/api/control/release', {}],
    ['/api/pause', {}], ['/api/resume', {}],
  ]);
});

test('look clamps pitch per view and wraps yaw', () => {
  let look = createLookState({ yaw: 0, pitch: 0 });
  look = applyLook(look, 0, 10000);
  assert.equal(look.pitch, -0.75);
  look = toggleView(look);
  assert.equal(look.view, 'first');
  look = applyLook(look, 0, -100000);
  assert.equal(look.pitch, 1.2);
  close(Math.abs(wrapAngle(Math.PI * 3)), Math.PI, 1e-9);
  close(Math.abs(yawBehind(0)), Math.PI, 1e-9);
});

test('third-person camera sits behind and above the body; first-person at the eyes', () => {
  const body = { x: 10, y: 0, z: 5 };
  const third = cameraPose(body, 1.7, { yaw: 0, pitch: -0.2, view: 'third' });
  assert.ok(third.position.z > body.z + 2, 'behind (+Z when looking -Z)');
  assert.ok(third.position.y > 1.7, 'above the head');
  assert.ok(third.target.z < body.z, 'looking ahead');
  assert.equal(third.hideBody, false);
  const indoor = cameraPose(body, 1.7, { yaw: 0, pitch: -0.2, view: 'third' }, { indoor: true });
  assert.ok(indoor.position.z < third.position.z, 'indoors pulls closer');
  const first = cameraPose(body, 1.7, { yaw: 0, pitch: 0, view: 'first' });
  close(first.position.y, 1.7 * 0.93); assert.equal(first.hideBody, true);
  assert.ok(first.target.z < first.position.z);
});

test('smoothing is frame-rate independent and bounded', () => {
  assert.equal(smoothing(0), 0);
  assert.equal(smoothing(0.1, 0), 1);
  const oneStep = smoothing(0.032), twoSteps = 1 - (1 - smoothing(0.016)) ** 2;
  close(oneStep, twoSteps, 1e-9);
});

test('camera collision pulls in just short of an obstruction, never inside the head', () => {
  const pivot = { x: 0, y: 1.5, z: 0 }, desired = { x: 0, y: 2, z: 4 };
  assert.deepEqual(pullIn(pivot, desired, null), desired);
  assert.deepEqual(pullIn(pivot, desired, 99), desired, 'hit beyond the camera is ignored');
  const pulled = pullIn(pivot, desired, 2);
  const length = Math.hypot(0, .5, 4), reached = Math.hypot(pulled.x - pivot.x, pulled.y - pivot.y, pulled.z - pivot.z);
  close(reached, 2 - .22);
  assert.ok(reached < length);
  close(Math.hypot(...Object.values(pullIn(pivot, desired, .05)).map((v, i) => v - Object.values(pivot)[i])), .3);
  const pose = cameraPose({ x: 0, y: 0, z: 0 }, 1.7, { yaw: 0, pitch: -.2, view: 'third' });
  assert.ok(pose.pivot && pose.pivot.y > 1.4);
});
