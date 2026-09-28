import test from 'node:test';
import assert from 'node:assert/strict';
import { OrthographicCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { roomExtents, overviewFrame, applyOverviewFrame, shouldInitializeOverview, roomViewSignature, actorAccent, isProjectedPointVisible } from './framing-view.mjs';

const room = (x, z, width, depth, key = 'room') => ({ key, name: key, bounds: { x, z, width, depth } });
const snapshot = (rooms, sourceId = 'world-a') => ({ sourceId, rooms });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

test('room extents follow the observed world rather than including the old apartment or origin', () => {
  assert.deepEqual(roomExtents([room(100, -50, 8, 7), room(108, -45, 12, 10)]),
    { minX: 100, maxX: 120, minZ: -50, maxZ: -35, width: 20, depth: 15 });
  assert.equal(roomExtents([]), null);
  assert.equal(roomExtents([room(NaN, 0, 8, 7), room(0, 0, 0, 7)]), null);
});

for (const [name, rooms, width, height] of [
  ['apartment', [room(0, 0, 8, 7), room(0, 7, 8, 4)], 1100, 850],
  ['ten-resident town', [room(0, 0, 32, 18)], 1400, 750],
  ['portrait town', [room(0, 0, 32, 18)], 390, 844],
  ['negative offset', [room(-60, -110, 12, 45)], 800, 800],
  ['wide world', [room(20, 30, 160, 10)], 1200, 600],
  ['later larger world', [room(500, -200, 1000, 220)], 1440, 900],
]) test(`overview contains every visual-box corner: ${name}`, () => {
  const entities = [{ position: { x: 1, y: 0, z: 1 }, size: { x: 1, y: 3, z: 1 } }];
  const frame = overviewFrame(rooms, entities, width, height), { extents } = frame;
  const halfWidth = frame.halfHeight * width / height / frame.zoom, halfHeight = frame.halfHeight / frame.zoom;
  for (const x of [extents.minX, extents.maxX]) for (const z of [extents.minZ, extents.maxZ]) for (const y of [0, 3]) {
    const offset = { x: x - frame.center.x, y: y - frame.center.y, z: z - frame.center.z };
    assert.ok(Math.abs(dot(offset, frame.right)) < halfWidth, 'horizontal corner clipped');
    assert.ok(Math.abs(dot(offset, frame.up)) < halfHeight, 'vertical corner clipped');
    assert.ok(frame.distance - dot(offset, frame.direction) > .1, 'near clip');
    assert.ok(frame.distance - dot(offset, frame.direction) < frame.far, 'far clip');
  }
});

test('ordinary polls and world expansion never request camera resets', () => {
  const original = snapshot([room(0, 0, 8, 7)]);
  const expanded = snapshot([...original.rooms, room(8, 0, 24, 18, 'new-quarter')]);
  assert.equal(shouldInitializeOverview(null, original), true);
  assert.equal(shouldInitializeOverview(original, structuredClone(original)), false);
  assert.equal(shouldInitializeOverview(original, expanded), false);
  assert.equal(shouldInitializeOverview(original, { ...original, sourceId: 'replacement' }), true);
  assert.equal(shouldInitializeOverview(snapshot([]), original), true);
  const initial = overviewFrame(original.rooms, [], 1200, 800), reset = overviewFrame(expanded.rooms, [], 1200, 800);
  assert.ok(reset.zoom < initial.zoom);
  assert.equal(reset.extents.maxX, 32);
});

test('changed room geometry, label and material are visible revisions even when the key is reused', () => {
  const original = room(0, 0, 8, 7);
  assert.equal(roomViewSignature(original), roomViewSignature(structuredClone(original)));
  assert.notEqual(roomViewSignature(original), roomViewSignature({ ...original, bounds: { ...original.bounds, width: 20 } }));
  assert.notEqual(roomViewSignature(original), roomViewSignature({ ...original, name: 'Town square' }));
  assert.notEqual(roomViewSignature(original), roomViewSignature({ ...original, floor: '#bcad92' }));
  assert.notEqual(roomViewSignature(original), roomViewSignature({ ...original, environment: 'outdoor' }));
});

for (const residualMotion of [false, true]) test(`real Three camera at 719×1120 keeps town framed after control updates (residual motion ${residualMotion})`, () => {
  const width = 719, height = 1120;
  const frame = overviewFrame([room(0, 0, 32, 18)], [{ position: { x: 31.7, y: 0, z: 8 }, size: { x: 1.6, y: 3.5, z: 1.6 } }], width, height);
  const camera = new OrthographicCamera(-8.8 * width / height, 8.8 * width / height, 8.8, -8.8, .1, 140);
  camera.position.set(15, 19, 21);
  const controls = new OrbitControls(camera); controls.enableDamping = true; controls.dampingFactor = .075;
  controls.minZoom = .4; controls.maxZoom = 2.8;
  controls.minPolarAngle = Math.PI * .12; controls.maxPolarAngle = Math.PI * .43;
  // No DOM/GPU required: the production control's pan method needs only viewport
  // dimensions. Real update/matrix math catches residual state a pure fit cannot.
  controls.domElement = { clientWidth: width, clientHeight: height };
  if (residualMotion) { controls.pan(350, -120); controls.rotateLeft(.7); }
  applyOverviewFrame(camera, controls, frame);
  for (let i = 0; i < 120; i++) controls.update();
  camera.updateMatrixWorld(true);
  assert.ok(camera.zoom < .4, 'portrait fit must not be clamped by the old minimum');
  assert.equal(camera.zoom, frame.zoom);
  assert.ok(controls.target.distanceTo(new Vector3(frame.center.x, frame.center.y, frame.center.z)) < 1e-9);
  for (const x of [frame.extents.minX, frame.extents.maxX]) for (const z of [frame.extents.minZ, frame.extents.maxZ]) for (const y of [0, 3.5]) {
    const point = new Vector3(x, y, z).project(camera);
    assert.ok(Math.abs(point.x) < .95 && Math.abs(point.y) < .95 && Math.abs(point.z) <= 1, JSON.stringify(point));
  }
});

test('overview includes actual rotated mesh envelopes beyond room edges', () => {
  const frame = overviewFrame([room(0, 0, 8, 7)], [{ position: { x: 9, y: 0, z: 3 }, size: { x: 4, y: 3, z: 1 }, rotationY: Math.PI / 2 }], 900, 800);
  assert.equal(frame.extents.maxX, 9.5);
  assert.equal(frame.extents.maxZ, 7);
});

test('resident palettes are stable without Mara/Ivo name or roster-order assumptions', () => {
  const resident = Object.freeze({ key: 'resident-anika', name: 'Anika', color: '#A1B2C3' });
  assert.equal(actorAccent(resident), '#A1B2C3');
  assert.equal(actorAccent({ key: 'resident-anika' }), actorAccent({ key: 'resident-anika', name: 'Renamed' }));
  const colors = Array.from({ length: 10 }, (_, i) => actorAccent({ key: `resident-${i}` }));
  assert.equal(new Set(colors).size, 10);
});

test('offscreen cues cannot migrate into a followed character close-up', () => {
  assert.equal(isProjectedPointVisible({ x: 0, y: 0, z: .3 }), true);
  for (const point of [{ x: 2, y: 0, z: 0 }, { x: 0, y: -2, z: 0 }, { x: 0, y: 0, z: 2 }, { x: NaN, y: 0, z: 0 }]) {
    assert.equal(isProjectedPointVisible(point), false);
  }
});

test('framing reads neither private cognition nor mutable world authority', () => {
  const rooms = Object.freeze([Object.freeze({ ...room(0, 0, 8, 7), bounds: Object.freeze({ x: 0, z: 0, width: 8, depth: 7 }) })]);
  const entities = Object.freeze([Object.freeze({ position: Object.freeze({ x: 1, y: 0, z: 2 }), size: Object.freeze({ x: .5, y: 1.7, z: .5 }) })]);
  const before = JSON.stringify({ rooms, entities });
  overviewFrame(rooms, entities, 0, 0);
  assert.equal(JSON.stringify({ rooms, entities }), before);
});
