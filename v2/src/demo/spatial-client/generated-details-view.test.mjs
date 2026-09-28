import test from 'node:test';
import assert from 'node:assert/strict';
import { generatedDetailsPresentation } from './generated-details-view.mjs';

const entity = (details, extra = {}) => ({ key: 'prop-one', name: 'Window planter', kind: 'prop', details, ...extra });

test('generated details show only explicit public numeric/boolean output, without interpreting names', () => {
  const snapshot = { entities: [entity([{ component: 'Growth', field: 'height', value: 4.25 },
    { component: 'Glow', field: 'active', value: false }])], actors: [{ thought: 'The plants should grow taller.' }] };
  assert.deepEqual(generatedDetailsPresentation(snapshot), [{ key: 'prop-one', name: 'Window planter', details: [
    { component: 'Growth', field: 'height', value: 4.25 }, { component: 'Glow', field: 'active', value: false },
  ] }]);
  assert.deepEqual(generatedDetailsPresentation({ entities: [entity(undefined, { state: 'growing', height: 20 })] }), []);
  assert.deepEqual(generatedDetailsPresentation({ actors: snapshot.actors, development: { messages: [{ text: 'Growth.height = 5' }] } }), []);
});

test('unknown units are not invented; invalid, private-shaped or unbounded values are excluded', () => {
  const details = [NaN, Infinity, -Infinity, 1e6 + 1, -1e6 - 1, 'secret', {}, null].map(value => ({ component: 'Custom', field: 'reading', value }));
  details.push({ component: 'Custom', field: 'high', value: 1e6 }, { component: 'Custom', field: 'low', value: -1e6 },
    { component: '', field: 'missing', value: 1 }, { component: 'Custom', field: '', value: true });
  assert.deepEqual(generatedDetailsPresentation({ entities: [entity(details)] })[0].details, [
    { component: 'Custom', field: 'high', value: 1e6 }, { component: 'Custom', field: 'low', value: -1e6 },
  ]);
});

test('names remain literal text, projection is detached and all lists/text are bounded', () => {
  const snapshot = { entities: [entity([{ component: '<script>bad</script>', field: '<img onerror=bad>', value: true }], { name: '<b>Planter</b>' })] };
  const before = structuredClone(snapshot), view = generatedDetailsPresentation(snapshot);
  assert.equal(view[0].name, '<b>Planter</b>');
  assert.equal(view[0].details[0].component, '<script>bad</script>');
  view[0].details[0].value = false;
  assert.deepEqual(snapshot, before);
  const many = generatedDetailsPresentation({ entities: Array.from({ length: 100 }, (_, index) => entity(
    Array.from({ length: 100 }, (_, field) => ({ component: 'x'.repeat(300), field: String(field), value: field })),
    { key: String(index), name: 'x'.repeat(300) })) });
  assert.ok(many.length <= 24 && many.every(row => row.details.length <= 24 && row.name.length <= 120 && row.details[0].component.length <= 120));
});

test('missing entities, replaced identities and absent details cannot leave old measurements visible', () => {
  assert.equal(generatedDetailsPresentation({ entities: [entity([{ component: 'Custom', field: 'n', value: 0 }])] }).length, 1);
  for (const state of [null, {}, { entities: [] }, { entities: [entity([])] }, { entities: [entity([{ component: 'Custom', field: 'n', value: 0 }], { key: undefined })] }])
    assert.deepEqual(generatedDetailsPresentation(state), []);
});
