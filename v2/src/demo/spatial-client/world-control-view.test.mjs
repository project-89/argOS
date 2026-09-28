import test from 'node:test';
import assert from 'node:assert/strict';
import { worldControlAvailability, worldCommandReceipt, isCurrentWorldCommand } from './world-control-view.mjs';

const state = { sourceId: 'one', running: true, scenario: { id: 'blackout' }, worldControl: { available: true, busy: false, summary: 'Power and supply-box controls only.' } };
test('house spirit controls require active server availability and never appear in the ordinary absent-feature demo', () => {
  assert.equal(worldControlAvailability({ running: true }).visible, false);
  assert.equal(worldControlAvailability(state).disabled, false);
  assert.equal(worldControlAvailability({ ...state, running: false }).disabled, true);
  assert.equal(worldControlAvailability({ ...state, worldControl: { available: false } }).disabled, true);
  assert.equal(worldControlAvailability({ running: true, scenario: { id: 'blackout' } }).disabled, true);
  assert.equal(worldControlAvailability(state, false, false).disabled, true);
  assert.equal(worldControlAvailability(state).summary, state.worldControl.summary);
});
test('local pending survives a poll with server busy false; server busy also disables independent submit', () => {
  assert.deepEqual(worldControlAvailability(state, true), { visible: true, pending: true, disabled: true, summary: state.worldControl.summary });
  assert.equal(worldControlAvailability({ ...state, worldControl: { ...state.worldControl, busy: true } }).disabled, true);
});
test('applied, unchanged and rejected receipts remain distinct; generic success cannot fake an outcome', () => {
  assert.equal(worldCommandReceipt({ status: 'applied', detail: 'Power restored.', atSimMs: 0 }).title, 'Applied to the world');
  assert.equal(worldCommandReceipt({ status: 'unchanged', detail: 'Power is already on.', atSimMs: 100 }).title, 'No change needed');
  assert.equal(worldCommandReceipt({ status: 'rejected', detail: 'Unknown operation.', atSimMs: 200 }).title, 'Not applied');
  for (const bad of [undefined, { ok: true }, { status: 'success', detail: 'Done', atSimMs: 0 }, { status: 'applied', detail: 'Done', atSimMs: Infinity }, { status: 'applied', detail: '', atSimMs: 0 }]) {
    assert.throws(() => worldCommandReceipt(bad));
  }
});
test('late command responses from another source or an older request never become current-world receipts', () => {
  assert.equal(isCurrentWorldCommand('one', 1, state, 1), true);
  assert.equal(isCurrentWorldCommand('old', 1, state, 1), false);
  assert.equal(isCurrentWorldCommand('one', 1, state, 2), false);
  assert.equal(isCurrentWorldCommand('one', 1, null, 1), false);
});
