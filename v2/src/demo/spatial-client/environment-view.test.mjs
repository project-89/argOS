import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Group, MeshStandardMaterial, OrthographicCamera, Scene, Vector3 } from 'three';
import { createCommittedEnvironmentClock, createTreeIncidentPlayback, skyPresentation, rainSegment, wetnessPresentation, tintWetMaterial } from './environment-view.mjs';
import { createWeatherScene } from './weather-scene.mjs';
import { cloudDrift, SOLAR_DIRECTION } from './world-atmosphere.mjs';

const tree = (state = 'normal', overrides = {}) => ({ id: 7, key: 'tree-a', asset: 'tree', state, ...overrides });
const snapshot = (atSimMs, state = 'normal', overrides = {}) => ({ sourceId: 'world-a', atSimMs, running: true, entities: [tree(state)], ...overrides });

test('environment clock only interpolates observed time then freezes on stalled or duplicate polls', () => {
  const clock = createCommittedEnvironmentClock();
  clock.sync(snapshot(1000), 0); assert.equal(clock.sample(10000), 1000);
  clock.sync(snapshot(1250), 250);
  assert.equal(clock.sample(250), 1000); assert.equal(clock.sample(400), 1125);
  clock.sync(snapshot(1250), 450);
  assert.equal(clock.sample(550), 1250); assert.equal(clock.sample(60000), 1250);
  clock.sync(snapshot(1200), 650); assert.equal(clock.sample(660), 1250, 'stale source time ignored');
});
test('stop and source replacement settle clocks; reduced motion never interpolates', () => {
  const clock = createCommittedEnvironmentClock(); clock.sync(snapshot(1000), 0); clock.sync(snapshot(2000), 250);
  clock.sync(snapshot(2100, 'normal', { running: false }), 300);
  assert.equal(clock.sample(300), 2100); assert.equal(clock.sample(10000), 2100);
  clock.sync(snapshot(0, 'normal', { sourceId: 'new' }), 400); assert.equal(clock.sample(10000), 0);
  const reduced = createCommittedEnvironmentClock({ reducedMotion: true });
  reduced.sync(snapshot(100), 0); reduced.sync(snapshot(200), 200); assert.equal(reduced.sample(200), 200);
});
test('only observed live tree damage triggers one short animation; duplicate polls do not renew it', () => {
  const playback = createTreeIncidentPlayback(); playback.sync(snapshot(0));
  playback.sync(snapshot(250, 'branch_damage'));
  assert.equal(playback.sample('tree-a', 250).progress, 0);
  assert.ok(playback.sample('tree-a', 1350).settle > .5);
  playback.sync(snapshot(2000, 'branch_damage'));
  assert.equal(playback.sample('tree-a', 2450), null);
  playback.sync(snapshot(2500, 'branch_damage')); assert.equal(playback.sample('tree-a', 2500), null);
});
test('joining damage, changing sources, replacement IDs and long reconnect gaps do not replay incidents', () => {
  const playback = createTreeIncidentPlayback(); playback.sync(snapshot(1000, 'branch_damage'));
  assert.equal(playback.sample('tree-a', 1000), null);
  playback.sync(snapshot(0, 'normal', { sourceId: 'b' }));
  playback.sync(snapshot(3000, 'branch_damage', { sourceId: 'b' })); assert.equal(playback.sample('tree-a', 3000), null);
  playback.sync(snapshot(3200, 'normal', { sourceId: 'b' }));
  playback.sync(snapshot(3400, 'branch_damage', { sourceId: 'b', entities: [tree('branch_damage', { id: 70 })] }));
  assert.equal(playback.sample('tree-a', 3400), null);
  playback.sync(snapshot(0, 'branch_damage', { sourceId: 'c' })); assert.equal(playback.sample('tree-a', 0), null);
});
test('stopped worlds, cleared limbs, disappeared identities and reduced motion cancel tree animation', () => {
  for (const terminal of [{ running: false }, { entities: [tree('pruned')] }, { entities: [] }]) {
    const playback = createTreeIncidentPlayback(); playback.sync(snapshot(0)); playback.sync(snapshot(250, 'branch_damage'));
    assert.ok(playback.sample('tree-a', 500)); playback.sync(snapshot(500, 'branch_damage', terminal));
    assert.equal(playback.sample('tree-a', 500), null);
  }
  const reduced = createTreeIncidentPlayback({ reducedMotion: true }); reduced.sync(snapshot(0)); reduced.sync(snapshot(250, 'branch_damage'));
  assert.equal(reduced.sample('tree-a', 250), null);
});
test('branch animation remains vertical inside existing trunk footprint and never authorizes a falling tree', () => {
  const playback = createTreeIncidentPlayback(); playback.sync(snapshot(0)); playback.sync(snapshot(250, 'branch_damage'));
  for (let at = 250; at < 2450; at += 10) {
    const pose = playback.sample('tree-a', at);
    assert.ok(pose.branchLift >= 0 && pose.branchLift <= 1.2);
    assert.ok(.2 + .32 * Math.abs(Math.sin(pose.branchRotationZ)) + .035 * Math.abs(Math.cos(pose.branchRotationZ)) < .3);
    assert.ok(Math.abs(pose.recoil) <= .025);
    assert.equal('position' in pose, false); assert.equal('collider' in pose, false);
  }
});
test('sky has bounded weather-specific sun/cloud readings, no invented weather', () => {
  assert.equal(skyPresentation(null), null); assert.equal(skyPresentation({ condition: 'storm proposed' }), null);
  assert.ok(skyPresentation({ condition: 'clear' }).sunOpacity > skyPresentation({ condition: 'rain' }).sunOpacity);
  assert.equal(skyPresentation({ condition: 'rain' }).cloudCount, 7);
  assert.deepEqual(cloudDrift(0, 100000, true), { x: 0, z: 0 });
  for (let at = 0; at < 1000000; at += 13000) {
    const drift = cloudDrift(3, at); assert.ok(Math.abs(drift.x) <= .85 && Math.abs(drift.z) <= .38);
  }
});
test('rain segment is deterministic and remains above local ground', () => {
  const site = { phase: .4, speed: 4.5 };
  for (const time of [0, 100, 100000, 9000000]) {
    const pose = rainSegment(site, time); assert.deepEqual(rainSegment(site, time), pose);
    assert.ok(pose.bottom >= .08 && pose.top <= 6.08); assert.ok(pose.top > pose.bottom);
  }
});

