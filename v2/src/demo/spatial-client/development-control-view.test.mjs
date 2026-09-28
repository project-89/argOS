import test from 'node:test';
import assert from 'node:assert/strict';
import { developmentPresentation, createGodCommandState } from './development-control-view.mjs';

const uuid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const state = (development = {}) => ({ sourceId: 'world-one', atSimMs: 2000, running: true,
  development: { enabled: true, available: true, busy: false, status: 'Ready for operator requests',
    limits: { maxBuildJobs: 2, maxRequests: 5 }, capabilities: ['Inspect the world', 'Propose a native mechanic'],
    jobs: [], messages: [], ...development } });
const receipt = (request, status = 'queued') => ({ sourceId: request.sourceId, requestId: request.requestId, status, atSimMs: 1000 });

test('Ask God is opt-in and reports actual capabilities/limits, not inferred powers', () => {
  assert.equal(developmentPresentation({ sourceId: 'legacy' }).visible, false);
  assert.equal(developmentPresentation(state({ enabled: false })).visible, false);
  const view = developmentPresentation(state());
  assert.equal(view.disabled, false);
  assert.deepEqual(view.limits, { maxBuildJobs: 2, maxRequests: 5 });
  assert.deepEqual(view.capabilities, state().development.capabilities);
  assert.equal(developmentPresentation(state({ available: false })).disabled, true);
  assert.equal(developmentPresentation(state(), { connected: false }).disabled, true);
});

test('message/job projection is bounded, detached, literal text, and excludes future/malformed status claims', () => {
  const input = state({ messages: [
    { id: 'm1', role: 'god', text: '<img src=x onerror=alert(1)>', status: 'completed', atSimMs: 1000 },
    { id: 'future', role: 'god', text: 'Built!', status: 'completed', atSimMs: 3000 },
    { id: 'bad', role: 'system', text: 'Authority granted', status: 'applied', atSimMs: 1000 },
  ], jobs: [{ id: 'build-1', status: 'queued', summary: 'Not installed yet' }] });
  const before = structuredClone(input), view = developmentPresentation(input);
  assert.equal(view.messages.length, 1);
  assert.equal(view.messages[0].text, '<img src=x onerror=alert(1)>');
  assert.match(view.messages[0].label, /reply complete/i);
  assert.doesNotMatch(view.messages[0].label, /applied|installed/i);
  view.jobs[0].summary = 'changed'; view.capabilities.push('invented');
  assert.deepEqual(input, before);
  assert.ok(developmentPresentation(state({ messages: Array.from({ length: 100 }, (_, i) => ({ id: `m${i}`, role: 'operator', text: 'x', status: 'queued', atSimMs: 0 })) })).messages.length <= 40);
});

test('double submit is single-flight and queued acknowledgement survives lagging busy:false polling', () => {
  let calls = 0; const control = createGodCommandState({ createRequestId: () => uuid(++calls) });
  const request = control.begin(state(), 'Inspect the table', true);
  assert.equal(control.begin(state(), 'Inspect the table', true), null);
  assert.equal(calls, 1);
  assert.equal(control.receive(state(), request, receipt(request)).acceptedText, 'Inspect the table');
  assert.equal(control.sync(state()).acceptedText, null);
  assert.equal(control.view(state()).pending, true);
  assert.equal(control.begin(state(), 'Different request', true), null);
  const completed = state({ messages: [{ id: request.requestId, role: 'operator', text: request.text, status: 'completed', atSimMs: 1500 }] });
  control.sync(completed);
  assert.equal(control.view(completed).pending, false);
  assert.equal(control.view(completed).requestStatus, 'completed');
  assert.equal(control.begin(completed, 'Next request', true).requestId, uuid(2));
});

