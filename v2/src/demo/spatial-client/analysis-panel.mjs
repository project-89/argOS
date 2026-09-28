/** Analysis mode state (pure): a conversation with God (`/api/god/ask`) and an
 * interview book (`/api/interview`) with one transcript per resident. Replies
 * are rendered as literal text by the caller; nothing here touches the DOM. */

const uuid = () => globalThis.crypto?.randomUUID?.() ?? `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
export const INTERVIEW_MODES = Object.freeze(['in_character', 'analysis']);
export const INTERVIEW_MODE_LABELS = Object.freeze({ in_character: 'In character', analysis: 'Analysis' });

/** A human sentence for a failed request. 404 means the server predates it. */
export function friendlyError(error, subject = 'This') {
  if (error?.status === 404) return `${subject} isn’t available on this server yet.`;
  if (error?.name === 'TimeoutError' || /timed? ?out|aborted/i.test(String(error?.message))) return `${subject} took too long to answer. Try again.`;
  return String(error?.message || `${subject} failed.`);
}

/** God's receipts arrive in whatever shape the tools produced: keep them short. */
export function receiptLabel(receipt) {
  if (typeof receipt === 'string') return receipt.trim().slice(0, 140);
  if (!receipt || typeof receipt !== 'object') return '';
  const name = receipt.tool ?? receipt.name ?? receipt.kind ?? receipt.type ?? '';
  const args = receipt.args && typeof receipt.args === 'object' ? Object.values(receipt.args).filter(v => ['string', 'number', 'boolean'].includes(typeof v)).join(', ')
    : typeof receipt.args === 'string' ? receipt.args : '';
  const detail = receipt.summary ?? receipt.detail ?? receipt.text ?? receipt.result ?? args;
  const label = [receipt.ok === false ? `${name} (failed)` : name, typeof detail === 'string' ? detail : ''].filter(Boolean).join(' · ');
  return (label || JSON.stringify(receipt)).slice(0, 140);
}

export function createGodConsole({ createRequestId = uuid, now = () => Date.now() } = {}) {
  let messages = [], pending = null;
  return {
    get messages() { return messages; },
    get busy() { return !!pending; },
    /** Returns the request body, or null when empty/busy. */
    begin(text) {
      const trimmed = String(text ?? '').trim().slice(0, 2000);
      if (!trimmed || pending) return null;
      const requestId = createRequestId();
      pending = requestId;
      messages = [...messages, { id: `${requestId}:you`, role: 'you', text: trimmed, status: 'done', at: now() },
        { id: requestId, role: 'god', text: '', status: 'pending', at: now() }];
      return { text: trimmed, requestId };
    },
    receive(requestId, response) {
      if (pending !== requestId) return null;
      pending = null;
      const reply = typeof response?.reply === 'string' && response.reply.trim() ? response.reply.trim() : 'God is silent.';
      const receipts = (Array.isArray(response?.receipts) ? response.receipts : []).map(receiptLabel).filter(Boolean).slice(0, 8);
      let updated = null;
      messages = messages.map(message => message.id === requestId ? (updated = { ...message, text: reply, receipts, status: 'done', at: now() }) : message);
      return updated;
    },
    fail(requestId, error) {
      if (pending !== requestId) return null;
      pending = null;
      messages = messages.map(message => message.id === requestId ? { ...message, text: friendlyError(error, 'God'), status: 'error', at: now() } : message);
      return true;
    },
    reset() { messages = []; pending = null; },
  };
}

export function createInterviewBook({ createSessionId = uuid, now = () => Date.now() } = {}) {
  const books = new Map();
  const book = actorKey => {
    if (!books.has(actorKey)) books.set(actorKey, { actorKey, mode: 'in_character', remember: false,
      sessions: { in_character: createSessionId(), analysis: createSessionId() }, transcript: [], pending: null, mood: null });
    return books.get(actorKey);
  };
  return {
    get(actorKey) { return typeof actorKey === 'string' && actorKey ? book(actorKey) : null; },
    has(actorKey) { return books.has(actorKey); },
    setMode(actorKey, mode) {
      const entry = book(actorKey);
      if (!INTERVIEW_MODES.includes(mode) || entry.mode === mode) return entry;
      entry.mode = mode;
      if (entry.transcript.length) entry.transcript = [...entry.transcript, { id: `divider:${now()}:${mode}`, role: 'divider', text: INTERVIEW_MODE_LABELS[mode], mode }];
      return entry;
    },
    setRemember(actorKey, remember) { const entry = book(actorKey); entry.remember = !!remember; return entry; },
    /** Returns `{ key, body }` for POST /api/interview, or null when empty/busy. */
    begin(actorKey, text) {
      const entry = book(actorKey), trimmed = String(text ?? '').trim().slice(0, 1000);
      if (!trimmed || entry.pending) return null;
      const key = createSessionId(), mode = entry.mode;
      entry.pending = key;
      entry.transcript = [...entry.transcript, { id: `${key}:you`, role: 'you', text: trimmed, mode, status: 'done' },
        { id: key, role: 'them', text: '', mode, status: 'pending' }];
      const body = { actorKey, text: trimmed, mode, sessionId: entry.sessions[mode],
        ...(mode === 'in_character' ? { remember: entry.remember } : {}) };
      return { key, body };
    },
    receive(actorKey, key, response) {
      const entry = book(actorKey);
      if (entry.pending !== key) return null;
      entry.pending = null;
      const reply = typeof response?.reply === 'string' && response.reply.trim() ? response.reply.trim() : '…';
      const mood = typeof response?.mood === 'string' && response.mood.trim() ? response.mood.trim().slice(0, 40) : null;
      const sentMode = entry.transcript.find(row => row.id === key)?.mode ?? entry.mode;
      if (typeof response?.sessionId === 'string' && response.sessionId) entry.sessions[sentMode] = response.sessionId;
      entry.mood = mood ?? entry.mood;
      let updated = null;
      entry.transcript = entry.transcript.map(row => row.id === key ? (updated = { ...row, text: reply, mood, status: 'done' }) : row);
      return updated;
    },
    fail(actorKey, key, error) {
      const entry = book(actorKey);
      if (entry.pending !== key) return null;
      entry.pending = null;
      entry.transcript = entry.transcript.map(row => row.id === key ? { ...row, text: friendlyError(error, 'The interview'), status: 'error' } : row);
      return true;
    },
    /** A fresh conversation (new session ids) with the same resident. */
    restart(actorKey) {
      const entry = book(actorKey);
      entry.transcript = []; entry.pending = null; entry.mood = null;
      entry.sessions = { in_character: createSessionId(), analysis: createSessionId() };
      return entry;
    },
    clear() { books.clear(); },
  };
}
