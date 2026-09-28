import test from 'node:test';
import assert from 'node:assert/strict';
import { createModeState, transition, modeKeyEvent, modeAvailability } from './modes.mjs';

test('entering Analysis pauses a running world and remembers where it came from', () => {
  const { state, effects } = transition(createModeState('inhabit'), { type: 'select', mode: 'analysis' }, { controlled: true, paused: false });
  assert.equal(state.mode, 'analysis');
  assert.equal(state.returnMode, 'inhabit');
  assert.equal(state.pausedByAnalysis, true);
  assert.deepEqual(effects, ['pause', 'release-pointer']);
});

test('Analysis over an already frozen world does not own the resume', () => {
  const entered = transition(createModeState(), { type: 'select', mode: 'analysis' }, { paused: true });
  assert.deepEqual(entered.effects, []);
  const left = transition(entered.state, { type: 'escape' }, { paused: true });
  assert.equal(left.state.mode, 'watch');
  assert.deepEqual(left.effects, []);
});

test('Escape from Analysis resumes and returns to the previous mode', () => {
  const entered = transition(createModeState('inhabit'), { type: 'select', mode: 'analysis' }, { controlled: true });
  const left = transition(entered.state, { type: 'escape' }, { controlled: true, paused: true });
  assert.equal(left.state.mode, 'inhabit');
  assert.deepEqual(left.effects, ['resume']);
});

test('Returning from Analysis to Inhabit falls back to Watch when the body was released', () => {
  const entered = transition(createModeState('inhabit'), { type: 'select', mode: 'analysis' }, { controlled: true });
  const released = transition(entered.state, { type: 'controlChanged', controlled: false }, { controlled: false, paused: true });
  assert.equal(released.state.returnMode, 'watch');
  assert.equal(transition(released.state, { type: 'escape' }, { paused: true }).state.mode, 'watch');
});

test('Inhabit without a body asks the caller to choose one and does not switch yet', () => {
  const { state, effects } = transition(createModeState(), { type: 'select', mode: 'inhabit' }, { controlled: false });
  assert.equal(state.mode, 'watch');
  assert.deepEqual(effects, ['choose-body']);
});

test('confirmed control acquisition enters Inhabit; loss of control leaves it', () => {
  const acquired = transition(createModeState(), { type: 'controlChanged', controlled: true, acquired: true }, { controlled: true });
  assert.equal(acquired.state.mode, 'inhabit');
  const lost = transition(acquired.state, { type: 'controlChanged', controlled: false }, {});
  assert.equal(lost.state.mode, 'watch');
  assert.deepEqual(lost.effects, ['release-pointer']);
});

test('control acquired while analysing does not yank the operator out of the lab', () => {
  const lab = transition(createModeState(), { type: 'select', mode: 'analysis' }, {}).state;
  assert.equal(transition(lab, { type: 'controlChanged', controlled: true, acquired: true }, { controlled: true }).state.mode, 'analysis');
});

test('Escape in Inhabit steps out to Watch; Escape in Watch only dismisses', () => {
  const inhabit = createModeState('inhabit');
  assert.equal(transition(inhabit, { type: 'escape' }, { controlled: true }).state.mode, 'watch');
  assert.deepEqual(transition(createModeState(), { type: 'escape' }, {}).effects, ['dismiss']);
});

test('switching directly between Analysis and Watch resumes only what Analysis paused', () => {
  const lab = transition(createModeState(), { type: 'select', mode: 'analysis' }, { paused: false }).state;
  const back = transition(lab, { type: 'select', mode: 'watch' }, { paused: true });
  assert.deepEqual(back.effects, ['resume']);
  const external = transition(lab, { type: 'externalResume' }, {}).state;
  assert.deepEqual(transition(external, { type: 'select', mode: 'watch' }, { paused: true }).effects, []);
});

test('mode keys map 1/2/3 unless typing, modified, or the verb chooser owns digits', () => {
  assert.deepEqual(modeKeyEvent({ code: 'Digit3', key: '3' }), { type: 'select', mode: 'analysis' });
  assert.equal(modeKeyEvent({ code: 'Digit1', key: '1' }, { typing: true }), null);
  assert.equal(modeKeyEvent({ code: 'Digit2', key: '2', metaKey: true }), null);
  assert.equal(modeKeyEvent({ code: 'Digit2', key: '2' }, { verbMenuOpen: true }), null);
  assert.deepEqual(modeKeyEvent({ code: 'Escape', key: 'Escape' }, { verbMenuOpen: true }), { type: 'escape' });
  assert.equal(modeKeyEvent({ code: 'KeyW', key: 'w' }), null);
});

test('availability reflects connection and control support', () => {
  assert.equal(modeAvailability({ connected: false }).analysis.enabled, false);
  assert.equal(modeAvailability({ controlSupported: false }).inhabit.enabled, false);
  assert.equal(modeAvailability({ controlled: true }).inhabit.hint, 'Return to your body');
});
