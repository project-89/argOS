/** Cinematic subtitles for speech the controlled body actually heard
 * (`control.heard`). Only what this body perceived; never other rooms, never
 * thoughts. A change of body (or first sight of one) does not replay backlog. */

export function subtitleDuration(text) {
  const length = String(text ?? '').length;
  return Math.max(2600, Math.min(9000, 1500 + length * 62));
}

/** Still-arriving excerpts grow under one id; a completed turn gets its own. */
export const isExcerpt = line => typeof line?.id === 'string' && line.id.startsWith('speech-fragment:');

export function createSubtitleQueue({ maxVisible = 3, maxSeen = 400, echoMs = 15000, isPartial = isExcerpt } = {}) {
  let bodyKey = null, seen = new Set(), lines = [], echoes = [], local = 0;
  const remember = id => {
    seen.add(id);
    if (seen.size > maxSeen) seen = new Set([...seen].slice(-Math.floor(maxSeen / 2)));
  };
  return {
    /** Returns newly completed lines (for voicing), oldest first. Excerpts are
     * shown as they grow but never voiced; their completed turn replaces them. */
    ingest(control, now) {
      if (!control || typeof control.actorKey !== 'string') { bodyKey = null; seen = new Set(); lines = []; echoes = []; return []; }
      const heard = (Array.isArray(control.heard) ? control.heard : [])
        .filter(line => line && typeof line.id === 'string' && typeof line.text === 'string' && line.text.trim());
      if (control.actorKey !== bodyKey) {
        bodyKey = control.actorKey; seen = new Set(); lines = [];
        for (const line of heard) remember(line.id);
        return [];
      }
      const fresh = [];
      for (const line of heard) {
        const text = line.text.trim(), partial = !!isPartial(line);
        if (seen.has(line.id)) {
          const shown = lines.find(row => row.id === line.id);
          if (shown && shown.text !== text) { shown.text = text; shown.until = Math.max(shown.until, now + subtitleDuration(text)); }
          continue;
        }
        remember(line.id);
        const self = line.speaker === control.name;
        // Our own words were already shown when we said them.
        const echo = self && echoes.findIndex(row => row.text === text && row.until > now);
        if (self && echo >= 0) { echoes.splice(echo, 1); continue; }
        const entry = { id: line.id, speaker: String(line.speaker ?? 'Someone'), text, self, partial,
          atSimMs: line.atSimMs, shownAt: now, until: now + subtitleDuration(text) };
        // A completed turn takes the place of the excerpt that was growing on screen.
        const excerpt = !partial && lines.find(row => row.partial && row.speaker === entry.speaker && text.startsWith(row.text.slice(0, 16)));
        if (excerpt) Object.assign(excerpt, entry, { shownAt: excerpt.shownAt });
        else lines.push(entry);
        if (!partial) fresh.push(excerpt || entry);
      }
      if (lines.length > 12) lines = lines.slice(-12);
      return fresh;
    },
    /** Show the operator's own line immediately; the server's copy is skipped. */
    echo(text, speaker, now) {
      const trimmed = String(text ?? '').trim(); if (!trimmed) return null;
      echoes = [...echoes.filter(row => row.until > now), { text: trimmed, until: now + echoMs }];
      const entry = { id: `local:${++local}`, speaker: speaker || 'You', text: trimmed, self: true, shownAt: now, until: now + subtitleDuration(trimmed) };
      lines.push(entry); return entry;
    },
    /** A voiced line stays up while it plays, then lingers briefly. */
    speaking(id, active, now) {
      const line = lines.find(row => row.id === id); if (!line) return;
      line.speaking = !!active;
      line.until = active ? Math.max(line.until, now + 60000) : Math.max(now + 1400, Math.min(line.until, now + 1400));
    },
    /** Extend a line (never shortens). */
    hold(id, until) { const line = lines.find(row => row.id === id); if (line && until > line.until) line.until = until; },
    visible(now) { return lines.filter(line => line.until > now).slice(-maxVisible); },
    get bodyKey() { return bodyKey; },
    reset() { bodyKey = null; seen = new Set(); lines = []; echoes = []; },
  };
}
