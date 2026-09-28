import { createGodConsole, createInterviewBook, INTERVIEW_MODE_LABELS } from './analysis-panel.mjs';
import { speakableText } from './voice-client.mjs';
import { actorAccent } from './framing-view.mjs';

const REGISTER_COPY = {
  in_character: 'They meet you as a stranger in a quiet moment, with their real memories and secrets. They may lie.',
  analysis: 'Diagnostic register: candid about motives, secrets, beliefs about others, and why they did what they did.',
};

/** Analysis mode UI: God console (left) and the interview chair (right).
 * Literal text rendering only; all requests go through the authenticated `api`. */
export function createAnalysisView({ el, api, notify, voice, portrait, getState }) {
  const god = createGodConsole(), book = createInterviewBook();
  let subject = null, focus = 'god', rosterSignature = '', subjectSignature = '', speakingId = null;
  const safe = (parent, tag, text, className) => { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; parent.append(node); return node; };
  const nearBottom = node => node.scrollHeight - node.clientHeight - node.scrollTop < 40;
  // Only residents with minds sit in the chair; a controlled visitor has none.
  const actors = () => { const s = getState(); return (s?.actors ?? []).filter(a => !(s?.control?.visitor && a.key === s.control.actorKey)); };
  const accent = key => actorAccent(getState()?.entities?.find(e => e.key === key) ?? { key });

  function renderGod() {
    const log = el('god-log'), stick = nearBottom(log); log.replaceChildren();
    if (!god.messages.length) {
      const empty = safe(log, 'div', '', 'lab-empty');
      safe(empty, 'strong', '“Ask, and it shall be answered.”');
      safe(empty, 'span', 'God sees every resident’s wants, fears and secrets, the Narrator’s ledger, and why things happened.');
    }
    for (const message of god.messages) {
      const row = safe(log, 'div', '', `lab-message ${message.role} ${message.status}`);
      const who = safe(row, 'span', message.role === 'you' ? 'You' : 'God', 'who');
      if (message.id === speakingId) safe(who, 'span', '· speaking', 'speaking-tag');
      safe(row, 'p', message.status === 'pending' ? 'Considering' : message.text);
      if (message.receipts?.length) { const receipts = safe(row, 'div', '', 'receipts'); for (const receipt of message.receipts) safe(receipts, 'span', receipt); }
    }
    if (stick || god.busy) log.scrollTop = log.scrollHeight;
    el('god-send').disabled = god.busy;
    el('god-send').textContent = god.busy ? 'Asking…' : 'Ask';
    el('god-suggestions').hidden = god.messages.length > 0;
  }

  function renderRoster() {
    const signature = JSON.stringify([subject, actors().map(a => [a.key, a.name])]);
    if (signature === rosterSignature) return;
    rosterSignature = signature;
    const roster = el('interview-roster'); roster.replaceChildren();
    for (const actor of actors()) {
      const button = safe(roster, 'button', ''); button.type = 'button';
      button.setAttribute('aria-pressed', String(actor.key === subject));
      const dot = safe(button, 'span', actor.name.slice(0, 1)); dot.style.background = `${accent(actor.key)}33`; dot.style.color = actor.key === subject ? '#fff' : '#243034';
      safe(button, 'span', actor.name).style.cssText = 'width:auto;height:auto;background:none;display:inline';
      button.addEventListener('click', () => select(actor.key));
    }
  }

  function renderSubject(force = false) {
    const actor = actors().find(a => a.key === subject);
    el('interview-empty').hidden = !!actor; el('interview-body').hidden = !actor;
    if (!actor) return;
    const entry = book.get(subject);
    const signature = JSON.stringify([subject, actor.name, actor.room, actor.action, entry.mode, entry.remember, entry.mood, entry.pending, entry.transcript.map(r => [r.id, r.status]), speakingId]);
    if (signature === subjectSignature && !force) return;
    subjectSignature = signature;
    el('interview-name').textContent = actor.name;
    el('interview-meta').textContent = [actor.room, actor.action].filter(Boolean).join(' · ') || '—';
    el('interview-monogram').textContent = actor.name.slice(0, 1);
    el('interview-mood').hidden = !entry.mood; el('interview-mood').textContent = entry.mood ? `Mood · ${entry.mood}` : '';
    for (const button of document.querySelectorAll('[data-interview-mode]')) button.setAttribute('aria-pressed', String(button.dataset.interviewMode === entry.mode));
    const inCharacter = entry.mode === 'in_character';
    el('interview-remember').checked = inCharacter && entry.remember; el('interview-remember').disabled = !inCharacter;
    el('remember-toggle').classList.toggle('disabled', !inCharacter);
    el('remember-toggle').title = inCharacter ? 'Store this as a private conversation they lived through' : 'Analysis is always off the record';
    el('interview-register').textContent = `${REGISTER_COPY[entry.mode]}${inCharacter ? entry.remember ? ' They will remember this conversation.' : ' Off the record.' : ''}`;
    el('interview-input').placeholder = inCharacter ? `Say something to ${actor.name}…` : `Ask about ${actor.name}’s motives…`;
    const log = el('interview-log'), stick = nearBottom(log); log.replaceChildren();
    if (!entry.transcript.length) {
      const empty = safe(log, 'div', '', 'lab-empty');
      safe(empty, 'strong', inCharacter ? `${actor.name} is waiting.` : `${actor.name}, analysis.`);
      safe(empty, 'span', inCharacter ? 'Begin however you like. They don’t know who you are.' : 'Ask why they did something, what they believe, what they hide.');
    }
    for (const row of entry.transcript) {
      if (row.role === 'divider') { safe(log, 'div', row.text, 'lab-divider'); continue; }
      const item = safe(log, 'div', '', `lab-message ${row.role} ${row.mode} ${row.status}`);
      const who = safe(item, 'span', row.role === 'you' ? 'You' : row.mode === 'analysis' ? `${actor.name} · analysis` : actor.name, 'who');
      if (row.id === speakingId) safe(who, 'span', '· speaking', 'speaking-tag');
      safe(item, 'p', row.status === 'pending' ? `${actor.name} is thinking` : row.text);
    }
    if (stick || entry.pending) log.scrollTop = log.scrollHeight;
    el('interview-send').disabled = !!entry.pending;
    el('interview-send').textContent = entry.pending ? 'Asking…' : 'Ask';
  }

  function select(key) {
    if (!actors().some(a => a.key === key)) return;
    const changed = subject !== key;
    subject = key; focus = 'interview'; rosterSignature = '';
    renderRoster(); renderSubject(true);
    if (changed) portrait?.(key, el('interview-portrait'));
  }

  async function askGod(text) {
    const request = god.begin(text); if (!request) return false;
    renderGod();
    try {
      const response = await api('/api/god/ask', request, { timeoutMs: 120000 });
      const reply = god.receive(request.requestId, response);
      if (reply) voice?.enqueue({ id: `god:${request.requestId}`, text: speakableText(reply.text), voice: 'god', priority: true, messageId: request.requestId });
    } catch (error) { god.fail(request.requestId, error); }
    renderGod();
    return true;
  }

  async function askSubject(text) {
    if (!subject) { notify('Choose someone to interview first.'); return false; }
    const key = subject, request = book.begin(key, text); if (!request) return false;
    renderSubject(true);
    try {
      const response = await api('/api/interview', request.body, { timeoutMs: 120000 });
      const reply = book.receive(key, request.key, response);
      if (reply) voice?.enqueue({ id: `interview:${request.key}`, text: speakableText(reply.text), speakerKey: key, priority: true, messageId: request.key });
    } catch (error) { book.fail(key, request.key, error); }
    if (key === subject) renderSubject(true);
    return true;
  }

  const submitOnEnter = (input, send) => input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); input.form.requestSubmit(); }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); input.blur(); }
  });
  submitOnEnter(el('god-input')); submitOnEnter(el('interview-input'));
  el('god-input').addEventListener('focus', () => { focus = 'god'; });
  el('interview-input').addEventListener('focus', () => { focus = 'interview'; });
  el('god-form').addEventListener('submit', event => {
    event.preventDefault(); const text = el('god-input').value;
    if (text.trim() && !god.busy) { el('god-input').value = ''; void askGod(text); }
  });
  el('interview-form').addEventListener('submit', event => {
    event.preventDefault(); const text = el('interview-input').value;
    if (text.trim() && subject && !book.get(subject).pending) { el('interview-input').value = ''; void askSubject(text); }
  });
  for (const button of document.querySelectorAll('[data-god-suggestion]')) button.addEventListener('click', () => { void askGod(button.dataset.godSuggestion); });
  for (const button of document.querySelectorAll('[data-interview-mode]')) button.addEventListener('click', () => {
    if (!subject) return; book.setMode(subject, button.dataset.interviewMode); renderSubject(true);
  });
  el('interview-remember').addEventListener('change', () => { if (subject) { book.setRemember(subject, el('interview-remember').checked); renderSubject(true); } });
  el('interview-restart').addEventListener('click', () => { if (subject) { book.restart(subject); renderSubject(true); notify(`A fresh session with ${actors().find(a => a.key === subject)?.name ?? 'them'}.`); } });
  renderGod();

  return {
    select,
    get subject() { return subject; },
    get focus() { return focus; },
    setFocus(target) { focus = target === 'interview' && subject ? 'interview' : 'god'; },
    /** A push-to-talk transcript goes to whichever panel was last used. */
    submitSpoken(text) { return focus === 'interview' && subject ? askSubject(text) : askGod(text); },
    enter(preferredKey) {
      if (!subject) { const first = actors().find(a => a.key === preferredKey) ?? actors()[0]; if (first) select(first.key); }
      else portrait?.(subject, el('interview-portrait'));
      renderGod(); rosterSignature = ''; renderRoster(); renderSubject(true);
    },
    sync() { renderRoster(); renderSubject(); },
    voiceStatus(status) {
      const next = status?.playing?.phase === 'playing' ? status.playing.messageId ?? null : null;
      if (next === speakingId) return;
      speakingId = next; renderGod(); renderSubject(true);
    },
    reset() { god.reset(); book.clear(); subject = null; rosterSignature = ''; renderGod(); renderSubject(true); },
    labels: INTERVIEW_MODE_LABELS,
  };
}
