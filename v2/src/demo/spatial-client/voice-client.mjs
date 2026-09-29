/** Voice: a serial, budget-aware speech queue (pure scheduling around injected
 * `synthesize`/`play`), a Web Audio player, and push-to-talk capture that
 * records 16-bit mono WAV (the verified transcription format), falling back to
 * MediaRecorder webm/opus. Lines are requested only when they will be played.
 *
 * Server semantics (/api/voice/*): 503 = no provider key (hide voice UI),
 * 429 + retryAfterSeconds = back off (or budget spent), 502/504 = skip a line. */

export const VOICE_ERRORS = Object.freeze({ budget: 'budget', unavailable: 'unavailable', cooldown: 'cooldown' });

/** Classify a synthesis failure. */
export function classifyVoiceError(error) {
  const status = error?.status, message = String(error?.message ?? '');
  if (status === 404 || status === 501 || status === 503) return VOICE_ERRORS.unavailable;
  if (status === 402 || /budget|quota/i.test(message)) return VOICE_ERRORS.budget;
  if (status === 429) return VOICE_ERRORS.cooldown;
  return 'failed';
}

/** Voice only what a listener will sit through: whole sentences up to `max`
 * characters. Markdown-ish symbols are dropped; the transcript keeps the rest. */
export function speakableText(text, max = 600) {
  const clean = String(text ?? '').replace(/[*_#`>]+/g, '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max), end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  return end > max * 0.4 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : max)}…`;
}

export function createVoiceQueue({ synthesize, play, stop = () => {}, now = () => Date.now(), maxPending = 5,
  maxAgeMs = 25000, perMinute = 14, onChange = () => {} } = {}) {
  let muted = false, exhausted = false, available = true, playing = null, queue = [], generation = 0, cooldownUntil = 0;
  const seen = new Set(), requests = [];
  const emit = () => { try { onChange(status()); } catch {} };
  const status = () => ({ muted, exhausted, available, cooling: now() < cooldownUntil,
    playing: playing ? { id: playing.id, text: playing.text, speakerKey: playing.speakerKey, voice: playing.voice, phase: playing.phase, messageId: playing.messageId } : null,
    pending: queue.length });
  const withinBudget = priority => {
    const cutoff = now() - 60000;
    while (requests.length && requests[0] < cutoff) requests.shift();
    return priority || requests.length < perMinute;
  };
  const request = item => { requests.push(now()); return Promise.resolve().then(() => synthesize(item)); };
  async function pump() {
    if (playing || !queue.length || muted) return;
    const item = queue.shift(), mine = generation;
    if (!item.priority && now() - item.enqueuedAt > maxAgeMs) { emit(); return pump(); }
    if (!item.audio && (!withinBudget(item.priority) || now() < cooldownUntil)) { emit(); return pump(); }
    playing = item; item.phase = 'synthesizing'; emit();
    try {
      const audio = await (item.audio ??= request(item));
      // Prefetch the next line while this one plays, so dialogue flows.
      const next = queue[0];
      if (next && !next.audio && withinBudget(next.priority) && now() >= cooldownUntil) { next.audio = request(next); next.audio.catch(() => {}); }
      if (mine === generation && !muted) { item.phase = 'playing'; emit(); await play(audio, item); }
    } catch (error) {
      const kind = classifyVoiceError(error);
      if (kind === VOICE_ERRORS.budget) { exhausted = true; queue = []; }
      if (kind === VOICE_ERRORS.unavailable) { available = false; queue = []; }
      if (kind === VOICE_ERRORS.cooldown) cooldownUntil = now() + Math.max(2, Number(error?.retryAfterSeconds) || 10) * 1000;
    } finally {
      if (mine === generation) playing = null;
      emit();
    }
    return pump();
  }
  return {
    /** item: { id, text, speakerKey?, voice?: 'god', priority? } */
    enqueue(item) {
      if (!item || typeof item.text !== 'string' || !item.text.trim()) return 'invalid';
      const id = item.id ?? `${item.speakerKey ?? item.voice ?? 'line'}:${item.text}`;
      if (seen.has(id)) return 'duplicate';
      seen.add(id);
      if (!available) return VOICE_ERRORS.unavailable;
      if (muted) return 'muted';
      if (exhausted) return VOICE_ERRORS.budget;
      if (!item.priority && now() < cooldownUntil) return VOICE_ERRORS.cooldown;
      if (!item.priority && !withinBudget(false) && queue.length >= 1) return VOICE_ERRORS.budget;
      queue.push({ ...item, id, text: item.text.trim(), enqueuedAt: now() });
      // Keep the most recent conversation: drop the oldest ordinary lines first.
      while (queue.length > maxPending) {
        const index = queue.findIndex(row => !row.priority);
        queue.splice(index >= 0 ? index : 0, 1);
      }
      emit(); void pump();
      return 'queued';
    },
    setMuted(value) {
      muted = !!value;
      if (muted) { generation++; queue = []; if (playing) { playing = null; try { stop(); } catch {} } }
      emit();
    },
    /** Stop everything now (e.g. leaving a mode) without muting. */
    interrupt() { generation++; queue = []; if (playing) { playing = null; try { stop(); } catch {} } emit(); },
    setAvailable(value) { available = !!value; emit(); },
    status,
  };
}

/** Web Audio playback of fetched WAV bytes. `decodeAudioData` avoids media
 * element URLs (the page CSP has no media-src for blob: URLs). */
export function createAudioPlayer({ AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext } = {}) {
  let context = null, source = null, gain = null;
  const ensure = () => {
    if (!AudioContextClass) throw Object.assign(new Error('Audio playback is unavailable in this browser.'), { status: 501 });
    if (!context) { context = new AudioContextClass(); gain = context.createGain(); gain.gain.value = 0.95; gain.connect(context.destination); }
    return context;
  };
  return {
    unlock() { try { const ctx = ensure(); if (ctx.state === 'suspended') void ctx.resume(); } catch {} },
    /** The shared AudioContext (positional voices render through it too). */
    context: ensure,
    async play(bytes) {
      const ctx = ensure(); if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
      const buffer = await ctx.decodeAudioData(bytes.slice(0));
      return new Promise(resolve => {
        const node = ctx.createBufferSource(); node.buffer = buffer; node.connect(gain);
        node.onended = () => { if (source === node) source = null; resolve(buffer.duration); };
        source = node; node.start();
      });
    },
    stop() { try { source?.stop(); } catch {} source = null; },
  };
}

/** Linear-resampled, 16-bit mono PCM WAV from Float32 chunks. */
export function encodeWav(chunks, sampleRate, targetRate = 16000) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const rate = Math.min(sampleRate, targetRate), ratio = sampleRate / rate;
  const frames = Math.floor(total / ratio);
  const buffer = new ArrayBuffer(44 + frames * 2), view = new DataView(buffer);
  const text = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, 36 + frames * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, frames * 2, true);
  const flat = new Float32Array(total); let at = 0;
  for (const chunk of chunks) { flat.set(chunk, at); at += chunk.length; }
  for (let frame = 0; frame < frames; frame++) {
    const position = frame * ratio, index = Math.floor(position), fraction = position - index;
    const a = flat[index] ?? 0, b = flat[index + 1] ?? a;
    const sample = Math.max(-1, Math.min(1, a + (b - a) * fraction));
    view.setInt16(44 + frame * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return buffer;
}

/** WAV capture through the Web Audio graph (ScriptProcessor: no module file
 * needed, which the page CSP would otherwise constrain). */
export function createWavCapture({ media = globalThis.navigator?.mediaDevices, AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext } = {}) {
  let stream = null, context = null, source = null, processor = null, chunks = [];
  const release = () => {
    try { source?.disconnect(); processor?.disconnect(); } catch {}
    stream?.getTracks().forEach(track => track.stop()); void context?.close().catch(() => {});
    stream = context = source = processor = null;
  };
  return {
    supported: !!(media?.getUserMedia && AudioContextClass && AudioContextClass.prototype?.createScriptProcessor),
    async start() {
      stream = await media.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
      context = new AudioContextClass(); chunks = [];
      if (context.state === 'suspended') await context.resume().catch(() => {});
      source = context.createMediaStreamSource(stream);
      processor = context.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = event => { chunks.push(new Float32Array(event.inputBuffer.getChannelData(0))); };
      source.connect(processor); processor.connect(context.destination);
    },
    async stop() {
      const rate = context?.sampleRate ?? 48000, captured = chunks; release();
      return captured.length ? new Blob([encodeWav(captured, rate)], { type: 'audio/wav' }) : null;
    },
    cancel() { release(); chunks = []; },
  };
}

/** Preferred MediaRecorder container: webm/opus, then any webm, then ogg/mp4. */
export function pickRecordingType(isTypeSupported = () => false) {
  for (const type of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']) {
    try { if (isTypeSupported(type)) return type; } catch {}
  }
  return '';
}

/** Fallback capture via MediaRecorder (webm/opus). */
export function createRecorderCapture({ media = globalThis.navigator?.mediaDevices, Recorder = globalThis.MediaRecorder } = {}) {
  let stream = null, recorder = null, chunks = [], done = null;
  const release = () => { stream?.getTracks().forEach(track => track.stop()); stream = null; recorder = null; };
  return {
    supported: !!(media?.getUserMedia && Recorder),
    async start() {
      stream = await media.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mimeType = pickRecordingType(type => Recorder.isTypeSupported?.(type));
      recorder = new Recorder(stream, mimeType ? { mimeType } : undefined); chunks = [];
      recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
      done = new Promise(resolve => { recorder.onstop = resolve; });
      recorder.start();
    },
    async stop() {
      if (!recorder) return null;
      const type = (recorder.mimeType || 'audio/webm').split(';')[0];
      recorder.stop(); await done; release();
      return chunks.length ? new Blob(chunks, { type }) : null;
    },
    cancel() { try { recorder?.stop(); } catch {} release(); chunks = []; },
  };
}

/** Hold-to-talk → `transcribe(blob)` → text. States: idle, starting,
 * recording, transcribing. Short taps (< `minMs`) are discarded. */
export function createPushToTalk({ transcribe, onState = () => {}, maxMs = 59000, minMs = 350,
  captures = [createWavCapture(), createRecorderCapture()], now = () => performance.now() } = {}) {
  const capture = captures.find(row => row?.supported) ?? null;
  let state = 'idle', startedAt = 0, timer = null, stopRequested = false;
  const set = next => { state = next; try { onState(next); } catch {} };
  const self = {
    get state() { return state; },
    get supported() { return !!capture; },
    async start() {
      if (state !== 'idle') return false;
      if (!capture) throw new Error('Voice input needs a browser with microphone access.');
      set('starting'); stopRequested = false;
      try { await capture.start(); }
      catch (error) { capture.cancel(); set('idle'); throw new Error(error?.name === 'NotAllowedError' ? 'Microphone permission was declined.' : 'The microphone could not start.'); }
      startedAt = now(); set('recording');
      timer = setTimeout(() => { void self.stop(); }, maxMs);
      if (stopRequested) void self.stop();
      return true;
    },
    /** Resolves to the transcript, or null when discarded/empty. */
    async stop() {
      if (state === 'starting') { stopRequested = true; return null; }
      if (state !== 'recording') return null;
      clearTimeout(timer);
      const duration = now() - startedAt;
      set('transcribing');
      try {
        const blob = await capture.stop();
        if (duration < minMs || !blob) return null;
        const result = await transcribe(blob);
        const text = typeof result?.text === 'string' ? result.text.trim() : '';
        return text || null;
      } finally { set('idle'); }
    },
    cancel() { clearTimeout(timer); capture?.cancel(); set('idle'); },
  };
  return self;
}
