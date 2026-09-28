import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene, Box3 } from 'three';
import { worldTheme, sceneLighting, decorativeCoastBounds } from './theme-view.mjs';
import { createThemeScene } from './theme-scene.mjs';
import { createWeatherScene } from './weather-scene.mjs';

const rooms = [
  { id: 1, environment: 'outdoor', bounds: { x: -12, z: 30, width: 32, depth: 12 } },
  { id: 2, environment: 'indoor', bounds: { x: -8, z: 22, width: 8, depth: 8 }, building: { style: 'cottage' } },
];
const themed = { sourceId: 'saltmere', atSimMs: 1000, scenario: { id: 'town', theme: 'lovecraft' }, rooms, entities: [],
  weather: { condition: 'clear', revision: 1, changedAtSimMs: 0, rooms: [{ roomId: 1, condition: 'clear' }] } };

test('theme requires the exact public town flag, never private text or a suggestive title', () => {
  for (const scenario of [undefined, { id: 'town' }, { id: 'household', theme: 'lovecraft' },
    { id: 'town', title: 'Lovecraft', theme: 'rain' }]) assert.equal(worldTheme(scenario), null);
  const palette = worldTheme(themed.scenario);
  assert.equal(palette.id, 'lovecraft');
  palette.groundTint = '#ffffff';
  assert.notEqual(worldTheme(themed.scenario).groundTint, '#ffffff', 'projection has no shared mutable state');
});

test('ordinary illumination is unchanged; dusk still responds to committed weather', () => {
  assert.deepEqual(sceneLighting(undefined, { condition: 'clear' }), {
    keyColor: '#ffe4b7', keyIntensity: 3.6, skyColor: '#d4e7e6', skyIntensity: 2.1, groundColor: '#82704f',
  });
  const clear = sceneLighting(themed.scenario, { condition: 'clear' });
  const rain = sceneLighting(themed.scenario, { condition: 'rain' });
  assert.ok(clear.keyIntensity < 3.6 && clear.keyIntensity > rain.keyIntensity);
  assert.ok(rain.skyIntensity >= 1.5, 'overcast interiors and actors remain readable');
});

test('decorative sea stays below and beyond every native floor, including shifted worlds', () => {
  const coast = decorativeCoastBounds(rooms);
  assert.ok(coast.y < -.5);
  for (const room of rooms) assert.ok(coast.z + coast.depth <= room.bounds.z - 3.3);
  assert.equal(decorativeCoastBounds([]), null);
  assert.equal(decorativeCoastBounds([{ bounds: { x: NaN } }]), null);
});

test('theme scenery is reversible, bounded and separate from navigation/framing and native state', t => {
  const scene = new Scene(), view = createThemeScene(scene), before = structuredClone(themed);
  t.after(() => view.dispose());
  view.sync(themed);
  const { root, sea, lights } = view.diagnostics();
  assert.equal(root.parent, scene);
  assert.equal(root.userData.presentationOnly, true);
  assert.equal(lights.length, 1);
  assert.ok(scene.fog.density > 0 && scene.fog.density <= .004);
  const seaBounds = new Box3().setFromObject(sea);
  assert.ok(seaBounds.max.y < -.5 && seaBounds.max.z < 22 - 3.3);
  const initialSea = sea;
  view.sync({ ...themed, atSimMs: 2000, actors: [{ thought: 'Rain falls; build a pier.' }] });
  assert.equal(view.diagnostics().sea, initialSea, 'thoughts/time do not rebuild or create scenery');
  view.sync({ ...themed, scenario: { id: 'town' } });
  assert.equal(root.children.length, 0);
  assert.equal(scene.fog, null);
  assert.deepEqual(themed, before);
});

test('coastal palette changes neither clouds, rain, solar direction nor weather validity', t => {
  const scene = new Scene(), view = createWeatherScene(scene);
  t.after(() => view.dispose());
  for (const condition of ['clear', 'cloudy', 'rain']) {
    const state = { ...themed, weather: { ...themed.weather, condition, rooms: [{ roomId: 1, condition }] } };
    view.sync({ ...state, scenario: { id: 'town' } });
    const normal = view.diagnostics();
    const normalSky = normal.sky.material.uniforms.zenith.value.getHexString();
    const positions = normal.clouds.map(cloud => cloud.position.toArray());
    const sunPosition = normal.sun.position.toArray();
    view.sync(state);
    const coastal = view.diagnostics();
    assert.equal(coastal.condition, condition);
    assert.equal(coastal.cloudCount, normal.cloudCount);
    assert.deepEqual(coastal.rainSites, normal.rainSites);
    assert.deepEqual(coastal.clouds.map(cloud => cloud.position.toArray()), positions);
    assert.deepEqual(coastal.sun.position.toArray(), sunPosition);
    assert.notEqual(coastal.sky.material.uniforms.zenith.value.getHexString(), normalSky);
    view.sync({ ...state, scenario: { id: 'town' } });
    assert.equal(view.diagnostics().sky.material.uniforms.zenith.value.getHexString(), normalSky);
  }
  view.sync({ ...themed, weather: undefined });
  assert.equal(view.diagnostics().active, false);
  assert.equal(view.diagnostics().rainSites.length, 0);
});