const rooms = [{ id: 1, environment: 'outdoor', bounds: { x: 0, z: 0, width: 10, depth: 10 } },
  { id: 2, environment: 'indoor', bounds: { x: 2, z: 2, width: 5, depth: 5 } },
  { id: 3, environment: 'outdoor', bounds: { x: 12, z: 0, width: 10, depth: 10 } }];
const rainy = { ...snapshot(1000), rooms, weather: { condition: 'rain', revision: 1, changedAtSimMs: 500,
  rooms: [{ roomId: 1, condition: 'rain' }, { roomId: 3, condition: 'clear' }] } };
test('sky, sun, and lit clouds occupy the main scene with real cloud depth', t => {
  const scene = new Scene(), view = createWeatherScene(scene), before = JSON.stringify(rainy);
  t.after(() => view.dispose()); view.sync(rainy); view.draw(1000);
  const { root, sky, sun, clouds, bounds } = view.diagnostics();
  assert.equal(root.parent, scene);
  for (const object of [sky, sun, ...clouds]) assert.equal(root.getObjectById(object.id), object, 'all atmosphere shares the world scene');
  const sunDirection = sun.position.clone().sub(new Vector3(bounds.x, 0, bounds.z)).normalize();
  assert.ok(sunDirection.distanceTo(new Vector3(SOLAR_DIRECTION.x, SOLAR_DIRECTION.y, SOLAR_DIRECTION.z)) < 1e-12,
    'the visible sun uses the same world direction as directional lighting');
  const visibleClouds = clouds.filter(cloud => cloud.visible);
  assert.ok(visibleClouds.length > 0);
  for (const cloud of visibleClouds) {
    const bounds = new Box3().setFromObject(cloud), size = bounds.getSize(new Vector3());
    assert.ok(size.x > 0 && size.y > 0 && size.z > size.y * .5, 'cloud geometry has substantial world-space depth');
    assert.ok(bounds.min.y > 6.08, 'cloud volume sits above the town rain layer');
    assert.equal(cloud.material.isMeshStandardMaterial, true, 'cloud form responds to world illumination');
    assert.equal(cloud.material.depthTest, true);
  }
  assert.equal(JSON.stringify(rainy), before);
});
test('orbiting and zooming the world camera does not move cloud geometry at the same simulation time', t => {
  const scene = new Scene(), view = createWeatherScene(scene), camera = new OrthographicCamera(-20, 20, 15, -15, .1, 1200);
  t.after(() => view.dispose()); view.sync(rainy);
  camera.position.set(25, 25, 30); camera.lookAt(10, 0, 5); camera.updateMatrixWorld(true);
  view.draw(1000, { camera }); scene.updateMatrixWorld(true);
  const clouds = view.diagnostics().clouds, positions = clouds.map(cloud => cloud.getWorldPosition(new Vector3()).toArray());
  camera.position.set(-25, 15, -30); camera.lookAt(10, 0, 5); camera.zoom = 2; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  view.draw(1000, { camera }); scene.updateMatrixWorld(true);
  assert.deepEqual(clouds.map(cloud => cloud.getWorldPosition(new Vector3()).toArray()), positions);
});
test('actual rain geometry honors local weather and excludes indoor footprints even during cutaway', t => {
  const scene = new Scene(), view = createWeatherScene(scene), before = JSON.stringify(rainy);
  t.after(() => view.dispose());
  view.sync(rainy); view.draw(1000, { interiors: true });
  const diagnostic = view.diagnostics(); assert.equal(diagnostic.cloudCount, 7); assert.equal(diagnostic.rain.visible, true);
  assert.ok(diagnostic.rainSites.length > 100 && diagnostic.rainSites.length <= 240);
  for (const site of diagnostic.rainSites) {
    assert.ok(site.x > 0 && site.x < 10 && site.z > 0 && site.z < 10, 'only the rainy outdoor room receives drops');
    assert.ok(!(site.x >= 2 && site.x <= 7 && site.z >= 2 && site.z <= 7), 'opening the roof does not admit rain indoors');
  }
  assert.equal(scene.getObjectById(diagnostic.rain.id), diagnostic.rain);
  assert.equal(diagnostic.rain.geometry.drawRange.count, diagnostic.rainSites.length * 2);
  assert.equal(JSON.stringify(rainy), before, 'presentation never writes into the public world snapshot');
});
test('inspection fades obstructing clouds without moving them or changing weather', t => {
  const view = createWeatherScene(new Scene()), camera = new OrthographicCamera(-20, 20, 15, -15, .1, 1200);
  t.after(() => view.dispose()); view.sync(rainy); view.draw(1000);
  const cloud = view.diagnostics().clouds[0], position = cloud.position.clone();
  const focusPosition = position.clone().add(new Vector3(0, -10, -10));
  camera.position.copy(position).add(new Vector3(0, 10, 10)); camera.lookAt(focusPosition);
  view.draw(1000, { camera, focusPosition });
  assert.equal(cloud.material.opacity, .14); assert.equal(cloud.material.depthWrite, false);
  assert.ok(cloud.position.equals(position)); assert.equal(view.diagnostics().condition, 'rain');
  view.sync({ ...rainy, weather: { ...rainy.weather, revision: 2 } });
  view.draw(1000, { camera, focusPosition }); assert.equal(cloud.material.opacity, .14);
  view.draw(1000, { camera, interiors: true }); assert.equal(cloud.material.opacity, .28);
  view.draw(1000, { camera }); assert.equal(cloud.material.opacity, 1);
  assert.equal(cloud.material.transparent, false); assert.equal(cloud.material.depthWrite, true);
});
test('weather source changes clear rain; invalid/proposed weather cannot keep old sky active', t => {
  const view = createWeatherScene(new Scene()); t.after(() => view.dispose()); view.sync(rainy); view.draw(1000);
  const oldPosition = view.diagnostics().clouds[0].position.clone();
  const newRooms = rooms.map(room => ({ ...room, bounds: { ...room.bounds, x: room.bounds.x + 100, z: room.bounds.z + 200 } }));
  view.sync({ ...rainy, sourceId: 'b', atSimMs: 0, rooms: newRooms, weather: { condition: 'clear', revision: 0, changedAtSimMs: 0 } });
  view.draw(0);
  assert.equal(view.diagnostics().rain.visible, false); assert.equal(view.diagnostics().cloudCount, 2);
  assert.ok(view.diagnostics().clouds[0].position.distanceTo(oldPosition) > 100, 'clouds rebind to the new world footprint');
  for (const weather of [undefined, { ...rainy.weather, condition: 'storm proposed' }, { ...rainy.weather, changedAtSimMs: 2000 }]) {
    view.sync(rainy); assert.equal(view.diagnostics().active, true);
    view.sync({ ...rainy, weather }); view.draw(1000);
    const diagnostic = view.diagnostics();
    assert.equal(diagnostic.active, false); assert.equal(diagnostic.root.visible, false);
    assert.equal(diagnostic.rain.visible, false); assert.equal(diagnostic.rainSites.length, 0);
  }
});
test('reduced-motion clouds and rain remain visible and static in the main scene', t => {
  const scene = new Scene(), view = createWeatherScene(scene, { reducedMotion: true }); t.after(() => view.dispose()); view.sync(rainy); view.draw(1000);
  const positions = [...view.diagnostics().rain.geometry.attributes.position.array];
  const cloudPositions = view.diagnostics().clouds.map(cloud => cloud.position.toArray());
  view.draw(50000); assert.deepEqual([...view.diagnostics().rain.geometry.attributes.position.array], positions);
  assert.deepEqual(view.diagnostics().clouds.map(cloud => cloud.position.toArray()), cloudPositions);
  assert.ok(view.diagnostics().clouds.some(cloud => cloud.visible));
  assert.equal(view.diagnostics().rain.visible, true); assert.ok(view.diagnostics().rainSites.length <= 60);
  assert.equal(scene.getObjectById(view.diagnostics().rain.id), view.diagnostics().rain);
});
test('disposing the atmosphere releases its geometry without removing other world objects', () => {
  const scene = new Scene(), resident = new Group(); scene.add(resident);
  const view = createWeatherScene(scene); view.sync(rainy);
  const { root, clouds } = view.diagnostics(), geometries = new Set(), materials = new Set(), disposed = new Map();
  root.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of object.material ? Array.isArray(object.material) ? object.material : [object.material] : []) materials.add(material);
  });
  for (const resource of [...geometries, ...materials, ...clouds]) resource.addEventListener('dispose', () => disposed.set(resource, (disposed.get(resource) ?? 0) + 1));
  view.dispose(); view.dispose();
  assert.equal(view.diagnostics().disposed, true); assert.equal(root.parent, null);
  assert.deepEqual(scene.children, [resident]);
  assert.equal(disposed.size, geometries.size + materials.size + clouds.length);
  assert.ok([...disposed.values()].every(count => count === 1), 'shared and per-instance resources are each released once');
});

