import test from 'node:test';
import assert from 'node:assert/strict';
import { outdoorRoom, outdoorPaths, treeShape } from './terrain-view.mjs';

test('outdoor metadata, not floorboards or inferred NPC activity, selects town terrain', () => {
  assert.equal(outdoorRoom({ name: 'Common Square', environment: 'outdoor' }), true);
  assert.equal(outdoorRoom({ name: 'Community Garden', environment: 'outdoor' }), true);
  assert.equal(outdoorRoom({ name: 'Street Museum', environment: 'indoor' }), false);
  assert.equal(outdoorRoom({ name: 'Street' }), true);
  assert.equal(outdoorRoom({ name: 'Apartment', description: 'I want to go outdoors' }), false);
});

test('decorative paths stay within the authoritative outdoor room footprint', () => {
  const room = Object.freeze({ name: 'Square', environment: 'outdoor', bounds: Object.freeze({ x: 10, z: -3, width: 32, depth: 6 }) });
  const before = JSON.stringify(room), paths = outdoorPaths(room);
  assert.equal(paths.length, 2);
  for (const path of paths) {
    assert.ok(path.position[0] - path.size[0] / 2 >= room.bounds.x);
    assert.ok(path.position[0] + path.size[0] / 2 <= room.bounds.x + room.bounds.width);
    assert.ok(path.position[2] - path.size[2] / 2 >= room.bounds.z);
    assert.ok(path.position[2] + path.size[2] / 2 <= room.bounds.z + room.bounds.depth);
  }
  assert.deepEqual(outdoorPaths({ ...room, environment: 'indoor' }), []);
  assert.equal(JSON.stringify(room), before);
});

test('tree is a bounded low-poly visual envelope, not an invented collision or action', () => {
  const size = Object.freeze({ x: 1.6, y: 3.5, z: 1.6 }), tree = treeShape(size);
  assert.ok(tree.trunk.radius <= .3);
  assert.ok(tree.trunk.height < size.y);
  for (const canopy of [tree.canopy, tree.lowerCanopy]) {
    assert.ok(Math.abs(canopy.center[0]) + canopy.scale[0] <= size.x / 2);
    assert.ok(Math.abs(canopy.center[2]) + canopy.scale[2] <= size.z / 2);
    assert.ok(canopy.center[1] + canopy.scale[1] <= size.y);
    assert.ok(canopy.center[1] - canopy.scale[1] > 0);
  }
  assert.deepEqual(size, { x: 1.6, y: 3.5, z: 1.6 });
  assert.equal('collider' in tree, false);
});
