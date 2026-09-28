import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, OrthographicCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildingLayout, createTownArchitecture, revealedBuildingRooms, exteriorOccludes, buildingWallCutaway, outdoorPassage, setTownInteriors, townArchitectureSignature } from './town-architecture.mjs';
import { overviewFrame, applyOverviewFrame } from './framing-view.mjs';

function fixture() {
  const rooms = [0, 1, 2, 3].map((i) => ({ id: i + 1, key: `home-${i}`, name: `House ${i}`,
    bounds: { x: 3 + i * 12, z: 3, width: 7, depth: 6 }, environment: 'indoor',
    building: { style: 'cottage', wallColor: '#e5dcc7', roofColor: '#556876', front: 'south' } }));
  rooms.push({ id: 5, key: 'commons', name: 'Common Square', environment: 'outdoor', bounds: { x: 0, z: 9, width: 48, depth: 18 } },
    { id: 6, key: 'cafe', name: 'Copper Kettle', environment: 'indoor', bounds: { x: 2, z: 27, width: 9, depth: 7 }, building: { style: 'cafe', wallColor: '#eedbbf', roofColor: '#9d5847', front: 'north' } },
    { id: 7, key: 'workshop', name: 'Workshop', environment: 'indoor', bounds: { x: 15, z: 27, width: 9, depth: 7 }, building: { style: 'workshop', wallColor: '#c3c6b5', roofColor: '#566b69', front: 'north' } },
    { id: 8, key: 'garden', name: 'Community Garden', environment: 'outdoor', bounds: { x: 28, z: 27, width: 18, depth: 8 } });
  const entities = rooms.filter(room => room.building).map(room => ({ key: `${room.key}:passage`, kind: 'prop', asset: 'passage', roomId: room.id,
    position: { x: room.bounds.x + room.bounds.width / 2, y: 0, z: room.building.front === 'north' ? room.bounds.z : room.bounds.z + room.bounds.depth }, size: { x: 1.2, y: 2.2, z: .1 } }));
  entities.push({ key: 'indoor-resident', kind: 'actor', roomId: 1, position: { x: 5, y: 0, z: 5 }, size: { x: .5, y: 1.7, z: .5 } },
    { key: 'outdoor-resident', kind: 'actor', roomId: 5, position: { x: 22, y: 0, z: 15 }, size: { x: .5, y: 1.7, z: .5 } });
  return { scenario: { id: 'town' }, rooms, entities };
}

test('porch/awning entry follows an actual off-center native passage, not a guessed centered door', () => {
  const state = fixture(), room = state.rooms[0]; state.entities[0].position.x = 5.5;
  const layout = buildingLayout(room, state.entities);
  assert.equal(layout.doorX, 5.5); assert.equal(layout.frontZ, 9); assert.equal(layout.entranceKey, state.entities[0].key);
  assert.equal(buildingLayout(state.rooms[4], state.entities), null);
  const cafe = buildingLayout(state.rooms[5], state.entities);
  assert.equal(cafe.direction, -1); assert.equal(cafe.frontZ, 27);
});

test('roofs distinguish six buildings, stay present in overview and reveal only selected interiors', () => {
  const state = fixture(), before = JSON.stringify(state), art = createTownArchitecture(state);
  assert.equal(art.buildings.size, 6);
  let revealed = revealedBuildingRooms(state, 'indoor-resident', false, false);
  setTownInteriors(art, revealed);
  assert.equal(art.buildings.get(1).roof.visible, true);
  assert.equal(exteriorOccludes(state.entities.at(-2), state.rooms, revealed), true);
  assert.equal(exteriorOccludes(state.entities.at(-1), state.rooms, revealed), false);
  revealed = revealedBuildingRooms(state, 'indoor-resident', true, false); setTownInteriors(art, revealed);
  assert.equal(art.buildings.get(1).roof.visible, false); assert.equal(art.buildings.get(1).facade.visible, false);
  assert.equal(art.buildings.get(2).roof.visible, true);
  assert.equal(exteriorOccludes(state.entities.at(-2), state.rooms, revealed), false);
  setTownInteriors(art, revealedBuildingRooms(state, 'outdoor-resident', true, false));
  assert.ok([...art.buildings.values()].every(building => building.roof.visible));
  setTownInteriors(art, revealedBuildingRooms(state, null, false, true));
  assert.ok([...art.buildings.values()].every(building => !building.roof.visible));
  assert.equal(JSON.stringify(state), before);
});

test('town geometry is bounded, static trim is batched, and normal demos remain unchanged', () => {
  const state = fixture(), art = createTownArchitecture(state), bounds = new Box3().setFromObject(art.group);
  assert.ok(bounds.min.x < 0 && bounds.max.x > 48, 'one continuous terrain joins the visual gaps');
  assert.ok(bounds.max.y > 4, 'recognizable pitched roofs extend above native wall tops');
  assert.ok(bounds.max.y < 7 && bounds.max.x < 55 && bounds.min.x > -5);
  let meshes = 0; art.group.traverse(object => { if (object.isMesh) meshes++; });
  assert.ok(meshes < 150, `${meshes} decorative draw meshes; window/flower batching regressed`);
  assert.equal(createTownArchitecture({ ...state, scenario: undefined }).group.children.length, 0);
});

