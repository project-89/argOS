// Evaluation-only request budget and private prompt/answer audit. No headers,
// credential-bearing URLs or provider reasoning parts are recorded.
const fs = require('node:fs'), path = require('node:path');
const directory = process.env.ARGOS_BASELINE_DIRECTORY, limit = Number(process.env.ARGOS_TRIAL_HTTP_LIMIT);
if (!directory || !Number.isSafeInteger(limit) || limit < 1) throw new Error('Bounded baseline launcher required');
const original = globalThis.fetch, pending = new Set(), inFlight = new Set();
let calls = 0, denied = 0, traceBytes = 0, incomplete = 0;
const failureKind = error => ['AbortError', 'TimeoutError'].includes(error?.name) ? error.name : 'provider_error';
const write = (name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value), { mode: 0o600 });
function usage() { write('provider-usage.json', { calls, denied, limit, pending: pending.size + inFlight.size,
  inFlight: [...inFlight], incomplete, traceBytes }); }
function persist(call, row) {
  const body = JSON.stringify(row); traceBytes += Buffer.byteLength(body);
  if (traceBytes > 32 * 1024 * 1024) { incomplete++; throw new Error('Prompt audit byte bound exceeded'); }
  fs.writeFileSync(path.join(directory, `request-${call}.json`), body, { mode: 0o600 });
}
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.hostname !== 'generativelanguage.googleapis.com') throw new Error('Unexpected network host in fixed-world baseline');
  if (calls >= limit) {
    denied++; usage();
    if (denied === 1) { process.send?.({ type: 'provider_limit_reached' }); process.kill(process.pid, 'SIGINT'); }
    throw new Error('Baseline Google attempt budget exhausted');
  }
  const call = ++calls;
  process.send?.({ type: 'provider_attempt', calls });
  let body; try { body = typeof init?.body === 'string' ? JSON.parse(init.body) : null; } catch {}
  const text = [...(body?.systemInstruction?.parts ?? []), ...(body?.contents ?? []).flatMap(c => c.parts ?? [])]
    .filter(p => !p.thought).map(p => p.text ?? '').join('\n');
  const row = { call, startedAtWallMs: Date.now(), model: url.pathname.split('/').at(-1)?.split(':')[0],
    requestBytes: Buffer.byteLength(text), prompt: Buffer.byteLength(text) <= 262144 ? text : null,
    response: { state: 'pending' } };
  if (!body || row.prompt === null) incomplete++;
  persist(call, row); inFlight.add(call); usage();
  let response;
  try { response = await original(input, init); }
  catch (error) { inFlight.delete(call); row.response = { state: 'failed', kind: failureKind(error) };
    row.finishedAtWallMs = Date.now(); persist(call, row);
    // Shutdown can stall before drain/exit. Persist the current ledger at the
    // failure boundary, retaining any OTHER genuinely pending requests.
    usage(); throw error; }
  inFlight.delete(call);
  // Observe the body delivered to the consumer, not an independent clone. A
  // source read error is the caller's failed outcome; a lost/invalid audit is
  // still incomplete. An aborted signal alone never changes a received answer.
  let resolveTask, settled = false, cancelRequested = false, bytes = 0, oversized = false;
  const chunks = [], task = new Promise(resolve => { resolveTask = resolve; });
  pending.add(task); usage();
  const finish = (result, auditFailed = oversized) => {
    if (settled) return;
    settled = true; row.response = oversized ? { ...result, auditFailure: 'response_bound' } : result; row.finishedAtWallMs = Date.now();
    if (auditFailed) incomplete++;
    pending.delete(task);
    try { persist(call, row); usage(); }
    catch { incomplete++; process.send?.({ type: 'audit_failed' }); }
    finally { chunks.length = 0; resolveTask(); }
  };
  const unavailable = kind => finish({ state: 'unavailable', kind, status: response.status, bytes }, true);
  if (!response.body) { unavailable('missing_body'); return response; }
  let reader;
  try { reader = response.body.getReader(); }
  catch { unavailable('reader_unavailable'); return response; }
  const release = () => { try { reader.releaseLock(); } catch {} };
  const observed = new ReadableStream({
    async pull(controller) {
      let part;
      try { part = await reader.read(); }
      catch (error) {
        if (cancelRequested) return;
        finish({ state: 'failed', phase: 'body', kind: failureKind(error), status: response.status, bytes });
        controller.error(error); release(); return;
      }
      if (cancelRequested) return;
      if (part.done) {
        if (oversized) unavailable('response_bound');
        else {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            finish({ state: 'received', status: response.status, bytes,
              text: (parsed.candidates ?? []).flatMap(c => c.content?.parts ?? []).filter(p => !p.thought).map(p => p.text ?? '').join('\n') });
          } catch { unavailable('invalid_json'); }
        }
        controller.close(); release(); return;
      }
      bytes += part.value.byteLength;
      if (bytes > 262144) { oversized = true; chunks.length = 0; }
      else if (!oversized) chunks.push(Buffer.from(part.value));
      controller.enqueue(part.value);
    },
    async cancel(reason) {
      cancelRequested = true;
      try {
        await reader.cancel(reason);
        finish({ state: 'failed', phase: 'body', kind: 'consumer_cancel', status: response.status, bytes });
      } catch (error) {
        finish({ state: 'failed', phase: 'body', kind: 'consumer_cancel', cancellationFailure: failureKind(error), status: response.status, bytes });
        throw error;
      } finally { release(); }
    },
  }, { highWaterMark: 0 }); // Never drain an unread response to manufacture completion.
  const preserveMetadata = result => {
    for (const property of ['url', 'redirected', 'type']) Object.defineProperty(result, property, { value: response[property], configurable: true });
    const clone = result.clone.bind(result);
    Object.defineProperty(result, 'clone', { value: () => preserveMetadata(clone()), configurable: true, writable: true });
    return result;
  };
  return preserveMetadata(new Response(observed, { status: response.status, statusText: response.statusText, headers: response.headers }));
};
globalThis.__argosBaselineDrain = async () => { await Promise.allSettled([...pending]); usage(); };
process.once('exit', usage);
