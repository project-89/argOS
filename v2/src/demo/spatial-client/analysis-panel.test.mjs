import test from 'node:test';
import assert from 'node:assert/strict';
import { createGodConsole, createInterviewBook, friendlyError, receiptLabel } from './analysis-panel.mjs';

const counter = () => { let n = 0; return () => `id-${++n}`; };

test('God console sends one request at a time and threads the reply', () => {
  const god = createGodConsole({ createRequestId: counter(), now: () => 5 });
  assert.equal(god.begin('   '), null);
  const request = god.begin(' Where is Mara? ');
  assert.deepEqual(request, { text: 'Where is Mara?', requestId: 'id-1' });
  assert.equal(god.begin('Another?'), null, 'busy');
  assert.equal(god.busy, true);
  assert.equal(god.receive('stale', { reply: 'no' }), null);
  const reply = god.receive('id-1', { reply: 'In the Net House, reading a logbook.', receipts: ['where_is(Mara)', { tool: 'read_ledger', summary: '3 threads' }, null] });
  assert.equal(reply.text, 'In the Net House, reading a logbook.');
  assert.deepEqual(reply.receipts, ['where_is(Mara)', 'read_ledger · 3 threads']);
  assert.deepEqual(god.messages.map(m => [m.role, m.status]), [['you', 'done'], ['god', 'done']]);
  assert.equal(god.busy, false);
});

test('God console reports a missing endpoint kindly and frees the composer', () => {
  const god = createGodConsole({ createRequestId: counter() });
  const request = god.begin('Hello?');
  god.fail(request.requestId, Object.assign(new Error('World request failed (404).'), { status: 404 }));
  assert.equal(god.messages.at(-1).status, 'error');
  assert.match(god.messages.at(-1).text, /isn’t available on this server yet/);
  assert.ok(god.begin('Again'));
});

test('interviews keep one transcript per resident with mode-specific sessions', () => {
  const book = createInterviewBook({ createSessionId: counter(), now: () => 1 });
  const first = book.begin('leon', 'What happened to the Marrow Star?');
  assert.deepEqual(first.body, { actorKey: 'leon', text: 'What happened to the Marrow Star?', mode: 'in_character', sessionId: 'id-1', remember: false });
  assert.equal(book.begin('leon', 'Hello?'), null, 'one question at a time');
  book.receive('leon', first.key, { reply: 'The sea took them. That is all.', mood: 'guarded', sessionId: 'srv-leon' });
  assert.equal(book.get('leon').mood, 'guarded');
  book.setMode('leon', 'analysis');
  const second = book.begin('leon', 'Why did he lie just now?');
  assert.equal(second.body.mode, 'analysis');
  assert.equal(second.body.sessionId, 'id-2');
  assert.equal('remember' in second.body, false, 'remember applies only in character');
  book.receive('leon', second.key, { reply: 'He fears exposure before he dies.' });
  assert.deepEqual(book.get('leon').transcript.map(row => row.role), ['you', 'them', 'divider', 'you', 'them']);
  book.setMode('leon', 'in_character');
  book.setRemember('leon', true);
  const third = book.begin('leon', 'I won’t tell anyone.');
  assert.equal(third.body.sessionId, 'srv-leon', 'server-issued session adopted');
  assert.equal(third.body.remember, true);
  assert.equal(book.get('mara').transcript.length, 0, 'separate resident, separate book');
});

test('interview failures and restarts', () => {
  const book = createInterviewBook({ createSessionId: counter() });
  const request = book.begin('ivo', 'Did you see Otis?');
  book.fail('ivo', request.key, Object.assign(new Error('x'), { name: 'TimeoutError' }));
  assert.match(book.get('ivo').transcript.at(-1).text, /took too long/);
  const restarted = book.restart('ivo');
  assert.equal(restarted.transcript.length, 0);
  assert.notEqual(restarted.sessions.in_character, request.body.sessionId);
});

test('friendly errors and receipt labels are bounded text', () => {
  assert.equal(friendlyError(new Error('Nope')), 'Nope');
  assert.equal(receiptLabel('x'.repeat(500)).length, 140);
  assert.equal(receiptLabel({ weird: true }), '{"weird":true}');
  assert.equal(receiptLabel(42), '');
  assert.equal(receiptLabel({ tool: 'whereIsEveryone', args: {}, ok: true }), 'whereIsEveryone');
  assert.equal(receiptLabel({ tool: 'residentMind', args: { name: 'Leon' }, ok: false }), 'residentMind (failed) · Leon');
});