for (const [width, height] of [[719, 1120], [1280, 850]]) test(`real camera includes roof and shared terrain bounds at ${width}×${height}`, () => {
  const state = fixture(), art = createTownArchitecture(state), bounds = new Box3().setFromObject(art.group), size = bounds.getSize(new Vector3()), center = bounds.getCenter(new Vector3());
  const frame = overviewFrame(state.rooms, [...state.entities, { position: { x: center.x, y: bounds.min.y, z: center.z }, size }], width, height);
  const camera = new OrthographicCamera(-8.8 * width / height, 8.8 * width / height, 8.8, -8.8, .1, 140); camera.position.set(15, 19, 21);
  const controls = new OrbitControls(camera); applyOverviewFrame(camera, controls, frame);
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    const projected = new Vector3(x, y, z).project(camera);
    assert.ok(Math.abs(projected.x) < .96 && Math.abs(projected.y) < .96 && Math.abs(projected.z) <= 1, JSON.stringify(projected));
  }
});

test('architecture revisions track native entrance/building metadata, not NPC private thoughts', () => {
  const state = fixture(), first = townArchitectureSignature(state);
  assert.equal(townArchitectureSignature({ ...state, actors: [{ thought: 'Private story' }] }), first);
  state.entities[0].position.x -= .4; assert.notEqual(townArchitectureSignature(state), first);
  const second = townArchitectureSignature(state); state.rooms[0].building.roofColor = '#aa5533';
  assert.notEqual(townArchitectureSignature(state), second);
});
test('coastal theme changes materials, not the town envelope, entrances or roof controls', () => {
  const state = fixture(), normal = createTownArchitecture(state), first = townArchitectureSignature(state);
  const coastalState = { ...state, scenario: { id: 'town', theme: 'lovecraft' } }, before = structuredClone(coastalState);
  const coastal = createTownArchitecture(coastalState);
  assert.notEqual(townArchitectureSignature(coastalState), first);
  assert.deepEqual(new Box3().setFromObject(coastal.group), new Box3().setFromObject(normal.group));
  assert.deepEqual([...coastal.buildings.values()].map(b => b.layout), [...normal.buildings.values()].map(b => b.layout));
  let warmWindows = 0;
  coastal.group.traverse(mesh => { if (mesh.material?.emissiveIntensity > 0 && mesh.material.emissive?.getHex() > 0) warmWindows++; });
  assert.ok(warmWindows >= coastal.buildings.size, 'window treatment is warm, purely decorative material');
  setTownInteriors(coastal, revealedBuildingRooms(coastalState, 'indoor-resident', true, false));
  assert.equal(coastal.buildings.get(1).roof.visible, false);
  assert.equal(coastal.buildings.get(2).roof.visible, true);
  assert.deepEqual(coastalState, before);
});

test('closed interior prop-state labels stay behind roofs until that room is revealed', () => {
  const state = fixture(), box = { asset: 'supply-box', roomId: 7, state: 'closed' };
  assert.equal(exteriorOccludes(box, state.rooms, new Set()), true);
  assert.equal(exteriorOccludes(box, state.rooms, new Set([1])), true);
  assert.equal(exteriorOccludes(box, state.rooms, new Set([7])), false);
  assert.equal(exteriorOccludes({ ...box, roomId: 5 }, state.rooms, new Set()), false);
});

test('only outdoor-to-outdoor passage frames disappear; indoor portals and native doors remain', () => {
  const state = fixture(), gardenEntry = { asset: 'passage', position: { x: 37, y: 0, z: 27 } };
  assert.equal(outdoorPassage(gardenEntry, state.rooms), true);
  assert.equal(outdoorPassage(state.entities[0], state.rooms), false);
  assert.equal(outdoorPassage({ ...gardenEntry, asset: 'door' }, state.rooms), false);
  assert.equal(outdoorPassage({ ...gardenEntry, position: { x: 37, y: 0, z: 33 } }, state.rooms), false);
  assert.equal(outdoorPassage(gardenEntry, state.rooms.map(room => ({ ...room, environment: undefined }))), false);
});

test('follow/interiors cut away actual front and near walls without hiding another house', () => {
  const state = fixture(), room = state.rooms[0], revealed = new Set([room.id]);
  for (const [x, z] of [[4.25, 9], [8.75, 9], [10, 6]]) {
    const wall = { asset: 'wall', position: { x, z } };
    assert.equal(buildingWallCutaway(wall, room, revealed), true);
    assert.equal(buildingWallCutaway(wall, room, new Set()), false);
  }
  assert.equal(buildingWallCutaway({ asset: 'wall', position: { x: 6.5, z: 3 } }, room, revealed), false);
  assert.equal(buildingWallCutaway({ asset: 'wall', position: { x: 22, z: 6 } }, state.rooms[1], revealed), false);
});
