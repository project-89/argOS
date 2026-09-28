import test from 'node:test';
import assert from 'node:assert/strict';
import { scenarioLighting, allowsAuthoredCafe, passageFrameParts, worldPresentation } from './scenario-view.mjs';

test('ordinary worlds keep their existing lighting', () => {
  assert.deepEqual(scenarioLighting(), { dim: false, lampOn: false });
  assert.deepEqual(scenarioLighting({ id: 'other', power: 'off' }), { dim: false, lampOn: false });
});
test('blackout lighting follows only the authoritative power field', () => {
  assert.deepEqual(scenarioLighting({ id: 'blackout', power: 'off', phase: 'I fixed the power', complete: true }), { dim: true, lampOn: false });
  assert.deepEqual(scenarioLighting({ id: 'blackout', power: 'on', complete: false }), { dim: false, lampOn: true });
  assert.deepEqual(scenarioLighting({ id: 'blackout', phase: 'power on' }), { dim: false, lampOn: false });
});
test('power changes are reversible and projection does not mutate scenario state', () => {
  const off = Object.freeze({ id: 'blackout', title: 'Blackout', power: 'off', phase: 'Find a way to restore the lights', complete: false });
  const before = structuredClone(off);
  assert.equal(scenarioLighting(off).dim, true);
  assert.equal(scenarioLighting({ ...off, power: 'on' }).lampOn, true);
  assert.equal(scenarioLighting(off).lampOn, false);
  assert.deepEqual(off, before);
});
test('Blackout never substitutes authored café construction for its gated growth', () => {
  assert.equal(allowsAuthoredCafe(), true);
  assert.equal(allowsAuthoredCafe({ id: 'blackout', power: 'off', complete: false }), false);
  assert.equal(allowsAuthoredCafe({ id: 'blackout', power: 'on', complete: true }), false);
  assert.equal(allowsAuthoredCafe(undefined), true);
});
test('town presentation names the authored testbed and keeps construction gated', () => {
  const state = { scenario: { id: 'town', title: 'A town of their own.', phase: 'Ready' },
    actors: Array.from({ length: 10 }, (_, i) => ({ key: `resident-${i}` })), rooms: Array(9).fill({}),
    growth: { status: 'gated', summary: 'Spatial construction is not verified; autonomous growth is disabled.' } };
  assert.equal(allowsAuthoredCafe(state.scenario), false);
  assert.equal(allowsAuthoredCafe({ id: 'future-scenario' }), false);
  const copy = worldPresentation(state);
  assert.match(copy.description, /10 residents\. 9 places/);
  assert.equal(copy.growth, state.growth.summary);
  assert.equal(copy.title, state.scenario.title);
  assert.equal(copy.rosterTitle, 'Meet the residents.');
  assert.deepEqual(scenarioLighting(state.scenario), { dim: false, lampOn: false });
});
test('permanent passage geometry is a frame with no door slab blocking its center', () => {
  const parts = passageFrameParts({ x: 1.2, y: 2.2, z: .1 });
  assert.equal(parts.length, 3);
  assert.ok(parts[0].position[0] < 0 && parts[1].position[0] > 0);
  assert.ok(parts[2].position[1] - parts[2].size[1] / 2 > 2);
  assert.ok(parts.every(part => Math.abs(part.position[0]) > part.size[0] / 2 || part.position[1] - part.size[1] / 2 > 1.8));
});
test('Saltmere copy describes a grounded coastal mystery without asserting supernatural events', () => {
  const state = { scenario: { id: 'town', theme: 'lovecraft', title: 'Argos · Saltmere' }, actors: Array(8).fill({}), rooms: Array(9).fill({}) };
  const copy = worldPresentation(state);
  assert.equal(copy.title, state.scenario.title);
  assert.match(copy.description, /coastal mystery/i);
  assert.match(copy.description, /8 residents\. 9 places/);
  assert.doesNotMatch(copy.description, /apartment|rain|monster|ritual/i);
  assert.equal(allowsAuthoredCafe(state.scenario), false);
});
test('household names its four-person experiment without promising an outcome', () => {
  const state = { scenario: { id: 'household', title: 'An afternoon together' }, actors: Array(4).fill({}) };
  assert.equal(worldPresentation(state).title, state.scenario.title);
  assert.match(worldPresentation(state).description, /4 people/);
  assert.equal(allowsAuthoredCafe(state.scenario), false);
  assert.deepEqual(scenarioLighting(state.scenario), { dim: false, lampOn: false });
});