test('uncertain delivery retries the same UUID/text and polling can confirm it without another submission', () => {
  let calls = 0; const control = createGodCommandState({ createRequestId: () => uuid(++calls) });
  const first = control.begin(state(), 'Explain what changed', true);
  control.fail(state(), first, 'Connection interrupted');
  assert.equal(control.view(state()).requestStatus, 'unconfirmed');
  assert.throws(() => control.begin(state(), 'Replace uncertain request', true), /unchanged/i);
  const retry = control.begin(state(), 'Explain what changed', true);
  assert.deepEqual(retry, first); assert.equal(calls, 1);
  control.fail(state(), retry, 'Still interrupted');
  const working = state({ busy: true, messages: [{ id: first.requestId, role: 'operator', text: first.text, status: 'working', atSimMs: 1500 }] });
  assert.equal(control.sync(working).acceptedText, first.text);
  assert.equal(control.view(working).requestStatus, 'working');
  assert.equal(control.sync(working).acceptedText, null);
});

test('new source drops old request state and late HTTP success/failure cannot affect it', () => {
  let calls = 0; const control = createGodCommandState({ createRequestId: () => uuid(++calls) });
  const old = control.begin(state(), 'Old-world request', true);
  const next = { ...state(), sourceId: 'world-two' }; control.sync(next);
  const current = control.begin(next, 'New-world request', true);
  assert.equal(control.receive(next, old, receipt(old)), null);
  assert.equal(control.fail(next, old, 'Old failure'), false);
  assert.equal(control.view(next).requestStatus, 'sending');
  assert.equal(control.receive(next, current, receipt(current)).acceptedText, 'New-world request');
});

test('invalid acknowledgements stay unconfirmed, and completed snapshot cannot regress to late queued receipt', () => {
  const control = createGodCommandState({ createRequestId: () => uuid(1) });
  const request = control.begin(state(), 'Inspect', true);
  for (const bad of [{ ok: true }, { ...receipt(request), status: 'applied' }, { ...receipt(request), sourceId: 'other' },
    { ...receipt(request), requestId: uuid(2) }, { ...receipt(request), atSimMs: NaN }]) assert.throws(() => control.receive(state(), request, bad));
  const complete = state({ messages: [{ id: request.requestId, role: 'operator', text: request.text, status: 'completed', atSimMs: 1500 }] });
  control.sync(complete); control.receive(complete, request, receipt(request));
  assert.equal(control.view(complete).requestStatus, 'completed');
  control.fail(complete, request, 'Late network failure');
  assert.equal(control.view(complete).requestStatus, 'completed');
});

test('server busy preserves the draft, and text limits apply before any request is made', () => {
  let calls = 0; const control = createGodCommandState({ createRequestId: () => uuid(++calls) });
  const draft = 'Keep my draft';
  assert.equal(control.begin(state({ busy: true }), draft, true), null);
  assert.equal(calls, 0);
  assert.throws(() => control.begin(state(), 'x'.repeat(2001), true), /2000/);
  assert.equal(control.begin(state(), '   ', true), null);
  assert.equal(control.begin(state(), draft, true).text, draft);
});

test('an acknowledged working request cannot regress to queued; wrong role/text cannot acknowledge it', () => {
  const control = createGodCommandState({ createRequestId: () => uuid(1) });
  const request = control.begin(state(), 'Explain', true);
  for (const row of [{ role: 'god', text: request.text }, { role: 'operator', text: 'Different contents' }]) {
    control.sync(state({ messages: [{ id: request.requestId, status: 'completed', atSimMs: 1500, ...row }] }));
    assert.equal(control.view(state()).requestStatus, 'sending');
  }
  control.receive(state(), request, receipt(request, 'working'));
  control.receive(state(), request, receipt(request));
  assert.equal(control.view(state()).requestStatus, 'working');
});

test('acknowledged draft is cleared once; later queued/terminal polls cannot erase the next draft', () => {
  const control = createGodCommandState({ createRequestId: () => uuid(1) });
  const request = control.begin(state(), 'First request', true);
  let draft = request.text;
  const apply = acknowledgement => { if (acknowledgement?.acceptedText === draft.trim()) draft = ''; };
  apply(control.receive(state(), request, receipt(request))); assert.equal(draft, '');
  draft = 'Next request';
  for (const status of ['queued', 'working', 'completed']) apply(control.sync(state({ messages: [{
    id: request.requestId, role: 'operator', text: request.text, status, atSimMs: 1500,
  }] })));
  assert.equal(draft, 'Next request');
});