test('wetness requires accepted numeric output and labels match native dry/damp/wet thresholds', () => {
  for (const input of [{}, { state: 'wet' }, { description: 'Standing in rain' }, { wetness: NaN }, { wetness: -1 }, { wetness: 1.1 }, { wetness: '1' }]) assert.equal(wetnessPresentation(input), null);
  assert.equal(wetnessPresentation({ wetness: .049 }).phase, 'dry');
  assert.equal(wetnessPresentation({ wetness: .05 }).label, 'Damp');
  assert.equal(wetnessPresentation({ wetness: .499 }).phase, 'damp');
  assert.equal(wetnessPresentation({ wetness: .5 }).label, 'Wet');
});
test('native wet material tint affects only its own material; dry/unavailable state preserves restored baseline', () => {
  const dry = new MeshStandardMaterial({ color: '#9abe78', roughness: .9 }), wet = dry.clone();
  tintWetMaterial(wet, wetnessPresentation({ wetness: 1 }));
  assert.ok(wet.color.r < dry.color.r); assert.ok(wet.roughness < dry.roughness);
  const prior = wet.color.clone(); tintWetMaterial(wet, null); assert.ok(wet.color.equals(prior));
  wet.color.copy(dry.color); wet.roughness = dry.roughness;
  tintWetMaterial(wet, wetnessPresentation({ wetness: 0 }));
  assert.ok(wet.color.equals(dry.color)); assert.equal(wet.roughness, dry.roughness);
  assert.equal(dry.roughness, .9);
});
